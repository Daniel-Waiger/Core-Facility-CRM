/* booking-date-required.spec.js — item 10 (adversarial review of PR #44): bookingSave used to
 * replace a blank date with UI.today() rather than refuse the save, so a facility that cleared
 * the date field by accident got a booking silently dated today instead of a warning. Must now
 * refuse with the same sentence-case toast the edit path ("Date is required") already used, and
 * mark the field invalid — while the common (New Booking opened with a prefilled date) path stays
 * unchanged.
 */
'use strict';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN, setFlagScript } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

describe('New Booking: a cleared date is refused, not silently defaulted to today', { skip }, () => {
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
    await page.evaluate(() => window.UI.closeAllModals());
    await page.evaluate(() => App.route('dashboard'));
    await page.waitForTimeout(150);
  });

  test('Project Detail "+ Add Booking" opens with a prefilled date (the common path is unchanged)', async () => {
    const pid = await page.evaluate(() => DB.row('SELECT id FROM projects ORDER BY id LIMIT 1').id);
    await page.evaluate((id) => App.route('project', id), pid);
    await page.waitForTimeout(200);
    await page.click('[data-act="add-meeting"]');
    await page.waitForSelector('#bk-date');
    const dateVal = await page.evaluate(() => document.getElementById('bk-date').value);
    const today = await page.evaluate(() => UI.today());
    assert.equal(dateVal, today, 'New Booking opened from a project should still be prefilled with today');
  });

  test("Today's Agenda \"+ Log Booking\" also opens with a prefilled date", async () => {
    await page.evaluate(() => App.route('calendar'));
    await page.waitForTimeout(150);
    await page.click('[data-act="open-today-modal"]');
    await page.waitForSelector('.modal:has-text("Today\'s Agenda")');
    await page.click('[data-act="add-meeting"]');
    await page.waitForSelector('#bk-title');
    const dateVal = await page.evaluate(() => document.getElementById('bk-date').value);
    const today = await page.evaluate(() => UI.today());
    assert.equal(dateVal, today, 'Log Booking from the Agenda should still be prefilled with today');
  });

  test('clearing the date field and saving is refused with "Date is required", not silently saved as today', async () => {
    const pid = await page.evaluate(() => DB.row('SELECT id FROM projects ORDER BY id LIMIT 1').id);
    await page.evaluate((id) => App.route('project', id), pid);
    await page.waitForTimeout(200);
    await page.click('[data-act="add-meeting"]');
    await page.waitForSelector('#bk-date');

    await page.fill('#bk-title', 'Cleared Date Booking');
    await page.fill('#bk-date', '');
    await page.click('[data-act="booking-save"]');
    await page.waitForTimeout(250);

    const toastText = await page.evaluate(() => {
      const el = document.querySelector('#toasts .toast.error:last-child');
      return el ? el.textContent : null;
    });
    assert.match(toastText || '', /Date is required/);

    const invalid = await page.evaluate(() => document.getElementById('bk-date').classList.contains('is-invalid'));
    assert.equal(invalid, true, 'the date field must be marked invalid');

    // The modal must still be open (nothing saved) and no booking with today's date must exist.
    const stillOpen = await page.evaluate(() => !!document.querySelector('#bk-title'));
    assert.equal(stillOpen, true, 'the New Booking modal must remain open after the refusal');
    const savedAnyway = await page.evaluate(() => !!DB.row("SELECT id FROM meetings WHERE title='Cleared Date Booking'"));
    assert.equal(savedAnyway, false, 'a booking with a cleared date must never be saved, not even defaulted to today');
  });
});
