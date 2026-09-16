/* output-type-fields.spec.js — the Research Outputs dialog shows only the fields that fit the
 * chosen output type (OUTPUT_TYPE_FIELDS in js/consts.js, applied by applyOutputTypeFields in
 * js/app.js). The unit suite proves the map and the string wiring; this proves the hidden
 * attribute actually wins in a real layout — `.field { display:flex }` used to beat `[hidden]`,
 * so a source-text check alone would have passed while every field stayed visible. */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN, waitForAppReady } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

describe('Research Outputs dialog: type-driven field visibility', { skip }, () => {
  let browser, srv, page;

  before(async () => {
    srv = await startServer();
    browser = await playwright.chromium.launch(chromiumLaunchOptions());
    const ctx = await browser.newContext({ timezoneId: 'Asia/Jerusalem' });
    await ctx.addInitScript(QUIET_FIRST_RUN);
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

  // Rendered visibility, not the attribute: offsetParent is null for display:none, and that is
  // what a hidden field must actually be.
  const visible = (name) => page.evaluate((n) => {
    const el = document.querySelector(`.modal [data-out-field="${n}"]`);
    return !!(el && el.offsetParent !== null);
  }, name);

  test('choosing a type without a DOI hides the DOI field; choosing publication shows it again', async () => {
    const projectId = await page.evaluate(() => DB.row('SELECT id FROM projects WHERE is_archived=0 ORDER BY id LIMIT 1').id);
    await page.evaluate((id) => App.route('project', id), projectId);
    await page.waitForTimeout(400);
    await page.click('[data-act="output-add"]');
    await page.waitForSelector('.modal #out-type');

    await page.selectOption('.modal #out-type', 'thesis');
    await page.waitForTimeout(100);
    assert.equal(await visible('doi'), false, 'a thesis has no DOI field');
    assert.equal(await visible('reference'), true, 'a thesis keeps its Reference field');

    await page.selectOption('.modal #out-type', 'publication');
    await page.waitForTimeout(100);
    assert.equal(await visible('doi'), true, 'a publication shows the DOI field');

    await page.evaluate(() => window.UI.closeAllModals());
  });
});
