/* aggregation.test.js — js/reports.js's aggregation functions must agree with the booking modal,
 * per CLAUDE.md's "Reports: aggregation lives in one place, screen and export both read it".
 *
 * js/reports.js exposes its compute* functions on `global.Reports` specifically so js/exports.js
 * builds its XLSX sheets from the same aggregation the screen renders — so this file tests the
 * aggregation functions directly, which is testing both callers at once.
 *
 * Loading order: reports.js only touches `global.DB`/`global.UI` at load time (assigning
 * `esc = UI.esc`, `ic = UI.icon`) and only reaches for `global.Views`/`global.App` inside function
 * bodies that this file never calls (the HTML `render()` path, and `setRange`'s `App.refresh()`) —
 * verified by loading ['consts','db','ui','reports'] with no Views/App stub and no load-time
 * error. So no DOM stubbing gaps to report here.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, REPO } = require('./helpers/load-module');
const { seedFixture } = require('./helpers/sqlite');

async function freshApp() {
  const app = loadApp(['consts', 'db', 'ui', 'reports']);
  globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
  await app.DB.boot();
  return app;
}

describe('aggregation: occupancy excludes ALL cancelled bookings, regardless of billing_retained', () => {
  test('computeInstrumentRows drops hours/bookings for both a retained and a waived cancellation', async () => {
    const { DB, Reports } = await freshApp();
    const { scopeA, liveProject } = seedFixture(DB);

    // One active booking (2h) as a baseline, plus two more identical bookings that get cancelled
    // one retained, one waived — CLAUDE.md: "a cancellation frees the slot, so the instrument was
    // never held", full stop, independent of whether the charge was kept.
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, total_cost) VALUES (?, 'Active', '2026-02-01','09:00','11:00', 100)", [liveProject]);
    const activeId = DB.row('SELECT last_insert_rowid() as id').id;
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id, line_cost) VALUES (?,?,100)', [activeId, scopeA]);

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, total_cost) VALUES (?, 'CancelledRetained', '2026-02-02','09:00','11:00', 100)", [liveProject]);
    const retainedId = DB.row('SELECT last_insert_rowid() as id').id;
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id, line_cost) VALUES (?,?,100)', [retainedId, scopeA]);
    DB.setBookingCancelled(retainedId, true, true);

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, total_cost) VALUES (?, 'CancelledWaived', '2026-02-03','09:00','11:00', 100)", [liveProject]);
    const waivedId = DB.row('SELECT last_insert_rowid() as id').id;
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id, line_cost) VALUES (?,?,100)', [waivedId, scopeA]);
    DB.setBookingCancelled(waivedId, true, false);

    const { rows } = Reports.computeInstrumentRows('2026-02-01', '2026-02-28');
    const scopeARow = rows.find((r) => r.id === scopeA);
    assert.ok(scopeARow, 'Scope A should have at least the one active booking');
    assert.equal(scopeARow.bookings, 1, 'only the active booking should count toward occupancy — both cancellations must be excluded');
    assert.equal(scopeARow.hours, 2, 'hours must reflect only the one active 2h booking, not 6h across all three');
  });
});

describe('aggregation: money follows the Project Costs rule (counts unless cancelled AND waived)', () => {
  test('computeInstrumentRows revenue includes a cancelled-but-retained booking and excludes a cancelled-and-waived one', async () => {
    const { DB, Reports } = await freshApp();
    const { scopeA, liveProject } = seedFixture(DB);

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, total_cost) VALUES (?, 'Retained', '2026-03-01','09:00','10:00', 200)", [liveProject]);
    const retainedId = DB.row('SELECT last_insert_rowid() as id').id;
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id, line_cost) VALUES (?,?,200)', [retainedId, scopeA]);
    DB.setBookingCancelled(retainedId, true, true); // charge stands

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, total_cost) VALUES (?, 'Waived', '2026-03-02','09:00','10:00', 300)", [liveProject]);
    const waivedId = DB.row('SELECT last_insert_rowid() as id').id;
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id, line_cost) VALUES (?,?,300)', [waivedId, scopeA]);
    DB.setBookingCancelled(waivedId, true, false); // charge waived

    const { rows } = Reports.computeInstrumentRows('2026-03-01', '2026-03-31');
    const scopeARow = rows.find((r) => r.id === scopeA);
    assert.ok(scopeARow);
    // Revenue should be exactly the retained booking's 200, not 500 (both) and not 0 (neither) —
    // this is the "cancelled-but-CHARGED booking still contributes money" split reports.js's own
    // header comment calls out as intentional.
    assert.equal(scopeARow.revenue, 200, 'revenue must include the retained cancellation and exclude the waived one');
    // And per the occupancy test above, neither should contribute occupied hours/bookings.
    assert.equal(scopeARow.bookings, 0);
    assert.equal(scopeARow.hours, 0);
  });
});

describe('aggregation: meeting_staff blank start_time/end_time means the WHOLE booking window, not zero', () => {
  test('computeStaffRows reports the meeting\'s real hours for a blank staff window, not ~0', async () => {
    const { DB, Reports } = await freshApp();
    const { sam, liveProject } = seedFixture(DB);

    // A 3-hour booking; the staff line carries NO start/end of its own (blank strings, the
    // schema default) — this must be read as "worked the whole 3-hour window", not summed as 0.
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Session', '2026-04-01','09:00','12:00')", [liveProject]);
    const meetingId = DB.row('SELECT last_insert_rowid() as id').id;
    DB.run("INSERT INTO meeting_staff (meeting_id, person_id, start_time, end_time) VALUES (?,?,'','')", [meetingId, sam]);

    const { rows } = Reports.computeStaffRows('2026-04-01', '2026-04-30');
    const samRow = rows.find((r) => r.id === sam);
    assert.ok(samRow, 'Sam should show up with staff time in range');
    assert.equal(samRow.rawHours, 3, 'a blank meeting_staff window must fall back to the full 3-hour booking window, not 0');
  });
});

describe('aggregation: billed hours apply the same 1-hour floor as the booking modal (UI.billableStaffHours)', () => {
  test('computeStaffRows\' billHours equal UI.billableStaffHours applied to the raw hours, for a short booking', async () => {
    const { DB, UI, Reports } = await freshApp();
    const { sam, liveProject } = seedFixture(DB);

    // A 10-minute booking: raw hours = 1/6, but the 1-hour floor means it must BILL as 1 whole hour.
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Quick', '2026-05-01','09:00','09:10')", [liveProject]);
    const meetingId = DB.row('SELECT last_insert_rowid() as id').id;
    DB.run("INSERT INTO meeting_staff (meeting_id, person_id, start_time, end_time) VALUES (?,?,'09:00','09:10')", [meetingId, sam]);

    const { rows } = Reports.computeStaffRows('2026-05-01', '2026-05-31');
    const samRow = rows.find((r) => r.id === sam);
    assert.ok(samRow);
    const rawHours = UI.hoursBetween('09:00', '09:10');
    assert.equal(samRow.rawHours, rawHours);
    // This is the "one place" rule made executable: reports.js must call the exact same
    // UI.billableStaffHours the booking modal's cost calculator uses, not a second copy of the
    // 1-hour-floor logic — so this asserts the report's number equals that function's output,
    // not merely equals 1 (which a coincidentally-different formula could also produce).
    assert.equal(samRow.billHours, UI.billableStaffHours(rawHours));
    assert.equal(samRow.billHours, 1, 'a 10-minute booking must bill as a full 1 hour, per the floor');
  });
});

describe('aggregation: meetings.project_id is nullable — grouping by project must not silently drop project-less bookings', () => {
  test('computeProjectRows accounts for a booking with no project under a "Facility-wide" label', async () => {
    const { DB, Reports } = await freshApp();
    seedFixture(DB);

    // project_id explicitly NULL/omitted — a facility-wide booking not tied to any project.
    DB.run("INSERT INTO meetings (title, date, start_time, end_time, total_cost) VALUES ('Walk-in', '2026-06-01','09:00','10:00', 50)");
    const meetingId = DB.row('SELECT last_insert_rowid() as id').id;
    assert.equal(DB.row('SELECT project_id FROM meetings WHERE id=?', [meetingId]).project_id, null, 'sanity check: project_id really is null');

    const { projects } = Reports.computeProjectRows('2026-06-01', '2026-06-30');
    const facilityRow = projects.find((p) => p.key === 'facility');
    assert.ok(facilityRow, 'a LEFT JOIN + "Facility-wide" bucket must be present, or this project-less booking would silently vanish');
    assert.equal(facilityRow.label, 'Facility-wide');
    assert.equal(facilityRow.bookings, 1);
    assert.equal(facilityRow.hours, 1);
    assert.equal(facilityRow.cost, 50);
  });
});

describe('aggregation: retired people / archived projects DO appear in reports', () => {
  test('computeStaffRows still reports a retired staff member\'s time — that is the point of keeping history', async () => {
    const { DB, Reports } = await freshApp();
    const { sam, liveProject } = seedFixture(DB);

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Session', '2026-07-01','09:00','11:00')", [liveProject]);
    const meetingId = DB.row('SELECT last_insert_rowid() as id').id;
    DB.run("INSERT INTO meeting_staff (meeting_id, person_id, start_time, end_time) VALUES (?,?,'09:00','11:00')", [meetingId, sam]);

    // Retire Sam AFTER the booking was made, same as real usage (someone leaves the facility, but
    // the work they already did is still part of the facility's history).
    DB.setRetired('people', sam, true);

    const { rows } = Reports.computeStaffRows('2026-07-01', '2026-07-31');
    const samRow = rows.find((r) => r.id === sam);
    assert.ok(samRow, 'a retired staff member must still show up in the report, not be filtered out');
    assert.equal(samRow.retired, true, 'the row should be flagged retired so the screen can label it, per UI.retiredName');
    assert.equal(samRow.rawHours, 2);
  });

  test('computeProjectRows still reports an archived project\'s bookings', async () => {
    const { DB, Reports } = await freshApp();
    const { archivedProject } = seedFixture(DB);

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, total_cost) VALUES (?, 'Old session', '2026-08-01','09:00','10:00', 75)", [archivedProject]);

    const { projects } = Reports.computeProjectRows('2026-08-01', '2026-08-31');
    const row = projects.find((p) => p.key === String(archivedProject));
    assert.ok(row, 'an archived project must still appear in Reports — that is the entire point of archiving instead of deleting');
    assert.equal(row.bookings, 1);
    assert.equal(row.cost, 75);
  });
});
