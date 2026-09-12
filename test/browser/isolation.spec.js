/* isolation.spec.js — the demo sandbox must not be able to reach real records.
 *
 * This is the one guarantee in the app that is worth a slow test. Before 1.10.0, "Load Sample
 * Data" called clearAllData() first: one click, no confirmation, and a real facility's projects,
 * people, instruments, milestones and bookings were gone — while the manual promised in bold that
 * it did not erase anything. The fix was structural rather than textual: a demo tab (?demo=1)
 * opens a DIFFERENT IndexedDB database, so the real one is never opened at all.
 *
 * "Never opened" is the claim, so the assertion is about BYTES, not behaviour: hash the real
 * database's stored SQLite image, let the demo tab do the most destructive thing it can, and
 * require the hash to be unchanged. Anything weaker (counting rows, checking the UI) could pass
 * while a subtle write slipped through.
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

const MARKER = 'REAL-FACILITY-PROJECT-DO-NOT-TOUCH';

/* Read the stored SQLite image straight out of IndexedDB and fingerprint it. Runs inside the
   page, so it sees exactly what the app persisted. `dbName` is interpolated as a JSON literal. */
function readDbFingerprint(dbName) {
  return `(async () => {
    const bytes = await new Promise((res, rej) => {
      const req = indexedDB.open(${JSON.stringify(dbName)}, 1);
      req.onerror = () => rej(req.error);
      req.onsuccess = () => {
        const s = req.result;
        if (!s.objectStoreNames.contains('kv')) { res(null); return; }
        const g = s.transaction('kv', 'readonly').objectStore('kv').get('core.db');
        g.onsuccess = () => res(g.result ? g.result.v : null);
        g.onerror = () => rej(g.error);
      };
    });
    if (!bytes) return null;
    const arr = new Uint8Array(bytes);
    let h = 0;
    for (let i = 0; i < arr.length; i++) h = (h * 31 + arr[i]) >>> 0;
    return { len: arr.length, hash: h };
  })()`;
}

describe('demo sandbox isolation', { skip }, () => {
  let browser, srv;

  before(async () => {
    srv = await startServer();
    browser = await playwright.chromium.launch(chromiumLaunchOptions());
  });

  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.close();
  });

  /* A fresh browser context per test: separate IndexedDB and separate localStorage, so one test
     cannot leave state that flatters the next. */
  async function freshContext() {
    const ctx = await browser.newContext({ timezoneId: 'Asia/Jerusalem' });
    await ctx.addInitScript(QUIET_FIRST_RUN);
    return ctx;
  }

  async function openApp(ctx, query = '') {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(srv.base + '/index.html' + query);
    await page.waitForFunction(() => window.DB && window.App);
    page._errors = errors;
    return page;
  }

  test('the real database is byte-identical after the demo tab does its worst', async () => {
    const ctx = await freshContext();
    const real = await openApp(ctx);

    // Put genuine records in the real tab and let the 400ms autosave debounce settle.
    await real.evaluate((m) => {
      DB.run('INSERT INTO projects (title, code, status) VALUES (?,?,?)', [m, 'REAL-001', 'Active']);
      DB.run('INSERT INTO people (name, type) VALUES (?,?)', ['Real Person', 'PI']);
      DB.run('INSERT INTO instruments (name, status) VALUES (?,?)', ['Real Scope', 'Available']);
    }, MARKER);
    await real.waitForTimeout(1200);

    const before = await real.evaluate(readDbFingerprint('core-facility'));
    assert.ok(before && before.len > 0, 'the real database should have persisted something');

    // Now the sandbox, doing everything destructive available to it.
    const demo = await openApp(ctx, '?demo=1');
    await demo.waitForTimeout(1500);
    await demo.evaluate(async () => {
      DB.run("INSERT INTO projects (title, code, status) VALUES ('Demo scratch','DEMO-X','Active')");
      DB.run('DELETE FROM meetings');
      await DB.seedSampleData({ force: true });   // full clear + reseed: the sharpest edge there is
    });
    await demo.waitForTimeout(1500);

    const after = await real.evaluate(readDbFingerprint('core-facility'));
    assert.equal(after.len, before.len, 'real database changed SIZE after demo activity');
    assert.equal(after.hash, before.hash, 'real database CONTENT changed after demo activity');

    // And it survives a reload, i.e. what is on disk is really intact.
    await real.reload();
    await real.waitForFunction(() => window.DB && window.App);
    const counts = await real.evaluate((m) => ({
      marker: DB.row('SELECT COUNT(*) c FROM projects WHERE title=?', [m]).c,
      projects: DB.row('SELECT COUNT(*) c FROM projects').c,
      people: DB.row('SELECT COUNT(*) c FROM people').c,
      instruments: DB.row('SELECT COUNT(*) c FROM instruments').c,
    }), MARKER);
    assert.equal(counts.marker, 1, 'the real project vanished');
    assert.equal(counts.projects, 1, 'the real tab picked up demo projects');
    assert.equal(counts.people, 1);
    assert.equal(counts.instruments, 1);

    await ctx.close();
  });

  test('the real tab refuses to seed demo data at all', async () => {
    const ctx = await freshContext();
    const real = await openApp(ctx);
    await real.evaluate((m) => DB.run('INSERT INTO projects (title, code, status) VALUES (?,?,?)', [m, 'REAL-002', 'Active']), MARKER);

    // The guard is the first statement of seedSampleData, so this is a direct test of it.
    const returned = await real.evaluate(() => DB.seedSampleData());
    assert.equal(returned, false, 'seedSampleData() should refuse outside the sandbox');
    assert.equal(await real.evaluate(() => DB.isDemo), false);

    const survived = await real.evaluate((m) => DB.row('SELECT COUNT(*) c FROM projects WHERE title=?', [m]).c, MARKER);
    assert.equal(survived, 1, 'the refused seed still wiped data');
    await ctx.close();
  });

  test('the sandbox is seeded, separate, and cannot see real records', async () => {
    const ctx = await freshContext();
    const real = await openApp(ctx);
    await real.evaluate((m) => DB.run('INSERT INTO projects (title, code, status) VALUES (?,?,?)', [m, 'REAL-003', 'Active']), MARKER);
    await real.waitForTimeout(1200);

    const demo = await openApp(ctx, '?demo=1');
    await demo.waitForTimeout(1500);
    assert.equal(await demo.evaluate(() => DB.isDemo), true);

    // Opening the sandbox must FILL it — an empty sandbox is useless, and shipped that way once.
    const titles = await demo.evaluate(() => DB.rows('SELECT title FROM projects ORDER BY id').map((r) => r.title));
    assert.ok(titles.length >= 3, `sandbox should be seeded, got ${JSON.stringify(titles)}`);
    assert.ok(!titles.includes(MARKER), 'the sandbox can see the real tab\'s records');

    const dbs = await real.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort());
    assert.ok(dbs.includes('core-facility'), `expected the real database, got ${JSON.stringify(dbs)}`);
    assert.ok(dbs.includes('core-facility-demo'), `expected a separate demo database, got ${JSON.stringify(dbs)}`);
    await ctx.close();
  });

  test('a sandbox opened from inside the app gets no handle back to the real tab', async () => {
    /* ?demo=1 is SAME-ORIGIN, so a sandbox tab opened with a live `window.opener` could reach
       straight into `opener.DB` and write to the real database — defeating the separate-database
       isolation entirely, from a direction the byte-comparison test above would never see.
       Every in-app path that opens the sandbox therefore carries rel="noopener": the welcome
       card's anchor, and Settings' hand-off (which synthesises one via openInNewTab rather than
       using window.open, precisely so noopener survives). Asserted here because "we passed the
       right flag" is a claim about code, while `window.opener === null` is the property itself. */
    const ctx = await freshContext();
    const real = await openApp(ctx);
    await real.evaluate(() => App.route('settings'));
    await real.waitForTimeout(400);

    const [sandbox] = await Promise.all([
      ctx.waitForEvent('page'),
      real.click('[data-act="load-sample-data"]'),
    ]);
    await sandbox.waitForFunction(() => window.DB);

    assert.ok(sandbox.url().includes('demo=1'), `expected the sandbox, got ${sandbox.url()}`);
    assert.equal(await sandbox.evaluate(() => DB.isDemo), true);
    assert.equal(
      await sandbox.evaluate(() => window.opener),
      null,
      'the sandbox tab holds a handle to the opener, so it can reach the real database',
    );
    await ctx.close();
  });

  test('the demo tab never writes backups or touches the real backup clock', async () => {
    const ctx = await freshContext();
    const demo = await openApp(ctx, '?demo=1');
    await demo.waitForTimeout(2000);

    // Both modes name their backup files identically, so a demo-triggered automatic backup could
    // overwrite the day's real one. Suppression is asserted through the clock it would stamp.
    const real = await openApp(ctx);
    const stamp = await real.evaluate(() => localStorage.getItem('last-auto-backup-at'));
    assert.equal(stamp, null, 'the demo tab stamped the real automatic-backup clock');
    await ctx.close();
  });
});
