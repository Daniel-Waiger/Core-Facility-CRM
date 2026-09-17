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

describe("Dashboard: Today's Agenda card", () => {
  test("a booking today appears inside the section after 'Bookings Today' with data-act=\"edit-booking\", a booking tomorrow does not", async () => {
    const { DB, UI, Views } = await freshApp();
    seedFixture(DB);

    DB.run(
      "INSERT INTO meetings (title, date, start_time, end_time) VALUES ('Agenda Booking Z', ?, '10:00', '11:00')",
      [UI.today()]
    );
    DB.run(
      "INSERT INTO meetings (title, date) VALUES ('Tomorrow Q', ?)",
      [UI.todayPlusDays(1)]
    );

    const html = Views.dashboard();
    const agenda = html.split("Today's Agenda")[1] || '';
    const bookingsSection = agenda.split('Bookings Today')[1] || '';

    assert.ok(bookingsSection.includes('Agenda Booking Z'), "today's booking must appear under Bookings Today");
    assert.ok(bookingsSection.includes('data-act="edit-booking"'), 'the booking row must be wired to edit-booking');
    assert.ok(!agenda.includes('Tomorrow Q'), "tomorrow's booking must not appear in Today's Agenda");
  });

  test('a facility-wide booking (project_id NULL) on today appears with Facility-wide', async () => {
    const { DB, UI, Views } = await freshApp();
    seedFixture(DB);

    DB.run(
      "INSERT INTO meetings (title, date, start_time, end_time) VALUES ('No Project Booking', ?, '09:00', '09:30')",
      [UI.today()]
    );

    const html = Views.dashboard();
    const agenda = html.split("Today's Agenda")[1] || '';
    assert.ok(agenda.includes('No Project Booking'), 'the facility-wide booking must appear');
    assert.ok(agenda.includes('Facility-wide'), 'a booking with no project must be labelled Facility-wide');
  });

  test('a milestone due today on liveProject appears under Milestones Due Today, one due today on archivedProject does not', async () => {
    const { DB, UI, Views } = await freshApp();
    const { liveProject, archivedProject } = seedFixture(DB);

    DB.run(
      "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, 'Due Today M', ?, 'pending')",
      [liveProject, UI.today()]
    );
    DB.run(
      "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?, 'Archived Due A', ?, 'pending')",
      [archivedProject, UI.today()]
    );

    const html = Views.dashboard();
    const agenda = html.split("Today's Agenda")[1] || '';
    const msSection = agenda.split('Milestones Due Today')[1] || '';
    assert.ok(msSection.includes('Due Today M'), 'a milestone due today on a live project must appear under Milestones Due Today');
    assert.ok(!agenda.includes('Archived Due A'), 'a milestone due today on an archived project must not appear in Today\'s Agenda');
  });

  test('the card title contains "Today\'s Agenda"', async () => {
    const { DB, Views } = await freshApp();
    seedFixture(DB);
    const html = Views.dashboard();
    assert.ok(html.includes("Today's Agenda"), 'the dashboard must render a card titled Today\'s Agenda');
  });
});
