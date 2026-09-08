# CMA lessons — Core Facility Tracker (repo scope)

Living file. **Every planner, executor and verifier agent reads this before
starting work and applies it unprompted.** The `cma-learner` stage merges new
lessons in after each run: dedupe, add "seen ×N" to recurring ones, and delete
lessons that stop earning their space.

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

- **"The code looks correct" is not verification in this repo.** There is no
  test suite and no build. `node --check js/<file>.js` proves the file parses
  and nothing more. A verifier must actually load the app in a browser and
  exercise the changed path, or state plainly that it did not. A pass issued
  from a read of the diff alone is a false pass. _(2026-09-08)_

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

- **`tools/` and `docs/` changes need no version bump and no changelog entry.**
  The versioning rules exist to cache-bust the app shell; the dashboard and
  the docs page are not part of it. Bumping for them adds noise and a
  misleading release.

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

## Run hygiene

- Verify the dashboard's own render in a browser, not just its JSON — the network-edge defect on the build run was invisible in status.json and obvious on screen. _(2026-09-08)_
<!-- cma:append-here -->
