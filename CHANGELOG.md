# Changelog

All notable changes to Core Facility Tracker are documented here.
This project uses [Semantic Versioning](https://semver.org/).

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
