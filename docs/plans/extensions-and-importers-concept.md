# Extensions and importers — concept document

Status: concept / not implemented. No code in this repository implements any of the
mechanisms described below; this document exists so a future task has a shared starting
point instead of re-deriving these constraints from scratch. Nothing here should be read
as "planned for the next release."

## Why this document

The Migration/import tool milestone in `ROADMAP.md` names two concrete vendor sources —
BookitLab and PPMS (Stratocore) — and leaves "how do we actually write one of these
importers, and where does its code live" unanswered. Before any importer gets written,
two questions need answers that apply to *every* importer, not just the first one:

1. What is an extension even allowed to do, given this app has no server, no accounts,
   and no secrets store? (See "What an extension can and cannot do" below.)
2. Where does an importer's code live, how does it get invoked, and what does it get
   access to? (See "Proposed registry" below.)

This document proposes answers to both, sketches what each named vendor importer would
need to do, and maps vendor data onto this app's existing tables so a future importer
task can be scoped without re-reading the whole schema. It is intentionally conservative:
where a claim depends on a vendor's actual export format, or on a browser API this app
has never called, it is marked `[Unverified]` rather than asserted as fact.

## What an extension can and cannot do in a client-only PWA

`CLAUDE.md` states the constraint this whole document works within: "There is no
backend, no server, no accounts/auth." Every idea below has to survive being run
entirely inside one browser tab, with no code executing anywhere else.

**Possible, because the browser itself can do it:**

- **File in / file out.** The app already bundles SheetJS (`js/exports.js` uses it for
  XLSX generation) and the browser's `File`/`FileReader`/`Blob` APIs need nothing else.
  An importer reads a vendor's exported XLSX/CSV file the person picks with a file input,
  parses it client-side, and writes rows into the same `sql.js` database every other
  screen writes to. Export follows the same pattern in reverse: build a `Blob`, trigger a
  download — exactly what `Exports.exportReportsXlsx` and friends already do.
- **`mailto:` hand-off**, the same pattern the "Email Attendees" feature already uses:
  compose a message and open the user's own mail client rather than sending mail from
  the app, because the app has no mail-sending capability of its own and no server to
  hold SMTP credentials.
- **In-browser OAuth (PKCE) against a public client id.** A flow like Google's
  authorization-code-with-PKCE grant needs no client secret — the "secret" that a
  traditional OAuth confidential client would hold server-side is replaced by a
  per-session code verifier the browser generates itself. This is why a Google Calendar
  two-way sync extension is even conceivable client-side: the token exchange only needs
  a public client id, redirecting back to a page this app can serve. `[Unverified]`
  whether Google's current OAuth policies allow a PKCE public client to reach the
  Calendar API scopes this would need without additional verification steps (app
  verification / a consent screen review) that a per-facility deployment would have to
  complete once.

**Not possible, because nothing survives when the tab closes:**

- Anything needing a **server-held secret** — a vendor API key or client secret that
  must never appear in browser-shipped JS, a webhook signing secret, anything that
  can't be a PKCE public client. `CLAUDE.md`'s "no backend" rule is explicit that adding
  a real backend/API key is "a major, explicitly-avoided architecture change," not a
  small addition.
- **Push notifications from a remote trigger.** A PWA can show notifications the tab
  itself schedules while the browser process is alive, but there is no server to push
  from and no guarantee the tab or browser is even running.
- **Scheduled jobs while the tab is closed.** There is no cron, no background sync
  worker with server backing — a service worker's background sync APIs still require the
  browser to wake it, and this app runs no server endpoint for it to sync against.
- **Server-to-server sync** of any kind — two facilities' installations, or this app and
  a vendor's own backend, cannot talk to each other directly; every exchange has to be
  mediated by a file a human moves, or by the browser tab making a direct client-side
  API call while it happens to be open.

The practical shape this leaves: an extension either moves a **file** through the
person's hands, hands off to something already on their device (`mailto:`), or makes
**live API calls only while the tab is open**, using credentials a public OAuth client
can hold safely. Anything that needs to happen unattended, or needs a secret, is out of
scope for a client-only extension and would need the same "major, explicitly-avoided"
backend this app has deliberately not built.

## Proposed registry: `window.Plugins.register`

A plugin is a plain `<script>` tag loaded **after** `app.js` in `index.html` — it needs
`DB`, `UI`, `Views` and `App` to already exist on `window`, the same load-order
constraint every existing `js/*.js` file already follows (see `CLAUDE.md`'s "Module
layout"). Nothing about the proposal changes that ordering rule; a plugin script is just
one more entry appended to the end of the existing chain, gated behind whatever the
Settings screen's "Extensions" affordance ends up being (a dev flag, a manual script
tag added per facility, or a future file-based loader — out of scope for this document).

Shape:

```js
window.Plugins = window.Plugins || { _registry: [], register(p) { this._registry.push(p); } };

Plugins.register({
  id: 'bookitlab-importer',       // stable, used as a dedupe/storage key
  name: 'BookitLab Importer',     // shown on the Extensions card
  kind: 'importer',               // 'importer' | 'sync' | 'exporter'
  run(ctx) {
    // ctx = { DB, UI, Views, App }
    // ... do the work, using ctx.DB.run/rows exactly like app.js does ...
    return { summary: 'Imported 42 bookings, 3 skipped (duplicates).' };
  },
});
```

- **`id`** is the plugin's stable identity — used if the plugin needs to remember
  anything per-install (e.g. a Google Calendar sync token) via `UI.storage`, namespaced
  under the id so two plugins can't collide.
- **`kind`** is purely descriptive for the Settings card (a badge/icon), not an
  enforcement mechanism — an importer and a sync plugin both just implement `run`.
- **`run(ctx)`** receives the same objects every other part of the app already uses:
  `DB` for reads/writes (`DB.run`, `DB.rows`, `DB.row`, the retire/archive/cancel helpers
  described in `CLAUDE.md`), `UI` for toasts/modals/`UI.today()`/`UI.ymd()`, `Views` if the
  plugin wants to reuse an existing renderer, and `App` for the action dispatcher or any
  exposed CRUD helper (e.g. a shared booking-save routine, if one is exposed for reuse).
  `run` is free to be `async` — the card below awaits it either way.
- **`run`'s return value** is a plain object the Extensions card renders, minimally
  `{ summary: string }`, optionally more detail (counts, a list of skipped rows) the
  card can expand into a `<details>` block. It should not assume anything about *how*
  it's rendered — that's the card's job, not the plugin's.

A Settings → **Extensions** card (a new panel in the existing Settings screen, styled
like other Settings cards) lists everything in `Plugins._registry`: name, kind badge, a
**Run** button per entry. Clicking Run calls that plugin's `run({DB, UI, Views, App})`,
shows a spinner via the existing toast/modal patterns while it's in flight, and on
return renders the summary object inline under that plugin's row (or via `UI.toast` for
a one-line result). No plugin runs automatically or on a schedule — see "not possible"
above; every run is a person clicking the button, once, while the tab is open.

## Importer notes per target

None of the vendor-specific detail below has been validated against a real export file
from any of these systems. Everything vendor-specific is `[Unverified]`.

### PPMS / Stratocore

`[Unverified]` PPMS/Stratocore's admin exports are commonly CSV or XLSX with one row per
booking/session and separate exports for the user list, instrument/system list, and
project/grant list — but the actual column names, encoding, and whether a single combined
export or several per-entity exports is offered depends on the facility's PPMS
configuration and has not been inspected here. An importer for this system would need at
minimum: a users file (name, email, lab/organization, PI), a systems/instruments file,
and a bookings/sessions file (user, system, start, end, project/grant reference). Cost
figures, if present, would need mapping onto the frozen booking cost columns (see "Dates
and money" below) rather than assumed to already match this app's billing calculator's
output.

### BookitLab

`[Unverified]` BookitLab's "service data dump / per-page exports" (as `ROADMAP.md`
already describes them) are assumed to be page-by-page CSV/XLSX exports rather than one
combined file, based on how the roadmap entry characterizes them — this has not been
confirmed against an actual BookitLab export. An importer would likely need to join
several such per-page files by an internal BookitLab id before it can build one
`meetings` row per booking, since a single page's export may not carry every field
(attendee, instrument, cost) that this app's `meetings` row needs at once.

### Zoom exports

`[Unverified]` A "Zoom export" most plausibly means the meeting/webinar report CSV Zoom
account admins can download (topic, start/end time, host, participant list) rather than
anything richer — but no such file has actually been inspected for this project, so
column names and whether participant emails are included at all is unverified. If usable,
this would map onto `meetings` as a booking record without natural billing data (Zoom has
no concept of a facility's instrument/cost model), so an imported Zoom session would need
either a manual cost entry afterward or would legitimately import with zero cost.

### Google Calendar two-way sync

`[Unverified]` This is the one target sketched as a live sync rather than a one-shot file
import, since Google's Calendar API is reachable from a PKCE-authenticated browser tab
(see "What an extension can and cannot do" above) without a server. The shape:

- Auth via PKCE against a public OAuth client id, token kept in memory for the session
  (not persisted long-term in `UI.storage`, since a stolen `localStorage`/IndexedDB blob
  would otherwise carry a live calendar credential — `[Unverified]` exact refresh-token
  handling, since it depends on what scopes and consent screen review Google's current
  policy requires for a per-facility public client).
- Incremental pulls using the Calendar API's sync-token mechanism: after an initial full
  `events.list`, the response's `nextSyncToken` is stored (namespaced under the plugin's
  `id`) in `UI.storage`; every subsequent pull passes that token and Google returns only
  what changed since, rather than the importer re-scanning the whole calendar every run.
- Our bookings pushed as Calendar events carry a **private extended property**
  (`event.extendedProperties.private`) holding the source `meetings.id`, so a later pull
  of that same event can be matched back to the booking it came from instead of creating
  a duplicate — the same duplicate-avoidance principle as "match on external id" below,
  just carried in Google's own extended-property field instead of a column in this app's
  schema.
- `[Unverified]` Whether a two-way sync should let an edit made in Google Calendar flow
  back and mutate a `meetings` row automatically, or only surface as a suggested change a
  person confirms — this app has no notion of "trusted external write," and given the
  "History is preserved" rules in `CLAUDE.md` (retire/archive, never delete), an automatic
  external overwrite of a booking's join-table rows deserves real design attention before
  it is built, not just wired up because the API allows it.

## Mapping onto existing entities

An importer's job, regardless of source, is producing rows in these tables — a plugin
should not invent parallel tables for data that already has a home:

- **People / labs** → `people` rows, with `people.organization` set to the lab/PI group
  name. A new organization name should also get a row in the `vocab` table under category
  `ORG` (the same table `DB.orgNames()`/the "+ Add New" picker flow already reads), so it
  shows up as a normal selectable organization rather than a one-off string that only
  this one imported person happens to have.
- **Instruments** → `instruments` rows, with `instruments.cost_unit` set to whatever unit
  the vendor's billing model uses (this app's existing `cost_unit` column already
  supports a small fixed set of units — an importer should map onto one of those rather
  than invent a new unit string the rest of the app's billing calculator doesn't know).
- **Bookings** → `meetings` rows, **plus** the three join tables that make a booking real:
  `meeting_people` (attendees), `meeting_instruments`, and `meeting_staff` — written
  together with the denormalized `meetings.attendees` display string, exactly the pattern
  `bookingSave`/`bookingEditSave` already follow in `js/app.js`. An importer that writes
  `meetings.attendees` without the matching `meeting_people` rows reproduces the exact
  seed-data bug `CLAUDE.md` documents under "The database is relational" — every
  join-based feature (billing per attendee, training checks, the Email Attendees
  feature) would silently see zero attendees on an imported booking.
- **Grants** → `grants` rows and `grant_users` join rows, so a grant imported from a
  vendor's project/budget export is immediately usable by the existing grant-based
  billing/reporting paths rather than a bare label nothing else can query.
- **Training** → `person_instrument_training` rows, using this app's existing two levels
  — `Regular` and `Super User` — rather than inventing new level strings. A vendor's own
  training/qualification levels (if it has any) would need mapping onto this two-level
  set; anything that doesn't cleanly map (e.g. a vendor's intermediate tier) should be
  a deliberate, documented decision per importer rather than silently collapsed.

## Duplicate and conflict rules

Running the same import twice (a facility re-exports and re-runs an importer to catch
new bookings since last time) must not create duplicate rows or duplicate join entries.
Proposed rules:

- **Match on an external id.** Every imported row from a given vendor should carry that
  vendor's own id for the record, kept either in a new nullable column on the relevant
  table (e.g. an `external_id`/`external_source` pair) or in a separate plugin-owned
  mapping table (`external_id`, `source`, `local_table`, `local_id`) if adding columns to
  core tables is undesirable for tables an importer doesn't own. Either way, a re-import
  looks up the external id first and updates/skips rather than blindly inserting.
- **Reuse `findBookingConflicts` before inserting a booking.** This app already has one
  function that decides whether an instrument slot is free — an importer creating
  `meetings` rows must call it before insert exactly as the booking modal does, rather
  than writing a second copy of the same conflict logic that could disagree with it.
  `CLAUDE.md` already warns against forking a second copy of scheduling/cost logic; an
  importer is not exempt from that rule just because it runs once instead of from a form.
- **Cancelled bookings free the slot.** `findBookingConflicts` already filters on
  `m.is_cancelled = 0` — an importer reconciling a vendor's own cancellation status
  should set `is_cancelled`/`cancelled_at` on the local row rather than deleting it, so
  the slot becomes bookable again through the same mechanism a manual cancellation uses.
- **Never delete on re-import.** If a vendor export no longer lists a person, instrument
  or booking that a previous import created, the correct action is the same the rest of
  the app already uses for that entity: retire the person/instrument, or cancel the
  booking — never a hard delete, per "History is preserved" in `CLAUDE.md`. The
  zero-references-only-delete rule (`DB.countPersonRefs`/`countInstrumentRefs`/
  `countProjectRefs`/`countBookingRefs`) applies to importer-created rows exactly as it
  does to manually-created ones.

## Dates and money

- **External timestamps become local calendar days via `UI.ymd`, never
  `toISOString().slice(0, 10)`.** Every date column this app has (`meetings.date`,
  `milestones.due_date`, …) is a local calendar day string, and `CLAUDE.md` documents
  exactly why the UTC-instant conversion is wrong (issue #14: it silently returns the
  previous day east of Greenwich). A vendor export's timestamp — whatever timezone or
  format it arrives in — must be converted with `UI.ymd()` (or parsed into local fields
  directly), not with a `Date`-to-ISO-string shortcut, and any such conversion needs
  the same `TZ='Asia/Jerusalem'` verification `CLAUDE.md` requires for date logic.
- **Totals: import verbatim, or recompute — state the trade-off, don't silently pick
  one.** A vendor export may carry its own computed cost per booking. Two options:
  - **Import the vendor's total verbatim** into this app's frozen cost columns (the same
    columns a saved booking's cost snapshot already occupies). This preserves the
    vendor's own billing record exactly, including any vendor-side discount or rate this
    app's calculator doesn't know how to reproduce — but the number is no longer
    reproducible from this app's own rate/duration inputs, so a later "why is this
    booking's total X" question has no local answer.
  - **Recompute via the same BOM (bill-of-materials) path `seedBooking` uses** — i.e. run
    the imported duration/instrument/staff data through this app's own cost calculator,
    the same one `UI.billableStaffHours`/the booking modal use — so the imported booking's
    total is internally consistent with every other booking in the database and
    reproducible from its own recorded inputs. The cost of this choice: it can disagree
    with what the vendor actually billed, if the vendor's rate structure or rounding
    differs from this app's own (the 1-hour floor, rounding-up rule this app applies via
    `UI.billableStaffHours`, for instance, may not match the vendor's own rounding).

Either choice is defensible; an importer task should pick one deliberately per vendor
and say so in its own notes, rather than have the choice fall out accidentally from
whichever field an author happened to read first.

## Open questions

- Where does a plugin script file actually live and how does a facility install one —
  a manual `<script>` tag added to a local `index.html` copy, a small facility-maintained
  fork, or a future "paste a URL" loader? This document assumes "a script tag after
  `app.js`" but not how that tag gets there.
- Should `Plugins.register` support more than one `run` per plugin (e.g. a `preview` step
  that reports what *would* change before a person commits to a `run` that writes rows)?
  A dry-run mode seems valuable for a first-time import against unfamiliar vendor data,
  but is not sketched here.
- Does an external-id column belong on core tables (`meetings`, `people`, `instruments`)
  as a first-class nullable column, or in a separate plugin-owned mapping table? The
  former is simpler to query; the latter keeps vendor-specific concerns out of the core
  schema `CLAUDE.md` describes. No decision is made here.
- How does a facility revoke a Google Calendar sync's stored token/sync-state if they
  stop wanting the integration — is clearing the relevant `UI.storage` keys enough, or
  does the token also need explicit revocation against Google's own endpoint?
- Should the Extensions card in Settings gate plugin visibility behind Admin Mode (the
  same gate `CLAUDE.md` describes for billing-affecting decisions like cancellation
  waivers), given an importer can write cost/billing data directly? Not decided here.
- What happens when an importer's `run()` throws partway through a batch of inserts —
  does it need to run inside a single transaction so a partial failure can't leave the
  database half-imported, and does `DB` currently expose a transaction primitive a
  plugin could use for that? Not investigated as part of this document.
