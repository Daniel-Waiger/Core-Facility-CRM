/* recurring.test.js — js/app.js's computeRecurringDates(), run for real (see helpers/app-harness.js).
 *
 * Builds weekly/every-N-weeks occurrence dates as plain local 'YYYY-MM-DD' strings via
 * getFullYear/getMonth/getDate + setDate (never `new Date('YYYY-MM-DD')`, which parses as UTC —
 * see CLAUDE.md's "Dates are local calendar days"), so this file's own dates deliberately straddle
 * a month boundary and a real DST transition, run under TZ=Asia/Jerusalem (see test/README.md),
 * to prove no UTC drift sneaks in as CLAUDE.md's date rule requires.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/app-harness');

describe('computeRecurringDates: weekly / every-N-weeks', () => {
  test('weekly (every 1 week) from a start date through an "until" date', async () => {
    const app = await freshApp();
    const dates = app.internals.computeRecurringDates('2026-01-05', 1, '2026-01-26');
    assert.deepEqual(dates, ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
  });

  test('every-N-weeks (e.g. every 2 weeks) skips the weeks in between', async () => {
    const app = await freshApp();
    const dates = app.internals.computeRecurringDates('2026-01-05', 2, '2026-02-02');
    assert.deepEqual(dates, ['2026-01-05', '2026-01-19', '2026-02-02']);
  });

  test('a blank "until" means no repeat: just the start date', async () => {
    const app = await freshApp();
    assert.deepEqual(app.internals.computeRecurringDates('2026-01-05', 1, ''), ['2026-01-05']);
    assert.deepEqual(app.internals.computeRecurringDates('2026-01-05', 1, null), ['2026-01-05']);
  });

  test('"until" before "start" produces just the start date (the next occurrence already overshoots it)', async () => {
    const app = await freshApp();
    const dates = app.internals.computeRecurringDates('2026-01-05', 1, '2026-01-01');
    assert.deepEqual(dates, ['2026-01-05'], 'bookingSave itself separately rejects this case with a toast before ever calling computeRecurringDates — this pins what the function does if called anyway');
  });

  test('a non-numeric or sub-1 "every N weeks" value is floored to 1 week, never 0 or negative', async () => {
    const app = await freshApp();
    assert.deepEqual(app.internals.computeRecurringDates('2026-01-05', 0, '2026-01-12'), ['2026-01-05', '2026-01-12']);
    assert.deepEqual(app.internals.computeRecurringDates('2026-01-05', 'not-a-number', '2026-01-12'), ['2026-01-05', '2026-01-12']);
    assert.deepEqual(app.internals.computeRecurringDates('2026-01-05', -3, '2026-01-12'), ['2026-01-05', '2026-01-12']);
  });

  test('the MAX_RECURRING_OCCURRENCES cap (52) stops generating further dates rather than running away', async () => {
    const app = await freshApp();
    // 200 weeks out, weekly — far more than the 52-occurrence cap.
    const dates = app.internals.computeRecurringDates('2026-01-05', 1, '2030-01-01');
    assert.ok(dates.length <= 53, `expected at most 53 dates (cap + the start date), got ${dates.length}`);
    // bookingSave itself checks `dates.length > MAX_RECURRING_OCCURRENCES` (53) and refuses to
    // save when the cap is exceeded — pin that the function keeps producing one past the cap so
    // that check can actually fire, rather than silently truncating to exactly 52 and hiding the
    // overflow from the caller.
    assert.equal(dates.length, 53);
  });

  test('crosses a month boundary correctly (setDate-based advance, not string arithmetic)', async () => {
    const app = await freshApp();
    const dates = app.internals.computeRecurringDates('2026-01-22', 1, '2026-02-12');
    assert.deepEqual(dates, ['2026-01-22', '2026-01-29', '2026-02-05', '2026-02-12']);
  });

  test('crosses a year boundary correctly', async () => {
    const app = await freshApp();
    const dates = app.internals.computeRecurringDates('2025-12-18', 1, '2026-01-08');
    assert.deepEqual(dates, ['2025-12-18', '2025-12-25', '2026-01-01', '2026-01-08']);
  });

  test('every produced date is a plain local YYYY-MM-DD string with no UTC drift across Israel\'s DST transitions', async () => {
    const app = await freshApp();
    // Israel (Asia/Jerusalem, the timezone this whole suite is required to run under — see
    // test/README.md) moves clocks FORWARD in late March and BACK in late October. Both
    // transitions are exactly the kind of instant where a `new Date(...).toISOString()`-based
    // approach (CLAUDE.md's forbidden pattern) would silently shift a day at a UTC+ offset.
    const springForward = app.internals.computeRecurringDates('2026-03-13', 1, '2026-04-03');
    assert.deepEqual(springForward, ['2026-03-13', '2026-03-20', '2026-03-27', '2026-04-03'],
      'weekly dates straddling Israel\'s March DST transition must land on the intended calendar days with no drift');

    const fallBack = app.internals.computeRecurringDates('2026-10-16', 1, '2026-11-06');
    assert.deepEqual(fallBack, ['2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06'],
      'weekly dates straddling Israel\'s October DST transition must land on the intended calendar days with no drift');

    // Every result must be a bare 'YYYY-MM-DD' string (no time-of-day, no 'Z', no offset).
    for (const d of [...springForward, ...fallBack]) {
      assert.match(d, /^\d{4}-\d{2}-\d{2}$/, `"${d}" is not a plain local calendar day string`);
    }
  });
});
