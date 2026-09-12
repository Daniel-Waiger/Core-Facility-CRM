/* attendee-refresh.spec.js — pEditSave only recomputes meetings.attendees on an actual rename.
 *
 * CLAUDE.md: "keep both in sync on every save" — the denormalized meetings.attendees display
 * string must track the real meeting_people join table. The adversarial review (2026-09-11,
 * finding M2/#5) found pEditSave never refreshed it at all, and separately warned that once it
 * does, refreshing unconditionally on every person save (email/note/rate edits included) walks
 * every meeting a long-attending person has ever been on for no reason — real cost for zero
 * benefit when the name didn't change.
 *
 * This needs a real browser: pEditSave reads `UI.topModal()` and real <input> elements, neither
 * of which the unit-test DOM stub provides (see stub-dom.js — querySelector always returns null).
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN, setFlagScript } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

describe('attendee refresh on person rename', { skip }, () => {
  let browser, srv, page;

  before(async () => {
    srv = await startServer();
    browser = await playwright.chromium.launch(chromiumLaunchOptions());
    const ctx = await browser.newContext({ timezoneId: 'Asia/Jerusalem' });
    await ctx.addInitScript(QUIET_FIRST_RUN);
    await ctx.addInitScript(setFlagScript('admin-mode', '1'));
    page = await ctx.newPage();
    await page.goto(srv.base + '/index.html?demo=1');
    await page.waitForFunction(() => window.DB && window.App);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.UI && UI.stopTour && UI.stopTour());

    // Build a small, self-contained fixture rather than depending on which demo rows happen to
    // attend which booking: one person, one booking that lists them as an attendee both in the
    // denormalized string and in meeting_people (the correct way to write both, per CLAUDE.md).
    await page.evaluate(() => {
      DB.run("INSERT INTO people (name, type, is_staff, rate) VALUES ('Refresh Target','Researcher',0,0)");
      window.__personId = DB.row('SELECT last_insert_rowid() as id').id;
      DB.run("INSERT INTO meetings (title, date, attendees) VALUES ('Fixture Meeting', '2026-01-01', 'Refresh Target')");
      window.__meetingId = DB.row('SELECT last_insert_rowid() as id').id;
      DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [window.__meetingId, window.__personId]);
    });
  });

  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.close();
  });

  async function openEditPersonAndSave(newName, newNote) {
    await page.evaluate(() => location.hash = '#/people');
    await page.waitForTimeout(300);
    await page.evaluate((id) => {
      document.querySelector(`[data-act="edit-person"][data-id="${id}"]`).click();
    }, await page.evaluate(() => window.__personId));
    await page.waitForTimeout(250);
    await page.evaluate(([name, note]) => {
      const m = UI.topModal ? UI.topModal() : document.querySelector('.modal');
      if (name != null) m.querySelector('#pe-name').value = name;
      if (note != null) m.querySelector('#pe-note').value = note;
    }, [newName, newNote]);
    await page.evaluate(() => {
      const m = UI.topModal ? UI.topModal() : document.querySelector('.modal');
      m.querySelector('[data-act="p-edit-save"]').click();
    });
    await page.waitForTimeout(300);
  }

  test('renaming the person updates the stale meetings.attendees string to the new name, via exactly one DB.refreshAttendeesForPerson call', async () => {
    const before1 = await page.evaluate(() => DB.row('SELECT attendees FROM meetings WHERE id=?', [window.__meetingId]).attendees);
    assert.equal(before1, 'Refresh Target');

    const calls = await page.evaluate(async () => {
      const real = DB.refreshAttendeesForPerson;
      let n = 0;
      DB.refreshAttendeesForPerson = function (...args) { n++; return real.apply(DB, args); };
      window.__renameSpyCalls = () => n;
      return 'installed';
    });
    assert.equal(calls, 'installed');

    await openEditPersonAndSave('Refresh Target Renamed', null);

    const n = await page.evaluate(() => window.__renameSpyCalls());
    assert.equal(n, 1, 'a real rename must call DB.refreshAttendeesForPerson exactly once');

    const after1 = await page.evaluate(() => DB.row('SELECT attendees FROM meetings WHERE id=?', [window.__meetingId]).attendees);
    assert.equal(after1, 'Refresh Target Renamed', 'meetings.attendees must track a real rename, per CLAUDE.md "keep both in sync on every save"');
  });

  test('an edit that does NOT change the name (email/note only) never calls DB.refreshAttendeesForPerson — no wasted work', async () => {
    // Spy on DB.refreshAttendeesForPerson itself (a real property on the DB object, looked up
    // fresh on every `DB.refreshAttendeesForPerson(id)` call app.js makes — unlike the plain
    // `run(...)` calls INSIDE that function, which close over db.js's private local and so
    // cannot be intercepted from outside; spying one level up, at the function app.js actually
    // calls, is what "assert query counts" means here without reaching into module internals).
    const calls = await page.evaluate(async () => {
      const real = DB.refreshAttendeesForPerson;
      let n = 0;
      DB.refreshAttendeesForPerson = function (...args) { n++; return real.apply(DB, args); };
      document.querySelector(`[data-act="edit-person"][data-id="${window.__personId}"]`).click();
      await new Promise((r) => setTimeout(r, 250));
      const m = UI.topModal ? UI.topModal() : document.querySelector('.modal');
      m.querySelector('#pe-note').value = 'a harmless note edit, no rename';
      m.querySelector('[data-act="p-edit-save"]').click();
      await new Promise((r) => setTimeout(r, 250));
      DB.refreshAttendeesForPerson = real;
      return n;
    });
    assert.equal(calls, 0, 'an email/note/rate-only edit must not call DB.refreshAttendeesForPerson at all — the whole point of the guard is skipping this work when the name did not change');

    const stillNew = await page.evaluate(() => DB.row('SELECT attendees FROM meetings WHERE id=?', [window.__meetingId]).attendees);
    assert.equal(stillNew, 'Refresh Target Renamed', 'attendees string is unaffected by a non-rename edit');
  });
});
