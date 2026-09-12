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

    // The read-only tab's edit must be REFUSED outright (not silently accepted and merely
    // withheld from IndexedDB) — verifier gap on the original H2 fix: a read-only tab must not be
    // able to touch even its own in-memory copy, or its stale image is exactly what a later
    // promotion could flush over the leader's newer save.
    const roAttempt = await tab2.evaluate(() => {
      try {
        DB.run("INSERT INTO projects (title, code, status) VALUES ('FromReadOnlyTab','RO-1','Active')");
        return { threw: false };
      } catch (e) {
        return { threw: true, message: e.message };
      }
    });
    assert.equal(roAttempt.threw, true, 'a read-only tab\'s DB.run must throw, not silently no-op');
    assert.match(roAttempt.message, /read-only/i);
    const roRowCount = await tab2.evaluate(() => DB.row("SELECT COUNT(*) c FROM projects WHERE code='RO-1'").c);
    assert.equal(roRowCount, 0, 'the refused insert must not even land in the read-only tab\'s own in-memory database');

    await tab1.evaluate(() => DB.run("INSERT INTO projects (title, code, status) VALUES ('FromLeaderTab','LEAD-1','Active')"));
    await tab1.waitForTimeout(700); // past the 400ms debounce

    await tab1.reload();
    await tab1.waitForFunction(() => window.DB && window.App);
    const titles = await tab1.evaluate(() => DB.rows('SELECT title FROM projects ORDER BY title').map((r) => r.title));
    assert.ok(titles.includes('FromLeaderTab'), 'the leader tab\'s edit must have been saved');
    assert.ok(!titles.includes('FromReadOnlyTab'), 'the read-only tab\'s edit must never have been persisted, or it would have silently overwritten the leader\'s data');

    await ctx.close();
  });

  // The verifier's reproduction for the H2 gap: closing the LEADER first (not the read-only tab)
  // must promote the surviving tab without it ever flushing a stale image over the leader's last
  // save. Before the fix, the promoted tab resumed autosaving whatever it already had in memory —
  // which, since it had been read-only, was whatever it loaded at open time, missing everything
  // the leader saved afterward — and that stale image would have overwritten the leader's data.
  test('closing the leader first promotes the survivor via a disk reload, never a stale flush', async () => {
    const ctx = await freshContext();
    const tabA = await openApp(ctx); // leader
    await tabA.waitForTimeout(300);

    await tabA.evaluate(() => DB.run("INSERT INTO people (name, type) VALUES ('PersonFromA','Researcher')"));
    await tabA.waitForTimeout(700); // past the 400ms debounce — A's insert is now on disk

    const tabB = await openApp(ctx); // read-only — opened AFTER A, so it loses the leader race
    await tabB.waitForTimeout(500);
    assert.equal(await tabB.evaluate(() => DB.isReadOnly), true, 'tab B must start read-only');

    // B tries to write while read-only — refused (same guard as the test above), so B's own
    // in-memory copy never carries this edit forward into the promotion below.
    const bAttempt = await tabB.evaluate(() => {
      try { DB.run("INSERT INTO instruments (name, kind, status) VALUES ('InstFromB','Confocal','Available')"); return { threw: false }; }
      catch (e) { return { threw: true }; }
    });
    assert.equal(bAttempt.threw, true, 'B\'s write attempt while read-only must be refused');

    // Close the LEADER (not the read-only tab) — this is the scenario the original fix missed.
    await tabA.close();

    // B must be promoted (readOnly flips back to false) once it receives A's 'bye'.
    await tabB.waitForFunction(() => window.DB && DB.isReadOnly === false, { timeout: 5000 });

    // Promotion must have reloaded B's in-memory database from the disk image A last saved —
    // A's person must be visible in B's OWN in-memory query right after promotion, not only after
    // a manual reload, and B's own refused instrument insert must be nowhere in it.
    const afterPromotion = await tabB.evaluate(() => ({
      person: !!DB.row("SELECT id FROM people WHERE name='PersonFromA'"),
      inst: !!DB.row("SELECT id FROM instruments WHERE name='InstFromB'"),
    }));
    assert.equal(afterPromotion.person, true, 'the promoted tab must see the leader\'s last save (proves it reloaded from disk, not its own stale copy)');
    assert.equal(afterPromotion.inst, false, 'the promoted tab must not carry forward its own refused, never-persisted edit');

    // B, now the writer, can save going forward — and doing so must not disturb A's row.
    await tabB.evaluate(() => DB.run("INSERT INTO people (name, type) VALUES ('PersonFromB','Researcher')"));
    await tabB.waitForTimeout(700);

    await tabB.reload();
    await tabB.waitForFunction(() => window.DB && window.App);
    const names = await tabB.evaluate(() => DB.rows('SELECT name FROM people ORDER BY name').map((r) => r.name));
    assert.ok(names.includes('PersonFromA'), 'A\'s person must still be present after the promoted tab\'s own later save');
    assert.ok(names.includes('PersonFromB'), 'B\'s post-promotion save must have persisted, proving it is a real writer now');
    assert.ok(!names.includes('InstFromB'), 'B\'s pre-promotion refused instrument insert must never appear anywhere');

    await ctx.close();
  });

  test('two tabs opened at the same instant still elect exactly one leader', async () => {
    const ctx = await freshContext();
    const pages = await Promise.all([openApp(ctx), openApp(ctx)]);
    await Promise.all(pages.map((p) => p.waitForTimeout(700)));

    const states = await Promise.all(pages.map((p) => p.evaluate(() => DB.isReadOnly)));
    const writers = states.filter((ro) => ro === false).length;
    assert.equal(writers, 1, `exactly one of the two simultaneously-opened tabs must be the writer, got states ${JSON.stringify(states)}`);

    await ctx.close();
  });

  // G1 fix: DB.restoreBackup() replaces the whole `db` handle directly, bypassing run()'s
  // assertWritable() call entirely — F1's read-only guard covered every write THROUGH run(), but
  // missed this one path that never goes through it. A read-only tab restoring a backup would
  // silently overwrite the leader tab's live database with no conflict, no toast, exactly the
  // H2 class of bug the whole multi-tab guard exists to prevent.
  test('restoring a backup in a read-only tab is refused with the same toast, and does not touch the database', async () => {
    const ctx = await freshContext();
    const tab1 = await openApp(ctx);
    await tab1.waitForTimeout(300);

    const tab2 = await openApp(ctx); // read-only — opened second
    await tab2.waitForTimeout(500);
    assert.equal(await tab2.evaluate(() => DB.isReadOnly), true, 'tab2 must be read-only before this test proceeds');

    // A trivially valid backup — its content doesn't matter, since the read-only guard must
    // refuse it before ever reaching validation/parsing.
    const backup = await tab2.evaluate(() => DB.buildBackup());

    const result = await tab2.evaluate(async (data) => {
      try {
        await DB.restoreBackup(data);
        return { threw: false };
      } catch (e) {
        return { threw: true, message: e.message, dbReadOnly: !!e.dbReadOnly };
      }
    }, backup);
    assert.equal(result.threw, true, 'DB.restoreBackup must refuse in a read-only tab');
    assert.equal(result.dbReadOnly, true, 'the thrown error must carry dbReadOnly, same as every other refused write');
    assert.match(result.message, /read-only/i);

    // Exercise the actual Settings "Restore Backup" button too, through the real data-act
    // dispatcher a person would click — doRestore() checks DB.isReadOnly before ever opening the
    // file picker, so no <input type="file"> chooser should appear at all.
    await tab2.evaluate(() => App.route('settings'));
    await tab2.waitForTimeout(200);
    let fileChooserSeen = false;
    tab2.once('filechooser', () => { fileChooserSeen = true; });
    const restoreBtn = await tab2.$('[data-act="restore"]');
    assert.ok(restoreBtn, 'Settings must render the Restore Backup button');
    await restoreBtn.click();
    await tab2.waitForTimeout(200);
    assert.equal(fileChooserSeen, false, 'a read-only tab must never even open the restore file picker');

    await ctx.close();
  });

  test('three tabs: closing the leader promotes exactly one of the remaining two', async () => {
    const ctx = await freshContext();
    const tabA = await openApp(ctx);
    await tabA.waitForTimeout(300);
    const tabB = await openApp(ctx);
    await tabB.waitForTimeout(300);
    const tabC = await openApp(ctx);
    await tabC.waitForTimeout(700);

    const before = await Promise.all([tabA, tabB, tabC].map((p) => p.evaluate(() => DB.isReadOnly)));
    assert.deepEqual(before, [false, true, true], 'A (opened first) must be the only writer before anything closes');

    await tabA.close();
    await Promise.all([tabB, tabC].map((p) => p.waitForTimeout(600)));

    const after = await Promise.all([tabB, tabC].map((p) => p.evaluate(() => DB.isReadOnly)));
    const writers = after.filter((ro) => ro === false).length;
    assert.equal(writers, 1, `exactly one of the two surviving tabs must be promoted, got ${JSON.stringify(after)}`);
    // The next-oldest tab (B) is the one both should converge on.
    assert.deepEqual(after, [false, true], 'B (the next-oldest survivor) must be the one promoted, not C');

    await ctx.close();
  });
});
