/* persistence.test.js — H1 (adversarial review §1): DB.restoreBackup must refuse an
 * empty/foreign/corrupt image BEFORE it ever touches the live database or IndexedDB, and must
 * never leave the live handle dead when it refuses. See autosave.test.js for H3 (a rejected
 * autosave keeping the database dirty and retrying) — deliberately a separate file/process, so
 * that test's fake-IndexedDB App hooks can't be reached by any pending timer this file's own
 * freshDb() instances schedule (db.js's 400ms autosave debounce fires regardless of memoryMode).
 *
 * Uses a real sql.js database throughout (see helpers/sqlite.js's freshDb) — a hand-rolled schema
 * would prove nothing about the schema/migrations this app actually ships.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { freshDb, seedFixture } = require('./helpers/sqlite');
const { REPO } = require('./helpers/load-module');

describe('restoreBackup / inspectBackupCandidate: H1 — refuse an unusable image before touching the live db', () => {
  test('rejects db: [] (the exact empty-array image that used to brick the app)', async () => {
    const { DB } = await freshDb();
    await assert.rejects(
      () => DB.restoreBackup({ kind: 'core-facility-backup', version: 2, db: [] }),
      /valid backup/i
    );
    // The live handle must still work — this is the "never bricked" half of H1.
    assert.doesNotThrow(() => DB.row('SELECT COUNT(*) c FROM projects'));
  });

  test('rejects db: {} (not an array, not usable bytes)', async () => {
    const { DB } = await freshDb();
    await assert.rejects(
      () => DB.restoreBackup({ kind: 'core-facility-backup', version: 2, db: {} }),
      /valid backup/i
    );
    assert.doesNotThrow(() => DB.row('SELECT COUNT(*) c FROM projects'));
  });

  test('rejects garbage bytes that are not a SQLite file at all', async () => {
    const { DB } = await freshDb();
    const garbage = Array.from(Buffer.from('this is not a sqlite database file, just text'));
    await assert.rejects(
      () => DB.restoreBackup({ kind: 'core-facility-backup', version: 2, db: garbage }),
      /valid backup/i
    );
    assert.doesNotThrow(() => DB.row('SELECT COUNT(*) c FROM projects'));
  });

  test('rejects a real SQLite image that is missing the core tables', async () => {
    const { DB } = await freshDb();
    seedFixture(DB);
    const before = DB.row('SELECT COUNT(*) c FROM projects').c;

    // A real, valid, openable sql.js database — just never had this app's schema. This is
    // exactly the shape of bug that let db:[] through before: sql.js opens it fine, and
    // migrate() only ever ALTERs columns onto tables that already exist, so it would never
    // create projects/people/instruments/meetings/milestones from nothing.
    const initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
    const SQL = await initSqlJs();
    const foreign = new SQL.Database();
    foreign.exec('CREATE TABLE some_other_app_table (id INTEGER PRIMARY KEY, note TEXT)');
    const foreignBytes = Array.from(foreign.export());
    foreign.close();

    await assert.rejects(
      () => DB.restoreBackup({ kind: 'core-facility-backup', version: 2, db: foreignBytes }),
      /projects/i,
      'the rejection should name a missing core table'
    );
    // Never bricked, and never even partially overwritten — the real project from before is
    // still there, proving restoreBackup never reassigned the live db for this candidate.
    assert.equal(DB.row('SELECT COUNT(*) c FROM projects').c, before);
  });

  test('accepts a real round-trip: build a backup from one database, restore it into another', async () => {
    const source = await freshDb();
    seedFixture(source.DB);
    source.DB.run("INSERT INTO meetings (project_id, title, date, category) VALUES (1, 'Kickoff', '2026-01-15', 'assisted session')");
    const backup = await source.DB.buildBackup();

    // Legacy-backup compatibility: buildBackup now always writes `demo`, but an old backup file
    // (from before this fix) never had the key at all — inspectBackupCandidate must treat that
    // as demo:false, i.e. still restorable in the real app, not silently refused.
    assert.equal(backup.demo, false, 'a real (non-demo) app must mark its own backups demo:false');
    const legacyStyle = { ...backup };
    delete legacyStyle.demo;

    const target = await freshDb();
    seedFixture(target.DB); // target has its own, different data before the restore

    const preview = await target.DB.inspectBackupCandidate(legacyStyle);
    assert.equal(preview.demo, false, 'a pre-1.11 backup with no demo key must read as demo:false, not refuse to restore');
    assert.equal(preview.counts.projects, 2);
    assert.equal(preview.counts.meetings, 1);

    const restorePreview = await target.DB.restoreBackup(legacyStyle);
    assert.equal(restorePreview.counts.meetings, 1);
    // The target's OWN prior data (from its own seedFixture call) must be gone, replaced by the
    // source's — that's what "restore" means.
    assert.equal(target.DB.row('SELECT COUNT(*) c FROM meetings').c, 1);
    assert.equal(target.DB.row("SELECT category c FROM meetings").c, 'assisted session');
    assert.equal(target.DB.row('SELECT COUNT(*) c FROM projects').c, 2);
  });

  test('a real app refuses a demo-origin backup; the demo sandbox accepts either', async () => {
    const demoSource = await freshDb({ search: '?demo=1' });
    seedFixture(demoSource.DB);
    const demoBackup = await demoSource.DB.buildBackup();
    assert.equal(demoBackup.demo, true, 'a demo tab must mark its own backups demo:true');

    // inspectBackupCandidate itself never refuses on demo-origin alone — that decision belongs
    // to the caller (doRestore in app.js), same as the package brief: "the sandbox may accept
    // either". This test asserts the marker survives the round trip so that caller can act on it.
    const realTarget = await freshDb();
    const preview = await realTarget.DB.inspectBackupCandidate(demoBackup);
    assert.equal(preview.demo, true);
  });
});
