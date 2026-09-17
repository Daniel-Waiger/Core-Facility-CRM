/* instrument-profile.test.js — Views.instrumentDetail (the Instrument Profile screen).
 *
 * Covers: the em-dash fallbacks a bare booking row falls back to across every column that has
 * one (User, Start–End, Duration, Assisted, Notes, Status), the Xh Ym duration string built on
 * UI.hoursBetween (never a second copy of that arithmetic — CLAUDE.md), the Assisted column
 * reading meeting_staff with the retired-name suffix, cancelled bookings kept in Recent Activity
 * and marked rather than hidden, the 14-day Upcoming Bookings window excluding anything further
 * out or cancelled, the Utilization tiles agreeing with Reports.computeInstrumentRows for the
 * exact same range (CLAUDE.md: "Reports: aggregation lives in one place, screen and export both
 * read it" — a screen figure that disagrees with Reports is exactly the class of bug that rule
 * exists to prevent), the Trained Users card reading DB.listInstrumentTraining with a status
 * badge, and the missing-instrument empty state.
 *
 * Loading order: views.js reads global.CONST/global.UI at load time and calls into
 * global.DB/global.Reports only inside function bodies, so ['consts','db','ui','views','reports']
 * is enough (mirrors dashboard.test.js/aggregation.test.js's load lists).
 *
 * Every fixture date here is built from UI.todayPlusDays/UI.today so the suite stays correct
 * under TZ='Asia/Jerusalem' (CLAUDE.md: "Dates are local calendar days") and every date used in a
 * range-based assertion is kept inside the range that assertion reads (docs/cma-lessons.md, the
 * #47 T5 lesson: a fixture dated outside the window it is asserted against can never pass).
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, REPO } = require('./helpers/load-module');
const { seedFixture } = require('./helpers/sqlite');

async function freshApp() {
  const app = loadApp(['consts', 'db', 'ui', 'views', 'reports']);
  globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
  await app.DB.boot();
  return app;
}

function lastId(DB) { return DB.row('SELECT last_insert_rowid() as id').id; }

// Slice the profile HTML down to one booking's row: from its title to the next closing </tr>.
// Only usable on a card whose row actually renders the title (Upcoming Bookings, Trained Users
// by person name) — Recent Activity's table has no Title column at all (User/Date/Start–End/
// Duration/Assisted/Notes/Status), so its rows are found with cardRows() below instead.
function rowFor(html, marker) {
  const start = html.indexOf(marker);
  assert.ok(start !== -1, `expected to find "${marker}" in the rendered page`);
  const end = html.indexOf('</tr>', start);
  assert.ok(end !== -1, `expected a closing </tr> after "${marker}"`);
  return html.slice(start, end);
}

// Every data <tr>...</tr> inside one named card's section (bounded by its own HTML comment and
// the next one), in document order. Used for Recent Activity, whose rows carry no title to
// search for directly.
function cardRows(html, cardComment) {
  const start = html.indexOf(`<!-- ${cardComment} -->`);
  assert.ok(start !== -1, `expected to find the "<!-- ${cardComment} -->" card in the rendered page`);
  const nextComment = html.indexOf('<!--', start + 1);
  const section = nextComment !== -1 ? html.slice(start, nextComment) : html.slice(start);
  const rows = section.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  // The header row uses <th>, not <td> — filter it out so callers only see data rows.
  return rows.filter((r) => r.includes('<td'));
}

describe('Instrument Profile', () => {
  test('em-dash fallbacks: a booking with no attendees, staff, note or times renders — in User, Start–End, Duration, Assisted, Notes and Status', async () => {
    const { DB, UI, Views } = await freshApp();
    const { scopeA } = seedFixture(DB);

    DB.run("INSERT INTO meetings (title, date) VALUES ('Bare Row', ?)", [UI.todayPlusDays(-2)]);
    const id = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [id, scopeA]);

    const html = Views.instrumentDetail(scopeA);
    const rows = cardRows(html, 'Recent Activity Card');
    assert.equal(rows.length, 1, 'expected exactly one Recent Activity row for this fixture');
    const row = rows[0];

    const dashes = (row.match(/—/g) || []).length;
    assert.ok(dashes >= 5, `expected at least 5 em-dashes in the bare row, got ${dashes}\n${row}`);
    assert.ok(!/undefined/.test(row), 'row must never render the literal string "undefined"');
    assert.ok(!/\bnull\b/.test(row), 'row must never render the literal string "null"');
  });

  test('Duration is UI.hoursBetween formatted Xh Ym', async () => {
    const { DB, UI, Views } = await freshApp();
    const { scopeA } = seedFixture(DB);

    DB.run("INSERT INTO meetings (title, date, start_time, end_time) VALUES ('Short Session', ?, '09:00', '10:30')", [UI.todayPlusDays(-1)]);
    const id1 = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [id1, scopeA]);

    DB.run("INSERT INTO meetings (title, date, start_time, end_time) VALUES ('Long Session', ?, '09:00', '11:00')", [UI.todayPlusDays(-2)]);
    const id2 = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [id2, scopeA]);

    const html = Views.instrumentDetail(scopeA);
    const rows = cardRows(html, 'Recent Activity Card');
    assert.equal(rows.length, 2, 'expected two Recent Activity rows for this fixture');
    const shortRow = rows.find((r) => r.includes('09:00–10:30'));
    const longRow = rows.find((r) => r.includes('09:00–11:00'));
    assert.ok(shortRow, 'expected to find the 09:00-10:30 booking row');
    assert.ok(longRow, 'expected to find the 09:00-11:00 booking row');
    assert.ok(shortRow.includes('1h 30m'), '09:00-10:30 must render as "1h 30m"');
    assert.ok(longRow.includes('2h 0m'), '09:00-11:00 must render as "2h 0m"');
  });

  test('Assisted lists meeting_staff names, retired suffix included', async () => {
    const { DB, UI, Views } = await freshApp();
    const { scopeA, sam } = seedFixture(DB);

    DB.run("INSERT INTO meetings (title, date, start_time, end_time) VALUES ('Assisted Session', ?, '09:00', '10:00')", [UI.todayPlusDays(-1)]);
    const id = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [id, scopeA]);
    DB.run('INSERT INTO meeting_staff (meeting_id, person_id) VALUES (?,?)', [id, sam]);

    let row = cardRows(Views.instrumentDetail(scopeA), 'Recent Activity Card')[0];
    assert.ok(row.includes('Sam'), 'the Assisted column must list the meeting_staff person by name');

    DB.setRetired('people', sam, true);
    row = cardRows(Views.instrumentDetail(scopeA), 'Recent Activity Card')[0];
    assert.ok(row.includes('Sam (Retired)'), 'a retired staff member must show the "(Retired)" suffix in Assisted');
  });

  test('Recent Activity keeps a cancelled booking and marks it', async () => {
    const { DB, UI, Views } = await freshApp();
    const { scopeA } = seedFixture(DB);

    DB.run(
      "INSERT INTO meetings (title, date, start_time, end_time, is_cancelled, billing_retained) VALUES ('Cancelled Session', ?, '09:00', '10:00', 1, 1)",
      [UI.todayPlusDays(-1)]
    );
    const id = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [id, scopeA]);

    const html = Views.instrumentDetail(scopeA);
    const row = cardRows(html, 'Recent Activity Card')[0];
    assert.ok(row.includes('badge danger">Cancelled'), 'a cancelled booking must show the Cancelled badge in its Status column');
    assert.ok(row.includes('row-retired'), 'a cancelled booking\'s row must carry the row-retired styling class');
  });

  test('Upcoming Bookings shows a booking 3 days out and not one 20 days out, and never a cancelled one', async () => {
    const { DB, UI, Views } = await freshApp();
    const { scopeA } = seedFixture(DB);

    DB.run("INSERT INTO meetings (title, date, start_time, end_time) VALUES ('Soon Session', ?, '09:00', '10:00')", [UI.todayPlusDays(3)]);
    const soonId = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [soonId, scopeA]);

    DB.run("INSERT INTO meetings (title, date, start_time, end_time) VALUES ('Far Session', ?, '09:00', '10:00')", [UI.todayPlusDays(20)]);
    const farId = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [farId, scopeA]);

    DB.run(
      "INSERT INTO meetings (title, date, start_time, end_time, is_cancelled, billing_retained) VALUES ('Cancelled Soon Session', ?, '09:00', '10:00', 1, 0)",
      [UI.todayPlusDays(2)]
    );
    const cancelId = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [cancelId, scopeA]);

    const html = Views.instrumentDetail(scopeA);
    const upcomingCard = html.slice(html.indexOf('Upcoming Bookings'), html.indexOf('Recent Activity'));

    assert.ok(upcomingCard.includes('Soon Session'), 'a booking 3 days out must appear in the 14-day Upcoming Bookings window');
    assert.ok(!upcomingCard.includes('Far Session'), 'a booking 20 days out must not appear in the 14-day Upcoming Bookings window');
    assert.ok(!upcomingCard.includes('Cancelled Soon Session'), 'a cancelled booking must never appear in Upcoming Bookings, however soon it falls');
  });

  test('Utilization tiles equal Reports.computeInstrumentRows for the same range', async () => {
    const { DB, UI, Views, Reports } = await freshApp();
    const { scopeA, alice } = seedFixture(DB);

    const now = new Date();
    const monthFrom = UI.ymd(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = UI.today();
    // "Another day" per the brief, but still inside the [monthFrom, to] range this test reads
    // (docs/cma-lessons.md #47 T5 lesson) — monthFrom itself always qualifies, and only equals
    // `to` on the 1st of the month, which is fine too.
    const day2 = monthFrom !== to ? monthFrom : to;

    DB.run("INSERT INTO meetings (title, date, start_time, end_time, total_cost) VALUES ('Live Booking', ?, '09:00', '11:00', 200)", [to]);
    const liveId = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id, line_cost) VALUES (?,?,200)', [liveId, scopeA]);
    DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [liveId, alice]);

    DB.run(
      "INSERT INTO meetings (title, date, start_time, end_time, total_cost, is_cancelled, billing_retained) VALUES ('Retained Cancelled Booking', ?, '09:00', '10:00', 100, 1, 1)",
      [day2]
    );
    const cancelId = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id, line_cost) VALUES (?,?,100)', [cancelId, scopeA]);

    const html = Views.instrumentDetail(scopeA);

    function tileValue(prefix, name) {
      const re = new RegExp(`data-tile="${prefix}-${name}" data-value="([^"]*)"`);
      const m = html.match(re);
      assert.ok(m, `expected to find data-tile="${prefix}-${name}" in the rendered page`);
      return m[1];
    }

    const report = Reports.computeInstrumentRows(monthFrom, to).rows.find((r) => r.id === scopeA);
    assert.ok(report, 'computeInstrumentRows must have a row for this instrument over the same range');
    assert.equal(report.bookings, 1, 'a retained-cancelled booking must not count toward occupancy bookings');
    assert.equal(report.hours, 2, 'only the live booking\'s hours count toward occupancy hours');
    assert.equal(report.revenue, 300, 'a retained cancellation still bills, so revenue includes both line costs');

    assert.equal(Number(tileValue('month', 'bookings')), report.bookings, 'the month-bookings tile must equal computeInstrumentRows');
    assert.equal(Number(tileValue('month', 'hours')), report.hours, 'the month-hours tile must equal computeInstrumentRows');
    assert.equal(Number(tileValue('month', 'charges')), report.revenue, 'the month-charges tile must equal computeInstrumentRows');
    assert.equal(Number(tileValue('month', 'users')), 1, 'one distinct attendee (alice) on the live booking must count as 1 in month-users');
  });

  test('Trained Users lists DB.listInstrumentTraining rows with level and status badge', async () => {
    const { DB, UI, Views } = await freshApp();
    const { scopeA, alice } = seedFixture(DB);

    DB.run(
      "INSERT INTO person_instrument_training (person_id, instrument_id, level, trained_on, expires_on) VALUES (?, ?, 'Regular', ?, ?)",
      [alice, scopeA, UI.todayPlusDays(-30), UI.todayPlusDays(-1)]
    );

    const html = Views.instrumentDetail(scopeA);
    const row = rowFor(html, 'Alice');
    assert.ok(row.includes('Regular'), 'the training level must render');
    assert.ok(row.includes('Expired'), 'a training row expired yesterday must show the Expired badge');
  });

  test('the missing-instrument empty state renders', async () => {
    const { Views } = await freshApp();
    const html = Views.instrumentDetail(999999);
    assert.ok(html.includes('Instrument not found'), 'a nonexistent instrument id must render the empty state, not throw');
  });
});
