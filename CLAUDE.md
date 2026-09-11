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

There is no build step and no lint step, and `package.json` deliberately doesn't exist — the app
is zero-install by design. "Running" the app means serving the static files and opening it in a
browser:

```bash
python3 -m http.server 8000   # from the repo root
# then open http://localhost:8000/index.html
```

(Opening `index.html` directly via `file://` also works on desktop, but a local server avoids
storage restrictions on some browsers/tablets — see README's "Running on Tablets" section.)

There **is** a test suite, and it keeps the zero-install property: Node's built-in runner needs
nothing installed.

```bash
TZ='Asia/Jerusalem' node --test 'test/unit/*.test.js'      # fast; no install of any kind
TZ='Asia/Jerusalem' node --test 'test/browser/*.spec.js'   # needs Playwright; skips without it
```

Pass the glob, not the directory — `node --test test/unit/` tries to *execute* the directory in
Node 22 rather than searching it. Run under a UTC+ timezone: this app's date bugs are invisible at
UTC, which is exactly how issue #14 shipped. CI runs both jobs at `Asia/Jerusalem`.

`test/README.md` lists what each file guards. In short, the unit group covers the billing
calculator (including the 490 / 546.25 / 589.95 figures a seeded booking must reproduce), the
local-calendar-day date rules, the database invariants described under "Cascading deletes" and
"History is preserved" below, the Reports aggregations agreeing with the booking modal, and the
`data-act`/icon/version wiring this app is assembled from. The browser group covers the demo
sandbox isolation guarantee, every screen rendering without a JavaScript error, and the note
sanitizer (which needs a real `DOMParser`, so it cannot run under Node).

**What the suite does not do is prove the app loads.** The screens are template strings assembled
at render time, so a mistake in one surfaces only when that screen is visited. `node --check
js/<file>.js` remains a cheap syntax check, and neither it nor the unit tests substitute for
loading the app and exercising the change — for any UI work, run the browser group or open it
yourself. When adding a rule that matters (a money rule, a date rule, a delete path), add the
test with it: several of the invariants documented in this file are now executable, and the ones
that are stay true.

## Architecture

### Module layout (plain `<script>` tags, load order matters)

Each `js/*.js` file is an IIFE that attaches one namespace to `window`, loaded in this order
by `index.html`: `consts.js` (`window.CONST`, `window.APP_VERSION`, `window.IS_DEMO`) →
`db.js` (`DB`) → `ui.js` (`UI`) → `views.js` (`Views`) → `reports.js` (`Reports`) →
`exports.js` (`Exports`) → `app.js` (`App`, boots last).
Later files freely call into earlier ones' globals (e.g. `app.js` calls `DB.run`, `UI.toast`,
`Views.*`); there is no module system, so a file can only use what's already loaded before it.

- `js/db.js` — the SQL schema (a single `CREATE TABLE` string), sql.js engine init,
  IndexedDB persistence + debounced autosave, migrations, the seed/demo dataset, backup/restore.
- `js/app.js` — routing, the central action dispatcher, and all CRUD modal logic (by far the
  largest file; organized into commented sections per entity — Projects, Milestones, People,
  Instruments, Bookings/Meetings, etc.).
- `js/views.js` — pure(ish) HTML-string renderers per screen (Dashboard, Projects, Project
  Detail, People, Instruments, Calendar, Settings).
- `js/reports.js` — the Reports & Utilization screen and every aggregation behind it. Its
  compute functions are exported so `exports.js` builds its sheets from the same numbers the
  screen renders — see "Reports: aggregation lives in one place" below.
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

### Bookings are cancelled, not deleted

`meetings.is_cancelled` / `cancelled_at` / `billing_retained`, written only by
`DB.setBookingCancelled(id, cancelled, retained)`. `DB.countBookingRefs(id)` decides whether a
booking is an empty note (no attendees, line items or cost → deletable) or a record (→ cancelled).

Two rules drive `billing_retained`, both in `cancelBooking`:
- **Before the start time** → nothing was held, charge dropped (`retained = 0`).
- **After the start time** → the slot was held, charge stands (`retained = 1`). Admin Mode
  (`UI.storage.getItem('admin-mode') === '1'`) offers `chooseCancelBilling`, a three-way dialog
  to waive it instead. Without Admin Mode the charge stands — billing decisions are admin-gated
  here exactly as the group-discount Revoke/Apply control is.

`bookingHasStarted()` compares `date` + `start_time` (missing time ⇒ `00:00`) against now.
A cancelled booking stops blocking its slot: `findBookingConflicts` filters on `m.is_cancelled = 0`.
`reinstateBooking` therefore re-runs that conflict check before clearing the flag, since the
booking starts holding its slot again. Project Costs sums `is_cancelled && !billing_retained`
rows as 0, and the XLSX/DOCX/PDF exports carry the status so a total reconciles against its rows.

### Dates are local calendar days, never UTC instants

Every date a user picks or sees is a plain `'YYYY-MM-DD'` **local** calendar day, taken verbatim
from an `<input type="date">` and stored verbatim in TEXT columns (`meetings.date`,
`milestones.due_date`, …). No column holds a timestamp or an offset.

So **never use `new Date(...).toISOString().slice(0, 10)` to produce one of those strings.** A
`Date` is a single instant; `toISOString()` re-describes that instant in UTC, and at a UTC+ offset
local midnight fell on the *previous* UTC day — so the conversion silently returns yesterday. Use
`UI.ymd(date)` (local calendar fields) or `UI.today()` / `UI.todayPlusDays(n)`, which are built on
it. Going the other way, `UI.fmtDate` appends `'T00:00:00'` (no `Z`) to force local parsing —
that's deliberate, don't "simplify" it.

This caused a real bug (issue #14, fixed in 1.5.0): the calendar labelled each cell with
`cur.getDate()` (local) but keyed its events with `cur.toISOString()` (UTC), so east of Greenwich
every cell was captioned with one day and filled with the previous day's bookings — while the edit
form, reading the DB string directly, showed the truth. It was invisible at UTC and UTC−, so
**test any date change under a UTC+ timezone** (`TZ='Asia/Jerusalem'`), not just locally. Full
timestamps (`created_at`, backup filenames, `last-auto-backup-at`) are a different thing and
legitimately use `toISOString()`.

Booking durations are minute arithmetic on `'HH:MM'` strings on a single day — no `Date` objects
involved. `UI.timeToMinutes`, `UI.hoursBetween` and `UI.billableStaffHours` (the 1-hour floor,
rounding up) live in `ui.js` precisely so `app.js`'s cost calculator and `reports.js`'s
aggregations count hours identically. Never fork a second copy: a report that disagrees with the
booking modal about money is worse than no report.

### Reports: aggregation lives in one place, screen and export both read it

`js/reports.js` (`window.Reports`) owns the Reports & Utilization screen. Its aggregation
functions are the single source for both the rendered tables and `Exports.exportReportsXlsx`, so an
exported figure can never drift from the on-screen one. Two rules it encodes, both inherited from
elsewhere in the app and both worth restating in any new aggregation:

- **Occupancy excludes all cancelled bookings** (`is_cancelled = 1`) — a cancellation frees the
  slot (see `findBookingConflicts`), so the instrument was never held.
- **Money follows the Project Costs rule**: a row counts unless `is_cancelled && !billing_retained`.

Two data-model traps: `meeting_staff.start_time = ''` means *the whole booking window*, not zero
(so a naive `SUM` over those columns reports ~0), and `meetings.project_id` is nullable, so
anything grouping by project needs a `LEFT JOIN` and a "Facility-wide" label or it silently drops
rows. Retired people/instruments and archived projects **do** appear in reports — that's the point
of keeping them — labelled via `UI.retiredName`.

### Confirmation dialogs: the red button is Cancel

`UI.confirmModal(title, body, { danger, confirmText, cancelText })`. On a `danger` dialog the
**Cancel** button carries `btn-danger` and the action button is `btn-secondary` — colour draws
the eye, and on a dialog meant to prevent an accident that attention belongs to the safe way out.
Always pass `confirmText` naming the actual verb ("Delete", "Retire", "Archive") rather than
leaving the generic "Confirm". Non-destructive confirmations keep neutral Cancel / primary Confirm.

### UI text: Title Case for controls, sentence case for sentences

One rule, so a screen never mixes both styles in the same row of buttons:

- **Title Case** for anything the user acts on or reads as a column heading — buttons, `<th>`
  cells, form labels, tab and nav items, dialog and card titles, menu items, and select options
  that name a thing. `Save Booking`, `Assign People`, `Billed Hours`, `Display Grants By`.
- **Sentence case** for anything that reads as prose — help and hint text, placeholders, toasts,
  confirmation-dialog bodies, empty states, validation and conflict messages, sentence-shaped
  tooltips. `This slot is already booked.`, `Nothing here yet — add your first project.`
- Inside Title Case, keep short joining words lowercase unless they are first or last: *a, an,
  and, as, at, but, by, for, in, nor, of, on, or, per, the, to, vs, with*. Acronyms stay as they
  are (PI, XLSX, PDF, DOCX, JSON, PWA, VAT).
- A confirmation dialog's `confirmText` is a control, so it is Title Case and names the verb
  ("Delete", "Retire", "Archive") — see the section above.

**The trap:** plenty of user-visible strings are also data. A vocabulary value, a `data-act`
name, an XLSX sheet name, anything compared with `===` or used as an object key — recapitalising
one of those changes behaviour, silently, with no error. Before changing any string's case, grep
the exact text across `js/`: if it appears anywhere but the one place that renders it, leave it
alone. Category and status values stored in the database are display strings *and* comparison
targets, so they keep whatever case the data already has.

Prose in `docs/` and `README.md` is written for facility managers, not developers: no CRUD,
schema, join table, denormalized, boolean, modal (say "dialog"), or foreign key. Explain a rule
by what it does for the reader.

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
`APP_VERSION` ends up at.

`docs/index.html` (the hosted release-notes page) is **half live, half hand-written** — don't
assume it updates itself.

Derived from `CHANGELOG.md` at load time, so these look after themselves: the `## Full changelog`
section, the `#footer-version` string, and the `#hero-release` version+date inside the
`Release X.Y.Z · DD Mon YYYY` eyebrow. All three come from the newest `## [x.y.z] — YYYY-MM-DD`
heading, parsed by the script at the bottom of the file. The static text inside those spans is
only a no-JS fallback; leave it be.

Hand-written per release, and genuinely easy to forget: the hero **lede**, the `Highlights`
**cards**, and the `In detail` **feature blocks**. Update them whenever a release changes behaviour
enough to warrant a card or a screenshot. `In detail` blocks reference `docs/screenshots/*.png`
with an `onerror` handler that adds a `.pending` class, so a block may be written before its
screenshot exists and degrades gracefully until one is added — and screenshot **numbering is
sequential across the whole directory**, so check the highest existing number before picking one
rather than assuming a free filename means a free slot. That section's own sub-head says it is for
"the changes worth a screenshot": a fix with nothing to show (a caching bug, say) belongs in a
Highlights card, not a feature block, which would otherwise leave an empty image column.

A docs-only change needs no version bump and no `CHANGELOG.md` entry — the versioning rules above
are about cache-busting the app shell, and this page isn't part of it.
