/* smoke.spec.js — every screen still renders, with no JavaScript errors.
 *
 * The unit tests prove the maths and the rules. They cannot tell you the app loads: the views are
 * template strings assembled at render time, so a typo in one of them throws only when that
 * screen is actually visited. This suite visits all of them.
 *
 * It earns its keep. During the 1.10.0 work it caught the demo sandbox opening completely blank —
 * the separate database was created correctly but nothing seeded it, so every screen rendered
 * perfectly with nothing on it. No unit test would ever have noticed.
 *
 * It runs in the sandbox precisely because that is where the sample data lives, so every screen
 * has rows to render rather than an empty state.
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

const SCREENS = ['dashboard', 'projects', 'people', 'instruments', 'calendar', 'reports', 'settings'];

describe('every screen renders', { skip }, () => {
  let browser, srv, page, errors;

  before(async () => {
    srv = await startServer();
    browser = await playwright.chromium.launch(chromiumLaunchOptions());
    const ctx = await browser.newContext({ timezoneId: 'Asia/Jerusalem' });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('crm-hide-startup-modal', '1');
        localStorage.setItem('crm-seen-device-notice', '1');
        localStorage.setItem('crm-declined-backup-folder', '1');
        localStorage.setItem('auto-backup-enabled', '0');
        // Admin Mode on, so the admin-gated Settings blocks (group discounts, the manual
        // per-booking discount) are rendered and covered too rather than silently skipped.
        localStorage.setItem('admin-mode', '1');
      } catch (_) {}
    });

    page = await ctx.newPage();
    errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto(srv.base + '/index.html?demo=1');
    await page.waitForFunction(() => window.DB && window.App);
    await page.waitForTimeout(2000);
    // Opening a fresh sandbox starts the tour, which blocks input for orientation; dismiss it.
    await page.evaluate(() => window.UI && UI.stopTour && UI.stopTour());
  });

  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.close();
  });

  async function viewText(route, id) {
    await page.evaluate(([v, i]) => App.route(v, i), [route, id]);
    await page.waitForTimeout(450);
    return page.evaluate(() => {
      const v = document.getElementById('view');
      return { len: (v && v.innerHTML.length) || 0, txt: (v && v.innerText) || '' };
    });
  }

  test('the sandbox is seeded, so the screens have something to show', async () => {
    const counts = await page.evaluate(() => ({
      projects: DB.row('SELECT COUNT(*) c FROM projects').c,
      bookings: DB.row('SELECT COUNT(*) c FROM meetings').c,
      people: DB.row('SELECT COUNT(*) c FROM people').c,
    }));
    assert.ok(counts.projects >= 3, `expected seeded projects, got ${JSON.stringify(counts)}`);
    assert.ok(counts.bookings >= 10, `expected seeded bookings, got ${JSON.stringify(counts)}`);
    assert.ok(counts.people >= 5, `expected seeded people, got ${JSON.stringify(counts)}`);
  });

  for (const screen of SCREENS) {
    test(`${screen} renders`, async () => {
      const info = await viewText(screen);
      assert.ok(info.len > 300, `${screen} rendered only ${info.len} characters of HTML`);
    });
  }

  test('project detail renders, with readable status labels and formatted money', async () => {
    const id = await page.evaluate(() => DB.row('SELECT id FROM projects ORDER BY id LIMIT 1').id);
    const info = await viewText('project', id);
    assert.ok(info.len > 500, `project detail rendered only ${info.len} characters`);
    // The stored status values are lowercase and hyphenated because SQL compares them; only the
    // DISPLAY is mapped. So the raw form must never reach the screen.
    assert.ok(/In Progress|Done|Pending/.test(info.txt), `expected Title Case statuses: ${info.txt.slice(0, 200)}`);
    assert.ok(!/\bin-progress\b/.test(info.txt), 'a raw database status value leaked to the screen');
    assert.ok(/[\d,]+\.\d\d/.test(info.txt), 'expected money formatted to two decimals');
  });

  test('instrument cost carries a currency symbol and a worded unit', async () => {
    // Both read as bare numbers before 1.10.0: a rate showed as "450" beside a raw "time".
    const info = await viewText('instruments');
    assert.ok(/\$\d/.test(info.txt), `expected a currency symbol: ${info.txt.slice(0, 300)}`);
    assert.ok(/per hour/.test(info.txt), `expected a worded billing unit: ${info.txt.slice(0, 300)}`);
  });

  test('the staff hourly rate carries a currency symbol', async () => {
    const info = await viewText('people');
    assert.ok(/\$\d/.test(info.txt), `expected a currency symbol: ${info.txt.slice(0, 300)}`);
  });

  test('Settings states the otherwise-invisible legacy overhead percentage', async () => {
    // Four strings told the user an untiered lab pays "the legacy Internal + External overhead
    // sum" while that number appeared nowhere in the UI, though it was added to every booking.
    const info = await viewText('settings');
    assert.ok(/no pricing tier/i.test(info.txt), `expected the read-only overhead line: ${info.txt.slice(0, 400)}`);
  });

  test('Reports spells Utilization the same way its own page title does', async () => {
    const info = await viewText('reports');
    assert.ok(/Instrument Utilization/.test(info.txt), 'expected "Instrument Utilization" on the card');
    assert.ok(!/Utilisation/.test(info.txt), 'both spellings are on screen at once');
  });

  test('the full spreadsheet export builds without throwing', async () => {
    // Exercises the XLSX path against real seeded rows, including the currency-in-header change.
    const built = await page.evaluate(() => {
      try { return !!Exports.buildAllXlsxBlob(); } catch (e) { return 'THREW: ' + e.message; }
    });
    assert.equal(built, true, `export failed: ${built}`);
  });

  test('no JavaScript errors were logged while visiting every screen', async () => {
    // Deliberately last: it accumulates across every test above, so it reports the whole session.
    assert.deepEqual(errors, [], `JavaScript errors during rendering:\n  ${errors.join('\n  ')}`);
  });
});
