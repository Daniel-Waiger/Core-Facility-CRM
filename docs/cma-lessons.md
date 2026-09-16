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

- **"The code looks correct" is not verification in this repo (seen 3×).**
  `node --check js/<file>.js` proves the file parses and nothing more. A verifier
  must run the test suite AND, for anything touching the UI, actually load the
  app in a browser and exercise the changed path (served over http, not
  `file://` — IndexedDB and the service worker behave differently there) — or
  state plainly that it did not. A pass issued from a read of the diff alone is a false pass. _(2026-09-08,
  2026-09-10, 2026-09-16: #41 T5 was the run's only failed verdict and its only
  browser-verified one — the verifier loaded the page in headless Chrome and
  found the feature silently dead; every static and unit check had passed.)_

- **When a change hides something, prove the hide mechanism has a stylesheet
  rule behind it.** #41 T5 toggled the bare `hidden` attribute on
  `[data-out-field]` wrappers, but `css/app.css` `.field { display: flex }`
  outranks the UA `[hidden] { display: none }` and no author `[hidden]` rule
  existed — so every output type showed every field, including ones its
  `OUTPUT_TYPE_FIELDS` entry excludes. No unit test can see this: the attribute
  is set, the DOM is correct, only the cascade is wrong. Grep `css/` for a rule
  matching the hide mechanism (or toggle inline `display:none`/a class instead),
  and open the screen. The retry fixed it with `.field[hidden] { display: none }`.
  _(2026-09-16)_

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

- **A test that throws before its first assertion did not "fail" — it never
  ran, and the gap it was guarding is still open.** _(2026-09-16, #47)_ The
  clones were checked out with `core.autocrlf=true`, so `wiring.test.js`'s
  LF-anchored `scrapeDispatcherCases` threw and the dispatch-completeness check
  never executed during T1–T3. Everyone read it as "2 pre-existing failures",
  and the hole was real: T7's verifier later found **4 unwired `data-act`
  values**. Practice: when a suite failure is dismissed as environmental, state
  *which* assertions consequently never ran, and treat those criteria as
  unverified rather than as background noise. (Fix at source:
  `core.autocrlf=false` clones, LF everywhere.)

- **An executor's diagnosis of a failing test is a claim, not evidence —
  verify it or it misleads the next task.** _(2026-09-16, #47)_ T2's executor
  reported `wiring.test.js` as "waiting on T4's dispatcher cases"; the verifier
  proved it was the CRLF scraper throwing. Had the verifier accepted the
  diagnosis, T4 would have inherited a false explanation for a failure it was
  blamed for. Reproduce the failure's *cause* (on a clean copy extracted with
  `git show HEAD:<path>`), don't relay the executor's story.

- **Triage the baseline once, in the brief — not once per verifier.**
  _(2026-09-16, #47)_ The same 2–4 pre-existing failures (CRLF scrapers, the
  `process.env.TZ` literal assertion) were independently re-reproduced by five
  verifiers in one run, each burning a clean-HEAD comparison to reach the same
  conclusion. Record the exact baseline pass/fail list with the run's brief and
  write criteria as "no *new* failures vs. that list"; a literal "0 failures"
  criterion in a repo with known-red tests forces this waste and invites a
  verifier to either fail good work or quietly soften the bar.

- **A verifier may rule a criterion unsatisfiable-as-written and judge the
  intent — that is a correct verdict, not a soft pass.** _(2026-09-16, #47 T5)_
  The planner's harness seeded a booking dated 2026-03-05 and then asserted
  stewardship rows for 2026-01-01..2026-01-15, so the literal script could never
  print "T5 OK" even though the implementation was right. The verifier passed
  the task and reported the fixture bug. Planners: date fixtures inside the
  ranges their own assertions use; verifiers: say plainly "criterion is faulty,
  here is what I verified instead" rather than failing correct work.

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

- **A correction needs its own adversarial pass** _(seen 2×: 2026-09-09,
  2026-09-12)_. In the first round, **two of six corrections were themselves
  wrong** — a claim true of one report asserted of two, and a "complete" gap
  list that omitted an undisclosed scope narrowing. The 2026-09-12 review pass
  repeated it exactly: two of its own claims were wrong on inspection (which
  vocab category was unescaped; clipped vs stacked UI). A fix does not inherit
  the review's correctness. Re-verify.

- **Code comments are not evidence, and this repo has proved it.**
  `js/reports.js` justified a narrowing with "per the roadmap spec"; the roadmap
  said no such thing. `js/exports.js` promised an "(Archived)" suffix in two
  Notes sheets that no code has ever written. Both shipped and survived review.
  Only executing code settles a claim. _(seen 3×; 2026-09-16: a new seed block's
  own explanatory comment named the wrong demo person and instrument for four of
  the six rows it described — the rows were right, the prose was not. When a
  task writes data *and* a comment describing it, check the comment against the
  rows; verifiers should call this out as a nit rather than let it ship.)_

## Run hygiene

- **A session interruption kills every background agent silently.** No
  completion notification arrives, no error surfaces, and the orchestrator will
  happily report them as "still running" if it trusts expectation over a check.
  Confirm liveness (`ListAgents`, file mtimes) before reporting progress, and
  **commit each unit of work as it lands** rather than batching at the end —
  what is on disk survives, what is in a dead agent's context does not.

- **Recovery after a kill or a clobber must be audited, not assumed.** Agents
  that die after writing leave complete, parseable files; check each survivor's
  output against its original brief and treat anything never reported on as
  unverified (two chapters whose authors died held six defects between them).
  Same shape after the 2026-09-16 stash clobber: the orchestrator saved patches,
  rebuilt clean clones, re-applied, and resumed with a FORCE nonce so only the
  lost task and its successors re-ran — re-running the already-verified tasks
  would have re-opened settled ground. _(seen 2×: 2026-09-10, 2026-09-16)_

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

- **"The demo already shows it" is a cheap, real first check for a reports/aggregation claim.**
  Both R1/R2-class defects in this codebase (a revenue figure pre-discount, a matrix dropping
  instrument-less bookings) were independently reproducible in the shipped demo seed with no setup
  — before writing a fixture, try the claim against the demo dataset first.

## Rendering claims (2026-09-12)

- **A rendered page image is not evidence for right-to-left text.** The bundled `libs/jspdf.umd.min.js`
  ships its own bidi engine, so a mixed English/Hebrew line is already reordered by jsPDF; an
  app-side pre-reversal cancels it and the name draws scrambled — yet the executor "confirmed" the
  feature by looking at the rendered page, whose viewer re-applies bidi and hides the fault. Verify
  glyph order on the PDF content stream (PyMuPDF `get_texttrace()` x-origins), never on a picture.
  Only a base-RTL line, which jsPDF leaves in logical order, needs reversing (`pdfBidiReverse`).

- **Executor checkouts may fork from `main`, not from the branch head.** Three packages in one run
  started from a stale base and then "verified" claims about code that only existed on the branch
  (one concluded a rename had never happened). Give every executor the exact head SHA and have it
  *check* (`git rev-parse HEAD`, `git log -1`) that its checkout is there — then report `blocked`
  if not. **Revised 2026-09-16:** this lesson previously said "make it `git reset --hard` there",
  and a #41 planner copied exactly that into its task assumptions. The orchestrator stripped it
  before execution; had it survived, task N+1 would have wiped tasks 1..N, which run back to back
  with no commits between them. Never put a working-tree-mutating git command in a plan.

<!-- cma:append-here -->

## Hard rules for the 2026-09 parallel runs (orchestrator, 2026-09-16)

Three issues are being built at once in sibling checkouts (`C:\Users\Owner\repos\cfc-39`, `cfc-47`, `cfc-41`). They were first set up as **git worktrees of one clone, which share a single stash stack** — a verifier's `git stash` in one worktree swapped #39's and #47's uncommitted work and cost an hour; #41 escaped only by luck, its verifiers used `git stash` too. Fixed by rebuilding as independent clones. **Parallel issues get independent clones, never worktrees.** For every executor and verifier:

- **Never change working-tree state with git.** No `git stash`, `git reset`, `git checkout -- <path>`, `git switch`, `git clean`, `git worktree`, `git commit`, `git pull`. Tasks run back to back with no commits in between; every one of these commands destroys a sibling task's work.
- **To compare against the base commit**, use read-only forms only: `git diff`, `git diff --stat`, `git show HEAD:js/app.js`, `git log`. `git stash` is *not* one of them. To test "does this fail on unmodified HEAD too?", extract the file with `git show HEAD:<path> > <scratchpad>/<name>` and run the check on that copy, or clone `C:\Users\Owner\repos\cfc-main` into the scratchpad.
- **Stay inside your own checkout.** The repo path in your brief is the only directory you may edit. If `git status` shows changes that clearly belong to another issue (#39 tags, #47 training, #41 outputs), stop and report `blocked` with what you saw; do not "clean up".
- **Line endings are LF** in these clones (`core.autocrlf=false`). Do not introduce CRLF. `test/unit/wiring.test.js` and `boot-ready-signal.test.js` scrape `js/app.js` with LF-anchored patterns: the first #41 clone was made on Windows with `core.autocrlf=true`, so those two tests failed on *every* task until the clones were recreated — burning verifier time on each. Before a run, confirm `git config core.autocrlf` is `false` in the checkout; when a scraper test fails, check line endings before the diff.
- **Timezone:** inline `TZ='Asia/Jerusalem' node ...` may not reach `process.env.TZ` in this shell; the host clock is already Asia/Jerusalem, so date behaviour is exercised at UTC+ regardless. A test asserting the literal env value is a known environment artefact; say so plainly rather than chasing it.
- **Reporting `blocked` on a polluted tree is the best possible outcome, not a
  failure.** _(2026-09-16, #47 T7)_ The shared stash stack swapped #39 and #47
  work; the verifier noticed `js/db.js` held a `#39` fence instead of `#47` and
  refused to pass, and the retry executor made zero edits and reported
  `blocked` with `git status` / reflog evidence. That pair of refusals is why
  nothing was silently overwritten and the run was recoverable. An executor that
  had "helpfully" cleaned the tree would have destroyed the sibling issue's
  work. Detection rule: check that *your* task's marker (fence, symbol, column)
  is what the file actually contains before trusting the tree.

- **No version bumps, ever, on these branches.** `index.html ?v=`, `sw.js CACHE_VERSION/PRECACHE_URLS`, `js/consts.js APP_VERSION` stay untouched; CHANGELOG bullets go under `## [Unreleased]`.
