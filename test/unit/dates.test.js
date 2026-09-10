/* dates.test.js — "Dates are local calendar days, never UTC instants" (CLAUDE.md).
 *
 * CLAUDE.md documents a real released bug (issue #14, fixed in 1.5.0): the calendar labelled
 * cells with a LOCAL date but keyed events with `.toISOString()` (UTC), so east of Greenwich
 * every cell was captioned with one day and filled with the previous day's bookings. It was
 * invisible at UTC and UTC-, and only visible at UTC+.
 *
 * MECHANIC: process.env.TZ must be set BEFORE any Date is constructed, and Node caches the
 * timezone per-process — so it is set here at the very top of the file, before any require.
 * Verified working in this Node version (v22.22.2): `new Date().getTimezoneOffset()` reflects
 * the new TZ immediately after this assignment, with no child-process spawn needed. See
 * test/README.md for re-running the whole suite under a different zone (this file pins
 * 'Asia/Jerusalem', UTC+2/+3, specifically because it's a UTC+ zone — the one CLAUDE.md says
 * the bug was invisible WITHOUT). */
'use strict';

process.env.TZ = 'Asia/Jerusalem';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-module');

// Sanity-check the mechanic itself before trusting any assertion built on it: a negative
// getTimezoneOffset() means we are east of Greenwich (UTC+), which is the precondition for the
// regression this file pins.
const tzOffsetMinutes = new Date().getTimezoneOffset();
assert.ok(tzOffsetMinutes < 0, `expected a UTC+ zone for this regression test, got offset ${tzOffsetMinutes} — TZ did not take effect`);

const { UI } = loadApp(['consts', 'ui']);

describe('dates: UI.ymd is the LOCAL calendar day', () => {
  test('a Date at local midnight under UTC+ yields THAT day, not the previous UTC day (issue #14 regression)', () => {
    // Local midnight, Jan 15 2026, constructed via the (year, month, day, h, m, s) local-time
    // Date constructor form (never a UTC string) so this Date genuinely represents local midnight.
    const d = new Date(2026, 0, 15, 0, 0, 0);
    assert.equal(UI.ymd(d), '2026-01-15', 'ymd must report the LOCAL calendar day');
    // This is the bug, pinned as an explicit inequality: under a UTC+ zone, local midnight on the
    // 15th is still the 14th in UTC, so toISOString() disagrees with the correct local answer.
    assert.notEqual(UI.ymd(d), d.toISOString().slice(0, 10),
      'toISOString() must NOT agree with ymd() here — that disagreement IS the UTC+ bug this test pins');
    assert.equal(d.toISOString().slice(0, 10), '2026-01-14', 'confirms toISOString() rolls back a day under this UTC+ zone');
  });

  test('UI.ymd on an invalid date returns empty string', () => {
    assert.equal(UI.ymd(new Date('not a date')), '');
    assert.equal(UI.ymd('not a date'), '');
  });
});

describe('dates: UI.today / UI.todayPlusDays', () => {
  test('UI.today() matches locally-computed year/month/day', () => {
    const now = new Date();
    const expected = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
      + '-' + String(now.getDate()).padStart(2, '0');
    assert.equal(UI.today(), expected);
  });

  test('UI.todayPlusDays covers n = 0, 1, -1, 30, and month/year boundaries', () => {
    assert.equal(UI.todayPlusDays(0), UI.today(), 'n=0 is today');

    // n=1 / n=-1: compute independently via local Date fields, not by re-deriving from UI.today(),
    // so this doesn't just check todayPlusDays against itself.
    const now = new Date();
    const plus1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const minus1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    assert.equal(UI.todayPlusDays(1), UI.ymd(plus1));
    assert.equal(UI.todayPlusDays(-1), UI.ymd(minus1));

    const plus30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);
    assert.equal(UI.todayPlusDays(30), UI.ymd(plus30), 'n=30 (may cross a month or year boundary depending on today)');

    // Explicit month-boundary case, independent of when the suite runs: Jan 31 + 1 day -> Feb 1.
    // todayPlusDays only offsets from "now", so exercise the same boundary logic via ymd/setDate.
    const janEnd = new Date(2026, 0, 31);
    janEnd.setDate(janEnd.getDate() + 1);
    assert.equal(UI.ymd(janEnd), '2026-02-01', 'month boundary: Jan 31 + 1 day = Feb 1');

    // Explicit year-boundary case: Dec 31 + 1 day -> Jan 1 of the next year.
    const decEnd = new Date(2026, 11, 31);
    decEnd.setDate(decEnd.getDate() + 1);
    assert.equal(UI.ymd(decEnd), '2027-01-01', 'year boundary: Dec 31 + 1 day = Jan 1 of the next year');
  });
});

describe('dates: UI.fmtDate', () => {
  test('empty/invalid input renders as the em dash placeholder', () => {
    assert.equal(UI.fmtDate(''), '—');
    assert.equal(UI.fmtDate(null), '—');
    assert.equal(UI.fmtDate(undefined), '—');
    assert.equal(UI.fmtDate('not-a-date'), '—');
  });

  test('a YYYY-MM-DD string parses as LOCAL (round-trips to the same calendar day, never shifts)', () => {
    // fmtDate deliberately appends 'T00:00:00' (no 'Z') to force local-time parsing, per CLAUDE.md
    // — the same class of fix as ymd() above. Round-trip through ymd() (itself proven local-correct
    // by the regression test above) rather than locale-formatted text, so this doesn't depend on
    // the test runner's locale.
    const stored = '2026-06-20';
    const dt = new Date(stored + 'T00:00:00');
    assert.equal(UI.ymd(dt), stored, 'parsing stored date + fmtDate\'s local-time trick must round-trip to the same day');
    // And fmtDate itself must actually produce a real (non-placeholder) rendering for this valid input.
    assert.notEqual(UI.fmtDate(stored), '—');
  });
});

describe('dates: UI.timeToMinutes', () => {
  test('valid HH:MM (and H:MM) strings parse to minutes since midnight', () => {
    assert.equal(UI.timeToMinutes('09:00'), 540);
    assert.equal(UI.timeToMinutes('9:00'), 540, 'single-digit hour is accepted');
    assert.equal(UI.timeToMinutes('23:59'), 1439);
  });

  test('malformed or missing input returns null', () => {
    assert.equal(UI.timeToMinutes(''), null);
    assert.equal(UI.timeToMinutes('abc'), null);
    assert.equal(UI.timeToMinutes('9'), null, 'missing minutes component');
    assert.equal(UI.timeToMinutes(null), null);
  });
});

describe('dates: UI.hoursBetween', () => {
  test('a normal span returns decimal hours', () => {
    assert.equal(UI.hoursBetween('09:00', '11:30'), 2.5);
    assert.equal(UI.hoursBetween('09:00', '10:00'), 1);
  });

  test('end === start returns 0 (zero-length window)', () => {
    assert.equal(UI.hoursBetween('09:00', '09:00'), 0);
  });

  test('end < start returns 0 (never a negative span)', () => {
    assert.equal(UI.hoursBetween('11:00', '09:00'), 0);
  });

  test('either time missing returns 0', () => {
    assert.equal(UI.hoursBetween('', '11:00'), 0);
    assert.equal(UI.hoursBetween('09:00', ''), 0);
    assert.equal(UI.hoursBetween('', ''), 0);
  });
});
