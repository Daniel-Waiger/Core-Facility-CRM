/* flushnow-await.test.js — item 3 (second Copilot review of PR #44):
 *
 * flushNow() used to just call flush(), which is a no-op whenever a save is already in flight
 * (`saving` is true) — so an edit that landed WHILE that save was writing (pendingDuringSave)
 * had nothing to make it go out during the lifecycle event that called flushNow() at all; it
 * relied entirely on the 400ms timer flush() re-arms for it, which pagehide/beforeunload may not
 * give time to actually fire. flushNow() must now AWAIT the in-flight save and then call flush()
 * again itself, so the returned promise only resolves once the pending snapshot has actually been
 * issued — not merely scheduled.
 *
 * Uses the same minimal fake IndexedDB + gate mechanism as autosave-pagehide-race.test.js.
 */
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadApp, REPO } = require('./helpers/load-module');

function makeFakeIndexedDB() {
  const store = new Map();
  let gate = null;
  let onPutStart = null;
  const dbHandle = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction() {
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
          const finish = () => { store.set(entry.k, entry.v); if (tx.oncomplete) tx.oncomplete(); };
          if (gate) {
            const g = gate;
            gate = null;
            if (onPutStart) onPutStart(entry.k);
            g.then(finish);
          } else {
            if (onPutStart) onPutStart(entry.k);
            queueMicrotask(finish);
          }
          return {};
        },
        delete(key) {
          queueMicrotask(() => { store.delete(key); if (tx.oncomplete) tx.oncomplete(); });
          return {};
        },
        openCursor() {
          const req = {};
          queueMicrotask(() => { req.result = null; if (req.onsuccess) req.onsuccess({ target: { result: null } }); });
          return req;
        },
      };
      tx.objectStore = () => storeApi;
      return tx;
    },
  };
  return {
    store,
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = dbHandle;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: dbHandle } });
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
    setGate(p) { gate = p; },
    setOnPutStart(fn) { onPutStart = fn; },
  };
}

describe('flushNow(): awaits an in-flight save and issues a follow-up flush before its own promise resolves', () => {
  let restoreGlobals = [];
  afterEach(() => {
    for (const fn of restoreGlobals) fn();
    restoreGlobals = [];
  });

  test('flushNow() called while a save is in flight does not resolve until the pending edit made during that save is itself persisted', async () => {
    const savedBC = globalThis.BroadcastChannel;
    delete globalThis.BroadcastChannel;
    restoreGlobals.push(() => { globalThis.BroadcastChannel = savedBC; });

    const fake = makeFakeIndexedDB();
    globalThis.indexedDB = { open: (...args) => fake.open(...args) };
    restoreGlobals.push(() => { delete globalThis.indexedDB; });

    const app = loadApp(['consts', 'db', 'ui']);
    globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
    globalThis.App = { onSaving() {}, onSaved() {}, onSaveFailed() {}, onMultiTabState() {} };
    restoreGlobals.push(() => { delete globalThis.App; });

    const status = await app.DB.boot();
    assert.equal(status.persistent, true);
    const { DB } = app;

    // Gate the very next write so it stays "in flight" until released below.
    let releaseGate;
    fake.setGate(new Promise((resolve) => { releaseGate = resolve; }));
    let putCount = 0;
    fake.setOnPutStart(() => { putCount++; });

    DB.run("INSERT INTO projects (title, code, status) VALUES ('First','P-1','Active')");
    await new Promise((r) => setTimeout(r, 500)); // let the debounce fire; the write is now gated

    // A second edit lands while the first write is still in flight.
    DB.run("INSERT INTO projects (title, code, status) VALUES ('Second','P-2','Active')");

    // Call flushNow() the way a real pagehide/beforeunload listener would. It must not resolve
    // yet — the in-flight write is still gated/paused.
    let flushNowSettled = false;
    const flushNowPromise = DB.flushNow();
    flushNowPromise.then(() => { flushNowSettled = true; });
    await Promise.resolve(); // let microtasks run
    assert.equal(flushNowSettled, false, 'flushNow() must not resolve while the in-flight save it is waiting on is still paused');

    // Release the first (gated) write.
    releaseGate();
    await flushNowPromise; // must resolve once the follow-up flush for "Second" completes too

    assert.ok(putCount >= 2, 'flushNow() must have caused a SECOND write (the follow-up flush for the pending edit), not just waited on the first');

    const SQL = await globalThis.initSqlJs();
    const persisted = new SQL.Database(new Uint8Array(fake.store.get('core.db')));
    const hasFirst = persisted.exec("SELECT COUNT(*) FROM projects WHERE code='P-1'")[0].values[0][0];
    const hasSecond = persisted.exec("SELECT COUNT(*) FROM projects WHERE code='P-2'")[0].values[0][0];
    persisted.close();
    assert.equal(hasFirst, 1, 'the first edit must be persisted');
    assert.equal(hasSecond, 1, "flushNow()'s own promise must not have resolved until the second edit was ALSO persisted");
  });

  test('flushNow() called with nothing dirty and no save in flight resolves immediately (no-op)', async () => {
    const savedBC = globalThis.BroadcastChannel;
    delete globalThis.BroadcastChannel;
    restoreGlobals.push(() => { globalThis.BroadcastChannel = savedBC; });

    const fake = makeFakeIndexedDB();
    globalThis.indexedDB = { open: (...args) => fake.open(...args) };
    restoreGlobals.push(() => { delete globalThis.indexedDB; });

    const app = loadApp(['consts', 'db', 'ui']);
    globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
    globalThis.App = { onSaving() {}, onSaved() {}, onSaveFailed() {}, onMultiTabState() {} };
    restoreGlobals.push(() => { delete globalThis.App; });

    await app.DB.boot();
    await app.DB.flushNow(); // must not hang
  });
});
