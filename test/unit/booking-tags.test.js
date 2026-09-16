/* booking-tags.test.js — issue #39: free-text booking tags (`meetings.tags`) and the booking
 * category rename/remove admin actions.
 *
 * Covers:
 *   (1) a fresh SCHEMA-built DB already has meetings.tags, AND the migrate() block's own ALTER
 *       statement (extracted verbatim from between the '#39' fences in js/db.js, never
 *       reimplemented) really does add the column to a raw sql.js table that lacks it.
 *   (2) UI.parseTags / UI.joinTags normalization (trim, dedupe, drop blanks).
 *   (3) Reports.computeBookingTagRows: a 2-tag booking counts once under each tag, both a
 *       retained and a waived cancellation are excluded, an out-of-range booking is excluded,
 *       untaggedBookings is counted, and hours use UI.hoursBetween (09:00-11:00 = 2).
 *   (4) 'bookingtags' is the last custom-report entity, and its Tag column is required.
 *   (5) exports: the per-project Meetings sheet, the facility-wide Meetings sheet, and the
 *       facility-wide Bookings & Costs sheet all carry a Tags column with the stored string, and
 *       exportReportsXlsx's 'Booking Tags' sheet agrees with Reports.computeBookingTagRows for
 *       the same range — read back via XLSX.utils.sheet_to_json, never the JS array literal.
 *   (6) the demo seed (loadApp with '?demo=1') leaves >= 4 tagged bookings, and booking #1 keeps
 *       landing on 490 / 546.25 / 589.95 (the regression figure db.js's own seed comment names).
 *   (7) DB.renameBookingCategory rewrites meetings.category and refuses a protected name;
 *       DB.removeBookingCategory refuses a category that still has bookings.
 *
 * Same helpers/style as aggregation.test.js and exports.test.js: real IIFE modules evaluated
 * against the DOM stub, a real in-memory sql.js database via helpers/sqlite.js, and (for the
 * export tests) a real SheetJS workbook read back with XLSX.utils.sheet_to_json.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, REPO } = require('./helpers/load-module');
const { freshDb, seedFixture } = require('./helpers/sqlite');

function lastId(DB) { return DB.row('SELECT last_insert_rowid() as id').id; }

async function freshApp(modules) {
  const app = loadApp(modules);
  globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
  await app.DB.boot();
  return app;
}

function sheetRows(XLSX, wb, name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
}

/* Pulls the exact ALTER statement out of the migrate() block's own '#39' fence, rather than
   retyping it — a copy here could quietly drift from what db.js actually runs and this test would
   stop meaning anything. js/db.js has TWO '#39'-fenced blocks (this one, in migrate(); a second,
   unrelated one inside seedSampleData() that writes demo tag VALUES) — the migrate() one is
   identified by containing an ALTER TABLE, not by position. */
function extractMigrateAlterSql() {
  const src = fs.readFileSync(path.join(REPO, 'js', 'db.js'), 'utf8');
  const fenceRe = /\/\/ --- #39 begin ---([\s\S]*?)\/\/ --- #39 end ---/g;
  let block = null;
  let m;
  while ((m = fenceRe.exec(src))) {
    if (/ALTER TABLE/.test(m[1])) { block = m[1]; break; }
  }
  assert.ok(block, "expected a '#39'-fenced block in js/db.js containing an ALTER TABLE statement");
  const sqlMatch = block.match(/db\.exec\(\s*"([^"]*)"\s*\)/);
  assert.ok(sqlMatch, "expected the fenced block to call db.exec(\"...\") with the ALTER statement");
  return sqlMatch[1];
}

describe('#39 (1): meetings.tags exists on a fresh SCHEMA DB, and migrate()\'s own ALTER adds it to a table that lacks it', () => {
  test('a freshly booted DB (built straight from SCHEMA, migrate() never runs) already has meetings.tags', async () => {
    const { DB } = await freshDb();
    const cols = DB.rows('PRAGMA table_info(meetings)').map((c) => c.name);
    assert.ok(cols.includes('tags'), 'a brand-new database should get meetings.tags straight from the SCHEMA string');
  });

  test('the migrate() block\'s own ALTER statement, run verbatim against a raw sql.js table lacking the column, adds it', async () => {
    const alterSql = extractMigrateAlterSql();
    assert.match(alterSql, /ALTER TABLE meetings ADD COLUMN tags/, 'sanity check on what was actually extracted from the fence');

    const initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
    const SQL = await initSqlJs();
    const raw = new SQL.Database();
    raw.exec('CREATE TABLE meetings (id INTEGER PRIMARY KEY, title TEXT)');
    let before = raw.exec('PRAGMA table_info(meetings)')[0].values.map((r) => r[1]);
    assert.ok(!before.includes('tags'), 'the raw table must NOT have tags before the migration runs, or this test proves nothing');

    raw.exec(alterSql); // the real statement, extracted, not retyped

    const after = raw.exec('PRAGMA table_info(meetings)')[0].values.map((r) => r[1]);
    assert.ok(after.includes('tags'), 'migrate()\'s own ALTER statement must add meetings.tags to a table that lacked it');
  });
});

describe('#39 (2): UI.parseTags / UI.joinTags normalization', () => {
  test('parseTags trims whitespace, drops blanks, and dedupes by exact match (first occurrence wins, case preserved)', async () => {
    const app = await freshApp(['consts', 'ui']);
    const { UI } = app;
    assert.deepEqual(UI.parseTags(' STED ,Fiji,, Fiji ,STED'), ['STED', 'Fiji'],
      'trims each entry, drops empty entries, and keeps only the first occurrence of an exact duplicate');
    assert.deepEqual(UI.parseTags(''), []);
    assert.deepEqual(UI.parseTags(null), []);
    assert.deepEqual(UI.parseTags('STED'), ['STED'], 'a single tag with no comma is still one entry');
    // Case is exact-match, not case-insensitive: "sted" and "STED" are different tags.
    assert.deepEqual(UI.parseTags('STED, sted'), ['STED', 'sted'], 'dedup is exact-match, so differently-cased tags are NOT collapsed');
  });

  test('joinTags turns an array back into a single comma-space-joined, deduped string', async () => {
    const app = await freshApp(['consts', 'ui']);
    const { UI } = app;
    assert.equal(UI.joinTags(['STED', 'Fiji']), 'STED, Fiji');
    assert.equal(UI.joinTags(['STED', ' Fiji ', 'STED']), 'STED, Fiji', 'joinTags round-trips through parseTags, so it also trims and dedupes');
    assert.equal(UI.joinTags([]), '');
    assert.equal(UI.joinTags(undefined), '');
  });
});

async function freshReportsApp() {
  return freshApp(['consts', 'db', 'ui', 'reports']);
}

describe('#39 (3): Reports.computeBookingTagRows', () => {
  test('a 2-tag booking counts once under EACH tag; both a retained and a waived cancellation are excluded; an out-of-range booking is excluded; untagged is counted separately; hours use UI.hoursBetween', async () => {
    const { DB, UI, Reports } = await freshReportsApp();
    const { scopeA, liveProject } = seedFixture(DB);

    // In range, tagged with TWO tags, not cancelled — the case that must count once under EACH tag.
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, tags) VALUES (?, 'Two-Tag Session', '2026-06-01','09:00','11:00', 'STED, Fiji')", [liveProject]);

    // In range, no tags at all — must be counted as untagged, not silently dropped.
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, tags) VALUES (?, 'Untagged Session', '2026-06-02','10:00','11:00', '')", [liveProject]);

    // In range, tagged 'STED', cancelled and RETAINED — must still be excluded (occupancy rule 1
    // excludes ALL cancelled bookings, independent of billing_retained).
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, tags) VALUES (?, 'Cancelled Retained', '2026-06-03','09:00','11:00', 'STED')", [liveProject]);
    const retainedId = lastId(DB);
    DB.setBookingCancelled(retainedId, true, true);

    // In range, tagged 'Fiji', cancelled and WAIVED — must also be excluded.
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, tags) VALUES (?, 'Cancelled Waived', '2026-06-04','09:00','11:00', 'Fiji')", [liveProject]);
    const waivedId = lastId(DB);
    DB.setBookingCancelled(waivedId, true, false);

    // Out of range entirely, tagged 'STED' — must never appear in a [2026-06-01, 2026-06-30] pull.
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, tags) VALUES (?, 'Out Of Range', '2026-05-01','09:00','11:00', 'STED')", [liveProject]);

    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [retainedId, scopeA]); // touch the instrument join so the fixture is realistic; irrelevant to tag counting

    const { rows, taggedBookings, untaggedBookings } = Reports.computeBookingTagRows('2026-06-01', '2026-06-30');

    const sted = rows.find((r) => r.tag === 'STED');
    const fiji = rows.find((r) => r.tag === 'Fiji');
    assert.ok(sted, 'STED must appear as a row');
    assert.ok(fiji, 'Fiji must appear as a row');

    const expectedHours = UI.hoursBetween('09:00', '11:00');
    assert.equal(expectedHours, 2, 'sanity check on the fixture\'s own window');

    assert.equal(sted.bookings, 1, 'STED must count only the one in-range, non-cancelled two-tag booking — not the cancelled-retained or out-of-range STED bookings');
    assert.equal(sted.hours, expectedHours, 'STED hours must come from UI.hoursBetween(09:00,11:00) = 2');
    assert.equal(fiji.bookings, 1, 'Fiji must count only the same two-tag booking, once — not the cancelled-waived Fiji booking');
    assert.equal(fiji.hours, expectedHours);

    assert.equal(taggedBookings, 1, 'exactly one non-cancelled, in-range, tagged booking exists (the two-tag one) — it is counted once here even though it appears in two tag rows');
    assert.equal(untaggedBookings, 1, 'the untagged session must be counted, not dropped');
  });
});

describe('#39 (4): bookingtags is the last custom-report entity, and its Tag column is required', () => {
  test('CUSTOM_REPORT_ENTITY_ORDER ends with bookingtags, and getCustomReportColumns marks Tag required', async () => {
    const { Reports } = await freshReportsApp();
    const entities = Reports.getCustomReportEntities();
    assert.ok(entities.length > 0);
    assert.equal(entities[entities.length - 1].key, 'bookingtags', 'bookingtags must be the LAST entity in the custom-report entity list');
    assert.equal(entities[entities.length - 1].label, 'Booking Tags');

    const columns = Reports.getCustomReportColumns('bookingtags');
    const tagCol = columns.find((c) => c.key === 'tag');
    assert.ok(tagCol, 'bookingtags must expose a "tag" column');
    assert.equal(tagCol.required, true, 'the Tag column must be required, so it can never be unchecked into an ambiguous sheet of double-countable rows');
  });
});

async function freshExportsApp() {
  const app = loadApp(['consts', 'db', 'ui', 'views', 'reports', 'exports']);
  globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
  await app.DB.boot();

  globalThis.DOMParser = function () { this.parseFromString = () => ({ body: { childNodes: [] } }); };
  globalThis.Blob = globalThis.Blob || class { constructor(parts, opts) { this.parts = parts; this.opts = opts; } };
  globalThis.URL.createObjectURL = () => 'blob:test';
  globalThis.URL.revokeObjectURL = () => {};
  app.UI.sanitizeHtml = (h) => h || '';
  app.UI.toast = () => {};

  const XLSX = require(path.join(REPO, 'libs', 'xlsx.full.min.js'));
  globalThis.XLSX = XLSX;

  const captured = [];
  const realWrite = XLSX.write;
  XLSX.write = function (wb, opts) { captured.push(wb); return realWrite.call(XLSX, wb, opts); };

  return { ...app, XLSX, captured };
}

describe('#39 (5): exports carry a Tags column with the stored string', () => {
  test('per-project Meetings sheet, facility-wide Meetings sheet, and facility-wide Bookings & Costs sheet all carry Tags', async () => {
    const app = await freshExportsApp();
    const { DB, Exports, XLSX } = app;
    const { liveProject } = seedFixture(DB);

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, tags, total_cost) VALUES (?, 'Tagged Session', '2026-07-01','09:00','10:00', 'STED, Napari', 100)", [liveProject]);

    // Per-project XLSX.
    Exports.exportXlsx(liveProject);
    const wbProj = app.captured[app.captured.length - 1];
    const mtRowsProj = sheetRows(XLSX, wbProj, 'Meetings');
    const projHeader = mtRowsProj[0];
    assert.equal(projHeader[4], 'Tags', 'per-project Meetings sheet column 5 (index 4) must be labeled Tags');
    const projRow = mtRowsProj.find((r) => r[0] === 'Tagged Session');
    assert.ok(projRow, 'the tagged booking must appear on the per-project Meetings sheet');
    assert.equal(projRow[4], 'STED, Napari', 'per-project Meetings sheet must carry the stored tags string');

    // Facility-wide XLSX.
    Exports.buildAllXlsxBlob();
    const wbAll = app.captured[app.captured.length - 1];

    const mtRowsAll = sheetRows(XLSX, wbAll, 'Meetings');
    const allHeader = mtRowsAll[0];
    assert.equal(allHeader[5], 'Tags', 'facility-wide Meetings sheet column 6 (index 5) must be labeled Tags');
    const allRow = mtRowsAll.find((r) => r[2] === 'Tagged Session');
    assert.ok(allRow, 'the tagged booking must appear on the facility-wide Meetings sheet');
    assert.equal(allRow[5], 'STED, Napari', 'facility-wide Meetings sheet must carry the stored tags string');

    const bcRows = sheetRows(XLSX, wbAll, 'Bookings & Costs');
    const bcHeader = bcRows[0];
    assert.equal(bcHeader[3], 'Tags', 'Bookings & Costs sheet column 4 (index 3) must be labeled Tags');
    const bcRow = bcRows.find((r) => r[2] === 'Tagged Session');
    assert.ok(bcRow, 'the tagged booking must appear on the Bookings & Costs sheet');
    assert.equal(bcRow[3], 'STED, Napari', 'Bookings & Costs sheet must carry the stored tags string');
  });

  test('exportReportsXlsx\'s "Booking Tags" sheet agrees with Reports.computeBookingTagRows for the same range', async () => {
    const app = await freshExportsApp();
    const { DB, Reports, Exports, XLSX } = app;
    const { liveProject } = seedFixture(DB);

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, tags) VALUES (?, 'A', '2026-08-01','09:00','11:00', 'STED, Fiji')", [liveProject]);
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, tags) VALUES (?, 'B', '2026-08-02','13:00','14:00', 'STED')", [liveProject]);
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, tags) VALUES (?, 'C', '2026-08-03','09:00','10:00', '')", [liveProject]);

    const from = '2026-08-01', to = '2026-08-31';
    const expected = Reports.computeBookingTagRows(from, to).rows;
    assert.ok(expected.length >= 2, 'sanity check: the fixture above should produce at least two tag rows');

    Exports.exportReportsXlsx(from, to);
    const wb = app.captured[app.captured.length - 1];
    const tagRows = sheetRows(XLSX, wb, 'Booking Tags');
    assert.ok(wb.SheetNames.includes('Booking Tags'), 'exportReportsXlsx must produce a "Booking Tags" sheet');
    assert.deepEqual(tagRows[0], ['Tag', 'Bookings', 'Booked Hours']);

    const actual = tagRows.slice(1).map((r) => ({ tag: r[0], bookings: r[1], hours: r[2] }));
    assert.equal(actual.length, expected.length, 'the "Booking Tags" sheet must have exactly as many rows as Reports.computeBookingTagRows returned');
    expected.forEach((row) => {
      const found = actual.find((r) => r.tag === row.tag);
      assert.ok(found, `expected a "Booking Tags" sheet row for tag "${row.tag}"`);
      assert.equal(found.bookings, row.bookings, `Bookings for tag "${row.tag}" must match computeBookingTagRows`);
      assert.equal(found.hours, Math.round(row.hours * 100) / 100, `Booked Hours for tag "${row.tag}" must match computeBookingTagRows (rounded the same way exports.js rounds it)`);
    });
  });
});

describe('#39 (6): the demo seed leaves tagged bookings, and booking #1\'s regression figures still hold', () => {
  test('DB.seedSampleData() (via ?demo=1) leaves >= 4 tagged bookings, and booking #1 lands on 490 / 546.25 / 589.95', async () => {
    const app = loadApp(['consts', 'db', 'ui'], { search: '?demo=1' });
    globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
    const { DB } = app;
    await DB.boot();

    const ok = await DB.seedSampleData();
    assert.equal(ok, true, 'seedSampleData should run under ?demo=1');

    const taggedCount = DB.row("SELECT COUNT(*) c FROM meetings WHERE TRIM(COALESCE(tags,'')) != ''").c;
    assert.ok(taggedCount >= 4, `expected at least 4 tagged bookings in the demo seed, got ${taggedCount}`);

    // db.js's own seed comment names this booking as "the regression check" for these three
    // figures — pinned here so a future change to seedBooking/computeBookingBOM/tier math that
    // silently shifts them gets caught.
    const kickoff = DB.row("SELECT subtotal, total_before_tax, total_cost FROM meetings WHERE title = 'Project Kickoff & Laser Alignment Review'");
    assert.ok(kickoff, 'the seed\'s regression-check booking must exist');
    assert.equal(kickoff.subtotal, 490);
    assert.equal(kickoff.total_before_tax, 546.25);
    assert.equal(kickoff.total_cost, 589.95);
  });
});

describe('#39 (7): DB.renameBookingCategory / DB.removeBookingCategory', () => {
  test('renameBookingCategory rewrites meetings.category for every booking under the old name, and refuses a protected name', async () => {
    const { DB } = await freshDb();
    const { liveProject } = seedFixture(DB);

    DB.run("INSERT INTO meetings (project_id, title, date, category) VALUES (?, 'Session 1', '2026-01-05', 'demo-cat')", [liveProject]);
    DB.run("INSERT INTO meetings (project_id, title, date, category) VALUES (?, 'Session 2', '2026-01-06', 'demo-cat')", [liveProject]);
    DB.run("INSERT INTO meetings (project_id, title, date, category) VALUES (?, 'Session 3', '2026-01-07', 'other-cat')", [liveProject]);

    const result = DB.renameBookingCategory('demo-cat', 'renamed-cat');
    assert.ok(result, 'renameBookingCategory should succeed for a plain, non-protected category');
    assert.equal(result.bookings, 2, 'it should report the number of bookings it rewrote');

    const renamedCount = DB.row("SELECT COUNT(*) c FROM meetings WHERE category='renamed-cat'").c;
    assert.equal(renamedCount, 2, 'both demo-cat bookings must now read renamed-cat');
    const oldCount = DB.row("SELECT COUNT(*) c FROM meetings WHERE category='demo-cat'").c;
    assert.equal(oldCount, 0, 'no booking should still carry the old category name');
    const untouchedCount = DB.row("SELECT COUNT(*) c FROM meetings WHERE category='other-cat'").c;
    assert.equal(untouchedCount, 1, 'a booking under a different category must be left alone');

    // Protected categories ('consult', 'training', 'assisted session') can never be renamed —
    // policy rows and follow_assisted linkage reference them by literal name.
    assert.equal(DB.renameBookingCategory('consult', 'anything-else'), null, 'renameBookingCategory must refuse a protected category name');
    assert.equal(DB.renameBookingCategory('training', 'anything-else'), null, 'renameBookingCategory must refuse a protected category name');
    assert.equal(DB.renameBookingCategory('assisted session', 'anything-else'), null, 'renameBookingCategory must refuse a protected category name');
  });

  test('removeBookingCategory refuses a category that still has bookings, and succeeds once it has none', async () => {
    const { DB } = await freshDb();
    const { liveProject } = seedFixture(DB);

    DB.run("INSERT INTO meetings (project_id, title, date, category) VALUES (?, 'Session 1', '2026-01-05', 'to-remove')", [liveProject]);
    const meetingId = lastId(DB);

    assert.equal(DB.removeBookingCategory('to-remove'), false, 'removeBookingCategory must refuse a category that still has bookings');
    assert.equal(DB.row("SELECT COUNT(*) c FROM meetings WHERE category='to-remove'").c, 1, 'the booking must be untouched by the refused removal');

    DB.run('DELETE FROM meetings WHERE id=?', [meetingId]);
    assert.equal(DB.removeBookingCategory('to-remove'), true, 'once no booking references the category, removal must succeed');

    // Protected categories can never be removed either.
    assert.equal(DB.removeBookingCategory('consult'), false, 'removeBookingCategory must refuse a protected category name');
  });
});
