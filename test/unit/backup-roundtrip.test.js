/* backup-roundtrip.test.js — DB.buildBackup()/DB.restoreBackup() round-trip, INCLUDING uploads.
 * schema.test.js already exercises restoreBackup for migration idempotency; this file is the
 * dedicated happy-path round-trip the review report's "untested invariants" list asked for
 * (restoreBackup validation itself is P1's concurrent territory — this file deliberately does not
 * touch malformed/foreign backup images, only the round trip of a real one).
 *
 * FileReader doesn't exist in Node; DB.buildBackup()'s blobToBase64 needs one to turn an uploaded
 * Blob into the base64 the backup JSON carries. Blob and atob/btoa are real Node globals already
 * (verified) — this supplies only the missing piece, via Blob's own real arrayBuffer().
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, seedFixture } = require('./helpers/sqlite');

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
        if (this.onload) this.onload();
      }).catch((e) => { this.error = e; if (this.onerror) this.onerror(); });
    }
  };
}

describe('buildBackup/restoreBackup round trip', () => {
  test('restoring a freshly built backup reproduces every row of a non-trivial database', async () => {
    const { DB } = await freshDb();
    seedFixture(DB);
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, attendees, total_cost) VALUES (1, 'Session', '2026-05-01', '09:00', '10:00', 'Alice', 150)");

    const before = {
      people: DB.rows('SELECT * FROM people ORDER BY id'),
      projects: DB.rows('SELECT * FROM projects ORDER BY id'),
      instruments: DB.rows('SELECT * FROM instruments ORDER BY id'),
      meetings: DB.rows('SELECT * FROM meetings ORDER BY id'),
    };

    const backup = await DB.buildBackup();
    assert.equal(backup.kind, 'core-facility-backup');
    assert.ok(Array.isArray(backup.db) && backup.db.length > 0, 'the backup must carry the exported database bytes');

    await DB.restoreBackup(backup);

    const after = {
      people: DB.rows('SELECT * FROM people ORDER BY id'),
      projects: DB.rows('SELECT * FROM projects ORDER BY id'),
      instruments: DB.rows('SELECT * FROM instruments ORDER BY id'),
      meetings: DB.rows('SELECT * FROM meetings ORDER BY id'),
    };
    assert.deepEqual(after, before, 'every row of every table must read back identically after a restore');
  });

  test('an uploaded file round-trips through the backup as base64 and comes back as an equivalent Blob', async () => {
    const { DB } = await freshDb();
    const original = new Blob(['hello facility'], { type: 'text/plain' });
    await DB.saveUpload('note.txt', original);

    const backup = await DB.buildBackup();
    assert.ok(backup.uploads && backup.uploads['note.txt'], 'the backup must carry the uploaded file');
    assert.equal(backup.uploads['note.txt'].type, 'text/plain');
    assert.equal(typeof backup.uploads['note.txt'].data, 'string', 'the upload must be encoded as a base64 string, not raw binary, so the backup JSON stays plain text');

    // Restoring into the SAME DB module instance (as a real Settings → Restore Backup would) must
    // repopulate the upload store from that base64, byte-for-byte.
    await DB.restoreBackup(backup);
    const restored = await DB.getUpload('note.txt');
    assert.ok(restored, 'the upload must exist again after restore');
    const text = await restored.text();
    assert.equal(text, 'hello facility');
    assert.equal(restored.type, 'text/plain');
  });

  test('restoring with no uploads at all leaves the upload store empty (no crash on an absent uploads key)', async () => {
    const { DB } = await freshDb();
    seedFixture(DB);
    const backup = await DB.buildBackup();
    assert.deepEqual(backup.uploads, {});

    await DB.restoreBackup(backup);
    assert.equal(await DB.getUpload('anything'), undefined);
  });
});
