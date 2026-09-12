/* idb-commit-semantics.test.js — C2-residuals item 5.
 *
 * db.js's idbSet/idbDelete resolve on the transaction's `oncomplete`, not on the individual
 * request's `onsuccess` — a request can succeed and its transaction still fail to commit (a quota
 * error surfacing at commit time is the textbook case), and "the write is queued" is not the same
 * fact as "the write is durable". Nothing in the existing suite exercised this directly: it only
 * proves higher-level behavior (a failed autosave stays dirty and retries — autosave.test.js) that
 * happens to still pass whichever event idbSet keys off, since a real IndexedDB never actually
 * fires onsuccess and oncomplete out of order. A fake that DOES fire them out of order, deliberately,
 * is the only way to pin the actual commit-semantics contract down.
 *
 * This was proven to fail against the pre-fix implementation (`git show db2d257:js/db.js`, whose
 * idbSet/idbDelete resolved on `req.onsuccess` — see that revision) by temporarily copying that
 * revision's db.js into a scratch directory and pointing this test file's loader at it instead of
 * the tree's copy: it failed there exactly as expected (see the report for the transcript), and
 * passes against the shipped implementation below.
 */
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadApp, REPO } = require('./helpers/load-module');

// A fake IndexedDB whose put()/delete() calls consult a shared `mode` box (set by the test right
// before the call db.js's code will make) so onsuccess and oncomplete/onabort can be fired in an
// order real IndexedDB never actually produces, but that a correct implementation must still
// handle correctly since the spec allows a transaction to fail to commit after its request already
// reported success:
//   'success-then-complete-later' — onsuccess fires now; oncomplete fires on a LATER tick, not
//     the same one. The promise must still be pending in between.
//   'success-then-abort'          — onsuccess fires now; the transaction then ABORTS instead of
//     completing. The promise must reject, not have already resolved when onsuccess fired.
function makeFakeIndexedDB(modeBox) {
  const store = new Map();
  const dbHandle = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction(_name, _mode) {
      const tx = {};
      const mode = modeBox.next;
      modeBox.next = null; // one-shot: only the NEXT put/delete after the test arms it is special
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
        put(entry) { return mutate(() => store.set(entry.k, entry.v)); },
        delete(key) { return mutate(() => store.delete(key)); },
        openCursor() {
          const req = {};
          queueMicrotask(() => { req.result = null; if (req.onsuccess) req.onsuccess({ target: { result: null } }); });
          return req;
        },
      };
      function mutate(apply) {
        const req = {};
        if (mode === 'success-then-abort') {
          queueMicrotask(() => {
            apply(); // real IndexedDB applies the write when the request succeeds
            if (req.onsuccess) req.onsuccess();
            queueMicrotask(() => { if (tx.onabort) tx.onabort(); });
          });
        } else if (mode === 'success-then-complete-later') {
          queueMicrotask(() => {
            apply();
            if (req.onsuccess) req.onsuccess();
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 30);
          });
        } else {
          queueMicrotask(() => {
            apply();
            if (req.onsuccess) req.onsuccess();
            if (tx.oncomplete) tx.oncomplete();
          });
        }
        return req;
      }
      tx.objectStore = () => storeApi;
      return tx;
    },
  };
  return {
    store,
    modeBox,
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

describe('IndexedDB commit semantics: idbSet/idbDelete must key off the TRANSACTION, not the request', () => {
  let restoreGlobals = [];
  afterEach(() => {
    for (const fn of restoreGlobals) fn();
    restoreGlobals = [];
  });

  async function bootFakeApp() {
    const savedBC = globalThis.BroadcastChannel;
    delete globalThis.BroadcastChannel;
    restoreGlobals.push(() => { globalThis.BroadcastChannel = savedBC; });

    const modeBox = { next: null };
    const fake = makeFakeIndexedDB(modeBox);
    globalThis.indexedDB = { open: (...args) => fake.open(...args) };
    restoreGlobals.push(() => { delete globalThis.indexedDB; });

    const app = loadApp(['consts', 'db', 'ui']);
    globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
    globalThis.App = { onSaving() {}, onSaved() {}, onSaveFailed() {}, onMultiTabState() {} };
    restoreGlobals.push(() => { delete globalThis.App; });

    const status = await app.DB.boot();
    assert.equal(status.persistent, true);
    return { app, fake, modeBox };
  }

  test('a write whose request succeeds but whose transaction only completes LATER must not resolve until it does', async () => {
    const { app, fake, modeBox } = await bootFakeApp();
    const { DB } = app;

    // Boot itself calls idbGet only (readonly), so nothing has consumed the armed mode yet. Arm
    // it, then dirty the database — markDirty()'s debounce eventually calls idbSet through
    // flush(), which is exactly the real call path (db.js exposes no idbSet directly, by design).
    modeBox.next = 'success-then-complete-later';
    const saveEvents = [];
    globalThis.App.onSaved = () => saveEvents.push('saved');

    DB.run("INSERT INTO projects (title, code, status) VALUES ('X','P-X','Active')");
    // The 400ms debounce elapses, flush() calls idbSet, and its underlying put()'s onsuccess fires
    // almost immediately after — but oncomplete is deliberately deferred another 30ms past that.
    // Check partway through that window: the write must NOT have resolved (no 'saved' yet).
    await new Promise((r) => setTimeout(r, 420));
    assert.equal(saveEvents.length, 0, "onsuccess firing must not resolve idbSet — 'saved' must not have fired while the transaction has not committed yet");

    // Once oncomplete actually fires (well within its 30ms deferral from onsuccess), the save must
    // complete normally.
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(saveEvents, ['saved'], "the save must complete once (and only once) the transaction actually commits");
  });

  test('a write whose request succeeds but whose transaction then ABORTS must reject, not resolve', async () => {
    const { app, fake, modeBox } = await bootFakeApp();
    const { DB } = app;

    modeBox.next = 'success-then-abort';
    const saveEvents = [];
    globalThis.App.onSaved = () => saveEvents.push('saved');
    globalThis.App.onSaveFailed = () => saveEvents.push('failed');

    DB.run("INSERT INTO projects (title, code, status) VALUES ('Y','P-Y','Active')");
    await new Promise((r) => setTimeout(r, 700)); // past the debounce and both queued microtasks

    assert.deepEqual(saveEvents, ['failed'], 'a transaction that aborts after its request already succeeded must be reported as a FAILED save, never a saved one');
  });
});
