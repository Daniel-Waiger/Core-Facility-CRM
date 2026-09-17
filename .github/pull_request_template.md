<!--
Default template: for the client-side Core Facility Tracker (this repository).
For work on the server track (Roadmap Tier 5), open the PR with
?template=server.md appended to the URL instead.
Delete any block that does not apply. "N/A" is a valid answer; silence is not.
-->

## Description
<!-- What changes for a facility manager, and why. One paragraph. -->

## Related Issue
Closes #

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / chore
- [ ] Documentation only (no version bump, no CHANGELOG entry)
- [ ] Release (version bump — see the Release block below)
- [ ] Changes the database schema or the format of a stored value (affects existing IndexedDB data and old backups)

## Zero-Install Constraint
<!-- The app is 100% client-side, no build, no backend. Confirm in one line: -->
- [ ] No `package.json`, no bundler, no network calls, no new files outside `libs/` for third-party code

## How Has This Been Tested?
<!-- Paste the exact commands. Tests must run under a UTC+ timezone; a date bug at UTC is invisible. -->
```bash
TZ='Asia/Jerusalem' node --test 'test/unit/*.test.js'
TZ='Asia/Jerusalem' node --test 'test/browser/*.spec.js'   # if Playwright available
```
- [ ] Unit group passes
- [ ] Browser group passes, or: not run because ________
- [ ] App loaded in a browser and every screen this PR touches was actually visited (screens are template strings; the tests do not prove they render)

## Checklist — pick the blocks that apply

**Release only** (otherwise none of these files change)
- [ ] `?v=` on every `<script>`/`<link>` in `index.html`
- [ ] `CACHE_VERSION` and `PRECACHE_URLS` in `sw.js`
- [ ] `APP_VERSION` in `js/consts.js`
- [ ] `CHANGELOG.md` section `## [X.Y.Z] — YYYY-MM-DD` with Added / Changed / Fixed
- [ ] `docs/index.html`: hero lede, Highlights cards, In-detail blocks updated by hand (only the changelog section is live)
- [ ] New screenshots in `docs/screenshots/` use the next free sequential number

**Schema / data**
- [ ] Additive migration in `js/db.js`; existing databases and old JSON backups still open
- [ ] Seed/demo dataset updated for the new column or table
- [ ] Denormalized display string and its join table both written on every save (e.g. `meetings.attendees` + `meeting_people`)
- [ ] New delete path deletes child rows explicitly, not by cascade alone; `projects.pi_id` nulled by hand
- [ ] Stored cost snapshots are never recomputed

**Money / dates / history**
- [ ] Hour arithmetic goes through `UI.hoursBetween` / `UI.billableStaffHours`; no second copy
- [ ] Reports and exports read the same aggregation as the screen
- [ ] Date strings built with `UI.ymd` / `UI.today`; no `toISOString().slice(0, 10)`
- [ ] Nothing deletes a person, instrument, project or booking that carries references; pickers keep "not retired OR already selected"
- [ ] A new money, date or delete rule ships with a test

**UI**
- [ ] Every new `data-act` has both an emitter and a handler
- [ ] Title Case for controls, sentence case for prose; any recapitalised string was grepped across `js/` and is not compared or used as a key
- [ ] Danger dialogs: red button is Cancel, `confirmText` names the verb
- [ ] Layout checked at tablet width

**Exports** — new or changed record field appears in:
- [ ] XLSX
- [ ] DOCX
- [ ] PDF
- [ ] N/A

**Docs**
- [ ] `docs/` and `README.md` prose is written for facility managers (no schema, join table, modal, CRUD)
- [ ] Review threads addressed or answered

## Screenshots (UI changes)
<!-- Before / after. If the change is worth a docs card, the screenshot also goes in docs/screenshots/. -->
