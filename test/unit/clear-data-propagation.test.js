/* clear-data-propagation.test.js — item 4 (second Copilot review of PR #44):
 *
 * deleteAllUploads() used to catch a failed idbDelete, log it, and resolve successfully anyway —
 * so clearAllData() (which awaits it) resolved too, and every caller (Settings "Clear All Data",
 * the "Start Fresh" and "Reset Sandbox" seed paths) reported success over a database that still
 * had orphaned attachment blobs. It must now propagate the rejection.
 *
 * Needs a real (fake) IndexedDB, not memoryMode — memoryStore.delete() can never reject, so a
 * failure has to come from the same kind of transaction-level rejection idbDelete itself keys off
 * (tx.onerror), mirroring the fake harness in restore-race.test.js / autosave-pagehide-race.test.js.
 */
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadApp, REPO } = require('./helpers/load-module');

function makeFakeIndexedDB() {
  const store = new Map();
  let failDeleteWhen = null;
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
          queueMicrotask(() => { store.set(entry.k, entry.v); if (tx.oncomplete) tx.oncomplete(); });
          return {};
        },
        delete(key) {
          queueMicrotask(() => {
            if (failDeleteWhen && failDeleteWhen(key)) {
              tx.error = new Error('simulated storage failure');
              if (tx.onerror) tx.onerror();
              return;
            }
            store.delete(key);
            if (tx.oncomplete) tx.oncomplete();
          });
          return {};
        },
        openCursor() {
          const req = {};
          queueMicrotask(() => {
            const keys = [...store.keys()];
            let i = 0;
            (function step() {
              if (i >= keys.length) { req.result = null; if (req.onsuccess) req.onsuccess({ target: { result: null } }); return; }
              const k = keys[i++];
              req.result = { key: k, value: store.get(k), continue: step };
              if (req.onsuccess) req.onsuccess({ target: { result: req.result } });
            })();
          });
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
    setFailDeleteWhen(fn) { failDeleteWhen = fn; },
  };
}

describe('clearAllData(): propagates a failed upload deletion instead of swallowing it', () => {
  let restoreGlobals = [];
  afterEach(() => {
    for (const fn of restoreGlobals) fn();
    restoreGlobals = [];
  });

  test('a rejecting delete on an uploads:* key makes clearAllData() itself reject, not resolve "cleared"', async () => {
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

    await DB.saveUpload('probe.bin', new Blob(['x']));
    fake.setFailDeleteWhen((k) => String(k).startsWith('uploads:'));

    await assert.rejects(DB.clearAllData(), /simulated storage failure/, 'clearAllData() must reject, not silently resolve, when an upload blob fails to delete');
  });
});
