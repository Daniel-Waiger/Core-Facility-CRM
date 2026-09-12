/* app-harness.js — boots the REAL js/app.js (plus consts/db/ui/views/reports/exports before it)
 * against a real in-memory sql.js database, so tests can call the private functions app.js keeps
 * inside its own closure (findBookingConflicts, cancelBooking, archiveProject, retirePerson, …) —
 * none of which are on `global.App` (see js/app.js's `global.App = {...}` export list) and so are
 * otherwise unreachable, per the exact gap schema.test.js already documents for pi_id nulling.
 *
 * How internals are reached: this file reads js/app.js AS TEXT (same "evaluate the file's own IIFE
 * against a prepared global" trick load-module.js uses) and inserts one extra line — a plain object
 * literal assigning the functions under test onto `global.__TEST_APP_INTERNALS__` — immediately
 * before the IIFE's own closing `})(window);`. This changes nothing about what ships: the actual
 * file on disk (js/app.js) is never touched, only the in-memory string this test process evaluates.
 * It is exactly the same "read source, evaluate against stubs" idea load-module.js already uses,
 * extended one line further because app.js (unlike db.js/ui.js) exports almost nothing.
 *
 * Three things every one of these internals needs that a plain Node process doesn't have, stubbed
 * to the SMALLEST thing that satisfies them without faking the behavior under test:
 *   - `document.getElementById('view'|'toasts'|…)`: refresh()/toast() do an unconditional
 *     `.innerHTML =` / `.appendChild()` on whatever this returns — these tests don't read what
 *     lands there, so a bare object with those two properties is enough.
 *   - `UI.confirmModal` / `UI.toast`: real implementations build and query actual DOM (see
 *     CLAUDE.md/the adversarial review's H4 on `.modal` lookups) — replaced with the smallest
 *     stand-ins (a resolvable promise, a no-op) so the DB-writing code *after* the confirmation
 *     click is what actually runs and gets asserted on, same as a person really clicking "Yes".
 *   - `DOMParser` / `document.implementation` / `FileReader`: only reached by two specific real
 *     functions this file needs to run — `UI.sanitizeHtml` (booking notes) and `DB.buildBackup`'s
 *     upload encoding — and only ever with plain, tag-free strings / real Node Blobs in these
 *     tests, so the stand-ins below implement exactly that subset, not a browser.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { installDomStubs } = require('./stub-dom');
const { sourcePath, REPO } = require('./load-module');

function injectAppInternals(src) {
  const marker = '\n})(window);';
  const idx = src.lastIndexOf(marker);
  if (idx === -1) throw new Error('app-harness: could not find app.js\'s closing "})(window);" to inject test internals — has the IIFE wrapper changed?');
  const expose = `
  global.__TEST_APP_INTERNALS__ = {
    ctx: ctx,
    findBookingConflicts: findBookingConflicts,
    computeRecurringDates: computeRecurringDates,
    bookingHasStarted: bookingHasStarted,
    deleteMeetingRaw: deleteMeetingRaw,
    cancelBooking: cancelBooking,
    reinstateBooking: reinstateBooking,
    archiveProject: archiveProject,
    retirePerson: retirePerson,
    retireInstrument: retireInstrument,
    retireGrant: retireGrant,
    retirePricingTier: retirePricingTier,
    bookingSave: bookingSave,
    bookingEditSave: bookingEditSave,
  };
`;
  return src.slice(0, idx) + expose + src.slice(idx);
}

/* A DOMParser/document.implementation stand-in narrow enough to be honest about its limits: it
 * only understands a tag-free string (exactly what every test in this harness feeds it — see the
 * fake booking-modal builder's note fields). Anything with a literal "<" in it is exactly what
 * test/browser/sanitize.spec.js exists to cover with a *real* DOMParser; this stub deliberately
 * does not attempt that and would misbehave silently if asked to. */
function installNoteSanitizerStubs() {
  function FakeTextNode(v) { this.nodeType = 3; this.nodeValue = v; }
  globalThis.DOMParser = function () {};
  globalThis.DOMParser.prototype.parseFromString = function (str) {
    const s = String(str || '');
    if (s.includes('<')) {
      throw new Error('app-harness\'s DOMParser stub only supports tag-free text — use test/browser/sanitize.spec.js for real HTML sanitizing coverage');
    }
    return { body: { childNodes: { forEach(fn) { if (s) fn(new FakeTextNode(s)); } } } };
  };
  globalThis.document.implementation = {
    createHTMLDocument() {
      const body = {
        _text: '',
        appendChild(node) { if (node.nodeType === 3) body._text += node.nodeValue; },
        get textContent() { return body._text; },
        get innerHTML() { return body._text; },
        querySelector() { return null; },
      };
      body.ownerDocument = {
        createElement() { throw new Error('app-harness\'s DOMParser stub does not support element nodes in notes'); },
        createTextNode: (t) => new FakeTextNode(t),
      };
      return { body };
    },
  };
}

/* FileReader doesn't exist in Node; DB.buildBackup()'s blobToBase64 needs one to turn an uploaded
 * Blob into the base64 string the backup JSON carries. Blob and atob/btoa are real Node globals
 * already (verified: Node 18+ ships Blob and atob/btoa) — this supplies only the missing piece,
 * via Blob's own real arrayBuffer(), not a reimplementation of FileReader's parsing. */
function installFileReaderStub() {
  if (typeof globalThis.FileReader !== 'undefined') return;
  globalThis.FileReader = class FileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
        if (this.onload) this.onload();
      }).catch((e) => { this.error = e; if (this.onerror) this.onerror(); });
    }
  };
}

/* Boot a fresh app: real DB (in-memory sql.js, same as helpers/sqlite.js's freshDb), real UI/Views/
 * Reports/Exports, and real app.js with its otherwise-private functions exposed as described above.
 * `confirm` sets what UI.confirmModal resolves to (default true, i.e. "the user clicked through");
 * call `setConfirm(false)` before an action to simulate clicking Cancel instead. */
async function freshApp({ search = '', store = {}, confirm = true } = {}) {
  const stubs = installDomStubs({ search, store });

  // A single reusable "element that safely eats anything" — used for ids like 'saved-state' or
  // 'toasts' that real UI code writes into unconditionally (setSavedState, toast) but that these
  // tests never read back from, so there's nothing to model beyond "doesn't throw".
  function sink() {
    const node = {
      innerHTML: '', textContent: '', className: '', style: {},
      appendChild() {}, remove() {}, setAttribute() {}, removeAttribute() {},
      querySelector: () => sink(), querySelectorAll: () => [],
    };
    return node;
  }
  const idEls = {};
  function elFor(id) {
    if (!idEls[id]) idEls[id] = sink();
    return idEls[id];
  }
  stubs.document.getElementById = (id) => elFor(id);

  installNoteSanitizerStubs();
  installFileReaderStub();

  globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));

  const MODULE_ORDER = ['consts', 'db', 'ui', 'views', 'reports', 'exports'];
  for (const name of MODULE_ORDER) {
    new Function(fs.readFileSync(sourcePath(name), 'utf8'))();
  }
  const appSrc = injectAppInternals(fs.readFileSync(sourcePath('app'), 'utf8'));
  new Function(appSrc)();

  const status = await globalThis.DB.boot();

  let nextConfirm = confirm;
  // Real UI.confirmModal/openModal build and query actual DOM (see this file's header comment) —
  // replaced with the smallest stand-ins so the code that runs AFTER a confirmation click is what
  // gets exercised and asserted on here, exactly as it would after a real click.
  globalThis.UI.confirmModal = () => Promise.resolve(nextConfirm);
  globalThis.UI.toast = () => {};

  return {
    CONST: globalThis.CONST, DB: globalThis.DB, UI: globalThis.UI, Views: globalThis.Views,
    Reports: globalThis.Reports, Exports: globalThis.Exports, App: globalThis.App,
    internals: globalThis.__TEST_APP_INTERNALS__,
    status,
    setConfirm: (v) => { nextConfirm = v; },
    ...stubs,
  };
}

/* A hand-built stand-in for an open booking modal, tailored to exactly what bookingSave/
 * bookingEditSave/recomputeBomTotals read (see js/app.js) — NOT a general DOM. It deliberately
 * covers only the no-instrument/no-staff shape (empty inst/staff token pickers), which is enough
 * to exercise the attendees<->meeting_people sync these tests are about without needing to fake
 * the booking-cost-breakdown DOM (`.bom-hours`, `.bom-line`, …) those functions also touch — every
 * lookup this harness doesn't understand returns null/[] exactly like a real querySelector would
 * for an element that plainly isn't in the document, which is what every real call site already
 * guards for (`if (el) …`). */
function fakeBookingModal({ prefix, title = '', date = '', start = '', end = '', project = null, grant = null, group = '', category = '', note = '', actions = '', ownerIds = [] }) {
  const fields = {};
  fields[`${prefix}-title`] = { value: title };
  fields[`${prefix}-date`] = { value: date };
  fields[`${prefix}-start`] = { value: start };
  fields[`${prefix}-end`] = { value: end };
  fields[`${prefix}-project`] = { value: project != null ? String(project) : '' };
  fields[`${prefix}-grant`] = { value: grant != null ? String(grant) : '' };
  fields[`${prefix}-group`] = { value: group };
  fields[`${prefix}-category`] = { value: category };
  fields[`${prefix}-note`] = { innerHTML: note };
  fields[`${prefix}-act`] = { value: actions };

  const ownerTokens = ownerIds.map((id) => ({ dataset: { id: String(id) } }));

  const modal = {
    _bom: { instrAmounts: {}, staffWindows: {}, manualPct: 0, groupPct: 0, groupOrg: group },
    querySelector(sel) {
      const idm = sel.match(/^#([a-zA-Z0-9_-]+)$/);
      if (idm) return fields[idm[1]] || null;
      return null;
    },
    querySelectorAll(sel) {
      const m = sel.match(/^\.token-picker\[data-kind="([a-zA-Z0-9_-]+)"\] \.token-list \.token$/);
      if (m && m[1] === 'owner') return ownerTokens;
      return []; // 'inst' and 'staff' pickers are always empty in this fixture — see header comment
    },
    closest() { return null; }, // UI.closeDim(null) is a documented no-op
  };
  return modal;
}

module.exports = { freshApp, fakeBookingModal };
