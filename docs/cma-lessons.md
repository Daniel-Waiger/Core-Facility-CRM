# CMA lessons — Core Facility Tracker (repo scope)

Living file. **Every planner, executor and verifier agent reads this before
starting work and applies it unprompted.** New lessons are merged in after each
run: dedupe, add "seen ×N" to recurring ones, and delete lessons that stop
earning their space.

The CMA tooling itself is **not** in this repository — it is an external skill,
available to any project. This file is the one repo-scoped piece: what an agent
needs to know about running that scheme against *this* codebase. It is useful
on its own even if you never run the scheme, because every lesson below is a
fact about this project that cost something to learn.

**Scope test — which file does a lesson go in?**
If the lesson names a file, table, function or convention from *this repo*, it
belongs here. If it would still be true on a completely different codebase, it
belongs in the global file at `~/.claude/cma-lessons.md`. When in doubt, ask
whether a different project would benefit; if yes, it is global.

This file is **not** a second copy of `CLAUDE.md`. `CLAUDE.md` states the
architecture rules; this file records *how the pipeline keeps breaking them*.
A lesson that just restates an architecture rule should be deleted — point at
`CLAUDE.md` instead.

---

## Environment

- **`python3` does not exist on this machine — use `python` (or `py`).**
  `CLAUDE.md` and `AGENTS.md` both tell agents to run
  `python3 -m http.server 8000`; that command fails here with
  "command not found", and an agent that trusts the doc reports the app as
  unservable. Python 3.14 is installed as `python`. _(2026-09-08)_

## Verification

- **"The code looks correct" is not verification in this repo.** `node --check
  js/<file>.js` proves the file parses and nothing more. A verifier must run the
  test suite AND, for anything touching the UI, actually load the app in a
  browser and exercise the changed path — or state plainly that it did not. A
  pass issued from a read of the diff alone is a false pass. _(2026-09-08,
  updated 2026-09-10)_

- **There is a test suite now — run it, and add to it.** `node --test
  'test/unit/*.test.js'` needs nothing installed; the browser group
  (`test/browser/*.spec.js`) needs Playwright and skips without it. Pass the
  glob, not the directory: `node --test test/unit/` makes Node 22 try to
  *execute* the directory. Run under `TZ='Asia/Jerusalem'` — this project's date
  bugs are invisible at UTC. See `test/README.md`. Two facts about it that
  matter to a planner: the unit tests reach real code (the app's IIFEs are
  evaluated against a small DOM stub, and a genuine in-memory database is booted
  through the app's own never-persisting mode, so the shipped schema and
  migrations are what run) — and they still cannot tell you a screen renders.
  _(2026-09-10)_

- **A guard that finds a pre-existing bug on its first run is doing its job —
  do not weaken it.** The date-rule lint failed the moment it was written, on two
  real faults: `performBackupDownload` and `exportAllXlsx` both built a filename
  date with `toISOString().slice(0, 10)`. The first mattered — the silent
  automatic backup identifies the day's file by that name, so east of Greenwich a
  backup written just after midnight overwrote the previous day's. Fix it, or
  allow-list it with a stated reason; never soften the check, and never report a
  suite as passing with a real violation quietly allow-listed. _(2026-09-10)_

- **Serve the app rather than opening `file://` when the change touches
  storage.** IndexedDB and the service worker behave differently under
  `file://` on some browsers, so a bug can be invisible or fabricated
  depending on how the verifier opened the page.

## The trap that makes work look like it did nothing

- **A `js/` or `css/` edit that skips the version bump is invisible.** Three
  places move together — the `?v=X.Y.Z` strings in `index.html`, `CACHE_VERSION`
  *and* `PRECACHE_URLS` in `sw.js`, and `APP_VERSION` in `js/consts.js` — plus a
  `CHANGELOG.md` entry. Miss them and the service worker keeps serving the old
  asset, so the change is correct on disk and absent in the browser. This is
  the single most likely way a run here ends with "it works" and a user who
  sees nothing. Put the bump in the task graph as its own task, not as a
  footnote inside another task.

- **`docs/` changes need no version bump and no changelog entry.**
  The versioning rules exist to cache-bust the app shell; the docs page and the
  manual are not part of it. Bumping for them adds noise and a misleading
  release. The inverse is the trap: a change touching even one string in `js/`
  or `css/` **does** need the bump, however cosmetic it looks. _(2026-09-09:
  a capitalization pass over UI strings is a `js/` change and was released as
  1.9.1, correctly.)_

## Data-model traps that survive a plausible-looking diff

- **Denormalized display string + join table must both be written.** The seed
  data once populated `meetings.attendees` (names, for display) without the
  matching `meeting_people` rows, so a demo meeting showed attendees while
  every join-based feature saw zero. Any new denormalized/relational pair
  repeats this by default. See `CLAUDE.md` → "The database is relational".

- **A retired record filtered out of a form is deleted from the record on the
  next save.** `msEditSave`, `bookingSave`/`bookingEditSave` and the project PI
  form rebuild their join rows from whatever the form renders. The rule is
  "selectable = not retired OR already selected here" — a task that adds a
  picker and does not honour it silently destroys history, and no error
  surfaces. See `CLAUDE.md` → "History is preserved".

- **Dates are local calendar days.** `new Date(x).toISOString().slice(0,10)`
  returns *yesterday* east of Greenwich. Any task touching dates must be
  verified under `TZ='Asia/Jerusalem'`, because the bug is invisible at UTC and
  UTC−. This already shipped once as issue #14. Use `UI.ymd` / `UI.today`.

## Verifying documentation (2026-09-09, a full run's worth of evidence)

- **Doc claims must be verified against `js/`, never against `CHANGELOG.md`,
  `README.md` or a code comment.** Across four adversarial passes in one run,
  **23 false claims** were found in prose that read perfectly plausibly. Two
  were falsifiable by a reader simply following the manual's own instructions:
  a "Try it" exercise that demonstrated the opposite of what it promised
  (the booking edit form re-prices live; only the *saved* total is frozen), and
  a Grants section claiming the "Allowed Users" list restricts who can be
  picked, when no picker joins `grant_users` at all. Plausible prose is exactly
  what a false claim looks like.

- **A correction needs its own adversarial pass.** In the first round, **two of
  six corrections were themselves wrong** — a claim true of one report asserted
  of two, and a "complete" gap list that omitted an undisclosed scope
  narrowing. A fix does not inherit the review's correctness. Re-verify.

- **Code comments are not evidence, and this repo has proved it.**
  `js/reports.js` justified a narrowing with "per the roadmap spec"; the roadmap
  said no such thing. `js/exports.js` promised an "(Archived)" suffix in two
  Notes sheets that no code has ever written. Both shipped and survived review.
  Only executing code settles a claim.

- **The app's own output strings are documentation too.** The "(Archived)"
  defect was not in the manual — it was in a spreadsheet the app hands to a
  user. When auditing docs, audit the strings the app itself emits.

## Run hygiene

- **A session interruption kills every background agent silently.** No
  completion notification arrives, no error surfaces, and the orchestrator will
  happily report them as "still running" if it trusts expectation over a check.
  Confirm liveness (`ListAgents`, file mtimes) before reporting progress, and
  **commit each unit of work as it lands** rather than batching at the end —
  what is on disk survives, what is in a dead agent's context does not.

- **Recovery after such a kill is possible but must be audited, not assumed.**
  Agents that die after writing leave complete, parseable files. Check each
  survivor's output against its original brief, and treat anything an agent
  never reported on as unverified — in this run, the two chapters whose authors
  died contained six defects between them.

- **The manual stores each chapter's number twice** — in `docs/manual/manual.js`
  and again as a hardcoded `<p class="ch-kicker">Chapter N</p>` in every page.
  Insert a chapter and every later page silently disagrees with the sidebar.
  Verify programmatically against the registry after any insertion; better,
  render the kicker from `manual.js` and delete the duplication.

- **A capitalization or wording pass over `js/` strings breaks docs that quote
  those labels.** After renaming UI strings, grep `docs/` and `README.md` for
  every old label — four places quoted labels that no longer existed, and three
  of those were made stale by the same run that fixed them.

## Testing this app's private closures (2026-09-12)

- **Save functions must use a "topmost modal" helper — a first-match `.modal` lookup breaks under
  stacked modals.** 24 of 26 save functions in `js/app.js` read `document.querySelector('.modal')`,
  which is the *bottom* modal when a second one is open on top of it (e.g. opened from Today's
  Agenda) — the save silently reads/writes the wrong form. Any new save function should reuse a
  single "topmost `.modal`" helper, not repeat the pattern that already broke four real paths.

- **No unit test loaded `js/exports.js` at all, and export-only defects survived because of it** —
  a stale "(Archived)" suffix promised by a comment but never written, and a bare `GROUP_CONCAT`
  missing the retired-suffix `CASE WHEN` every other query in the file uses. A money/label rule
  proven once in `js/reports.js` or `js/app.js` is not proven again for its XLSX/DOCX/PDF path;
  each export format is its own code path (CLAUDE.md) and needs its own assertion.

- **`restoreBackup` validated only the envelope** (`kind` and `!data.db`), not that the bytes
  inside were a usable database — `db: []` passed. A round-trip test that only checks "restore
  didn't throw" cannot catch this; it takes a test that actually queries a core table afterward.

- **"The demo already shows it" is a cheap, real first check for a reports/aggregation claim.**
  Both R1/R2-class defects in this codebase (a revenue figure pre-discount, a matrix dropping
  instrument-less bookings) were independently reproducible in the shipped demo seed with no setup
  — before writing a fixture, try the claim against the demo dataset first.

- **A correction pass over the previous review's own claims found two more wrong ones on inspection**
  — one about which vocab category was actually unescaped (PERSON_TYPES was fine; `people.type` and
  the STATUS vocab were not), one about a UI overlap being clipped rather than visually stacked.
  This is the same "corrections need their own adversarial pass" lesson already recorded above,
  seen again in a different section of the same run — restating it here would be a duplicate; this
  entry exists only to note it recurred, not to re-explain it.

<!-- cma:append-here -->
