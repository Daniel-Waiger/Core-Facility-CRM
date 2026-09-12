/* cancellation.test.js — js/app.js's bookingHasStarted() and cancelBooking()'s retained/waived
 * decision table, run for real (see helpers/app-harness.js).
 *
 * cancelBooking's non-admin branches only call UI.confirmModal (never build/query DOM by hand —
 * see js/app.js:3452-3510), so the harness's confirmModal stand-in is enough to run the REAL
 * function end-to-end and assert on what it actually wrote via DB.setBookingCancelled. The one
 * branch this file does NOT exercise is admin+started+total>0, which opens chooseCancelBilling — a
 * small modal that wires `m.querySelector('[data-act="…"]').onclick` BY HAND (js/app.js:3424-3439),
 * genuinely DOM-bound in a way the harness's confirmModal swap-out can't reach. That gap is called
 * out explicitly below, per the task's "test the pure decision parts; document what remains
 * untested" instruction.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/app-harness');
const { seedFixture } = require('./helpers/sqlite');

describe('bookingHasStarted', () => {
  test('a future date has not started', async () => {
    const app = await freshApp();
    assert.equal(app.internals.bookingHasStarted({ date: app.UI.todayPlusDays(5), start_time: '09:00' }), false);
  });

  test('a past date has started', async () => {
    const app = await freshApp();
    assert.equal(app.internals.bookingHasStarted({ date: '2000-01-01', start_time: '09:00' }), true);
  });

  test('a blank date is treated as not started (there is no time to compare against)', async () => {
    const app = await freshApp();
    assert.equal(app.internals.bookingHasStarted({ date: '', start_time: '09:00' }), false);
    assert.equal(app.internals.bookingHasStarted({ date: null, start_time: '09:00' }), false);
  });

  test('a blank start time defaults to 00:00 on the given date', async () => {
    const app = await freshApp();
    assert.equal(app.internals.bookingHasStarted({ date: '2000-01-01', start_time: '' }), true, 'a past date with no time defaults to 00:00, which is also past');
    assert.equal(app.internals.bookingHasStarted({ date: app.UI.todayPlusDays(5), start_time: '' }), false, 'a future date with no time defaults to 00:00 on that future day, still not started');
  });
});

describe('cancelBooking: the retained/waived decision table (non-admin branches)', () => {
  function makeBookableMeeting(app, { date, startTime, totalCost }) {
    const { alice, liveProject } = seedFixture(app.DB);
    app.DB.run(
      "INSERT INTO meetings (project_id, title, date, start_time, end_time, attendees, total_cost) VALUES (?, 'Session', ?, ?, '23:59', 'Alice', ?)",
      [liveProject, date, startTime, totalCost]
    );
    const id = app.DB.row('SELECT last_insert_rowid() as id').id;
    // A real meeting_people row, not just the denormalized attendees string — countBookingRefs
    // (CLAUDE.md: "the database is relational, but display strings are denormalized alongside
    // it") looks at the join table, so without this the booking has zero refs and cancelBooking
    // deletes it outright instead of cancelling it (see the dedicated test for that path below).
    app.DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [id, alice]);
    return id;
  }

  test('BEFORE the start time, with the default Settings rules: charge is dropped (retained=0)', async () => {
    const app = await freshApp({ confirm: true }); // simulates clicking "Cancel Booking" in the confirm dialog
    const id = makeBookableMeeting(app, { date: app.UI.todayPlusDays(5), startTime: '09:00', totalCost: 100 });

    await app.internals.cancelBooking(id);

    const m = app.DB.row('SELECT is_cancelled, billing_retained FROM meetings WHERE id=?', [id]);
    assert.equal(m.is_cancelled, 1);
    assert.equal(m.billing_retained, 0, 'CLAUDE.md: cancelling before the start time means nothing was held, so the charge is dropped');
  });

  test('AFTER the start time, with the default Settings rules: charge stands (retained=1)', async () => {
    const app = await freshApp({ confirm: true });
    const id = makeBookableMeeting(app, { date: '2000-01-01', startTime: '09:00', totalCost: 100 });

    await app.internals.cancelBooking(id);

    const m = app.DB.row('SELECT is_cancelled, billing_retained FROM meetings WHERE id=?', [id]);
    assert.equal(m.is_cancelled, 1);
    assert.equal(m.billing_retained, 1, 'CLAUDE.md: cancelling after the start time means the slot was held, so the charge stands');
  });

  test('a zero-cost booking is never "retained" even after its start time (nothing to keep)', async () => {
    const app = await freshApp({ confirm: true });
    const id = makeBookableMeeting(app, { date: '2000-01-01', startTime: '09:00', totalCost: 0 });

    await app.internals.cancelBooking(id);

    const m = app.DB.row('SELECT is_cancelled, billing_retained FROM meetings WHERE id=?', [id]);
    assert.equal(m.is_cancelled, 1);
    assert.equal(m.billing_retained, 0);
  });

  test('declining the confirm dialog ("Keep Booking") leaves the booking untouched', async () => {
    const app = await freshApp({ confirm: false }); // simulates clicking "Keep Booking" / dismissing
    const id = makeBookableMeeting(app, { date: '2000-01-01', startTime: '09:00', totalCost: 100 });

    await app.internals.cancelBooking(id);

    const m = app.DB.row('SELECT is_cancelled, billing_retained FROM meetings WHERE id=?', [id]);
    assert.equal(m.is_cancelled, 0, 'declining the confirmation must not cancel the booking');
    assert.equal(m.billing_retained, 0);
  });

  test('Settings → Cancellation Billing Rules: cancel_before_start_charge=1 keeps the charge even before start', async () => {
    const app = await freshApp({ confirm: true });
    app.DB.run("INSERT OR REPLACE INTO app_config (key, value) VALUES ('cancel_before_start_charge', '1')");
    const id = makeBookableMeeting(app, { date: app.UI.todayPlusDays(5), startTime: '09:00', totalCost: 100 });

    await app.internals.cancelBooking(id);

    const m = app.DB.row('SELECT billing_retained FROM meetings WHERE id=?', [id]);
    assert.equal(m.billing_retained, 1, 'a facility that configures "charge even before start" must have that honored, not just the hard-coded default');
  });

  test('Settings → Cancellation Billing Rules: cancel_after_start_charge=0 drops the charge even after start', async () => {
    const app = await freshApp({ confirm: true });
    app.DB.run("INSERT OR REPLACE INTO app_config (key, value) VALUES ('cancel_after_start_charge', '0')");
    const id = makeBookableMeeting(app, { date: '2000-01-01', startTime: '09:00', totalCost: 100 });

    await app.internals.cancelBooking(id);

    const m = app.DB.row('SELECT billing_retained FROM meetings WHERE id=?', [id]);
    assert.equal(m.billing_retained, 0, 'a facility that configures "drop the charge even after start" must have that honored');
  });

  test('a booking with no attendees/lines/cost is deleted outright rather than cancelled (countBookingRefs.any === false)', async () => {
    const app = await freshApp({ confirm: true });
    const { liveProject } = seedFixture(app.DB);
    app.DB.run("INSERT INTO meetings (project_id, title, date) VALUES (?, 'Just a note', '2026-01-05')", [liveProject]);
    const id = app.DB.row('SELECT last_insert_rowid() as id').id;

    await app.internals.cancelBooking(id);

    assert.equal(app.DB.row('SELECT COUNT(*) c FROM meetings WHERE id=?', [id]).c, 0, 'an empty note-only booking must be hard-deleted, not cancelled');
  });

  test('cancelling an already-cancelled booking reinstates it instead (cancelBooking\'s own dispatch to reinstateBooking)', async () => {
    const app = await freshApp({ confirm: true });
    const id = makeBookableMeeting(app, { date: app.UI.todayPlusDays(5), startTime: '09:00', totalCost: 100 });
    app.DB.setBookingCancelled(id, true, false);

    await app.internals.cancelBooking(id);

    const m = app.DB.row('SELECT is_cancelled FROM meetings WHERE id=?', [id]);
    assert.equal(m.is_cancelled, 0, 'calling cancelBooking on an already-cancelled booking must reinstate it, per its own is_cancelled check');
  });

  test('NOT COVERED by this file (documented gap, per the task\'s instruction): Admin Mode + an ' +
    'already-started booking with cost > 0 opens chooseCancelBilling, a 3-way modal that wires each ' +
    'button\'s onclick BY HAND via m.querySelector(\'[data-act="…"]\') (js/app.js:3424-3439) rather ' +
    'than through UI.confirmModal — this harness\'s confirmModal stand-in cannot reach that branch, ' +
    'and building a real DOM to reach it was judged out of proportion to this test package\'s scope. ' +
    'The retained/waived RULE that branch ultimately writes (DB.setBookingCancelled(id, true, choice ' +
    '=== "keep")) is the same DB call already asserted on above.', () => {
    assert.ok(true);
  });
});
