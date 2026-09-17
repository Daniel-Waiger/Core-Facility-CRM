export const meta = {
  name: 'cma-execute-1.13.0-b4',
  description: 'CMA execute phase: for each task in an approved plan, Sonnet implements it and Opus adversarially verifies it. Sequential by dependency batch; one retry on failed verification.',
  phases: [
    { title: 'Execute', detail: 'Sonnet 5 implements one task at a time' },
    { title: 'Verify', detail: 'Opus 4.8 adversarially verifies each task' },
  ],
}

// ---- Inputs (via args) -------------------------------------------------------
// args.plan     : object  (required) — the approved task graph from cma-plan
// args.repoPath : string  (required) — absolute path of the repo to work in
// The runtime may deliver args as a JSON string; parse it if so.
let input = {"plan":{"objective":"Release 1.13.0 of Core Facility Tracker on branch claude/jolly-maxwell-95wu0m in /home/user/Core-Facility-CRM: (1) a reusable booking Tags picker with per-tag usage counts (cancelled included) and search-or-create in both booking dialogs only; (2) one role pill on the person profile coloured by a shared Views.typeBadge helper, 'Facility Staff' added to PERSON_TYPES; (3) training levels renamed Regular / Super User with a fenced, idempotent migration of stored 'User' rows; (4) a #/instrument/<id> Instrument Profile route mirroring the person profile (header + New Booking, utilization tiles from Reports aggregations, details, upcoming 14 days, Recent Activity with User / Date / Start–End / Duration / Assisted / Notes / Status and em-dash fallbacks, trained users, active projects); (5) a full-width Today's Agenda card on the Dashboard; (6) a richer demo dataset (9 more people with real roles, 17 more bookings incl. two today, 7 more training rows) respecting every seed/test invariant; (7) a docs-only extensions/importers concept document linked from ROADMAP.md; (8) a final release task bumping index.html/sw.js/js/consts.js to 1.13.0, converting the CHANGELOG '## [Unreleased]' heading to '## [1.13.0] — 2026-09-17', with docs/index.html highlights and manual updates.","assumptions":["Repo /home/user/Core-Facility-CRM, branch claude/jolly-maxwell-95wu0m. Actual HEAD is 34a3f11 ('chore: CMA planner script for the 1.13.0 run'), one tooling commit on top of a106b75 (1.12.1); every js/, css/, test/ and docs/manual file is identical to a106b75. Executors run `git rev-parse --short HEAD` and `git status --short` first; they may see uncommitted work from earlier tasks of THIS run (tags picker, typeBadge, instrument profile, 1.13 fences) and must build on it, never revert it. core.autocrlf is unset and line endings are LF; never introduce CRLF (wiring.test.js and boot-ready-signal.test.js are LF-anchored source scrapers).","Baseline at HEAD: `TZ=Asia/Jerusalem node --test 'test/unit/*.test.js'` -> 318 pass / 0 fail; `TZ=Asia/Jerusalem node --test 'test/browser/*.spec.js'` -> 65 pass / 0 fail (Playwright + Chromium preinstalled, PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers). Every criterion means 'no new failures vs this baseline'; tasks that knowingly change an assertion name it (T1: training.test.js fixture level literals; T10: training.test.js '9 training rows' -> 16). New tests add to the pass count.","Environment: Linux, Node v22.22.2, both python3 and python exist (the lessons file's 'python3 does not exist' note is Windows-only and does not apply). Always pass the test glob, never the directory. Run every check from the repo root with absolute paths.","No git command that mutates the working tree (stash/reset/checkout --/clean/commit/switch/pull) in any task; tasks run back to back with no commits between them, the orchestrator commits after verified batches. Read-only comparisons only: `git diff`, `git show HEAD:<path> > /tmp/claude-0/.../scratchpad/<name>`.","NO VERSION BUMP in T1-T12: index.html ?v=1.12.1 (8 tags), sw.js CACHE_VERSION + PRECACHE_URLS, js/consts.js APP_VERSION all stay 1.12.1 until T13. CHANGELOG bullets from feature tasks go under a `## [Unreleased]` heading (created by T1 directly above `## [1.12.1] — 2026-09-17`); versions.test.js's heading regex needs digits, so that heading does not break it. T13 converts it to `## [1.13.0] — 2026-09-17`.","CLAUDE.md invariants apply to every task and are restated in scope where relevant: dates are local calendar days (UI.ymd / UI.today / UI.todayPlusDays, never toISOString().slice(0,10) - wiring.test.js lints this); selectable = not retired OR already selected; denormalized meetings.attendees is only ever written together with meeting_people (seed uses seedBooking({peopleIds})); explicit child-row deletes in delete paths; Title Case for controls/column headings, sentence case for prose/hints/empty states; danger confirm dialogs keep the red Cancel; aggregation figures come from js/reports.js compute* functions, never re-derived; every literal data-act=\"x\" needs a `case 'x':` inside handleAct's switch and vice versa (wiring.test.js scrapes both directions - so picker option buttons must NOT use data-act); every ic('name') must be a key of ui.js ICONS (home folder users user cpu calendar settings gear plus check check-circle alert x file file-plus sparkles rocket layers compass trash target play chevron chevron-left chevron-right sun moon edit search filter external tag clock eye collapse expand copy mail archive book); js/app.js never reads document.querySelector('.modal') (use UI.topModal()).","Reports API as it exists: `Reports.makeFacts(from, to)` returns a facts bundle bound to that range; `Reports.computeInstrumentRows(from, to, facts)` (three arguments, not one) returns `{ rows, totalHours }` with rows `{ id, name, retired, bookings, hours, revenue, sharePct }` where bookings/hours exclude every cancelled booking and revenue follows the Project Costs rule. It has NO distinct-users figure, so the instrument profile's Distinct Users tile is one small direct query (COUNT(DISTINCT meeting_people.person_id) over this instrument's non-cancelled bookings in range) and is documented as such in the code comment.","Demo seed facts at HEAD (js/db.js seedSampleData): 8 people (ids 1-8; 6,7,8 are Facility Staff), 5 instruments (1 Leica SP8, 2 Olympus FV3000, 3 Zeiss Lightsheet, 4 Nikon AX R, 5 Glacios Cryo-TEM), 3 projects, 3 grants, 14 seedBooking calls (booking #1 'Project Kickoff & Laser Alignment Review' is the lowest meeting id and must keep 490 / 546.25 / 589.95), 9 training rows (exactly one NULL trained_on), exactly one 'workshop' booking, tags in use: STED, Fiji, Napari, Lightsheet, Grant Planning, Workshop. No seeded booking falls on day(0) today. Existing same-day occupancy to avoid (instrument or staff): day(-100) Glacios+staff7 09-12; day(-95) FV3000+staff6 09-11; day(-80) staff6 13:00-14:30; day(-70) staff6 10-11:30; day(-60) Glacios+staff7 14:00-14:45; day(-50) Zeiss+staff7 09-10:30; day(-45) Leica+Nikon+staff6 09-13; day(-30) Zeiss+staff8 09-12; day(-20) staff6 11-11:30; day(-8) Leica+staff6 09-10:30 (cancelled); day(-6) staff8 14-16; day(-3) FV3000 09-11; day(-1) staff8 09-13; day(+10) Nikon+staff6 09-10 (cancelled).","The manual (docs/manual/*.html) currently names the training levels nowhere; the only doc text naming 'User or Super User' is the 1.12.0 Highlights card at docs/index.html line 225. docs/screenshots' highest existing number is 72, so new screenshot slots are 73, 74, 75. Manual pages hard-code 'Chapter N' kickers and use manual.js?v=3; no chapter is inserted, so no renumbering. Docs prose is for facility managers: no 'modal' (say dialog), 'CRUD', 'schema', 'join table', 'denormalized', 'boolean', 'foreign key'.","Test helpers to reuse: test/unit/helpers/load-module.js `loadApp([...names], {search})` returns {CONST, DB, UI, Views, Reports, ...}; test/unit/helpers/sqlite.js `freshDb({search})` boots a real in-memory sql.js DB and `seedFixture(DB)` gives alice=1 (PI), sam=2 (Facility Staff, is_staff), scopeA=1, prepB=2, liveProject=1, archivedProject=2; test/unit/helpers/app-harness.js for app.js internals; test/browser/helpers/browser.js (tryRequirePlaywright, chromiumLaunchOptions, startServer, QUIET_FIRST_RUN, setFlagScript, waitForAppReady) and smoke.spec.js's `viewText(route, id)` pattern for rendering a screen in headless Chromium under ?demo=1."],"tasks":[{"id":"T5","title":"Views.instrumentDetail renderer and Instruments list Open Profile link","scope":"File: /home/user/Core-Facility-CRM/js/views.js. Add `function instrumentDetail(id)` after `instruments()` (before the Calendar section), exported in global.Views next to personDetail, mirroring personDetail's card shape. `const i = DB.row('SELECT * FROM instruments WHERE id=?')`; missing -> `emptyState('cpu', 'Instrument not found', 'This instrument may have been deleted.')`. Cards in order: (1) HEADER `<div class=\"card mb-16\">`: `<span class=\"project-title\">${esc(UI.retiredName(i.name, i.is_retired))}</span>`, kind `<span class=\"chip-sm\">` when set, status badge with the SAME class map as the list row (Available->success, In-use->primary, Down->danger, else warning), a `badge neutral` Retired pill when retired; buttons: `<button class=\"btn btn-secondary btn-sm\" data-goto=\"instruments\">Back to Instruments</button>`, `<button class=\"btn btn-mint btn-sm\" data-act=\"new-booking\" data-date=\"${today()}\" data-inst=\"${i.id}\">${ic('calendar')} New Booking</button>` rendered ONLY when `!i.is_retired` (retired instruments are never offered for new work), `<button class=\"btn btn-primary btn-sm\" data-act=\"edit-instrument\" data-id=\"${i.id}\">Edit Instrument</button>`. (2) UTILIZATION: two `grid cols-4 mb-16` rows labelled This Month / This Year (a `faint small` caption above each). Ranges: `const now = new Date(); const monthFrom = UI.ymd(new Date(now.getFullYear(), now.getMonth(), 1)); const yearFrom = UI.ymd(new Date(now.getFullYear(), 0, 1)); const to = today();` - never toISOString. Per range: `const facts = global.Reports.makeFacts(from, to); const r = global.Reports.computeInstrumentRows(from, to, facts).rows.find((x) => x.id === i.id) || { bookings: 0, hours: 0, revenue: 0 };` and distinct users `DB.row('SELECT COUNT(DISTINCT mp.person_id) AS n FROM meetings m JOIN meeting_instruments mi ON mi.meeting_id=m.id JOIN meeting_people mp ON mp.meeting_id=m.id WHERE mi.instrument_id=? AND m.is_cancelled=0 AND m.date>=? AND m.date<=?', [i.id, from, to]).n` (comment: Reports has no distinct-users figure for instruments; cancelled excluded like occupancy). Tiles: `<div class=\"card stat\" data-tile=\"${prefix}-bookings\" data-value=\"${r.bookings}\"><span class=\"n\">${r.bookings}</span><span class=\"l\">Bookings</span></div>`, `${prefix}-hours` with data-value = raw `r.hours` and text `Math.round(r.hours * 100) / 100`, `${prefix}-users` (n), `${prefix}-charges` with data-value raw `r.revenue` and text `UI.fmtMoney(r.revenue)`; prefix 'month' / 'year'; labels Bookings · Booked Hours · Distinct Users · Charges. Caption sentence: 'Cancelled bookings are excluded from bookings and hours; charges follow the Project Costs rule.' (3) DETAILS card (`metadata-grid`/`meta-item` like personDetail, dv() for em-dash fallbacks): Modality / Kind, Status, Location, Cost (`UI.fmtMoney(i.cost||0)`), Billed Per (`UI.unitLabel(i.cost_unit||'time')`), Min Duration / Max Duration (`${n} min` or '—' when 0), Min Gap (`${n} min` or '—'), Min Notice (`${n} h` or '—'), Supervisors (`GROUP_CONCAT(pe.name || CASE WHEN pe.is_retired THEN ' (Retired)' ELSE '' END, ', ')` from instrument_staff), Config Notes (span 2). (4) UPCOMING BOOKINGS: `SELECT m.id, m.title, m.date, m.start_time, m.end_time, users, assisted FROM meetings m JOIN meeting_instruments mi ON mi.meeting_id=m.id WHERE mi.instrument_id=? AND m.is_cancelled=0 AND m.date>=? AND m.date<=? ORDER BY m.date, m.start_time, m.id` with `[i.id, today(), UI.todayPlusDays(14)]`; columns Date · Time · Title · User · Assisted; rows `<tr class=\"row-link\" data-act=\"edit-booking\" data-id=\"${m.id}\">`; empty -> `emptyState('calendar', 'Nothing booked in the next 14 days', 'Upcoming bookings on this instrument will appear here.')`. (5) RECENT ACTIVITY: same join, `m.date <= today()` ORDER BY m.date DESC, m.start_time DESC, m.id DESC LIMIT 25, cancelled KEPT; subselects `users` = GROUP_CONCAT of meeting_people names with the retired CASE suffix, `assisted` = GROUP_CONCAT of meeting_staff names with the same CASE; columns exactly `<th>User</th><th>Date</th><th>Start–End</th><th>Duration</th><th>Assisted</th><th>Notes</th><th>Status</th>`; cells: User `m.users ? esc(m.users) : '—'`; Date `fmt(m.date)`; Start–End `m.start_time ? esc(m.start_time) + (m.end_time ? '–' + esc(m.end_time) : '') : '—'`; Duration via a module helper `durationLabel(start, end)`: `const h = UI.hoursBetween(start, end); if (!h) return '—'; const H = Math.floor(h), M = Math.round((h - H) * 60); return H + 'h ' + M + 'm';` (1.5 -> '1h 30m', 2 -> '2h 0m'); Assisted `m.assisted ? esc(m.assisted) : '—'`; Notes via helper `notePreview(note)`: html = UI.noteHtml(note); strip tags `/<[^>]*>/g` -> ' ', decode &amp; &lt; &gt; &quot; &#39; &nbsp;, collapse whitespace, trim; '' -> '—'; else `<span title=\"${esc(full)}\">${esc(full.length > 80 ? full.slice(0, 79) + '…' : full)}</span>`; Status `m.is_cancelled ? '<span class=\"badge danger\">Cancelled</span>' : '—'`; row class `row-retired` when cancelled; footer hint 'Showing the 25 most recent bookings on this instrument. Cancelled bookings are kept and marked.'; empty -> `emptyState('calendar', 'No bookings yet', 'Bookings on this instrument will show up here.')`. (6) TRAINED USERS: `DB.listInstrumentTraining(i.id)`; columns Person · Level · Trained On · Trainer · Expires On (+ status badge via `DB.trainingStatusOn(rec, today())` exactly like personDetail: Expired -> badge warning, pending -> 'Not Yet Valid' badge neutral); Person `UI.retiredName(rec.person_name, rec.person_retired)` as `<td class=\"row-link\" data-goto=\"person\" data-id=\"${rec.person_id}\">`; Trainer needs a trainer name: extend nothing in db.js - do a second lookup map `DB.rows('SELECT id, name, is_retired FROM people')` and resolve `rec.trainer_id` in JS with UI.retiredName ('—' when null); empty -> `emptyState('cpu', 'No trained users yet', 'Training records are added from a person\\'s profile.')`. (7) ACTIVE PROJECTS: `SELECT p.id, p.code, p.title, p.status, p.is_archived FROM project_instruments pi JOIN projects p ON p.id=pi.project_id WHERE pi.instrument_id=? ORDER BY p.is_archived, p.title` rows `<tr class=\"row-link ${archived ? 'row-retired' : ''}\" data-goto=\"project\" data-id>` with Code · Title · Status (statusBadge + Archived pill); empty -> `emptyState('folder', 'No projects yet', 'Projects this instrument is assigned to will appear here.')`. Instruments list row (~line 985): `<tr class=\"row-link ${r.is_retired ? 'row-retired' : ''}\" data-goto=\"instrument\" data-id=\"${r.id}\">` and prepend `<button class=\"btn btn-ghost btn-xs\" data-goto=\"instrument\" data-id=\"${r.id}\" title=\"Open Profile\">${ic('chevron')}</button>` to its Actions cell (same as the People list). Only icons from the ICONS list; Title Case for headings/buttons, sentence case for captions/empty states. Also add `instrumentDetail` to the global.Views export. Note: until T7 lands, clicking the row routes to the dashboard (hashFor fallback) - expected.","depends_on":["T3"],"parallel_safe":false,"verification":"From /home/user/Core-Facility-CRM: `node -e \"const {loadApp}=require('./test/unit/helpers/load-module');const {seedFixture}=require('./test/unit/helpers/sqlite');(async()=>{const a=loadApp(['consts','db','ui','views','reports']);globalThis.initSqlJs=require('./libs/sql-asm.js');await a.DB.boot();seedFixture(a.DB);const {DB,UI,Views,Reports}=a;const d=new Date();const from=UI.ymd(new Date(d.getFullYear(),d.getMonth(),1));DB.run(\\\"INSERT INTO meetings (title,date,start_time,end_time) VALUES ('Solo run',?,'09:00','10:30')\\\",[from]);DB.run('INSERT INTO meeting_instruments (meeting_id,instrument_id,amount,line_cost) VALUES (1,1,0,300)');const h=Views.instrumentDetail(1);const t=(k)=>(h.match(new RegExp('data-tile=\\\"'+k+'\\\" data-value=\\\"([^\\\"]+)\\\"'))||[])[1];const row=h.split('Solo run')[0].split('<tr').pop();console.log(t('month-bookings'),t('month-hours'),t('month-users'),t('month-charges'),h.includes('1h 30m'),(h.split('<th>User</th><th>Date</th><th>Start–End</th><th>Duration</th><th>Assisted</th><th>Notes</th><th>Status</th>').length-1),Reports.computeInstrumentRows(from,UI.today()).rows[0].hours,(h.match(/data-act=\\\"new-booking\\\" data-date=\\\"[0-9-]+\\\" data-inst=\\\"1\\\"/)||[]).length,Views.instrumentDetail(99).includes('Instrument not found'))})()\"` prints `1 1.5 0 300 true 1 1.5 1 true`. `grep -c 'data-goto=\"instrument\"' js/views.js` prints 2 (row + chevron button). `grep -c 'Views\\.instrumentDetail\\|instrumentDetail,' js/views.js` prints at least 1 (export). `grep -o \"ic('[a-z-]*')\" js/views.js | sort -u` contains only names from the ICONS list. `node --check js/views.js` exits 0. `TZ=Asia/Jerusalem node --test 'test/unit/*.test.js'` 0 fail (wiring.test.js's date lint and icon check pass). `TZ=Asia/Jerusalem node --test 'test/browser/smoke.spec.js'` passes (instruments list renders with the new link, 0 JS errors)."}],"batches":[["T5"]],"risks":[{"risk":"js/app.js, js/views.js and js/db.js are each touched by several tasks; an executor starting from a stale mental model (or a verifier extracting HEAD copies) could undo an earlier task's uncommitted work.","mitigation":"Batches are strictly sequential for shared files; every task's scope names the exact anchors it edits and tells the executor to expect and build on earlier uncommitted work; no task uses a git command that mutates the tree; HEAD comparisons only via `git show HEAD:<path> > scratchpad`."},{"risk":"wiring.test.js scrapes every literal data-act and every handleAct case; the tag picker's option/create/remove buttons or the profile's rows could introduce an unwired data-act (or a CRLF line ending could make the scraper throw before asserting, hiding the gap).","mitigation":"T4 wires picker buttons with addEventListener and explicitly forbids data-act on them; T5/T7/T8 emit only existing values (new-booking, edit-booking, edit-instrument, toggle-ms-status) plus data-goto; every task runs the unit suite and T7 adds the TITLES/HASH_ROUTES asymmetry assertions; assumptions require LF and a passing (not throwing) scraper."},{"risk":"The tag dropdown uses the `hidden` attribute on a flex container - exactly the #41 T5 failure where `.field { display: flex }` defeated `[hidden]` and no unit test could see it.","mitigation":"T4 requires the `.tag-dropdown[hidden] { display: none; }` rule, verifies it by grep, and adds a browser spec that asserts the dropdown becomes visible on focus and that the hidden input's value round-trips through create/select/remove in headless Chromium."},{"risk":"Instrument profile utilization figures could drift from the Reports screen (re-derived hours/money), or the Distinct Users tile could be mistaken for a Reports figure.","mitigation":"T5 reads bookings/hours/revenue only from Reports.makeFacts + Reports.computeInstrumentRows(from, to, facts) and exposes raw values via data-value; T6 asserts tile values equal computeInstrumentRows for the same range including a cancelled-retained booking; the distinct-users query is documented as a direct query with the same cancelled-excluded rule."},{"risk":"Demo seed additions could break hard invariants: booking #1 losing lowest id or its 490 / 546.25 / 589.95 figures, a second 'workshop' booking, same-day instrument/staff self-overlap (the seed bypasses the conflict gate), or attendees strings without meeting_people rows.","mitigation":"T10 appends bookings in a fenced block after every existing call, forbids the workshop category and hand-written attendees, lists concrete non-overlapping slots against the recorded occupancy, and its verification runs a self-join overlap query (expected 0), checks MIN(id) and the three figures, countBookingCategoryRefs('workshop') === 1 and a zero count of attendee strings lacking join rows."},{"risk":"Date handling east of Greenwich: month/year range boundaries or 'today' comparisons built with toISOString would show yesterday's data.","mitigation":"Scopes mandate UI.ymd(new Date(y, m, 1)) / UI.today() / UI.todayPlusDays; wiring.test.js's date lint runs in every task; all suites run under TZ=Asia/Jerusalem and the browser context uses timezoneId Asia/Jerusalem."},{"risk":"The training-level migration might run on boot but not on restore, or the seed/tests might still write 'User' somewhere, leaving mixed vocabularies.","mitigation":"T1 places the UPDATE inside migrate() (which restoreBackup also runs), tests it on a raw sql.js DB via the fence-extracted SQL and through a real buildBackup/restoreBackup round trip, and greps that `level='User'` appears exactly once in db.js (the migration itself); T13 repeats the export-then-restore check on the seeded demo."},{"risk":"Documentation claims drifting from code (the repo's recorded 23-false-claims history), and stale labels such as 'User or Super User' surviving in docs.","mitigation":"T12 and T13 must verify each doc sentence against js/ as it now is, not against CHANGELOG; T12's verification greps the old level wording to 0; the release CHANGELOG tidy-up is wording-only with per-dialog/per-screen phrasing rather than 'the export' generalities."},{"risk":"Forgetting the three-place version bump makes every js/css change invisible behind the service worker, or bumping early breaks versions.test.js mid-run.","mitigation":"All feature tasks are forbidden from touching the version strings; T13 alone bumps index.html (8 tags), sw.js (CACHE_VERSION + 8 PRECACHE_URLS) and js/consts.js together and converts the Unreleased heading, with grep counts and versions.test.js as the gate."}]},"repoPath":"/home/user/Core-Facility-CRM"}
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (err) {
    throw new Error('cma-execute: args arrived as a string that is not valid JSON: ' + (err && err.message ? err.message : err))
  }
}
const plan = (input && input.plan) ? input.plan : input
const repoPath = input && input.repoPath

if (!plan || !Array.isArray(plan.tasks) || plan.tasks.length === 0) {
  throw new Error('cma-execute: provide args.plan (a task graph with a non-empty tasks[])')
}
if (!repoPath) {
  throw new Error('cma-execute: provide args.repoPath (absolute path of the repo to edit)')
}

// Schema hardening (2026-07-13): only truly-essential fields are `required`.
// Models omit empty-array/obvious fields even when the prompt spells them out
// (three retry-cap deaths: two on 'problems', one after 5 attempts on a PASS
// verdict). The script normalizes omitted fields to safe defaults instead of
// letting the schema kill the run. Prompts still describe every field.
const EXEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['task_id', 'outcome'],
  properties: {
    task_id: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'summary'],
        properties: { file: { type: 'string' }, summary: { type: 'string' } },
      },
    },
    commands_run: { type: 'array', items: { type: 'string' } },
    verification: { type: 'string' },
    outcome: { type: 'string', enum: ['done', 'blocked'] },
    next_step: { type: 'string' },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['task_id', 'pass', 'evidence'],
  properties: {
    task_id: { type: 'string' },
    pass: { type: 'boolean' },
    evidence: { type: 'string' },
    problems: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
  },
}

// ---- Prompt builders ---------------------------------------------------------
function execPrompt(task, priorFeedback) {
  return `You are the EXECUTION stage of a plan-gated build pipeline. Complete EXACTLY ONE task.

TARGET REPOSITORY (absolute path): ${repoPath}
IMPORTANT: All file operations MUST be inside this repository. Use absolute paths under it. Do not touch files elsewhere.

BEFORE ANYTHING ELSE: read ${repoPath}/docs/cma-lessons.md if it exists — it carries this repo's hard invariants (things that broke production before) and the practices that made past tasks pass verification first-try. Apply it.

TASK ${task.id}: ${task.title}
Scope: ${task.scope}
Verification criteria (you must satisfy this): ${task.verification}
${priorFeedback ? `\nA previous attempt FAILED verification. Fix exactly these problems:\n${priorFeedback}\n` : ''}
Rules:
- Make only the changes this one task requires. Do not start other tasks.
- Reuse existing code/utilities where possible.
- After editing, run the smallest command that exercises your change (from within ${repoPath}).
- If you cannot complete it, set outcome "blocked" and explain the exact missing piece.

Report via the structured output.`
}

function verifyPrompt(task, exec) {
  return `You are the VERIFICATION stage of a plan-gated build pipeline. A different model (Sonnet) just implemented a task. ADVERSARIALLY verify it — assume it may be wrong and try to prove it is NOT done. Do NOT fix anything; you judge.

TARGET REPOSITORY (absolute path): ${repoPath}

BEFORE ANYTHING ELSE: read ${repoPath}/docs/cma-lessons.md if it exists — its lessons name the failure modes worth hunting (repo invariants that static checks miss) and the verification styles that caught real defects (concrete adversarial traces, truth tables, byte-identical regression diffs, runtime harnesses for arithmetic).

TASK ${task.id}: ${task.title}
Scope: ${task.scope}
Verification criteria the change must meet: ${task.verification}

The executor reported:
- outcome: ${exec ? exec.outcome : '(none)'}
- verification claim: ${exec ? exec.verification : '(none)'}
- changes: ${exec ? JSON.stringify(exec.changes) : '[]'}

Do NOT trust that report. Independently inspect the actual files under ${repoPath} and run the relevant check yourself. Set pass=false if the criteria are not genuinely met, if files are missing/wrong, or if you are uncertain.

Report via the structured output. Your StructuredOutput call MUST include ALL FIVE fields in one object — omitting any of them is a schema error that wastes a retry:
- task_id (string): "${task.id}"
- pass (boolean)
- evidence (string): what you inspected and what you found
- problems (array of strings): REQUIRED even when empty — pass [] when there are no problems
- recommendation (string): REQUIRED — e.g. "accept" when passing, or the one-line fix when failing`
}

// ---- Normalizers: default any schema-optional field the model omitted --------
function normExec(e) {
  if (!e) return e
  e.changes = Array.isArray(e.changes) ? e.changes : []
  e.commands_run = Array.isArray(e.commands_run) ? e.commands_run : []
  e.verification = typeof e.verification === 'string' ? e.verification : ''
  e.next_step = typeof e.next_step === 'string' ? e.next_step : ''
  return e
}
function normVerdict(v) {
  if (!v) return v
  v.problems = Array.isArray(v.problems) ? v.problems : []
  v.recommendation =
    typeof v.recommendation === 'string' && v.recommendation
      ? v.recommendation
      : v.pass
        ? 'accept'
        : 'see problems/evidence'
  return v
}

// ---- Execution: sequential, in dependency-batch order ------------------------
const byId = {}
for (const t of plan.tasks) byId[t.id] = t

// Fall back to a single batch of all task ids (in given order) if none provided.
const batches =
  Array.isArray(plan.batches) && plan.batches.length > 0
    ? plan.batches
    : [plan.tasks.map((t) => t.id)]

const results = []

for (let b = 0; b < batches.length; b++) {
  for (const id of batches[b]) {
    const task = byId[id]
    if (!task) {
      log(`Skipping unknown task id "${id}" referenced in batches.`)
      continue
    }

    phase('Execute')
    let exec = normExec(await agent(execPrompt(task, null), {
      label: `exec:${id}`,
      model: 'sonnet',
      phase: 'Execute',
      schema: EXEC_SCHEMA,
    }))

    phase('Verify')
    let verdict = normVerdict(await agent(verifyPrompt(task, exec), {
      label: `verify:${id}`,
      model: 'opus',
      phase: 'Verify',
      schema: VERIFY_SCHEMA,
    }))

    // One retry if verification failed, feeding the verifier's problems back.
    if (verdict && verdict.pass === false) {
      const feedback = (verdict.problems || []).join('\n') || verdict.evidence || 'unspecified'
      log(`Task ${id} failed verification; retrying once with feedback.`)
      exec = normExec(await agent(execPrompt(task, feedback), {
        label: `exec:${id}:retry`,
        model: 'sonnet',
        phase: 'Execute',
        schema: EXEC_SCHEMA,
      }))
      verdict = normVerdict(await agent(verifyPrompt(task, exec), {
        label: `verify:${id}:retry`,
        model: 'opus',
        phase: 'Verify',
        schema: VERIFY_SCHEMA,
      }))
    }

    const passed = !!(verdict && verdict.pass)
    results.push({ id, title: task.title, exec, verdict, passed })
    log(`Task ${id} → ${passed ? 'VERIFIED' : 'NOT verified'}.`)

    // Stop the batch chain on a hard failure so dependents don't build on a broken base.
    if (!passed) {
      log(`Stopping: task ${id} did not pass verification after retry. Downstream tasks skipped.`)
      return { completed: results, stoppedAt: id, allPassed: false }
    }
  }
}

return { completed: results, stoppedAt: null, allPassed: true }
