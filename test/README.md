# Tests

Two groups, deliberately separate. The first needs nothing but Node; the second needs a browser.

```bash
node --test 'test/unit/*.test.js'    # fast checks — no install, no package.json
node --test 'test/browser/*.spec.js' # browser checks — needs Playwright (skips without it)
node --test                          # both, plus every helper file
```

**`node --test test/unit/` does not work.** Node 22 tries to *execute* a directory passed this
way rather than searching it, so pass the glob (or explicit filenames) as above.

There is no `package.json` and nothing to install, which is deliberate: the app itself is
zero-install and zero-build, and the tests keep that property. Node 22 or newer is the only
requirement for the first group.

## What the fast checks cover

| File | Guards |
|---|---|
| `money.test.js` | The billing calculator: how each `cost_unit` prices, the 1-hour staff floor, a blank staff window meaning the whole booking, the discount applying **only** to time-billed instrument cost, the subtotal → discount → overhead → tax order, and the 490 / 546.25 / 589.95 figures a seeded booking must reproduce |
| `dates.test.js` | Dates are local calendar days. Pins the bug behind issue #14: at a UTC+ offset, converting through UTC reports the *previous* day |
| `labels.test.js` | Display helpers that must never alter stored values — money, billing units, milestone statuses, retired names, escaping, and the link guard |
| `schema.test.js` | Database invariants: the `foreign_keys` pragma `db.export()` silently clears, every cascade, the `projects.pi_id` gap cascade cannot cover, retire/archive, cancellation billing, and the denormalized attendee string staying in step with its join table |
| `aggregation.test.js` | Reports agrees with the booking modal: cancelled bookings free the slot, waived charges stop counting, a blank staff window is the whole window, project-less bookings are not dropped |
| `wiring.test.js` | Every `data-act` has a handler and every handler an emitter; every icon name resolves; no file reintroduces the UTC date bug; every file parses |
| `versions.test.js` | The cache-busting strings in `index.html`, `sw.js`, `js/consts.js` and `CHANGELOG.md` stay in step — a mismatch leaves the service worker unable to serve an asset |

## What they do **not** cover

They prove the maths and the rules. **They cannot tell you the app loads.** The screens are
built as template strings assembled at render time, so a mistake in one surfaces only when that
screen is actually visited. For any UI change, still open the app in a browser — or run the
browser group, which visits every screen and fails on a single JavaScript error.

## The browser checks

`isolation.spec.js` is the important one. It creates real records, fingerprints the stored
database, has a demo tab perform a forced clear-and-reseed, and requires the fingerprint to be
unchanged — the demo sandbox guarantee, asserted on bytes rather than behaviour.
`smoke.spec.js` renders every screen and fails on any JavaScript error; it is what caught the
sandbox opening blank. `sanitize.spec.js` covers the note sanitizer, which can only run in a real
browser because Node has no `DOMParser`.

Playwright is not a dependency of this repo. The suites find it from a local or global install, or
from `PLAYWRIGHT_MODULE`; set `CHROMIUM_PATH` if a browser is present that Playwright did not
install itself. Without Playwright they **skip** rather than fail.

## Conventions

- Run under a UTC+ timezone. `TZ='Asia/Jerusalem' node --test 'test/unit/*.test.js'` is the
  meaningful configuration — this project's date bugs are invisible at UTC, which is exactly how
  issue #14 shipped. CI runs there permanently.
- A test name states the rule, so a failure reads as a sentence.
- Never weaken an assertion to make it pass. If behaviour and `CLAUDE.md` disagree, that is a
  finding: leave it failing and say so.
- The helpers under `unit/helpers/` load the app's browser IIFEs into Node against a minimal
  stub, and boot a real in-memory database via the app's own never-persisting mode. Nothing is
  mocked — tests run the shipped schema, the shipped migrations, and the shipped functions.
