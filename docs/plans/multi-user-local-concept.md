# Multi-user without external hosting — concept document

Status: concept / not implemented. No code in this repository implements any of the
mechanisms described below. This document exists so a future task has a shared starting
point instead of re-deriving these constraints from scratch. Nothing here should be read
as "planned for the next release."

Register note: like `extensions-and-importers-concept.md` alongside it, this is a
developer-facing document, not facility-manager prose. It is referenced from engineering
work, not from `docs/index.html` or the manual.

## Why this document

`ROADMAP.md` puts everything multi-user in **Tier 5** and defines it as "a second
codebase, an API server with its own web client," hosted wherever university IT decides.
That is the right answer for a university-wide install serving hundreds of users across
many facilities. It is not the only answer, and it is not the answer to a narrower
question that keeps coming up:

> Can two or three people in *this* facility use this app on their own machines, with a
> record of who changed what, without anything being hosted outside the facility?

The phrase "multi-user" and the phrase "hosted elsewhere" are separable, and Tier 5
bundles them. This document unbundles them: it identifies what the current codebase
already has that makes a local multi-user mode cheaper than expected, names the one
schema property that blocks the obvious approach, and sketches three designs with honest
effort and honest limits. It deliberately does **not** pick one, because the choice
depends on facility facts that are not in this repository (see "Open questions").

Where a claim is verified against the code it cites a file and line. Where it depends on
browser behaviour this app has never exercised, or on the facility's own setup, it is
marked `[Unverified]` or `[Inference]` rather than asserted.

## What the app already has

The single-writer problem was already solved once, for a narrower case, and the solution
generalises. `js/db.js:950-1080` is a leader-election protocol that stops two browser
tabs on the same database from overwriting each other. Read as a distributed-systems
artifact rather than a tab guard, it already provides:

- **One write chokepoint.** `run()` (`js/db.js:1909`) is the only path by which rows
  mutate on a user's behalf, and it calls `assertWritable()` (`js/db.js:1385`) before
  touching anything. In the whole file `assertWritable()` has exactly four call sites —
  `restoreBackup()`, `run()`, `transaction()` and `clearAllData()` — so a write that must
  be refused can be refused in one place.
- **Multi-statement grouping.** `DB.transaction(fn)` wraps the several
  delete-then-insert statements that make up one logical save, with the documented
  requirement that `fn` be synchronous and span no `await`.
- **A read-only mode already wired to the UI.** `onMultiTabState(readOnly, opts)`
  (`js/app.js:41`) renders a persistent banner. A user demoted to reader looks, to the
  rest of the app, exactly like a tab demoted to reader — the messaging and refusal paths
  exist.
- **Reload-before-promote.** When a reader becomes the writer, `db` is reloaded from
  storage *first* and the in-memory copy discarded, because the in-memory copy is stale
  but provably not divergent (it was read-only). Writes stay blocked for the whole async
  gap.

Two further facts matter for any sync design:

- **Attachments are stored separately from the database.** The SQLite image lives under
  `core.db`; attachment blobs live under `uploads:*` (`js/db.js:269-270`). The thing a
  sync design has to move is therefore just the database file, with attachments as an
  independent, mostly-append-only concern. `[Inference]` that image is small for a
  realistic facility — hundreds of KB to a few MB — but this has not been measured
  against real data.
- **Timing is already known.** The autosave debounce is 400 ms (`js/db.js:1463`) and
  `SAVE_IDLE_TIMEOUT_MS` is 5000 ms (`js/db.js:1429`). Any lease interval has to be
  chosen against these, not in the abstract.

What the app does **not** have: any notion of an actor. No table carries `created_by` or
`updated_by`, and there is no audit trail. Identity is entirely absent, which is why
option C below is independent of the other two.

## The blocker: every table mints its own ids

Thirteen tables declare `id INTEGER PRIMARY KEY AUTOINCREMENT` — `projects`, `people`,
`grants`, `instruments`, `milestones`, `meetings`, `files`, `kv`, `vocab`,
`pricing_tiers`, `service_entries`, `project_outputs`,
`person_instrument_training` — and nine join tables carry composite primary keys
referencing them (`grant_users`, `project_people`, `project_instruments`,
`instrument_staff`, `milestone_owners`, `milestone_instruments`, `meeting_people`,
`meeting_instruments`, `meeting_staff`).

This closes off the approach most people reach for first — let everyone edit their own
copy and merge afterwards. Two people working independently both create a project and
both get id 8. Merging their databases does not produce two projects; it produces one
project with the other's team members, instruments and milestones attached to it. The
damage is not limited to the colliding row, because the references point at the id, not
the record.

It is worse than ordinary data loss for this app specifically. Bookings carry **frozen
cost snapshots** whose stored figures were computed against particular instrument and
person ids at a particular set of rates. A merge that silently re-points those references
changes what a saved invoice means, with no error and nothing on screen to notice. The
unit tests pin seed booking #1 at 490 / 546.25 / 589.95 precisely because those numbers
are load-bearing.

So: **no design below may ever merge two databases that minted ids from the same
counter.** Any design that wants concurrent editing has to make collisions impossible up
front rather than resolve them later.

## Foundation: disjoint id ranges per device

The fix is to stop every device minting from the same counter. SQLite's `AUTOINCREMENT`
counter per table is a row in `sqlite_sequence`, and it can be seeded. Give each device a
block:

- device 1 → ids 1 to 999,999
- device 2 → ids 1,000,000 to 1,999,999
- device 3 → ids 2,000,000 to 2,999,999

Then no two devices can ever produce the same id for the same table, references stay
valid across a merge, and the frozen-cost problem above disappears — not because it is
handled, but because it cannot arise.

There is precedent for touching this table: `js/db.js:561` already reads
`SELECT seq FROM sqlite_sequence WHERE name='pricing_tiers'`, with a `try`/`catch`
because `sqlite_sequence` does not exist until the first `AUTOINCREMENT` insert happens.

Three design notes:

- **Device identity belongs in `localStorage`, not in the database.** `app_config`
  (`js/db.js:2068-2079`) is inside the database image, so anything stored there travels
  to every device on the next sync — which is exactly wrong for "which device am I."
  Per-device state has an existing home and an existing precedent: `UI.storage`, where
  `admin-mode` already lives.
- **This is worth adding even if nothing else here is built.** It is an additive
  migration plus one setting, it is invisible in single-user use, and it is what keeps
  options B and C viable. Retrofitting it after two devices have independently created
  overlapping records means rewriting ids across 22 tables, which is the expensive
  version of this task.
- **A range is a budget, not a guarantee.** A million ids per table per device is
  `[Inference]` far beyond a facility's lifetime volume, but the exhaustion case should
  fail loudly rather than wrap into the next device's block.

## Option A — Write lease against a server on the facility's own machine

Replace the storage layer for the `core.db` key only: instead of `idbGet`/`idbSet`
against IndexedDB, `GET`/`PUT` against a small server process on the facility's own
machine. Colleagues open the app from that machine over the LAN. Nothing leaves the
building; the "host" is a PC in the facility.

Then generalise the existing election. The tab guard computes a leader from
BroadcastChannel announcements; the multi-device version asks the server, which hands out
one write lease at a time. Everything downstream — `assertWritable()` refusing the write,
the read-only banner, reload-before-promote — is already built and already tested against
the tab case.

**Concurrency limit, stated plainly:** one person edits at a time. Everyone else reads.
Making the lease short and releasing it on idle turns this into "whoever is actively
typing holds it," which for a handful of staff who rarely edit the same screen in the
same minute is `[Inference]` adequate — but it is a real limit, not a technicality, and
if two people do booking intake simultaneously they will feel it every day.

### The lease renewal arithmetic, explained

This is the one piece of arithmetic in the design where getting the numbers wrong causes
silent data loss, so it is worth spelling out for a reader who does not work on
distributed systems.

A lease is permission to write that **expires on its own**. The server records "device 2
may write until 10:31:30" and refuses to give anyone else permission until that moment
passes. The holder keeps it alive by asking for an extension before it runs out. This is
a car park ticket: you have paid until a certain time, and you must return to feed the
meter before that time, not after.

Two numbers have to be chosen: how long a lease lasts (call it the **lease length**) and
how often the holder asks to extend it (the **renewal interval**).

The temptation is to renew just before expiry — a 30-second lease renewed at 25 seconds.
That is the dangerous choice. A renewal is a request over a network; it can be slow, and
it can be lost. If the renewal at 25 seconds goes missing, the lease expires at 30, the
server hands write permission to somebody else at 31 — and the first person's browser,
which has heard nothing back either way, still believes it holds the lease. Now two
people write. One person's work is overwritten with no error and no warning, which is
precisely the failure the tab guard was built to eliminate.

Getting this right means separating two things that are easy to conflate: how much room
there is to **retry** a renewal, and the moment the holder must **stop writing**.

**Retry room.** Renewing at roughly one third of the lease length means a failed request
is not yet an emergency. With a 30-second lease and renewals every 10 seconds, a renewal
attempted at 10 s that fails can be retried at 11 s, 12 s, 15 s — there is still room
before 30 s. A single failed request is not proof the lease is gone; it is proof the
network hiccuped. Renewing at 25 s leaves no room at all, which is why one third and not
five sixths.

**When to stop writing.** This is the safety rule, and it is not stated in terms of
individual failures at all — it is a deadline measured from the last renewal that
*actually succeeded*:

> **Go read-only when the time since the last successful renewal approaches the lease
> length, whether or not any particular request has failed. Never write past that point
> on the assumption the lease is probably still held.**

Worked through with the same numbers. Say the last successful renewal completed at
10:31:00, giving a lease until 10:31:30. Renewals are attempted at 10:31:10 and 10:31:20.
If both fail, then at 10:31:20 the holder has not had a confirmed renewal for 20 seconds,
with 10 seconds of lease left. It may keep retrying, but it must go read-only by roughly
10:31:25 — a few seconds *before* 10:31:30 — and not wait for 10:31:30 itself.

The margin is the whole point. Waiting until the exact expiry instant is unsafe for two
reasons: the two machines' clocks do not agree perfectly, and a write already in flight
takes time to land. Stopping a few seconds early absorbs both. Stopping exactly on time
absorbs neither, and the failure it produces is the two-writer case — the holder's
browser believes it still has permission for the instant the server has already given
that permission to somebody else.

Erring early is cheap: the cost is a read-only banner for a few seconds when the lease
was in fact fine. Erring late is the silent-overwrite bug the tab guard exists to
prevent.

For concrete starting values the existing timings are the constraint: the autosave
debounce is 400 ms and `SAVE_IDLE_TIMEOUT_MS` is 5000 ms, so a lease has to comfortably
outlive a worst-case save. `[Inference]` a 30 s lease, 10 s renewals and a 5 s
stop-writing margin leaves a wide margin over a 5 s save; none of it has been tested, and
these are starting points for an experiment rather than tuned values.

### Secure-context consequence

`[Unverified]` against this app, but high confidence as browser behaviour, and it should
be checked on the facility's own machines before committing to this option: service
workers require a secure context, meaning `https:` or `localhost`. A colleague reaching
`http://facility-pc:8080` over the LAN is not in a secure context, so:

- **Service worker registration fails** — no PWA install, no offline for LAN clients. The
  whole of `sw.js` and the two-place version bumping it drives becomes inert for them.
- **IndexedDB still works** on plain HTTP, so the app itself runs.

Locally-trusted certificates (the `mkcert` approach) restore the secure context. A bare
self-signed certificate technically works but gives every user a browser warning to click
through, which is a poor thing to train facility staff to do.

## Option B — Per-device append-only logs in a shared folder, no server

The genuinely server-free design, and the one that allows real concurrent editing.

Every user serves the static app on their own machine at `localhost` — which *is* a
secure context, so this design keeps the PWA install and offline support that Option A's
LAN clients lose. The only shared
resource is a folder: a network share, or a peer-to-peer sync tool running on facility
machines. No process serves the app to anyone else, and no database file is ever written
by two machines.

The mechanism that makes this safe is that **each client writes only its own file.**
Device 2 appends to `oplog-device2.jsonl` and to nothing else. Since no file has two
writers, there is no write conflict to resolve at the filesystem level and no
last-write-wins over a binary image — the failure mode that makes "put the SQLite file in
a synced folder" a bad idea. Each client reads every log, orders the entries, and replays
them.

Requirements and honest limits:

- **Depends entirely on disjoint id ranges.** Without the foundation section above, this
  design produces exactly the frozen-cost corruption described earlier.
- **Entries must be semantic operations, not SQL.** `run()` sees
  `UPDATE meetings SET ...` with bound parameters. Replaying captured SQL out of order
  against a different starting state is not sound. The log has to record
  `booking.cancel { id, retained }` — which means writing it at the level of the savers
  in `js/app.js` (`bookingSave` 3911, `bookingEditSave` 4118, `cancelBooking` 4325,
  `msEditSave` 2065, `archiveProject` 1831, `retirePerson` 2286, `retireInstrument`
  2635), not by intercepting the one chokepoint.
- **Field-level last-write-wins still loses edits.** Two people editing different fields
  of the same booking is resolvable; two people editing the same field is not, and given
  the cancellation-retention and frozen-cost rules, the right behaviour is to **surface
  the conflict for a human to settle**, not to auto-merge. That review queue is part of
  the work, not a later refinement.
- **Browser support.** `[Unverified]` — persistent handles to a real folder come from
  `showDirectoryPicker()`, which is Chromium-only; Firefox and Safari do not implement
  directory pickers. This needs checking against what the facility's staff actually use
  before the design is viable at all.
- **Effort.** Comparable to Tier 5's server work, minus the server. This is not a
  shortcut to multi-user; it is a different large project with a different set of
  benefits (no always-on machine, true concurrent editing, eventual consistency).

## Option C — Actor identity and an audit log

Independent of A and B, useful in single-user operation, and the cheapest item here.
This is the "who did what" half of the original question, and it does not require any
multi-user mechanism to be valuable: even with one editor, "who waived this charge, and
when" is a question the app cannot currently answer.

- **Actor identity.** A "who are you" step at boot, choosing from `people` where
  `is_staff = 1`, remembered in `UI.storage` (per-device, for the reason given in the
  foundation section — it must not travel with the database).
- **An append-only audit table.** Actor, timestamp, entity, entity id, action, and the
  before/after of what changed. Append-only: never updated, never deleted, by anything.
- **Written at the semantic layer, not the chokepoint.** This is the same argument as
  Option B's second bullet and the same conclusion, for a different reason. Intercepting
  `run()` is tempting because it is one function and catches everything by construction,
  but what it can see is `UPDATE meetings SET ...`. It cannot distinguish "rescheduled a
  booking" from "waived the retained charge on a cancelled booking," so the resulting log
  is complete and unreadable. Logging in the savers costs one call per save path and
  yields entries a facility manager can actually audit.
- **It fits the existing grain.** The app already refuses to destroy history: people and
  instruments retire, projects archive, bookings cancel, and a zero-reference delete is
  the only real delete offered. All of that preserves *what* happened. An audit log adds
  *who decided it*, which is the missing half of the same principle.
- **Timestamps.** These are full instants, not calendar days, so they legitimately use
  `toISOString()` — the same exception `CLAUDE.md` already carves out for `created_at`
  and backup filenames. This is not a case for `UI.ymd()`, and an audit entry must not be
  stored as a bare local date.

An Activity screen reading this table is the visible feature. `[Inference]` it is also
the most likely of everything in this document to be wanted regardless of which
concurrency design, if any, is eventually built.

## Suggested build order

1. **Option C, plus the id-range migration.** C is small, independently valuable, and
   answers the "logs" half outright. Folding the id ranges into the same migration costs
   almost nothing while the schema is already being touched, and is the expensive thing
   to retrofit later. Do these together or not at all.
2. **Option A**, if and when a second person actually needs to edit. Small, because the
   protocol already exists in `js/db.js`; its limit is one editor at a time.
3. **Option B**, only if A's single-editor limit proves genuinely obstructive in daily
   use. It is a large project and should be justified by observed friction, consistent
   with how `ROADMAP.md` parks Tier 4 "while the app is used day-to-day, since real
   friction should shape them."

## Open questions

These need answers from the facility, not from the code, and the choice between A and B
turns on them:

1. **How many people need to edit concurrently, as opposed to read?** If the answer is
   "two or three staff who rarely overlap," Option A is sufficient and Option B is wasted
   work.
2. **Is there a machine that stays on and reachable?** Option A requires one. Option B
   does not.
3. **Which browsers do staff actually use?** Option B is `[Unverified]` but probably
   Chromium-only. If the facility is mixed, that decides it.
4. **Is a locally-trusted certificate acceptable to install on staff machines?** If not,
   Option A's LAN clients lose PWA install and offline support.

## What this document does not propose

It does not propose changing `ROADMAP.md`'s Tier 5. A university-wide install with SSO,
per-facility tenancy, row-level permissions enforced server-side and atomic booking
transactions is a different problem with a different answer, and the local designs here
are not a step toward it — Option A in particular is explicitly *not* a sync client, in
the same sense 5.12 records that the local app is "not a synchronising client."

It also does not propose accounts or authentication. Option C's actor identity is a
statement of who is using this device, not a credential; it is unverified by
construction, and it should never be presented in the UI as though it were an
authenticated login. On a LAN with no auth, anyone who can reach the app can write when
they hold the lease. That is a deliberate trade for a facility-internal tool, and it is
the trade Tier 5 exists to stop making.
