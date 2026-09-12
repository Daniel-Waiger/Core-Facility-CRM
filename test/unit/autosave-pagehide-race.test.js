/* autosave-pagehide-race.test.js — item 2 (adversarial review of PR #44):
 *
 * flush() has always relied on a still-armed setTimeout to retry a save that landed while an
 * earlier one was already writing (pendingDuringSave). But a LIFECYCLE flush — pagehide,
 * beforeunload, or a tab going hidden — calls flushNow(), which explicitly CLEARS that timer to
 * jump the debounce queue (see flushNow's own comment). If that clear happens to land on the
 * timer that a save-in-flight's own pendingDuringSave edit had (re)armed, nothing is left to fire
 * it once the in-flight save finishes — the second edit stays dirty forever, with no further user
 * action able to save it (nothing schedules a next flush() call). flush() must now schedule one
 * itself when it finishes a save with pendingDuringSave still set.
 *
 * Plain Node has no global addEventListener/dispatchEvent (verified: both are undefined), so
 * db.js's own `if (typeof global.addEventListener === 'function')` guard never registers the real
 * pagehide/beforeunload listeners in this harness — this file supplies a minimal stand-in BEFORE
 * loading db.js so its registration branch runs, and calls the captured listener directly to
 * simulate the lifecycle event precisely, at the moment this test controls.
 */
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadApp, REPO } = require('./helpers/load-module');

// Same minimal fake IndexedDB shape as restore-race.test.js's, with the same gate mechanism —
// see that file's header comment for why a "hold the next put(), then self-clear" gate is what
// lets a test pause exactly one write without also pausing every write after it.
function makeFakeIndexedDB() {
  const store = new Map();
  let gate = null;
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
          if (gate) { const g = gate; gate = null; g.then(finish); } else queueMicrotask(finish);
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
  };
}

describe('autosave: a lifecycle flush (pagehide) racing a save-in-flight must not strand a later edit dirty forever', () => {
  let restoreGlobals = [];
  afterEach(() => {
    for (const fn of restoreGlobals) fn();
    restoreGlobals = [];
  });

  test('pendingDuringSave, cleared timer via a simulated pagehide, still gets a follow-up flush once the in-flight save finishes', async () => {
    const savedBC = globalThis.BroadcastChannel;
    delete globalThis.BroadcastChannel;
    restoreGlobals.push(() => { globalThis.BroadcastChannel = savedBC; });

    const fake = makeFakeIndexedDB();
    globalThis.indexedDB = { open: (...args) => fake.open(...args) };
    restoreGlobals.push(() => { delete globalThis.indexedDB; });

    // Minimal addEventListener/dispatchEvent stand-in, installed BEFORE loadApp runs db.js's IIFE
    // (which registers its pagehide/beforeunload listeners at load time), so this test can call
    // the exact same flushNow db.js wires up, at the moment IT chooses, standing in for a real
    // pagehide event firing mid-save.
    const listeners = {};
    const savedAEL = globalThis.addEventListener;
    globalThis.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
    restoreGlobals.push(() => { globalThis.addEventListener = savedAEL; });

    const app = loadApp(['consts', 'db', 'ui']);
    globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
    globalThis.App = { onSaving() {}, onSaved() {}, onSaveFailed() {}, onMultiTabState() {} };
    restoreGlobals.push(() => { delete globalThis.App; });

    const status = await app.DB.boot();
    assert.equal(status.persistent, true);
    assert.ok(listeners.pagehide && listeners.pagehide.length, 'db.js must have registered a pagehide listener during boot()');

    const { DB } = app;

    // Gate the very next write so it stays "in flight" (saving=true) until we release it below.
    let releaseGate;
    fake.setGate(new Promise((resolve) => { releaseGate = resolve; }));

    DB.run("INSERT INTO projects (title, code, status) VALUES ('First','P-1','Active')");
    // Let the 400ms debounce actually fire and start the (now gated/paused) write.
    await new Promise((r) => setTimeout(r, 500));

    // A second edit lands WHILE the first save is still in flight — markDirty() sets
    // pendingDuringSave and (re)arms the debounce timer.
    DB.run("INSERT INTO projects (title, code, status) VALUES ('Second','P-2','Active')");

    // Simulate the tab being backgrounded/closed right now: flushNow() clears that just-armed
    // timer to jump the queue, but flush() itself no-ops immediately since a save (the first
    // write) is already in flight (`saving` is true) — exactly the sequence item 2 describes.
    for (const fn of listeners.pagehide) fn();

    // Let the first (gated) write actually complete.
    releaseGate();
    await new Promise((r) => setTimeout(r, 50));

    // Nothing else ever calls markDirty() again — if flush() does not schedule a follow-up itself
    // on finishing with pendingDuringSave still set, "Second" is now stranded dirty forever.
    await new Promise((r) => setTimeout(r, 700)); // past the normal 400ms debounce, if one got armed

    const SQL = await globalThis.initSqlJs();
    const persisted = new SQL.Database(new Uint8Array(fake.store.get('core.db')));
    const hasFirst = persisted.exec("SELECT COUNT(*) FROM projects WHERE code='P-1'")[0].values[0][0];
    const hasSecond = persisted.exec("SELECT COUNT(*) FROM projects WHERE code='P-2'")[0].values[0][0];
    persisted.close();
    assert.equal(hasFirst, 1, 'the first edit must be persisted');
    assert.equal(hasSecond, 1, 'the second edit (pendingDuringSave, timer cleared by the simulated pagehide) must eventually be persisted too, not stranded dirty forever');
  });
});
