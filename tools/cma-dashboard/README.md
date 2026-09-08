# CMA run dashboard

A generalist board for [the CMA scheme](../../.claude/skills/cma-run/SKILL.md).
Stdlib Python + one static HTML file — no build, no dependencies, matching this
repo's no-toolchain ethos.

**It looks the same on every run.** The page knows nothing about any project or
task vocabulary; all content arrives as data. Never adapt the page to a run.

```
index.html               the template + the committed offline snapshot  (tracked)
update.py                the only thing that writes to it
status.json              live run state                                 (gitignored)
task-graph.example.json  the shape --from-task-graph reads
```

## Run one

```bash
# 1. seed straight from the run's task graph (auto-discovers .cma/task-graph.json)
python update.py --new-run "Auth rework" --orch opus --path full --from-task-graph

# 2. watch it
python update.py --serve            # http://localhost:8777

# 3. drive it — batch a whole transition into ONE call, every flag repeats
python update.py \
  --task T1=done:sonnet:cold --task T2=done:sonnet:cold \
  --task T3=running:opus:warm --current T3 "Rebuild the token picker" \
  --stat "Batch=2 of 4" --log "batch 1 closed"

# 4. when verification bounces something back
python update.py --task T2=failed:opus --defect-add "drops retired owners on save"
python update.py --task T2=resolved:sonnet:cold --defect-clear

# 5. sanity check the whole toolchain
python update.py --doctor
```

On Windows use `python`; `python3` is not installed here.

## Flags

| Flag | Meaning |
|---|---|
| `--new-run NAME` | clear **all** prior state, start fresh |
| `--orch MODEL` / `--path warm\|full` | which model orchestrated, which arm of the decision rule |
| `--from-task-graph [PATH]` | seed tasks; bare flag auto-discovers. Re-run mid-flight to **merge** new tasks |
| `--task ID=STATUS[:BY[:MODE]]` | move a task. `MODE` is `warm` or `cold` |
| `--current ID TITLE` | highlight the task in flight |
| `--stat K=V[:tone]` | a headline number. Tones: `good warn bad neutral` |
| `--defect-add TEXT` / `--defect-clear` | open defects |
| `--log MSG` | run log line — the cheap path for one-off ops |
| `--edge FROM>TO[:label]` | an extra agent-network edge |
| `--lesson TEXT --scope repo\|global` | append to a lessons file |
| `--show` / `--doctor` / `--serve [PORT]` | print state / self-check / serve |

Statuses are fixed: `pending running verifying done resolved failed paused
idle`. **`resolved` means failed-then-fixed** — never relabel a repaired
failure as `done`, that erases the run's defect history.

## Two things that are load-bearing

**Never hand-edit `index.html` to change what it shows.** `update.py` rewrites
the snapshot between the `CMA:SNAPSHOT` sentinels on every call. That snapshot
is why the board works over `file://` on a machine that never ran the tooling —
`git pull`, double-click, done. Hand-editing is how it silently goes stale.
`--doctor` verifies the sentinels survive.

**The agent network costs nothing to maintain.** Every node count and edge
weight is derived from the task records `--task` already writes, recomputed
from scratch on each save rather than incremented — so it can't drift or
double-count. It is anchored on the **warm/cold ledger** deliberately: a
topology diagram that looked identical every run would be decoration, whereas
the ratio of warm work to cold dispatches is the scheme's one contested claim,
and this makes adherence auditable rather than aspirational.

Commit `index.html` at checkpoints (end of a batch, end of a run, at handover),
not on every tick — that's why `status.json` is gitignored.
