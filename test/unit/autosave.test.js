/* autosave.test.js — H3 (adversarial review §1): a rejected autosave must leave the database
 * "dirty" so the very next mutation retries it, and must never silently clear the dirty flag
 * before the write actually lands.
 *
 * Deliberately its OWN file, not folded into persistence.test.js: `node --test` runs each matched
 * file in its own process, and this test needs that isolation. It installs a fake IndexedDB and a
 * fake `window.App` on `globalThis` to observe db.js's onSaving/onSaved/onSaveFailed hooks — every
 * OTHER test file's freshDb() instances also schedule a real 400ms setTimeout per mutation
 * (db.js's autosave debounce doesn't know or care about memoryMode), and any of those still
 * pending when this file's `global.App` hooks exist would call them too, producing a phantom
 * 'saved' event that has nothing to do with this test. One file, one process, no such neighbors.
 */
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadApp, REPO } = require('./helpers/load-module');

describe('autosave: H3 — a rejected save keeps the database dirty and retries', () => {
  /* A minimal fake IndexedDB good enough for db.js's idbOpen/idbGet/idbSet: one 'kv' object
     store, get/put/delete backed by a plain Map, all resolving on a microtask (never
     synchronously, matching real IndexedDB's always-async contract). `failNextPut` lets a test
     make exactly the next put() call reject, to simulate a real save failing without needing an
     actual browser. */
  function makeFakeIndexedDB() {
    const store = new Map();
    const state = { failNextPut: false, failNextNPuts: 0, putCount: 0, lastPutValue: null };
    const dbHandle = {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => {},
      transaction(_name, _mode) {
        const tx = {};
        const storeApi = {
          get(key) {
            const req = {};
            queueMicrotask(() => {
              req.result = store.has(key) ? { k: key, v: store.get(key) } : undefined;
              if (req.onsuccess) req.onsuccess();
              if (tx.oncomplete) tx.oncomplete();
            });
            return req;
          },
          put(entry) {
            const req = {};
            state.putCount++;
            let shouldFail = state.failNextPut;
            state.failNextPut = false;
            if (state.failNextNPuts > 0) { shouldFail = true; state.failNextNPuts--; }
            queueMicrotask(() => {
              if (shouldFail) {
                req.error = new Error('simulated IndexedDB write failure');
                if (req.onerror) req.onerror();
                if (tx.onerror) tx.onerror();
                return;
              }
              store.set(entry.k, entry.v);
              state.lastPutValue = entry.v;
              if (req.onsuccess) req.onsuccess();
              if (tx.oncomplete) tx.oncomplete();
            });
            return req;
          },
          delete(key) {
            const req = {};
            queueMicrotask(() => {
              store.delete(key);
              if (req.onsuccess) req.onsuccess();
              if (tx.oncomplete) tx.oncomplete();
            });
            return req;
          },
          openCursor() {
            const req = {};
            queueMicrotask(() => {
              req.result = null; // no prefix-scan needed by this test
              if (req.onsuccess) req.onsuccess();
            });
            return req;
          },
        };
        tx.objectStore = () => storeApi;
        return tx;
      },
    };
    return {
      state,
      open() {
        const req = {};
        queueMicrotask(() => {
          req.result = dbHandle;
          if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: dbHandle } });
          if (req.onsuccess) req.onsuccess();
        });
        return req;
      },
    };
  }

  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  let restoreGlobals = [];
  afterEach(() => {
    for (const fn of restoreGlobals) fn();
    restoreGlobals = [];
  });

  test('a failed autosave leaves the database dirty; the next mutation retries and succeeds, carrying the earlier edit along', async () => {
    // BroadcastChannel exists natively in Node — a real one left open by DB's multi-tab guard
    // would keep this test's process alive forever (see db.js's startMultiTabGuard comment).
    // This test cares about the autosave/dirty path, not the multi-tab guard, so it disables
    // BroadcastChannel for its own duration exactly like a pre-2021 browser would lack it —
    // DB.boot() falls back to "every tab stays a writer" in that case, which is what we want
    // here anyway (single simulated tab).
    const savedBC = globalThis.BroadcastChannel;
    delete globalThis.BroadcastChannel;
    restoreGlobals.push(() => { globalThis.BroadcastChannel = savedBC; });

    const fake = makeFakeIndexedDB();
    globalThis.indexedDB = { open: (...args) => fake.open(...args) };
    restoreGlobals.push(() => { delete globalThis.indexedDB; });

    const app = loadApp(['consts', 'db', 'ui']);
    globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));

    const saveEvents = [];
    globalThis.App = {
      onSaving() { saveEvents.push('saving'); },
      onSaved() { saveEvents.push('saved'); },
      onSaveFailed() { saveEvents.push('failed'); },
      onMultiTabState() { saveEvents.push('multitab'); },
    };
    restoreGlobals.push(() => { delete globalThis.App; });

    const status = await app.DB.boot();
    assert.equal(status.persistent, true, 'boot must treat the fake IndexedDB as real persistent storage, not memoryMode');

    // First mutation: make its autosave fail.
    fake.state.failNextPut = true;
    app.DB.run("INSERT INTO projects (title, code, status) VALUES ('First','P-1','Active')");
    await wait(500); // > the 400ms debounce, long enough for the (failing) flush to settle

    assert.ok(saveEvents.includes('failed'), `expected onSaveFailed to fire, got ${JSON.stringify(saveEvents)}`);
    assert.ok(!saveEvents.includes('saved'), 'onSaved must not fire for a rejected save');
    assert.equal(fake.state.putCount, 1, 'exactly one put was attempted so far');

    // Second mutation: nothing forces this put to fail, so it succeeds — and per H3, this retry
    // must persist BOTH rows, proving the first (failed) edit was never dropped from `dirty`.
    saveEvents.length = 0;
    app.DB.run("INSERT INTO projects (title, code, status) VALUES ('Second','P-2','Active')");
    await wait(500);

    assert.ok(saveEvents.includes('saved'), `expected the retry to succeed, got ${JSON.stringify(saveEvents)}`);
    assert.ok(!saveEvents.includes('failed'), 'the retry must not fail');
    assert.ok(fake.state.putCount >= 2, 'the retry must have actually attempted another IndexedDB write');

    // Prove it persisted BOTH rows by reopening the exact bytes the fake store now holds.
    const savedBytes = fake.state.lastPutValue;
    assert.ok(savedBytes, 'a successful save must have written bytes to the fake store');
    const SQL = await globalThis.initSqlJs();
    const reopened = new SQL.Database(new Uint8Array(savedBytes));
    const rows = reopened.exec('SELECT title FROM projects ORDER BY title');
    const titles = rows[0].values.map((r) => r[0]);
    reopened.close();
    assert.deepEqual(titles, ['First', 'Second'], 'the retried save must carry the edit that failed the first time, not just the newest one');
  });

  test('red-team D: a failed save retries on its own (no second edit needed), and toasts once per failure streak, not once per retry', async () => {
    const savedBC = globalThis.BroadcastChannel;
    delete globalThis.BroadcastChannel;
    restoreGlobals.push(() => { globalThis.BroadcastChannel = savedBC; });

    const fake = makeFakeIndexedDB();
    globalThis.indexedDB = { open: (...args) => fake.open(...args) };
    restoreGlobals.push(() => { delete globalThis.indexedDB; });

    const app = loadApp(['consts', 'db', 'ui']);
    globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));

    const failedCalls = []; // each entry: whether onSaveFailed was called with {repeat:true}
    const saveEvents = [];
    globalThis.App = {
      onSaving() { saveEvents.push('saving'); },
      onSaved() { saveEvents.push('saved'); },
      onSaveFailed(err, opts) { failedCalls.push(!!(opts && opts.repeat)); },
      onMultiTabState() {},
    };
    restoreGlobals.push(() => { delete globalThis.App; });

    await app.DB.boot();

    // Fail the first TWO save attempts; nothing here ever calls DB.run a second time — every
    // retry beyond the first must come from db.js's own backoff timer, not from a new edit.
    fake.state.failNextNPuts = 2;
    app.DB.run("INSERT INTO projects (title, code, status) VALUES ('Retried','P-9','Active')");

    // First attempt (after the 400ms debounce) fails.
    await wait(600);
    assert.equal(fake.state.putCount, 1, 'the first attempt must have fired after the normal debounce');
    assert.deepEqual(failedCalls, [false], 'the first failure of a streak must NOT be reported as a repeat');

    // Second attempt fires on its own ~5s later — no new edit was made.
    await wait(5300);
    assert.equal(fake.state.putCount, 2, 'a second attempt must fire on its own via the backoff timer, with no further edit');
    assert.deepEqual(failedCalls, [false, true], 'the second consecutive failure must be reported as a repeat, so the UI toasts only once per streak');

    // Third attempt (the backoff timer fires again) succeeds, since failNextNPuts is now spent.
    await wait(5300);
    assert.equal(fake.state.putCount, 3, 'a third attempt must fire on its own and this one succeeds');
    assert.ok(saveEvents.includes('saved'), 'the streak must end in a real save once the write stops failing');
  });
});
