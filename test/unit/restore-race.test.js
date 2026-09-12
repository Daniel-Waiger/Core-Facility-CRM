/* restore-race.test.js — item 4 (adversarial review of PR #44), parts (b) and (c):
 *
 * (c) A flush already scheduled (or in flight) against the OLD database must never persist AFTER
 * restoreBackup() has swapped in and written the restored one — otherwise the stale old-database
 * bytes silently land in IndexedDB after the restore, undoing it. restoreBackup() now waits for
 * any in-flight save to finish before swapping `db`, and bumps a generation counter a flush
 * checks before it ever writes, so a flush that was merely SCHEDULED (not yet started) when the
 * restore ran is a no-op once it does fire.
 *
 * (b) restoreBackup() must REPLACE the upload set, not merge into it: an attachment blob left
 * over from the pre-restore database must not survive a restore whose backup doesn't carry it.
 *
 * Uses the same minimal fake IndexedDB as autosave.test.js (one 'kv' store, resolving on
 * tx.oncomplete/onerror — see db.js's idbSet/idbDelete) rather than memoryMode, because memoryMode
 * writes synchronously and cannot reproduce a race that depends on a debounced timer firing after
 * an async restore.
 */
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadApp, REPO } = require('./helpers/load-module');

// `gate`, when set to a pending Promise, holds every put() from completing until that promise
// resolves — lets a test pause a write mid-flight at a moment it controls precisely, rather than
// guessing with setTimeout delays. `onPutStart(key)` fires the instant a put() call begins (before
// it waits on the gate), so a test can know exactly when a paused write is in flight.
function makeFakeIndexedDB() {
  const store = new Map();
  let gate = null;
  let onPutStart = null;
  let failWhen = null; // (key) => bool — makes the matching put() reject via tx.onerror instead of committing
  const dbHandle = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction(_name, _mode) {
      const tx = {};
      const storeApi = {
        get(key) {
          // idbGet (unlike idbSet/idbDelete) still resolves via req.onsuccess, not tx.oncomplete
          // — see db.js's idbGet, which this fix left unchanged.
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
          if (failWhen && failWhen(entry.k)) {
            if (onPutStart) onPutStart(entry.k);
            queueMicrotask(() => {
              tx.error = new Error('simulated storage failure');
              if (tx.onerror) tx.onerror();
            });
            return {};
          }
          if (gate) {
            // The gate holds exactly the NEXT put() call, then clears itself — so a second put()
            // (e.g. restoreBackup's own write, arriving while the first is still paused) is NOT
            // also silently held hostage by the same gate, which would make every write pause
            // together and hide whichever one a fix does or doesn't make wait for the other.
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
          queueMicrotask(() => {
            store.delete(key);
            if (tx.oncomplete) tx.oncomplete();
          });
          return {};
        },
        openCursor() {
          const req = {};
          const fire = () => { if (req.onsuccess) req.onsuccess({ target: { result: req.result } }); };
          queueMicrotask(() => {
            const keys = [...store.keys()];
            let i = 0;
            (function step() {
              if (i >= keys.length) { req.result = null; fire(); return; }
              const k = keys[i++];
              req.result = { key: k, value: store.get(k), continue: step };
              fire();
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
    setGate(p) { gate = p; },
    setOnPutStart(fn) { onPutStart = fn; },
    setFailWhen(fn) { failWhen = fn; },
  };
}

describe('restoreBackup: races with the autosave debounce, and replaces the upload set', () => {
  let restoreGlobals = [];
  afterEach(() => {
    for (const fn of restoreGlobals) fn();
    restoreGlobals = [];
  });

  async function bootFakeApp() {
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
    return { app, fake };
  }

  test('(c) restoreBackup waits for an IN-FLIGHT autosave write (old bytes already captured) before it swaps and writes the restored database', async () => {
    const { app, fake } = await bootFakeApp();
    const { DB } = app;

    // Gate every put() so the autosave triggered below gets its write REQUEST accepted (its bytes
    // already captured from the OLD database by db.js's flush(), via currentBytes()) but held from
    // actually completing — reproducing the exact hazard item 4c describes: a save already in
    // flight with stale bytes, racing restoreBackup's own write.
    let releaseGate;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    fake.setGate(gate);
    let putStarted = null;
    let resolvePutStarted;
    const putStartedPromise = new Promise((resolve) => { resolvePutStarted = resolve; });
    fake.setOnPutStart((key) => { putStarted = key; resolvePutStarted(); });

    // Dirty the OLD database — arms the 400ms autosave timer. Once it fires, flush() captures
    // OLD-database bytes and calls idbSet, which is now gated (paused) above.
    DB.run("INSERT INTO projects (title, code, status) VALUES ('Stale','P-STALE','Active')");
    await putStartedPromise; // the stale flush's write is now in flight, paused on the gate
    assert.equal(putStarted, 'core.db', 'the paused write must be the autosave writing core.db');

    // Build a DIFFERENT, already-valid backup off a second, freshly-booted database.
    const donor = loadApp(['consts', 'db', 'ui']);
    await donor.DB.boot();
    donor.DB.run("INSERT INTO projects (title, code, status) VALUES ('Restored','P-RESTORED','Active')");
    const restoredBytes = Array.from(donor.DB.currentBytes());

    // Kick off the restore WHILE the stale write is still paused on the gate. Do not await yet —
    // if restoreBackup correctly waits for the in-flight save (waitForSaveIdle), this promise
    // cannot resolve until the gate is released below.
    const restorePromise = DB.restoreBackup({ kind: 'core-facility-backup', version: 2, created: new Date().toISOString(), demo: false, db: restoredBytes, uploads: {} });

    let restoreSettled = false;
    restorePromise.then(() => { restoreSettled = true; });
    // Give restoreBackup's own non-gated async work (inspectBackupCandidate opening a scratch
    // SQL.Database, etc.) real time to run to the point where it's blocked on the gated write —
    // it cannot get any further than that no matter how long we wait here, since the gate is
    // still held.
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(restoreSettled, false, 'restoreBackup must not have completed yet — the stale write it needs to wait for is still paused on the gate');
    assert.equal(fake.store.has('core.db'), false, 'nothing must have been written to IndexedDB yet — neither the stale write nor the restore has completed');

    // Release the paused stale write. It completes first (with OLD bytes); THEN restoreBackup's
    // own wait resolves and it proceeds to swap `db` and write the RESTORED bytes.
    releaseGate();
    await restorePromise;

    assert.ok(DB.row("SELECT id FROM projects WHERE code='P-RESTORED'"), 'the live db must be the restored one after restoreBackup resolves');

    const SQL = await globalThis.initSqlJs();
    const persisted = new SQL.Database(new Uint8Array(fake.store.get('core.db')));
    const persistedHasRestored = persisted.exec("SELECT COUNT(*) FROM projects WHERE code='P-RESTORED'")[0].values[0][0];
    const persistedHasStale = persisted.exec("SELECT COUNT(*) FROM projects WHERE code='P-STALE'")[0].values[0][0];
    persisted.close();
    assert.equal(persistedHasRestored, 1, 'IndexedDB must end up holding the RESTORED database — the stale (already in-flight) write must not have landed AFTER it');
    assert.equal(persistedHasStale, 0, 'the stale pre-restore edit must never appear in the persisted database');
  });

  test('(b) restoring a backup with no uploads deletes every upload the live database had, not just adds none', async () => {
    const { app } = await bootFakeApp();
    const { DB } = app;

    await DB.saveUpload('old-file.bin', new Blob(['hello']));
    assert.ok(await DB.getUpload('old-file.bin'), 'sanity: the upload exists before restore');

    const donor = loadApp(['consts', 'db', 'ui']);
    await donor.DB.boot();
    const restoredBytes = Array.from(donor.DB.currentBytes());

    await DB.restoreBackup({ kind: 'core-facility-backup', version: 2, created: new Date().toISOString(), demo: false, db: restoredBytes, uploads: {} });

    const stillThere = await DB.getUpload('old-file.bin');
    assert.equal(stillThere, undefined, 'an upload absent from the backup must be deleted by the restore, not left behind');
  });

  test('(b) restoring a backup replaces the upload set: a name the backup DOES carry survives, one it does not is gone', async () => {
    const { app } = await bootFakeApp();
    const { DB } = app;

    await DB.saveUpload('keep-me.bin', new Blob(['keep']));
    await DB.saveUpload('drop-me.bin', new Blob(['drop']));

    const donor = loadApp(['consts', 'db', 'ui']);
    await donor.DB.boot();
    const restoredBytes = Array.from(donor.DB.currentBytes());

    // The backup carries ITS OWN version of 'keep-me.bin' (different content) but nothing named
    // 'drop-me.bin' — restoring must end up with exactly the backup's upload set.
    const b64 = Buffer.from('replaced-content').toString('base64');
    await DB.restoreBackup({
      kind: 'core-facility-backup', version: 2, created: new Date().toISOString(), demo: false,
      db: restoredBytes,
      uploads: { 'keep-me.bin': { type: 'application/octet-stream', data: b64 } },
    });

    const dropped = await DB.getUpload('drop-me.bin');
    assert.equal(dropped, undefined, "'drop-me.bin' was not in the backup and must be gone after restore");
    const kept = await DB.getUpload('keep-me.bin');
    assert.ok(kept, "'keep-me.bin' was in the backup and must exist after restore");
    const text = await kept.text();
    assert.equal(text, 'replaced-content', "the restored blob's content must be the BACKUP's version, not the pre-restore one");
  });

  test('(1) a malformed upload entry ({}) rejects the whole restore BEFORE anything is touched — old uploads and the live db survive untouched', async () => {
    const { app } = await bootFakeApp();
    const { DB } = app;

    await DB.saveUpload('old-file.bin', new Blob(['still-here']));
    DB.run("INSERT INTO projects (title, code, status) VALUES ('Original','P-ORIG','Active')");

    const donor = loadApp(['consts', 'db', 'ui']);
    await donor.DB.boot();
    donor.DB.run("INSERT INTO projects (title, code, status) VALUES ('Restored','P-RESTORED','Active')");
    const restoredBytes = Array.from(donor.DB.currentBytes());

    await assert.rejects(
      DB.restoreBackup({
        kind: 'core-facility-backup', version: 2, created: new Date().toISOString(), demo: false,
        db: restoredBytes,
        uploads: { 'bad.bin': {} }, // no `.data` string — malformed
      }),
      /malformed/,
    );

    assert.ok(DB.row("SELECT id FROM projects WHERE code='P-ORIG'"), 'the live db must be entirely untouched by a rejected restore');
    assert.equal(DB.row("SELECT id FROM projects WHERE code='P-RESTORED'"), null, 'the (invalid) backup must never have been swapped in');
    const stillThere = await DB.getUpload('old-file.bin');
    assert.ok(stillThere, 'a pre-existing upload must survive a restore that gets rejected for a malformed entry — nothing should have been deleted yet');
  });

  test('(1) an upload entry with data that is not valid base64 rejects the whole restore before any deletion or db swap', async () => {
    const { app } = await bootFakeApp();
    const { DB } = app;

    await DB.saveUpload('old-file.bin', new Blob(['still-here']));
    DB.run("INSERT INTO projects (title, code, status) VALUES ('Original','P-ORIG','Active')");

    const donor = loadApp(['consts', 'db', 'ui']);
    await donor.DB.boot();
    const restoredBytes = Array.from(donor.DB.currentBytes());

    await assert.rejects(
      DB.restoreBackup({
        kind: 'core-facility-backup', version: 2, created: new Date().toISOString(), demo: false,
        db: restoredBytes,
        uploads: { 'bad.bin': { type: 'application/octet-stream', data: '***not base64***' } },
      }),
      /could not be decoded/,
    );

    assert.ok(DB.row("SELECT id FROM projects WHERE code='P-ORIG'"), 'the live db must be entirely untouched');
    const stillThere = await DB.getUpload('old-file.bin');
    assert.ok(stillThere, 'nothing must have been deleted before the malformed entry was caught');
  });

  test('(1) a failing upload write AFTER the db swap rolls back: previousDb is restored as live and re-persisted', async () => {
    const { app, fake } = await bootFakeApp();
    const { DB } = app;

    await DB.saveUpload('keep-me.bin', new Blob(['keep']));
    DB.run("INSERT INTO projects (title, code, status) VALUES ('Original','P-ORIG','Active')");

    const donor = loadApp(['consts', 'db', 'ui']);
    await donor.DB.boot();
    donor.DB.run("INSERT INTO projects (title, code, status) VALUES ('Restored','P-RESTORED','Active')");
    const restoredBytes = Array.from(donor.DB.currentBytes());

    const b64 = Buffer.from('new-content').toString('base64');
    // Make ONLY the upload write itself fail (not the db-swap's own idbSet, which put()s
    // 'core.db' earlier in the same restore) — a genuine post-swap IndexedDB failure.
    fake.setFailWhen((k) => String(k).startsWith('uploads:'));

    await assert.rejects(
      DB.restoreBackup({
        kind: 'core-facility-backup', version: 2, created: new Date().toISOString(), demo: false,
        db: restoredBytes,
        uploads: { 'keep-me.bin': { type: 'application/octet-stream', data: b64 } },
      }),
      /simulated storage failure/,
    );
    fake.setFailWhen(null);

    assert.ok(DB.row("SELECT id FROM projects WHERE code='P-ORIG'"), 'db must have been rolled back to the pre-restore one, live in memory');
    assert.equal(DB.row("SELECT id FROM projects WHERE code='P-RESTORED'"), null, 'the restored db must not remain live after rollback');

    const SQL = await globalThis.initSqlJs();
    const persisted = new SQL.Database(new Uint8Array(fake.store.get('core.db')));
    const hasOrig = persisted.exec("SELECT COUNT(*) FROM projects WHERE code='P-ORIG'")[0].values[0][0];
    const hasRestored = persisted.exec("SELECT COUNT(*) FROM projects WHERE code='P-RESTORED'")[0].values[0][0];
    persisted.close();
    assert.equal(hasOrig, 1, 'IndexedDB must have been re-persisted with the ROLLED-BACK (original) database');
    assert.equal(hasRestored, 0, 'the restored database must not be what ended up persisted after a rollback');
  });

  test('(C4-followups #2) a failing upload write on the 2nd of 3 uploads leaves the OLD upload set byte-identical, not just the db rolled back', async () => {
    const { app, fake } = await bootFakeApp();
    const { DB } = app;

    // Three pre-existing uploads, all of which the incoming backup will also carry (under the
    // same names, but with DIFFERENT content) — so the apply phase's write loop overwrites all
    // three, in insertion order a.bin, b.bin, c.bin.
    await DB.saveUpload('a.bin', new Blob(['old-a']));
    await DB.saveUpload('b.bin', new Blob(['old-b']));
    await DB.saveUpload('c.bin', new Blob(['old-c']));
    DB.run("INSERT INTO projects (title, code, status) VALUES ('Original','P-ORIG','Active')");
    await DB.flushNow();
    const oldBytesBefore = {
      a: await (await DB.getUpload('a.bin')).text(),
      b: await (await DB.getUpload('b.bin')).text(),
      c: await (await DB.getUpload('c.bin')).text(),
    };

    const donor = loadApp(['consts', 'db', 'ui']);
    await donor.DB.boot();
    donor.DB.run("INSERT INTO projects (title, code, status) VALUES ('Restored','P-RESTORED','Active')");
    const restoredBytes = Array.from(donor.DB.currentBytes());

    // Only the SECOND upload write (b.bin) fails — a.bin's write, if the apply phase does not
    // hold the old blob first, has already landed with NEW content by the time the failure hits.
    fake.setFailWhen((k) => k === 'uploads:b.bin');

    await assert.rejects(
      DB.restoreBackup({
        kind: 'core-facility-backup', version: 2, created: new Date().toISOString(), demo: false,
        db: restoredBytes,
        uploads: {
          'a.bin': { type: 'application/octet-stream', data: Buffer.from('new-a').toString('base64') },
          'b.bin': { type: 'application/octet-stream', data: Buffer.from('new-b').toString('base64') },
          'c.bin': { type: 'application/octet-stream', data: Buffer.from('new-c').toString('base64') },
        },
      }),
      /simulated storage failure/,
    );
    fake.setFailWhen(null);

    assert.ok(DB.row("SELECT id FROM projects WHERE code='P-ORIG'"), 'db must be rolled back to the pre-restore one');

    const aAfter = await (await DB.getUpload('a.bin')).text();
    const bAfter = await (await DB.getUpload('b.bin')).text();
    const cAfter = await (await DB.getUpload('c.bin')).text();
    assert.equal(aAfter, oldBytesBefore.a, "a.bin's write landed before the failure — a failed restore must put its OLD content back, not leave the new content standing");
    assert.equal(bAfter, oldBytesBefore.b, 'b.bin never actually got the new content (its own write failed) — it must still read as the old content');
    assert.equal(cAfter, oldBytesBefore.c, 'c.bin was never reached — it must be untouched');
  });
});
