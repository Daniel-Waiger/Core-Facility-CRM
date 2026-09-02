# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Core Facility Tracker: a project/CRM tracker for microscopy, bioimaging, and scientific
core facilities (projects, milestones, people, instruments, meetings), built as a **single-page,
100% client-side, static web app** — vanilla JS, hand-written CSS, no framework, no bundler,
no build step. It runs from `file://` or any static host and is a PWA (installable, offline-capable).

There is **no backend, no server, no accounts/auth**. All data lives in a SQLite database
(`sql.js`, compiled to asm.js) that runs entirely in the browser and is persisted to the
browser's IndexedDB. This has two direct consequences for any feature work:
- Nothing can be "sent" anywhere (email, sync, notifications) without either a real backend/API
  key (a major, explicitly-avoided architecture change) or handing off to something already on
  the user's device — e.g. the meeting "Email Attendees" feature opens a `mailto:` link/modal
  rather than sending mail itself, because there is nothing else it *can* do.
- Data is per-browser, per-device. There is no multi-user or live collaboration; syncing between
  devices is a manual JSON export/import (Settings → Export/Restore Backup).

## Commands

There is no build, lint, or test suite/framework in this repo (`package.json` doesn't exist).
"Running" the app means serving the static files and opening it in a browser:

```bash
python3 -m http.server 8000   # from the repo root
# then open http://localhost:8000/index.html
```

(Opening `index.html` directly via `file://` also works on desktop, but a local server avoids
storage restrictions on some browsers/tablets — see README's "Running on Tablets" section.)

Verification is manual/in-browser: there are no unit tests to run. `node --check js/<file>.js`
is useful as a cheap syntax sanity check before testing in a browser, but is not a substitute
for actually loading the app and exercising the change.

## Architecture

### Module layout (plain `<script>` tags, load order matters)

Each `js/*.js` file is an IIFE that attaches one namespace to `window`, loaded in this order
by `index.html`: `consts.js` (`window.CONST`, `window.APP_VERSION`) → `db.js` (`DB`) →
`ui.js` (`UI`) → `views.js` (`Views`) → `exports.js` (`Exports`) → `app.js` (`App`, boots last).
Later files freely call into earlier ones' globals (e.g. `app.js` calls `DB.run`, `UI.toast`,
`Views.*`); there is no module system, so a file can only use what's already loaded before it.

- `js/db.js` — the SQL schema (a single `CREATE TABLE` string), sql.js engine init,
  IndexedDB persistence + debounced autosave, migrations, the seed/demo dataset, backup/restore.
- `js/app.js` — routing, the central action dispatcher, and all CRUD modal logic (by far the
  largest file; organized into commented sections per entity — Projects, Milestones, People,
  Instruments, Bookings/Meetings, etc.).
- `js/views.js` — pure(ish) HTML-string renderers per screen (Dashboard, Projects, Project
  Detail, People, Instruments, Calendar, Settings).
- `js/ui.js` — toasts, the modal system, theme switching, the centralized SVG icon set
  (`ICONS` map + `icon(name)`/`ic(name)` helper), the guided-tour engine, clipboard helper.
- `js/exports.js` — XLSX (SheetJS)/DOCX (`docx`)/PDF (`jsPDF`) report generation. Each format
  is a separate code path; a new field on a record type needs updating in each one it should
  appear in — they are not driven from one shared field list.

### Action dispatch: `data-act` attributes, not per-element listeners

UI actions are wired declaratively: buttons/elements carry `data-act="some-action"` (plus
`data-id`, etc. as needed), and a single delegated click handler in `app.js` switches on
`el.dataset.act` to call the right function. To add a new button, add a `data-act` value in
the HTML string (`views.js` or an `app.js`-built modal) and a matching `case` in that switch —
there is no separate registration step.

### The database is relational, but display strings are denormalized alongside it

Several entities keep a human-readable, denormalized text column *in addition to* a real
many-to-many join table — e.g. `meetings.attendees` is a comma-joined list of attendee **names**
for display, while `meeting_people` (meeting_id, person_id) is the actual relational link. The
denormalized column is convenient for rendering a list view without a join, but **any feature
that needs real per-attendee data (email, role, etc.) must query the join table**, not parse the
display string. Keep both in sync on every save (see `bookingSave`/`bookingEditSave` in
`app.js`, which rebuild the join rows and recompute the display string together).

This split bit a real bug during the "Email Attendees" feature build: the seed/demo dataset
populated `meetings.attendees` (names) but never inserted the corresponding `meeting_people`
rows, so a demo meeting displayed attendee names while any join-based feature saw zero attendees.
Milestones' analogous tables (`milestone_owners`) didn't have this gap. When adding seed data or
a new denormalized+relational pair, populate both, and check for this class of drift.

### Cascading deletes are inconsistent — don't assume `ON DELETE CASCADE` fires

The schema declares `ON DELETE CASCADE` on child tables, but sql.js's `db.export()` (called by
every autosave) silently resets the connection's `foreign_keys` pragma to OFF as a side effect;
`db.js`'s `currentBytes()` reasserts `PRAGMA foreign_keys = ON` right after every export to keep
cascades working for the rest of the session. Despite that fix, `deleteMeeting()` in `app.js`
still manually deletes `meeting_people`/`meeting_instruments` rows before deleting the meeting
itself (with a comment claiming cascade "never fires" for those tables), while `deleteProject()`
and `deletePerson()` delete only the parent row and rely on cascade alone. This is an unresolved
inconsistency in the existing code, not a documented, verified rule — treat it as a warning, not
settled fact: when writing a new delete path, the safer option (matching the more defensive
existing pattern) is to explicitly delete dependent join-table/child rows rather than assume
cascade will handle it, and if you need to know definitively whether cascade fires for a given
table, verify empirically (delete a row, then query the child table) rather than trust either
existing comment.

### Modal system

`UI.openModal(html, onMount)` injects a `.modal` into a `.modal-dim` overlay; `data-act="close"`
(handled generically in the dispatcher) closes the topmost modal, and `Esc` does the same via a
global listener. Modals are built as template-string HTML (see any `newX`/`editX` function in
`app.js` for the pattern), optionally with an `onMount(modalEl)` callback for wiring up
non-declarative behavior (e.g. token pickers, rich-text editors) after insertion.

### Versioning: two places, not one

`?v=X.Y.Z` cache-busting query strings on every `<script>`/`<link>` tag in `index.html`, mirrored
in `sw.js` (`CACHE_VERSION` and `PRECACHE_URLS`), must be bumped together on **any** JS/CSS
change — otherwise the service worker keeps serving stale cached assets and changes won't appear
without a hard refresh. This version string is **independent** from `window.APP_VERSION` in
`js/consts.js`, which drives the "Version:" text shown in the app's own Settings screen — bump
both, and add a `CHANGELOG.md` entry (this project's convention: one `## [X.Y.Z] — date` section
per version, with `### Added`/`Changed`/`Fixed` subsections) matching whichever version
`APP_VERSION` ends up at. `docs/index.html` (the hosted release-notes page) renders
`CHANGELOG.md` live via `fetch`, so it never needs separate updates.
