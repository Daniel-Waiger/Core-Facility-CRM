/* wiring.test.js — "Action dispatch: data-act attributes, not per-element listeners" (CLAUDE.md).
 *
 * The app wires almost every button by putting `data-act="name"` in template-string HTML and
 * matching it against a `switch (act)` in js/app.js's delegated click handler. A typo on either
 * side (the HTML string or the case label) yields a button that silently does nothing — there is
 * no error, no exception, nothing in the console. These tests scrape both sides as plain text and
 * assert the two sets agree, plus a handful of related "a string used in the DOM has no invisible
 * typo" checks (data-nav routes, icon names) and the CLAUDE.md date-conversion lint.
 *
 * All of this reads SOURCE AS TEXT rather than executing it, per the task brief — regexes over
 * js/*.js, not `loadApp()`.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { readSource, sourcePath, JS_DIR } = require('./helpers/load-module');

const JS_FILES = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).sort();
const SOURCES = Object.fromEntries(JS_FILES.map((f) => [f, readSource(f)]));
const ALL_SOURCE = JS_FILES.map((f) => SOURCES[f]).join('\n');

/* ---------------------------------------------------------------------------------------------
 * 1. data-act dispatch completeness, both directions.
 * ------------------------------------------------------------------------------------------- */

// Emitted values: `data-act="literal-name"` in a template string, anywhere in js/*.js.
// Deliberately does NOT match `data-act="${...}"` (a dynamically-built value — see the ternary
// case below, handled separately) nor a bare attribute SELECTOR like `[data-act="close"]` or
// `querySelectorAll('[data-act=...]')`, both of which reference an already-emitted value rather
// than emitting a new one and would otherwise produce phantom "values" that are really just
// re-mentions of ones already captured by this same regex from their emitting site.
//
// The one dynamically-built emission in the codebase, in views.js:
//   data-act="${e.kind === 'mt' ? 'edit-booking' : 'edit-milestone'}"
// is handled by pulling both literal branches out of that specific ternary by hand below, rather
// than by a general "parse any ${...} expression" regex (which would be far too fragile).
function scrapeEmittedDataActValues() {
  const values = new Set();
  const re = /data-act="([a-zA-Z0-9_-]+)"/g;
  for (const src of Object.values(SOURCES)) {
    let m;
    while ((m = re.exec(src))) values.add(m[1]);
  }
  // The one template-literal-built data-act in the app (views.js), added by hand:
  values.add('edit-booking');
  values.add('edit-milestone');
  return values;
}

// Dispatcher cases: `case 'name':` lines inside `handleAct(act, el)`'s switch specifically — NOT
// the OTHER switch in app.js (`switch (os)` in storageGuidanceFor, whose case labels are OS names
// like 'android'/'ios', nothing to do with data-act at all). We isolate handleAct's body by
// slicing from its `function handleAct(act, el) {` declaration to the matching top-level closing
// brace of the switch, found as the first `\n  }\n` (2-space indent, i.e. function-body-level)
// after the switch opens — matching this file's existing indentation style.
function scrapeDispatcherCases() {
  const src = SOURCES['app.js'];
  const start = src.indexOf('function handleAct(act, el) {');
  assert.ok(start !== -1, 'js/app.js must define function handleAct(act, el) — dispatcher not found');
  const switchStart = src.indexOf('switch (act) {', start);
  assert.ok(switchStart !== -1, 'handleAct must contain switch (act) {');
  const closeIdx = src.indexOf('\n  }\n', switchStart);
  assert.ok(closeIdx !== -1, 'could not find the end of the handleAct switch/function');
  const body = src.slice(switchStart, closeIdx);
  const cases = new Set();
  const re = /case '([a-zA-Z0-9_-]+)':/g;
  let m;
  while ((m = re.exec(body))) cases.add(m[1]);
  return cases;
}

// Values deliberately handled OUTSIDE the handleAct switch. Each entry below was verified by
// reading its handler, not assumed — see the comment on each.
const HANDLED_ELSEWHERE = new Map([
  // UI.confirmModal (js/ui.js) builds its own footer with data-act="yes"/"no" and wires
  // `.onclick` on those two buttons directly, resolving its promise — every confirm() caller
  // gets this pair "for free" without a dispatcher case for either value.
  ['yes', 'js/ui.js confirmModal() — `no.onclick=...; yes.onclick=...` right after the modal is built'],
  ['no', 'js/ui.js confirmModal() — same as "yes"'],
  // The three-way "billing on cancel" and "recurring booking" prompts in app.js build their own
  // small modals and wire each button's `.onclick` by hand via `m.querySelector('[data-act="…"]')`,
  // resolving a Promise — they are not routed through handleAct at all.
  ['cancel', 'js/app.js — cancel/rename, waive/keep and once/future/cancel prompts each wire their own [data-act="cancel"].onclick'],
  ['once', 'js/app.js — the recurring-booking-edit prompt: `m.querySelector(\'[data-act="once"]\').onclick = ...`'],
  ['future', 'js/app.js — same recurring-booking-edit prompt: `[data-act="future"]`'],
  ['waive', 'js/app.js — the cancellation-billing prompt(s): `[data-act="waive"]`.onclick'],
  ['keep', 'js/app.js — the cancellation-billing prompt(s): `[data-act="keep"]`.onclick'],
  ['abort', 'js/app.js — the cancellation-billing prompt: `[data-act="abort"]`.onclick'],
  ['rename', 'js/app.js — the duplicate-project-name prompt: `[data-act="rename"]`.onclick'],
  // The startup/welcome modal's "Start Fresh" card is bound directly rather than through the
  // delegated handler: `modalDim.querySelectorAll('[data-act="startup-fresh"]').forEach(el => { el.onclick = ... })`.
  ['startup-fresh', 'js/app.js openStartupModal() — `.querySelectorAll(\'[data-act="startup-fresh"]\').forEach(el => el.onclick = ...)`'],
  // "close" DOES have a dispatcher case (closes the topmost modal) — included here anyway is
  // wrong, so it is intentionally NOT listed. (Comment kept to document that this was checked,
  // not overlooked — see the assertion below that HANDLED_ELSEWHERE never masks a real case.)
]);

describe('data-act dispatch completeness', () => {
  const emitted = scrapeEmittedDataActValues();
  const cases = scrapeDispatcherCases();

  test('every emitted data-act value has a dispatcher case (or a verified allow-list entry)', () => {
    const dead = [...emitted].filter((v) => !cases.has(v) && !HANDLED_ELSEWHERE.has(v));
    assert.deepEqual(dead, [], `data-act values with no dispatcher case and no HANDLED_ELSEWHERE entry: ${dead.join(', ')}`);
  });

  test('every dispatcher case corresponds to an emitted data-act value (no orphan case)', () => {
    const orphans = [...cases].filter((v) => !emitted.has(v));
    assert.deepEqual(orphans, [], `dispatcher cases with no matching data-act="…" anywhere: ${orphans.join(', ')}`);
  });

  test('HANDLED_ELSEWHERE never lists a value that also has a real dispatcher case', () => {
    // Guards against the instruction "do not allow-list something just to make the test green" —
    // if a value is allow-listed AND has a switch case, the allow-list entry is superfluous/wrong.
    const overlap = [...HANDLED_ELSEWHERE.keys()].filter((v) => cases.has(v));
    assert.deepEqual(overlap, [], `HANDLED_ELSEWHERE entries that are actually dispatcher cases (remove from allow-list): ${overlap.join(', ')}`);
  });
});

/* ---------------------------------------------------------------------------------------------
 * 2. data-nav completeness.
 * ------------------------------------------------------------------------------------------- */

describe('data-nav completeness', () => {
  test('every data-nav="…" value is in both HASH_ROUTES and TITLES', () => {
    const navRe = /data-nav="([a-zA-Z0-9_-]+)"/g;
    const navValues = new Set();
    let m;
    while ((m = navRe.exec(ALL_SOURCE))) navValues.add(m[1]);
    assert.ok(navValues.size > 0, 'scraper found zero data-nav values — regex is broken');

    const appSrc = SOURCES['app.js'];
    const routesMatch = appSrc.match(/const HASH_ROUTES = \[([^\]]+)\]/);
    assert.ok(routesMatch, 'could not find HASH_ROUTES array in js/app.js');
    const hashRoutes = new Set(routesMatch[1].match(/'([a-zA-Z0-9_-]+)'/g).map((s) => s.slice(1, -1)));

    const titlesMatch = appSrc.match(/const TITLES = \{([\s\S]*?)\n  \};/);
    assert.ok(titlesMatch, 'could not find TITLES object in js/app.js');
    const titleKeys = new Set([...titlesMatch[1].matchAll(/^\s*([a-zA-Z0-9_-]+):/gm)].map((m2) => m2[1]));

    // 'project' is a real route with a title (reached via route('project', id) / data-goto="project"
    // elsewhere, never data-nav) but is deliberately NOT a hash route — a project detail page isn't
    // directly bookmarkable by name the way the sidebar sections are, so HASH_ROUTES excludes it
    // while TITLES still needs an entry for its page-title text. So: present in TITLES, ABSENT from
    // HASH_ROUTES — assert both halves of that asymmetry explicitly rather than just ignoring it.
    assert.ok(!hashRoutes.has('project'), 'expected "project" to be ABSENT from HASH_ROUTES (it is reached via route(), not a hash nav target)');
    assert.ok(titleKeys.has('project'), 'expected "project" in TITLES (reached via route(), not data-nav)');

    const missingFromRoutes = [...navValues].filter((v) => !hashRoutes.has(v));
    assert.deepEqual(missingFromRoutes, [], `data-nav values missing from HASH_ROUTES: ${missingFromRoutes.join(', ')}`);

    const missingFromTitles = [...navValues].filter((v) => !titleKeys.has(v));
    assert.deepEqual(missingFromTitles, [], `data-nav values missing from TITLES: ${missingFromTitles.join(', ')}`);
  });
});

/* ---------------------------------------------------------------------------------------------
 * 3. Icon names.
 * ------------------------------------------------------------------------------------------- */

describe('icon names: ic()/UI.icon() calls all resolve in ICONS', () => {
  // Matches every `ic('name')`, `icon('name')` or `UI.icon('name')` call with a literal string
  // argument. This intentionally misses calls with a computed argument (a variable, a ternary);
  // those are rare enough in this codebase to enumerate by hand instead of writing a fragile
  // expression parser — see the additions below, each with the call site that needed it.
  function scrapeUsedIconNames() {
    const names = new Set();
    const re = /\b(?:UI\.icon|icon|ic)\('([a-zA-Z0-9_-]+)'\)/g;
    let m;
    while ((m = re.exec(ALL_SOURCE))) names.add(m[1]);

    // js/app.js: sidebar collapse toggle — `ic(isCollapsed ? 'expand' : 'collapse')` (x2 sites).
    names.add('expand');
    names.add('collapse');
    // js/ui.js: toast icon — `icon(type === 'success' ? 'check' : 'alert')` (both already scraped
    // elsewhere as literals, kept here for completeness/documentation).
    names.add('check');
    names.add('alert');
    // js/ui.js: theme-toggle button label — `icon(isNextDark ? 'moon' : 'sun')` (x2 sites).
    names.add('moon');
    names.add('sun');
    // js/views.js: `emptyState(icName, t, s)` forwards its first argument straight into
    // `ic(icName)`; every call site passes a literal, so pull those literals directly instead of
    // symbolically tracing the indirection through the helper.
    const emptyStateRe = /emptyState\('([a-zA-Z0-9_-]+)'/g;
    while ((m = emptyStateRe.exec(SOURCES['views.js']))) names.add(m[1]);

    return names;
  }

  function scrapeIconsMapKeys() {
    const src = SOURCES['ui.js'];
    const start = src.indexOf('const ICONS = {');
    assert.ok(start !== -1, 'could not find "const ICONS = {" in js/ui.js');
    const end = src.indexOf('\n  };', start);
    assert.ok(end !== -1, 'could not find the end of the ICONS object');
    const body = src.slice(start, end);
    // Keys are either bare identifiers (`home:`) or quoted (`'check-circle':`) — match both.
    const keys = new Set();
    const re = /^\s*(?:'([a-zA-Z0-9_-]+)'|([a-zA-Z0-9_-]+)):/gm;
    let m;
    while ((m = re.exec(body))) keys.add(m[1] || m[2]);
    return keys;
  }

  const used = scrapeUsedIconNames();
  const defined = scrapeIconsMapKeys();

  test('every icon name passed to ic()/icon() is a key in ICONS (a miss renders an invisible 0×0 icon)', () => {
    const missing = [...used].filter((n) => !defined.has(n));
    assert.deepEqual(missing, [], `icon names used but not defined in ICONS: ${missing.join(', ')}`);
  });

  // Informational only, per the task brief ("report ... as a separate, non-failing informational
  // test") — an unused icon is dead weight, not a bug, so this never fails the suite.
  test('(informational) report ICONS keys defined but never referenced', () => {
    const unused = [...defined].filter((n) => !used.has(n));
    if (unused.length) {
      console.log(`[info] ICONS keys defined but not used anywhere: ${unused.join(', ')}`);
    }
    assert.ok(true);
  });
});

/* ---------------------------------------------------------------------------------------------
 * 4. The date rule as a lint: forbid toISOString().slice(0,10) / .substring(0,10).
 * ------------------------------------------------------------------------------------------- */

describe('date rule lint: no toISOString().slice/substring(0, 10)', () => {
  // Targets the SLICING specifically (the actual bug shape from issue #14 — re-describing a
  // local calendar day via a UTC string and then truncating to just the date part), not
  // `toISOString()` itself, which is legitimate for full timestamps (created_at, backup
  // filenames' embedded instant, last-auto-backup-at). Whitespace-tolerant between the two calls
  // and around the slice/substring arguments, since `.slice(0,10)` and `.slice(0, 10)` are both
  // plausible authorial styles.
  const BAD_PATTERN = /toISOString\(\)\s*\.\s*(?:slice|substring)\(\s*0\s*,\s*10\s*\)/;

  // CLAUDE.md itself, and this codebase's own comments (js/ui.js, js/views.js), quote this exact
  // forbidden pattern IN PROSE to warn contributors away from it — matching against raw source
  // would flag those warnings as if they were the bug they describe. Blank out `//…` and
  // `/*…*/` comment bodies (replacing each character with a space, so line/column numbers of any
  // real match are unaffected) before testing, so only actual code is checked. This is a
  // line/block-comment blank-out, not a full tokenizer, so it doesn't account for `//` or `/*`
  // appearing inside a string literal — none of the source here does that near a `toISOString`
  // call, so it isn't a practical risk for this specific lint.
  function blankComments(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  }

  for (const file of JS_FILES) {
    test(`js/${file} does not slice a toISOString() result to a calendar day`, () => {
      const codeOnly = blankComments(SOURCES[file]);
      const m = codeOnly.match(BAD_PATTERN);
      if (m) {
        const line = codeOnly.slice(0, m.index).split('\n').length;
        assert.fail(`js/${file}:${line} uses the forbidden toISOString().slice/substring(0,10) pattern (CLAUDE.md / issue #14): "${m[0]}"`);
      }
      assert.ok(true);
    });
  }
});

/* ---------------------------------------------------------------------------------------------
 * 4b. The topmost-modal rule as a lint: js/app.js must never read the FIRST `.modal`/`.modal-dim`
 * in the DOM (document.querySelector always returns the OUTERMOST/bottommost one, since later
 * modals are appended later and so sort later in `querySelectorAll` order too). With modals that
 * can stack — Today's Agenda -> Edit Booking, or any "+ Add New" opened from inside another form —
 * a first-match lookup silently operates on the wrong (buried) modal instead of the one the user
 * is actually looking at. `UI.topModal()`/`UI.topDim()` (js/ui.js) are the only correct way to
 * find "the modal in front right now". See CLAUDE.md's "Modal system" section and the H4 finding
 * in the 2026-09-11 adversarial review.
 * ------------------------------------------------------------------------------------------- */

describe('topmost-modal rule lint: js/app.js never reads the first .modal/.modal-dim', () => {
  // Matches `document.querySelector('.modal')` / `.modal-dim` in either quote style, with or
  // without whitespace inside the parens — the exact first-match shape that returns the OUTERMOST
  // modal rather than the topmost one. Deliberately narrow (only this literal call shape) so it
  // can't accidentally flag `UI.topModal()`, `m.closest('.modal-dim')`, or a `.modal-dim:last-of-
  // type` / `dims[dims.length - 1]` pattern, all of which correctly resolve to the topmost modal.
  const BAD_PATTERN = /document\s*\.\s*querySelector\s*\(\s*(['"])\.modal(?:-dim)?\1\s*\)/;

  function blankComments(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  }

  test('js/app.js does not look up the first .modal/.modal-dim in the DOM', () => {
    const codeOnly = blankComments(SOURCES['app.js']);
    const m = codeOnly.match(BAD_PATTERN);
    if (m) {
      const line = codeOnly.slice(0, m.index).split('\n').length;
      assert.fail(`js/app.js:${line} reads the first .modal/.modal-dim in the DOM instead of ` +
        `UI.topModal()/UI.topDim() (H4, 2026-09-11 review): "${m[0]}"`);
    }
    assert.ok(true);
  });

  test('js/app.js never calls the broken DB.q1 (its Statement.getArray() throws in the shipped sql.js build)', () => {
    // msSave and iSave both used `DB.q1('SELECT last_insert_rowid()')[0]` to read back the row
    // they'd just inserted — DB.q1 (js/db.js) calls `stmt.getArray()`, a method the bundled
    // libs/sql-asm.js build's Statement prototype never exposes (only .get/.getAsObject/...).
    // It throws immediately, silently aborting the save AFTER the row was written but BEFORE the
    // owner/instrument join rows and the modal's own close ever ran — "Add Milestone" and "Add
    // Instrument" both appeared to hang. Every other saver in this file reads the new id back with
    // `DB.row('SELECT last_insert_rowid() as id').id`, which works; this guards against either
    // function regressing back to DB.q1.
    assert.doesNotMatch(SOURCES['app.js'], /DB\.q1\s*\(/, 'js/app.js calls the broken DB.q1 helper');
  });

  test('js/ui.js defines topModal/topDim/closeAllModals and exports them on window.UI', () => {
    assert.match(SOURCES['ui.js'], /function\s+topModal\s*\(/);
    assert.match(SOURCES['ui.js'], /function\s+topDim\s*\(/);
    assert.match(SOURCES['ui.js'], /function\s+closeAllModals\s*\(/);
    assert.match(ALL_SOURCE, /global\.UI\s*=\s*\{[\s\S]*?\btopModal\b[\s\S]*?\};/);
    assert.match(ALL_SOURCE, /global\.UI\s*=\s*\{[\s\S]*?\btopDim\b[\s\S]*?\};/);
    assert.match(ALL_SOURCE, /global\.UI\s*=\s*\{[\s\S]*?\bcloseAllModals\b[\s\S]*?\};/);
  });
});

/* ---------------------------------------------------------------------------------------------
 * 5. Every js/*.js parses.
 * ------------------------------------------------------------------------------------------- */

describe('every js/*.js file parses (node --check)', () => {
  for (const file of JS_FILES) {
    test(`node --check js/${file}`, () => {
      assert.doesNotThrow(() => {
        execFileSync(process.execPath, ['--check', sourcePath(file)], { stdio: 'pipe' });
      }, (err) => {
        if (!err) return false;
        err.message = `js/${file} failed to parse: ${err.stderr ? err.stderr.toString() : err.message}`;
        return true;
      });
    });
  }
});
