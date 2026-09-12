/* browser.js — shared plumbing for the browser suites.
 *
 * These suites need three things the unit tests do not: Playwright, a Chromium binary, and the
 * app served over http:// (the service worker and IndexedDB both behave differently under
 * file://). All three are resolved here so a suite can say "give me a page" and get on with
 * asserting.
 *
 * Playwright is deliberately NOT a dependency of this repo — there is no package.json, by design.
 * So it is resolved leniently: a local install, a global one, or an explicit path. When it is
 * missing the suites SKIP with a readable reason rather than failing, because a contributor who
 * has only Node should still be able to run `node --test test/unit/` and get a green tree.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');

/* Resolve Playwright from wherever it happens to live. Returns null (never throws) when absent,
   so callers can turn that into a skip. */
function tryRequirePlaywright() {
  // 1. A local install, or anything already on NODE_PATH.
  try { return require('playwright'); } catch (_) { /* keep looking */ }
  // 2. An explicit override, for unusual setups.
  if (process.env.PLAYWRIGHT_MODULE) {
    try { return require(process.env.PLAYWRIGHT_MODULE); } catch (_) { /* keep looking */ }
  }
  // 3. A global install — common on CI images and dev boxes that installed it once.
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (globalRoot) return require(path.join(globalRoot, 'playwright'));
  } catch (_) { /* give up quietly */ }
  return null;
}

/* Chromium's location. Playwright normally finds its own browser, and PLAYWRIGHT_BROWSERS_PATH is
   the documented way to point it at a shared download directory — so in the common case we pass
   nothing and let it resolve. CHROMIUM_PATH is an escape hatch for an environment that ships a
   browser Playwright did not install (which is exactly the case in some CI containers). */
function chromiumLaunchOptions() {
  const opts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    opts.executablePath = process.env.CHROMIUM_PATH;
  }
  return opts;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

/* Serve the repo over http on an ephemeral port. Written with node:http rather than shelling out
   to python3 or http-server so the suites depend on nothing but Node — one of the environment
   lessons in docs/cma-lessons.md is that `python3` is not present on every machine that runs
   this repo. */
function startServer(root = REPO) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // The query string matters to the app (?demo=1) but never to the filesystem.
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
      // Refuse to serve outside the repo, however the path was spelled.
      if (!filePath.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
      fs.readFile(filePath, (err, buf) => {
        if (err) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/* The first-run screens (welcome dialog, per-device storage notice) would sit in front of every
   assertion, and automatic backups have no business firing in a test. Suppress both the way a
   returning user's browser already would.

   Each key is written TWICE, bare and `demo:`-prefixed, because UI.storage namespaces its keys in
   a demo tab (everything except `theme`). A bare key alone is read as null under ?demo=1, so the
   suppression silently did nothing there — and worse, a flag a test sets to shape behaviour was
   quietly ignored: `admin-mode` read null, so the admin-gated Settings blocks a suite believed it
   was covering were never rendered at all. Writing both is deliberate over branching on
   location.search: the same context is reused for real and demo tabs in some suites, and a flag
   that applies to whichever tab opens is the behaviour every caller actually wants.
   Raised in review on PR #42. */
const TEST_FLAGS = {
  'crm-hide-startup-modal': '1',
  'crm-seen-device-notice': '1',
  'crm-declined-backup-folder': '1',
  'auto-backup-enabled': '0',
};

const QUIET_FIRST_RUN = () => {
  // Inlined rather than referencing TEST_FLAGS: this function is serialised into the page by
  // Playwright's addInitScript, so it cannot close over anything from this module.
  try {
    const flags = {
      'crm-hide-startup-modal': '1',
      'crm-seen-device-notice': '1',
      'crm-declined-backup-folder': '1',
      'auto-backup-enabled': '0',
    };
    for (const [k, v] of Object.entries(flags)) {
      localStorage.setItem(k, v);
      localStorage.setItem('demo:' + k, v);   // UI.storage namespaces every key but `theme`
    }
  } catch (_) { /* a browser that blocks storage will show the notice; harmless here */ }
};

/* Set an arbitrary app preference from a test, under both namespaces, for the same reason. */
function setFlagScript(key, value) {
  return `(() => { try {
    localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});
    localStorage.setItem(${JSON.stringify('demo:' + key)}, ${JSON.stringify(value)});
  } catch (_) {} })()`;
}

/* Item 9 (second review): every spec used to consider the app "open" as soon as
   `window.DB && window.App` existed — but both are assigned SYNCHRONOUSLY at script-eval time
   (js/app.js's `global.App = {...}` runs immediately; js/db.js attaches `global.DB` the same way),
   well before `App.boot()`'s own `await DB.boot()` (IndexedDB open + schema init/migrate, all
   async) resolves. A spec's very next `page.evaluate`/`DB.run()` call could therefore race real
   boot work — reading/writing a database that isn't ready yet, or an App whose routing/dispatcher
   isn't wired up. Wait for a signal that only exists once finishBoot() has actually rendered the
   shell instead: `#page-title` is created by renderShell(), called from finishBoot(status) AFTER
   `await DB.boot()` and (in a demo tab) AFTER `await DB.seedSampleData()` both resolve — so its
   presence means boot is genuinely done, not merely started. */
async function waitForAppReady(page) {
  await page.waitForFunction(() => !!(window.DB && window.App && document.getElementById('page-title')));
}

module.exports = { tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN, setFlagScript, TEST_FLAGS, REPO, waitForAppReady };
