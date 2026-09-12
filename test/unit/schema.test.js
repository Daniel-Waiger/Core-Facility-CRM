/* schema.test.js — the data-integrity rules CLAUDE.md documents for js/db.js's schema:
 *   - the foreign_keys pragma trap (db.export() silently turns it off; currentBytes() reasserts it)
 *   - cascades actually fire once that reassert is in place
 *   - projects.pi_id has no REFERENCES clause, so cascade can never null it
 *   - the ref-counter functions that gate retire/archive/delete
 *   - retiring/archiving never touches a join table, and never rewrites the stored name
 *   - bookings are cancelled, not deleted, and the two rules that follow from that
 *   - the denormalized attendees string vs. the meeting_people join table
 *   - migrations are idempotent
 *
 * Each freshDb() call is a brand-new in-memory sql.js database (see helpers/sqlite.js) so tests
 * cannot contaminate each other.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { freshDb, seedFixture } = require('./helpers/sqlite');
const { REPO } = require('./helpers/load-module');

describe('schema: the foreign_keys pragma trap', () => {
  test('db.export() silently turns foreign_keys off, and DB.currentBytes() reasserts it on every call', async () => {
    // Two things need proving here, and they need two different databases to prove them:
    //
    // (1) The raw sql.js side effect CLAUDE.md reports empirically: exporting a database resets
    //     ITS OWN connection's `foreign_keys` pragma to 0. We can't observe this through DB's own
    //     pragma reads, because DB's only public export path (currentBytes()) reasserts the pragma
    //     in the same call that exports — by the time we could read it back, it's already ON
    //     again. So we reproduce the raw effect on an independent sql.js instance built from the
    //     exact same libs/sql-asm.js the app ships, which is an honest empirical check of the same
    //     underlying library, not a re-implementation of db.js's own logic.
    const initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
    const SQL = await initSqlJs();
    const raw = new SQL.Database();
    raw.exec('PRAGMA foreign_keys = ON;');
    assert.equal(raw.exec('PRAGMA foreign_keys')[0].values[0][0], 1, 'pragma reads 1 right after being set');
    raw.export(); // the side effect under test
    assert.equal(raw.exec('PRAGMA foreign_keys')[0].values[0][0], 0,
      'db.export() silently reset foreign_keys back to OFF — the exact trap CLAUDE.md documents');
    raw.exec('PRAGMA foreign_keys = ON;'); // manual reassert, proving the pragma is simply a plain session setting
    assert.equal(raw.exec('PRAGMA foreign_keys')[0].values[0][0], 1);

    // (2) DB's own protection: `currentBytes()` (exported directly on the DB module, and the one
    // function every autosave/backup path funnels through — see markDirty/buildBackup in db.js)
    // must leave the LIVE connection's pragma at 1 every single time it's called, not just once.
    // If a future edit ever dropped the reassert line, this is the test that would catch it.
    const { DB } = await freshDb();
    assert.equal(DB.row('PRAGMA foreign_keys').foreign_keys, 1, 'pragma is ON right after boot');
    DB.currentBytes(); // the export path reachable from outside db.js's closure
    assert.equal(DB.row('PRAGMA foreign_keys').foreign_keys, 1,
      'DB.currentBytes() must reassert PRAGMA foreign_keys = ON immediately after exporting, or every cascade in the app silently stops firing after the first autosave');
    // And again, twice more, since the reassert has to survive every single call, not just the first.
    DB.currentBytes();
    DB.currentBytes();
    assert.equal(DB.row('PRAGMA foreign_keys').foreign_keys, 1);
  });
});

describe('schema: cascades actually fire (with the pragma reassert in place)', () => {
  test('deleting a meeting cascades to meeting_people, meeting_instruments, meeting_staff', async () => {
    const { DB } = await freshDb();
    const { alice, sam, scopeA, liveProject } = seedFixture(DB);
    DB.run("INSERT INTO meetings (project_id, title, date) VALUES (?, 'Session 1', '2026-01-05')", [liveProject]);
    const meetingId = DB.row('SELECT last_insert_rowid() as id').id;
    DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [meetingId, alice]);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [meetingId, scopeA]);
    DB.run('INSERT INTO meeting_staff (meeting_id, person_id) VALUES (?,?)', [meetingId, sam]);

    // A save happens between setup and the delete, exactly like real usage, so the pragma
    // reassert (proven above) is actually exercised on the path that matters.
    DB.currentBytes();

    assert.equal(DB.row('SELECT COUNT(*) c FROM meeting_people WHERE meeting_id=?', [meetingId]).c, 1);
    assert.equal(DB.row('SELECT COUNT(*) c FROM meeting_instruments WHERE meeting_id=?', [meetingId]).c, 1);
    assert.equal(DB.row('SELECT COUNT(*) c FROM meeting_staff WHERE meeting_id=?', [meetingId]).c, 1);

    DB.run('DELETE FROM meetings WHERE id=?', [meetingId]);

    assert.equal(DB.row('SELECT COUNT(*) c FROM meeting_people WHERE meeting_id=?', [meetingId]).c, 0,
      'ON DELETE CASCADE should have removed meeting_people rows for the deleted meeting');
    assert.equal(DB.row('SELECT COUNT(*) c FROM meeting_instruments WHERE meeting_id=?', [meetingId]).c, 0,
      'ON DELETE CASCADE should have removed meeting_instruments rows for the deleted meeting');
    assert.equal(DB.row('SELECT COUNT(*) c FROM meeting_staff WHERE meeting_id=?', [meetingId]).c, 0,
      'ON DELETE CASCADE should have removed meeting_staff rows for the deleted meeting');
  });

  test('deleting a project cascades to its milestones (and their owners/instruments), project_people, project_instruments, and SETS NULL on meetings.project_id', async () => {
    const { DB } = await freshDb();
    const { alice, scopeA, liveProject } = seedFixture(DB);

    DB.run("INSERT INTO milestones (project_id, name) VALUES (?, 'Milestone 1')", [liveProject]);
    const msId = DB.row('SELECT last_insert_rowid() as id').id;
    DB.run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (?,?)', [msId, alice]);
    DB.run('INSERT INTO milestone_instruments (milestone_id, instrument_id) VALUES (?,?)', [msId, scopeA]);

    DB.run("INSERT INTO meetings (project_id, title, date) VALUES (?, 'Session 1', '2026-01-05')", [liveProject]);
    const meetingId = DB.row('SELECT last_insert_rowid() as id').id;

    DB.currentBytes(); // exercise the reassert, same as real autosave timing

    DB.run('DELETE FROM projects WHERE id=?', [liveProject]);

    assert.equal(DB.row('SELECT COUNT(*) c FROM milestones WHERE project_id=?', [liveProject]).c, 0,
      'milestones must cascade off the deleted project');
    assert.equal(DB.row('SELECT COUNT(*) c FROM milestone_owners WHERE milestone_id=?', [msId]).c, 0,
      'milestone_owners must cascade off the deleted milestone (a second hop of cascade)');
    assert.equal(DB.row('SELECT COUNT(*) c FROM milestone_instruments WHERE milestone_id=?', [msId]).c, 0,
      'milestone_instruments must cascade off the deleted milestone (a second hop of cascade)');
    assert.equal(DB.row('SELECT COUNT(*) c FROM project_people WHERE project_id=?', [liveProject]).c, 0,
      'project_people must cascade off the deleted project');
    assert.equal(DB.row('SELECT COUNT(*) c FROM project_instruments WHERE project_id=?', [liveProject]).c, 0,
      'project_instruments must cascade off the deleted project');

    // meetings.project_id is `REFERENCES projects(id) ON DELETE SET NULL` — the meeting itself is
    // a historical record and must survive; only the dangling link is cleared.
    const meeting = DB.row('SELECT project_id FROM meetings WHERE id=?', [meetingId]);
    assert.ok(meeting, 'the meeting itself must NOT be deleted when its project is deleted');
    assert.equal(meeting.project_id, null, 'ON DELETE SET NULL should have cleared meetings.project_id');
  });

  test('deleting a person cascades to project_people', async () => {
    const { DB } = await freshDb();
    const { alice, liveProject, archivedProject } = seedFixture(DB);

    assert.equal(DB.row('SELECT COUNT(*) c FROM project_people WHERE person_id=?', [alice]).c, 2,
      'sanity check on the fixture: Alice is on both seeded projects');

    DB.currentBytes();
    DB.run('DELETE FROM people WHERE id=?', [alice]);

    assert.equal(DB.row('SELECT COUNT(*) c FROM project_people WHERE person_id=?', [alice]).c, 0,
      'project_people must cascade off the deleted person');
    // Both project rows themselves must survive — deleting a person is not supposed to touch projects.
    assert.ok(DB.row('SELECT id FROM projects WHERE id=?', [liveProject]));
    assert.ok(DB.row('SELECT id FROM projects WHERE id=?', [archivedProject]));
  });
});

describe('schema: projects.pi_id has no REFERENCES clause', () => {
  test('deleting a PI leaves projects.pi_id dangling — this is exactly why app.js nulls it explicitly', async () => {
    const { DB } = await freshDb();
    const { alice, liveProject } = seedFixture(DB);

    assert.equal(DB.row('SELECT pi_id FROM projects WHERE id=?', [liveProject]).pi_id, alice);

    DB.currentBytes();
    DB.run('DELETE FROM people WHERE id=?', [alice]);

    // If pi_id carried a REFERENCES clause (even a bare one with no ON DELETE action), SQLite
    // would have thrown on the DELETE above once foreign_keys is ON, instead of silently leaving
    // a dangling id. It didn't throw, and the id is still sitting there — that's the gap.
    const after = DB.row('SELECT pi_id FROM projects WHERE id=?', [liveProject]);
    assert.equal(after.pi_id, alice,
      'pi_id has no REFERENCES clause, so cascade cannot and does not null it — CLAUDE.md calls this out ' +
      'explicitly as something the explicit delete code in app.js (not cascade) has to handle');

    // NOTE (corrected after this comment's first pass — see delete-paths.test.js, which now
    // reaches js/app.js's real retirePerson via helpers/app-harness.js): retirePerson's zero-ref
    // delete branch contains no `UPDATE projects SET pi_id=NULL` at all (grep js/app.js — there is
    // no such statement anywhere). That is not a live gap through the app's own UI: retirePerson's
    // real-delete offer is gated on `DB.countPersonRefs(id).total === 0`, and that total already
    // includes `pi` (see the ref-counter tests above), so the branch that deletes a person never
    // runs while they are still a PI on anything, even an archived project. The dangling-pi_id
    // scenario this test constructs above is real only for a hypothetical direct-SQL delete that
    // bypasses retirePerson — see delete-paths.test.js's dedicated test for the full argument.
  });
});

describe('schema: ref counters (DB.countPersonRefs / countInstrumentRefs / countProjectRefs / countBookingRefs / countGrantRefs)', () => {
  test('countPersonRefs and countInstrumentRefs report the seeded fixture shape exactly', async () => {
    const { DB } = await freshDb();
    const { alice, scopeA } = seedFixture(DB);

    const personRefs = DB.countPersonRefs(alice);
    // Alice is project_people on both seeded projects (live + archived) AND is pi_id on both.
    // IMPORTANT: this counter is a HISTORY counter, not an "active work" counter — it deliberately
    // does NOT exclude archived projects (CLAUDE.md: "Zero references is the only case where a
    // real delete is offered"; an archived project's team membership is exactly the kind of
    // history retirement is meant to preserve). Pinning this shape so a future "fix" that starts
    // filtering out archived projects here cannot land silently.
    assert.equal(personRefs.projects, 2, 'project_people rows for Alice, across BOTH the active and the archived project (intentional — see comment above)');
    assert.equal(personRefs.pi, 2, 'pi_id rows for Alice, across BOTH projects (intentional — see comment above)');
    assert.equal(personRefs.milestones, 0);
    assert.equal(personRefs.bookings, 0);
    assert.equal(personRefs.staffed, 0);
    assert.equal(personRefs.entries, 0);
    assert.equal(personRefs.total, 4);

    const instRefs = DB.countInstrumentRefs(scopeA);
    assert.equal(instRefs.projects, 2, 'project_instruments rows for Scope A, across both seeded projects');
    assert.equal(instRefs.milestones, 0);
    assert.equal(instRefs.bookings, 0);
    assert.equal(instRefs.entries, 0);
    assert.equal(instRefs.total, 2);
  });

  test('countProjectRefs counts team/instruments the same way for an active project as for an archived one', async () => {
    const { DB } = await freshDb();
    const { liveProject, archivedProject } = seedFixture(DB);

    const live = DB.countProjectRefs(liveProject);
    assert.equal(live.team, 1);
    assert.equal(live.instruments, 1);
    assert.equal(live.total, 2);

    const archived = DB.countProjectRefs(archivedProject);
    assert.equal(archived.team, 1);
    assert.equal(archived.instruments, 1);
    assert.equal(archived.total, 2);
  });

  test('countBookingRefs.any is false for an empty booking (a deletable note) and true once it carries attendees or a cost', async () => {
    const { DB } = await freshDb();
    const { alice, liveProject } = seedFixture(DB);

    DB.run("INSERT INTO meetings (project_id, title, date) VALUES (?, 'Just a note', '2026-01-05')", [liveProject]);
    const emptyId = DB.row('SELECT last_insert_rowid() as id').id;
    // `any` is a plain-integer sum in SQL (0, not boolean false), so assert on its truthiness.
    assert.equal(!!DB.countBookingRefs(emptyId).any, false,
      'a booking with no attendees, line items or cost is just a note — CLAUDE.md: this is the only kind of booking a real delete is offered for');

    DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [emptyId, alice]);
    assert.equal(!!DB.countBookingRefs(emptyId).any, true, 'an attendee makes it a real record, not a note');

    DB.run("INSERT INTO meetings (project_id, title, date, total_cost) VALUES (?, 'Billed only', '2026-01-06', 50)", [liveProject]);
    const billedId = DB.row('SELECT last_insert_rowid() as id').id;
    assert.equal(!!DB.countBookingRefs(billedId).any, true, 'a saved cost alone (no attendees/lines) also makes it a real record');
  });

  test('countGrantRefs reports projects, bookings and entries billed against a grant', async () => {
    const { DB } = await freshDb();
    const { liveProject } = seedFixture(DB);
    DB.run("INSERT INTO grants (name, number) VALUES ('NIH R01', 'R01-123')");
    const grantId = DB.row('SELECT last_insert_rowid() as id').id;

    assert.deepEqual(DB.countGrantRefs(grantId), { projects: 0, bookings: 0, entries: 0, total: 0 });

    DB.run('UPDATE projects SET grant_id=? WHERE id=?', [grantId, liveProject]);
    DB.run("INSERT INTO meetings (project_id, grant_id, title, date) VALUES (?, ?, 'Session', '2026-01-05')", [liveProject, grantId]);

    const refs = DB.countGrantRefs(grantId);
    assert.equal(refs.projects, 1);
    assert.equal(refs.bookings, 1);
    assert.equal(refs.entries, 0);
    assert.equal(refs.total, 2);
  });
});

describe('schema: retiring/archiving never touches a join table, and never rewrites the stored name', () => {
  test('DB.setRetired("people", ...) flips the flag/timestamp, leaves the name and every join row untouched, and un-retiring restores availability', async () => {
    const { DB } = await freshDb();
    const { alice, liveProject } = seedFixture(DB);

    DB.setRetired('people', alice, true);
    const retired = DB.row('SELECT name, is_retired, retired_at FROM people WHERE id=?', [alice]);
    assert.equal(retired.is_retired, 1);
    assert.notEqual(retired.retired_at, '', 'retired_at should be stamped');
    // CLAUDE.md: "the stored name is never modified" — the "(Retired)" suffix is purely
    // UI.retiredName's display-time concern, applied wherever the name is rendered.
    assert.equal(retired.name, 'Alice', 'the stored name must not be rewritten on retirement');
    assert.equal(DB.row('SELECT COUNT(*) c FROM project_people WHERE person_id=?', [alice]).c, 2,
      'retiring must not touch project_people — it is not a delete');

    DB.setRetired('people', alice, false);
    const restored = DB.row('SELECT is_retired, retired_at FROM people WHERE id=?', [alice]);
    assert.equal(restored.is_retired, 0);
    assert.equal(restored.retired_at, '', 'un-retiring should clear retired_at');
  });

  test('DB.setProjectArchived(...) flips the flag/timestamp, leaves the title untouched, and every join row survives', async () => {
    const { DB } = await freshDb();
    const { liveProject } = seedFixture(DB);

    DB.setProjectArchived(liveProject, true);
    const archived = DB.row('SELECT title, is_archived, archived_at FROM projects WHERE id=?', [liveProject]);
    assert.equal(archived.is_archived, 1);
    assert.notEqual(archived.archived_at, '');
    assert.equal(archived.title, 'Live', 'the stored title must not be rewritten on archiving');
    assert.equal(DB.row('SELECT COUNT(*) c FROM project_people WHERE project_id=?', [liveProject]).c, 1,
      'archiving must not touch project_people');
    assert.equal(DB.row('SELECT COUNT(*) c FROM project_instruments WHERE project_id=?', [liveProject]).c, 1,
      'archiving must not touch project_instruments');

    DB.setProjectArchived(liveProject, false);
    const restored = DB.row('SELECT is_archived, archived_at FROM projects WHERE id=?', [liveProject]);
    assert.equal(restored.is_archived, 0);
    assert.equal(restored.archived_at, '');
  });
});

describe('schema: bookings are cancelled, not deleted', () => {
  test('DB.setBookingCancelled sets is_cancelled/cancelled_at/billing_retained, and money follows the Project Costs rule', async () => {
    const { DB } = await freshDb();
    const { liveProject } = seedFixture(DB);
    DB.run("INSERT INTO meetings (project_id, title, date, total_cost) VALUES (?, 'Session', '2026-01-05', 100)", [liveProject]);
    const id = DB.row('SELECT last_insert_rowid() as id').id;

    // Cancelled AFTER the slot was held: the charge is retained (CLAUDE.md's "After the start
    // time" rule) — billing stands.
    DB.setBookingCancelled(id, true, true);
    let m = DB.row('SELECT is_cancelled, cancelled_at, billing_retained, total_cost FROM meetings WHERE id=?', [id]);
    assert.equal(m.is_cancelled, 1);
    assert.notEqual(m.cancelled_at, '');
    assert.equal(m.billing_retained, 1);
    // Project Costs rule: `counts unless is_cancelled && !billing_retained`. Cancelled+retained
    // still counts, so this row's cost should contribute the full total, not zero.
    let counts = !(m.is_cancelled && !m.billing_retained);
    assert.equal(counts, true, 'a cancelled-but-retained booking must still count toward Project Costs');

    // Now waive it (cancelled before the start time, or an admin choosing to waive): retained=0.
    DB.setBookingCancelled(id, true, false);
    m = DB.row('SELECT is_cancelled, billing_retained, total_cost FROM meetings WHERE id=?', [id]);
    assert.equal(m.billing_retained, 0);
    counts = !(m.is_cancelled && !m.billing_retained);
    assert.equal(counts, false, 'a cancelled-and-waived booking must NOT count toward Project Costs');

    // Reinstating clears the flags entirely.
    DB.setBookingCancelled(id, false);
    m = DB.row('SELECT is_cancelled, cancelled_at, billing_retained FROM meetings WHERE id=?', [id]);
    assert.equal(m.is_cancelled, 0);
    assert.equal(m.cancelled_at, '');
    assert.equal(m.billing_retained, 0);
  });

  test('a cancelled booking stops blocking its slot (findBookingConflicts\' own is_cancelled=0 filter, reproduced)', async () => {
    // js/app.js's findBookingConflicts() is a private function of app.js's closure — it is never
    // attached to `global.App` (see js/app.js's `global.App = {...}` export list), so it is
    // genuinely unreachable from these tests without loading and executing app.js's full routing/
    // modal machinery for a function that still wouldn't be exposed at the end of it. Per the task
    // instructions, that's documented here as a coverage gap rather than faked as a pass.
    //
    // What CAN be tested from outside is the exact invariant the function is built on (its own
    // comment: "is_cancelled=0: a cancelled booking has given its slot back, so it never blocks a
    // new one") — reproduced verbatim below as the same overlap predicate against the same schema,
    // which is what the function's behavior reduces to.
    const { DB } = await freshDb();
    const { scopeA, liveProject } = seedFixture(DB);
    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time) VALUES (?, 'Existing', '2026-01-05','09:00','10:00')", [liveProject]);
    const existingId = DB.row('SELECT last_insert_rowid() as id').id;
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [existingId, scopeA]);

    const overlapSql = `m.date = ? AND m.id != ? AND m.is_cancelled = 0 AND m.start_time != '' AND m.end_time != '' AND NOT (m.end_time <= ? OR m.start_time >= ?)`;
    const findConflicts = (newStart, newEnd) => DB.rows(
      `SELECT m.id FROM meeting_instruments mi JOIN meetings m ON m.id = mi.meeting_id
       WHERE mi.instrument_id = ? AND ${overlapSql}`,
      [scopeA, '2026-01-05', 0, newStart, newEnd]
    );

    assert.equal(findConflicts('09:30', '10:30').length, 1, 'an overlapping active booking must be reported as a conflict');

    DB.setBookingCancelled(existingId, true, false);
    assert.equal(findConflicts('09:30', '10:30').length, 0,
      'a cancelled booking must stop blocking its slot — it gave the slot back');
  });
});

describe('schema: the denormalized meetings.attendees string vs. the relational meeting_people table', () => {
  test('DB.seedSampleData() (the one public path that creates bookings with attendees) keeps both in sync', async () => {
    // seedBooking() itself (db.js) is not exported on DB — it's an internal helper used only by
    // seedSampleData(), which IS exported and is the only public path that creates a booking with
    // attendees end-to-end. It refuses to run unless window.IS_DEMO is true, so this test boots
    // with `?demo=1` (see js/consts.js) specifically to reach it.
    const { DB } = await freshDb({ search: '?demo=1' });
    const ok = DB.seedSampleData();
    assert.equal(ok, true);

    const meetings = DB.rows("SELECT id, attendees FROM meetings WHERE TRIM(COALESCE(attendees,'')) != ''");
    assert.ok(meetings.length > 0, 'the demo dataset should include at least one meeting with a denormalized attendees string');

    let checked = 0;
    for (const m of meetings) {
      const joinNames = DB.rows(
        'SELECT p.name FROM meeting_people mp JOIN people p ON p.id = mp.person_id WHERE mp.meeting_id=?',
        [m.id]
      ).map((r) => r.name).sort();
      const stringNames = m.attendees.split(',').map((s) => s.trim()).filter(Boolean).sort();

      // This is exactly the bug CLAUDE.md records: the demo seed once populated `attendees` (the
      // display string) without inserting the matching `meeting_people` rows, so every join-based
      // feature (like Email Attendees) saw zero attendees for a meeting that visibly listed some.
      assert.deepEqual(joinNames, stringNames,
        `meeting ${m.id}: meetings.attendees ("${m.attendees}") must match the names actually present in meeting_people — a mismatch here is the exact class of bug CLAUDE.md documents`);
      checked++;
    }
    assert.ok(checked > 0);
  });
});

describe('schema: migrations are idempotent', () => {
  function tableColumns(DB, table) {
    return DB.rows(`PRAGMA table_info(${table})`).map((c) => c.name).sort();
  }
  const ALL_TABLES = [
    'projects', 'people', 'grants', 'grant_users', 'instruments', 'project_people',
    'project_instruments', 'instrument_staff', 'milestones', 'milestone_owners',
    'milestone_instruments', 'meetings', 'meeting_people', 'meeting_instruments', 'meeting_staff',
    'files', 'kv', 'vocab', 'app_config', 'group_discounts', 'pricing_tiers', 'group_tiers',
    'instrument_tier_rates', 'category_policies', 'service_entries', 'project_outputs'
  ];

  test('a database built straight from SCHEMA already has every migrated column (no migration needed)', async () => {
    const { DB } = await freshDb();
    // Columns that only exist because of an ALTER TABLE in migrate() for a database that was
    // created before they existed — a brand-new DB gets them straight from the SCHEMA string
    // instead (see boot()'s comment: "migrate() never runs for a brand-new database").
    const migratedColumns = {
      people: ['organization', 'department', 'is_staff', 'rate', 'rate_unit', 'is_retired', 'retired_at'],
      projects: ['sample', 'flags', 'is_archived', 'archived_at'],
      instruments: ['location', 'cost', 'cost_unit', 'is_retired', 'retired_at'],
      meetings: ['link', 'start_time', 'end_time', 'discount_pct', 'group_org', 'group_discount_pct',
        'subtotal', 'total_before_tax', 'total_cost', 'is_cancelled', 'cancelled_at', 'billing_retained'],
    };
    for (const [table, cols] of Object.entries(migratedColumns)) {
      const present = tableColumns(DB, table);
      for (const col of cols) {
        assert.ok(present.includes(col), `${table}.${col} should already exist on a fresh SCHEMA-built database`);
      }
    }
  });

  test('running the migration path a second time (via backup/restore) changes no column list', async () => {
    const { DB } = await freshDb();
    seedFixture(DB);

    const before = {};
    for (const t of ALL_TABLES) before[t] = tableColumns(DB, t);

    // buildBackup()/restoreBackup() is the one public round trip that re-runs migrate() on an
    // existing database (restoreBackup calls migrate() explicitly after reopening the exported
    // bytes) — see db.js. It's the closest thing to "boot a second time from exported bytes" that
    // is reachable without touching db.js's private `db`/`migrate` bindings directly.
    const backup = await DB.buildBackup();
    await DB.restoreBackup(backup);

    const after = {};
    for (const t of ALL_TABLES) after[t] = tableColumns(DB, t);

    assert.deepEqual(after, before, 'every table\'s column list must be identical after a second migration pass');

    // And the actual fixture data must still be there — restoreBackup is a real reopen, not a no-op.
    assert.equal(DB.row('SELECT COUNT(*) c FROM people').c, 2);
    assert.equal(DB.row('SELECT COUNT(*) c FROM projects').c, 2);
  });
});
