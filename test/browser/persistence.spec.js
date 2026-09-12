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
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN, waitForAppReady } = require('./helpers/browser');

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
    await waitForAppReady(page);
    return page;
  }

  // Polls the raw IndexedDB record for a substring, rather than assuming any fixed delay after
  // another tab's pagehide flush was long enough to land — a sleep-then-check-once races that
  // write, and under load (or simply bad luck) can check before it arrives even though it's
  // genuinely on its way. Reads the 'core.db' key directly (sql.js's exported bytes are UTF-8 for
  // TEXT columns, so a substring search needs no SQL parsing) from a single lightweight page that
  // never loads index.html — it has no App, no DB, no autosave and no multi-tab guard of its own,
  // so it can never itself become a writer or add contention while this polls. Because the write
  // being awaited here is the tail end of another tab's OWN close (a real `pagehide` racing actual
  // page teardown, not just this app's own logic), this can still occasionally observe the write
  // as genuinely never landing rather than merely late — the timeout is generous, not infinite,
  // and a caller should treat that outcome as a real (if rare) loss to report, not a fixed bug.
  async function pollIndexedDbContains(ctx, needle, timeoutMs) {
    const reader = await ctx.newPage();
    await reader.goto(srv.base + '/__idb-poll-probe__', { waitUntil: 'commit' }).catch(() => {});
    const startedAt = Date.now();
    let found = false;
    while (Date.now() - startedAt < timeoutMs) {
      found = await reader.evaluate((needleArg) => new Promise((resolve, reject) => {
        const req = indexedDB.open('core-facility', 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) { db.close(); return resolve(false); }
          const tx = db.transaction('kv', 'readonly');
          const getReq = tx.objectStore('kv').get('core.db');
          getReq.onsuccess = () => {
            const rec = getReq.result;
            db.close();
            if (!rec || !rec.v) return resolve(false);
            const bytes = rec.v instanceof Uint8Array ? rec.v : new Uint8Array(rec.v);
            resolve(new TextDecoder('utf-8', { fatal: false }).decode(bytes).includes(needleArg));
          };
          getReq.onerror = () => { db.close(); reject(getReq.error); };
        };
      }), needle);
      if (found) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await reader.close();
    return found;
  }

  test('closing a tab flushes an edit made just before close, without waiting out the debounce', async () => {
    const ctx = await freshContext();
    const page1 = await openApp(ctx);

    await page1.evaluate(() => {
      DB.run("INSERT INTO projects (title, code, status) VALUES ('PagehideProof','PH-1','Active')");
    });
    // Still well within the 400ms debounce window — if this row is persisted now, the pagehide
    // handler (not the timer) is what saved it. The page dispatches the same `pagehide` event a
    // real tab close fires, but is deliberately kept ALIVE while the write it triggers is polled
    // for: closing the page first raced actual renderer teardown against an already-issued
    // IndexedDB write, which the platform does not guarantee to complete — that lost the row in
    // roughly one run in twelve, and no test-side wait can recover a write the browser dropped.
    // What the app can guarantee (and what this asserts) is that its own handler issues the save
    // immediately on pagehide rather than after the debounce.
    await page1.evaluate(() => { window.dispatchEvent(new Event('pagehide')); });

    const found = await pollIndexedDbContains(ctx, 'PagehideProof', 10000);
    assert.equal(found, true, 'the edit made just before pagehide should have been flushed by the handler, not left to the debounce');

    await page1.close();
    await ctx.close();
  });

  // Item 2 (suppressed finding, second review of PR #44): `pagehide` also fires when a page merely
  // enters the back-forward cache (bfcache), not just on a genuine close — teardown() still runs,
  // announcing `bye` and closing the guard's BroadcastChannel, while the page itself is only
  // FROZEN, not destroyed. If the browser later restores it FROM bfcache (`pageshow` with
  // `event.persisted`), simply resuming as whatever `readOnly` held when it was frozen would let it
  // resume as a writer with a closed channel and no re-election — every other tab already believes
  // it left. Reproduces: tab1 is the sole (leader) tab; simulate its pagehide+bfcache-restore cycle
  // while tab2 is opened in between (a real reason the world could have changed while tab1 was
  // frozen) — tab1 must NOT resume as a blind writer; it must re-join the election and end up
  // correctly read-only, since tab2 is now the rightful (older, still-live) leader.
  test('a bfcache pageshow (event.persisted) re-joins the election as a new tab instead of resuming as writer', async () => {
    const ctx = await freshContext();
    const tab1 = await openApp(ctx); // sole tab — leader
    await tab1.waitForTimeout(300);
    assert.equal(await tab1.evaluate(() => DB.isReadOnly), false, 'tab1 must start as the (only) writer');

    // Simulate tab1 entering the bfcache: pagehide fires (teardown announces `bye` and closes its
    // channel), but the page itself is NOT actually destroyed — we keep evaluating on it.
    await tab1.evaluate(() => { window.dispatchEvent(new Event('pagehide')); });
    await tab1.waitForTimeout(200);

    // While tab1 is "frozen", a genuinely new tab opens — it has nothing to lose the race against
    // (tab1's channel is closed and it announced departure), so it becomes the writer.
    const tab2 = await openApp(ctx);
    await tab2.waitForTimeout(500);
    assert.equal(await tab2.evaluate(() => DB.isReadOnly), false, 'tab2 must become the writer — tab1 already announced it left');

    // C4-followups #1: a real reload-from-disk here is fast enough (a few ms) that tab2's
    // hello-ack usually arrives AFTER it, not during it — which would let this test pass whether
    // or not the race (peers updating mid-reload gets silently discarded once the reload resolves)
    // is actually fixed. Slow ONLY this reload, in-page, so tab2's hello-ack is guaranteed to land
    // while tab1's promotion is still awaiting it — the same race the unit test's fake-timer
    // harness reproduces deterministically, exercised here against the real IndexedDB/
    // BroadcastChannel timing this app actually runs on.
    await tab1.evaluate(() => {
      const realInitSqlJs = window.initSqlJs;
      window.initSqlJs = (...args) => new Promise((resolve) => {
        setTimeout(() => resolve(realInitSqlJs(...args)), 250);
      });
    });

    // tab1 is restored from bfcache: `pageshow` fires with `persisted: true`.
    await tab1.evaluate(() => {
      const ev = new Event('pageshow');
      Object.defineProperty(ev, 'persisted', { value: true });
      window.dispatchEvent(ev);
    });
    await tab1.waitForTimeout(800); // outlast the slowed reload and let the election settle

    // The invariant that actually matters, regardless of which tab ends up read-only: never both.
    const bothWritable = (await tab1.evaluate(() => DB.isReadOnly)) === false && (await tab2.evaluate(() => DB.isReadOnly)) === false;
    assert.equal(bothWritable, false, 'at most one tab may ever be writable — a hello-ack that arrives mid-reload must not be silently discarded once the reload resolves');

    assert.equal(await tab1.evaluate(() => DB.isReadOnly), true, 'tab1 must NOT resume as a blind writer after a bfcache restore — it must re-join the election and lose to tab2, the still-live rightful leader');
    assert.equal(await tab2.evaluate(() => DB.isReadOnly), false, 'tab2 must remain the writer throughout — tab1\'s bfcache restore must not have silently taken over');

    // And tab1 in this now-correctly-read-only state must refuse a write, exactly like any other
    // read-only tab (same guard as the "a second tab..." test below).
    const attempt = await tab1.evaluate(() => {
      try { DB.run("INSERT INTO projects (title, code, status) VALUES ('FromBfcacheTab','BFC-1','Active')"); return { threw: false }; }
      catch (e) { return { threw: true }; }
    });
    assert.equal(attempt.threw, true, 'tab1, now correctly read-only post-bfcache-restore, must refuse a write');

    await ctx.close();
  });

  // Item 2 (second review of PR #44): pagehide's own teardown() used to broadcast `bye` and close
  // its BroadcastChannel immediately, while the outgoing tab's own final flush (issued by the
  // SEPARATE, earlier-registered pagehide->flushNow listener) was still async and in flight — a
  // surviving read-only tab could promote off that bare `bye` and reload from IndexedDB BEFORE the
  // outgoing tab's write ever landed, capturing stale bytes. Reproduces the exact race: tab1 (the
  // leader) makes an edit, its own autosave write is artificially slowed by ~800ms (delaying only
  // WHEN idbSet's transaction reports itself complete to db.js, not the real underlying commit),
  // then pagehide fires — and the promoted tab's database must end up containing the edit, not a
  // stale pre-edit copy.
  test('closing the leader with its save deliberately slowed: the promoted tab ends up with the edit, not a stale reload', async () => {
    const ctx = await freshContext();
    const tab1 = await openApp(ctx); // leader
    await tab1.waitForTimeout(300);

    const tab2 = await openApp(ctx); // read-only — opened after tab1
    await tab2.waitForTimeout(500);
    assert.equal(await tab2.evaluate(() => DB.isReadOnly), true, 'tab2 must start read-only');

    // Slow down exactly the NEXT IndexedDB transaction's completion notification by ~800ms —
    // delays when db.js's own idbSet() promise resolves, without touching the real underlying
    // commit, so this reproduces "the outgoing tab's flush is still genuinely in flight when
    // pagehide fires" without needing to fake IndexedDB itself.
    await tab1.evaluate(() => {
      const proto = IDBTransaction.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'oncomplete');
      let armed = true;
      Object.defineProperty(proto, 'oncomplete', {
        configurable: true,
        set(fn) {
          if (armed && typeof fn === 'function') {
            armed = false;
            desc.set.call(this, function (...args) { setTimeout(() => fn.apply(this, args), 800); });
          } else {
            desc.set.call(this, fn);
          }
        },
        get() { return desc.get.call(this); },
      });
    });

    await tab1.evaluate(() => {
      DB.run("INSERT INTO projects (title, code, status) VALUES ('SlowFlushProof','SLOW-1','Active')");
    });
    // Fire pagehide right away — well within the 400ms debounce, and well before the artificially
    // slowed write (~800ms) can have completed.
    await tab1.evaluate(() => { window.dispatchEvent(new Event('pagehide')); });

    // Immediately after pagehide, tab2 must NOT have promoted yet — the leader's `bye` said a save
    // was still pending, so tab2 must be waiting (for a `saved` message or the bounded grace
    // period), not reloading from IndexedDB right away.
    await tab1.waitForTimeout(150);
    assert.equal(await tab2.evaluate(() => DB.isReadOnly), true, 'tab2 must still be read-only shortly after pagehide — it must not have promoted before the leader\'s slow write landed');

    // Eventually (once the slowed write lands and tab1 announces `saved`, well within the
    // BYE_GRACE_MS fallback) tab2 promotes.
    await tab2.waitForFunction(() => window.DB && DB.isReadOnly === false, { timeout: 5000 });

    const hasEdit = await tab2.evaluate(() => !!DB.row("SELECT id FROM projects WHERE code='SLOW-1'"));
    assert.equal(hasEdit, true, 'the promoted tab\'s database must contain the slow-flushed edit — a reload that raced ahead of it would have missed this row entirely');

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
    await waitForAppReady(tab1);
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
    await waitForAppReady(tabB);
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
