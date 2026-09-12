/* reports-perf.test.js — a deterministic guard for the Reports facts-bundle performance work
 * (G2-reports-perf). Wall-clock timing is not reproducible across machines/CI runners, so this
 * asserts something that IS deterministic: how many SQL statements (DB.row/DB.rows calls) a shared
 * facts bundle costs versus calling the same compute* functions independently, per CLAUDE.md's
 * "Reports: aggregation lives in one place" and the perf work's "load once per render" goal.
 *
 * Every number this test reads was already proven correct by aggregation.test.js — this file is
 * only about how many times the database gets asked for it, never about what the answer is.
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

// Wraps DB.row/DB.rows with a call counter for the duration of `fn`, then restores them —
// mirrors the red team's own perf.js reproduction technique (a DB.row/DB.rows spy), which the
// package's rules point at directly as the way to make a perf guard deterministic.
function countSqlCalls(DB, fn) {
  const origRow = DB.row, origRows = DB.rows;
  let n = 0;
  DB.row = function () { n++; return origRow.apply(this, arguments); };
  DB.rows = function () { n++; return origRows.apply(this, arguments); };
  try {
    fn();
  } finally {
    DB.row = origRow;
    DB.rows = origRows;
  }
  return n;
}

function seedBookings(DB, UI, count) {
  const { scopeA, liveProject } = seedFixture(DB);
  DB.run("INSERT INTO people (name, type, organization, is_staff, rate) VALUES ('Sam2','Facility Staff','Core',1,90)");
  const sam2 = DB.row('SELECT last_insert_rowid() as id').id;
  for (let i = 0; i < count; i++) {
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, category, total_cost) VALUES (?,?,?,?,?,?,?)",
      [liveProject, 'B' + i, '2026-0' + (1 + (i % 6)) + '-' + String(1 + (i % 27)).padStart(2, '0'), '09:00', '11:00', i % 3 === 0 ? 'consult' : 'sync', 100]);
    const mid = DB.row('SELECT last_insert_rowid() as id').id;
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id, line_cost) VALUES (?,?,100)', [mid, scopeA]);
    DB.run("INSERT INTO meeting_staff (meeting_id, person_id, start_time, end_time, line_cost) VALUES (?,?,'','',90)", [mid, sam2]);
  }
  return { scopeA, liveProject, sam2 };
}

describe('Reports facts bundle: one shared bundle costs fewer queries than independent calls', () => {
  test('render()-shaped sequence of compute* calls issues far fewer DB.row/DB.rows calls with a shared facts bundle than without one', async () => {
    const { DB, UI, Reports } = await freshApp();
    seedBookings(DB, UI, 60);
    const from = '2026-01-01', to = '2026-12-31';

    // Independent calls — each compute* loads its own rows from scratch, exactly what every card
    // used to do before this package's facts bundle existed (still true for a caller that omits
    // `facts`, which every compute* still supports — see reports.js's own comment).
    const independentCalls = countSqlCalls(DB, () => {
      Reports.computeInstrumentRows(from, to);
      Reports.computeStaffRows(from, to);
      Reports.computeStaffInstrumentMatrix(from, to);
      Reports.computeProjectRows(from, to);
      Reports.computeStewardshipRows(from, to);
      Reports.computeConsultRows(from, to);
      Reports.computeServiceEntryRows(from, to);
      Reports.computeBreadthRows(from, to);
      Reports.computeActivityMixRows(from, to);
      Reports.computeFunnelRows(from, to);
    });

    // The exact same sequence, sharing one facts bundle — this is what Reports.render() and
    // Exports.exportReportsXlsx do now.
    const sharedCalls = countSqlCalls(DB, () => {
      const facts = Reports.makeFacts(from, to);
      Reports.computeInstrumentRows(from, to, facts);
      Reports.computeStaffRows(from, to, facts);
      Reports.computeStaffInstrumentMatrix(from, to, facts);
      Reports.computeProjectRows(from, to, facts);
      Reports.computeStewardshipRows(from, to, facts);
      Reports.computeConsultRows(from, to, facts);
      Reports.computeServiceEntryRows(from, to, facts);
      Reports.computeBreadthRows(from, to, facts);
      Reports.computeActivityMixRows(from, to, facts);
      Reports.computeFunnelRows(from, to, facts);
    });

    assert.ok(independentCalls > 0, 'sanity: the independent-call sequence must actually touch the database');
    assert.ok(
      sharedCalls < independentCalls,
      `a shared facts bundle must issue fewer SQL calls than ten independent compute* calls (independent=${independentCalls}, shared=${sharedCalls})`
    );
    // Not just fewer — meaningfully fewer. Nine of these ten cards read overlapping
    // meetings/instrument-line/staff-line rows for the same (from,to); a shared bundle should cut
    // the call count by at least half, not by one or two incidental calls.
    assert.ok(
      sharedCalls <= Math.ceil(independentCalls / 2),
      `expected the shared bundle to at least halve the SQL call count (independent=${independentCalls}, shared=${sharedCalls})`
    );
  });

  test('computeStewardshipRows reuses an already-computed instrument/consult pair on the same facts bundle instead of recomputing them', async () => {
    const { DB, UI, Reports } = await freshApp();
    seedBookings(DB, UI, 30);
    const from = '2026-01-01', to = '2026-12-31';
    const facts = Reports.makeFacts(from, to);

    // Prime the cache exactly like Reports.render() does: instrument and consult rows are computed
    // once, before stewardship ever runs.
    Reports.computeInstrumentRows(from, to, facts);
    Reports.computeConsultRows(from, to, facts);

    const stewardshipCalls = countSqlCalls(DB, () => {
      Reports.computeStewardshipRows(from, to, facts);
    });

    // computeStewardshipRows still has its OWN loaders to run (attendee lines, project/instrument
    // lines, first-user dates, supervisors) — this only asserts it does NOT re-run
    // computeInstrumentRows'/computeConsultRows' own queries a second time. A completely fresh
    // (unshared) computeStewardshipRows call needs at least those two loaders' queries PLUS its
    // own four extra loaders; reusing the cache should cost noticeably less than that.
    const freshStewardshipCalls = countSqlCalls(DB, () => {
      Reports.computeStewardshipRows(from, to);
    });

    assert.ok(
      stewardshipCalls < freshStewardshipCalls,
      `stewardship reusing a primed facts bundle should cost fewer SQL calls than a fully independent call (reused=${stewardshipCalls}, fresh=${freshStewardshipCalls})`
    );
  });
});
