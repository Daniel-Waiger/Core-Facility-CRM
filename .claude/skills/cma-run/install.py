#!/usr/bin/env python3
"""
Promote the repo's canonical cma-run skill to the user scope.

You do NOT need this to use the skill in this project -- Claude Code discovers
`.claude/skills/` in the clone automatically. Run it only to make cma-run
available in every project on this machine.

Sync is one-directional: the repo copy is canonical, the global copy is a
mirror. Edit the repo copy and re-run this; never edit the global copy, or the
two drift and nobody can tell which is authoritative.

    python .claude/skills/cma-run/install.py           # install / report drift
    python .claude/skills/cma-run/install.py --force   # overwrite the global copy
    python .claude/skills/cma-run/install.py --check   # exit 1 if out of sync
"""

import argparse
import difflib
import os
import shutil
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_SKILL = os.path.join(HERE, "SKILL.md")
HOME = os.path.expanduser("~")
DST_DIR = os.path.join(HOME, ".claude", "skills", "cma-run")
DST_SKILL = os.path.join(DST_DIR, "SKILL.md")
DST_LESSONS = os.path.join(HOME, ".claude", "cma-lessons.md")

SEED_LESSONS = """# CMA lessons — global scope

Living file, shared by every project that runs the CMA scheme. Planner,
executor and verifier agents read this before starting work and apply it
unprompted, alongside the project's own `docs/cma-lessons.md`.

A lesson belongs here only if it would still be true on a completely different
codebase. Anything naming a specific file, table or convention belongs in that
project's repo-scoped lessons file. Read global first, repo second — on a
genuine conflict the repo file wins.

<!-- cma:append-here -->
"""


def read(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def main(argv):
    ap = argparse.ArgumentParser(prog="install.py")
    ap.add_argument("--force", action="store_true",
                    help="overwrite a differing global copy")
    ap.add_argument("--check", action="store_true",
                    help="report drift and exit non-zero, change nothing")
    args = ap.parse_args(argv)

    if not os.path.exists(SRC_SKILL):
        sys.stderr.write("cannot find %s\n" % SRC_SKILL)
        return 1

    src = read(SRC_SKILL)
    exists = os.path.exists(DST_SKILL)
    same = exists and read(DST_SKILL) == src

    if same:
        print("skill: already in sync -> %s" % DST_SKILL)
    elif exists and not (args.force or args.check):
        print("skill: a DIFFERENT global copy already exists at\n  %s\n"
              % DST_SKILL)
        diff = difflib.unified_diff(
            read(DST_SKILL).splitlines(True), src.splitlines(True),
            fromfile="global (current)", tofile="repo (canonical)", n=1)
        body = "".join(diff)
        print(body[:4000] + ("\n... diff truncated ...\n"
                             if len(body) > 4000 else ""))
        print("Refusing to overwrite. Re-run with --force once you have "
              "confirmed nothing above is worth keeping.")
        return 2
    elif args.check:
        print("skill: OUT OF SYNC (global %s repo)"
              % ("differs from" if exists else "missing vs"))
        return 1
    else:
        os.makedirs(DST_DIR, exist_ok=True)
        shutil.copyfile(SRC_SKILL, DST_SKILL)
        print("skill: %s -> %s" % ("overwrote" if exists else "installed",
                                   DST_SKILL))

    if os.path.exists(DST_LESSONS):
        print("lessons: already present -> %s" % DST_LESSONS)
    elif args.check:
        print("lessons: MISSING -> %s" % DST_LESSONS)
        return 1
    else:
        os.makedirs(os.path.dirname(DST_LESSONS), exist_ok=True)
        with open(DST_LESSONS, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(SEED_LESSONS)
        print("lessons: seeded -> %s" % DST_LESSONS)

    if args.check:
        print("\nin sync.")
    else:
        print("\nDone. cma-run is now available in every project on this "
              "machine.\nThe repo copy stays canonical -- edit it there and "
              "re-run this script.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
