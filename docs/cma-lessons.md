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

- **Probe the interpreter; neither `CLAUDE.md` nor this file can tell you which
  machine you are on.** On the 2026-09-08 Windows host `python3` did not exist
  (Python 3.14 was `python`) and an agent that trusted `CLAUDE.md`'s
  `python3 -m http.server 8000` reported the app as unservable. On the
  2026-09-17 Linux container `python3` *is* present and `python` may not be.
  Run `command -v python3 || command -v python` once and use what answers —
  do not hardcode either, and do not "fix" the docs for your host.
  _(2026-09-08, revised 2026-09-17)_

## Verification

- **For a zero-behaviour-change refactor, a fingerprint harness is the only
  real proof — and its clock must be frozen.** _(2026-09-18, 1.13.1: 12/12
  first-try.)_ A scratchpad `golden.js` boots the real app on the demo seed via
  `test/unit/helpers/load-module`, freezes `Date` with a subclass, renders every
  `Views` screen (including retired/archived toggles and all three calendar
  modes), runs `Reports.render` for four presets plus a wide range and every
  `compute*`, captures every XLSX workbook through a patched `XLSX.write`, the
  DOCX constructor calls through a recording `docx` stub and the jsPDF call
  sequence through a recording stub, then sha256s each — 101 fingerprints diffed
  against a HEAD baseline. It was the decisive evidence on every task of the
  run, and it sees what greps cannot (sheet names, `!cols` widths, every cell,
  every rendered screen). Two gotchas: the first two runs differed purely on
  generated-at timestamps and today-relative ranges, so freeze the clock before
  capturing the baseline; and it **never loads `js/app.js`** — it fingerprints
  `Views`/`Reports`/`Exports` only, so an `app.js` claim needs the unit harness
  (`test/unit/helpers/app-harness.js`, which does evaluate `app.js`'s IIFE) or a
  browser run. T2's plan rationale said the sidebar was "fingerprinted"; it is
  not, and the verifier caught it.

- **"The code looks correct" is not verification in this repo (seen 4×).**
  `node --check js/<file>.js` proves the file parses and nothing more. A verifier
  must run the test suite AND, for anything touching the UI, actually load the
  app in a browser and exercise the changed path (served over http, not
  `file://` — IndexedDB and the service worker behave differently there) — or
  state plainly that it did not. A pass issued from a read of the diff alone is a false pass. _(2026-09-08,
  2026-09-10, 2026-09-16: #41 T5 was the run's only failed verdict and its only
  browser-verified one — the verifier loaded the page in headless Chrome and
  found the feature silently dead; every static and unit check had passed.
  2026-09-17, 1.13.0: the run's only failed verdict (T7) was again browser-only
  — every grep, the 334-test unit suite and the 18-test smoke spec passed while
  New Booking opened from an Instrument Profile silently billed a *different
  project*. Verifiers that built headless-Chromium harnesses beyond the stated
  criteria (T4, T5, T7, T8, T13) are the reason 13/13 landed on one retry.)_

- **A class or attribute only does something if `css/app.css` has a rule that
  matches *this* element (seen 2×).** #41 T5 toggled the bare `hidden` attribute on
  `[data-out-field]` wrappers, but `css/app.css` `.field { display: flex }`
  outranks the UA `[hidden] { display: none }` and no author `[hidden]` rule
  existed — so every output type showed every field, including ones its
  `OUTPUT_TYPE_FIELDS` entry excludes. No unit test can see this: the attribute
  is set, the DOM is correct, only the cascade is wrong. Grep `css/` for a rule
  matching the hide mechanism (or toggle inline `display:none`/a class instead),
  and open the screen. The retry fixed it with `.field[hidden] { display: none }`.
  _(2026-09-16; 2026-09-17 T8: the new Today's Agenda rows reuse `row-retired`
  to dim a cancelled booking, but the only rule is `.row-retired > td` — a table
  rule — and the agenda row is a `div`, so nothing dimmed. Before reusing an
  existing class on a new element shape, grep the selector and check it isn't
  `table`/child-scoped. 2026-09-18, the mirror image: `.progress .seg` and
  `.progress .seg i` had sat in `css/app.css` as pure dead weight, because every
  emitter writes `class="progress seg"` on the **same** element — the descendant
  selectors could never match, and the bar was always painted by `.progress > i`.
  Descendant vs same-element is the thing to check on any compound class string.
  Note also that the new dead-CSS lint in `wiring.test.js` greps raw source, so a
  class named after an ordinary English word counts as "emitted" when a code
  comment or seed string contains it — `.segment` passes because `reports.js` and
  `db.js` prose mention segments. Harmless today (no live class depends on a
  comment-only match, measured), but strip comments from the JS side of that
  haystack before trusting it on a new name.)_

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
  intent — that is a correct verdict, not a soft pass (seen 2×).**
  _(2026-09-16, #47 T5)_
  The planner's harness seeded a booking dated 2026-03-05 and then asserted
  stewardship rows for 2026-01-01..2026-01-15, so the literal script could never
  print "T5 OK" even though the implementation was right. The verifier passed
  the task and reported the fixture bug. Planners: date fixtures inside the
  ranges their own assertions use; verifiers: say plainly "criterion is faulty,
  here is what I verified instead" rather than failing correct work.
  _(2026-09-17: 4 of 13 tasks carried a faulty criterion; every verifier judged
  intent correctly and said so, which is why the run still went 13/13. The four
  shapes, all avoidable by the planner: a count over a **`sed` line range**
  that swept in unrelated pre-existing functions (T4's `data-act` range between
  `mountTokenPicker` and `mountBookingModal`); a **case-insensitive substring**
  grep that matches existing prose and filenames (T12's `grep -ci modal`
  hitting "Modality" and `21-new-booking-modal.png`); a `grep -o | sort -u |
  wc -l` over **multiple files without `-h`**, so GNU grep's filename prefix
  makes every line unique (T12 printed 18, not 1); and **absolute test totals
  predicted from sibling tasks' output** (T13 demanded unit ≥340 / browser ≥72
  / restore "14" against actual 338 / 71 / 13). Anchor counts to a named
  function's own body or a fenced block, grep case-sensitively for a string that
  only the new code can contain, and express suite growth as "0 failures and
  ≥ the measured baseline", never as a predicted total.)_
  _(2026-09-18, seen 3×: 4 of 12 tasks again carried one, and three shared a
  single new shape — a `grep -c` whose pattern also matches the helper's own
  **definition line**, so every expected count was low by one (`addSheet` 37 vs
  36, `xlsxBlob` 6 vs 5, `addCol` 42 vs 43 because `const addCol = (` does *not*
  contain `addCol(`). Write the pattern so it can only match a call
  (`grep -c "addSheet(XLSX, wb, '"`), or state the count including the
  definition. The other two: an added-line count of 1 for deleting a selector
  from the middle of a comma list, where 2 is the arithmetic minimum; and a "net
  shrink" check run as `git diff --shortstat HEAD` over the whole tree, which a
  plan that also mandates 179 lines of new tests can never satisfy — scope a
  shrink claim to shipped code (`git diff --shortstat <base> -- css js
  index.html sw.js`, which printed 175+/317− here).)_

- **When only a faulty criterion is unmet, the outcome is `done` with a noted
  discrepancy — not `blocked`.** _(2026-09-17, T13)_ The release task's work
  (`?v=`, `CACHE_VERSION`, `PRECACHE_URLS`, `APP_VERSION`, the dated CHANGELOG
  heading) was complete and correct, but three planner-estimated numbers came in
  low, so the executor reported `blocked`. Nothing was blocked: the shortfall was
  in tasks the executor was forbidden to touch. `blocked` should mean "I cannot
  proceed without a decision or another task's output"; using it for "a criterion
  is wrong" invites an unnecessary retry of correct work. State the true measured
  figures and propose them as the new baseline (the verifier did: 338 / 71 / 13).

- **A new test suite is only proven by mutating the code it guards.**
  _(2026-09-17)_ T6's verifier applied **13 single-point mutations** to
  `instrumentDetail` and confirmed each turned exactly one of the 8 new tests
  red — but the same technique exposed two tests that guard less than their
  title: T2's "count desc then name asc" fixture put every tag in its own count
  tier, so a broken `localeCompare` comparator would still pass, and T6's
  `month-users` assertion survived deleting the tile's `m.is_cancelled = 0`
  clause because the cancelled fixture booking had no `meeting_people` row. A
  green test written *after* the code is the default-vacuous case here. Practice:
  for every rule a test claims to pin, delete that rule in a scratch copy
  (`git archive HEAD | tar -x` into the scratchpad) and prove the test goes red;
  fixtures must contain two rows that differ *only* in the pinned dimension.
  _(2026-09-18, seen 2×: all three test-writing tasks shipped mutation proofs as
  a matter of course — swapping the two cancelled-status strings, dropping the
  `Number()` coercion in `round2`, deleting a `CREATE INDEX` from the SCHEMA
  string, re-adding a dead `ICONS` key — and each verifier re-ran them itself on
  its own scratch copy rather than relaying them. Also worth copying: when a
  probe refuses to go red, say why instead of widening the test. The dead-CSS
  lint's `.segment` probe stayed green because English prose contains the word,
  so the executor proved the intended word-boundary property with three
  non-colliding probes (`.segz`, `.btnz`, `.btn-primar`) and reported the
  sub-case as faulty.)_

- **Harvest the "accepted with nits" list into a fix pass before release.**
  _(2026-09-17)_ All 13 tasks passed, yet re-reading the verifiers' non-gating
  problems produced five real defects worth fixing: the `row-retired`-on-a-div
  CSS gap, a `notePreview` that would throw under Node, a weak ordering test, a
  seeded training date falling *after* the session it authorised, and three
  manual sentences wrong on inspection. A `pass: true` verdict with populated
  `problems` is a work item, not a footnote — scan the whole run's `problems`
  arrays once the batch is green. _(2026-09-18, seen 2×: the 12/12 run's nits
  are mostly plan-quality — a `js/db.js` section comment left over-promising
  after `projectFlags` was deleted, a CHANGELOG lead sentence claiming "nothing
  a user sees changes" when the Settings `Version:` line does, and
  `docs/index.html`'s eyebrow auto-advancing to the new release while its
  hand-written hero and cards still describe the previous one. None gate a
  release; all three are one-line follow-ups worth batching.)_

## The trap that makes work look like it did nothing

- **A `js/` or `css/` edit that skips the version bump is invisible.** Three
  places move together — the `?v=X.Y.Z` strings in `index.html`, `CACHE_VERSION`
  *and* `PRECACHE_URLS` in `sw.js`, and `APP_VERSION` in `js/consts.js` — plus a
  `CHANGELOG.md` entry. Miss them and the service worker keeps serving the old
  asset, so the change is correct on disk and absent in the browser. This is
  the single most likely way a run here ends with "it works" and a user who
  sees nothing. Put the bump in the task graph as its own task, not as a
  footnote inside another task. _(2026-09-17: this worked exactly as intended.
  1.13.0 deferred the bump to a final release task (T13) and **every** verifier
  of an intervening `js/`/`css/` task flagged the still-pending bump in its
  problems list while passing the task. That pairing — own task, plus a standing
  verifier reminder — is the pattern to repeat; the flag is what stops the
  release task being dropped when a run ends early. 2026-09-18 repeated it, with
  one refinement: the release task **must** break a byte-identical-output
  criterion, because `Views.settings` renders `APP_VERSION` and so exactly one
  golden fingerprint (`views.settings`) changes. Exempt that single fingerprint
  in the release task's criteria rather than demanding an empty diff; the
  verifier established intent by reverting only `APP_VERSION` on a scratch copy
  and getting GOLDEN-CLEAN on all 101.)_

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

- **A new hash route inherits `applyRoute`'s shared `ctx`, and an unscoped
  field silently mis-bills.** _(2026-09-17, T7 — the run's one retry)_
  `applyRoute` in `js/app.js` held `ctx.project = id ? Number(id) : null`, so
  `#/instrument/1` and `#/person/6` set `ctx.project = 1`/`6`; `case
  'new-booking'` forwards `ctx.project`, so New Booking opened from the new
  Instrument Profile preselected whatever project shared that id. No error, no
  failing test — money attached to the wrong project. The fix scopes the field
  to its own route (`name === 'project' && id ? … : null`). Adding a detail
  route means auditing *every* `ctx.*` field an action reads, and a browser
  assertion that the dialog opened from the new route has no stray preselection.

- **A renderer that calls `UI.noteHtml` cannot be unit-tested.** _(2026-09-17,
  T5)_ `noteHtml` needs a real `DOMParser`, so `Views.instrumentDetail` threw
  under Node for any instrument whose bookings carried a non-empty note — hidden
  only because the criteria fixture inserted a note-less booking. Either strip
  tags from the stored string (what the fix did) or accept that the renderer is
  browser-group-only; a note-less fixture is a trap, not a test.

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
  rows; verifiers should call this out as a nit rather than let it ship.
  2026-09-17: both seed tasks' verifiers ran that comment-vs-row audit by name
  and found every comment correct — the lesson is landing, keep it.)_

- **Demo seed rows must be chronologically coherent with each other, not just
  individually valid.** _(2026-09-17, T10)_ A new `person_instrument_training`
  row was dated one day *after* the session it authorised, so the demo showed a
  user running an instrument before being trained on it. Every criterion passed:
  counts, conflicts, totals and the 490/546.25/589.95 figures are all
  per-row/aggregate checks that cannot see a cross-entity ordering mistake. When
  a task seeds related entities (training → bookings, grants → users, milestones
  → projects), state the ordering rule in the criteria or read the rows as a
  story before accepting.

## Run hygiene

- **A session interruption kills every background agent silently.** No
  completion notification arrives, no error surfaces, and the orchestrator will
  happily report them as "still running" if it trusts expectation over a check.
  Confirm liveness (`ListAgents`, file mtimes) before reporting progress, and
  **commit each unit of work as it lands** rather than batching at the end —
  what is on disk survives, what is in a dead agent's context does not.
  _(2026-09-17: the 13-task plan was executed as **one workflow script per
  dependency batch** (10 scripts), each committing and pushing its verified
  batch before the next started. Zero data loss across the run, and the retry of
  T7 replayed only one batch. Batch-per-script is now the default shape for a
  plan with more than a handful of tasks.)_

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

- **Collapsing a wrapper into an alias (`const f = UI.f;`) is safe here, but
  only for four reasons — check them, don't assume them.** _(2026-09-18)_ 1.13.1
  replaced `function fmtMoney(n) { return UI.fmtMoney(n); }`-style wrappers in
  `app.js`, `reports.js` and `exports.js` (and `round2`,
  `utcTimestampToLocalDay`) with aliases. An alias captures the value at
  IIFE-evaluation time and a `const` does not hoist like a `function`, so it
  needs: `ui.js` loaded first (true in `index.html`, in every test
  `loadApp([...])` and in `app-harness.js`'s `MODULE_ORDER`), no `this` in the
  implementation, no later `UI.x = …` reassignment anywhere, and no top-level
  call before the declaration. All four held; miss one and you get a TDZ
  `ReferenceError` or a silent unbinding on a path no test visits. Same
  discipline applies to de-duplicating the `ICONS` map: prove the two SVG strings
  are byte-identical at HEAD before repointing callers, rather than reading them
  as "the same icon".

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

## Plan quality: what produced a 10-for-10 run (2026-09-16, issue #39)

- **Put the literal expected output of a runnable one-liner in the task's
  verification criteria.** Ten tasks, ten first-try passes, zero retries. The
  criteria that carried the most weight were of the form "run this exact
  `node -e ...` and it prints `["SIM","TIRF","Fiji"] "Fiji, Napari" []`".
  Executor and verifier then check the same observable fact instead of two
  readings of a diff, and disagreement becomes impossible to paper over.
  Grep-shaped criteria work the same way ("exactly two `#39 begin`/`#39 end`
  pairs; the first at a line after `ix_project_outputs_project`").
  _(seen 2×; 2026-09-17's 13-task 1.13.0 plan used the same shape and went 12/13
  first-try — and the one-liners were quoted back byte-identically by executor
  and verifier in every accepted verdict, e.g. `31 2 0 true 490 546.25 589.95 1
  16 1 0 true`. Long composite one-liners that print one line of many fields
  work well: they pin a dozen invariants, including untouched money figures,
  without a dozen criteria. 2026-09-18, seen 3×: 12/12 first-try on the same
  shape. The one thing that plan failed to pin was *form* rather than fact — it
  said "replace the inline ALTER lines" with an `addCol` helper, and the
  executor kept one call per column, so `js/db.js` shrank in bytes but grew by
  two lines. If a plan cares about line count, grouping or ordering it has to
  say so; a criterion binds only what it measures.)_

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

## Hard rules for concurrent work in one tree (orchestrator)

Batched runs put several tasks in one working tree with no commits between them; the 2026-09-16 issues additionally ran in sibling checkouts that, set up as **git worktrees of one clone, shared a single stash stack** — a verifier's `git stash` swapped two runs' uncommitted work and cost an hour. **Parallel issues get independent clones, never worktrees.** For every executor and verifier:

- **Never change working-tree state with git.** No `git stash`, `git reset`, `git checkout -- <path>`, `git switch`, `git clean`, `git worktree`, `git commit`, `git pull`. Read-only forms only: `git diff`, `git diff --stat`, `git show HEAD:js/app.js`, `git log`, `git status`. To test "does this fail on unmodified HEAD too?", or to run a mutation proof, extract with `git show HEAD:<path> > $SP/<name>` or `git archive HEAD | tar -x` into the scratchpad and work there. _(A prohibition lands only when the brief names the read-only substitute next to it: 2026-09-17's T12 stashed for want of `git show HEAD:`; with the substitute spelled out, every 2026-09-18 executor and verifier ran its mutation proofs on scratchpad copies — preserving the tree layout so `load-module.js`'s `REPO = resolve(__dirname,'..','..','..')` still resolves — and the tree was provably untouched.)_
- **Expect your neighbours' files in `git status`, and attribute them.** In a batched run every concurrent task's edits are visible. Each executor scopes its own diffstat (`git diff --stat HEAD -- <its files>`) and names which other modified files belong to siblings; each verifier confirms the out-of-scope set matches the batch. A file changed by no task in the batch means stop and report `blocked` with what you saw — do not "clean up". Detection rule: check that *your* task's marker (fence, symbol, column) is what the file actually contains before trusting the tree. _(2026-09-16 #47 T7: that refusal is why nothing was silently overwritten and the run was recoverable. 2026-09-18: all three multi-task batches attributed correctly and no verdict was confused by a sibling's diff.)_
- **Line endings are LF** (`core.autocrlf=false`). `test/unit/wiring.test.js` and `boot-ready-signal.test.js` scrape `js/*.js` with LF-anchored patterns and throw on every task in a CRLF clone. Confirm `git config core.autocrlf` before a run; when a scraper test fails, check line endings before the diff.
- **Timezone:** check `node -e "console.log(process.env.TZ)"` once per environment. The inline `TZ='Asia/Jerusalem' node ...` form works on the Linux container and did not reach `process.env.TZ` in the Windows shell.

## Orchestrator mechanics

- **Exit Plan Mode before dispatching execute workflows.** Subagents inherit it
  and refuse to edit; attempt 1 of every execute run on 2026-09-16 was wasted
  this way. _(2026-09-16)_

- **`wiring.test.js` and `boot-ready-signal.test.js` are source-scrapers** and
  the repo's most brittle tests: they break on CRLF and on any reshaping of
  `boot()` or `handleAct()`. A scraper that throws before its first assertion
  never ran — do not dismiss it as environmental. When a task adds a route or a
  `data-act`, extend the matching completeness assertion in the same task
  (2026-09-17 T7 did, for both the person and instrument routes). _(seen 2×)_
