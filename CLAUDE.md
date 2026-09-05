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

### Cascading deletes: cascade works, but delete paths clean up child rows explicitly anyway

Verified empirically (running the bundled `libs/sql-asm.js` under Node against this schema):
sql.js's `db.export()` (called by every autosave) really does silently reset the connection's
`foreign_keys` pragma to OFF as a side effect — it reads 1 right up until the first `export()`
call, then 0. `db.js`'s `currentBytes()` reasserts `PRAGMA foreign_keys = ON` immediately after
every export, and with that reassert in place `ON DELETE CASCADE` verifiably fires for every
child/join table (`meeting_people`, `meeting_instruments`, `meeting_staff`, `milestones` and
their joins, `project_people`, …) and `ON DELETE SET NULL` fires for `meetings.project_id`.
A database reopened from exported bytes starts with the pragma OFF (standard SQLite
per-connection behavior); `db.js` re-sets it on boot and restore.

Despite cascade working, the remaining delete paths in `app.js` (`deleteMeetingRaw`, and the
zero-reference delete branches of `archiveProject`/`retirePerson`/`retireInstrument`) delete
dependent join-table/child rows explicitly as a
defensive belt-and-suspenders measure: if any future code path ever calls `db.export()` directly
without the pragma reassert, cascades would silently stop firing and only the explicit deletes
would keep data consistent. Follow the same pattern in any new delete path. Note two things
cascade can never handle here: `projects.pi_id` carries no `REFERENCES` clause (a deleted
person's pi_id must be nulled explicitly), and the denormalized `meetings.attendees` display
string must be recomputed from `meeting_people` when attendee rows are removed.

### History is preserved: people/instruments retire, projects archive

Deleting a person, instrument or project would destroy historical fact — who attended a booking,
which instrument ran a session, who was PI, and the billing behind a saved cost snapshot. So
those three are never deleted while anything references them:

- `people.is_retired` / `retired_at`, `instruments.is_retired` / `retired_at`,
  `projects.is_archived` / `archived_at` (all additive migrations in `db.js`).
- `DB.countPersonRefs` / `countInstrumentRefs` / `countProjectRefs` report how much history a
  record carries. **Zero references is the only case where a real delete is offered** (a typo or
  duplicate, with nothing to protect); anything else retires/archives instead.
- `DB.setRetired('people'|'instruments', id, bool)` and `DB.setProjectArchived(id, bool)` are the
  only writers of those flags. Retiring/archiving never touches a join table.
- Display only: `UI.retiredName(name, isRetired)` appends " (Retired)"; the stored name is never
  modified, so historical records read back exactly as entered. SQL that renders a concatenated
  list (milestone owners, exports) appends the same suffix with a `CASE WHEN ... is_retired`.

**The rule for any picker or form that assigns work: "selectable = not retired OR already
selected here."** This is not cosmetic. `msEditSave`, `bookingSave`/`bookingEditSave` and the
project PI form all rebuild their join rows from whatever the form currently renders, so a
retired assignee that is filtered out of the form is silently deleted from that record on the
next save. `editMilestone` and `editProject` therefore keep a retired record in the list when it
is the one already assigned, and `mountTokenPicker` keeps retired entries in `items` (so an
existing badge still renders) while excluding them from the dropdown via `it.retired`.

Lists hide retired/archived rows behind a "Show retired/archived (N)" toggle held in
`views.js`'s `peopleFilter` / `instrumentFilter` / `projectFilter` state; the dashboard's counters
and overdue feeds are scoped to `is_archived=0`.

### Confirmation dialogs: the red button is Cancel

`UI.confirmModal(title, body, { danger, confirmText, cancelText })`. On a `danger` dialog the
**Cancel** button carries `btn-danger` and the action button is `btn-secondary` — colour draws
the eye, and on a dialog meant to prevent an accident that attention belongs to the safe way out.
Always pass `confirmText` naming the actual verb ("Delete", "Retire", "Archive") rather than
leaving the generic "Confirm". Non-destructive confirmations keep neutral Cancel / primary Confirm.

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
