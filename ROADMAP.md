# Roadmap — Core Facility Tracker (local, single-user scope)

Derived from the BookitLab (HUJI) feature comparison
(`docs/proposal/bookitlab-comparison.md` on the `claude/university-it-approval-email-677j2n`
branch; not on `main`). This roadmap deliberately keeps **only what a 100% client-side,
single-user app can deliver** — no server, no auth, no email sending, no finance-system
integration. Everything multi-user or server-bound stays in the pilot proposal, not here.

Effort labels (S/M/L) are rough estimates, not measurements. No dates are promised.
Ordering within a tier is the intended build order, but items are independent unless noted.

---

## Tier 1 — Scheduling depth

The clearest UX gap vs. BookitLab that is purely client-side.

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 1.1 | **Week calendar view** — hourly grid alongside the existing month view | M | New renderer in `js/views.js`; same booking data, same click-to-book. Test under a UTC+ timezone (see CLAUDE.md date rules). |
| 1.2 | **Live conflict feedback** in the booking modal — as-you-type, reusing `findBookingConflicts` (today it runs only at save) | S | `js/app.js` booking modals; save-time check stays as the hard gate. |
| 1.3 | **Per-instrument booking constraints** — min/max duration, minimum gap between bookings, minimum advance notice | M | Additive columns on `instruments` (`js/db.js` migration); enforced in `bookingSave`/`bookingEditSave`; surfaced in the live feedback from 1.2. |
| 1.4 | **Per-instrument resource timeline** (day/week lanes per instrument) | M | Builds on 1.1. |
| 1.5 | **Recurring bookings** — repeat weekly/n-weekly until a date; every occurrence conflict-checked individually | M | Lowest priority in the tier. |

## Tier 2 — Billing completeness

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 2.1 | **Grants table** — `grant name \| grant number \| allowed users`; bookings and projects pick a grant from a dropdown. A Settings toggle decides whether grants display by name or by number. Grant appears in Project Costs and all exports for reconciliation. | M | New table + join in `js/db.js`; pickers in `js/app.js`; each export path in `js/exports.js` updated separately (they share no field list). |
| 2.2 | **Configurable pricing tiers** — named price lists (e.g. internal / academia / industry) replacing the binary internal/external overhead pair. Each group/lab is assigned a tier; instrument and service rates can differ per tier. Existing internal/external percentages migrate into two default tiers. | L | Touches the cost calculator; cost snapshots stay frozen — existing bookings never recompute. |
| 2.3 | **Standalone service entries** — technician time, sample prep, per-unit items billable outside a booking; follow the Project Costs counting rule; appear in Reports and exports | M | Also feeds the time-mix report (3.4). |
| 2.4 | **Configurable cancellation rules** — make the before/after-start charge rule editable in Settings (per facility) | S | Rules currently hard-coded in `cancelBooking`. |

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
| 3.1 | **Consult type tag on meetings** — a category on the existing meeting entity (e.g. sync / consult / training / assisted session) so aggregations can count consults per instrument and per period without a new record type. Instruments already link via `meeting_instruments`; `project_id` is already nullable for pre-project consults. | S | Feeds 3.2, 3.3, 3.4. |
| 3.2 | **Instrument stewardship scorecard** — per-instrument justification view: utilization, distinct + new users, trained-user pool trend, projects served, consult-tagged meetings, downtime share. Designed to show *why* utilization is what it is, not one percentage — under-utilized ≠ unjustified (niche capability, backup unit, demand shift). A derived view groups scorecards by supervising staff member; explicitly dot-connecting, never a composite staff score. | M | Rendered from the single `js/reports.js` aggregation engine so screen and export can never disagree. Needs 3.6a. |
| 3.3 | **Funnel analysis** — consult → project created → active (first booking) → milestones progressing → completed → research output. Conversion and time-in-stage per period. | L | Front of the funnel reads from consult-tagged meetings (3.1); the exit needs an "outputs" record (publication/acknowledgement) on projects; middle stages derive from existing timestamps. |
| 3.4 | **Breadth & activity-mix views** — distinct labs/people served and new labs onboarded per period, per instrument; facility activity split by category (assisted operation, training, consulting, maintenance) as a stacked view. Per-lab consult attribution is **opt-in**, not a default report column. | M | Training category needs Tier 4; consulting needs 3.1. |
| 3.5 | **Charts on the Reports screen** — utilization, funnel, activity-mix | M | Client-side rendering only. |
| 3.6a | **Instrument → supervising staff mapping** — who is responsible for each instrument (one or more staff). Prerequisite for the derived staff view in 3.2. | S | Join table or column on `instruments`; picker follows the existing "selectable = not retired OR already selected" rule. |
| 3.6 | **Custom report generator** — pick entity + columns + date range, rendered from the existing aggregation engine, exported via the existing XLSX path. Design goal stays "fewer, better reports", not a canned-report catalog. | L | |
| 3.7 | **Periodic local exports** — extend the existing auto-backup mechanism to also drop XLSX/JSON exports into the silent backup folder | S | Local reinterpretation of "scheduled exports". |

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
with the already-bundled SheetJS (XLSX/CSV); no server needed.

Honest caveats: column mappings depend on each vendor's export format and instance
configuration; building this requires real sample export files per system, and the mapping will
need per-facility review (names, rate structures, and grant formats will not line up 1:1).
[Unverified] Vendor export formats have not been inspected yet.

## Out of scope for the local app

These stay in the pilot proposal (server + SSO + SAP), not this roadmap: multi-user operation
and roles, institutional SSO, booking approval queues, automated email notifications, SAP
invoicing, server-side audit log, project submission protocol between labs and the facility,
live iCal feeds (a downloadable `.ics` export could be a small local substitute), announcements.

---

Housekeeping for every implemented item: bump `?v=` in `index.html` **and** `sw.js`
(`CACHE_VERSION`, `PRECACHE_URLS`), bump `APP_VERSION` in `js/consts.js`, add a `CHANGELOG.md`
entry, and update each of the XLSX/DOCX/PDF export paths that the item's data should appear in —
they are separate code paths, not driven from one field list.
