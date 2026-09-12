/* funnel-output-date.test.js — item 11 (adversarial review of PR #44): the funnel's
 * activeToOutput median compares each project's first-booking date against its first-output
 * date. An undated research output falls back to DB.outputEffDate's `date(created_at)`, which is
 * a UTC calendar day, while every other date this median touches is a LOCAL calendar day — the
 * same class of bug issue #14 fixed for a plain date column, just against a timestamp fallback
 * this time. Must run under TZ=Asia/Jerusalem (see CLAUDE.md/package test scripts) to be
 * meaningful: at UTC the two days coincide and this test would pass either way.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, REPO } = require('./helpers/load-module');

async function freshApp() {
  const app = loadApp(['consts', 'db', 'ui', 'reports']);
  globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
  await app.DB.boot();
  return app;
}

describe('funnel: first_output_date fallback for an undated output uses the LOCAL calendar day', () => {
  test('an undated output logged at 22:30Z is not filed a day early against its project\'s first booking', async () => {
    assert.equal(process.env.TZ, 'Asia/Jerusalem', 'this test must run under TZ=Asia/Jerusalem to be meaningful');

    const { DB, Reports } = await freshApp();
    DB.run("INSERT INTO people (name, type) VALUES ('PI One','PI')");
    DB.run("INSERT INTO projects (title, code, status, pi_id) VALUES ('Funnel Project','FP-1','Active',1)");
    const pid = DB.row("SELECT id FROM projects WHERE code='FP-1'").id;

    // First (only) booking lands on 2026-06-11.
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Booking','2026-06-11','09:00','10:00')", [pid]);

    // Undated output (blank `date`) logged at 2026-06-10 23:30:00 UTC — at Asia/Jerusalem (UTC+3)
    // that instant is 2026-06-11 02:30 LOCAL, i.e. the SAME local calendar day as the booking
    // above, not the day before. `created_at` is written verbatim here (a real save always goes
    // through datetime('now'), but a fixed literal makes the boundary deterministic to test).
    DB.run("INSERT INTO project_outputs (project_id, type, title, date, created_at) VALUES (?, 'dataset', 'Undated Output', '', '2026-06-10 23:30:00')", [pid]);

    const rows = Reports.computeFunnelRows('', '');
    const { activeToOutput } = rows.medians;

    // Before the fix: outputEffDate's SQL fallback truncates to the UTC day (2026-06-10), which
    // is BEFORE the booking (2026-06-11) — a negative delta, excluded from the median and counted
    // in excludedNegative instead. After the fix, the output's local day is 2026-06-11, matching
    // the booking, for a delta of 0 — included, not excluded.
    assert.equal(activeToOutput.excludedNegative, 0, 'the undated output must not be filed a UTC day early and excluded as "predates the booking"');
    assert.equal(activeToOutput.sampleSize, 1, 'the one project with a booking and an output must contribute one sample to the median');
    assert.equal(activeToOutput.days, 0, 'first booking and first output land on the same LOCAL calendar day, so the delta must be 0, not -1');
  });

  // Item 5 (second review of PR #44): computeFunnelRows' stage-6 "Research Output" COUNT came
  // from loadOutputsInRange, which filtered and ordered directly in SQL on DB.outputEffDate —
  // whose blank-date fallback is `date(created_at)`, a UTC calendar day. An undated output logged
  // late in the local day (but still on the SAME UTC day) fell OUT of a same-day range query
  // entirely — not just mis-ordered, actually dropped from the count. Fixed by loading unbounded
  // and filtering/ordering in JS via the same utcTimestampToLocalDay the funnel median already
  // used (previous test above); this exercises the RANGE FILTER path, not the median.
  test('an undated output logged late in the local day is counted when the report range is that LOCAL day, not the UTC day', async () => {
    assert.equal(process.env.TZ, 'Asia/Jerusalem', 'this test must run under TZ=Asia/Jerusalem to be meaningful');

    const { DB, Reports } = await freshApp();
    DB.run("INSERT INTO people (name, type) VALUES ('PI Two','PI')");
    DB.run("INSERT INTO projects (title, code, status, pi_id) VALUES ('Range Project','FP-2','Active',1)");
    const pid = DB.row("SELECT id FROM projects WHERE code='FP-2'").id;

    // 2026-06-10 22:30:00 UTC is 2026-06-11 01:30 local (Asia/Jerusalem, UTC+3) — LOCAL day is
    // 2026-06-11, UTC day is 2026-06-10. SQL's `date(created_at)` would file it under 2026-06-10.
    DB.run("INSERT INTO project_outputs (project_id, type, title, date, created_at) VALUES (?, 'dataset', 'Late Output', '', '2026-06-10 22:30:00')", [pid]);

    const inLocalDay = Reports.computeFunnelRows('2026-06-11', '2026-06-11');
    const outputStageIn = inLocalDay.stages.find((s) => s.key === 'output');
    assert.equal(outputStageIn.count, 1, 'a report range of the LOCAL day the output actually landed on must count it — the old SQL-side UTC fallback would have filtered it out');

    const inUtcDayOnly = Reports.computeFunnelRows('2026-06-10', '2026-06-10');
    const outputStageOut = inUtcDayOnly.stages.find((s) => s.key === 'output');
    assert.equal(outputStageOut.count, 0, 'a report range of the UTC day (not the local day the output landed on) must NOT count it');
  });
});
