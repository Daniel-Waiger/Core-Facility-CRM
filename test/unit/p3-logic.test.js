/* p3-logic.test.js — guards for the P3 review findings (money/history-preservation rules):
 *   - M1: a booking's saved cost snapshot stays frozen unless a PRICED input actually changed
 *         (UI.bookingPricedInputsChanged is the pure decision bookingEditSave reads)
 *   - M2: renaming a person recomputes every meeting's denormalized attendees string
 *   - M3: changing a project's PI leaves exactly one PI row, never two, never zero-then-stale
 *   - M5: the legacy pricing-tier reseed in migrate() runs at most once, even across a deleted table
 *   - M7: computeBookingBOM clamps negative percentages/amounts/rates rather than trusting them
 *   - M9: countProjectRefs.billed follows the Project Costs rule (waived charges count as 0),
 *         and renameOrganization also renames/merges the matching vocab ORG entry
 *
 * Each test uses a real in-memory sql.js database via freshDb()/seedFixture() — nothing mocked.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-module');
const { freshDb, seedFixture } = require('./helpers/sqlite');

const { UI } = loadApp(['consts', 'ui']);

describe('M1: booking cost-snapshot freeze — UI.bookingPricedInputsChanged', () => {
  function snap(overrides) {
    return Object.assign({
      start: '09:00', end: '11:00', manualPct: 10, groupPct: 0,
      category: 'assisted session', groupOrg: 'Bio Lab',
      instruments: [{ id: 1, amount: 0 }],
      staff: [{ id: 2, start: '', end: '' }],
    }, overrides);
  }

  test('an unpriced-only edit (e.g. a global tax change, or notes/title) reports unchanged', () => {
    // Tax isn't part of the snapshot at all (it's a facility-wide rate, never a per-booking
    // priced INPUT), so a booking's own before/after snapshot is identical regardless of what
    // Settings' tax_pct is at save time — exactly the M1 repro ("589.95 -> 819.375 after a tax
    // change with only notes touched").
    const before = snap();
    const after = snap(); // same instruments/staff/times/discount/category/org
    assert.equal(UI.bookingPricedInputsChanged(before, after), false);
  });

  test('instrument/staff order never matters (both signatures sort by id first)', () => {
    const before = snap({
      instruments: [{ id: 2, amount: 1 }, { id: 1, amount: 0 }],
      staff: [{ id: 5, start: '', end: '' }, { id: 2, start: '09:00', end: '10:00' }],
    });
    const after = snap({
      instruments: [{ id: 1, amount: 0 }, { id: 2, amount: 1 }],
      staff: [{ id: 2, start: '09:00', end: '10:00' }, { id: 5, start: '', end: '' }],
    });
    assert.equal(UI.bookingPricedInputsChanged(before, after), false);
  });

  test('changing an instrument amount is a priced change', () => {
    const before = snap();
    const after = snap({ instruments: [{ id: 1, amount: 5 }] });
    assert.equal(UI.bookingPricedInputsChanged(before, after), true);
  });

  test('changing the staff selection is a priced change', () => {
    const before = snap();
    const after = snap({ staff: [{ id: 2, start: '', end: '' }, { id: 3, start: '', end: '' }] });
    assert.equal(UI.bookingPricedInputsChanged(before, after), true);
  });

  test('changing the booking window (start/end) is a priced change', () => {
    const before = snap();
    const after = snap({ end: '12:00' });
    assert.equal(UI.bookingPricedInputsChanged(before, after), true);
  });

  test('changing the manual or group discount percent is a priced change', () => {
    assert.equal(UI.bookingPricedInputsChanged(snap(), snap({ manualPct: 15 })), true);
    assert.equal(UI.bookingPricedInputsChanged(snap(), snap({ groupPct: 5 })), true);
  });

  test('changing category or group/lab (org) is a priced change (both feed the rate resolution)', () => {
    assert.equal(UI.bookingPricedInputsChanged(snap(), snap({ category: 'unassisted session' })), true);
    assert.equal(UI.bookingPricedInputsChanged(snap(), snap({ groupOrg: 'Other Lab' })), true);
  });

  test('a missing before/after snapshot is always treated as changed (never silently frozen)', () => {
    assert.equal(UI.bookingPricedInputsChanged(null, snap()), true);
    assert.equal(UI.bookingPricedInputsChanged(snap(), null), true);
  });
});

describe('M7: computeBookingBOM clamps negative/out-of-range inputs', () => {
  test('a negative manual discount percent cannot turn into a surcharge', () => {
    // The review's exact repro: manualPct -50 on 2h @ $100/h instrument time used to total 300
    // (a negative "discount" that ADDS money) instead of clamping to a no-op.
    const bom = UI.computeBookingBOM({
      start: '09:00', end: '11:00',
      instruments: [{ id: 1, cost: 100, cost_unit: 'time' }],
      staff: [], groupPct: 0, manualPct: -50, rates: { overheadPct: 0, taxPct: 0 },
    });
    assert.equal(bom.manualPct, 0, 'a negative percent clamps to 0, never flips into a surcharge');
    assert.equal(bom.total, 200, '2h @ $100 with no real discount is 200, not 300');
  });

  test('negative instrument cost/amount and staff rate all clamp to 0', () => {
    const bom = UI.computeBookingBOM({
      start: '09:00', end: '11:00',
      instruments: [
        { id: 1, cost: -50, cost_unit: 'time' },
        { id: 2, cost: -10, amount: -2, cost_unit: 'sample' }, // -2 * -10 would otherwise be +20
      ],
      staff: [{ id: 3, rate: -40 }],
      groupPct: 0, manualPct: 0, rates: { overheadPct: 0, taxPct: 0 },
    });
    assert.equal(bom.instrTime, 0);
    assert.equal(bom.instrAmount, 0, 'a negative cost * negative amount must NOT become a positive charge');
    assert.equal(bom.staffTotal, 0);
    assert.equal(bom.total, 0);
  });

  test('a negative or out-of-range tax percent clamps into [0, 100]', () => {
    const negTax = UI.computeBookingBOM({
      start: '09:00', end: '10:00', instruments: [{ id: 1, cost: 100, cost_unit: 'time' }],
      staff: [], groupPct: 0, manualPct: 0, rates: { overheadPct: 0, taxPct: -20 },
    });
    assert.equal(negTax.taxPct, 0);
    assert.equal(negTax.total, 100, 'a clamped-to-0 tax charges nothing extra');

    const bigTax = UI.computeBookingBOM({
      start: '09:00', end: '10:00', instruments: [{ id: 1, cost: 100, cost_unit: 'time' }],
      staff: [], groupPct: 0, manualPct: 0, rates: { overheadPct: 0, taxPct: 250 },
    });
    assert.equal(bigTax.taxPct, 100);
  });

  test('a negative overhead percent clamps to 0 (overhead can legitimately exceed 100%, so only the floor applies)', () => {
    const bom = UI.computeBookingBOM({
      start: '09:00', end: '10:00', instruments: [{ id: 1, cost: 100, cost_unit: 'time' }],
      staff: [], groupPct: 0, manualPct: 0, rates: { overheadPct: -30, taxPct: 0 },
    });
    assert.equal(bom.overheadPct, 0);
    assert.equal(bom.total, 100);
  });

  test('stored money is rounded to 2 decimals without disturbing the seeded 490/546.25/589.95 figures', () => {
    // Same inputs as the seeded-booking test in money.test.js — this must keep reproducing those
    // exact figures after rounding is introduced.
    const bom = UI.computeBookingBOM({
      start: '09:00', end: '12:00',
      instruments: [{ id: 1, cost: 100, cost_unit: 'time' }], // 3h * 100 = 300
      staff: [{ id: 2, rate: 95, start: '09:00', end: '11:00' }], // 2h * 95 = 190
      groupPct: 5, manualPct: 0, rates: { overheadPct: 15, taxPct: 8 },
    });
    assert.equal(bom.subtotal, 490);
    assert.equal(bom.beforeTax, 546.25);
    assert.equal(bom.total, 589.95);
  });
});

describe('M2: renaming a person recomputes meetings.attendees from meeting_people', () => {
  test('DB.refreshAttendeesForPerson rebuilds every meeting the person is on', async () => {
    const { DB } = await freshDb();
    const ids = seedFixture(DB);
    DB.run("INSERT INTO meetings (title, date, attendees) VALUES ('Session 1', '2026-01-05', 'Alice, Sam')");
    DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (1, ?)', [ids.alice]);
    DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (1, ?)', [ids.sam]);

    // Simulate what pEditSave now does after `people.name` changes: update the name, then recompute.
    DB.run('UPDATE people SET name=? WHERE id=?', ['Alicia', ids.alice]);
    DB.refreshAttendeesForPerson(ids.alice);

    const mt = DB.row('SELECT attendees FROM meetings WHERE id=1');
    assert.match(mt.attendees, /Alicia/, 'the renamed person must appear under their NEW name');
    assert.doesNotMatch(mt.attendees, /\bAlice\b/, 'the stale OLD name must not survive the recompute');
    assert.match(mt.attendees, /Sam/, 'an unrelated attendee is preserved');
  });

  test('a person on no meetings is a safe no-op', async () => {
    const { DB } = await freshDb();
    const ids = seedFixture(DB);
    assert.doesNotThrow(() => DB.refreshAttendeesForPerson(ids.alice));
  });
});

describe('M3: changing a project PI leaves exactly one Principal Investigator row', () => {
  // epSave itself is DOM-bound (reads a live modal's inputs), so this exercises the identical
  // SQL statements it runs against the real schema/PK — the same approach schema.test.js already
  // uses for other app.js-owned invariants that need a real database rather than a mocked one.
  function applyPiChange(DB, projectId, oldPiId, newPiId) {
    if (oldPiId && oldPiId !== newPiId) {
      const oldRow = DB.row('SELECT role FROM project_people WHERE project_id=? AND person_id=?', [projectId, oldPiId]);
      if (oldRow && oldRow.role === 'Principal Investigator') {
        DB.run('DELETE FROM project_people WHERE project_id=? AND person_id=?', [projectId, oldPiId]);
      }
    }
    if (newPiId) {
      DB.run(`INSERT INTO project_people (project_id, person_id, role) VALUES (?,?,'Principal Investigator')
              ON CONFLICT(project_id, person_id) DO UPDATE SET role='Principal Investigator'`, [projectId, newPiId]);
    }
  }

  test('the old PI loses their PI row when they held no other role', async () => {
    const { DB } = await freshDb();
    const ids = seedFixture(DB);
    // seedFixture's own project_people rows use the plain 'PI' shorthand, not the exact
    // 'Principal Investigator' role string epSave writes — set it explicitly so this test
    // exercises the real stored value the fix keys off.
    DB.run("UPDATE project_people SET role='Principal Investigator' WHERE project_id=? AND person_id=?", [ids.liveProject, ids.alice]);
    DB.run("INSERT INTO people (name, type) VALUES ('Nadia','PI')");
    const newPi = DB.row("SELECT id FROM people WHERE name='Nadia'").id;

    applyPiChange(DB, ids.liveProject, ids.alice, newPi);

    const rows = DB.rows('SELECT person_id, role FROM project_people WHERE project_id=?', [ids.liveProject]);
    const piRows = rows.filter((r) => r.role === 'Principal Investigator');
    assert.equal(piRows.length, 1, 'exactly one PI row, never zero and never two');
    assert.equal(piRows[0].person_id, newPi);
    assert.ok(!rows.some((r) => r.person_id === ids.alice), 'the old PI, who had no other role, is dropped from the team entirely');
  });

  test('a new PI who was already a team member under another role becomes PI, not left as-is', async () => {
    const { DB } = await freshDb();
    const ids = seedFixture(DB);
    DB.run("INSERT INTO people (name, type) VALUES ('Ravi','Lead Operator')");
    const ravi = DB.row("SELECT id FROM people WHERE name='Ravi'").id;
    DB.run("INSERT INTO project_people (project_id, person_id, role) VALUES (?,?,'Lead Operator')", [ids.liveProject, ravi]);

    applyPiChange(DB, ids.liveProject, ids.alice, ravi);

    const raviRow = DB.row('SELECT role FROM project_people WHERE project_id=? AND person_id=?', [ids.liveProject, ravi]);
    assert.equal(raviRow.role, 'Principal Investigator', 'an INSERT OR IGNORE would have silently kept "Lead Operator" instead');
    const piRows = DB.rows("SELECT person_id FROM project_people WHERE project_id=? AND role='Principal Investigator'", [ids.liveProject]);
    assert.equal(piRows.length, 1);
  });

  test('a PI who also holds another role on the project keeps their team membership when replaced', async () => {
    const { DB } = await freshDb();
    const ids = seedFixture(DB);
    // Alice is PI on liveProject per seedFixture; give her a second, separate row is impossible
    // (PK is project_id+person_id, one role per person per project) — so this documents that a
    // person can only ever hold ONE role per project, meaning "keep them if they had another
    // role" only matters when their single stored role isn't literally 'Principal Investigator'.
    DB.run("UPDATE project_people SET role='Principal Investigator' WHERE project_id=? AND person_id=?", [ids.liveProject, ids.alice]);
    DB.run("INSERT INTO people (name, type) VALUES ('Noor','PI')");
    const noor = DB.row("SELECT id FROM people WHERE name='Noor'").id;

    applyPiChange(DB, ids.liveProject, ids.alice, noor);
    assert.ok(!DB.row('SELECT 1 as x FROM project_people WHERE project_id=? AND person_id=?', [ids.liveProject, ids.alice]),
      'a PI whose only role was PI is removed once replaced');
  });
});

describe('M5: the legacy pricing-tier reseed runs at most once', () => {
  test('deleting both default tiers after the first upgrade does not resurrect them on the next migrate() pass', async () => {
    const { DB } = await freshDb();
    // Simulate a pre-1.7.0 install: legacy overhead config set, no pricing_tiers yet, and the
    // seeded flag absent. A brand-new freshDb() never runs migrate() at all — but per the verifier
    // gap this test now also guards (see the fresh-DB-branch describe below), boot()'s fresh-DB
    // path sets the flag itself, since IT is also a database that has (correctly) decided there is
    // nothing to reseed. So driving the ACTUAL pre-1.7.0 scenario — a database that predates the
    // flag existing at all — means clearing what boot() just set, then re-running the exact
    // migration path schema.test.js uses: buildBackup()/restoreBackup() re-runs migrate() against
    // the reopened bytes.
    DB.run("DELETE FROM app_config WHERE key='pricing_tiers_seeded'");
    DB.setConfig('overhead_internal', 20);
    DB.setConfig('overhead_external', 50);

    const backup1 = await DB.buildBackup();
    await DB.restoreBackup(backup1); // first migrate() pass with the flag unset

    let tiers = DB.rows('SELECT name FROM pricing_tiers ORDER BY name');
    assert.deepEqual(tiers.map((t) => t.name), ['External', 'Internal'], 'first upgrade seeds both legacy tiers, unchanged behavior');
    assert.equal(DB.getConfig('pricing_tiers_seeded', null), '1', 'the one-time flag is recorded');

    // The zero-ref Delete path a user could reach from Settings.
    DB.run('DELETE FROM pricing_tiers');
    assert.equal(DB.row('SELECT COUNT(*) as c FROM pricing_tiers').c, 0);

    const backup2 = await DB.buildBackup();
    await DB.restoreBackup(backup2); // second migrate() pass, flag now set

    tiers = DB.rows('SELECT name FROM pricing_tiers');
    assert.equal(tiers.length, 0, 'a user who deleted both tiers must not get them back on the next reload');
  });

  test('verifier gap: a brand-new database (never through migrate()) sets the flag itself, so deleting seeded tiers on it also sticks', async () => {
    const { DB } = await freshDb();
    // Nothing seeded pricing_tiers on THIS fresh database (SCHEMA starts it empty and no legacy
    // overhead config was ever set) — but boot()'s fresh-DB branch must still have written the
    // flag, or the FIRST migrate() this database ever goes through (its very next reload) would
    // treat "no tiers yet" as "never decided" and seed Internal/External from whatever
    // overhead_internal/overhead_external happen to be set by then (e.g. via Settings), even if a
    // facility had deliberately deleted both tiers in the meantime.
    assert.equal(DB.getConfig('pricing_tiers_seeded', null), '1', 'boot()\'s fresh-DB branch must set the flag itself, not only migrate()');

    // Facility sets its overhead rates (Settings > Billing Rates) and its own tiers, the ordinary
    // way — through pricing_tiers directly, NOT the legacy migration path.
    DB.setConfig('overhead_internal', 12);
    DB.setConfig('overhead_external', 6);
    DB.run("INSERT INTO pricing_tiers (name, overhead_pct) VALUES ('Internal', 12)");
    DB.run("INSERT INTO pricing_tiers (name, overhead_pct) VALUES ('External', 6)");
    DB.run('DELETE FROM pricing_tiers'); // the zero-ref Delete path a user could reach from Settings

    // Simulate a reload: export bytes, reopen, run migrate() — exactly what schema.test.js and the
    // test above use for "the next time this database is opened".
    const backup = await DB.buildBackup();
    await DB.restoreBackup(backup);

    const tiers = DB.rows('SELECT name FROM pricing_tiers');
    assert.equal(tiers.length, 0, 'a fresh database\'s own deleted tiers must stay deleted after a reload, same as an upgraded one');
  });
});

describe('M9: countProjectRefs.billed follows the Project Costs rule', () => {
  test('a cancelled-and-waived booking counts as 0, not its stored total', async () => {
    const { DB } = await freshDb();
    const ids = seedFixture(DB);
    DB.run(`INSERT INTO meetings (project_id, title, date, total_cost, is_cancelled, billing_retained)
            VALUES (?, 'Kept', '2026-01-05', 300, 0, 0)`, [ids.liveProject]);
    DB.run(`INSERT INTO meetings (project_id, title, date, total_cost, is_cancelled, billing_retained)
            VALUES (?, 'Waived', '2026-01-06', 400, 1, 0)`, [ids.liveProject]);
    DB.run(`INSERT INTO meetings (project_id, title, date, total_cost, is_cancelled, billing_retained)
            VALUES (?, 'Cancelled but charged', '2026-01-07', 250, 1, 1)`, [ids.liveProject]);

    const refs = DB.countProjectRefs(ids.liveProject);
    assert.equal(refs.billed, 300 + 250, 'the waived 400 must not count, matching Project Costs exactly');
  });
});

describe('M9: renameOrganization also renames/merges the vocab ORG entry', () => {
  test('a facility-registered ORG vocab term moves with a plain rename', async () => {
    const { DB } = await freshDb();
    DB.addVocab('ORG', 'Old Lab Name');
    const result = DB.renameOrganization('Old Lab Name', 'New Lab Name');
    assert.ok(result.vocabMoved);
    assert.ok(!result.vocabMerged);
    assert.deepEqual(DB.vocabList('ORG'), ['New Lab Name']);
  });

  test('renaming onto an existing vocab entry merges (drops the old row, keeps one)', async () => {
    const { DB } = await freshDb();
    DB.addVocab('ORG', 'Old Lab Name');
    DB.addVocab('ORG', 'New Lab Name');
    const result = DB.renameOrganization('Old Lab Name', 'New Lab Name');
    assert.ok(result.vocabMerged);
    assert.deepEqual(DB.vocabList('ORG'), ['New Lab Name'], 'no duplicate, no leftover old entry');
  });
});
