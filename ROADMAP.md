# Roadmap — Core Facility Tracker

Derived from the BookitLab (HUJI) feature comparison (read-only inspection 2026-09-07, revised
2026-09-09 against v1.9.1). That comparison, the university IT proposal and its one-page brief are
private documents kept in the facility's Google Drive folder under `docs/proposal/`, which is
gitignored and never part of this public repository. Tiers 1–4 keep **only what a 100%
client-side, single-user app can deliver** — no server, no auth, no email sending, no finance-system integration. Everything
multi-user or server-bound is **Tier 5**, a separate server track whose full case is the private
university IT proposal (see above).

Effort labels (S/M/L) are rough estimates, not measurements. No dates are promised.
Ordering within a tier is the intended build order, but items are independent unless noted.

**Status (2026-09-08):** Tiers 1 and 2 are fully shipped; **Tier 3 is shipped except for the
parts noted on the items themselves** — the stewardship scorecard's trained-user and downtime
columns and a maintenance slice in the activity mix (both waiting on data Tier 4 introduces),
plus 3.3's narrowed time-in-stage, which is a scope choice rather than a missing dependency (see
the clauses on 3.2, 3.3 and 3.4). ✅ marks below carry the release that shipped each item (1.6.0,
1.7.0, 1.9.0). Releases are cut per version via the `Release` workflow (Actions → Release → Run
workflow) and published on the [Releases
page](https://github.com/Daniel-Waiger/Core-Facility-CRM/releases). 1.8.0 added user-requested
items beyond this roadmap: type-to-search in all assignment pickers, per-category staff billing
policy (`category_policies` — consult/sync can bill 0% of staff rates; training links to
assisted; training/assisted require a staff assignee), and booking-modal polish. Remaining:
**Tier 4** and the **migration-tool milestone** — both deliberately parked while the app is used
day-to-day, since real friction should shape them. See "How these get built" at the bottom
before starting the next batch.

---

## Tier 1 — Scheduling depth

The clearest UX gap vs. BookitLab that is purely client-side.

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 1.1 | ✅ 1.7.0 — **Week calendar view** — hourly grid alongside the existing month view | M | New renderer in `js/views.js`; same booking data, same click-to-book. Test under a UTC+ timezone (see CLAUDE.md date rules). |
| 1.2 | ✅ 1.6.0 — **Live conflict feedback** in the booking modal — as-you-type, reusing `findBookingConflicts` (today it runs only at save) | S | `js/app.js` booking modals; save-time check stays as the hard gate. |
| 1.3 | ✅ 1.7.0 — **Per-instrument booking constraints** — min/max duration, minimum gap between bookings, minimum advance notice | M | Additive columns on `instruments` (`js/db.js` migration); enforced in `bookingSave`/`bookingEditSave`; surfaced in the live feedback from 1.2. |
| 1.4 | ✅ 1.7.0 — **Per-instrument resource timeline** (day/week lanes per instrument) | M | Builds on 1.1. |
| 1.5 | ✅ 1.7.0 — **Recurring bookings** — repeat weekly/n-weekly until a date; every occurrence conflict-checked individually | M | Lowest priority in the tier. |

## Tier 2 — Billing completeness

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 2.1 | ✅ 1.6.0 — **Grants table** — `grant name \| grant number \| allowed users`; bookings and projects pick a grant from a dropdown. A Settings toggle decides whether grants display by name or by number. Grant appears in Project Costs and all exports for reconciliation. | M | New table + join in `js/db.js`; pickers in `js/app.js`; each export path in `js/exports.js` updated separately (they share no field list). |
| 2.2 | ✅ 1.7.0 — **Configurable pricing tiers** — named price lists (e.g. internal / academia / industry) replacing the binary internal/external overhead pair. Each group/lab is assigned a tier; instrument and service rates can differ per tier. Existing internal/external percentages migrate into two default tiers. | L | Touches the cost calculator; cost snapshots stay frozen — existing bookings never recompute. |
| 2.3 | ✅ 1.7.0 — **Standalone service entries** — technician time, sample prep, per-unit items billable outside a booking; follow the Project Costs counting rule; appear in Reports and exports | M | Also feeds the time-mix report (3.4). |
| 2.4 | ✅ 1.6.0 — **Configurable cancellation rules** — make the before/after-start charge rule editable in Settings (per facility) | S | Rules currently hard-coded in `cancelBooking`. |

## Tier 3 — Reporting & contribution metrics

Motivation: the current staff-time report (worked vs. billed hours) reduces staff contribution
to money, which is the wrong headline metric for a core facility — the product is enabled
science, not revenue. Sporadic-but-sustained contributors, and staff on cheap-but-critical
pipelines, disappear in a single $ cell.

Design principle: **metrics are scoped on instruments, not on people.** The primary question is
"does this instrument justify holding it?", and the staff member is only a proxy via an
instrument→supervisor mapping — wider conclusions about a person come from connecting the dots
(e.g. most instruments under their supervision are under-utilized), never from a per-person
score. This also avoids a chilling effect on researchers: a per-person consulting log reads as
"every word is logged" and discourages people from approaching core staff.

**No standalone consult log.** A quick 1-minute question isn't worth logging anywhere; anything
substantive is either a sync (a "Meetings & Syncs" entry — recorded, unbilled) or a booking with
the core member's time billed retroactively and explained under notes. Both already exist in the
meeting/booking model, so no new entity is needed — reports only need to *recognize* consults
among meetings, hence the type tag below. Retroactive billed time inherits the 1-hour floor
(`UI.billableStaffHours`) — a stated policy, not a surprise on the invoice. A recurring pattern
with a specific user, the rare case worth remembering, is a sync entry with a note.

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 3.1 | ✅ 1.6.0 — **Consult type tag on meetings** — a category on the existing meeting entity (e.g. sync / consult / training / assisted session) so aggregations can count consults per instrument and per period without a new record type. Instruments already link via `meeting_instruments`; `project_id` is already nullable for pre-project consults. | S | Feeds 3.2, 3.3, 3.4. |
| 3.2 | ✅ 1.9.0 — **Instrument stewardship scorecard** — per-instrument justification view: utilization, distinct + new users, trained-user pool trend, projects served, consult-tagged meetings, downtime share. Designed to show *why* utilization is what it is, not one percentage — under-utilized ≠ unjustified (niche capability, backup unit, demand shift). A derived view groups scorecards by supervising staff member; explicitly dot-connecting, never a composite staff score. | M | Rendered from the single `js/reports.js` aggregation engine so screen and export can never disagree. Needs 3.6a. Shipped without the *trained-user pool trend* and *downtime share* columns — both need records Tier 4 introduces (4.3, 4.1); everything else in the item is live. |
| 3.3 | ✅ 1.9.0 — **Funnel analysis** — consult → project created → active (first booking) → milestones progressing → completed → research output. Conversion and time-in-stage per period. | L | Front of the funnel reads from consult-tagged meetings (3.1); the exit needs an "outputs" record (publication/acknowledgement) on projects; middle stages derive from existing timestamps. Shipped with one narrowing: conversion is reported at every stage, but time-in-stage is two medians (created → first booking, first booking → first output) over the selected range rather than one per adjacent transition per period. |
| 3.4 | ✅ 1.9.0 — **Breadth & activity-mix views** — distinct labs/people served and new labs onboarded per period, per instrument; facility activity split by category (assisted operation, training, consulting, maintenance) as a stacked view. Per-lab consult attribution is **opt-in**, not a default report column. | M | Shipped with two narrowings: the activity mix splits whatever categories are actually tagged on bookings, so a **maintenance** slice only becomes possible once Tier 4's downtime records exist (4.1); and new-lab counts are per period, with per-instrument newness reported as new *users* in 3.2's scorecard rather than new labs. |
| 3.5 | ✅ 1.9.0 — **Charts on the Reports screen** — utilization, funnel, activity-mix | M | Client-side rendering only. |
| 3.6a | ✅ 1.6.0 — **Instrument → supervising staff mapping** — who is responsible for each instrument (one or more staff). Prerequisite for the derived staff view in 3.2. | S | Join table or column on `instruments`; picker follows the existing "selectable = not retired OR already selected" rule. |
| 3.6 | ✅ 1.9.0 — **Custom report generator** — pick entity + columns + date range, rendered from the existing aggregation engine, exported via the existing XLSX path. Design goal stays "fewer, better reports", not a canned-report catalog. | L | |
| 3.7 | ✅ 1.6.0 — **Periodic local exports** — extend the existing auto-backup mechanism to also drop XLSX/JSON exports into the silent backup folder | S | Local reinterpretation of "scheduled exports". |

## Tier 4 — Operations

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 4.1 | **Downtime records** — one class with a `type` field (maintenance / repair / calibration / other), not separate downtime vs. maintenance concepts. Instrument, date range, type, notes; blocks new bookings in the range (extends `findBookingConflicts`); shows on the calendar. | M | |
| 4.2 | **Maintenance/service log per instrument, with file attachments** — vendor service reports are often paper; scanned PDFs/photos attach to log entries. A closed downtime record can link to a log entry. | M | Reuse the existing project-attachments pattern. |
| 4.3 | **Training/qualification records** — person × instrument with trainer, date, expiry. No auth exists locally, so this is **staff-facing signals, not enforcement** — which matches the early-adopter reality that core staff operate the app: booking-form warnings ("X's training on Y expired"), plus a **"training status unknown" flag** when a person with no training record on an instrument is added to a booking — covering the "did another staff member already train them?" gap, since all staff records live in the same facility database. | M | Feeds 3.2 (trained-user pool trend per instrument) and 3.4. |

## Milestone — Migration/import tool (important, not now)

Importers for data exported from commercial facility systems — **BookitLab** (service data
dump / per-page exports), **PPMS (Stratocore)**, and similar — mapping users, instruments,
bookings, grants/budget numbers into the tracker's schema. Client-side file parsing is feasible
with the already-bundled SheetJS (XLSX/CSV); no server needed. This is the **local** importer,
for a facility that stays on the local app. The server version has its own importers for the
same vendor files (rollout phase 6 in the proposal); the two share column mappings and nothing
else.

Honest caveats: column mappings depend on each vendor's export format and instance
configuration; building this requires real sample export files per system, and the mapping will
need per-facility review (names, rate structures, and grant formats will not line up 1:1).
[Unverified] Vendor export formats have not been inspected yet.

Concept notes for the plugin registry and the per-vendor importers: [docs/plans/extensions-and-importers-concept.md](docs/plans/extensions-and-importers-concept.md).

## Tier 5 — University-wide server version (separate track)

Nothing here ships in the local app, with one exception: 5.12 adds an "export for server" option
locally so the migration path exists. Everything else is a second codebase, an API server with
its own web client; the current app stays a standalone tool and a one-way import source, not a
client of the server. Described in full in the private university IT proposal. The shape
follows LabID (EMBL's open-source lab data platform: Django, PostgreSQL, permissions per group,
REST API, background workers) for the parts LabID has proven, and adds what it lacks: booking,
billing, and facilities as tenants. Two items are decisions for university IT, not code; they are
listed first because the rest waits on them. Effort labels are for the server codebase.

| # | Item | Effort | Why / how |
|---|------|--------|-----------|
| 5.0 | **IT decisions: single sign-on protocol and hosting** | — | Hundreds of users cannot have local accounts, so login must come from the university identity provider, and IT decides which protocol it exposes (SAML, OIDC, LDAP). Hosting decides where the database lives and who backs it up. Neither is code. Building 5.1–5.4 needs neither answer; the phase 1 pilot with real staff needs the host; phase 2, the first login by anyone outside the facility, needs SSO. |
| 5.1 | **API server with the money rules ported unchanged** | L | The one-hour floor, tier pricing, category policies, cancellation retention and frozen cost snapshots are the tested, trusted core of the app, and rewriting them would reintroduce bugs the unit tests already caught. Re-implement the rules behind `UI.billableStaffHours`, the cost calculator and `findBookingConflicts` as server-side domain logic that returns structured results, with the client doing the user-facing formatting (the browser versions are closures over the local database and display strings, so the rules port, not the functions), and carry the same test fixtures across (seed booking #1 must still produce 490 / 546.25 / 589.95). Django + Django REST Framework, one PostgreSQL database, following LabID's deployment layout (systemd, `.env`, Nginx). |
| 5.2 | **Facilities as tenants, labs as owners** | L | A university-wide install serves many facilities that must not see each other's rates or income, while a researcher should have one identity and one lab everywhere. Add a `facility` table owning instruments, staff, rate tiers and policies; people, labs, PIs and grants are shared. Every booking and standalone service entry resolves its owner in one order: the project's lab, else (bookings only) the lab/group named on the booking (`group_org`, which also drives its standing discount), else the facility (see 5.3). `service_entries` has no group field today, so a project-less service entry imports as facility-owned, matching current reports; the server adds an optional lab field for new ones. Labs are text names today (`people.organization`, `meetings.group_org`, `group_tiers.org`) and a project has only a `pi_id`, so the importer derives a project's lab from its PI, keeps a booking's own `group_org` as the billing attribution where it differs, writes mismatches and PI-less projects to a review list, and turns distinct names into `lab` rows with a merge tool; following LabID's "group owns its data library" model. The importer applies the same resolution and copies frozen cost fields verbatim so ownership, discounts and totals match the local app's reports. |
| 5.3 | **Roles and row-level permissions, enforced in the API** | M | Bookings and projects are visible to their lab's members; costs to facility staff, the owning PI, members the PI designates, and auditors; rates, tiers and policies to facility staff only. Roles give defaults and per-object sharing overrides them for projects and bookings, as LabID does with read/write/delete at user or group level, but money sits outside sharing entirely: cost fields are serialised through their own allow-list (facility staff, owning PI, PI-designated members, assigned auditors) regardless of how the reader came to see the record, and rates never leave facility staff. Records with no project and no group (valid today, `project_id` is nullable) are facility-owned and visible to facility staff and the people on them. Every check runs server-side on every request; the web page is never trusted. |
| 5.4 | **Atomic booking rules on the server** | M | The browser's `findBookingConflicts` covers instrument overlap, staff overlap, min/max duration, minimum gap and advance notice, and it is enough for one user; with hundreds, two requests pass it in the same second and both save. Run the same rule set inside one transaction that locks the affected instrument and staff rows in canonical order (type, then ascending id) with a lock timeout and one retry, so multi-resource bookings cannot deadlock. As a second line, keep a `reservations` table (resource type, resource id, date, time range, status) written in the same transaction and put PostgreSQL exclusion constraints on it for rows whose status holds capacity (confirmed and pending; see 5.7); the current join-table schema cannot carry that constraint because time and cancellation live on the booking row, so the reservation table is required. Gap and duration cannot be constraints, so the lock is what makes them atomic. Advance-notice and has-started checks evaluate in an explicit per-facility timezone, tested under `Asia/Jerusalem`. The browser's `findBookingConflicts` stays as the advisory that explains *why*; the transaction is the gate. |
| 5.5 | **Swappable authentication backend, SSO when IT provides it** | M | Local accounts get phase 1 running; university SSO is required for anyone outside the facility to log in. Follow LabID's pluggable auth-backend chain so local, LDAP and SAML/OIDC are configuration, not code changes. Map SSO group claims to labs where the identity provider releases them, otherwise PIs maintain a member list. |
| 5.6 | **Job runner and scheduler for email, reminders, digests, exports** | M | Sending mail inside a web request makes booking slow and fragile, and reminders need a clock. One worker process and a scheduler, using the university SMTP relay, replace the current `mailto:` hand-off with real confirmations, reminders and approval requests. LabID separates its workers the same way; we skip RabbitMQ and the multi-worker split until a measured need appears. |
| 5.7 | **Booking approval queue for restricted instruments** | M | Some instruments need staff sign-off before a new or untrained user's booking stands, and today that happens by email outside the system. A booking gets a `pending` state that holds its slot from the moment of request (its reservation row counts toward 5.4's constraints), so approval can never collide with a booking made meanwhile; approval re-runs the full rule set in its own transaction before flipping the status, and a decline releases the slot. Holds expire (facility-set maximum pending age and pre-start cut-off), released by the scheduler with notification and an audit entry. Staff approve or decline from a queue; the requester is notified by 5.6. The server has its own training/qualification model (person × instrument, trainer, date, expiry), mirroring Tier 4's 4.3 and imported from it where a facility migrates, so the queue shows training status from server data, not from the local app. |
| 5.8 | **iCal feeds and announcements** | S | People live in their own calendars, and a per-instrument or per-person feed URL removes the "is it free?" question. Read-only feeds with a per-user token, generated from the same bookings table. Announcements are a facility-scoped notice shown at login and included in the digest. |
| 5.9 | **Tamper-evident billing audit log** | M | Finance needs to prove a figure on an invoice was recorded when the system says it was, and that a post-start cancellation decision was not edited afterwards. Every write to a booking, cost or permission is logged with actor, time and before/after values; cost snapshots and cancellation decisions are additionally hashed and stamped through an RFC 3161 timestamp authority, the token stored with the record and verified on export. The authority endpoint (university-run, public, or IT-hosted fallback) is an open question for IT in the proposal and gates this item, not earlier ones. LabID's website advertises RFC 3161-compliant timestamping with a configurable authority URL; [Unverified] which records it stamps is not documented, so confirm before treating it as a proven pattern. |
| 5.10 | **SAP invoicing export** | M | The last mile of cost recovery is a file finance can load without retyping. Format, account and grant identifiers are defined with a named finance contact (proposal, section 6); the data model carries those identifiers from 5.2 onward so nothing needs backfilling. Reads from the same aggregation code as the Reports screen so an invoice can never disagree with the report. |
| 5.11 | **Project submission protocol between labs and the facility** | M | New projects arrive by email or corridor and get typed in by staff, losing the lab's own description and the audit trail of what was agreed; for long-running work this is the start of a collaboration that should be documented from day one. A lab submits a project request with PI, grant, aims, sample types and instruments, using the same project template the facility works with; the facility reviews, edits and accepts it, which creates the project, and both sides work on that one record from then on. Reuses the approval mechanics of 5.7. This is the horizontal lab-to-facility channel the proposal calls a scientific communication system. |
| 5.12 | **Current app as standalone tool and import path** | S | The local app keeps working for a single facility that never joins, and its JSON backup becomes the one-way migration route onto the server. Add an importer on the server for the existing backup format, including the embedded attachment blobs `DB.buildBackup` carries (moved into server file storage with `files.path` rewritten, counted in the parity check), and an "export for server" option locally; the pre-security-review pilot runs on synthetic fixtures (demo dataset plus generated bookings), never on a derived copy of real data. It is not a synchronising client: no pull path, identity mapping or conflict handling back from the server is planned. Nothing in Tiers 1–4 is thrown away. |
| 5.13 | **Contribution record for facility staff** | M | Facility scientists are measured by their contribution to research, and today the only accepted proof is authorship on papers. The project record already links staff to bookings and milestones, and `project_outputs` records outputs at project level only (no person on an output); the server adds a new relation, a contribution entry per person per project (role, period, what was done, linked outputs) that the PI confirms, and an export per person suitable for a promotion or evaluation file. Reads from the same aggregation code as the stewardship scorecard so a person's record and the facility's reports cannot disagree. |
| 5.14 | **Institutional oversight views** | M | University management needs a continuous picture across facilities: service volume, utilisation, outputs, cost recovery, equipment state; today that picture is assembled by hand from several systems. A cross-facility view scoped by permission (university admin and assigned auditors), built from the existing report aggregations rolled up per facility, with no access to a lab's finances unless granted. Includes external-user activity as its own slice, since external service is billed and reported separately. |

Rollout is phased in the proposal (single facility on local accounts → SSO and labs →
notifications → second facility → finance → open enrolment), each phase ending with something a
facility actually uses. 5.13 and 5.14 belong to the second-facility phase and later: both need
more than one facility's data to be worth building.

---

## How these get built (conventions from the 1.6.0–1.8.0 batches)

Each batch so far was built by a sequential multi-agent workflow (Claude Code), one item at a
time on a working branch, with per-item gates before each commit: an adversarial code review
against CLAUDE.md's hard rules, plus a Playwright pass on a fresh profile under
`TZ='Asia/Jerusalem'` (a served copy, demo data loaded, the item's flow exercised end-to-end).
Feature commits never bump versions; one finalize commit bumps `?v=` (index.html + sw.js),
`APP_VERSION`, and turns the accumulated `## [Unreleased]` CHANGELOG section into the release
heading. The PR then goes through Copilot review rounds — findings verified against the code
before fixing, threads resolved, re-review requested — until findings degrade to nits; merge,
dispatch the `Release` workflow, then a docs-only follow-up updates `docs/index.html`'s
hand-written sections with verified screenshots (numbering is sequential; check the highest in
`docs/screenshots/` first).

Invariants every batch must protect (all bitten or nearly bitten before):
- Seed booking #1's cost triple **490 / 546.25 / 589.95** (documented in `js/db.js`) must survive
  any pricing change — the legacy internal+external fallback exists for exactly this.
- Cost snapshots are frozen: only save paths write money; an edit-and-save reprices at current
  rules (all inputs together), untouched rows never change.
- `findBookingConflicts` returns display strings and is the single home for scheduling rules —
  the live advisory, both save gates, reinstate, and recurring pre-checks all inherit from it.
- Every advisory must mirror its save gate's bypasses (`skipNotice`, `skipRequiresStaffCheck`),
  or it lies.
- New org-keyed settings tables must be added to `DB.renameOrganization`; settings tables stay
  out of `clearAllData`; data tables go into it plus the ref-counters and delete paths.

Housekeeping for every implemented item: bump `?v=` in `index.html` **and** `sw.js`
(`CACHE_VERSION`, `PRECACHE_URLS`), bump `APP_VERSION` in `js/consts.js`, add a `CHANGELOG.md`
entry, and update each of the XLSX/DOCX/PDF export paths that the item's data should appear in —
they are separate code paths, not driven from one field list.
