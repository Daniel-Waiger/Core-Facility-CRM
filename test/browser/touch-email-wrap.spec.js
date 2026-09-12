/* touch-email-wrap.spec.js — on a touch device at 400px, the People table's Email column wraps
 * instead of forcing a single unscrollable-until-discovered line.
 *
 * Adversarial review (2026-09-11, finding #8): `.tbl td:last-child { white-space: nowrap; }`
 * keeps a long email on one line so the table scrolls sideways to reveal it — a fine trade on a
 * mouse (a hover tooltip can also show the full value), but :hover never fires on a touch device
 * and nothing signals a table can be scrolled sideways until a finger stumbles onto it. Verified
 * with a real `hasTouch` + `isMobile` Playwright context, which is what actually flips the
 * `(pointer: coarse)` media query in Chromium — a plain narrow viewport on a mouse-driven context
 * would NOT reproduce this (pointer stays "fine"), so the context shape itself is part of the
 * test.
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

describe('touch: Email column wraps instead of forcing one nowrap line', { skip }, () => {
  let browser, touchCtx, mouseCtx;

  before(async () => {
    browser = await playwright.chromium.launch(chromiumLaunchOptions());
  });

  after(async () => {
    if (touchCtx) await touchCtx.close();
    if (mouseCtx) await mouseCtx.close();
    if (browser) await browser.close();
  });

  async function loadPeopleWithLongEmail(ctx) {
    const srv = await startServer();
    await ctx.addInitScript(QUIET_FIRST_RUN);
    const page = await ctx.newPage();
    await page.goto(srv.base + '/index.html?demo=1');
    await page.waitForFunction(() => window.DB && window.App);
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.UI && UI.stopTour && UI.stopTour());
    await page.evaluate(() => {
      DB.run("INSERT INTO people (name, type, email) VALUES ('Wrap Test Person','Researcher','a.genuinely.long.researcher.address+lab-notifications@example-university-department.edu')");
      location.hash = '#/people';
    });
    await page.waitForTimeout(400);
    return { page, srv };
  }

  test('sanity: (pointer: coarse) matches under hasTouch+isMobile, and not under a plain mouse context', async () => {
    touchCtx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 800 } });
    mouseCtx = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const touchPage = await touchCtx.newPage();
    const mousePage = await mouseCtx.newPage();
    await touchPage.goto('about:blank');
    await mousePage.goto('about:blank');
    assert.equal(await touchPage.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
    assert.equal(await mousePage.evaluate(() => matchMedia('(pointer: coarse)').matches), false);
    await touchCtx.close(); await mouseCtx.close();
    touchCtx = null; mouseCtx = null;
  });

  test('under a coarse (touch) pointer at 400px, the Email cell wraps onto more than one line', async () => {
    touchCtx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 800 } });
    const { page, srv } = await loadPeopleWithLongEmail(touchCtx);
    const cellBox = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.tbl td:last-child')];
      const cell = cells.find((c) => c.textContent.includes('a.genuinely.long.researcher.address'));
      if (!cell) return null;
      const r = cell.getBoundingClientRect();
      return { width: r.width, height: r.height, whiteSpace: getComputedStyle(cell).whiteSpace, overflowWrap: getComputedStyle(cell).overflowWrap };
    });
    assert.ok(cellBox, 'the long-email row must render in the People table');
    assert.equal(cellBox.whiteSpace, 'normal', 'a coarse pointer must switch the last column off white-space: nowrap');
    assert.equal(cellBox.overflowWrap, 'anywhere', 'a coarse pointer must let the email break anywhere, since it has no natural break point');
    // A single line at this table's font-size is well under 30px; wrapping onto 2+ lines is comfortably taller.
    assert.ok(cellBox.height > 30, `expected the wrapped email cell to be taller than one line, got height=${cellBox.height}`);
    await srv.close();
  });

  test('under a normal (mouse) pointer, the same cell stays on one nowrap line as before', async () => {
    mouseCtx = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const { page, srv } = await loadPeopleWithLongEmail(mouseCtx);
    const whiteSpace = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.tbl td:last-child')];
      const cell = cells.find((c) => c.textContent.includes('a.genuinely.long.researcher.address'));
      return cell && getComputedStyle(cell).whiteSpace;
    });
    assert.equal(whiteSpace, 'nowrap', 'a fine (mouse) pointer keeps the original single-line/scroll behavior unchanged');
    await srv.close();
  });
});
