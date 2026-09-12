/* boot-ready-signal.test.js — item 9 (second review of PR #44):
 *
 * Every browser spec used to consider the app "open" as soon as `window.DB && window.App` were
 * truthy (test/browser/helpers/browser.js's new waitForAppReady, and every spec that used to
 * inline the same check before it existed). Both are assigned SYNCHRONOUSLY at script-eval time —
 * `global.App = {...}` at the very top of js/app.js's IIFE, `global.DB = {...}` the same way in
 * js/db.js — well before App.boot()'s own `await DB.boot()` (IndexedDB open + schema init, all
 * async) resolves. A spec's next `DB.run()`/`page.evaluate()` could race real boot work.
 *
 * This can't be asserted reliably by timing a real browser (the race window is real but too small
 * to force deterministically, and a flaky timing-based test is worse than none). What CAN be
 * pinned down deterministically is the STRUCTURAL fact waitForAppReady's fix relies on: `#page-title`
 * is created by renderShell(), which only runs from finishBoot(status) AFTER `await DB.boot()` has
 * already resolved — so `document.getElementById('page-title')` existing is a genuine "boot is
 * done" signal, not just "the script finished loading". If a future refactor moved renderShell()
 * before the boot await, or moved `global.App = {...}` after it, this test would catch it.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO } = require('./helpers/load-module');

describe('boot-ready signal: #page-title is only created AFTER DB.boot() resolves, not at script-eval time', () => {
  test('js/app.js assigns global.App synchronously (script-eval time), before the boot() function ever runs', () => {
    const src = fs.readFileSync(path.join(REPO, 'js/app.js'), 'utf8');
    const appAssignIdx = src.indexOf('global.App = {');
    const bootFnIdx = src.indexOf('async function boot()');
    assert.ok(appAssignIdx >= 0, 'global.App = {...} must exist');
    assert.ok(bootFnIdx >= 0, 'async function boot() must exist');
    assert.ok(appAssignIdx < bootFnIdx, 'global.App must be assigned BEFORE boot() is even defined — confirming window.App becomes truthy at script load, not after boot resolves (this is exactly why "window.DB && window.App" alone is not a safe ready-signal)');
  });

  test('renderShell() (which creates #page-title) is only called from finishBoot(), which only runs after "await DB.boot()" — never before it', () => {
    const src = fs.readFileSync(path.join(REPO, 'js/app.js'), 'utf8');

    const bootBodyMatch = src.match(/async function boot\(\)\s*{([\s\S]*?)\n  }\n/);
    assert.ok(bootBodyMatch, 'could not isolate boot()\'s body — check the regex if app.js\'s boot() shape changed');
    const bootBody = bootBodyMatch[1];

    const dbBootIdx = bootBody.indexOf('await DB.boot()');
    const finishBootCallIdx = bootBody.indexOf('await finishBoot(status)');
    assert.ok(dbBootIdx >= 0, 'boot() must call "await DB.boot()"');
    assert.ok(finishBootCallIdx >= 0, 'boot() must call "await finishBoot(status)"');
    assert.ok(dbBootIdx < finishBootCallIdx, 'finishBoot() must be called AFTER "await DB.boot()" resolves, not before');

    const finishBootSrcIdx = src.indexOf('async function finishBoot(status)');
    const renderShellCallIdx = src.indexOf('renderShell();', finishBootSrcIdx);
    assert.ok(finishBootSrcIdx >= 0 && renderShellCallIdx > finishBootSrcIdx, 'finishBoot() must call renderShell() — the function that creates #page-title (see id="page-title" in its own template)');

    // #page-title is the literal DOM id renderShell()'s own template creates.
    assert.ok(src.includes('id="page-title"'), 'renderShell()\'s template must create an element with id="page-title" — the signal waitForAppReady polls for');
  });
});
