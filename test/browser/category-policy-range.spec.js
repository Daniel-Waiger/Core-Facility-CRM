/* category-policy-range.spec.js — saveCategoryPolicies rejects a staff % outside [0,100] through
 * the real Settings form, instead of silently clamping/accepting it.
 *
 * Adversarial review (2026-09-11, finding M7/#4): DB.setCategoryPolicy already clamps a negative
 * to 0 (a defensive floor kept as-is here), but nothing stopped a negative OR an over-100 value
 * typed into the Category Billing card from being written as-is above 100, or silently rewritten
 * to 0 below it without a word to the admin who typed it. This exercises the actual Settings
 * screen (`.cat-policy-row` / `.cat-staff-pct` / `data-act="save-category-policies"`), not an
 * internal function call — pEditSave-style private functions in app.js are not reachable from a
 * unit test's DOM stub (see stub-dom.js), so this needs a real browser.
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN, setFlagScript } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

describe('Settings: Category Billing % is rejected outside [0,100]', { skip }, () => {
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
  });

  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.close();
  });

  async function goToSettingsAndGetFirstRow() {
    await page.evaluate(() => location.hash = '#/settings');
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const row = document.querySelector('.cat-policy-row');
      return row ? row.dataset.category : null;
    });
  }

  async function setFirstRowPctAndSave(value) {
    await page.evaluate((v) => {
      const row = document.querySelector('.cat-policy-row');
      row.querySelector('.cat-staff-pct').value = String(v);
    }, value);
    await page.evaluate(() => document.querySelector('[data-act="save-category-policies"]').click());
    await page.waitForTimeout(150);
  }

  test('a negative staff % is rejected with a toast naming the category, and nothing is written', async () => {
    const category = await goToSettingsAndGetFirstRow();
    assert.ok(category, 'the demo seed must carry at least one booking category to test against');
    const beforeRow = await page.evaluate((c) => DB.row('SELECT staff_pct FROM category_policies WHERE category=?', [c]), category);

    await setFirstRowPctAndSave(-25);

    const toastText = await page.evaluate(() => {
      const t = document.querySelector('.toast.error');
      return t ? t.textContent : null;
    });
    assert.ok(toastText, 'a rejection must show an error toast');
    assert.match(toastText, /between 0 and 100/i);
    assert.ok(toastText.includes(category), `toast must name the offending category ("${category}"): got "${toastText}"`);

    const afterRow = await page.evaluate((c) => DB.row('SELECT staff_pct FROM category_policies WHERE category=?', [c]), category);
    assert.deepEqual(afterRow, beforeRow, 'a rejected value must not be written at all — not even DB-level-clamped to 0');
  });

  test('a staff % over 100 is likewise rejected, and nothing is written', async () => {
    const category = await goToSettingsAndGetFirstRow();
    const beforeRow = await page.evaluate((c) => DB.row('SELECT staff_pct FROM category_policies WHERE category=?', [c]), category);

    await setFirstRowPctAndSave(150);

    const toastText = await page.evaluate(() => {
      const t = document.querySelector('.toast.error');
      return t ? t.textContent : null;
    });
    assert.ok(toastText, 'a rejection must show an error toast');
    assert.match(toastText, /between 0 and 100/i);

    const afterRow = await page.evaluate((c) => DB.row('SELECT staff_pct FROM category_policies WHERE category=?', [c]), category);
    assert.deepEqual(afterRow, beforeRow, 'a rejected value must not be written');
  });

  test('a valid in-range value (e.g. 42) still saves normally', async () => {
    const category = await goToSettingsAndGetFirstRow();
    await setFirstRowPctAndSave(42);
    const row = await page.evaluate((c) => DB.row('SELECT staff_pct FROM category_policies WHERE category=?', [c]), category);
    assert.equal(row.staff_pct, 42, 'an in-range value must still save exactly as typed');
  });
});
