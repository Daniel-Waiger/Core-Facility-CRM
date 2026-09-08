#!/usr/bin/env python3
"""
CMA dashboard driver.

The dashboard is GENERALIST: index.html knows nothing about any run. All run
content lives in status.json (live, gitignored) and in an embedded snapshot
that this script rewrites inside index.html on every call, so the board is
also readable over file:// on a machine that never ran the tooling.

    NEVER hand-edit index.html to change what it displays. Fix the data.

Usage (every flag below is repeatable -- batch a whole transition into ONE
call, that is the difference between a cheap dashboard and an expensive one):

    python update.py --new-run "Auth rework" --orch opus --from-task-graph .cma/task-graph.json
    python update.py --task T1=done:sonnet:cold --task T2=running:opus:warm --log "batch 1 closed"
    python update.py --current T3 "Rebuild the token picker"
    python update.py --stat "Coverage=81%:good" --defect-add "msEditSave drops retired owners"
    python update.py --show
    python update.py --serve

Stdlib only. No build step, matching this repo's no-toolchain ethos.
"""

import argparse
import datetime as _dt
import json
import os
import re
import sys

# Windows consoles default to a legacy codepage that mangles anything
# non-ASCII a planner may have put in a task title.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):  # pragma: no cover - very old/odd stdio
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
STATUS = os.path.join(HERE, "status.json")
INDEX = os.path.join(HERE, "index.html")

SNAP_START = "<!--CMA:SNAPSHOT:START-->"
SNAP_END = "<!--CMA:SNAPSHOT:END-->"

# Fixed vocabulary. `resolved` means FAILED, THEN FIXED -- never relabel a
# repaired failure as `done`, that erases the run's real defect history.
STATUSES = ["pending", "running", "verifying", "done",
            "resolved", "failed", "paused", "idle"]
TONES = ["good", "warn", "bad", "neutral"]
MODES = ["warm", "cold"]

# Agent-network nodes. Fixed topology: the scheme's shape does not vary per
# run, only the traffic across it does.
NODES = ["orchestrator", "executor", "verifier", "ops", "learner"]

# Which node a handler name resolves to. Anything unrecognised lands on
# executor, because unknown handlers are almost always doing the work.
TIER_NODE = {
    "opus": "orchestrator", "fable": "orchestrator",
    "sonnet": "executor",
    "haiku": "ops",
    "learner": "learner", "cma-learner": "learner",
}

# The lanes index.html can actually draw. --edge is validated against this:
# an edge outside it would be written to status.json and then silently never
# rendered, which is worse than refusing it.
DRAWABLE_LANES = {
    ("orchestrator", "orchestrator"), ("orchestrator", "executor"),
    ("orchestrator", "ops"), ("orchestrator", "verifier"),
    ("orchestrator", "learner"), ("executor", "verifier"),
    ("verifier", "executor"), ("verifier", "orchestrator"),
    ("verifier", "learner"),
}

TASK_GRAPH_CANDIDATES = [
    ".cma/task-graph.json",
    "cma/task-graph.json",
    "docs/cma/task-graph.json",
    "tools/cma-dashboard/task-graph.json",
]


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def now():
    return _dt.datetime.now().replace(microsecond=0).isoformat()


def die(msg):
    sys.stderr.write("cma-dashboard: %s\n" % msg)
    raise SystemExit(1)


def repo_root():
    d = HERE
    while True:
        # exists(), not isdir(): in a `git worktree` checkout .git is a
        # FILE pointing at the common gitdir, and an isdir() test walks past
        # the real root -- breaking task-graph discovery and lessons paths.
        if os.path.exists(os.path.join(d, ".git")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return HERE
        d = parent


def blank():
    return {
        "schema": 1,
        "run": {"name": "(no run)", "orch": "", "path": "",
                "started": "", "updated": now()},
        "current": None,
        "tasks": [],
        "stats": [],
        "defects": [],
        "log": [],
        "manual_edges": [],
    }


def load():
    if not os.path.exists(STATUS):
        return blank()
    try:
        with open(STATUS, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (ValueError, OSError) as exc:
        die("status.json is unreadable (%s). Delete it and re-seed with "
            "--new-run." % exc)
    base = blank()
    base.update(data)
    return base


# --------------------------------------------------------------------------
# the agent network -- derived, never bookkept
# --------------------------------------------------------------------------

def derive_network(state):
    """Rebuild the whole agent graph from task history on every save.

    Recomputed from scratch rather than incremented, so it is idempotent and
    cannot drift or double-count. It also costs nothing at runtime: every
    number here comes from data --task already recorded, so the network view
    needs no commands of its own.
    """
    counts = {n: 0 for n in NODES}
    edges = {}

    def bump(a, b, label, kind):
        key = (a, b)
        e = edges.setdefault(key, {"from": a, "to": b, "label": label,
                                   "n": 0, "kind": kind})
        e["n"] += 1

    warm = cold = 0

    for t in state["tasks"]:
        hist = t.get("hist") or []
        by = (t.get("by") or "").lower()
        node = TIER_NODE.get(by, "executor" if by else None)
        mode = t.get("mode") or ""

        if node:
            counts[node] += 1

        # Work leaving the orchestrator.
        if "running" in hist or t.get("status") in (
                "running", "verifying", "done", "resolved", "failed"):
            if mode == "warm":
                warm += 1
                bump("orchestrator", "orchestrator", "warm", "warm")
            elif mode == "cold":
                cold += 1
                target = node if node and node != "orchestrator" else "executor"
                bump("orchestrator", target, "dispatch", "dispatch")

        # Work reaching the mandatory verification gate. Only implementation
        # work routes here -- the orchestrator's own warm work, or an
        # executor's. Mechanical ops and the learner never get an adversarial
        # trace, so drawing them into the gate would overstate what was
        # actually verified.
        if any(s in hist for s in ("verifying", "done", "resolved")):
            if node in (None, "orchestrator", "executor"):
                bump(node or "executor", "verifier", "verify", "verify")

        # Verification bouncing a defect back -- to whoever actually did the
        # work. On a warm run that is the orchestrator itself, and sending the
        # arrow to the executor would blame a tier that never ran.
        if "failed" in hist:
            owner = node if node in ("orchestrator", "executor") else "executor"
            bump("verifier", owner, "defect", "defect")

        if node == "learner":
            bump("verifier", "learner", "lessons", "learn")

    for e in state.get("manual_edges", []):
        key = (e["from"], e["to"])
        cur = edges.setdefault(key, {"from": e["from"], "to": e["to"],
                                     "label": e.get("label", ""),
                                     "n": 0, "kind": "manual"})
        cur["n"] += int(e.get("n", 1))
        if e.get("label"):
            cur["label"] = e["label"]

    total = warm + cold
    return {
        "nodes": counts,
        "edges": sorted(edges.values(), key=lambda e: -e["n"]),
        "ledger": {
            "warm": warm,
            "cold": cold,
            "ratio": (round(100.0 * warm / total) if total else 0),
        },
    }


# --------------------------------------------------------------------------
# persistence
# --------------------------------------------------------------------------

def save(state):
    state["run"]["updated"] = now()
    state["network"] = derive_network(state)

    with open(STATUS, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, ensure_ascii=False)

    embed_snapshot(state)


def embed_snapshot(state):
    """Rewrite the offline snapshot between the sentinels in index.html.

    This is what keeps the file:// view (and the artifact/other-machine view)
    from silently going stale, and it is why index.html is committed while
    status.json is not.
    """
    if not os.path.exists(INDEX):
        die("index.html is missing from %s" % HERE)

    with open(INDEX, "r", encoding="utf-8") as fh:
        html = fh.read()

    if SNAP_START not in html or SNAP_END not in html:
        die("index.html has no snapshot sentinels -- it was hand-edited or "
            "corrupted. Restore it from git (git checkout -- "
            "tools/cma-dashboard/index.html).")

    payload = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("<", "\\u003c")  # cannot break out of <script>
    block = (SNAP_START
             + '\n<script type="application/json" id="cma-snapshot">'
             + payload + "</script>\n" + SNAP_END)

    pattern = re.compile(re.escape(SNAP_START) + ".*?" + re.escape(SNAP_END),
                         re.DOTALL)
    with open(INDEX, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(pattern.sub(lambda _m: block, html, count=1))


# --------------------------------------------------------------------------
# task-graph seeding
# --------------------------------------------------------------------------

def find_task_graph():
    root = repo_root()
    for rel in TASK_GRAPH_CANDIDATES:
        p = os.path.join(root, rel.replace("/", os.sep))
        if os.path.exists(p):
            return p
    return None


def read_task_graph(path):
    """Tolerant reader: a task graph is written by whichever model planned the
    run, so accept the shapes they actually emit rather than one rigid schema.
    """
    with open(path, "r", encoding="utf-8") as fh:
        raw = json.load(fh)

    if isinstance(raw, list):
        tasks, batches = raw, []
    elif isinstance(raw, dict):
        tasks = raw.get("tasks") or raw.get("nodes") or []
        batches = raw.get("batches") or []
    else:
        die("%s is neither a list of tasks nor an object with a 'tasks' key"
            % path)

    # id -> phase, from batches when present.
    phase_of = {}
    for i, b in enumerate(batches, 1):
        if isinstance(b, dict):
            name = b.get("name") or b.get("phase") or ("Batch %d" % i)
            ids = b.get("tasks") or b.get("ids") or []
        else:
            name, ids = "Batch %d" % i, b
        for tid in ids:
            phase_of[str(tid)] = name

    out = []
    for i, t in enumerate(tasks, 1):
        if isinstance(t, str):
            t = {"id": "T%d" % i, "title": t}
        tid = str(t.get("id") or t.get("task_id") or ("T%d" % i))
        out.append({
            "id": tid,
            "title": (t.get("title") or t.get("name")
                      or t.get("summary") or tid),
            "phase": phase_of.get(tid) or t.get("phase") or "Tasks",
            "status": "pending",
            "by": "",
            "mode": "",
            "hist": [],
            "depends_on": [str(d) for d in (t.get("depends_on") or [])],
        })

    if not out:
        die("%s contained no tasks" % path)
    return out


def seed(state, path, replace):
    tasks = read_task_graph(path)
    if replace:
        state["tasks"] = tasks
        added = len(tasks)
    else:
        have = {t["id"] for t in state["tasks"]}
        new = [t for t in tasks if t["id"] not in have]
        state["tasks"].extend(new)
        added = len(new)
    state["log"].append({"ts": now(),
                         "msg": "seeded %d task(s) from %s"
                                % (added, os.path.basename(path))})
    return added


# --------------------------------------------------------------------------
# mutations
# --------------------------------------------------------------------------

def apply_task(state, spec):
    if "=" not in spec:
        die("--task wants ID=STATUS[:BY[:MODE]], got %r" % spec)
    tid, rest = spec.split("=", 1)
    tid = tid.strip()
    parts = rest.split(":")
    status = parts[0].strip().lower()
    by = parts[1].strip().lower() if len(parts) > 1 else None
    mode = parts[2].strip().lower() if len(parts) > 2 else None

    if status not in STATUSES:
        die("unknown status %r -- the vocabulary is fixed: %s"
            % (status, " ".join(STATUSES)))
    if mode and mode not in MODES:
        die("unknown mode %r -- use warm or cold" % mode)

    task = next((t for t in state["tasks"] if t["id"] == tid), None)
    if task is None:
        task = {"id": tid, "title": tid, "phase": "Ad hoc", "status": "pending",
                "by": "", "mode": "", "hist": [], "depends_on": []}
        state["tasks"].append(task)

    task["status"] = status
    if by:
        task["by"] = by
    if mode:
        task["mode"] = mode
    elif not task.get("mode") and by:
        # Sensible default: the orchestrator tier acting on its own task is
        # warm by definition; anything else had to be dispatched.
        task["mode"] = ("warm" if TIER_NODE.get(by) == "orchestrator"
                        else "cold")

    hist = task.setdefault("hist", [])
    if status not in hist:
        hist.append(status)
    return task


def apply_stat(state, spec):
    if "=" not in spec:
        die("--stat wants K=V[:tone], got %r" % spec)
    k, v = spec.split("=", 1)
    tone = "neutral"
    if ":" in v:
        head, tail = v.rsplit(":", 1)
        if tail.strip().lower() in TONES:
            v, tone = head, tail.strip().lower()
    entry = next((s for s in state["stats"] if s["k"] == k.strip()), None)
    if entry:
        entry["v"], entry["tone"] = v.strip(), tone
    else:
        state["stats"].append({"k": k.strip(), "v": v.strip(), "tone": tone})


def apply_edge(state, spec):
    if ">" not in spec:
        die("--edge wants FROM>TO[:label], got %r" % spec)
    a, rest = spec.split(">", 1)
    label = ""
    if ":" in rest:
        rest, label = rest.split(":", 1)
    a, b = a.strip().lower(), rest.strip().lower()
    for n in (a, b):
        if n not in NODES:
            die("unknown node %r -- nodes are: %s" % (n, " ".join(NODES)))
    if (a, b) not in DRAWABLE_LANES:
        die("the dashboard cannot draw %s>%s, so recording it would be a "
            "silent no-op. Drawable lanes: %s"
            % (a, b, ", ".join(sorted("%s>%s" % l for l in DRAWABLE_LANES))))
    state["manual_edges"].append({"from": a, "to": b,
                                  "label": label.strip(), "n": 1})


# --------------------------------------------------------------------------
# lessons
# --------------------------------------------------------------------------

def lessons_path(scope):
    if scope == "global":
        return os.path.join(os.path.expanduser("~"), ".claude",
                            "cma-lessons.md")
    return os.path.join(repo_root(), "docs", "cma-lessons.md")


def append_lesson(text, scope):
    path = lessons_path(scope)
    if not os.path.exists(path):
        die("%s does not exist yet -- create it before logging lessons "
            "(the skill says a project without one makes it on the first "
            "CMA run)." % path)
    with open(path, "r", encoding="utf-8") as fh:
        body = fh.read()

    marker = "<!-- cma:append-here -->"
    entry = "- %s _(%s)_\n" % (text.strip(), _dt.date.today().isoformat())
    if marker in body:
        body = body.replace(marker, entry + marker, 1)
    else:
        body = body.rstrip() + "\n" + entry
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)
    return path


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------

def show(state):
    r = state["run"]
    net = state.get("network") or derive_network(state)
    print("run      : %s" % r.get("name"))
    print("orch     : %s   path: %s" % (r.get("orch") or "-",
                                        r.get("path") or "-"))
    print("updated  : %s" % r.get("updated"))
    cur = state.get("current")
    if cur:
        print("current  : %s  %s" % (cur.get("id"), cur.get("title")))
    led = net["ledger"]
    print("ledger   : %d warm / %d cold  (%d%% warm)"
          % (led["warm"], led["cold"], led["ratio"]))
    print("")
    by_phase = {}
    for t in state["tasks"]:
        by_phase.setdefault(t.get("phase") or "Tasks", []).append(t)
    for phase, items in by_phase.items():
        print("  %s" % phase)
        for t in items:
            print("    %-6s %-10s %-8s %-5s %s"
                  % (t["id"], t["status"], t.get("by") or "-",
                     t.get("mode") or "-", t["title"]))
    if state["defects"]:
        print("\n  defects")
        for d in state["defects"]:
            print("    ! %s" % d["text"])


def doctor():
    root = repo_root()
    ok = True

    def line(good, msg):
        nonlocal ok
        ok = ok and good
        print("  %s %s" % ("OK  " if good else "FAIL", msg))

    print("cma-dashboard doctor\n")
    line(os.path.exists(INDEX), "index.html present")
    if os.path.exists(INDEX):
        with open(INDEX, "r", encoding="utf-8") as fh:
            html = fh.read()
        line(SNAP_START in html and SNAP_END in html,
             "snapshot sentinels intact (never hand-edit index.html)")
    line(os.path.exists(STATUS), "status.json present (run --new-run if not)")

    gi = os.path.join(root, ".gitignore")
    ignored = False
    if os.path.exists(gi):
        with open(gi, "r", encoding="utf-8") as fh:
            ignored = "cma-dashboard/status.json" in fh.read()
    line(ignored, ".gitignore excludes tools/cma-dashboard/status.json")

    for scope in ("repo", "global"):
        p = lessons_path(scope)
        line(os.path.exists(p), "%s lessons file: %s" % (scope, p))

    tg = find_task_graph()
    print("  %s task graph auto-discovery: %s"
          % ("OK  " if tg else "--  ", tg or "none found (pass "
             "--from-task-graph explicitly)"))
    raise SystemExit(0 if ok else 1)


def serve(port):
    import http.server
    os.chdir(HERE)
    handler = http.server.SimpleHTTPRequestHandler
    # ThreadingHTTPServer, not TCPServer: it sets allow_reuse_address, so a
    # Ctrl-C does not leave the port in TIME_WAIT and refuse the next start.
    # Matches what .claude/launch.json already uses.
    with http.server.ThreadingHTTPServer(("", port), handler) as httpd:
        print("cma-dashboard on http://localhost:%d/  (ctrl-c to stop)" % port)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("")


# --------------------------------------------------------------------------

def main(argv):
    p = argparse.ArgumentParser(
        prog="update.py", description="Drive the generalist CMA dashboard.")
    p.add_argument("--new-run", metavar="NAME",
                   help="clear ALL prior run state and start a fresh board")
    p.add_argument("--orch", metavar="MODEL",
                   help="orchestrating model for this run (opus/fable)")
    p.add_argument("--path", choices=["warm", "full"],
                   help="which arm of the master decision rule this run took")
    p.add_argument("--from-task-graph", metavar="PATH", nargs="?",
                   const="__auto__",
                   help="seed tasks from a task-graph JSON; bare flag "
                        "auto-discovers one")
    p.add_argument("--task", action="append", default=[], metavar="ID=STATUS",
                   help="ID=STATUS[:BY[:MODE]] -- repeatable")
    p.add_argument("--current", nargs=2, metavar=("ID", "TITLE"))
    p.add_argument("--stat", action="append", default=[], metavar="K=V",
                   help="K=V[:tone] -- repeatable")
    p.add_argument("--defect-add", action="append", default=[], metavar="TEXT")
    p.add_argument("--defect-clear", action="store_true")
    p.add_argument("--log", action="append", default=[], metavar="MSG")
    p.add_argument("--edge", action="append", default=[], metavar="FROM>TO",
                   help="FROM>TO[:label] -- extra agent-network edge")
    p.add_argument("--lesson", metavar="TEXT",
                   help="append a lesson to a lessons file")
    p.add_argument("--scope", choices=["repo", "global"], default="repo")
    p.add_argument("--show", action="store_true")
    p.add_argument("--doctor", action="store_true")
    p.add_argument("--serve", nargs="?", const=8777, type=int, metavar="PORT")
    args = p.parse_args(argv)

    if args.doctor:
        doctor()
    if args.serve is not None:
        serve(args.serve)
        return

    state = blank() if args.new_run else load()

    if args.new_run:
        state["run"]["name"] = args.new_run
        state["run"]["started"] = now()
        state["log"].append({"ts": now(), "msg": "run started: %s"
                                                % args.new_run})
    if args.orch:
        state["run"]["orch"] = args.orch
    if args.path:
        state["run"]["path"] = args.path

    if args.from_task_graph:
        path = args.from_task_graph
        if path == "__auto__":
            path = find_task_graph()
            if not path:
                die("no task graph found in %s -- pass a path explicitly"
                    % ", ".join(TASK_GRAPH_CANDIDATES))
        if not os.path.exists(path):
            die("task graph not found: %s" % path)
        n = seed(state, path, replace=bool(args.new_run))
        print("seeded %d task(s) from %s" % (n, path))

    for spec in args.task:
        apply_task(state, spec)
    for spec in args.stat:
        apply_stat(state, spec)
    for spec in args.edge:
        apply_edge(state, spec)
    if args.current:
        state["current"] = {"id": args.current[0], "title": args.current[1]}
    if args.defect_clear:
        state["defects"] = []
    for text in args.defect_add:
        state["defects"].append({"text": text, "ts": now()})
    for msg in args.log:
        state["log"].append({"ts": now(), "msg": msg})

    if args.lesson:
        path = append_lesson(args.lesson, args.scope)
        print("lesson appended to %s" % path)

    save(state)

    if args.show:
        print("")
        show(state)
    else:
        led = state["network"]["ledger"]
        done = sum(1 for t in state["tasks"]
                   if t["status"] in ("done", "resolved"))
        print("board: %d/%d done | %d warm / %d cold | %s"
              % (done, len(state["tasks"]), led["warm"], led["cold"],
                 state["run"]["name"]))


if __name__ == "__main__":
    main(sys.argv[1:])
