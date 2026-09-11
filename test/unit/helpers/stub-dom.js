/* stub-dom.js — the smallest browser this app will load in.
 *
 * The app's modules are browser IIFEs, not Node modules: each one hangs a single global off
 * `window` and some touch DOM APIs while merely *loading*. `js/ui.js`, for instance, registers a
 * top-level `document.addEventListener('keydown', …)` for the Esc / "/" shortcuts, and
 * `js/consts.js` reads `location.search` to decide demo mode. Node 22 has none of
 * `window`, `document`, `localStorage`, `matchMedia`, `location` or `DOMParser` (verified), so
 * without these stubs the files throw before defining anything and nothing can be tested.
 *
 * This is deliberately NOT a DOM implementation. It exists to let a file finish loading so its
 * PURE functions — the money maths, the hour maths, the date helpers, the label maps — can be
 * called directly. Anything that genuinely renders or parses HTML is out of scope here and
 * belongs in test/browser/ instead; `sanitizeHtml` is the notable one, since it needs a real
 * DOMParser and a real document.implementation.
 */
'use strict';

function installDomStubs({ search = '', store = {} } = {}) {
  const noop = () => {};
  const emptyEl = () => ({
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    innerHTML: '', textContent: '', value: '', checked: false,
    setAttribute: noop, removeAttribute: noop, getAttribute: () => null,
    appendChild: noop, prepend: noop, append: noop, remove: noop, insertBefore: noop,
    addEventListener: noop, removeEventListener: noop, click: noop, focus: noop, blur: noop, select: noop,
    closest: () => null, contains: () => false,
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });

  const doc = {
    addEventListener: noop, removeEventListener: noop,
    createElement: emptyEl, createTextNode: (t) => ({ nodeValue: t }),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    body: emptyEl(),
    documentElement: { setAttribute: noop, getAttribute: () => 'light', style: {} },
  };

  // localStorage is backed by a plain object the caller can inspect, so a test can assert what
  // the app actually wrote (and, for demo mode, under which prefixed key).
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };

  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.document = doc;
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = localStorage;
  globalThis.location = { search, hash: '', protocol: 'http:', hostname: 'localhost', href: 'http://localhost/index.html' + search };
  globalThis.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  // Node 22 defines `navigator` itself, as a getter-only global — assigning to it throws. The
  // app only reads it from UI.detectOS (guidance text only, never logic) and that call is already
  // wrapped in try/catch, so leaving Node's own object in place is fine.
  if (!globalThis.navigator) {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'node', maxTouchPoints: 0 }, configurable: true, writable: true,
    });
  }
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = noop;

  return { store, localStorage, document: doc };
}

module.exports = { installDomStubs };
