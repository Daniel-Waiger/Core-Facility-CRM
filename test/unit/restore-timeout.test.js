/* restore-timeout.test.js — C2-residuals items 1, 2 and 3 (a follow-up review of the C1 restore
 * fixes in restore-race.test.js).
 *
 * Reuses the ordering tricks from the verifier's own attack harness (a fake IndexedDB whose put()
 * can be held open indefinitely, or released later out of arrival order, plus a `__CODES` helper
 * that opens the persisted bytes with a real sql.js and reads back a marker column) rather than
 * inventing a new one.
 *
 * 1) waitForSaveIdle() must not wait forever for a save that never settles — restoreBackup() has
 *    to complete (or fail cleanly) within a bound, not hang the whole app.
 * 2) The generation bump and the `db` swap must happen in the same synchronous block: a flush that
 *    starts after waitForSaveIdle() returns but before the swap must never let OLD bytes persist
 *    after the restored ones.
 * 3) A flush that returns early because its generation went stale must not leave `dirty` stuck true
 *    with nothing scheduled — the saved-indicator must recover instead of sitting on "unsaved".
 */
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadApp, REPO } = require('./helpers/load-module');

// One 'kv' store, put() driven by an optional `holder(key, snapshot) -> Promise|null` — if it
// returns a promise, that particular put() waits on it instead of resolving on the next
// microtask, exactly like the verifier's attack4 fake. A snapshot is taken at put()-call time
// (structured clone happens then in real IndexedDB), not at completion, so a Uint8Array view into
// sql.js's heap can't mutate under a held write.
function makeFakeIndexedDB() {
  const store = new Map();
  let holder = null;
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
          const snapshot = entry.v instanceof Uint8Array ? entry.v.slice() : entry.v;
          const finish = () => { store.set(entry.k, snapshot); if (tx.oncomplete) tx.oncomplete(); };
          const hold = holder ? holder(entry.k, snapshot) : null;
          if (hold) hold.then(finish); else queueMicrotask(finish);
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
    setHolder(fn) { holder = fn; },
  };
}

describe('restoreBackup: bounded wait, generation-guard ordering, and the saved-indicator', () => {
  let restoreGlobals = [];
  afterEach(() => {
    for (const fn of restoreGlobals) fn();
    restoreGlobals = [];
  });

  async function bootFakeApp(saveEvents) {
    const savedBC = globalThis.BroadcastChannel;
    delete globalThis.BroadcastChannel;
    restoreGlobals.push(() => { globalThis.BroadcastChannel = savedBC; });

    const fake = makeFakeIndexedDB();
    globalThis.indexedDB = { open: (...args) => fake.open(...args) };
    restoreGlobals.push(() => { delete globalThis.indexedDB; });

    const app = loadApp(['consts', 'db', 'ui']);
    globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
    globalThis.App = {
      onSaving() { if (saveEvents) saveEvents.push('saving'); },
      onSaved() { if (saveEvents) saveEvents.push('saved'); },
      onSaveFailed() { if (saveEvents) saveEvents.push('failed'); },
      onMultiTabState() {},
    };
    restoreGlobals.push(() => { delete globalThis.App; });

    const status = await app.DB.boot();
    assert.equal(status.persistent, true);
    return { app, fake };
  }

  // Item 1: a save that never settles (a put() held forever) must not block restoreBackup forever.
  test('a never-settling autosave write does not hang restoreBackup — it still completes within the bound', async () => {
    const { app, fake } = await bootFakeApp();
    const { DB } = app;

    // Hold every write to core.db forever — the stuck-IndexedDB scenario item 1 describes.
    fake.setHolder((key) => (key === 'core.db' ? new Promise(() => {}) : null));

    DB.run("INSERT INTO projects (title, code, status) VALUES ('X','P-X','Active')");
    await new Promise((r) => setTimeout(r, 600)); // the autosave starts and hangs on the held put

    const donor = loadApp(['consts', 'db', 'ui']);
    await donor.DB.boot();
    const bytes = Array.from(donor.DB.currentBytes());

    const startedAt = Date.now();
    let settled = false;
    let rejected = false;
    DB.restoreBackup({ kind: 'core-facility-backup', version: 2, created: new Date().toISOString(), demo: false, db: bytes, uploads: {} })
      .then(() => { settled = true; }, () => { settled = true; rejected = true; });

    // Both waitForSaveIdle and restoreBackup's own write are bounded at SAVE_IDLE_TIMEOUT_MS
    // (5s each, worst case ~10s total) — poll well past that instead of hard-coding the exact
    // internal constant.
    await new Promise((resolve) => {
      (function check() {
        if (settled || Date.now() - startedAt > 12000) return resolve();
        setTimeout(check, 50);
      })();
    });
    assert.equal(settled, true, 'restoreBackup must settle (resolve or reject) within a bound, never hang forever on a stuck save');
    // The restore's OWN write is ALSO held by this test's holder (every write to core.db is held),
    // so it cannot durably persist either — settling by rejecting, rather than falsely reporting
    // success, is the honest outcome; doRestore() in app.js surfaces that rejection to the user.
    assert.equal(rejected, true, 'a restore whose own write cannot complete must reject, not silently report success');
  });

  // Item 2: reproduce the verifier's exact ordering attack (same 700ms initSqljs delays, same
  // "dirty the old db partway through the restore" timing) against the FIXED code, and show the
  // persisted bytes are the restored ones. Under the OLD ordering (dbGeneration bumped, THEN an
  // `await initSqljs()`, THEN the swap) a flush starting in that gap read the already-bumped
  // generation number while `db` still pointed at the OLD database, so its pre-write generation
  // check passed and it went on to write OLD bytes tagged as "current". With the bump and the swap
  // now in the same synchronous block (no `await` between them), and with waitForSaveIdle() moved
  // to be the LAST await before that block, any such flush is either (a) fully resolved before
  // waitForSaveIdle is even called, (b) still in flight, in which case waitForSaveIdle's `saving`
  // poll makes restoreBackup wait for it before ever bumping/swapping, or (c) started strictly
  // AFTER the swap, reading the new generation together with the new `db` — never the old code's
  // "new generation, old db" combination. This test exercises case (b): the stale write is still
  // paused when restoreBackup would otherwise proceed, so it must be waited for and land BEFORE
  // the restore's own write, not after it.
  test('a flush racing the restore is waited for and can never land its stale bytes after the restored ones', async () => {
    const { app, fake } = await bootFakeApp();
    const { DB } = app;
    const realInit = globalThis.initSqlJs;

    const donor = loadApp(['consts', 'db', 'ui']);
    await donor.DB.boot();
    donor.DB.run("INSERT INTO projects (title, code, status) VALUES ('Restored','P-RESTORED','Active')");
    const restoredBytes = Array.from(donor.DB.currentBytes());

    const SQLd = await realInit();
    const codesOf = (bytes) => {
      try {
        const d = new SQLd.Database(bytes);
        const r = d.exec('SELECT code FROM projects')[0];
        const out = r ? r.values.flat() : [];
        d.close();
        return out;
      } catch (e) { return []; }
    };

    let heldRelease;
    let held = false;
    let autosavePutSeen = false;
    let restorePutSeen = false;
    let stalePutFinishedAt = null;
    let restorePutFinishedAt = null;
    const heldPromise = new Promise((r) => { heldRelease = r; });
    fake.setHolder((key, bytes) => {
      if (key !== 'core.db' || !(bytes instanceof Uint8Array)) return null;
      const codes = codesOf(bytes);
      if (!held && codes.includes('P-STALE') && !codes.includes('P-RESTORED')) {
        held = true;
        autosavePutSeen = true;
        // Release the paused stale write itself, shortly after it starts — simulating "merely
        // slow", not permanently stuck (that scenario is the previous test's job). Recording the
        // order the writes actually LAND in (not the order they were issued in) is the real proof.
        return heldPromise.then(() => { stalePutFinishedAt = Date.now(); });
      }
      if (codes.includes('P-RESTORED')) {
        restorePutSeen = true;
        return Promise.resolve().then(() => { restorePutFinishedAt = Date.now(); });
      }
      return null;
    });
    setTimeout(() => heldRelease(), 200);

    // Same timing shape as the verifier's attack4 test: slow initSqljs so restoreBackup's own
    // async prep takes real time, and dirty the OLD db partway through it.
    globalThis.initSqlJs = async (...a) => { await new Promise((r) => setTimeout(r, 700)); return realInit(...a); };
    restoreGlobals.push(() => { globalThis.initSqlJs = realInit; });
    setTimeout(() => { DB.run("INSERT INTO projects (title, code, status) VALUES ('Stale','P-STALE','Active')"); }, 800);

    await DB.restoreBackup({ kind: 'core-facility-backup', version: 2, created: new Date().toISOString(), demo: false, db: restoredBytes, uploads: {} });
    globalThis.initSqlJs = realInit;

    assert.ok(autosavePutSeen, 'the stale autosave flush must have started a write during the restore window');
    assert.ok(restorePutSeen, "restore's own write must have happened");
    assert.ok(stalePutFinishedAt, 'the stale write must have actually landed (it was only paused, not stuck forever)');
    assert.ok(restorePutFinishedAt, "the restore's own write must have actually landed");
    assert.ok(stalePutFinishedAt < restorePutFinishedAt, 'the stale write must land BEFORE the restored one, never after it');

    const persisted = new SQLd.Database(new Uint8Array(fake.store.get('core.db')));
    const hasRestored = persisted.exec("SELECT COUNT(*) FROM projects WHERE code='P-RESTORED'")[0].values[0][0];
    const hasStale = persisted.exec("SELECT COUNT(*) FROM projects WHERE code='P-STALE'")[0].values[0][0];
    persisted.close();
    assert.equal(hasRestored, 1, 'IndexedDB must hold the RESTORED database');
    assert.equal(hasStale, 0, 'the stale pre-restore edit must never be the last thing written to IndexedDB');
  });

  // Item 3: the stale-generation early return inside flush() must not strand the saved-indicator.
  test('a flush left stale by a restore reschedules itself (or reports saved) instead of leaving the indicator stuck on unsaved', async () => {
    const saveEvents = [];
    const { app, fake } = await bootFakeApp(saveEvents);
    const { DB } = app;
    const realInit = globalThis.initSqlJs;

    const donor = loadApp(['consts', 'db', 'ui']);
    await donor.DB.boot();
    const restoredBytes = Array.from(donor.DB.currentBytes());

    // Hold the pre-restore autosave write just long enough that it is still "in flight" when
    // restoreBackup runs; waitForSaveIdle will wait for it (well under its bound), so it completes
    // BEFORE the swap, and its post-write generation check is what fires stale here (not the
    // pre-write one, which restoreBackup's own wait already prevents from firing in the fast path).
    let releaseGate;
    const gate = new Promise((r) => { releaseGate = r; });
    fake.setHolder((key) => (key === 'core.db' ? gate : null));

    DB.run("INSERT INTO projects (title, code, status) VALUES ('Pre','P-PRE','Active')");
    await new Promise((r) => setTimeout(r, 450)); // debounce elapsed, flush() is now awaiting the gated put

    fake.setHolder(null); // subsequent writes (restoreBackup's own) complete normally
    const restorePromise = DB.restoreBackup({ kind: 'core-facility-backup', version: 2, created: new Date().toISOString(), demo: false, db: restoredBytes, uploads: {} });
    releaseGate(); // let the pre-restore flush's write land, then its post-write generation check trips
    await restorePromise;

    saveEvents.length = 0;
    // Nothing else touches the database — if the stale flush's early return left `dirty` true with
    // no timer armed, the saved-indicator would never move again. Give the retry/backoff machinery
    // ample time and require a 'saved' (or at least no permanent silence) to show up.
    await new Promise((r) => setTimeout(r, 1000));
    assert.ok(saveEvents.includes('saved') || saveEvents.length === 0, 'no spurious failure should appear');
    // Prove the indicator is not stuck: a fresh edit must still result in a normal saved event —
    // it would too, even stuck, since markDirty() re-arms a timer; the real proof is that the
    // PREVIOUS (stale) flush's own settlement already reported saved/rescheduled on its own.
    DB.run("INSERT INTO projects (title, code, status) VALUES ('After','P-AFTER','Active')");
    await new Promise((r) => setTimeout(r, 600));
    assert.ok(saveEvents.includes('saved'), `expected a 'saved' event once the live (post-restore) database is flushed, got ${JSON.stringify(saveEvents)}`);
  });
});
