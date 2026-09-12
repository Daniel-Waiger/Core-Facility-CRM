/* dashboard.test.js — the Dashboard's "Upcoming Milestones (Next 30 Days)" card must not also
 * show overdue milestones. Before this fix, views.js's upcoming query had only an upper bound
 * (due_date <= today+30) and no lower bound, so an overdue milestone (due_date < today) matched
 * both the Upcoming query and the Overdue query and rendered in both cards — worse, with enough
 * overdue rows to fill the shared LIMIT 10, a truly-upcoming milestone could be pushed out of the
 * Upcoming card entirely. See CLAUDE.md-adjacent review finding U4.
 *
 * Loading order: views.js reads `global.CONST`/`global.UI` at load time and calls into
 * `global.DB`/`global.UI` only inside function bodies, so ['consts','db','ui','views'] is enough
 * (mirrors aggregation.test.js's load list for reports.js).
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, REPO } = require('./helpers/load-module');
const { seedFixture } = require('./helpers/sqlite');

async function freshApp() {
  const app = loadApp(['consts', 'db', 'ui', 'views']);
  globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
  await app.DB.boot();
  return app;
}

describe('Dashboard: Upcoming Milestones excludes overdue ones (lower bound on due_date)', () => {
  test('an overdue milestone appears only in the Overdue card, not in Upcoming', async () => {
    const { DB, UI, Views } = await freshApp();
    const { liveProject } = seedFixture(DB);

    const overdueDate = UI.todayPlusDays(-3);
    const upcomingDate = UI.todayPlusDays(3);

    DB.run(
      "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, 'Overdue Deliverable X', ?, 'pending')",
      [liveProject, overdueDate]
    );
    DB.run(
      "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, 'Upcoming Deliverable Y', ?, 'pending')",
      [liveProject, upcomingDate]
    );

    const html = Views.dashboard();

    // The overdue milestone's name must not appear twice (once per card) — it belongs in Overdue only.
    const overdueOccurrences = html.split('Overdue Deliverable X').length - 1;
    assert.equal(overdueOccurrences, 1, 'an overdue milestone must render in exactly one card (Overdue), not also in Upcoming');

    // The due-in-3-days milestone is genuinely upcoming and must still show up.
    assert.ok(html.includes('Upcoming Deliverable Y'), 'a milestone due within the next 30 days must appear in Upcoming Milestones');
  });

  test('11 overdue milestones do not crowd a genuinely upcoming one out of the Upcoming card', async () => {
    const { DB, UI, Views } = await freshApp();
    const { liveProject } = seedFixture(DB);

    for (let i = 0; i < 11; i++) {
      DB.run(
        "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, ?, ?, 'pending')",
        [liveProject, 'Overdue #' + i, UI.todayPlusDays(-1 - i)]
      );
    }
    DB.run(
      "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, 'The Real Upcoming One', ?, 'pending')",
      [liveProject, UI.todayPlusDays(2)]
    );

    const html = Views.dashboard();
    assert.ok(html.includes('The Real Upcoming One'), 'a truly upcoming milestone must not be pushed out of the LIMIT 10 by unrelated overdue rows');
  });
});
