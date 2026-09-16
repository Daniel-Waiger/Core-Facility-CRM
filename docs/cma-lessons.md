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

- **Record the failing-test baseline once, at run start, and put it in every
  brief.** In the #39 run (2026-09-16) three unit tests failed on unmodified
  HEAD; all ten verifiers re-triaged them independently, two reached different
  counts (T5's executor reported 6 failures, its verifier reproduced 256/256
  green), and several reached for `git stash` to prove the point — the exact
  command that had already corrupted the run. A one-line "known baseline: these
  N tests fail on HEAD, here is why" in the brief removes both the duplicated
  work and the motive to touch working-tree state.

- **Never word a criterion as "the full suite exits 0" when the baseline is
  red.** T1, T3, T4 and T9 all passed in substance while literally failing that
  wording, forcing each verifier to write a paragraph arguing around it. Word it
  "no failures beyond the recorded baseline" instead; otherwise an honest
  verifier must either fail good work or learn to discount its own criteria.

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

- **Code comments are not evidence, and the app's own output strings are
  documentation.** `js/reports.js` justified a narrowing with "per the roadmap
  spec"; the roadmap said no such thing. `js/exports.js` promised an "(Archived)"
  suffix in two Notes sheets that no code has ever written — a defect not in the
  manual but in a spreadsheet handed to a user. Both shipped and survived review.
  Only executing code settles a claim; audit the strings the app emits too.

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

- **`test/unit/wiring.test.js` and `test/unit/boot-ready-signal.test.js` scrape `js/app.js` with
  regexes and are the repo's most brittle tests.** They break for reasons that have nothing to do
  with the change under test: CRLF line endings (2026-09-16, failed on every task until the clones
  were rebuilt with `core.autocrlf=false`) and any reshaping of `boot()` / `handleAct()`. If they
  are the only red tests, suspect the harness before the diff — and a task that restructures either
  function must update them in the same task.

## Rendering claims (2026-09-12)

- **A rendered page image is not evidence for right-to-left text.** The bundled `libs/jspdf.umd.min.js`
  ships its own bidi engine, so a mixed English/Hebrew line is already reordered by jsPDF; an
  app-side pre-reversal cancels it and the name draws scrambled — yet the executor "confirmed" the
  feature by looking at the rendered page, whose viewer re-applies bidi and hides the fault. Verify
  glyph order on the PDF content stream (PyMuPDF `get_texttrace()` x-origins), never on a picture.
  Only a base-RTL line, which jsPDF leaves in logical order, needs reversing (`pdfBidiReverse`).

- **Executor worktrees may fork from `main`, not from the branch head.** Three packages in one run
  started from a stale base and then "verified" claims about code that only existed on the branch
  (one concluded a rename had never happened). Tell every executor the exact head SHA and make it
  `git reset --hard` there before reading anything.

## Plan quality: what produced a 10-for-10 run (2026-09-16, issue #39)

- **Put the literal expected output of a runnable one-liner in the task's
  verification criteria.** Ten tasks, ten first-try passes, zero retries. The
  criteria that carried the most weight were of the form "run this exact
  `node -e ...` and it prints `["SIM","TIRF","Fiji"] "Fiji, Napari" []`".
  Executor and verifier then check the same observable fact instead of two
  readings of a diff, and disagreement becomes impossible to paper over.
  Grep-shaped criteria work the same way ("exactly two `#39 begin`/`#39 end`
  pairs; the first at a line after `ix_project_outputs_project`").

- **A planner must not ban vocabulary its own scope statement uses.** T10's
  brief forbade the word "column" in changelog prose while the brief itself (and
  the precedent 1.11.0 entry) described "two new columns"; the verifier had to
  log a non-gating problem for obeying the scope. Style bans belong in the
  lessons/`CLAUDE.md` layer, and the planner should self-check its prose rules
  against its own wording before shipping the brief.

- **Cross-format claims still need per-format wording.** The same T10 changelog
  said "Tags column" for the DOCX/PDF reports, which actually render a "Tags:"
  line per booking; only the spreadsheet paths are columns. Each export format
  is its own code path (`CLAUDE.md`), so a release note describing "the export"
  in one phrase is usually wrong for at least one of the three.

## Recovering an interrupted parallel run (2026-09-16)

- **Recover by patch + fresh clone, and discard the interrupted task's partial
  output.** A sibling run's `git stash` in a worktree of the same clone swapped
  this run's uncommitted work into the other issue's tree after T4. What worked:
  save the surviving work as a patch, rebuild independent clones with
  `core.autocrlf=false`, re-apply, **delete the half-written file from the task
  that was mid-flight** (`reports.js` from T5), and re-run from that task with a
  fresh FORCE nonce. T5–T10 then passed with zero retries. Resuming *on top of*
  a half-written file is the failure mode this avoids: the next executor treats
  partial code as the base and its greps report a state nobody authored.
  (Shared stash stack across worktrees of one clone: seen 2×.)

<!-- cma:append-here -->

## Hard rules for the 2026-09 parallel runs (orchestrator, 2026-09-16)

Three issues are being built at once in sibling checkouts (`C:\Users\Owner\repos\cfc-39`, `cfc-47`, `cfc-41`). A verifier's `git stash` in one checkout swapped two issues' uncommitted work and cost an hour. Therefore, for every executor and verifier:

- **Never change working-tree state with git.** No `git stash`, `git reset`, `git checkout -- <path>`, `git switch`, `git clean`, `git worktree`, `git commit`, `git pull`. Tasks run back to back with no commits in between; every one of these commands destroys a sibling task's work. Seen 2× (2026-09-16): the swap that cost the hour, and then the #39 verifiers themselves reaching for `git stash`/`pop` to prove a failure pre-existing — the urge is strong and specific to verification, so the brief must name the safe substitute, not just the ban. Tasks briefed after these rules landed complied.
- **To compare against the base commit**, use read-only forms only: `git diff`, `git diff --stat`, `git show HEAD:js/app.js`. To test "does this fail on unmodified HEAD too?", extract the file with `git show HEAD:<path> > <scratchpad>/<name>` and run the check on that copy, or clone `C:\Users\Owner\repos\cfc-main` into the scratchpad.
- **Stay inside your own checkout.** The repo path in your brief is the only directory you may edit. If `git status` shows changes that clearly belong to another issue (#39 tags, #47 training, #41 outputs), stop and report `blocked` with what you saw; do not "clean up".
- **Line endings are LF** in these clones (`core.autocrlf=false`). Do not introduce CRLF. The wiring and boot-ready tests scrape `js/app.js` with LF-anchored patterns — in the #39 run a CRLF checkout made both fail on *every* task until the clones were rebuilt, and each verifier spent effort re-proving they were pre-existing. Check `git config core.autocrlf` when creating a checkout, before the first task runs.
- **Timezone:** inline `TZ='Asia/Jerusalem' node ...` may not reach `process.env.TZ` in this shell; the host clock is already Asia/Jerusalem, so date behaviour is exercised at UTC+ regardless. A test asserting the literal env value is a known environment artefact; say so plainly rather than chasing it. Confirmed 2026-09-16: on the same tasks one agent saw 6 failures and another 256/256 green purely from how the env var was passed — so quote the *command you ran* alongside any failure count, or the two reports are not comparable.
- **No version bumps, ever, on these branches.** `index.html ?v=`, `sw.js CACHE_VERSION/PRECACHE_URLS`, `js/consts.js APP_VERSION` stay untouched; CHANGELOG bullets go under `## [Unreleased]`.
