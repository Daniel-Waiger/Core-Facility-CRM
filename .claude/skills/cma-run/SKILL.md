---
name: cma-run
description: Standing execution scheme — well-scoped work runs warm-context direct, unclear-scope work gets full Opus/Fable-orchestrated multi-agent planning, and Opus/Fable ALWAYS verifies at the end either way. Sonnet executes, Haiku handles quick/short-context ops. Use for any substantial task or multi-task implementation work.
---

# /cma-run — the CMA multi-agent scheme

CMA = **C**laude **M**ulti-**A**gent. This names a Workflow pipeline, not a
registered slash command elsewhere unless a project also installs it as one.

> **This copy is the canonical one.** It is vendored into the repo so that any
> machine or account with a clone gets the scheme automatically, with no
> install step. See "Installing this skill" at the bottom. Edit *this* file,
> then re-run the installer to push it out to `~/.claude/skills/`.

## The master decision rule (2026-07-29)

1. **Scope is well-defined** (a task graph already exists with per-task
   scope + verification text, or the ask is otherwise unambiguous) →
   **warm-context direct execution.** Implement it yourself in the
   already-warm session, whichever model that happens to be. Don't spin up
   a separate orchestrator agent just to re-decide what a task graph already
   decided.
2. **Scope is NOT well-defined** (the ask needs real planning, tradeoffs,
   or judgment before anyone can say what "done" looks like) → **invoke the
   full scheme**: Opus or Fable orchestrates a real planning pass (task
   graph JSON + plan.md), Sonnet executes the resulting tasks.
3. **Either way, once the work is over, Opus (or Fable) verifies — in ALL
   cases, no exception.** Warm-context execution skips the per-task
   subagent dispatch, not the verification gate. A session that
   self-implements without ever having a stronger model check its own work
   has not been verified, regardless of how well-scoped the task was.

This is the standing rule; the "roles" and "warm-context" sections below
describe the mechanics once you know which of the two paths you're on.

## Roles and model assignment

This is the standing assignment; do not substitute a different tier without
a stated reason (scarce budget, model unavailability):

- **Plan/orchestrate — Claude Opus or Claude Fable, whichever fits
  availability and need.** Neither is fixed to the role; pick per run (e.g.
  Fable when it's available and the plan is mostly synthesis/drafting, Opus
  when the planning itself needs its deeper reasoning, or when Fable isn't
  available). Whichever is acting orchestrates: reads all relevant context,
  emits a task graph JSON (one file/one concern tasks, explicit `depends_on`
  and batches) plus a prose `plan.md`, owns dispatch, and makes the final
  judgment calls a run needs mid-flight.
- **Execute — Claude Sonnet.** Each planned task is dispatched to a
  `general-purpose` subagent running on Sonnet, one concern at a time. Sonnet
  is the default execution tier for real implementation work — writing code,
  writing tests, fixing a defect a verifier found.
- **Verify — Claude Opus (or Fable).** Mandatory in ALL cases per the master
  decision rule above — including warm-context runs with no separate
  orchestrator. Adversarial verification: concrete adversarial traces (not
  "check it works"), proving the mechanism rather than the surface,
  falsifying the literal spec before accepting a deviation. Reserve the
  strongest reasoning tier for this because a verifier's false pass ships a
  defect; a verifier's false fail just costs a retry. On a warm-context run
  this is typically one Opus/Fable pass at the end of the session's work,
  not necessarily per-task — but it must happen before the work is called
  done.
- **Learn — the cma-learner stage.** After a run, merges genuine pipeline
  lessons into the lessons files (see below), dedupes, and prunes.
- **Haiku — quick, short-context, mechanical ops.** Anything that doesn't
  need long context or judgment: git/GitHub housekeeping (branch prune,
  push, PR create/merge, tagging), simple file moves, rerunning a test suite
  to confirm a status, straightforward status checks. Dispatch these to a
  Haiku subagent with **explicit, detailed instructions** — Haiku has less
  headroom for ambiguity than Sonnet/Opus, so spell out the exact command(s),
  expected output, and what "done" looks like rather than a vague goal.
  Never run these directly from an expensive model's own context: that
  burns premium-tier tokens on work a cheap tier does just as well.

## Token economy — tactical and strategic

Economize **where it makes sense**, not reflexively — a scheme that always
picks the cheapest option produces worse plans and misses real defects.

- **Strategic (the model-assignment table above):** put expensive reasoning
  where a wrong answer is costly (planning, verification of load-bearing
  invariants) and cheap/fast models where the task is mechanical and
  well-specified (Haiku for GitHub ops, Sonnet for implementation once a
  task is scoped tightly).
- **Always prioritize warm-context execution where possible (standing rule,
  2026-07-29 — not just a scarce-budget carve-out).** Every subagent dispatch
  starts a COLD context and re-pays full first-read cost for the lessons
  files, the plan doc, and the touched source files — cost the current
  session's own context has often already paid. Default to implementing a
  planned task directly in whichever already-warm context is doing the
  orchestrating (Opus's or Fable's, whichever is acting) or the acting
  executor's, rather than dispatching
  a fresh subagent for it, whenever the task doesn't specifically need what
  only a subagent gives you.
  - Dispatch a real subagent (with adversarial verification) only when the
    task needs something warm context structurally cannot provide: genuine
    isolation (an independent skeptical read that must not see the
    implementer's own reasoning), true file-disjoint parallelism (several
    tasks genuinely running at once), or a task class this run has already
    burned on (silent overwrite/auto-apply, UI state, policy text) where a
    fresh, unbiased pass is the point.
  - This sharpens, not overrides, the Haiku-for-GitHub-ops and
    Sonnet-executes/Opus-verifies assignments: warm-context-first decides
    *whether* to dispatch at all; the role table decides *which tier*
    handles it once dispatch is warranted. A scarce budget makes the
    warm-context case even stronger, but tight quota is no longer the
    trigger — it's a default posture.
  - Don't reach for prompt-caching tiers or the Batch API as a lever here:
    those are pay-per-token API accounting concepts and don't apply to a
    subscription's rate-limited quota. The actual lever is warm-context-first
    above.
- **Batch every dashboard update.** Each flag on `update.py` is repeatable,
  so one call closes a whole batch. Ticking task-by-task is the difference
  between a dashboard that costs a rounding error and one that costs real
  quota for no extra accuracy.

## Always show the dashboard — on EVERY run, both paths

The dashboard is not optional and not only for the full-scheme path. **Every
piece of cma-run work gets one**, including warm-context direct execution and
including one-off mechanical ops (those just get a `--log` line rather than a
task board). If you are doing cma-run work and the board isn't tracking it,
you are not following the scheme.

The dashboard is **generalist** — it knows nothing about any particular run,
project, or task vocabulary, and it looks identical on every run. Never adapt
the page to a run; feed the run's data to the page. In `tools/cma-dashboard/`:

1. **Start**, seeding the board straight from the run's task graph instead of
   typing tasks in by hand:
   `python update.py --new-run "<name>" --orch <model> --path <warm|full> --from-task-graph`
   The bare `--from-task-graph` flag **auto-discovers** the graph at
   `.cma/task-graph.json`, `cma/`, `docs/cma/` or the dashboard directory —
   pass a path only to override. It reads id/title and derives each phase from
   the graph's `batches`, falling back to a per-task `phase`. `--new-run`
   clears all prior run state so a new run never inherits the last one's board.
   Re-running `--from-task-graph` mid-run **merges** newly-planned tasks in
   without disturbing progress.
2. **Serve it** during the run (`python update.py --serve`, port 8777) and open
   it, so progress is visible without asking.
3. **Drive it as tasks move** — `--task ID=STATUS[:BY[:MODE]]`, `--stat K=V[:tone]`,
   `--current ID TITLE`, `--defect-add` / `--defect-clear`, `--log MSG`,
   `--edge FROM>TO[:label]` — not only at the end. A board updated once at the
   finish is a report, not a dashboard. Batch a whole transition into one call.

**Never hand-edit the dashboard HTML to change what it displays.** `update.py`
rewrites the page's embedded offline snapshot from `status.json` on every
call, which is what keeps the no-server view (opened over `file://`, or
published as an artifact) from silently going stale. Editing the HTML is how
that snapshot rotted for weeks previously. If the board is showing the wrong
thing, fix the data. `python update.py --doctor` checks the sentinels, the
gitignore entry and both lessons files in one shot.

That embedded snapshot is also what makes the board portable: because the
tracked `index.html` carries the state inside it, any other machine just
needs `git pull` + double-click — no install, no server. So **commit
`index.html` at run checkpoints** (end of a batch, end of a run, at
handover) as part of the run's normal commits. Not on every task tick, which
would spam history — that's why the live `status.json` is gitignored.

Status vocabulary is fixed: `pending running verifying done resolved failed
paused idle` — `resolved` means *failed, then fixed*; never relabel a
repaired failure as `done`, it erases the run's real defect history.

### The agent network panel

The board draws the live dispatch topology — orchestrator, executor, verifier,
ops, learner — with edge weight proportional to traffic. It costs nothing to
maintain: every number is **derived from the task records `--task` already
writes**, recomputed from scratch on each save rather than incremented, so it
cannot drift or double-count.

Its point is not decoration. A graph that looked the same on every run would
be worth nothing; this one is anchored on the **warm/cold ledger**, which is
the scheme's one genuinely contested claim. `MODE` on `--task` is `warm` (done
in already-paid context) or `cold` (a subagent dispatch that re-paid the
first-read cost), and the panel reports the ratio. That makes adherence to
warm-context-first *auditable after the fact* instead of aspirational.

**Motion means "happening right now", not "happened at some point".** The board
re-reads `status.json` every two seconds and diffs it against the previous
read, so a task that changed status since the last poll is an event it can
animate: a packet flies down the lane that transition crossed, and every node
with work in flight wears a pulsing halo. The legend is three-state and worth
keeping straight — **moving** = carrying work this instant, **solid** = used
earlier in the run, **dashed** = never used. If everything animated forever the
movement would stop carrying information, which is the failure mode this
replaced. So drive the board *as tasks move*: ticking only at the end still
produces a correct ledger, but you watch a dead diagram.

Set `MODE` explicitly when you know it. Left off, it defaults to `warm` for
the orchestrator tier and `cold` for everything else, which is right far more
often than not but is still a guess.

## Living lessons files — two scopes

Planner, executor, and verifier agents MUST read **both** before starting work
and apply them unprompted:

- **Global — `~/.claude/cma-lessons.md`.** Lessons about *the pipeline*:
  true on any codebase. Cost, verification discipline, bookkeeping.
- **Repo — `docs/cma-lessons.md`.** Lessons about running CMA on *this*
  codebase: its traps, its verification story, its environment.

**Scope test:** if the lesson names a file, table or convention from one
project, it is repo-scoped; if a different project would benefit, it is
global. Read global first, repo second — **on a genuine conflict the repo file
wins**, because it knows its own codebase. A repo lesson that merely restates
an architecture rule from `CLAUDE.md` should be deleted; point at `CLAUDE.md`
instead, and keep this file for how the pipeline keeps *breaking* those rules.

`update.py --lesson "text" [--scope repo|global]` appends a dated entry. The
cma-learner stage owns merging — dedupe, add "seen ×N" to recurring ones,
delete lessons that stop earning their space. A project without a repo file
yet should create it on the first CMA run.

## Committing and pushing

Executors never run `git commit`, `git push`, or open a PR — the
orchestrator (or a dispatched Haiku admin-ops subagent, per the role above)
owns deployment, and only after the user has confirmed a push/PR
explicitly. Unverified work must not reach shared history.

## Installing this skill

**On a machine that has cloned this repo: nothing to do.** Claude Code
auto-discovers `.claude/skills/` in the project, so the skill is live for
this project the moment the clone exists, and `git pull` keeps it current.
That is the intended path for a second account.

To make it available in *every* project on that machine, promote it to the
user scope:

```bash
python .claude/skills/cma-run/install.py
```

It copies this file to `~/.claude/skills/cma-run/SKILL.md` and seeds
`~/.claude/cma-lessons.md` if absent. It **never silently overwrites**: if a
global copy already exists and differs, it prints the diff and stops until you
pass `--force`. Sync is one-directional — repo is canonical, global is a copy —
so edit the file here and re-run the installer rather than editing the global
copy and hoping the two stay in step.
