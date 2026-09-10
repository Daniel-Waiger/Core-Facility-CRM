/* load-module.js — load the app's browser IIFEs into this Node process.
 *
 * `index.html` loads seven plain <script> tags in a fixed order, each an IIFE that attaches one
 * global: consts.js (CONST, APP_VERSION, IS_DEMO) → db.js (DB) → ui.js (UI) → views.js (Views) →
 * reports.js (Reports) → exports.js (Exports) → app.js (App). There is no module system, so
 * `require` cannot reach any of it. Evaluating the file text against a prepared global is the
 * only way in, and it is faithful: it is exactly what the browser does.
 *
 * Order matters for the same reason it matters in the browser — a later file may call into an
 * earlier one's global — so callers pass the list they need, shortest first. Most tests only need
 * ['consts', 'ui'].
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { installDomStubs } = require('./stub-dom');

const REPO = path.resolve(__dirname, '..', '..', '..');
const JS_DIR = path.join(REPO, 'js');

/* Read an app source file as text, without evaluating it. Used by the consistency tests, which
   inspect the source rather than running it (counting data-act values, icon names, and so on). */
function readSource(name) {
  return fs.readFileSync(path.join(JS_DIR, name.endsWith('.js') ? name : name + '.js'), 'utf8');
}

function sourcePath(name) {
  return path.join(JS_DIR, name.endsWith('.js') ? name : name + '.js');
}

/* Evaluate the named app modules in order and return the globals they attached.
 *
 * `search` becomes location.search, which is how consts.js decides window.IS_DEMO — so a test can
 * load the app "as a demo tab" by passing '?demo=1'. `store` is the object backing localStorage,
 * so a test can inspect what got written and under which key. */
function loadApp(names, { search = '', store = {} } = {}) {
  const stubs = installDomStubs({ search, store });

  for (const name of names) {
    const src = fs.readFileSync(sourcePath(name), 'utf8');
    // Indirect eval via Function keeps the file's own `(function (global) { … })(window)` wrapper
    // intact and running against our stubbed globals, rather than Node's module scope.
    new Function(src)();
  }

  return {
    CONST: globalThis.CONST,
    APP_VERSION: globalThis.APP_VERSION,
    IS_DEMO: globalThis.IS_DEMO,
    DB: globalThis.DB,
    UI: globalThis.UI,
    Views: globalThis.Views,
    Reports: globalThis.Reports,
    Exports: globalThis.Exports,
    App: globalThis.App,
    ...stubs,
  };
}

module.exports = { loadApp, readSource, sourcePath, REPO, JS_DIR };
