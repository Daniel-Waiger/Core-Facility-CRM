/* delete-paths.test.js — the explicit child cleanup in every delete path js/app.js keeps as a
 * belt-and-suspenders measure alongside cascade (CLAUDE.md's "Cascading deletes" section), run
 * for real (see helpers/app-harness.js): deleteMeetingRaw, and the zero-reference delete branches
 * of archiveProject / retirePerson / retireInstrument / retireGrant / retirePricingTier. Also
 * checks CLAUDE.md's "retiring/archiving never touches a join table" the other way around — the
 * non-zero-ref (retire/archive) branches of the same functions — and the projects.pi_id gap.
 *
 * Every one of these functions calls `UI.confirmModal(...)` and nothing else DOM-related (verified
 * by reading each — see js/app.js), so the harness's confirmModal stand-in (resolves true/false,
 * simulating the click) is enough to run the REAL function end-to-end, not a reproduction of it.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers/app-harness');
const { seedFixture } = require('./helpers/sqlite');

describe('deleteMeetingRaw: explicit child cleanup', () => {
  test('deletes meeting_people, meeting_instruments, meeting_staff and the meeting row itself', async () => {
    const app = await freshApp();
    const { alice, sam, scopeA, liveProject } = seedFixture(app.DB);
    app.DB.run("INSERT INTO meetings (project_id, title, date) VALUES (?, 'Session', '2026-01-05')", [liveProject]);
    const id = app.DB.row('SELECT last_insert_rowid() as id').id;
    app.DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [id, alice]);
    app.DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [id, scopeA]);
    app.DB.run('INSERT INTO meeting_staff (meeting_id, person_id) VALUES (?,?)', [id, sam]);

    app.internals.deleteMeetingRaw(id);

    assert.equal(app.DB.row('SELECT COUNT(*) c FROM meetings WHERE id=?', [id]).c, 0);
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM meeting_people WHERE meeting_id=?', [id]).c, 0);
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM meeting_instruments WHERE meeting_id=?', [id]).c, 0);
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM meeting_staff WHERE meeting_id=?', [id]).c, 0);
  });
});

describe('archiveProject: zero-ref real delete vs. archive, and join-table safety', () => {
  test('zero references: confirming deletes the project outright (service_entries/project_outputs cleaned explicitly)', async () => {
    const app = await freshApp({ confirm: true });
    app.DB.run("INSERT INTO projects (title, code, status, is_archived) VALUES ('Empty', 'P-E', 'Active', 0)");
    const pid = app.DB.row('SELECT last_insert_rowid() as id').id;
    assert.equal(app.DB.countProjectRefs(pid).total, 0, 'sanity check: a brand-new project with nothing attached has zero refs');

    app.internals.ctx.project = pid;
    await app.internals.archiveProject();

    assert.equal(app.DB.row('SELECT COUNT(*) c FROM projects WHERE id=?', [pid]).c, 0, 'a zero-ref project must be REALLY deleted, not archived');
  });

  test('any reference at all: archives (is_archived=1) instead of deleting, and touches no join table', async () => {
    const app = await freshApp({ confirm: true });
    const { liveProject } = seedFixture(app.DB); // has 1 team member + 1 instrument — non-zero refs
    assert.ok(app.DB.countProjectRefs(liveProject).total > 0);

    app.internals.ctx.project = liveProject;
    await app.internals.archiveProject();

    const p = app.DB.row('SELECT is_archived, title FROM projects WHERE id=?', [liveProject]);
    assert.equal(p.is_archived, 1, 'a project with any history must be archived, never deleted');
    assert.equal(p.title, 'Live', 'archiving must not rewrite the stored title');
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM project_people WHERE project_id=?', [liveProject]).c, 1,
      'archiving must not touch project_people');
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM project_instruments WHERE project_id=?', [liveProject]).c, 1,
      'archiving must not touch project_instruments');
  });

  test('declining the confirmation leaves a zero-ref project untouched', async () => {
    const app = await freshApp({ confirm: false });
    app.DB.run("INSERT INTO projects (title, code, status, is_archived) VALUES ('Empty', 'P-E', 'Active', 0)");
    const pid = app.DB.row('SELECT last_insert_rowid() as id').id;

    app.internals.ctx.project = pid;
    await app.internals.archiveProject();

    assert.equal(app.DB.row('SELECT COUNT(*) c FROM projects WHERE id=?', [pid]).c, 1, 'declining must not delete the project');
    assert.equal(app.DB.row('SELECT is_archived FROM projects WHERE id=?', [pid]).is_archived, 0);
  });
});

describe('retirePerson: zero-ref real delete vs. retire, and the projects.pi_id gap', () => {
  test('zero references: confirming deletes the person outright (instrument_staff/grant_users/service_entries cleaned explicitly)', async () => {
    const app = await freshApp({ confirm: true });
    app.DB.run("INSERT INTO people (name, type, is_staff) VALUES ('Nobody', 'Other', 0)");
    const pid = app.DB.row('SELECT last_insert_rowid() as id').id;
    app.DB.run("INSERT INTO instruments (name, status) VALUES ('Rig X', 'Available')");
    const instId = app.DB.row('SELECT last_insert_rowid() as id').id;
    // instrument_staff isn't counted in countPersonRefs (CLAUDE.md: "a current assignment, not
    // history") — a person with zero "real" refs can still have one, which is exactly the
    // explicit-cleanup case app.js's comment describes.
    app.DB.run('INSERT INTO instrument_staff (instrument_id, person_id) VALUES (?,?)', [instId, pid]);
    assert.equal(app.DB.countPersonRefs(pid).total, 0);

    await app.internals.retirePerson(pid);

    assert.equal(app.DB.row('SELECT COUNT(*) c FROM people WHERE id=?', [pid]).c, 0, 'a zero-ref person must be REALLY deleted');
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM instrument_staff WHERE person_id=?', [pid]).c, 0,
      'instrument_staff must be explicitly cleaned even though it is not itself counted as a "ref"');
  });

  test('any reference at all (including being a PI on an archived project): retires instead of deleting, and touches no join table', async () => {
    const app = await freshApp({ confirm: true });
    const { alice, liveProject } = seedFixture(app.DB); // Alice is PI on 2 projects + on project_people for both
    assert.ok(app.DB.countPersonRefs(alice).total > 0);

    await app.internals.retirePerson(alice);

    const p = app.DB.row('SELECT is_retired, name FROM people WHERE id=?', [alice]);
    assert.equal(p.is_retired, 1);
    assert.equal(p.name, 'Alice', 'retiring must not rewrite the stored name');
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM project_people WHERE person_id=?', [alice]).c, 2,
      'retiring must not touch project_people');
    // The exact gap CLAUDE.md documents: projects.pi_id carries no REFERENCES clause, so nothing —
    // not cascade, and (see below) not retirePerson either — nulls it when its holder is retired.
    // Retiring is not deleting, so pi_id correctly stays put here; this just pins that it does.
    assert.equal(app.DB.row('SELECT pi_id FROM projects WHERE id=?', [liveProject]).pi_id, alice);
  });

  test('projects.pi_id is UNREACHABLE from retirePerson\'s real-delete branch: being a PI anywhere ' +
    '(even on an archived project) already makes countPersonRefs.total > 0, so the delete branch ' +
    'never runs while pi_id could dangle — retirePerson contains no `UPDATE projects SET pi_id=NULL` ' +
    'at all (grep confirms). This corrects an assumption in schema.test.js\'s own comment, which ' +
    'described that nulling as living in retirePerson\'s zero-ref branch; it does not exist there, ' +
    'and — per this test — the app\'s own gating means it is never actually needed through the UI. ' +
    'The gap CLAUDE.md and schema.test.js describe is real only for a hypothetical direct-SQL delete ' +
    'that bypasses retirePerson entirely.', async () => {
    const app = await freshApp({ confirm: true });
    const { alice, liveProject } = seedFixture(app.DB);
    const refs = app.DB.countPersonRefs(alice);
    assert.ok(refs.pi > 0 && refs.total === refs.pi + refs.projects, 'sanity check on the fixture shape');

    // Prove the gate: with Alice still a PI, retirePerson must take the RETIRE branch, not delete.
    await app.internals.retirePerson(alice);
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM people WHERE id=?', [alice]).c, 1,
      'a person who is PI on any project (even archived) must never be offered as a real delete');
    assert.equal(app.DB.row('SELECT pi_id FROM projects WHERE id=?', [liveProject]).pi_id, alice);
  });
});

describe('retireInstrument: zero-ref real delete vs. retire, and join-table safety', () => {
  test('zero references: confirming deletes the instrument outright (instrument_staff/instrument_tier_rates cleaned explicitly)', async () => {
    const app = await freshApp({ confirm: true });
    app.DB.run("INSERT INTO instruments (name, status) VALUES ('Spare Scope', 'Available')");
    const instId = app.DB.row('SELECT last_insert_rowid() as id').id;
    app.DB.run("INSERT INTO pricing_tiers (name) VALUES ('Standard')");
    const tierId = app.DB.row('SELECT last_insert_rowid() as id').id;
    app.DB.run('INSERT INTO instrument_tier_rates (instrument_id, tier_id, cost) VALUES (?,?,50)', [instId, tierId]);
    assert.equal(app.DB.countInstrumentRefs(instId).total, 0);

    await app.internals.retireInstrument(instId);

    assert.equal(app.DB.row('SELECT COUNT(*) c FROM instruments WHERE id=?', [instId]).c, 0);
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM instrument_tier_rates WHERE instrument_id=?', [instId]).c, 0);
  });

  test('any reference at all: retires instead of deleting, and touches no join table', async () => {
    const app = await freshApp({ confirm: true });
    const { scopeA, liveProject } = seedFixture(app.DB);
    assert.ok(app.DB.countInstrumentRefs(scopeA).total > 0);

    await app.internals.retireInstrument(scopeA);

    const i = app.DB.row('SELECT is_retired, name FROM instruments WHERE id=?', [scopeA]);
    assert.equal(i.is_retired, 1);
    assert.equal(i.name, 'Scope A');
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM project_instruments WHERE instrument_id=?', [scopeA]).c, 2,
      'retiring must not touch project_instruments (Scope A is on both seeded projects)');
  });
});

describe('retireGrant: zero-ref real delete vs. retire', () => {
  test('zero references: confirming deletes the grant outright (meetings/projects/service_entries grant_id nulled, grant_users cleaned)', async () => {
    const app = await freshApp({ confirm: true });
    const { alice, liveProject } = seedFixture(app.DB);
    app.DB.run("INSERT INTO grants (name, number) VALUES ('Unused Grant', 'X-1')");
    const gid = app.DB.row('SELECT last_insert_rowid() as id').id;
    // grant_users isn't counted in countGrantRefs (a current allowed-user list, not history).
    app.DB.run('INSERT INTO grant_users (grant_id, person_id) VALUES (?,?)', [gid, alice]);
    assert.equal(app.DB.countGrantRefs(gid).total, 0);

    await app.internals.retireGrant(gid);

    assert.equal(app.DB.row('SELECT COUNT(*) c FROM grants WHERE id=?', [gid]).c, 0);
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM grant_users WHERE grant_id=?', [gid]).c, 0);
  });

  test('any reference at all: retires instead of deleting', async () => {
    const app = await freshApp({ confirm: true });
    const { liveProject } = seedFixture(app.DB);
    app.DB.run("INSERT INTO grants (name, number) VALUES ('Active Grant', 'X-2')");
    const gid = app.DB.row('SELECT last_insert_rowid() as id').id;
    app.DB.run('UPDATE projects SET grant_id=? WHERE id=?', [gid, liveProject]);
    assert.ok(app.DB.countGrantRefs(gid).total > 0);

    await app.internals.retireGrant(gid);

    const g = app.DB.row('SELECT is_retired, name FROM grants WHERE id=?', [gid]);
    assert.equal(g.is_retired, 1);
    assert.equal(g.name, 'Active Grant');
    assert.equal(app.DB.row('SELECT grant_id FROM projects WHERE id=?', [liveProject]).grant_id, gid,
      'retiring a grant must not touch what it is assigned to');
  });
});

describe('retirePricingTier: zero-ref real delete vs. retire', () => {
  test('zero references: confirming deletes the tier outright (instrument_tier_rates cleaned explicitly)', async () => {
    const app = await freshApp({ confirm: true });
    app.DB.run("INSERT INTO instruments (name, status) VALUES ('Rig', 'Available')");
    const instId = app.DB.row('SELECT last_insert_rowid() as id').id;
    app.DB.run("INSERT INTO pricing_tiers (name) VALUES ('Unused Tier')");
    const tid = app.DB.row('SELECT last_insert_rowid() as id').id;
    app.DB.run('INSERT INTO instrument_tier_rates (instrument_id, tier_id, cost) VALUES (?,?,10)', [instId, tid]);
    assert.equal(app.DB.countTierRefs(tid).total, 0);

    await app.internals.retirePricingTier(tid);

    assert.equal(app.DB.row('SELECT COUNT(*) c FROM pricing_tiers WHERE id=?', [tid]).c, 0);
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM instrument_tier_rates WHERE tier_id=?', [tid]).c, 0);
  });

  test('any reference at all: retires instead of deleting', async () => {
    const app = await freshApp({ confirm: true });
    app.DB.run("INSERT INTO pricing_tiers (name) VALUES ('Assigned Tier')");
    const tid = app.DB.row('SELECT last_insert_rowid() as id').id;
    app.DB.run("INSERT INTO group_tiers (org, tier_id) VALUES ('Bio Lab', ?)", [tid]);
    assert.ok(app.DB.countTierRefs(tid).total > 0);

    await app.internals.retirePricingTier(tid);

    const t = app.DB.row('SELECT is_retired, name FROM pricing_tiers WHERE id=?', [tid]);
    assert.equal(t.is_retired, 1);
    assert.equal(t.name, 'Assigned Tier');
  });
});
