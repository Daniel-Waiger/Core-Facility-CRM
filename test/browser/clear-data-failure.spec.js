/* clear-data-failure.spec.js — item 4 (second Copilot review of PR #44):
 *
 * DB.clearAllData() used to catch-and-log a failed upload deletion internally and resolve
 * successfully anyway, so both "Clear All Data" (Settings) and "Start Fresh"/"Reset Sandbox"
 * (the seed paths) reported "cleared"/"reset" over a database that still had orphaned attachment
 * blobs sitting in IndexedDB. deleteAllUploads() now propagates that rejection, and both app.js
 * callers must catch it and toast an honest failure instead of the success message.
 *
 * Real browser, real click, DB.deleteUpload patched to reject so the failure is genuine rather
 * than simulated at the source level.
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN, setFlagScript, waitForAppReady } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

describe('clearAllData(): a failed upload deletion reports failure, not "cleared"', { skip }, () => {
  let browser, srv, page;

  before(async () => {
    srv = await startServer();
    browser = await playwright.chromium.launch(chromiumLaunchOptions());
    const ctx = await browser.newContext({ timezoneId: 'Asia/Jerusalem' });
    await ctx.addInitScript(QUIET_FIRST_RUN);
    await ctx.addInitScript(setFlagScript('admin-mode', '1'));
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

  test('Settings → Clear All Data: a rejected upload delete toasts failure, never "All facility data cleared."', async () => {
    await page.evaluate(() => window.App.route('settings'));
    await page.waitForTimeout(150);

    // Give the sandbox one real attachment blob so deleteAllUploads has something to iterate over,
    // then make ITS ACTUAL IndexedDB delete fail — deleteAllUploads calls the private idbDelete
    // directly, never the exported DB.deleteUpload wrapper, so stubbing that wrapper would not
    // touch the real code path at all. Patching IDBObjectStore.prototype.delete to abort the
    // transaction for an uploads:* key is a genuine post-swap-style storage failure, not a stub of
    // clearAllData itself.
    await page.evaluate(async () => {
      await window.DB.saveUpload('probe.bin', new Blob(['x']));
      const OrigDelete = IDBObjectStore.prototype.delete;
      window.__origIdbDelete = OrigDelete;
      IDBObjectStore.prototype.delete = function (key) {
        if (typeof key === 'string' && key.startsWith('uploads:')) {
          const req = OrigDelete.call(this, key);
          try { this.transaction.abort(); } catch (_) {}
          return req;
        }
        return OrigDelete.call(this, key);
      };
    });

    await page.click('[data-act="clear-data"]');
    await page.waitForTimeout(150);
    await page.click('.modal [data-act="yes"]');
    await page.waitForTimeout(300);

    const toastText = await page.evaluate(() => {
      const el = document.querySelector('#toasts .toast.error:last-child');
      return el ? el.textContent : null;
    });
    assert.ok(toastText, 'an error toast must appear');
    assert.match(toastText, /Could not fully clear/, 'the toast must report failure, not silently claim success');
    assert.doesNotMatch(toastText, /All facility data cleared/, 'must never show the success message on a failed clear');

    // The probe upload's blob is still what it is (deletion failed) — the app must not have moved
    // on as if the clear succeeded.
    await page.evaluate(() => { IDBObjectStore.prototype.delete = window.__origIdbDelete; });
    const stillThere = await page.evaluate(async () => !!(await window.DB.getUpload('probe.bin')));
    assert.ok(stillThere, 'the upload blob must still exist — clearAllData must not have been reported as successful');

    // Cleanup for any later test in this file/run.
    await page.evaluate(async () => { await window.DB.deleteUpload('probe.bin'); });
  });
});
