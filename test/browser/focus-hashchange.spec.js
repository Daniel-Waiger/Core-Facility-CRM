/* focus-hashchange.spec.js — a real route change moves focus to the new screen's heading, so a
 * keyboard/screen-reader user is never left on document.body.
 *
 * Adversarial review (2026-09-11, finding U2/#6): once focus is on a field that has no
 * same-id counterpart on the destination screen, renderView's own focus-restore (by element id)
 * cannot find anything to restore to, and the DOM's default is to drop focus on document.body —
 * silent, and disorienting for anyone not looking at the screen to see the new page render.
 *
 * Needs a real browser (real focus/activeElement semantics; the unit-test DOM stub tracks no
 * such state at all — see stub-dom.js).
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN, setFlagScript, waitForAppReady } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

describe('focus after a hashchange route', { skip }, () => {
  let browser, srv, page;

  before(async () => {
    srv = await startServer();
    browser = await playwright.chromium.launch(chromiumLaunchOptions());
    const ctx = await browser.newContext({ timezoneId: 'Asia/Jerusalem' });
    await ctx.addInitScript(QUIET_FIRST_RUN);
    await ctx.addInitScript(setFlagScript('admin-mode', '1'));
    page = await ctx.newPage();
    await page.goto(srv.base + '/index.html?demo=1');
    await waitForAppReady(page);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.UI && UI.stopTour && UI.stopTour());
  });

  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.close();
  });

  test('#page-title carries tabindex="-1" (focusable by script, never by Tab)', async () => {
    const tabindex = await page.evaluate(() => document.getElementById('page-title').getAttribute('tabindex'));
    assert.equal(tabindex, '-1');
  });

  test('navigating to People, focusing a field with no counterpart on Instruments, then navigating there lands focus on the new heading, not document.body', async () => {
    await page.evaluate(() => location.hash = '#/people');
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('people-search').focus());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'people-search');

    await page.evaluate(() => location.hash = '#/instruments');
    await page.waitForTimeout(300);

    const activeId = await page.evaluate(() => document.activeElement && document.activeElement.id);
    const isBody = await page.evaluate(() => document.activeElement === document.body);
    assert.equal(isBody, false, 'focus must not be left on document.body after the route change');
    assert.equal(activeId, 'page-title', 'focus lands on the new screen\'s own heading');
    assert.equal(await page.evaluate(() => document.getElementById('page-title').textContent), 'Core Instruments');
  });

  test('a same-screen data refresh (typing in the People search box) does NOT steal focus away to the heading', async () => {
    await page.evaluate(() => location.hash = '#/people');
    await page.waitForTimeout(300);
    await page.click('#people-search');
    await page.keyboard.type('a');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'people-search', 'renderView\'s existing focus-restore keeps focus in the live search box on every keystroke — applyRoute\'s heading-focus must never run for a same-screen refresh');
  });

  test('a route change while a modal is open closes it (M8/U2) and lands focus on the new heading', async () => {
    await page.evaluate(() => location.hash = '#/people');
    await page.waitForTimeout(300);
    await page.click('[data-act="add-person"]');
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => !!document.querySelector('.modal-dim')), 'expected the Add Person modal to actually be open before navigating away');

    // A route change (hashchange) closes every open modal (M8/U2, see modals.spec.js) rather than
    // orphaning it — so this must ALWAYS be observable, not merely "if the modal happens to still
    // be open". A conditional assertion here would quietly stop testing anything the moment the
    // modal-close fix landed, which is exactly what happened before this fix.
    await page.evaluate(() => { location.hash = '#/instruments'; });
    await page.waitForTimeout(300);

    assert.equal(await page.evaluate(() => !!document.querySelector('.modal-dim')), false, 'the modal must be closed after the route change, not left orphaned open');
    assert.equal(await page.evaluate(() => document.activeElement === document.body), false, 'focus must not be left on document.body after the route change');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'page-title', 'focus must land on the new screen\'s heading, exactly as an ordinary (no-modal) route change does');
    assert.equal(await page.evaluate(() => document.getElementById('page-title').textContent), 'Core Instruments');
  });
});
