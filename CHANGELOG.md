# Changelog

All notable changes to Core Facility Tracker are documented here.
This project uses [Semantic Versioning](https://semver.org/).

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
