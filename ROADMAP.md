# Roadmap: Lab &harr; Core-Facility Workflow

Core Facility Tracker is designed to run as **two independent installs** — one inside a
research lab, one inside a core facility — each 100% client-side with its own local database,
connected by a **file-based handoff** instead of a shared backend. This document lays out the
vision, what v1.3.0 ships, and what's deliberately deferred.

## The vision

A lab drafts a project and submits it to a facility. Facility staff review it, request
revisions if needed, and schedule a kick-off. The project then runs through its working
lifecycle (active, on-hold, completed, archived) with both sides able to see status, discuss,
and attach their own milestones/meetings/files — without either side's local data being able
to silently clobber the other's.

Because there's no server (a deliberate, explicitly-avoided architecture change — see
`CLAUDE.md`), the "shared" state between the two installs is a **single-project JSON file**:
export it from one side, import it on the other. The container format is versioned and
self-contained specifically so that a future backend could adopt the same shape for real
sync, without changing how either side's local data model works.

## Phase 1 — this release (v1.3.0)

- A defined status state machine (`Draft` → … → `Archived`) with guided transition buttons
  filtered by the install's declared side (Lab / Facility — advisory, not a login).
- A full status history log, populated by every code path that changes status (guided
  transitions, the manual override escape hatch, the Edit Project modal, project creation
  and duplication, and a synthetic backfill row for pre-1.3.0 data).
- A rich-text discussion thread per project (Review & Discussion).
- **The project container**: a versioned, self-contained JSON export/import of one project,
  designed as the interchange contract between installs:
  - People and instruments are embedded and resolved by email/name match on import (creating
    only what's missing), not by local row id — ids are meaningless across installs.
  - Every child row (milestone, meeting, file) carries a stable `uid` and an `origin_side`
    recording which install created it.
  - **Ownership-protected merge**: importing a container only ever replaces rows the sender
    owns (its own `origin_side`, or a `uid` it's re-sending as an update) — rows the receiving
    side created are never touched or deleted. This is what prevents one side's import from
    silently erasing the other side's local additions.
  - Comments and status history are unioned by `uid` and never deleted in either direction, so
    feedback and history travel losslessly both ways, and re-importing an unchanged container
    is a no-op.
  - A preview modal always shows what an import will do — create vs. update, ownership-scoped
    change counts — before anything is written.
- Mode-aware dashboard framing (a facility sees its review backlog; a lab sees what's pending
  on its side) and a submission-pipeline breakdown card.

## Phase 2 — ideas, not committed

- Richer import diffing: a field-by-field before/after view instead of aggregate counts.
- Multi-project containers (a facility batch-exporting several projects for one lab at once).
- DOCX/PDF export gaining Status History and Discussion sections (XLSX has them as of v1.3.0;
  each export format is a separate hand-built code path per `CLAUDE.md`, so this is real,
  non-trivial work per format).
- A "what changed since last import" indicator on the project detail page.
- Structured revision-request reasons (a short checklist) instead of a free-text note.

## Phase 3 — a real backend (explicitly out of scope for now)

Nothing here requires a backend, and none is planned as part of this app's architecture — the
zero-server, zero-account, fully-client-side design is a deliberate constraint (see
`CLAUDE.md`). But the container format was shaped so that *if* a backend were ever introduced,
it would slot in without redesigning the data model:

- `container_uid` is already the stable cross-install identity a server-side `projects.id`
  would key off of.
- Per-row `uid` + `origin_side` on milestones/meetings/files is already exactly the shape a
  last-write-wins-per-field or CRDT-style sync needs.
- Union-by-`uid`, never-delete semantics on comments/status_history is already how an
  append-only server log would behave.

In other words: today's "export a file, email it, import it" flow and tomorrow's "hit sync"
flow would use the same merge rules — only the transport changes.
