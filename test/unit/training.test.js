/* training.test.js — issue #47 (Person Profile + Instrument Training): every rule CLAUDE.md and
 * the #47 work itself establishes, proven under a UTC+ timezone (this project's date bugs are
 * invisible at UTC — see docs/cma-lessons.md and CLAUDE.md's "Dates are local calendar days").
 *
 * Covers, in order: the migration (people.mobile/campus + person_instrument_training), the
 * ref-counters (a training row counts for the trainee/instrument, never for a bare trainer_id),
 * retirePerson/retireInstrument's zero-ref delete vs. retire branches with training rows in the
 * mix, the ON DELETE CASCADE this table relies on (mirrors schema.test.js's technique),
 * clearAllData(), DB.trainingActiveOn's date-boundary rule, Reports.computeStewardshipRows'
 * trainedUsers column, Exports.exportActivityCertificate and exportReportsXlsx's Stewardship
 * sheet, three Views screens, removeTraining via the app-harness internals, the demo seed, and a
 * source lint of the dispatcher wiring and the db.js migration fences.
 *
 * Every DB fixture here is either the shared seedFixture() or hand-built with plain INSERTs
 * against the REAL shipped schema (never a hand-rolled table of its own — see helpers/sqlite.js's
 * own comment on why that would prove nothing).
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { freshDb, seedFixture } = require('./helpers/sqlite');
const { freshApp } = require('./helpers/app-harness');
const { loadApp, readSource, REPO } = require('./helpers/load-module');

function lastId(DB) { return DB.row('SELECT last_insert_rowid() as id').id; }

/* A local, exports-flavoured boot — same technique and same minimal stubs as exports.test.js
 * (DOMParser/Blob/URL stand-ins, UI.sanitizeHtml bypassed, toast silenced, XLSX.write captured so
 * a test can read the REAL workbook SheetJS produced rather than the JS array literal that built
 * it). Kept local rather than imported because exports.test.js does not export its own helper. */
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
function sheetRows(XLSX, wb, name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
}

/* Boots consts/db/ui/views only — enough for Views.* to run, without pulling in reports/exports
 * for tests that don't need them. */
async function freshViewsApp() {
  const app = loadApp(['consts', 'db', 'ui', 'views']);
  globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
  await app.DB.boot();
  return app;
}

describe('#47 migration: people gains mobile/campus, person_instrument_training exists', () => {
  test('a fresh database has the new people columns and the training table with the expected columns', async () => {
    const { DB } = await freshDb();
    const peopleCols = DB.rows('PRAGMA table_info(people)').map((c) => c.name);
    assert.ok(peopleCols.includes('mobile'), 'people.mobile must exist');
    assert.ok(peopleCols.includes('campus'), 'people.campus must exist');

    const trainingCols = DB.rows('PRAGMA table_info(person_instrument_training)').map((c) => c.name).sort();
    assert.deepEqual(
      trainingCols,
      ['created_at', 'expires_on', 'id', 'instrument_id', 'level', 'note', 'person_id', 'trained_on', 'trainer_id'].sort(),
      'person_instrument_training must have exactly the columns the schema declares'
    );
  });
});

describe('#47 ref-counters: a training row counts for the trainee and the instrument, never for a bare trainer_id', () => {
  test('countPersonRefs/countInstrumentRefs count the row; the trainer alone has zero refs from it', async () => {
    const { DB } = await freshDb();
    const { alice, sam, scopeA } = seedFixture(DB);
    DB.run(
      "INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on, trainer_id) VALUES (?,?,'User',?,?)",
      [alice, scopeA, '2026-01-01', sam]
    );

    assert.equal(DB.countPersonRefs(alice).training, 1, 'the trainee must be counted');
    assert.equal(DB.countInstrumentRefs(scopeA).training, 1, 'the trained-on instrument must be counted');
    assert.equal(DB.countPersonRefs(sam).training, 0, 'being only a trainer (trainer_id) must not count as a ref for that person');
  });
});

describe('#47 retirePerson: training rows gate retire vs. real delete, and trainer_id is nulled on delete', () => {
  test('a person with a training row (as trainee) is retired, and the row is kept', async () => {
    const app = await freshApp({ confirm: true });
    const { DB, internals } = app;
    const { alice, scopeA } = seedFixture(DB);
    DB.run("INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on) VALUES (?,?,'User',?)", [alice, scopeA, '2026-01-01']);
    const trainingId = lastId(DB);
    assert.ok(DB.countPersonRefs(alice).total > 0, 'sanity check: the training row must make this person non-zero-ref');

    await internals.retirePerson(alice);

    assert.equal(DB.row('SELECT is_retired FROM people WHERE id=?', [alice]).is_retired, 1, 'a referenced person must be retired, not deleted');
    assert.equal(DB.row('SELECT COUNT(*) c FROM person_instrument_training WHERE id=?', [trainingId]).c, 1, 'the training row must be kept by a retire, never touched');
  });

  test('a zero-ref person is deleted outright, and a training row where they were only the TRAINER has trainer_id nulled', async () => {
    const app = await freshApp({ confirm: true });
    const { DB, internals } = app;
    DB.run("INSERT INTO people (name, type, is_staff) VALUES ('Trainer Only', 'Facility Staff', 1)");
    const trainerId = lastId(DB);
    DB.run("INSERT INTO people (name, type) VALUES ('Trainee', 'PhD')");
    const traineeId = lastId(DB);
    DB.run("INSERT INTO instruments (name, status) VALUES ('Rig', 'Available')");
    const instId = lastId(DB);
    DB.run(
      "INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on, trainer_id) VALUES (?,?,'User',?,?)",
      [traineeId, instId, '2026-01-01', trainerId]
    );
    const trainingId = lastId(DB);
    assert.equal(DB.countPersonRefs(trainerId).total, 0, 'sanity check: being only a trainer must not count as a ref');

    await internals.retirePerson(trainerId);

    assert.equal(DB.row('SELECT COUNT(*) c FROM people WHERE id=?', [trainerId]).c, 0, 'a zero-ref trainer-only person must be REALLY deleted');
    assert.equal(DB.row('SELECT COUNT(*) c FROM person_instrument_training WHERE id=?', [trainingId]).c, 1, 'the training record itself (trainee\'s history) must survive the trainer\'s deletion');
    assert.equal(DB.row('SELECT trainer_id FROM person_instrument_training WHERE id=?', [trainingId]).trainer_id, null, 'trainer_id must be nulled, not left dangling, when the trainer is deleted');
  });
});

describe('#47 retireInstrument: a trained-on instrument retires, never deletes', () => {
  test('an instrument with a training row is retired, and the training row survives', async () => {
    const app = await freshApp({ confirm: true });
    const { DB, internals } = app;
    const { alice } = seedFixture(DB);
    DB.run("INSERT INTO instruments (name, status) VALUES ('Trained Rig', 'Available')");
    const instId = lastId(DB);
    DB.run("INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on) VALUES (?,?,'User',?)", [alice, instId, '2026-01-01']);
    assert.ok(DB.countInstrumentRefs(instId).total > 0, 'sanity check: the training row must make this instrument non-zero-ref');

    await internals.retireInstrument(instId);

    assert.equal(DB.row('SELECT is_retired FROM instruments WHERE id=?', [instId]).is_retired, 1, 'a trained-on instrument must be retired, not deleted');
    assert.equal(DB.row('SELECT COUNT(*) c FROM person_instrument_training WHERE instrument_id=?', [instId]).c, 1, 'the training row must survive a retire');
  });
});

describe('#47 cascade: ON DELETE CASCADE removes training rows (mirrors schema.test.js\'s technique)', () => {
  test('deleting a person removes their person_instrument_training rows (as trainee)', async () => {
    const { DB } = await freshDb();
    const { alice, scopeA } = seedFixture(DB);
    DB.run("INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on) VALUES (?,?,'User',?)", [alice, scopeA, '2026-01-01']);
    DB.currentBytes(); // reasserts PRAGMA foreign_keys=ON, same timing real autosave exercises

    DB.run('DELETE FROM people WHERE id=?', [alice]);

    assert.equal(DB.row('SELECT COUNT(*) c FROM person_instrument_training WHERE person_id=?', [alice]).c, 0,
      'person_instrument_training must cascade off the deleted trainee');
  });

  test('deleting an instrument removes its person_instrument_training rows', async () => {
    const { DB } = await freshDb();
    const { alice, scopeA } = seedFixture(DB);
    DB.run("INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on) VALUES (?,?,'User',?)", [alice, scopeA, '2026-01-01']);
    DB.currentBytes();

    DB.run('DELETE FROM instruments WHERE id=?', [scopeA]);

    assert.equal(DB.row('SELECT COUNT(*) c FROM person_instrument_training WHERE instrument_id=?', [scopeA]).c, 0,
      'person_instrument_training must cascade off the deleted instrument');
  });
});

describe('#47 clearAllData: empties person_instrument_training', () => {
  test('after clearAllData(), no training rows remain', async () => {
    const { DB } = await freshDb();
    const { alice, scopeA } = seedFixture(DB);
    DB.run("INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on) VALUES (?,?,'User',?)", [alice, scopeA, '2026-01-01']);
    assert.equal(DB.row('SELECT COUNT(*) c FROM person_instrument_training').c, 1);

    await DB.clearAllData();

    assert.equal(DB.row('SELECT COUNT(*) c FROM person_instrument_training').c, 0);
  });
});

describe('#47 DB.trainingActiveOn: the date-boundary rule', () => {
  test('valid exactly on expires_on, expired the day after; a blank expiry never expires; a blank trained_on has no start restriction', async () => {
    const { DB } = await freshDb();
    assert.equal(DB.trainingActiveOn({ trained_on: '2026-01-01', expires_on: '2026-06-01' }, '2026-06-01'), true, 'valid ON the expiry date itself');
    assert.equal(DB.trainingActiveOn({ trained_on: '2026-01-01', expires_on: '2026-06-01' }, '2026-06-02'), false, 'expired the day after expires_on');
    assert.equal(DB.trainingActiveOn({ trained_on: '2026-01-01', expires_on: '' }, '2099-01-01'), true, 'a blank expires_on never expires');
    assert.equal(DB.trainingActiveOn({ trained_on: '', expires_on: '2026-06-01' }, '2020-01-01'), true, 'a blank trained_on carries no start restriction');
    assert.equal(DB.trainingActiveOn({ trained_on: null, expires_on: '2026-06-01' }, '2020-01-01'), true, 'a NULL trained_on carries no start restriction, same as a blank one');
  });
});

describe('#47 DB.trainingStatusOn: valid/expired/pending, built on trainingActiveOn', () => {
  test('a future trained_on reads "pending", not "expired"; a past expires_on still reads "expired"; an active record reads "valid"', async () => {
    const { DB } = await freshDb();
    assert.equal(DB.trainingStatusOn({ trained_on: '2026-01-01', expires_on: '2026-06-01' }, '2026-03-01'), 'valid');
    assert.equal(DB.trainingStatusOn({ trained_on: '2026-01-01', expires_on: '2026-06-01' }, '2026-06-02'), 'expired', 'past expires_on is expired, not pending');
    assert.equal(DB.trainingStatusOn({ trained_on: '2099-01-01', expires_on: '' }, '2026-01-01'), 'pending', 'trained_on in the future, not yet reached, must not read as "expired"');
  });
});

describe('#47 Reports.computeStewardshipRows: trainedUsers', () => {
  test('counts distinct PEOPLE, not training records, and is evaluated as of the range END, not "today"', async () => {
    const app = await freshApp();
    const { DB, Reports } = app;
    const { alice, scopeA, liveProject } = seedFixture(DB);

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Session', '2026-01-05','09:00','10:00')", [liveProject]);
    const meetingId = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id, line_cost) VALUES (?,?,50)', [meetingId, scopeA]);

    // Two training records for the SAME person on the SAME instrument -> must count as ONE user.
    // Both expire on 2026-01-25 — well AFTER the range end used below (2026-01-20) but well
    // BEFORE the real system clock this suite runs under (2026+), so this also discriminates
    // "evaluated as of the range end" from a bug that used UI.today() instead: using today() here
    // would wrongly call these expired and report 0.
    DB.run("INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on, expires_on) VALUES (?,?,'User','2025-01-01','2026-01-25')", [alice, scopeA]);
    DB.run("INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on, expires_on) VALUES (?,?,'Super User','2025-06-01','2026-01-25')", [alice, scopeA]);

    const result = Reports.computeStewardshipRows('2026-01-01', '2026-01-20');
    const row = result.groups.flatMap((g) => g.rows).find((r) => r.id === scopeA);
    assert.ok(row, 'the instrument must appear in the scorecard (it has booking activity in range)');
    assert.equal(row.trainedUsers, 1, 'two training records for the same person on the same instrument must count as ONE trained user, and must be evaluated as of the range end (2026-01-20), not "today"');
  });

  test('a blank "to" evaluates as of UI.today(): an expired-yesterday record does not count, a no-expiry record does', async () => {
    const app = await freshApp();
    const { DB, UI, Reports } = app;
    const { scopeA, liveProject } = seedFixture(DB);

    DB.run("INSERT INTO people (name, type) VALUES ('Expired Yesterday', 'PhD')");
    const expiredPersonId = lastId(DB);
    DB.run("INSERT INTO people (name, type) VALUES ('No Expiry', 'PhD')");
    const openPersonId = lastId(DB);
    DB.run(
      "INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on, expires_on) VALUES (?,?,'User','2020-01-01',?)",
      [expiredPersonId, scopeA, UI.todayPlusDays(-1)]
    );
    DB.run(
      "INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on, expires_on) VALUES (?,?,'User','2020-01-01','')",
      [openPersonId, scopeA]
    );

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Session', '2026-01-05','09:00','10:00')", [liveProject]);
    const meetingId = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id, line_cost) VALUES (?,?,50)', [meetingId, scopeA]);

    const result = Reports.computeStewardshipRows('', ''); // unbounded range -> a blank `to`
    const row = result.groups.flatMap((g) => g.rows).find((r) => r.id === scopeA);
    assert.ok(row);
    assert.equal(row.trainedUsers, 1, 'a blank "to" must use UI.today(): the expired-yesterday record must not count, only the no-expiry one');
  });
});

describe('#47 Exports.exportActivityCertificate', () => {
  test('sheet names, range filtering, "Cancelled"/"Facility-wide" text, and an "Expired" training status', async () => {
    const app = await freshExportsApp();
    const { DB, Exports, XLSX } = app;
    const { alice, sam, scopeA, liveProject } = seedFixture(DB);

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, is_cancelled, tags) VALUES (?, 'In Range Cancelled', '2026-01-10','09:00','10:00', 1, 'urgent, follow-up')", [liveProject]);
    const m1 = lastId(DB);
    DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [m1, alice]);

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (NULL, 'Facility Sync', '2026-01-15','11:00','12:00')");
    const m2 = lastId(DB);
    DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [m2, alice]);

    // Outside the exported range — must not appear on the Bookings sheet.
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Out Of Range', '2026-03-01','09:00','10:00')", [liveProject]);
    const m3 = lastId(DB);
    DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [m3, alice]);

    // Alice ran this one as facility staff (meeting_staff) without being an attendee — it must
    // still appear, and being both attendee and staff on m2 must not produce a second row.
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Staffed Only', '2026-01-20','09:00','10:00')", [liveProject]);
    const m4 = lastId(DB);
    DB.run("INSERT INTO meeting_staff (meeting_id, person_id, start_time, end_time, line_cost) VALUES (?,?,'','',0)", [m4, alice]);
    DB.run("INSERT INTO meeting_staff (meeting_id, person_id, start_time, end_time, line_cost) VALUES (?,?,'','',0)", [m2, alice]);

    // Expired as of the exported range's end date (2026-01-31).
    DB.run(
      "INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on, trainer_id, expires_on) VALUES (?,?,'User','2025-01-01',?,?)",
      [alice, scopeA, sam, '2026-01-05']
    );

    Exports.exportActivityCertificate(alice, '2026-01-01', '2026-01-31');
    const wb = app.captured[app.captured.length - 1];
    assert.ok(wb, 'exportActivityCertificate must produce a workbook');
    assert.deepEqual(wb.SheetNames, ['Details', 'Training', 'Bookings', 'Projects']);

    const bookingRows = sheetRows(XLSX, wb, 'Bookings');
    const titles = bookingRows.slice(1).map((r) => r[3]);
    assert.ok(titles.includes('In Range Cancelled'), 'an in-range booking must appear');
    assert.ok(titles.includes('Facility Sync'), 'a facility-wide in-range booking must appear');
    assert.ok(!titles.includes('Out Of Range'), 'a booking outside the exported range must not appear');
    assert.ok(titles.includes('Staffed Only'), 'a booking the person ran as facility staff (meeting_staff only) must appear');
    assert.equal(titles.filter((t) => t === 'Facility Sync').length, 1, 'attendee + staff on one booking yields one row, not two');

    assert.ok(bookingRows[0].includes('Tags'), 'the Bookings sheet must carry a Tags column, like every other booking-listing export');
    const cancelledRow = bookingRows.find((r) => r[3] === 'In Range Cancelled');
    assert.equal(cancelledRow[bookingRows[0].indexOf('Tags')], 'urgent, follow-up', 'a booking\'s tags must populate the Tags column');
    assert.equal(cancelledRow[8], 'Cancelled', 'a cancelled, non-retained booking reads "Cancelled"');
    const facilityRow = bookingRows.find((r) => r[3] === 'Facility Sync');
    assert.equal(facilityRow[4], 'Facility-wide', 'a project-less booking reads "Facility-wide"');

    const trainingRows = sheetRows(XLSX, wb, 'Training');
    const trainingRow = trainingRows.find((r) => r[0] === 'Scope A');
    assert.ok(trainingRow, 'the training row must appear on the Training sheet');
    assert.equal(trainingRow[5], 'Expired', 'a training record expired by the range end must read "Expired"');
  });
});

describe('#47 Exports.exportReportsXlsx: Stewardship header and Notes wording', () => {
  test('the Stewardship sheet header includes "Trained Users", and Notes no longer disclaims the trained-user pool as unavailable', async () => {
    const app = await freshExportsApp();
    const { DB, Exports, XLSX } = app;
    seedFixture(DB);

    Exports.exportReportsXlsx('', '');
    const wb = app.captured[app.captured.length - 1];

    const stewardRows = sheetRows(XLSX, wb, 'Stewardship');
    assert.ok(stewardRows[0].includes('Trained Users'), 'the Stewardship header row must include "Trained Users"');

    const notesText = sheetRows(XLSX, wb, 'Notes').map((r) => r[0] || '').join('\n');
    assert.doesNotMatch(notesText, /trained-user pool/, 'the Notes sheet must no longer disclaim the trained-user pool as unavailable now that #47 tracks it');
  });
});

describe('#47 Views', () => {
  test('personDetail renders the name, a training level, Cancelled/Archived markers, and all four training/export data-act controls', async () => {
    const app = await freshViewsApp();
    const { DB, Views } = app;
    const { alice, scopeA, liveProject } = seedFixture(DB);

    DB.run("INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on) VALUES (?,?,'Super User','2026-01-01')", [alice, scopeA]);

    DB.run("INSERT INTO meetings (project_id, title, date, is_cancelled) VALUES (?, 'Cancelled Session', '2026-01-05', 1)", [liveProject]);
    const mId = lastId(DB);
    DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [mId, alice]);
    // Ran as facility staff only (meeting_staff, no attendee row) — must still count as her activity.
    DB.run("INSERT INTO meetings (project_id, title, date) VALUES (?, 'Staffed Session', '2026-01-06')", [liveProject]);
    DB.run("INSERT INTO meeting_staff (meeting_id, person_id, start_time, end_time, line_cost) VALUES (?,?,'','',0)", [lastId(DB), alice]);

    const html = Views.personDetail(alice);
    assert.match(html, /Alice/, 'the person\'s name must render');
    assert.match(html, /Staffed Session/, 'a booking the person ran as staff (meeting_staff only) must appear in Recent Activity');
    assert.match(html, /Super User/, 'the training level must render');
    assert.match(html, /Cancelled/, 'a cancelled booking must be marked');
    assert.match(html, /Archived/, 'Alice is PI on the fixture\'s archived project too, and that must be marked');
    assert.match(html, /data-act="training-add"/, 'the Add Training control must be wired');
    assert.match(html, /data-act="training-edit"/, 'the Edit Training control must be wired');
    assert.match(html, /data-act="training-del"/, 'the Remove Training control must be wired');
    assert.match(html, /data-act="export-activity-certificate"/, 'the Export Activity Certificate control must be wired');
  });

  test('the Instruments screen has a "Trained Users" column', async () => {
    const app = await freshViewsApp();
    seedFixture(app.DB);
    assert.match(app.Views.instruments(), /Trained Users/);
  });

  test('the Instruments screen Trained Users count includes a NULL trained_on row, matching DB.trainedUserCountsAsOf', async () => {
    const app = await freshViewsApp();
    const { DB, UI } = app;
    const { alice, scopeA } = seedFixture(DB);
    // trained_on left NULL (no start restriction) rather than '' — the inline SQL this screen
    // used to run only matched the empty-string case, silently excluding NULL rows.
    DB.run("INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on) VALUES (?,?,'User',NULL)", [alice, scopeA]);

    const expected = DB.trainedUserCountsAsOf(UI.today()).find((r) => r.instrument_id === scopeA);
    assert.equal(expected.trained_users, 1, 'sanity check: the shared rule itself must count the NULL row');

    const html = app.Views.instruments();
    assert.match(html, /<span class="badge neutral">1<\/span>/, 'the Instruments screen must render the same trained-user count as DB.trainedUserCountsAsOf');
  });

  test('the People screen rows link to the person profile via data-goto="person"', async () => {
    const app = await freshViewsApp();
    seedFixture(app.DB);
    assert.match(app.Views.people(), /data-goto="person"/);
  });
});

describe('#47 removeTraining via app.internals', () => {
  test('confirm:true deletes exactly the targeted training row', async () => {
    const app = await freshApp({ confirm: true });
    const { DB, internals } = app;
    const { alice, scopeA, prepB } = seedFixture(DB);
    DB.run("INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on) VALUES (?,?,'User','2026-01-01')", [alice, scopeA]);
    const keepId = lastId(DB);
    DB.run("INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on) VALUES (?,?,'User','2026-01-02')", [alice, prepB]);
    const targetId = lastId(DB);

    await internals.removeTraining(targetId);

    assert.equal(DB.row('SELECT COUNT(*) c FROM person_instrument_training WHERE id=?', [targetId]).c, 0, 'the targeted row must be deleted');
    assert.equal(DB.row('SELECT COUNT(*) c FROM person_instrument_training WHERE id=?', [keepId]).c, 1, 'a different training row must be untouched');
  });

  test('confirm:false leaves the training row in place', async () => {
    const app = await freshApp({ confirm: false });
    const { DB, internals } = app;
    const { alice, scopeA } = seedFixture(DB);
    DB.run("INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on) VALUES (?,?,'User','2026-01-01')", [alice, scopeA]);
    const id = lastId(DB);

    await internals.removeTraining(id);

    assert.equal(DB.row('SELECT COUNT(*) c FROM person_instrument_training WHERE id=?', [id]).c, 1, 'declining the confirmation must not delete the row');
  });
});

describe('#47 demo seed', () => {
  test('seedSampleData() loads 6 training rows (at least one already expired) and booking #1 still totals 589.95', async () => {
    const { DB, UI } = await freshDb({ search: '?demo=1' });
    const ok = await DB.seedSampleData({ force: true });
    assert.equal(ok, true);

    assert.equal(DB.row('SELECT COUNT(*) c FROM person_instrument_training').c, 6, 'the demo dataset must seed exactly 6 training rows');

    const today = UI.today();
    const expiredCount = DB.rows('SELECT * FROM person_instrument_training')
      .filter((r) => !DB.trainingActiveOn(r, today)).length;
    assert.ok(expiredCount >= 1, 'at least one seeded training record must already read as expired as of today');

    const booking1 = DB.row('SELECT total_cost FROM meetings ORDER BY id ASC LIMIT 1');
    assert.equal(booking1.total_cost, 589.95, 'the seeded regression booking #1 must still total 589.95 — #47 must not have disturbed the money regression triple');
  });
});

describe('#47 source lint', () => {
  test('js/app.js dispatches all five #47 actions between the "People CRUD" and "Project Collaborators" section markers', () => {
    const src = readSource('app');
    const start = src.indexOf('// People CRUD');
    const end = src.indexOf('// Project Collaborators');
    assert.ok(start !== -1 && end !== -1 && start < end, 'both section markers must be present, in order');
    const section = src.slice(start, end);
    ['training-add', 'training-edit', 'training-save', 'training-del', 'export-activity-certificate'].forEach((act) => {
      assert.match(section, new RegExp(`case '${act}':`), `the dispatcher case for "${act}" must live between the People CRUD and Project Collaborators markers`);
    });
  });

  test('js/db.js carries exactly two "#47 begin" fences (the migration block and the demo-seed block)', () => {
    const src = readSource('db');
    const matches = src.match(/\/\/ --- #47 begin ---/g) || [];
    assert.equal(matches.length, 2, 'exactly two #47 begin fences are expected: the migration block and the demo-seed block');
  });
});
