# Changelog

All notable changes to Core Facility Tracker are documented here.
This project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Week calendar view (roadmap 1.1).** The Calendar screen gains a Month/Week toggle alongside
  the existing Prev/Today/Next controls. Week mode shows an hourly grid (with an all-day lane for
  milestones and untimed bookings) for the Monday–Sunday of the current week; clicking an hour
  slot opens a new booking pre-filled with that hour's start/end. Month and Week share one
  milestone/meeting fetch and one event-chip renderer so the two views can never disagree, and the
  hour-grid layout math is factored out for reuse by the resource timeline (roadmap 1.3). Also
  fixes cancelled bookings not rendering with the cancelled style on the calendar (the month query
  was missing `is_cancelled`).
- **Per-instrument booking constraints (roadmap 1.3).** Instruments gain optional min/max session
  duration, minimum gap between bookings, and minimum advance notice fields on the Add/Edit
  Instrument modal (0 = unconstrained). `findBookingConflicts` enforces all four alongside the
  existing overlap checks, shared by the booking modal's live advisory and its save-time hard
  block so the two can never disagree; advance notice is skipped for notes-only edits and
  reinstating a cancelled booking so it can't retroactively fail a slot already locked in.
- **Per-instrument resource timeline (roadmap 1.4).** The Calendar screen gains a Timeline mode
  alongside Month/Week: one lane per instrument across the same Monday–Sunday week as Week mode,
  with each booking rendered as a proportional block reusing the Week grid's time-layout helpers
  at a percent-per-hour scale. Clicking an empty slot opens a new booking pre-filled with that
  lane's instrument as well as the date/time; retired instruments still show their booking history
  but are excluded from that pre-fill.
- **Recurring bookings (roadmap 1.5).** The new-booking modal gains an optional "Repeat every N
  week(s) until" field; saving generates one occurrence per date (same BOM/pricing snapshot for
  all), checking every date's conflicts up front so the save is all-or-nothing, with a 52-occurrence
  sanity cap on the schedule length.

## [1.6.0] — 2026-09-07

### Added
- **Grants table with pickers, costs, and exports (roadmap 2.1).** A new Settings card manages
  Grants (name, number, note, an "Allowed Users" token picker backed by `grant_users`), pickable on
  the Project and Booking modals via a shared `grant_id` selector. Grants are retired rather than
  deleted once referenced (`DB.countGrantRefs`), and a Settings toggle chooses whether the app
  displays a grant by name or number everywhere — resolved through one shared `DB.grantLabel`
  helper (no denormalized grant-name column) so Project Detail, Project Costs, and the XLSX/DOCX/PDF
  exports can never disagree.
- **Live conflict feedback in the booking modal.** As instrument/staff selections and the
  date/start/end fields change, the modal now shows an as-you-type conflict advisory (or an
  all-clear line once start/end are set), reusing `findBookingConflicts` verbatim so it can never
  drift from the hard-block check `bookingSave`/`bookingEditSave` still run at save time.
- **Configurable cancellation billing rules in Settings.** A new "Cancellation Billing Rules" card
  lets each facility choose, independently for before- and after-start cancellations, whether a
  booking's charge still counts toward Project Costs — defaulting to the app's original hard-coded
  behavior (before = dropped, after = kept) so existing data behaves unchanged until configured.
  `cancelBooking`'s confirm-dialog copy is driven by the same settings so the rule described can
  never drift from the rule applied.
- **Instrument → supervising staff mapping.** Instruments can now list one or more Facility Staff
  as "Supervising Staff" via a token picker on the Add/Edit Instrument modals, backed by a new
  many-to-many `instrument_staff` join table. Supervisors show on the Instruments table, are
  searchable there, and appear in the XLSX instrument export.
- **Consult type tag on meetings (roadmap 3.1).** Bookings can now be tagged with a Category
  (sync, consult, training, assisted session — extensible via the usual "+ Add New" vocab flow),
  shown as a badge on the meeting list and included in the XLSX/DOCX/PDF exports. Reports &
  Utilization gains a "Consults" card breaking down category = "consult" bookings by instrument
  and by calendar month, backed by `Reports.computeConsultRows` and mirrored in the Reports XLSX
  export so the two can never disagree.
- **Periodic local exports into the silent backup folder (roadmap 3.7).** When an automatic backup
  writes silently into the configured backup folder, it now also drops a companion facility-wide
  XLSX export (projects, milestones, people, instruments, bookings & costs) into the same folder,
  reusing `Exports.buildAllXlsxBlob` so the XLSX content can never drift from the manual "Export
  All" report. Purely additive — any failure building or writing the XLSX is swallowed and never
  falls back to an unprompted browser download; only the JSON backup is load-bearing.

### Fixed
- **Orphaned grant references render the fallback dash, not a blank.** `grant_id` is a soft
  link, so a referenced grant row can be missing; Project Detail, the bookings table, and every
  export now decide between label and "—" from the *resolved* label rather than from `grant_id`
  alone.
- **Live conflict advisory matches the save-time date default.** The New Booking form defaults a
  blank date to today at save; the as-you-type conflict check now applies the same default (the
  edit form stores a blank date as no-date, where no conflict is possible — unchanged).

## [1.5.7] — 2026-09-07

### Fixed
- **The sidebar's collapse button was invisible on every screen** — the button, its click target
  and its tooltip were all there, but its icon rendered at 0×0, so there was nothing to see or
  aim at. An inline `<svg>` carrying only a `viewBox` has no natural size, and this one sat in one
  of the few places with no `… svg { width; height }` rule of its own. `UI.icon()` now emits a
  default `width`/`height`, which every context that sizes its own icons still overrides, so no
  icon can silently render at nothing again. The same bug was hiding the green "facility staff"
  ticks on the People table — those pills were empty.
- **Collapsing the sidebar no longer clips the logo and the expand button.** Side by side they
  don't fit a 68px rail, and the overflow was cut off by the sidebar itself; they're now stacked.
- **The dashboard's milestone feeds no longer wrap a word per line or push the due date outside
  the card.** The name, project, status pill and date were four flex items sharing one line, each
  squeezed to its narrowest, and the date was clipped by the card's edge (the row needed 315px in
  a 274px card). The name and project now stack as a title and subtitle, the pill and date stay
  together as a unit, and the row wraps rather than squeezing.
- **"Overdue milestones" showed a `+` icon.** The `alert` icon's path drew a vertical line and a
  horizontal line — a plus sign. It's now a warning triangle.
- **Sidebar footer tooltips no longer render on top of the button above them** (the last of the
  overlap fixed for the nav items in 1.5.4): "Switch to Light Mode" appeared over *Tour*. The
  footer controls now use the same native tooltips the nav items were moved to.

## [1.5.6] — 2026-09-07

### Fixed
- **Tables now scroll sideways when they don't fit, instead of squeezing their columns until the
  text breaks apart.** 1.5.5 fixed the narrow-screen switch but not the reason the switch didn't
  help: every cell carried `overflow-wrap: anywhere`, which lets a word break at *any* character
  and so drops each cell's *minimum* width to one character. A table whose minimum is one
  character per column always fits its container, so it never overflowed and never scrolled — it
  just shredded each heading into a vertical stack of letters (`R`/`A`/`T`/`E`/`H`/`R` where
  "Rate/hr" belongs). Cells now use `overflow-wrap: break-word`, which still breaks a word too
  long for its column as a last resort but leaves the minimum at the longest word, so a table
  that can't fit overflows and its wrapper scrolls.
- **Registry tables no longer force columns to a fixed share of the width regardless of what's in
  them.** `table-layout: fixed` sized columns purely from the `<col>` percentages and ignored
  content, so a column whose share was too small for its own text had nowhere to put it — the
  Instruments Status column's 8% would have needed a 1600px-wide table to fit the word
  "Maintenance", which is why that badge broke apart even on a full-width desktop window. The
  `<col>` percentages are now hints that the browser honours where the content fits and widens
  where it doesn't.

## [1.5.5] — 2026-09-06

### Fixed
- **Registry tables (Projects, People, Instruments) no longer shred their column headers into a single vertical character per line** on a narrower browser window or a higher OS/browser zoom level. The "switch to a scrollable table" fallback was gated on the full window width, which doesn't account for the sidebar eating a fixed chunk of it — it's now measured against the space actually left for the table.
- **Sidebar nav-item tooltips no longer render on top of the item above them.** They showed directly above the hovered row, which in the tightly stacked nav list landed on the previous item's label; tooltips now appear beside the item instead.

## [1.5.4] — 2026-09-06

### Fixed
- **A page could show stale content for up to 10 minutes after a deploy, on any plain navigation
  — reopening a tab, clicking back into an already-visited page — not just after a hard refresh.**
  This first surfaced as the manual's new theme-toggle button appearing once and then vanishing
  on every page, including the manual's own home page. The cause was in `sw.js`'s "network-first"
  handling of the app shell and (since this worker's scope covers the whole site) every
  `docs/manual/*.html` page: its `fetch(event.request)` still consulted the browser's own HTTP
  cache first, and GitHub Pages serves these pages with `Cache-Control: max-age=600` — so an
  ordinary navigation, as opposed to an explicit reload (which forces revalidation), could return
  a response cached before the last deploy with no network request at all. Reproduced locally
  against a server that mimics GitHub Pages' actual cache headers (the plain dev server used
  elsewhere sends none, which is why this didn't show up in testing until now), confirming both
  the bug and the fix: the shell fetch now uses `cache: 'reload'`, the same technique the
  install-time precache step already used for exactly this reason.

## [1.5.3] — 2026-09-06

### Added
- **A full user manual**, searchable and illustrated, hosted at `docs/manual/`.
- **A new Manual button in the sidebar**, linking straight to the hosted manual.
- **Browser Back/forward now works, and every screen has its own address** (`#/projects`, `#/project/12`, `#/reports`, …) so a screen can be bookmarked, reloaded, or shared between devices. Dialogs and the guided tour stay out of the URL.
- **A safety copy of your current data is downloaded automatically before a Restore** replaces the database (skipped when the database is empty), named `core-facility-pre-restore-backup-<date>.json`.
- **"Show all labs" on the booking form's Assign People picker** — tick it to invite a collaborator from another lab without switching the booking's Group/Lab. The chosen Group/Lab still decides the group discount.
- **Rename / Merge Lab tool** in Settings (Admin Mode): renames a lab everywhere at once — people, the lab's standing discount row, and the lab label saved on past bookings. Merging into an existing name keeps that name's own discount; historical booking totals are never recomputed.

### Changed
- **Milestone status is picked directly** from a small chooser (project page, dashboard lists, Today's Agenda) instead of click-cycling pending → in-progress → done.
- **"+ Add New" Lab/Group and Department values now persist immediately**, even if the form they were added from is cancelled.
- **The "Single Instrument Booking?" question has a "Don't ask me again" checkbox**; Settings → Preferences can turn the question back on.

## [1.5.2] — 2026-09-06

### Fixed
- **Installed clients were stuck on an old release even though the server was serving the new one.** A user reported that the booking form still forced them to pick the core facility as the Group/Lab before any facility staff appeared — the exact thing 1.5.1 fixed. Their Settings screen read **Version: 1.4.0** while the hosted app, every version string on it, and its service worker all said 1.5.1. The cause was in `sw.js`, not in the booking form:
  - `index.html` and `./` are the only precached URLs with **no `?v=` on them** — they are what *names* which versioned assets to load. GitHub Pages serves them with `Cache-Control: max-age=600`, and `cache.addAll()` is free to satisfy a request from the browser's own HTTP cache. So a newly-installing service worker could fill its brand-new `…-1.5.1` cache with the **previous release's** `index.html` — a shell still asking for `?v=1.4.0` files. Those weren't in the precache list, so the cache-first fetch handler fetched and cached them too. The result was a client pinned to 1.4.0 inside a correctly-named 1.5.1 cache, with no reload count able to break out of it.
  - Precaching now requests every entry with `cache: 'reload'`, so the new cache can only ever be filled from the network.
  - The HTML shell is now served **network-first** (falling back to cache when offline) instead of cache-first. Versioned assets stay cache-first — their URLs are immutable per release, so a cache hit is always correct — but the shell must be allowed to change, or a stale one keeps pointing at a stale release forever.
  - Cache lookups are now scoped to the current release's cache, so a leftover cache can never answer for it.
  Reproduced end-to-end against a server sending the same `max-age=600` GitHub Pages sends: a client on 1.4.0 stayed on 1.4.0 across three reloads with the old worker, and moved to the new release with the fixed one. Anyone currently stuck will pick this up on their next couple of reloads; from here on an update arrives on the first reload after a deploy.

## [1.5.1] — 2026-09-06

### Changed
- **The demo dataset now actually exercises the Reports screen.** 1.5.0 shipped Reports & Utilization against a demo dataset with three bookings, only one of which carried any billing data at all — so a new user loading the sample data saw one instrument of five, one staff member, no cancellations, and nothing on the third project. The feature looked broken on the very dataset meant to demonstrate it. The seed now has ten bookings covering all five instruments and three facility staff, deliberately including the cases that make each part of the report meaningful:
  - a **multi-instrument** session (parallel sample runs), the only thing that exercises the even-split staff attribution — and it reconciles: 4 staff hours across two instruments shows as 2h against each, and the row still sums to the person's true total;
  - a **per-unit** instrument line (Glacios Cryo-TEM, billed per sample rather than per hour), whose cost is correctly excluded from the discount base;
  - a **facility-wide** booking with no project, so the "Facility-wide" row is demonstrated rather than theoretical;
  - **both kinds of cancellation** — one cancelled before its start (hours and charge both drop out) and one cancelled after, with the charge retained (hours drop out, revenue stands). On the Leica SP8 these two rules visibly disagree, which is the point;
  - a **partial staff window** (40 minutes inside a four-hour booking), so worked hours and billed hours differ and the 1-hour floor is visible;
  - two consultations with **no line items**, because plenty of real sessions aren't billable.
- **Demo dates are now relative to the day the sample data is loaded** rather than hardcoded to 2025–2026. Eighteen fixed dates across projects, milestones and bookings became offsets from today, so the demo never reads as stale history and always falls inside the Reports screen's default range. Milestone statuses keep their narrative shape — completed ones in the past, upcoming ones ahead, and one deliberately overdue so the dashboard's overdue feed isn't empty.
- **Seeded cost snapshots are computed, not typed in.** `computeBookingBOM` moved from `app.js` into `ui.js` (it was already pure — times, rates and line items in, numbers out), so the seed prices its bookings with the exact calculator the booking modal uses. Every stored `subtotal` / `total_before_tax` / `total_cost` and every `line_cost` is therefore what the app itself would have written had a user entered the booking by hand, and none of it can drift if the seeded overhead or tax rates are ever changed. Verified in a browser by recomputing all ten bookings from their own line items and comparing against what was stored — and the original demo booking still prices at exactly $490 / $546.25 / $589.95, unchanged.
- A `seedBooking()` helper replaces the per-booking blocks of raw INSERTs. It builds the denormalized `meetings.attendees` display string and the `meeting_people` rows from one shared id list, so the pair cannot drift — the exact failure this project hit once before.

## [1.5.0] — 2026-09-06

### Added
- **A Reports & Utilization screen**, answering the two questions a core facility is actually asked: how much each instrument gets used, and where facility-staff time goes. Pick any date range (or This Month / This Year / All Time) and get four tables:
  - **Instrument utilisation** — bookings, booked hours, billed revenue and each instrument's share of total facility hours.
  - **Facility staff time** — sessions, hours actually worked, hours billed, and revenue per staff member. Worked and billed hours are reported separately because billing applies a 1-hour floor and rounds up to whole hours; one number is workload, the other is the invoice.
  - **Staff × instrument** — for "am I mostly helping users on one scope?". **Sessions** counts bookings unsplit, which is the figure that actually answers the question. **Attributed hours** divides a booking's staff hours evenly across every instrument on it, purely so the column reconciles against the person's true total — multi-instrument bookings are usually parallel sample runs, so that split is a bookkeeping convenience, not a claim about where the time "really" went. Both rules are stated on the card.
  - **Projects & groups** — bookings, hours and cost per project and per lab. A booking with no project is grouped as "Facility-wide".
  Two rules are applied consistently and spelled out on screen: booked hours exclude cancelled bookings entirely (a cancellation releases the slot, so the instrument was never held), while revenue follows the same retained-charge rule as Project Costs. Retired people, retired instruments and archived projects still appear — that is the point of keeping them.
- **XLSX export of the whole report**, including a Notes sheet carrying the date range and both of those rules, so an exported total can be reconciled against its rows. Screen and export are built from the same aggregation functions, so an exported figure cannot drift from the on-screen one.
- `UI.ymd()` / `UI.todayPlusDays()` for local calendar dates, and `UI.timeToMinutes` / `UI.hoursBetween` / `UI.billableStaffHours` moved into `ui.js` so the Reports screen and the booking cost calculator count hours with one shared implementation rather than two copies.
- A **"Facility staff only (N)"** filter on the People list, alongside the existing retired toggle.

### Fixed
- **The calendar showed bookings on the wrong day for anyone east of Greenwich.** A booking created on 9 September appeared in the cell captioned 9 but opened, correctly, as 8 September. The calendar built each day cell as a local-midnight date, then captioned it with the local day number while looking its bookings up under a **UTC** date string — and at a UTC+ offset local midnight falls on the previous UTC day. Replaying the cell loop under Node: at `Asia/Jerusalem` and `Europe/Paris` all 35 cells in the grid disagreed with their own caption; at `UTC` and `America/Los_Angeles` none did, which is why this went unreported for so long. The edit form had been right all along — it reads the stored date directly.
  - The same wrong date was handed to click-to-book, so clicking an empty cell opened a new booking on the previous day, and the cell's tooltip named the previous day.
  - The calendar's own query bounds carried the same shift, silently excluding the last day of the visible grid from its results.
  - Two other places used the same conversion and are fixed with it: the dashboard's 30-day upcoming-milestone window (one day short) and a project's overdue-milestone flag (could fire a day early). `UI.today()` itself returned *yesterday* between local midnight and 02:00/03:00 at UTC+ offsets, affecting every caller.
- **Un-ticking Facility Staff on a person silently deleted them from bookings they had already worked.** The booking form's staff picker only ever listed people currently flagged as Facility Staff, and saving a booking rebuilds its staff rows from whatever the form shows — so the next save of any booking that person was on destroyed their assignment *and* the billing line behind it. Confirmed end-to-end in a browser before and after the fix: pre-fix, a re-save took `meeting_staff` from one row to none, taking a $190 line with it. The picker now keeps anyone already assigned to the booking, exactly as it already did for retired staff, while still not offering them for new assignments.

### Changed
- **"Core Staff" is now "Facility Staff" everywhere**, and the forms say what the flag actually does. The person form explains that ticking it puts someone in the "Assign Facility Staff" picker and bills their hourly rate, and that researchers and lab members should be left unticked because they belong in "Assign People". Both booking modals carry a line distinguishing the two pickers and stating that only people ticked as Facility Staff appear in the staff one. The People list's column is labelled "Facility Staff" with a tooltip saying where the flag is set. No stored data changed — this is naming and help text only.

## [1.4.0] — 2026-09-05

### Changed
- **People, instruments and projects are retired or archived instead of deleted.** Deleting them destroyed historical fact: who actually attended a booking, which instrument a session actually ran on, who was PI on a project, and the billing behind a cost snapshot. None of that should disappear because someone leaves the facility or a scope is decommissioned. The delete actions are now **Retire** (people, instruments) and **Archive** (projects), which keep every existing link exactly as it is and only take the record out of the day-to-day lists.
  - Retired and archived records are labelled **(Retired)** / **Archived** everywhere they appear — lists, project team and instrument cards, milestone assignees, booking badges, and XLSX/DOCX/PDF exports (the facility-wide export gains an explicit status column). The stored name is never modified; the suffix is added at display time, so historical records read back exactly as they were entered.
  - They stop being offered when assigning new work, but stay selected wherever they already are. This matters more than it sounds: saving a milestone or a booking rebuilds its assignees from what the form shows, so a hidden assignee would have been silently dropped on the next save. Retired records still render on the forms they already belong to.
  - Lists hide them by default behind a **Show retired / Show archived (N)** toggle that only appears when there are any. The dashboard's counters and overdue alerts now cover active projects only.
  - Both are reversible with **Restore**. Only a record that nothing references at all — a typo or duplicate, with no history to protect — still offers a permanent delete.
- **On a destructive confirmation, the red button is now Cancel, not Confirm.** Colour is what the eye lands on first, and on a dialog whose whole purpose is to prevent an accident, the safe way out deserves that attention rather than the irreversible choice. The destructive action stays plainly labelled — the buttons now read "Delete", "Retire" or "Archive" instead of a generic "Confirm" — but is styled quietly. Non-destructive confirmations keep the ordinary neutral-Cancel / primary-Confirm pairing.
- **Bookings are cancelled, not deleted.** A booking is an accounting record as much as a diary entry — it says the facility held instrument and staff time on a date, and what that was worth. Cancelling keeps the booking and its line items logged, and frees the instrument and staff time so the slot can be booked by someone else. Whether the charge still stands follows when it was cancelled:
  - cancelled **before** its start time — nothing was held, so the charge is dropped from Project Costs;
  - cancelled **after** its start time — the slot was held, so the charge stands. **Admin Mode** (which already gates every other billing decision in this app) offers a three-way choice to waive it instead; without Admin Mode the charge stands and the dialog says so.
  - Cancelled bookings are badged in the project's Meetings and Project Costs cards (waived charges struck through and excluded from the running total), struck through on the calendar, and carry a Status column in the XLSX exports plus an inline marker in DOCX/PDF. **Reinstate** puts one back, re-running the double-booking check first since it starts holding its slot again.
  - A booking with no attendees, line items or cost is an empty note and can still be deleted.

### Added
- `people.is_retired` / `retired_at`, `instruments.is_retired` / `retired_at`, `projects.is_archived` / `archived_at`, and `meetings.is_cancelled` / `cancelled_at` / `billing_retained`, with additive migrations so existing databases pick them up on load.

## [1.3.9] — 2026-09-04

### Fixed
- **A custom metadata field's Edit and Delete icons were invisible and impossible to click.** On a project's Metadata & Custom Fields card, both icons are bare `<span>`s, so none of the CSS rules that size the app's inline SVG icons (`.btn svg`, `.card-title svg`, …) applied to them. Unsized inside an inline span, each SVG collapsed to 0×0 — measured in a browser, the controls were 0px wide and a click at their position landed on the row behind them, so a custom field could never be edited or removed once saved. Both icons now have a real 22×22 hit area with a 14px glyph and a hover background, fitting the row's existing 48px action column. (This also made 1.3.8's new "Delete Field" confirmation reachable — it was previously behind an unclickable icon.)

## [1.3.8] — 2026-09-04

### Fixed
- **One-click deletes now ask first.** The trash icons for meetings/bookings (in a project's meeting list), milestones, custom key-value fields, and file links deleted immediately with no confirmation — a stray tap permanently removed the record (and, for a booking, its billing line items). All four now show the same danger-styled confirmation dialog every other delete in the app already used, naming the record about to be deleted.
- **Deleting a person now fully unlinks them.** Their meeting attendee and core-staff assignments are removed, the denormalized attendee display list on affected meetings is recomputed so it no longer shows the deleted name, and any project that had them as PI has its PI cleared (that reference carries no foreign key, so nothing else would ever have cleaned it up).
- **Booking cost breakdown no longer overstates discounts.** When a group discount plus a manual discount together exceeded 100%, the actual deduction was correctly capped at 100% of the instrument-time charge, but the two summary rows still displayed their uncapped amounts. The displayed rows are now scaled so they always sum to the real deduction.

### Changed
- **The Delete Project dialog now tells the truth about meetings.** It claimed the project's "meeting records" would be deleted; they never were — bookings are kept and become facility-wide (the schema unlinks them via `ON DELETE SET NULL`). The dialog now says milestones, files, and custom fields are deleted while meetings are kept as facility-wide bookings.
- **Delete paths clean up linked records explicitly.** Deleting a project, person, instrument, or booking now removes its dependent join-table rows directly instead of relying on SQLite cascades alone — a belt-and-suspenders guard, since sql.js's `export()` silently disables foreign-key enforcement as a side effect (the app reasserts it after every autosave, verified working, but explicit cleanup survives even if a future code path forgets to). Person and instrument delete dialogs now also warn that affected bookings keep their historical cost snapshots while losing the deleted line items.
- **Documentation refresh (docs-only, no app change).** Every screenshot in `docs/screenshots/` was re-captured: the whole set still showed the pre-1.3.7 stock palette. Added shots for the new confirmation dialogs, and rewrote the hosted release-notes page (`docs/index.html`) for 1.3.7–1.3.8 — its hero, highlight cards, and screenshot walkthrough are hand-maintained rather than generated from this changelog. The README gained a "Safe deletes" section covering the same ground.

## [1.3.7] — 2026-09-04

### Changed
- **Restyled color palette and motion tokens.** Moved off the stock Tailwind indigo/violet palette (shared with other apps built on the same starting template) onto a distinct neutral/violet "Facility Design Language" system, in both light and dark themes: backgrounds, borders, text, and status colors (success/warning/danger) all recolored, with WCAG-AA-verified contrast. The logo gradient and PWA theme colors (favicon, manifest, meta tag) moved to the same violet identity. Dark-mode primary buttons now use a dedicated dark-ink text color instead of white, fixing a contrast failure against the lighter dark-mode primary. Added shared motion tokens (`--dur-fast`, `--dur-move`, `--ease`) and retargeted existing transitions to them, plus a `prefers-reduced-motion` override. No layout, typography, or component structure changes.

## [1.3.6] — 2026-09-03

### Added
- **Interactive screenshot gallery.** `docs/gallery.html` — a full-size carousel of every screenshot with prev/next controls, a thumbnail rail, keyboard and swipe navigation, and a shareable link per shot. Lists `docs/screenshots/` live from GitHub so newly added screenshots need no code change. Linked from the README's Screenshots section.

### Changed
- **Group / Lab is now required before assigning Core Staff too, not just People.** The "Assign Core Staff" picker locks the same way the "Assign People" picker already did — no group picked yet blocks it with a "Choose Group/Lab First" hint — since every core-staff member also belongs to a facility group. Dropped the "(optional)" label off the Group / Lab field itself: it's never actually skippable, since it's either picked directly or auto-filled from the project's PI.

## [1.3.5] — 2026-09-03

### Added
- **Single-instrument booking precheck.** The first time an instrument is added to a booking, a prompt asks whether only that one is needed. Answering yes locks the "Assign Instruments" picker — no further instrument can be added — until that instrument is removed from the booking.

## [1.3.4] — 2026-09-03

### Changed
- **Group / Lab is now required before assigning people to a booking.** Clicking the "Assign People" dropdown while no Group/Lab is chosen shows a not-allowed cursor and a rounded hint box ("Choose Group/Lab First") next to it instead of opening the list. Already-assigned people stay on the booking regardless (removing them, or switching labs, is never blocked); picking a Group/Lab — directly, or auto-filled from a project's PI — unlocks the dropdown immediately.

## [1.3.3] — 2026-09-03

### Fixed
- **Browser tab and bookmarks bar showed a generic globe/sphere icon instead of the app logo.** The only favicon declared was an SVG (`favicon.svg`), and Chrome's bookmarks bar (along with some other browser surfaces) doesn't render SVG-only favicons, falling back to its default globe icon. Added PNG (`icons/icon-16.png`, `icons/icon-32.png`) and `.ico` fallbacks alongside the existing SVG, plus an `apple-touch-icon`, so every surface shows the real logo. The PWA manifest also now lists PNG icons (192/512) alongside the SVG.

## [1.3.2] — 2026-09-03

### Fixed
- **"Load Sample Data" broke on the second run, silently.** `seedSampleData()` re-inserted the billing rates and the Bio-Photonics Lab group discount with a plain `INSERT`, but `clearAllData()` deliberately never clears `app_config`/`group_discounts` (they're facility settings, not sample data to wipe). Re-running it — including via the welcome screen's "Load Demo & Start Tour", which calls it on every click — hit a `UNIQUE constraint failed` that aborted the whole handler mid-flight: no toast, no dismissal, and (from the welcome screen) the tour never started, leaving it looking like the button just didn't work. Now uses the existing `DB.setConfig`/`DB.setGroupDiscount` upserts, so reseeding is safe to run any number of times.

## [1.3.1] — 2026-09-03

### Added
- **Group / Lab selector on bookings.** A new "Group / Lab" dropdown next to Project narrows the "Assign People" picker down to one lab — relief for facilities with everyone in one flat list — while already-selected people (e.g. a cross-lab collaborator) stay on the booking regardless of the filter. Picking a project auto-fills the Group from its PI's lab; it can also be set directly for a facility-wide booking.
- **The Group selector now drives the standing group discount**, offered automatically whenever a lab is chosen. In Admin Mode, a **Revoke**/**Apply** control on the discount line lets you turn it off for this booking — asking whether to remove it **just for this booking** or **for every future booking under that lab too** (the latter updates the lab's standing rate in Settings, same as editing it there directly). Re-applying restores the rate with no prompt.
- Bookings now store which Group/Lab they were made under (`group_org`), so reopening one restores its exact filter and discount state rather than re-deriving it live.

### Fixed
- No functional bug in the cost breakdown itself — a documentation screenshot of it was cropped mid-way through the summary. Re-captured showing the full Subtotal → Total breakdown.

## [1.3.0] — 2026-09-02

### Added
- **Timed instrument & core-staff bookings.** Bookings now carry an optional start/end time alongside the date. A new "Assign Core Staff" picker (people flagged as Core Staff, billable by the hour) sits alongside the existing attendee and instrument pickers.
- **Double-booking prevention.** Saving a booking is hard-blocked if any selected instrument or core-staff member already has an overlapping time window booked elsewhere the same day — the save is rejected with a message naming the clash, no override.
- **Instrument cost & billing unit.** Instruments gain a Cost field and a Unit (`time`, `unit`, `weight`, `other` — extensible like every other dropdown). Time-priced instruments bill by the booking's duration; other units bill by an amount typed into the booking.
- **Core-staff hourly rate & 1-hour billing floor.** People can be flagged as Core Staff with an hourly rate. Each assignee can be given a partial window within the booking (defaulting to the full booking); billable time is never less than 1 hour and always rounds up to the next whole hour.
- **Live Cost & Time Breakdown in the booking modal.** Every instrument/staff line, a standing per-lab group discount (auto-applied from the project's PI's lab) plus a manual admin-only override, both overhead percentages (stacked), and the resulting subtotal → before-tax → after-tax total are shown live and recomputed on every change.
- **Billing Rates & Admin Mode in Settings.** Facility-wide internal/external overhead %, tax %, and currency symbol now live in Settings. An unsecured local "Admin Mode" toggle (no accounts exist in this app) reveals the per-lab Group Discounts editor and the manual per-booking discount override.
- **Project Costs.** Each project page now lists every booking's stored cost snapshot (subtotal, before-tax, total) with a running project total.
- **Custom project statuses.** The project status list is now user-extensible via the same "+ Add New" vocabulary flow used elsewhere, seeded with a review → kickoff → billing workflow (Submitted for review, Under review, Kickoff scheduled, Invoiced, Paid, …) alongside the original statuses.
- **Cost data in exports.** Instrument cost/unit and staff rate now appear in the per-project XLSX/DOCX/PDF exports and the facility-wide export, which also gains a dedicated "Bookings & Costs" sheet.
- Calendar bookings now show and sort by start time.

## [1.2.8] — 2026-09-02

### Added
- **Email Attendees** on a meeting/booking — opens a modal listing the attendee emails, subject, and body (date, notes, action items), each with its own copy button, plus an "Open Email App" button that launches a blank `mailto:` compose window to paste them into. Available on each meeting in a project's Meetings & Syncs card, and in the Edit Booking modal footer (for facility-wide bookings with no card row of their own).

### Fixed
- **Seed/demo data** — the sample meetings only ever set the denormalized `attendees` display text, never the actual `meeting_people` link rows, so any real per-attendee feature (like Email Attendees) saw "no attendees" on demo data despite names being shown. Meetings now get the same join-table rows the seed data already gives milestones.

## [1.2.4] — 2026-08-30

### Added
- **Release Notes button** in the sidebar — opens the hosted release-notes page (`/docs/`).

### Changed
- The release-notes page now renders the **full changelog inline as HTML** instead of linking to the raw Markdown file.

## [1.2.3] — 2026-08-30

### Added
- **The app is inert during the guided tour** — clicks, typing, and text selection on the page behind the tour are blocked so you can't accidentally change data or fill in a form while looking around. Only the tour bubble (Back / Skip / Next) responds; `Esc` exits the tour.

## [1.2.2] — 2026-08-30

### Added
- **Back button in the guided tour** — step backwards to revisit an earlier step (shown from step 2 onward).

## [1.2.1] — 2026-08-30

### Fixed
- **Guided tour targeting.** The walkthrough now spotlights stable, correct elements on every step: Project Details frames the project header (PI, code, timeline, status), Milestones frames the whole milestones card, Team frames the collaborators card, and Report Generation frames the export buttons — previously these landed on the wrong element or a row deep inside the page.
- **Tour scroll race.** Positioning now runs *after* an instant scroll settles instead of racing a smooth-scroll animation, so the spotlight is always on target even if you had scrolled the page before starting the tour. A passive scroll/resize listener keeps the spotlight glued to its element for the whole step.
- View steps route to the top of the page so the sticky title bar stays in view, and the highlight box is always clamped within the viewport.

## [1.2.0] — 2026-08-29

### Added
- **Booking modal — scalable people / instrument pickers.** People and Instruments are dropdowns instead of a full inventory of toggle chips. Picking one adds a removable badge (small `×` on the left) so you always see who / what is on the meeting; the dropdown shrinks as you pick. Person badges show the role on hover, instrument badges the modality.
- **"Register New Person"** in the booking modal is a vibrant mint-green button that opens the standard person form; each new person drops straight into the People picker and you can add several in a row.
- **Lab / Group and Department are proper dropdowns with "＋ Add New"** on the person forms — pick an existing value or register a new one via a quick modal, matching the app's other editable dropdowns.
- **Department** is its own field / column on a person (was crammed into "Lab / Group / Company" behind a comma). Shows as a separate tag in the People table and exports; seed data split accordingly.
- **Rich-text meeting notes** — bullet lists, **bold** (Ctrl/Cmd+B), *italic* (Ctrl/Cmd+I), preset font sizes (Small / Normal / Large / Huge), in the app's own font. Renders formatted in-app and in Word / PDF exports; Excel / CSV get plain text. Legacy plain-text notes still display.
- **Guided tour now walks every dialog** — the 19-step walkthrough opens each real modal (New Project, Add Milestone, Custom Field, Attach File, Register Person, Add Instrument, New Booking, Today's Agenda) so you see the actual forms, and glides between steps with a soft cross-fade instead of a hard cut.

### Changed
- **No more horizontal scrollbars** — wider max content width (1440px); tables use a fixed layout with wrapping cells and balanced columns; modal bodies and calendar day-cells clip overflow instead of scrolling.
- UI action labels follow the house rule: Capitalised Each Word.
- Nested modals close the topmost dialog on Cancel / Save, not the form underneath.
- The New Project dialog's inline "Register New Person" uses the same small, gender-neutral avatar and Lab / Group dropdown as the rest of the app.

### Removed
- The separate **Meeting Link** field — paste links into Notes instead. Existing saved links stay in the database and exports but are no longer shown in the UI.

## [1.1.3] — 2026-08-29

### Changed
- **Editable dropdowns** — picking "Other" now opens the same "+ Add New" prompt as the button next to the field (instead of saving the literal text "Other"), and "Other" always sorts last in the list, after every real term. Also added "Other" to Position / Role, which was missing it.

## [1.1.2] — 2026-08-29

### Fixed
- **Orphaned records on delete** — deleting a project, person, or instrument left its linked milestones, meetings, files, and team/instrument assignments behind in the database instead of cleaning them up, despite the UI implying otherwise. Root cause: sql.js's `db.export()` (called by every autosave) silently resets the database connection's `foreign_keys` enforcement to OFF as a side effect, so `ON DELETE CASCADE` stopped firing roughly 400ms after the very first save of a session. Now reasserted after every export — cascading deletes work for the life of the session, not just before the first autosave.

## [1.1.1] — 2026-08-29

### Added
- **Editable dropdowns** — Funding Source, Modality / Technique, Sample Type, Role on Project, and Position / Role are now `<select>`s with a "+ Add New" option that opens a small modal to add a facility-wide term (saved to the database, available everywhere immediately).
- **Interactive calendar** — click any day (past or future) to create a booking on that date; bookings can be assigned any combination of people, instruments, and an optional project (or left facility-wide, unassigned to any project); a compact Notes box plus a dedicated Meeting Link field (Zoom/Meet/Teams) that renders as a clickable link.
- Instrument "Location" is now its own field, separate from "Configuration Notes".

### Changed
- Files & Attachments links now render as a bold, rounded-rectangle button with a properly sized icon (matching the app's existing card style) instead of a plain underlined URL.

### Fixed
- Projects page Actions column (Edit / Open Details buttons) — a stray `stopPropagation()` was silently blocking every click in that column from reaching the app's event handler.

## [1.1.0] — 2026-08-28

### Added
- **Duplicate project** — clone an existing project as a starting template from its detail page. Copies details, team, assigned instruments, custom fields, and milestones (reset to pending, dates cleared). Meetings and files are not copied.
- **Facility-wide export** — "Export All" on the Projects page produces a single XLSX workbook with facility-wide sheets: Projects, Milestones, People, Instruments, and Meetings.
- **Keyboard shortcuts** — `Esc` closes the topmost modal; `/` focuses the current view's search box.
- **Copy project code** — one-click copy button next to a project's code on its detail page.
- **Version display** — the app version now shows in Settings → About.

## [1.0.0] — 2026-08-27

### Added
- **Tablet support (Android / iPad)** — the app no longer shows a blank page when storage is blocked; it renders a clear "Storage unavailable" screen with OS-tailored guidance and a "Continue anyway (temporary session)" option.
- **PWA** — `manifest.json` + service worker for home-screen install and offline use when served over https.
- **GitHub Pages hosting** — `.nojekyll` and relative paths so the app can be hosted as-is.
- **First-run device notice** — up-front explanation that data is per-device (no sync), plus an independent backup-folder setup prompt.

### Changed
- Boot is now fail-visible: startup errors render a diagnostic screen instead of a silent blank page.
- All `localStorage` access is routed through a safe wrapper that falls back to memory when storage is blocked.

### Fixed
- `confirmModal` removed the wrong DOM node, leaving the modal backdrop stuck after "Start Fresh".
- Tapping outside a modal now resolves its promise instead of hanging.
