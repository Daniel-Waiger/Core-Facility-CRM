/* persistence.spec.js — P1-persistence browser checks (adversarial review §1):
 *   - H3: closing a tab flushes whatever edit is still sitting inside the 400ms autosave debounce,
 *     instead of losing it.
 *   - H2: a second tab opened on the SAME database goes read-only rather than silently racing the
 *     first tab's autosave — only one tab may ever persist at a time.
 *
 * Needs a real browser: BroadcastChannel and IndexedDB's actual timing (and a real `pagehide`)
 * are the point, and isolation.spec.js already establishes the pattern of asserting on stored
 * bytes rather than on-screen behaviour for exactly this kind of claim.
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

describe('persistence: autosave flush and the multi-tab guard', { skip }, () => {
  let browser, srv;

  before(async () => {
    srv = await startServer();
    browser = await playwright.chromium.launch(chromiumLaunchOptions());
  });

  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.close();
  });

  async function freshContext() {
    const ctx = await browser.newContext({ timezoneId: 'Asia/Jerusalem' });
    await ctx.addInitScript(QUIET_FIRST_RUN);
    return ctx;
  }

  async function openApp(ctx, query = '') {
    const page = await ctx.newPage();
    await page.goto(srv.base + '/index.html' + query);
    await page.waitForFunction(() => window.DB && window.App);
    return page;
  }

  test('closing a tab flushes an edit made just before close, without waiting out the debounce', async () => {
    const ctx = await freshContext();
    const page1 = await openApp(ctx);

    await page1.evaluate(() => {
      DB.run("INSERT INTO projects (title, code, status) VALUES ('PagehideProof','PH-1','Active')");
    });
    // Close well within the 400ms debounce window — if this row survives, pagehide (not the
    // timer) is what saved it. Playwright's page.close() fires the same pagehide/visibilitychange
    // sequence a real tab close does.
    await page1.close();

    const page2 = await openApp(ctx);
    const count = await page2.evaluate(() => DB.row("SELECT COUNT(*) c FROM projects WHERE code='PH-1'").c);
    assert.equal(count, 1, 'the edit made just before the tab closed should have been flushed by pagehide, not lost');

    await ctx.close();
  });

  test('a second tab on the same database goes read-only; only the first tab ever persists', async () => {
    const ctx = await freshContext();
    const tab1 = await openApp(ctx);
    await tab1.waitForTimeout(300); // let tab1 finish announcing itself as the sole (leader) tab

    const tab2 = await openApp(ctx); // same IDB_NAME (real app, no ?demo=1) — the guard applies
    await tab2.waitForTimeout(500); // let the BroadcastChannel hello/hello-ack handshake settle

    const tab1ReadOnly = await tab1.evaluate(() => DB.isReadOnly);
    const tab2ReadOnly = await tab2.evaluate(() => DB.isReadOnly);
    assert.equal(tab1ReadOnly, false, 'the tab that was already open should keep write access');
    assert.equal(tab2ReadOnly, true, 'the newer tab should be put into a read-only state');

    // Settings should say so too (the health line added for this package).
    await tab2.evaluate(() => App.route('settings'));
    await tab2.waitForTimeout(200);
    const bannerVisible = await tab2.evaluate(() => !!document.querySelector('.card [class*="alert"], .card')
      && document.body.textContent.includes('already open in another tab'));
    assert.ok(bannerVisible, 'Settings should tell the read-only tab why its changes will not be saved');

    // The read-only tab's edit must never reach IndexedDB and race the leader's.
    await tab2.evaluate(() => DB.run("INSERT INTO projects (title, code, status) VALUES ('FromReadOnlyTab','RO-1','Active')"));
    await tab1.evaluate(() => DB.run("INSERT INTO projects (title, code, status) VALUES ('FromLeaderTab','LEAD-1','Active')"));
    await tab1.waitForTimeout(700); // past the 400ms debounce

    await tab1.reload();
    await tab1.waitForFunction(() => window.DB && window.App);
    const titles = await tab1.evaluate(() => DB.rows('SELECT title FROM projects ORDER BY title').map((r) => r.title));
    assert.ok(titles.includes('FromLeaderTab'), 'the leader tab\'s edit must have been saved');
    assert.ok(!titles.includes('FromReadOnlyTab'), 'the read-only tab\'s edit must never have been persisted, or it would have silently overwritten the leader\'s data');

    await ctx.close();
  });
});
