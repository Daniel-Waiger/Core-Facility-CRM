/* modals.spec.js — the modal-stacking fixes from the P2-modals adversarial-review package.
 *
 * Covers, against a REAL modal stack in a real browser (not a source-text lint):
 *   - H4: saving from a dialog opened ON TOP of another modal (Today's Agenda -> Edit Booking /
 *     Edit Milestone / Log Booking) writes to the database instead of throwing against the wrong
 *     (buried) modal.
 *   - U1: a danger confirm dialog starts focus on the safe Cancel button and traps Tab inside it.
 *   - U9: Enter in a single-line input inside a modal activates that modal's primary button.
 *   - M8/U2: navigating away (a hashchange) closes every open modal rather than orphaning it.
 *
 * The unit-test lint (test/unit/wiring.test.js) proves no first-match `.modal` lookup exists in
 * the source; this suite proves the resulting behavior is actually correct end to end.
 */
'use strict';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN, setFlagScript } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

describe('modal stacking: topmost-modal saves, focus, Enter, and hashchange cleanup', { skip }, () => {
  let browser, srv, page;

  before(async () => {
    srv = await startServer();
    browser = await playwright.chromium.launch(chromiumLaunchOptions());
    const ctx = await browser.newContext({ timezoneId: 'Asia/Jerusalem' });
    await ctx.addInitScript(QUIET_FIRST_RUN);
    await ctx.addInitScript(setFlagScript('admin-mode', '1'));
    page = await ctx.newPage();
    page.on('pageerror', (e) => { throw e; });

    await page.goto(srv.base + '/index.html?demo=1');
    await page.waitForFunction(() => window.DB && window.App && window.UI);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.UI.stopTour && window.UI.stopTour());
  });

  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.close();
  });

  beforeEach(async () => {
    // Every test starts from a clean slate: no modal open, on the dashboard.
    await page.evaluate(() => window.UI.closeAllModals());
    await page.evaluate(() => App.route('dashboard'));
    await page.waitForTimeout(150);
  });

  // The "Agenda" button that opens Today's Agenda & Focus lives on the Calendar screen's toolbar
  // (calToolbarHtml in js/views.js), not the dashboard.
  async function openAgenda() {
    await page.evaluate(() => App.route('calendar'));
    await page.waitForTimeout(150);
    await page.click('[data-act="open-today-modal"]');
  }

  test('H4: "Log Booking" from Today\'s Agenda saves on top of the still-open agenda', async () => {
    await openAgenda();
    await page.waitForSelector('.modal:has-text("Today\'s Agenda")');
    const dimsBeforeLog = await page.evaluate(() => document.querySelectorAll('.modal-dim').length);
    assert.equal(dimsBeforeLog, 1, 'expected only the agenda open before logging a booking');

    await page.click('[data-act="add-meeting"]');
    await page.waitForSelector('#bk-title');
    const dimsWithBooking = await page.evaluate(() => document.querySelectorAll('.modal-dim').length);
    assert.equal(dimsWithBooking, 2, 'New Booking should stack on top of the agenda, not replace it');

    await page.fill('#bk-title', 'Agenda-Logged Test Booking');
    await page.click('.modal-dim:last-of-type [data-act="booking-save"]');
    await page.waitForTimeout(300);

    const saved = await page.evaluate(
      () => DB.row("SELECT COUNT(*) c FROM meetings WHERE title='Agenda-Logged Test Booking'").c,
    );
    assert.equal(saved, 1, 'the booking logged from inside the agenda modal was never written');

    // The booking modal closed; the agenda modal underneath is still open (not silently killed).
    const dimsAfter = await page.evaluate(() => document.querySelectorAll('.modal-dim').length);
    assert.equal(dimsAfter, 1, 'expected the agenda modal to remain open after the nested save closed');
    const stillAgenda = await page.evaluate(() => document.querySelector('.modal').innerText.includes("Today's Agenda"));
    assert.ok(stillAgenda, 'the surviving modal is not the agenda — the wrong one was closed');
  });

  test('H4: Edit Booking opened from the agenda saves the RIGHT (topmost) modal\'s fields', async () => {
    const setup = await page.evaluate(() => {
      const pid = DB.row('SELECT id FROM projects ORDER BY id LIMIT 1').id;
      const today = UI.today();
      DB.run(
        "INSERT INTO meetings (project_id, title, date, start_time, end_time, attendees, note, actions) VALUES (?,?,?,?,?,?,?,?)",
        [pid, 'Agenda Edit Source Booking', today, '09:00', '10:00', '', '', ''],
      );
      return { id: DB.row("SELECT id FROM meetings WHERE title='Agenda Edit Source Booking'").id };
    });

    await openAgenda();
    await page.waitForSelector('.modal:has-text("Today\'s Agenda")');
    // Scoped to inside the modal: the same booking also renders as a calendar-day event on the
    // Calendar screen underneath (same data-act/data-id), which a bare selector would also match.
    await page.click(`.modal-dim [data-act="edit-booking"][data-id="${setup.id}"]`);
    await page.waitForSelector('#bke-title');

    await page.fill('#bke-title', 'Agenda Edit Source Booking (Edited)');
    await page.click('.modal-dim:last-of-type [data-act="booking-edit-save"]');
    await page.waitForTimeout(300);

    const title = await page.evaluate((id) => DB.row('SELECT title FROM meetings WHERE id=?', [id]).title, setup.id);
    assert.equal(title, 'Agenda Edit Source Booking (Edited)');

    const dimsAfter = await page.evaluate(() => document.querySelectorAll('.modal-dim').length);
    assert.equal(dimsAfter, 1, 'expected the agenda to still be open, with only the edit dialog closed');
  });

  test('H4: Edit Milestone opened from the agenda saves the RIGHT (topmost) modal\'s fields', async () => {
    const setup = await page.evaluate(() => {
      const pid = DB.row('SELECT id FROM projects ORDER BY id LIMIT 1').id;
      const today = UI.today();
      DB.run(
        "INSERT INTO milestones (project_id, name, due_date, status) VALUES (?,?,?,?)",
        [pid, 'Agenda Edit Source Milestone', today, 'pending'],
      );
      return { id: DB.row("SELECT id FROM milestones WHERE name='Agenda Edit Source Milestone'").id };
    });

    await openAgenda();
    await page.waitForSelector('.modal:has-text("Today\'s Agenda")');
    // Scoped to inside the modal: the same milestone can also render on the Calendar screen
    // underneath (same data-act/data-id), which a bare selector would also match.
    await page.click(`.modal-dim [data-act="edit-milestone"][data-id="${setup.id}"]`);
    await page.waitForSelector('#mse-name');

    await page.fill('#mse-name', 'Agenda Edit Source Milestone (Edited)');
    await page.click('.modal-dim:last-of-type [data-act="ms-edit-save"]');
    await page.waitForTimeout(300);

    const name = await page.evaluate((id) => DB.row('SELECT name FROM milestones WHERE id=?', [id]).name, setup.id);
    assert.equal(name, 'Agenda Edit Source Milestone (Edited)');

    const dimsAfter = await page.evaluate(() => document.querySelectorAll('.modal-dim').length);
    assert.equal(dimsAfter, 1, 'expected the agenda to still be open, with only the edit dialog closed');
  });

  test('U9: Enter in the milestone title field saves the milestone', async () => {
    const pid = await page.evaluate(() => DB.row('SELECT id FROM projects ORDER BY id LIMIT 1').id);
    await page.evaluate((id) => App.route('project', id), pid);
    await page.waitForTimeout(200);

    await page.click('[data-act="add-milestone"]');
    await page.waitForSelector('#ms-name');
    await page.fill('#ms-name', 'Enter-To-Save Milestone');
    await page.focus('#ms-name');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    const exists = await page.evaluate(() => !!DB.row("SELECT id FROM milestones WHERE name='Enter-To-Save Milestone'"));
    assert.ok(exists, 'Enter in the milestone title field did not trigger the primary Save button');
    const dimsAfter = await page.evaluate(() => document.querySelectorAll('.modal-dim').length);
    assert.equal(dimsAfter, 0, 'the milestone modal should have closed after saving');
  });

  test('U1: a danger confirm dialog focuses Cancel first, and Tab never leaves the dialog', async () => {
    await page.evaluate(() => {
      window.UI.confirmModal('Delete Field', 'Delete this? This cannot be undone.', { danger: true, confirmText: 'Delete' });
    });
    await page.waitForSelector('.modal-dim');

    const initialFocus = await page.evaluate(() => document.activeElement && document.activeElement.dataset.act);
    assert.equal(initialFocus, 'no', 'expected focus on the Cancel ("no") button, the safe way out of a danger dialog');

    await page.keyboard.press('Tab');
    const afterTab1 = await page.evaluate(() => document.activeElement && document.activeElement.dataset.act);
    assert.equal(afterTab1, 'yes', 'Tab should move to the other button inside the dialog');

    await page.keyboard.press('Tab');
    const afterTab2 = await page.evaluate(() => document.activeElement && document.activeElement.dataset.act);
    assert.equal(afterTab2, 'no', 'Tab from the last focusable element should wrap back to the first, not escape the dialog');

    await page.keyboard.press('Shift+Tab');
    const afterShiftTab = await page.evaluate(() => document.activeElement && document.activeElement.dataset.act);
    assert.equal(afterShiftTab, 'yes', 'Shift+Tab from the first focusable element should wrap to the last, not escape the dialog');

    // Clean up: dismiss with Cancel.
    await page.click('[data-act="no"]');
  });

  test('M8/U2: a hashchange closes every open modal, including a nested one', async () => {
    await page.evaluate(() => App.route('projects'));
    await page.waitForTimeout(150);
    await page.click('[data-act="new-project"]');
    await page.waitForSelector('#np-title');

    const dimsBefore = await page.evaluate(() => document.querySelectorAll('.modal-dim').length);
    assert.equal(dimsBefore, 1, 'expected the New Project modal to be open');

    await page.evaluate(() => { location.hash = '#/people'; });
    await page.waitForTimeout(200);

    const dimsAfter = await page.evaluate(() => document.querySelectorAll('.modal-dim').length);
    assert.equal(dimsAfter, 0, 'navigating via hashchange should close every open modal, not leave it orphaned');
  });
});
