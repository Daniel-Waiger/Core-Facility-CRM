/* sanitize.spec.js — the note sanitizer and the link guard.
 *
 * Booking notes are stored as a small subset of HTML produced by a contentEditable editor, and
 * UI.sanitizeHtml decides what is allowed to persist and render. That makes it a security
 * boundary: anything it lets through is injected into the page later, on a screen a facility
 * manager trusts.
 *
 * It can only be tested in a real browser. It is built on `new DOMParser()` and
 * `document.implementation.createHTMLDocument()`, and Node 22 has neither (verified) — so unlike
 * the money and date maths, there is no way to reach this from test/unit/.
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN } = require('./helpers/browser');

const playwright = tryRequirePlaywright();
const skip = playwright ? false : 'Playwright is not installed — see test/README.md (unit tests need nothing)';

describe('note sanitizer and link guard', { skip }, () => {
  let browser, srv, page;

  before(async () => {
    srv = await startServer();
    browser = await playwright.chromium.launch(chromiumLaunchOptions());
    const ctx = await browser.newContext();
    await ctx.addInitScript(QUIET_FIRST_RUN);
    page = await ctx.newPage();
    await page.goto(srv.base + '/index.html');
    await page.waitForFunction(() => window.UI && window.UI.sanitizeHtml);
  });

  after(async () => {
    if (browser) await browser.close();
    if (srv) await srv.close();
  });

  const clean = (html) => page.evaluate((h) => UI.sanitizeHtml(h), html);

  test('script and style elements are dropped entirely', async () => {
    for (const payload of [
      '<script>alert(1)</script>',
      '<p>before<script>alert(1)</script>after</p>',
      '<style>body{display:none}</style>',
      '<SCRIPT>alert(1)</SCRIPT>',
    ]) {
      const out = await clean(payload);
      assert.ok(!/<script/i.test(out), `script survived: ${payload} -> ${out}`);
      assert.ok(!/<style/i.test(out), `style survived: ${payload} -> ${out}`);
      assert.ok(!/alert\(1\)/.test(out), `script BODY survived, which is the dangerous part: ${payload} -> ${out}`);
    }
  });

  test('event-handler attributes are stripped from allowed tags', async () => {
    // The tag is on the allow-list; the attribute must not survive with it. sanitizeHtml rebuilds
    // each permitted element from scratch rather than filtering attributes off the original,
    // which is why this holds — worth pinning so a future rewrite keeps the property.
    for (const payload of [
      '<b onclick="alert(1)">bold</b>',
      '<p onmouseover="alert(1)">hi</p>',
      '<span onerror="alert(1)" onload="alert(1)">x</span>',
    ]) {
      const out = await clean(payload);
      assert.ok(!/on\w+\s*=/i.test(out), `event handler survived: ${payload} -> ${out}`);
    }
  });

  test('disallowed tags are unwrapped, keeping their text', async () => {
    // Unwrapping rather than escaping matters: a note pasted from elsewhere keeps its words
    // instead of showing raw angle brackets to the reader.
    const out = await clean('<div><article>kept text</article></div>');
    assert.ok(out.includes('kept text'), `text was lost: ${out}`);
    assert.ok(!/<article/i.test(out), `unknown tag survived: ${out}`);

    const img = await clean('<img src=x onerror="alert(1)">');
    assert.ok(!/<img/i.test(img), `img survived: ${img}`);
    assert.ok(!/onerror/i.test(img), `onerror survived: ${img}`);
  });

  test('formatting tags on the allow-list are preserved', async () => {
    const out = await clean('<b>b</b><i>i</i><u>u</u><ul><li>one</li></ul>');
    for (const tag of ['b', 'i', 'u', 'ul', 'li']) {
      assert.ok(new RegExp(`<${tag}`, 'i').test(out), `${tag} should have been kept: ${out}`);
    }
  });

  test('font-size is clamped so a note cannot dominate the page', async () => {
    const huge = await clean('<span style="font-size:400px">huge</span>');
    const px = huge.match(/font-size:\s*([\d.]+)px/);
    assert.ok(px, `expected a clamped px font-size, got: ${huge}`);
    assert.ok(parseFloat(px[1]) <= 48, `font-size not clamped: ${huge}`);

    const ok = await clean('<span style="font-size:1.5em">fine</span>');
    assert.ok(/font-size:\s*1\.5em/.test(ok), `a reasonable em size should survive: ${ok}`);
  });

  test('an empty editor yields an empty string, not stray markup', async () => {
    for (const payload of ['', '   ', '<p></p>', '<div><br></div>']) {
      assert.equal(await clean(payload), '', `expected '' for ${JSON.stringify(payload)}`);
    }
  });

  test('noteHtml treats a genuinely tag-free legacy note as plain text', async () => {
    // Notes predating the rich-text editor are stored as plain text with newlines, so they must
    // be escaped and line-broken rather than parsed as HTML.
    const out = await page.evaluate(() => UI.noteHtml('plain & risky\nsecond line'));
    assert.ok(out.includes('&amp;'), `ampersand should be escaped: ${out}`);
    assert.ok(out.includes('<br>'), `newline should become a break: ${out}`);
    assert.ok(!/<(?!br)/i.test(out), `no markup should have been introduced: ${out}`);
  });

  test('a legacy note containing something tag-shaped goes down the sanitizer path', async () => {
    // noteHtml decides between "plain text" and "rich text" with /<[a-z][\s\S]*>/i, so a note
    // written before the editor existed that happens to contain angle brackets around a word —
    // "filter <none> applied" — is treated as HTML. The sanitizer then UNWRAPS the unknown tag,
    // which drops those characters from what the reader sees.
    //
    // Pinned as the current, SAFE behaviour rather than asserted as desirable: nothing dangerous
    // survives, which is what this file is here to guarantee. It is a minor display quirk (the
    // literal text is lost, not escaped), noted so a future change here is a deliberate one.
    const out = await page.evaluate(() => UI.noteHtml('filter <none> applied'));
    assert.ok(!/<none/i.test(out), `nothing tag-shaped should survive: ${out}`);
    assert.ok(out.includes('filter'), `surrounding words should survive: ${out}`);
    assert.ok(out.includes('applied'), `surrounding words should survive: ${out}`);
  });

  test('isSafeUrl gates which stored links become clickable', async () => {
    // This decides whether a project's file entry renders as a real <a href>. A false positive
    // here is a clickable javascript: URL on a trusted screen.
    const cases = [
      ['https://example.org/a.pdf', true],
      ['http://example.org', true],
      ['HTTPS://EXAMPLE.ORG', true],
      ['  https://example.org  ', true],
      ['javascript:alert(1)', false],
      ['JaVaScRiPt:alert(1)', false],
      ['data:text/html;base64,PHNjcmlwdD4=', false],
      ['file:///etc/passwd', false],
      ['//example.org', false],
      ['/relative/path', false],
      ['', false],
      [null, false],
    ];
    for (const [url, expected] of cases) {
      const got = await page.evaluate((u) => UI.isSafeUrl(u), url);
      assert.equal(got, expected, `isSafeUrl(${JSON.stringify(url)}) should be ${expected}`);
    }
  });
});
