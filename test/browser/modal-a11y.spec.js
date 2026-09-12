/* modal-a11y.spec.js — item 12 (adversarial review of PR #44): UI.openModal set role="dialog"
 * with no accessible name at all (no aria-labelledby/aria-label), so a screen reader announced
 * every dialog this app opens — from "New Booking" to a plain danger confirm — as an unnamed
 * "dialog". Covers UI.openModal's generic `.modal-title` labelling and confirmModal's fallback
 * labelling (its title lives in `.head`/`.t`, not `.modal-title`), across several real dialogs.
 */
'use strict';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN, setFlagScript, waitForAppReady } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

describe('modal accessibility: every opened dialog has an accessible name', { skip }, () => {
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
    await waitForAppReady(page);
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

  // Resolves the accessible name the way a screen reader would: aria-labelledby's referenced
  // element's text, else aria-label, else nothing.
  async function topModalAccessibleName() {
    return page.evaluate(() => {
      const m = document.querySelector('.modal-dim:last-of-type .modal');
      if (!m) return null;
      const labelledBy = m.getAttribute('aria-labelledby');
      if (labelledBy) {
        const el = document.getElementById(labelledBy);
        return el ? el.textContent.trim() : '';
      }
      return m.getAttribute('aria-label');
    });
  }

  test('a `newX`-style dialog (New Project) is named via aria-labelledby -> .modal-title', async () => {
    await page.evaluate(() => App.route('projects'));
    await page.waitForTimeout(150);
    await page.click('[data-act="new-project"]');
    await page.waitForSelector('#np-title');

    const name = await topModalAccessibleName();
    assert.ok(name && name.length, 'expected a non-empty accessible name');
    const titleText = await page.evaluate(() => {
      const el = document.querySelector('.modal-dim:last-of-type .modal .modal-title');
      return el ? el.textContent.trim() : null;
    });
    assert.equal(name, titleText, 'the accessible name must be exactly the .modal-title text');
  });

  test('a danger confirmModal (no .modal-title) still gets an accessible name via aria-label', async () => {
    await page.evaluate(() => {
      window.UI.confirmModal('Delete Field', 'Delete this? This cannot be undone.', { danger: true, confirmText: 'Delete' });
    });
    await page.waitForSelector('.modal-dim');

    const name = await topModalAccessibleName();
    assert.ok(name && name.length, 'expected a non-empty accessible name for a confirmModal dialog');
    assert.match(name, /Delete Field/);

    await page.click('[data-act="no"]');
  });

  test('a nested dialog (Log Booking opened from Today\'s Agenda) is independently named', async () => {
    await page.evaluate(() => App.route('calendar'));
    await page.waitForTimeout(150);
    await page.click('[data-act="open-today-modal"]');
    await page.waitForSelector('.modal:has-text("Today\'s Agenda")');

    const agendaName = await topModalAccessibleName();
    assert.match(agendaName || '', /Today's Agenda/);

    await page.click('[data-act="add-meeting"]');
    await page.waitForSelector('#bk-title');

    const nestedName = await topModalAccessibleName();
    assert.ok(nestedName && nestedName.length, 'expected the nested New Booking dialog to have its own accessible name');
    assert.match(nestedName, /New Booking/);
    assert.notEqual(nestedName, agendaName, 'the nested dialog must not just inherit the agenda\'s name');
  });
});
