# Changelog

All notable changes to Core Facility Tracker are documented here.
This project uses [Semantic Versioning](https://semver.org/).

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
