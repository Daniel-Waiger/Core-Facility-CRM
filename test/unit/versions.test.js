/* versions.test.js — "Versioning: two places, not one" (CLAUDE.md).
 *
 * The `?v=` cache-busters on every <script>/<link> tag in index.html are mirrored in sw.js
 * (CACHE_VERSION + PRECACHE_URLS) and must move together, or the service worker keeps serving a
 * stale cached app forever. window.APP_VERSION (js/consts.js) is a SEPARATE, independent string
 * that conventionally matches anyway, and CHANGELOG.md's newest heading should match too. The
 * manual's own `manual.js?v=N` / `manual.css?v=N` cache-buster is independent BY DESIGN — it must
 * be internally consistent, but is never asserted equal to the app version.
 *
 * All of this reads SOURCE AS TEXT, per the task brief.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO } = require('./helpers/load-module');

function read(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), 'utf8');
}

const indexHtml = read('index.html');
const swJs = read('sw.js');
const constsJs = read('js/consts.js');
const changelog = read('CHANGELOG.md');
const manifestJson = read('manifest.json');

/* ---------------------------------------------------------------------------------------------
 * 1. All ?v= query strings in index.html are the same version.
 * ------------------------------------------------------------------------------------------- */

// Matches `?v=X.Y.Z` wherever it trails a src="…" or href="…" attribute value in index.html.
const V_PARAM_RE = /\?v=([0-9]+\.[0-9]+\.[0-9]+)/g;

function scrapeVParams(src) {
  return [...src.matchAll(V_PARAM_RE)].map((m) => m[1]);
}

describe('index.html cache-busters', () => {
  const versions = scrapeVParams(indexHtml);

  test('index.html has exactly 8 ?v= cache-busters (1 css + 7 js), all naming the same version', () => {
    assert.equal(versions.length, 8, `expected 8 "?v=" tags in index.html, found ${versions.length}: ${versions.join(', ')}`);
    const distinct = new Set(versions);
    assert.equal(distinct.size, 1, `index.html mixes multiple ?v= versions: ${[...distinct].join(', ')}`);
  });

  const appVersion = versions[0];

  test('sw.js CACHE_VERSION equals the index.html version', () => {
    const m = swJs.match(/const CACHE_VERSION = '([^']+)'/);
    assert.ok(m, 'could not find CACHE_VERSION in sw.js');
    assert.equal(m[1], appVersion, `sw.js CACHE_VERSION (${m[1]}) does not match index.html's ?v= (${appVersion})`);
  });

  test("sw.js PRECACHE_URLS' versioned entries match index.html's versioned asset URLs byte-for-byte", () => {
    // Pull every src="…"/href="…" URL out of index.html that carries our own app's ?v=, in
    // document order — these are the URLs the running page will actually request.
    const tagRe = /(?:src|href)="((?:css|js)\/[^"]+\?v=[0-9.]+)"/g;
    const indexAssetUrls = [...indexHtml.matchAll(tagRe)].map((m) => './' + m[1]);
    assert.ok(indexAssetUrls.length > 0, 'found zero versioned asset tags in index.html — tag regex is broken');

    // From PRECACHE_URLS, take only the versioned entries (anything carrying "?v="). The
    // `libs/*` entries are deliberately UNVERSIONED (third-party bundles pinned by filename, not
    // by query string) and must be excluded here rather than compared — they have no counterpart
    // in index.html's own ?v= tags at all.
    const precacheMatch = swJs.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
    assert.ok(precacheMatch, 'could not find PRECACHE_URLS array in sw.js');
    const allPrecacheUrls = [...precacheMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const versionedPrecacheUrls = allPrecacheUrls.filter((u) => u.includes('?v='));

    // Byte-for-byte set match, per CLAUDE.md's own warning: "a precache entry without the query
    // string would never match them" — so this must be an exact set, not a subset/prefix check.
    const missingFromPrecache = indexAssetUrls.filter((u) => !versionedPrecacheUrls.includes(u));
    const extraInPrecache = versionedPrecacheUrls.filter((u) => !indexAssetUrls.includes(u));
    assert.deepEqual(missingFromPrecache, [], `index.html assets missing from sw.js PRECACHE_URLS: ${missingFromPrecache.join(', ')}`);
    assert.deepEqual(extraInPrecache, [], `sw.js PRECACHE_URLS has versioned entries not requested by index.html: ${extraInPrecache.join(', ')}`);

    // And every one of those precache entries must actually carry OUR version (not some stale
    // leftover ?v= from a half-finished bump).
    const wrongVersion = versionedPrecacheUrls.filter((u) => !u.endsWith('?v=' + appVersion));
    assert.deepEqual(wrongVersion, [], `sw.js PRECACHE_URLS entries not using the current version (${appVersion}): ${wrongVersion.join(', ')}`);
  });

  test('window.APP_VERSION (js/consts.js) equals the index.html version', () => {
    const m = constsJs.match(/window\.APP_VERSION = '([^']+)'/);
    assert.ok(m, 'could not find window.APP_VERSION assignment in js/consts.js');
    assert.equal(m[1], appVersion, `js/consts.js APP_VERSION (${m[1]}) does not match index.html's ?v= (${appVersion})`);
  });

  test("CHANGELOG.md's newest heading equals the index.html version, and its date is real", () => {
    // Headings look like "## [1.10.0] — 2026-09-10" — note the separator is an EM DASH (U+2014),
    // not a hyphen, so it's included literally rather than as "-" in the pattern.
    const headingRe = /^## \[([0-9]+\.[0-9]+\.[0-9]+)\] — (\d{4}-\d{2}-\d{2})$/m;
    const m = changelog.match(headingRe);
    assert.ok(m, 'could not find a "## [x.y.z] — YYYY-MM-DD" heading in CHANGELOG.md');
    assert.equal(m[1], appVersion, `CHANGELOG.md's newest heading (${m[1]}) does not match index.html's ?v= (${appVersion})`);

    const [, , dateStr] = m;
    const [y, mo, d] = dateStr.split('-').map(Number);
    const parsed = new Date(y, mo - 1, d);
    const isRealDate = parsed.getFullYear() === y && parsed.getMonth() === mo - 1 && parsed.getDate() === d;
    assert.ok(isRealDate, `CHANGELOG.md's newest heading date "${dateStr}" is not a real calendar date`);
  });
});

/* ---------------------------------------------------------------------------------------------
 * 6. The manual's SEPARATE cache-buster: internally consistent, not tied to the app version.
 * ------------------------------------------------------------------------------------------- */

describe('docs/manual cache-buster (independent of the app version, by design)', () => {
  test('every manual.js?v=N / manual.css?v=N tag across docs/manual/*.html shares one N', () => {
    const manualDir = path.join(REPO, 'docs', 'manual');
    const files = fs.readdirSync(manualDir).filter((f) => f.endsWith('.html'));
    assert.ok(files.length > 0, 'found zero docs/manual/*.html files — did the manual move?');

    const tagRe = /manual\.(?:js|css)\?v=([0-9]+)/g;
    const found = [];
    for (const file of files) {
      const src = fs.readFileSync(path.join(manualDir, file), 'utf8');
      for (const m of src.matchAll(tagRe)) found.push({ file, v: m[1] });
    }

    // Every manual page carries exactly one manual.css tag and one manual.js tag, so the total
    // tag count across all pages should be exactly 2x the page count — catches a page that
    // forgot to tag one or the other (or both) as surely as a version mismatch would.
    assert.equal(found.length, files.length * 2,
      `expected ${files.length * 2} manual.js/css ?v= tags across ${files.length} manual pages, found ${found.length}`);

    const distinct = new Set(found.map((f) => f.v));
    assert.equal(distinct.size, 1,
      `docs/manual/*.html mixes multiple manual cache-buster versions: ${[...distinct].join(', ')} (e.g. ${JSON.stringify(found.find((f) => f.v !== found[0].v) || found[0])})`);
  });
});

/* ---------------------------------------------------------------------------------------------
 * 7. manifest.json parses; sw.js precaches the shell.
 * ------------------------------------------------------------------------------------------- */

describe('manifest.json and the app-shell precache entries', () => {
  test('manifest.json parses as valid JSON', () => {
    assert.doesNotThrow(() => JSON.parse(manifestJson), 'manifest.json failed to parse');
  });

  test("sw.js PRECACHE_URLS includes the shell entries './' and './index.html'", () => {
    const precacheMatch = swJs.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
    assert.ok(precacheMatch, 'could not find PRECACHE_URLS array in sw.js');
    const urls = [...precacheMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.ok(urls.includes('./'), "PRECACHE_URLS is missing './' (the shell's unversioned entry)");
    assert.ok(urls.includes('./index.html'), "PRECACHE_URLS is missing './index.html'");
  });
});
