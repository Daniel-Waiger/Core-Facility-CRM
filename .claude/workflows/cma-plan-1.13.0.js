export const meta = {
  name: 'cma-plan',
  description: 'CMA planner phase: decompose an objective into small, verifiable tasks. Plans with Fable, falls back to Opus if Fable is unavailable.',
  phases: [
    { title: 'Plan', detail: 'Fable decomposes the objective into a task graph (Opus fallback)' },
  ],
}

// ---- Inputs (via args) -------------------------------------------------------
// args.objective : string  (required) — the goal to decompose
// args.repoPath  : string  (optional) — absolute path of the target repo, so the
//                  planner references correct paths in task scopes.
// args.constraints : string (optional) — extra constraints to honor.
// The runtime may deliver args as a JSON string. If it parses to an object,
// use its fields; if it's a plain string, treat the whole thing as the objective.
let input = {"objective":"Release 1.13.0 of the Core Facility Tracker on branch claude/jolly-maxwell-95wu0m: (1) a reusable booking Tags picker with per-tag usage counts (all bookings, cancelled included) and search-or-create, in both booking dialogs only; (2) one role pill on the person profile coloured by role via a shared typeBadge helper, Facility Staff added to PERSON_TYPES; (3) training levels renamed to Regular / Super User with a data migration of stored User rows; (4) a new #/instrument/<id> Instrument Profile route mirroring the person profile, with header + New Booking button, utilization tiles from Reports aggregations, details, upcoming bookings (14 days), Recent Activity with columns User / Date / Start-End / Duration / Assisted / Notes / Status (em-dash fallbacks), trained users, active projects; (5) a full-width Today’s Agenda card on the Dashboard below the milestone boxes listing today’s bookings and milestones due today; (6) a richer demo dataset (three more members per lab with real roles, ~16 more bookings incl. two today, training rows) respecting every seed/test invariant; (7) a docs-only extensions/importers concept document in docs/plans linked from ROADMAP.md; (8) a final release task bumping versions to 1.13.0 and writing the CHANGELOG entry, docs/index.html highlights and manual updates.","repoPath":"/home/user/Core-Facility-CRM","constraints":"ENVIRONMENT: Linux container, Node v22.22.2, python3 AND python both exist (the lessons file’s ‘python3 does not exist’ note is from a Windows machine and does not apply here). Repo is at /home/user/Core-Facility-CRM, HEAD a106b75 (1.12.1), branch claude/jolly-maxwell-95wu0m checked out, clean tree, LF line endings, core.autocrlf unset. Playwright + Chromium are preinstalled (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers), so the browser suite runs here.\n\nBASELINE recorded 2026-09-17 at HEAD a106b75: `TZ=Asia/Jerusalem node --test test/unit/*.test.js` → 318 tests, 318 pass, 0 fail; `TZ=Asia/Jerusalem node --test test/browser/*.spec.js` → 65 pass, 0 fail. Every task’s criteria must say ‘no new failures vs this baseline’ and, where a task knowingly changes an assertion (e.g. seed counts), name the exact assertion it updates.\n\nRead /home/user/Core-Facility-CRM/CLAUDE.md and /home/user/Core-Facility-CRM/docs/cma-lessons.md (Linux path, forward slashes) and bake their invariants into each task scope: local calendar days (UI.ymd/UI.today, never toISOString().slice), retired-selectable rule, denormalized+join pairs written together, explicit child-row deletes, Title Case controls / sentence case prose, red Cancel on danger dialogs, aggregation reused from reports.js not re-derived, data-act literal strings each with a `case` inside handleAct (wiring.test.js scrapes both directions), icon names must exist in ui.js ICONS.\n\nNO VERSION BUMP in any feature task. index.html ?v=, sw.js CACHE_VERSION + PRECACHE_URLS, js/consts.js APP_VERSION stay at 1.12.1 until the FINAL task, which bumps all of them to 1.13.0 together and converts the `## [Unreleased]` CHANGELOG heading (which feature tasks add their bullets under, above `## [1.12.1] — 2026-09-17`) into `## [1.13.0] — 2026-09-17`. test/unit/versions.test.js must pass after that task.\n\nExecutors and verifiers never mutate the working tree with git (no stash/reset/checkout --/clean/commit/push). Tasks run back to back with no commits in between; the orchestrator commits after verified batches. Read-only comparisons via `git show HEAD:<path>`.\n\nEvery task verification must include the literal expected output of a runnable one-liner (node -e script using test/unit/helpers, or grep -c with the expected number), plus `node --check` on touched js files and the unit suite. UI tasks additionally require rendering the screen in headless Chromium (test/browser/helpers/browser.js shows how the suite launches the app with ?demo=1) or a new browser spec, because template-string screens fail only when visited.\n\nTask sizing: one file or one cohesive change per task; roughly 12–16 tasks; sequential batches where files overlap (js/app.js and js/views.js and js/db.js are each touched by several items, so order them). Reuse existing helpers named in the design: UI.parseTags/joinTags, unionNames, mountTokenPicker (as a model, not to extend), mountBookingModal, newBooking(date, projectId, start, end, instrumentId) + the existing `case new-booking` which forwards data-inst, Reports.makeFacts + computeInstrumentRows, DB.listInstrumentTraining, DB.trainingStatusOn, UI.hoursBetween, UI.noteHtml, UI.retiredName, statusBadge/emptyState/tagChips in views.js, seedBooking in db.js.\n\nDESIGN TO IMPLEMENT (approved by the user; do not redesign, only decompose):\n\n## 1. Reusable tag picker with usage counts (booking modals only)\n\n**Files:** `js/app.js` (tagsField + new `mountTagPicker`), `js/db.js` (count helper),\n`css/app.css` (small additions), `test/unit/booking-tags.test.js`.\n\n- Add `DB.bookingTagCounts()` in `js/db.js` next to the other tag code: reads every\n  `meetings.tags`, splits with `UI.parseTags`, returns `[{ tag, count }]` sorted by count desc\n  then name, **cancelled included**. Union in `DB.vocabList('BOOKING_TAG')` terms with count 0 so\n  a vocab term with no booking still appears. Case-insensitive merge, first spelling wins (same\n  rule as `unionNames`, `js/app.js:84`).\n- Replace the body of `tagsField(id, value)` with a chip-style picker: a `.token-list` of\n  selected tag chips (removable ×, reusing `.token` styles), a search box, and a dropdown listing\n  known tags as `name ×count`, with a \"Create “<typed>”\" entry when the search text matches no\n  tag. Keep a hidden `<input id=\"${id}\">` whose value is the comma-joined list so **both savers\n  stay unchanged** (`js/app.js:3817`, `4019` read `#bk-tags` / `#bke-tags`).\n  Implement as `mountTagPicker(m, id)` called from `mountBookingModal` (`js/app.js:3584`), modeled\n  on `mountTokenPicker` but simpler (string ids, free-text create, no lock/filter). Do not extend\n  `mountTokenPicker`: its ids are numeric rows and its retired/lock semantics do not apply.\n- Enter in the search box selects the only match or creates the typed tag. Tags pass through\n  `UI.parseTags` so the stored format is identical to today.\n- Calendar chips and `tagChips()` unchanged (user: modal only). Report card unchanged.\n- Vocab learn-back after save stays (`js/app.js:3909`, `4139`).\n- Tests: `bookingTagCounts` counts a multi-tag booking once per tag, includes cancelled rows,\n  merges case-insensitively, includes zero-count vocab terms; hidden input round-trips.\n\n## 2. One role pill, coloured by role\n\n**Files:** `js/views.js` (profile header 781-785, People list 723 + 729), `js/consts.js`\n(`PERSON_TYPES`), a shared helper in `js/views.js` next to `statusBadge`.\n\n- New `typeBadge(type)` helper: `PI` → `badge primary`, `Facility Staff` → `badge success`,\n  everything else (Postdoc, PhD, MSc, Undergrad, Technician, Researcher, Other, custom vocab) →\n  `badge neutral`. Text is the stored `type` verbatim.\n- Profile header renders `typeBadge(p.type)` only; the hardcoded green pill is deleted.\n- People list Role column uses `typeBadge`. Its Facility Staff check column stays (it is the\n  billing flag itself, and the filter \"staff only\" keys on it).\n- Add `'Facility Staff'` to `PERSON_TYPES` (before `Other`) so it is a real role option rather\n  than seed-only text. Grep confirms the string is data + tooltips, not a comparison key.\n\n## 3. Training levels: Regular / Super User\n\n**Files:** `js/consts.js:27`, `js/db.js` (schema default lines 250 and 644, comment 2256-2259,\nseed rows 3331-3346, new fenced migration), `js/app.js:2374` (dialog default),\n`test/unit/training.test.js`, the manual page that names the levels.\n\n- `TRAINING_LEVELS: ['Regular', 'Super User']`; schema default `'Regular'`.\n- Migration in a new `// --- 1.13 begin/end ---` fence after the #41 block in `migrate()`:\n  `UPDATE person_instrument_training SET level='Regular' WHERE level='User'`. Idempotent; runs\n  on boot and on restore (restore goes through the same migrate path).\n- Tests: \"renames legacy 'User' level to 'Regular' on migrate\"; fixture inserts → `'Regular'`.\n\n## 4. Instrument profile\n\n**Files:** `js/app.js` (routing, dispatcher), `js/views.js` (new `instrumentDetail`, list row\nlink), `test/unit/wiring.test.js`, `test/browser/smoke.spec.js`, a new\n`test/unit/instrument-profile.test.js`.\n\nMirror the person route: `hashFor`/`parseHash` (`js/app.js:335-355`) learn `instrument`;\n`ctx.instrument`; `TITLES.instrument = 'Instrument Profile'`; stale-id guards fall back to\n`#/instruments`; `renderView` → `Views.instrumentDetail(ctx.instrument)`. Not in `HASH_ROUTES`.\nInstruments table row gets `class=\"row-link\" data-goto=\"instrument\" data-id` plus a chevron\n\"Open Profile\" button like `js/views.js:732`.\n\n`Views.instrumentDetail(id)` cards, in order:\n1. **Header**: name (`UI.retiredName`), kind chip, status badge, buttons Back to Instruments,\n   **New Booking** (`data-act=\"new-booking\" data-date=\"${UI.today()}\" data-inst=\"${id}\"`, the\n   existing case already forwards `data-inst` to `newBooking`), Edit Instrument.\n2. **Utilization tiles** (`grid cols-4`, `.card.stat`): This Month and This Year rows of\n   Bookings · Booked Hours · Distinct Users · Charges, computed with `Reports.makeFacts(from,to)`\n   + `Reports.computeInstrumentRows(facts)` filtered to this instrument, so figures equal the\n   Reports screen (cancelled excluded from hours, money follows the Project Costs rule). Range\n   boundaries via `UI.ymd(new Date(y, m, 1))` and `UI.today()`, never `toISOString`.\n3. **Details**: Modality/Kind, Status, Location, Cost + Unit, min/max duration, min gap, min\n   notice, Supervisors (`instrument_staff`), Config Notes.\n4. **Upcoming Bookings**: next 14 days on this instrument (`date >= today AND date <= today+14`,\n   `is_cancelled = 0`), chronological, columns Date · Time · Title · User · Assisted; row click →\n   `data-act=\"edit-booking\"`.\n5. **Recent Activity** (the requested columns): User · Date · Start–End · Duration · Assisted ·\n   Notes · Status. Bookings joined through `meeting_instruments`, `date <= today`, newest first,\n   `LIMIT 25`, cancelled kept and marked (`row-retired` + danger badge).\n   - User = `GROUP_CONCAT` of `meeting_people` names (retired suffix via `CASE`); em-dash if none.\n   - Duration = `UI.hoursBetween(start_time, end_time)` formatted `Xh Ym`; em-dash if no times.\n   - Assisted = `GROUP_CONCAT` of `meeting_staff` names; em-dash if none.\n   - Notes = plain-text preview of `meetings.note` (tags stripped from `UI.noteHtml` output,\n     ~80 chars, full text in `title`); em-dash if blank.\n6. **Trained Users**: `DB.listInstrumentTraining(id)` with Person · Level · Trained On · Trainer ·\n   Expires · status badge (`trainingStatusOn`), retired names via `UI.retiredName`.\n7. **Active Projects**: from `project_instruments`, `data-goto=\"project\"` rows.\n\nTests: wiring test gets the \"in TITLES, not in HASH_ROUTES\" assertion for `instrument`; smoke spec\nvisits `#/instrument/1`; unit test renders `instrumentDetail` against a fixture and asserts the\nem-dash fallbacks, the duration string, the Assisted column and the utilization tile equalling\n`computeInstrumentRows` for the same range.\n\n## 5. Dashboard: Today's Agenda box\n\n**File:** `js/views.js:20-83`, `test/unit/dashboard.test.js`.\n\nFull-width `<div class=\"card mt-16\">` after the `grid cols-2` block (a card outside a grid is\nalready full width; no new CSS). Title `Today's Agenda — <weekday, date>` via\n`toLocaleDateString(UI.DATE_LOCALE, …)` on `new Date()` (display only). Inside, `grid cols-2`:\n- **Bookings Today**: `ORDER BY start_time, id`; each row time range · title · project or\n  \"Facility-wide\" · instruments · staff; `data-act=\"edit-booking\"`; cancelled marked. Empty state\n  `emptyState('calendar', …)`.\n- **Milestones Due Today**: reuse the Upcoming row markup (`toggle-ms-status`, `data-goto`),\n  scoped `is_archived=0`.\nQueries adapted from `openTodayModal` (`js/app.js:5832-5846`) with the archived filter; the modal\nitself is untouched. Test: a booking seeded on `UI.today()` appears in the dashboard HTML.\n\n## 6. Richer demo dataset\n\n**File:** `js/db.js` `seedSampleData` (people 2817, bookings 3057-3312, training 3331,\ncampus/mobile UPDATEs 3350+); tests `training.test.js:426-441`, `booking-tags.test.js:271-298`.\n\nHard constraints found in tests and comments, all respected:\n- Booking #1 (`Project Kickoff & Laser Alignment Review`) stays the **lowest meeting id**; its\n  490 / 546.25 / 589.95 figures untouched. New bookings are appended after the existing ones.\n- `workshop` category refs stay **exactly 1**: no new workshop bookings.\n- No instrument or staff member overlaps itself on one date (seed bypasses the conflict gate).\n- Every new booking uses `seedBooking({ peopleIds })`, never a hand-written `attendees` string.\n\nAdditions:\n- **People** (ids 9+): per lab — Bio-Photonics: Postdoc, PhD, Technician; Neural Dynamics:\n  Postdoc, MSc, Technician; Therapeutics & Onco-Therapy: Postdoc, PhD, Undergrad. Alex Chen →\n  `Postdoc`, Maya Patel → `PhD` (their notes already say so). Campus/mobile UPDATEs for the new\n  ids; `project_people` rows with roles; a couple added to `grant_users`.\n- **Bookings**: ~16 more via `seedBooking`, day(-42) … day(+14), including **two on day(0)** so\n  the agenda box and instrument profile have content, across all four optical instruments and\n  all three staff, categories consult/training/assisted session/sync, tags reused from the\n  existing set so picker counts read > 1, one same-slot weekly trio for calendar density.\n- **Training**: rows for the new members (mostly `Regular`, one `Super User`). Update the\n  exact-count assertion in `training.test.js`; keep \"exactly one NULL trained_on\" true.\n\n## 7. Extensions / importers concept document (docs only)\n\n**File:** new `docs/plans/extensions-and-importers-concept.md`; one link line in `ROADMAP.md`'s\n\"Migration/import tool\" milestone. Contents: what an extension can and cannot do in a client-only\nPWA (file-in/file-out, `mailto:`, in-browser OAuth are possible; anything needing a server secret\nis not); a proposed `window.Plugins.register({ id, name, kind: 'importer'|'sync'|'exporter', run })`\nregistry surfaced as a Settings \"Extensions\" card; importer notes per target (PPMS/Stratocore,\nBookitLab, Zoom exports, Google Calendar two-way sync via the Calendar API with a stored sync\ntoken); mapping onto existing entities (people/labs, instruments, bookings with their three join\ntables, grants); duplicate and conflict rules (reuse `findBookingConflicts`); open questions.\nMarked `[Unverified]` wherever vendor formats are assumed, matching ROADMAP's caveat.\n\n## 8. Release plumbing (last task)\n\n- Bump to **1.13.0** in `index.html`, `sw.js` (both places), `js/consts.js`; `CHANGELOG.md`\n  `## [1.13.0] — 2026-09-17` with Added/Changed.\n- `docs/index.html`: Highlights cards for the tag picker, instrument profile, dashboard agenda;\n  screenshot numbering checked against the highest existing file.\n- `docs/manual`: training page for the level rename; instruments page for the profile.\n\n## Verification\n\n```bash\nfor f in js/*.js; do node --check \"$f\"; done\nTZ='Asia/Jerusalem' node --test 'test/unit/*.test.js'\nTZ='Asia/Jerusalem' node --test 'test/browser/*.spec.js'   # Playwright + Chromium preinstalled\npython3 -m http.server 8000   # open ?demo=1: booking dialog tag picker (create/reselect/counts);\n                              # person profile single pill; training dialog Regular/Super User;\n                              # Instruments → Open Profile; dashboard agenda box\n```\nAlso export a demo backup before the change and restore it after, to confirm the\n`User → Regular` migration runs on restore as well as on boot.\n"}
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (err) {
    // Not JSON — a bare objective string is fine.
  }
}

const objective =
  (input && typeof input === 'object' && input.objective) ||
  (typeof input === 'string' ? input : null)

if (!objective) {
  throw new Error('cma-plan: provide args.objective (the goal to decompose into tasks)')
}

const repoPath = (input && typeof input === 'object' && input.repoPath) || '(the current repository)'
const constraints = (input && typeof input === 'object' && input.constraints) || 'None beyond keeping tasks small and verifiable.'

// ---- Structured task-graph schema -------------------------------------------
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['objective', 'assumptions', 'tasks', 'batches', 'risks'],
  properties: {
    objective: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'scope', 'depends_on', 'parallel_safe', 'verification'],
        properties: {
          id: { type: 'string', description: 'e.g. T1, T2' },
          title: { type: 'string' },
          scope: { type: 'string', description: 'what to change and which files (absolute paths under the repo)' },
          depends_on: { type: 'array', items: { type: 'string' } },
          parallel_safe: { type: 'boolean' },
          verification: { type: 'string', description: 'an exact, checkable test that proves this task is done' },
        },
      },
    },
    batches: {
      type: 'array',
      description: 'ordered groups of task ids; each inner array runs after the previous group',
      items: { type: 'array', items: { type: 'string' } },
    },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['risk', 'mitigation'],
        properties: { risk: { type: 'string' }, mitigation: { type: 'string' } },
      },
    },
  },
}

const PLANNER_PROMPT = `You are the PLANNING stage of a plan-gated, multi-model build pipeline. You do NOT write code or run commands — you produce a task graph that a separate executor model (Sonnet) will implement and a verifier model (Opus) will check.

TARGET REPOSITORY (absolute path): ${repoPath}
When you name files in a task's "scope", use paths under this repository.

BEFORE ANYTHING ELSE: read ${repoPath}\\docs\\cma-lessons.md if it exists — it is
the pipeline's accumulated experience (which practices succeeded, which failed,
and why, plus this repo's hard invariants). Apply it: bake the relevant
invariants into each task's scope, size tasks per its guidance, and design
verification steps in the styles it says worked.

OBJECTIVE:
${objective}

CONSTRAINTS:
${constraints}

Rules:
- Each task must be small enough to complete in one focused implementation step (about one file or one cohesive change).
- Every task needs concrete, checkable verification (a command to run or a specific file/content to confirm) — never "looks good". Write criteria that are literally satisfiable in the execution environment (e.g. for Apps Script .gs files, write "node --check on a .js copy" — node rejects the .gs extension, so "node --check <file>.gs" is unsatisfiable as written).
- Declare depends_on accurately. Mark parallel_safe true only when a task touches files disjoint from every other task in its batch.
- Prefer reusing existing files/utilities over inventing new ones.
- Order 'batches' by dependency: everything in batch N may assume batches 0..N-1 are done.

Return the task graph via the structured output.`

phase('Plan')

let plan = null
try {
  plan = await agent(PLANNER_PROMPT, {
    label: 'plan:fable',
    model: 'fable',
    effort: 'medium',
    schema: PLAN_SCHEMA,
  })
} catch (err) {
  log(`Fable planning threw (${err && err.message ? err.message : err}); falling back to Opus.`)
}

if (!plan) {
  log('Fable unavailable or returned nothing — falling back to Opus 4.8 for planning.')
  plan = await agent(PLANNER_PROMPT, {
    label: 'plan:opus-fallback',
    model: 'opus',
    effort: 'high',
    schema: PLAN_SCHEMA,
  })
}

if (!plan) {
  throw new Error('cma-plan: both Fable and Opus failed to produce a plan.')
}

log(`Plan ready: ${plan.tasks.length} task(s) across ${plan.batches.length} batch(es).`)
return plan
