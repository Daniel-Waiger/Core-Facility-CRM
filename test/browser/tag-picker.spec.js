/* tag-picker.spec.js — the booking Tags field (mountTagPicker in js/app.js) in both the new-
 * booking and edit-booking dialogs: the dropdown shows known tags with their usage counts, typing
 * and Enter selects an existing tag or creates a new one, removing a chip drops it from the
 * stored (hidden-input) value, and an edit dialog seeds its chips from the booking's existing
 * `meetings.tags` string. Modeled on smoke.spec.js / output-type-fields.spec.js.
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN, waitForAppReady } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

describe('booking Tags field: mountTagPicker', { skip }, () => {
  let browser, srv, page, errors;

  before(async () => {
    srv = await startServer();
    browser = await playwright.chromium.launch(chromiumLaunchOptions());
    const ctx = await browser.newContext({ timezoneId: 'Asia/Jerusalem' });
    await ctx.addInitScript(QUIET_FIRST_RUN);
    page = await ctx.newPage();
    errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(srv.base + '/index.html?demo=1');
    await waitForAppReady(page);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.UI && UI.stopTour && UI.stopTour());
  });

  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.close();
  });

  const hiddenValue = (id) => page.evaluate((i) => document.querySelector('.modal #' + i).value, id);

  test('new-booking dialog: the tag dropdown shows on focus with usage counts', async () => {
    await page.evaluate(() => App.route('calendar'));
    await page.waitForTimeout(400);
    await page.click('[data-act="new-booking"]');
    await page.waitForSelector('.modal #bk-tags', { state: 'attached' });

    const before = await page.evaluate(() => {
      const dd = document.querySelector('.tag-picker[data-for="bk-tags"] .tag-dropdown');
      return { hiddenAttr: dd.hidden };
    });
    assert.equal(before.hiddenAttr, true, 'dropdown should start hidden before the search box is focused');

    await page.focus('.modal .tag-picker[data-for="bk-tags"] .tag-search');
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => {
      const dd = document.querySelector('.tag-picker[data-for="bk-tags"] .tag-dropdown');
      return { hiddenAttr: dd.hidden, text: dd.innerText };
    });
    assert.equal(after.hiddenAttr, false, 'dropdown should become visible on focus');
    assert.match(after.text, /×\d+/, `expected a usage count like "×3" in the dropdown: ${after.text.slice(0, 200)}`);
  });

  test('typing a tag and pressing Enter creates/selects a chip and updates the hidden value', async () => {
    const search = '.modal .tag-picker[data-for="bk-tags"] .tag-search';
    await page.fill(search, 'Fiji');
    await page.press(search, 'Enter');
    await page.waitForTimeout(100);
    let v = await hiddenValue('bk-tags');
    assert.equal(v, 'Fiji', `expected hidden value "Fiji", got ${JSON.stringify(v)}`);
    const chip = await page.$('.modal .tag-picker[data-for="bk-tags"] .token[data-tag="Fiji"]');
    assert.ok(chip, 'expected a Fiji chip to render');

    await page.fill(search, 'Brandnew');
    await page.press(search, 'Enter');
    await page.waitForTimeout(100);
    v = await hiddenValue('bk-tags');
    assert.equal(v, 'Fiji, Brandnew', `expected hidden value "Fiji, Brandnew", got ${JSON.stringify(v)}`);

    await page.click('.modal .tag-picker[data-for="bk-tags"] .token[data-tag="Fiji"] .token-x');
    await page.waitForTimeout(100);
    v = await hiddenValue('bk-tags');
    assert.equal(v, 'Brandnew', `expected hidden value "Brandnew" after removing Fiji, got ${JSON.stringify(v)}`);

    // Close the modal (Esc clears the search box first if non-empty, then a second Esc closes).
    await page.press(search, 'Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });

  test('keyboard: Tab reaches the first option and Enter selects it; typed text left behind is committed when focus leaves the picker', async () => {
    await page.evaluate(() => App.route('calendar'));
    await page.waitForTimeout(400);
    await page.click('[data-act="new-booking"]');
    await page.waitForSelector('.modal #bk-tags', { state: 'attached' });
    const search = '.modal .tag-picker[data-for="bk-tags"] .tag-search';

    // Tab from the search box lands on the first option button; the dropdown must stay open
    // (focus is still inside the picker) and Enter on the button must select that tag.
    await page.focus(search);
    await page.waitForTimeout(100);
    const firstTag = await page.evaluate(() => document.querySelector('.modal .tag-picker[data-for="bk-tags"] .tag-option').dataset.tag);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(250);
    const focusState = await page.evaluate(() => ({
      onOption: document.activeElement.classList.contains('tag-option'),
      hidden: document.querySelector('.modal .tag-picker[data-for="bk-tags"] .tag-dropdown').hidden,
    }));
    assert.equal(focusState.onOption, true, 'Tab from the search box must focus the first tag option');
    assert.equal(focusState.hidden, false, 'the dropdown must stay open while an option has focus');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    assert.equal(await hiddenValue('bk-tags'), firstTag, 'Enter on a focused option must select that tag');

    // Type a new tag and move focus straight to the Title field, as a user heading for Save
    // would: the pending text becomes a tag instead of being lost.
    await page.fill(search, 'Leftbehind');
    await page.focus('.modal #bk-title');
    await page.waitForTimeout(300);
    assert.equal(await hiddenValue('bk-tags'), firstTag + ', Leftbehind', 'text left in the box is committed when focus leaves the picker');
    await page.evaluate(() => window.UI.closeAllModals());
  });

  test('edit-booking dialog seeds its chips from the stored tags string', async () => {
    const seed = await page.evaluate(() => {
      const row = DB.row("SELECT id, tags FROM meetings WHERE tags<>'' ORDER BY id LIMIT 1");
      document.body.insertAdjacentHTML('beforeend', '<button id="t-edit" data-act="edit-booking" data-id="' + row.id + '"></button>');
      document.getElementById('t-edit').click();
      return row;
    });
    await page.waitForSelector('.modal #bke-tags', { state: 'attached' });
    await page.waitForTimeout(200);
    const v = await hiddenValue('bke-tags');
    assert.equal(v, seed.tags, `expected the edit dialog's stored tags to equal ${JSON.stringify(seed.tags)}, got ${JSON.stringify(v)}`);
    const chipCount = await page.evaluate(() => document.querySelectorAll('.modal .tag-picker[data-for="bke-tags"] .token').length);
    const expectedCount = await page.evaluate((tags) => UI.parseTags(tags).length, seed.tags);
    assert.equal(chipCount, expectedCount, `expected ${expectedCount} chips, got ${chipCount}`);
    await page.evaluate(() => window.UI.closeAllModals());
  });

  test('no JavaScript errors were logged while exercising the tag picker', async () => {
    assert.deepEqual(errors, [], `JavaScript errors:\n  ${errors.join('\n  ')}`);
  });
});
