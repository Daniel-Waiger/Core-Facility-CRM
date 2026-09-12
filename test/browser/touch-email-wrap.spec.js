/* touch-email-wrap.spec.js — on a touch device at 400px, the People table's Email cell wraps
 * instead of truncating to an ellipsis with no way to see the rest of it.
 *
 * Adversarial review (2026-09-11, finding #8): `.tbl td.tbl-email { white-space: nowrap; overflow:
 * hidden; text-overflow: ellipsis; }` relies on its `title` attribute to reveal the full address
 * on :hover — a fine trade on a mouse, but :hover never fires on a touch device, leaving no way at
 * all to read anything past the ellipsis. Verified with a real `hasTouch` + `isMobile` Playwright
 * context, which is what actually flips the `(pointer: coarse)` media query in Chromium — a plain
 * narrow viewport on a mouse-driven context would NOT reproduce this (pointer stays "fine"), so the
 * context shape itself is part of the test.
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN, waitForAppReady } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

const LONG_EMAIL = 'a.genuinely.long.researcher.address+lab-notifications@example-university-department.edu';

describe('touch: People table Email cell wraps instead of ellipsis-truncating', { skip }, () => {
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
    await waitForAppReady(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.UI && UI.stopTour && UI.stopTour());
    await page.evaluate((email) => {
      DB.run("INSERT INTO people (name, type, email) VALUES ('Wrap Test Person','Researcher',?)", [email]);
      location.hash = '#/people';
    }, LONG_EMAIL);
    await page.waitForTimeout(400);
    return { page, srv };
  }

  async function emailCellMetrics(page) {
    return page.evaluate((email) => {
      const cell = document.querySelector(`.tbl td.tbl-email[title="${email}"]`);
      if (!cell) return null;
      const r = cell.getBoundingClientRect();
      const cs = getComputedStyle(cell);
      return { width: r.width, height: r.height, whiteSpace: cs.whiteSpace, overflowWrap: cs.overflowWrap, textOverflow: cs.textOverflow };
    }, LONG_EMAIL);
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

  test('under a coarse (touch) pointer at 400px, the Email cell wraps onto more than one line instead of ellipsis-truncating', async () => {
    touchCtx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 800 } });
    // try/finally: an assertion failure mid-test must still close the started server, or a
    // failing run leaves an http.Server open and node --test hangs after printing its results.
    const { page, srv } = await loadPeopleWithLongEmail(touchCtx);
    try {
      const metrics = await emailCellMetrics(page);
      assert.ok(metrics, 'the long-email row must render in the People table, with its title attribute intact');
      assert.equal(metrics.whiteSpace, 'normal', 'a coarse pointer must switch .tbl-email off white-space: nowrap');
      assert.equal(metrics.overflowWrap, 'anywhere', 'a coarse pointer must let the email break anywhere, since it has no natural break point');
      assert.notEqual(metrics.textOverflow, 'ellipsis', 'a coarse pointer must not still be truncating to an ellipsis nobody can expand');
      // A single line at this table's font-size is well under 30px; wrapping onto 2+ lines is comfortably taller.
      assert.ok(metrics.height > 30, `expected the wrapped email cell to be taller than one line, got height=${metrics.height}`);
    } finally {
      await srv.close();
    }
  });

  test('under a normal (mouse) pointer, the same cell still ellipsis-truncates as before (unchanged, hover/title still rescues it)', async () => {
    mouseCtx = await browser.newContext({ viewport: { width: 400, height: 800 } });
    const { page, srv } = await loadPeopleWithLongEmail(mouseCtx);
    try {
      const metrics = await emailCellMetrics(page);
      assert.ok(metrics, 'the long-email row must render in the People table');
      assert.equal(metrics.whiteSpace, 'nowrap', 'a fine (mouse) pointer keeps the original single-line/ellipsis behavior unchanged');
      assert.equal(metrics.textOverflow, 'ellipsis');
    } finally {
      await srv.close();
    }
  });
});
