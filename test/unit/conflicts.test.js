/* conflicts.test.js — js/app.js's findBookingConflicts(), run for real (see helpers/app-harness.js
 * for how it's reached — it's a private function of app.js's closure, never on `global.App`).
 *
 * Covers the review report's "untested invariants" list for this function: adjacency (end ==
 * next start is NOT a conflict), overlap IS a conflict, a cancelled booking never blocks, blank
 * times short-circuit to no conflicts, and the per-instrument constraints (min/max duration,
 * minimum gap, minimum advance notice, and the skipNotice bypass bookingEditSave/reinstateBooking
 * use for notes-only edits of history).
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/app-harness');
const { seedFixture } = require('./helpers/sqlite');

describe('findBookingConflicts: adjacency and overlap', () => {
  test('adjacent bookings (existing ends exactly when the new one starts) do NOT conflict', async () => {
    const app = await freshApp();
    const { scopeA, liveProject } = seedFixture(app.DB);
    app.DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Existing', '2026-03-10','09:00','10:00')", [liveProject]);
    app.DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES ((SELECT last_insert_rowid()), ?)', [scopeA]);

    const conflicts = app.internals.findBookingConflicts({
      date: '2026-03-10', start: '10:00', end: '11:00', instrumentIds: [scopeA], staffIds: [],
    });
    assert.deepEqual(conflicts, [], 'a booking starting exactly when the previous one ends must not be reported as a conflict');
  });

  test('an overlapping booking on the same instrument IS a conflict', async () => {
    const app = await freshApp();
    const { scopeA, liveProject } = seedFixture(app.DB);
    app.DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Existing', '2026-03-10','09:00','10:00')", [liveProject]);
    app.DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES ((SELECT last_insert_rowid()), ?)', [scopeA]);

    const conflicts = app.internals.findBookingConflicts({
      date: '2026-03-10', start: '09:30', end: '10:30', instrumentIds: [scopeA], staffIds: [],
    });
    assert.equal(conflicts.length, 1);
    assert.match(conflicts[0], /Scope A is already booked 09:00–10:00/);
  });

  test('an overlapping booking on the same staff member IS a conflict', async () => {
    const app = await freshApp();
    const { sam, liveProject } = seedFixture(app.DB);
    app.DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Existing', '2026-03-10','09:00','10:00')", [liveProject]);
    app.DB.run('INSERT INTO meeting_staff (meeting_id, person_id) VALUES ((SELECT last_insert_rowid()), ?)', [sam]);

    const conflicts = app.internals.findBookingConflicts({
      date: '2026-03-10', start: '09:30', end: '10:30', instrumentIds: [], staffIds: [sam],
    });
    assert.equal(conflicts.length, 1);
    assert.match(conflicts[0], /Sam is already booked 09:00–10:00/);
  });

  test('a CANCELLED booking never conflicts, even for the exact same slot', async () => {
    const app = await freshApp();
    const { scopeA, liveProject } = seedFixture(app.DB);
    app.DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Existing', '2026-03-10','09:00','10:00')", [liveProject]);
    const existingId = app.DB.row('SELECT last_insert_rowid() as id').id;
    app.DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [existingId, scopeA]);
    app.DB.setBookingCancelled(existingId, true, false);

    const conflicts = app.internals.findBookingConflicts({
      date: '2026-03-10', start: '09:00', end: '10:00', instrumentIds: [scopeA], staffIds: [],
    });
    assert.deepEqual(conflicts, [], 'a cancelled booking has given its slot back and must never block a new one');
  });

  test('excludeId lets a booking ignore its own existing row when checking itself (bookingEditSave\'s use)', async () => {
    const app = await freshApp();
    const { scopeA, liveProject } = seedFixture(app.DB);
    app.DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Existing', '2026-03-10','09:00','10:00')", [liveProject]);
    const existingId = app.DB.row('SELECT last_insert_rowid() as id').id;
    app.DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [existingId, scopeA]);

    const conflicts = app.internals.findBookingConflicts({
      date: '2026-03-10', start: '09:00', end: '10:00', excludeId: existingId, instrumentIds: [scopeA], staffIds: [],
    });
    assert.deepEqual(conflicts, [], 'a booking must not conflict with its own stored row when editing itself');
  });

  test('blank start/end short-circuits to no conflicts (the live advisory renders nothing before either is picked)', async () => {
    const app = await freshApp();
    const { scopeA } = seedFixture(app.DB);
    assert.deepEqual(app.internals.findBookingConflicts({ date: '2026-03-10', start: '', end: '', instrumentIds: [scopeA], staffIds: [] }), []);
    assert.deepEqual(app.internals.findBookingConflicts({ date: '2026-03-10', start: '09:00', end: '', instrumentIds: [scopeA], staffIds: [] }), []);
  });

  test('an inverted or zero-length window is rejected with an explicit message, not silently accepted', async () => {
    const app = await freshApp();
    const { scopeA } = seedFixture(app.DB);
    assert.deepEqual(
      app.internals.findBookingConflicts({ date: '2026-03-10', start: '10:00', end: '09:00', instrumentIds: [scopeA], staffIds: [] }),
      ['End time must be after the start time']
    );
    assert.deepEqual(
      app.internals.findBookingConflicts({ date: '2026-03-10', start: '10:00', end: '10:00', instrumentIds: [scopeA], staffIds: [] }),
      ['End time must be after the start time']
    );
  });
});

describe('findBookingConflicts: per-instrument constraints', () => {
  test('minimum booking duration is enforced', async () => {
    const app = await freshApp();
    const { scopeA } = seedFixture(app.DB);
    app.DB.run('UPDATE instruments SET min_duration_mins=60 WHERE id=?', [scopeA]);

    const tooShort = app.internals.findBookingConflicts({ date: '2026-03-10', start: '09:00', end: '09:30', instrumentIds: [scopeA], staffIds: [] });
    assert.match(tooShort.join(';'), /minimum booking duration of 60 minutes/);

    const longEnough = app.internals.findBookingConflicts({ date: '2026-03-10', start: '09:00', end: '10:00', instrumentIds: [scopeA], staffIds: [] });
    assert.deepEqual(longEnough, []);
  });

  test('maximum booking duration is enforced', async () => {
    const app = await freshApp();
    const { scopeA } = seedFixture(app.DB);
    app.DB.run('UPDATE instruments SET max_duration_mins=60 WHERE id=?', [scopeA]);

    const tooLong = app.internals.findBookingConflicts({ date: '2026-03-10', start: '09:00', end: '11:00', instrumentIds: [scopeA], staffIds: [] });
    assert.match(tooLong.join(';'), /maximum booking duration of 60 minutes/);
  });

  test('minimum gap between bookings on the same instrument is enforced on both sides', async () => {
    const app = await freshApp();
    const { scopeA, liveProject } = seedFixture(app.DB);
    app.DB.run('UPDATE instruments SET min_gap_mins=30 WHERE id=?', [scopeA]);
    app.DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Existing', '2026-03-10','09:00','10:00')", [liveProject]);
    const existingId = app.DB.row('SELECT last_insert_rowid() as id').id;
    app.DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [existingId, scopeA]);

    // 10:10 starts only 10 minutes after the existing booking ends — inside the 30-minute gap.
    const tooClose = app.internals.findBookingConflicts({ date: '2026-03-10', start: '10:10', end: '10:40', instrumentIds: [scopeA], staffIds: [] });
    assert.match(tooClose.join(';'), /requires at least 30 minutes between bookings/);

    // 08:00–08:30 ends 30 minutes before the existing one starts — exactly at the gap, not inside it.
    const exactlyGap = app.internals.findBookingConflicts({ date: '2026-03-10', start: '08:00', end: '08:30', instrumentIds: [scopeA], staffIds: [] });
    assert.deepEqual(exactlyGap, []);

    // 10:40 starts comfortably clear of the 30-minute gap on the other side.
    const clear = app.internals.findBookingConflicts({ date: '2026-03-10', start: '10:30', end: '11:00', instrumentIds: [scopeA], staffIds: [] });
    assert.deepEqual(clear, []);
  });

  test('minimum advance notice is enforced against the real clock, and skipNotice bypasses it', async () => {
    const app = await freshApp();
    const { scopeA } = seedFixture(app.DB);
    app.DB.run('UPDATE instruments SET min_notice_hours=48 WHERE id=?', [scopeA]);

    const today = app.UI.today();
    const tooSoon = app.internals.findBookingConflicts({ date: today, start: '09:00', end: '10:00', instrumentIds: [scopeA], staffIds: [] });
    assert.match(tooSoon.join(';'), /requires at least 48 hours advance notice/);

    // The exact bypass bookingEditSave/reinstateBooking use for a notes-only edit of history —
    // must not retroactively fail the notice window it was never subject to when first saved.
    const bypassed = app.internals.findBookingConflicts({ date: today, start: '09:00', end: '10:00', instrumentIds: [scopeA], staffIds: [], skipNotice: true });
    assert.deepEqual(bypassed, []);

    const farEnoughOut = app.internals.findBookingConflicts({ date: app.UI.todayPlusDays(10), start: '09:00', end: '10:00', instrumentIds: [scopeA], staffIds: [] });
    assert.deepEqual(farEnoughOut, []);
  });

  test('zero on every constraint column means unconstrained (the fixture\'s default shape)', async () => {
    const app = await freshApp();
    const { scopeA } = seedFixture(app.DB);
    const conflicts = app.internals.findBookingConflicts({ date: '2026-03-10', start: '00:01', end: '00:05', instrumentIds: [scopeA], staffIds: [] });
    assert.deepEqual(conflicts, []);
  });
});
