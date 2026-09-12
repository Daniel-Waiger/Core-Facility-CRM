/* multi-tab-guard.test.js — C4-followups #1
 *
 * `rejoinAsNewTab()` (js/db.js, the bfcache-restore path) forces this tab read-only, clears
 * `peers`, and routes the "am I actually alone" decision through the same recompute() /
 * reloadFromDiskAndPromote() machinery every other promotion uses. That reload is async (it awaits
 * an IndexedDB read). If the surviving leader's `hello-ack` arrives WHILE that reload is still in
 * flight, the old code swallowed the demotion silently: recompute()'s `if (next === readOnly)
 * return;` saw `readOnly` still `true` (reloadFromDiskAndPromote() hadn't reached its success path
 * yet) and `next` also `true` (this tab is not the leader once the ack is counted) — no-op, by
 * design, since nothing had changed YET. But once the reload's `await` resolved,
 * reloadFromDiskAndPromote() unconditionally cleared `readOnly` anyway, discarding what the ack
 * had already established. Two tabs, both `readOnly === false`.
 *
 * The fix re-runs the election with whatever `peers` holds at the moment the reload actually
 * finishes, and only clears `readOnly` if this tab is still the elected leader then.
 *
 * This test reproduces the race deterministically: two real tabs booted against a shared fake
 * IndexedDB and a fake BroadcastChannel, tab A sent through a real `pagehide` (so B legitimately
 * promotes), then a `pageshow{persisted:true}` (bfcache restore) on A with the disk reload slowed
 * by 200ms — long enough for B's `hello-ack` to reach A while A's reload is still awaiting the
 * IndexedDB read, exactly as the review's harness reproduced it. At most one of the two tabs may
 * end up writable.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadApp, REPO } = require('./helpers/load-module');

// A minimal, real (not gated) fake IndexedDB — same shape as restore-race.test.js's fixture,
// trimmed to what booting/reloading a database needs: get/put/delete on one 'kv' store.
function makeFakeIndexedDB() {
  const store = new Map();
  const dbHandle = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction() {
      const tx = {};
      const storeApi = {
        get(key) {
          const req = {};
          queueMicrotask(() => {
            req.result = store.has(key) ? { k: key, v: store.get(key) } : undefined;
            if (req.onsuccess) req.onsuccess();
            if (tx.oncomplete) tx.oncomplete();
          });
          return req;
        },
        put(entry) {
          queueMicrotask(() => { store.set(entry.k, entry.v); if (tx.oncomplete) tx.oncomplete(); });
          return {};
        },
        delete(key) {
          queueMicrotask(() => { store.delete(key); if (tx.oncomplete) tx.oncomplete(); });
          return {};
        },
      };
      tx.objectStore = () => storeApi;
      return tx;
    },
  };
  return {
    store,
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = dbHandle;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: dbHandle } });
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
}

// A fake BroadcastChannel shared across "tabs" in this same process, keyed by channel name — same
// pattern as the review's attack2/attack2b harnesses, formalized here as a reusable fixture.
function makeBroadcastChannelClass() {
  const registry = new Map();
  return class FakeBroadcastChannel {
    constructor(name) {
      this.name = name; this.onmessage = null; this.closed = false;
      if (!registry.has(name)) registry.set(name, new Set());
      registry.get(name).add(this);
    }
    postMessage(data) {
      for (const c of registry.get(this.name)) {
        if (c === this || c.closed) continue;
        const target = c;
        setTimeout(() => { if (!target.closed && target.onmessage) target.onmessage({ data }); }, 0);
      }
    }
    close() { this.closed = true; const set = registry.get(this.name); if (set) set.delete(this); }
  };
}

// Same fixture as makeBroadcastChannelClass(), but with a configurable delivery delay instead of a
// hardcoded `setTimeout(fn, 0)` — needed to reproduce C5-rejoin's INVERSE race below, where the
// promotion's IndexedDB reload finishes fast and it's the BroadcastChannel round-trip that's slow.
function makeDelayedBroadcastChannelClass(delayMs) {
  const registry = new Map();
  return class DelayedBroadcastChannel {
    constructor(name) {
      this.name = name; this.onmessage = null; this.closed = false;
      if (!registry.has(name)) registry.set(name, new Set());
      registry.get(name).add(this);
    }
    postMessage(data) {
      for (const c of registry.get(this.name)) {
        if (c === this || c.closed) continue;
        const target = c;
        setTimeout(() => { if (!target.closed && target.onmessage) target.onmessage({ data }); }, delayMs);
      }
    }
    close() { this.closed = true; const set = registry.get(this.name); if (set) set.delete(this); }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realInitSqljs = require(path.join(REPO, 'libs', 'sql-asm.js'));

// Boots one "tab": its own app.js-free DB instance sharing the process-global fake IndexedDB and
// BroadcastChannel, with its own private pagehide/pageshow listener list (mirroring how each real
// browser tab independently receives its own lifecycle events) rather than the real
// `global.addEventListener`, which the stub DOM leaves undefined.
async function bootTab() {
  const listeners = {};
  const realAdd = globalThis.addEventListener;
  globalThis.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  const app = loadApp(['consts', 'db', 'ui']);
  app.UI.toast = () => {}; // toast() touches a #toasts host the DOM stub doesn't render
  globalThis.initSqlJs = realInitSqljs;
  globalThis.App = { onSaving() {}, onSaved() {}, onSaveFailed() {}, onMultiTabState() {} };
  await app.DB.boot();
  globalThis.addEventListener = realAdd;
  return {
    DB: app.DB,
    fire: (type, ev) => Promise.all((listeners[type] || []).map((fn) => fn(ev))),
  };
}

describe('multi-tab guard: a slow post-bfcache reload must re-check the election before clearing read-only', () => {
  test('B\'s hello-ack arriving mid-reload must not also leave A writable', async () => {
    const savedBC = globalThis.BroadcastChannel;
    const savedIDB = globalThis.indexedDB;
    const savedInit = globalThis.initSqlJs;
    const savedApp = globalThis.App;
    try {
      globalThis.BroadcastChannel = makeBroadcastChannelClass();
      const fake = makeFakeIndexedDB();
      globalThis.indexedDB = { open: (...args) => fake.open(...args) };

      const A = await bootTab();
      await sleep(30);
      const B = await bootTab();
      await sleep(80);
      assert.equal(A.DB.isReadOnly, false, 'sanity: A is the first (and so far only) tab — writable');
      assert.equal(B.DB.isReadOnly, true, 'sanity: B arrived second — read-only under A');

      // A leaves (a real tab close would do this too) — B legitimately promotes.
      await A.fire('pagehide', {});
      await sleep(400);
      assert.equal(B.DB.isReadOnly, false, 'sanity: B has promoted after A left');

      // A comes back from the bfcache. Slow ONLY this reload (not the two boots above) by 200ms —
      // long enough for B's hello-ack to reach A while A's own reload is still awaiting the
      // IndexedDB read, reproducing the race exactly as the review's harness did.
      globalThis.initSqlJs = async () => { await sleep(200); return realInitSqljs(); };
      await A.fire('pageshow', { persisted: true });
      await sleep(1000);

      const bothWritable = !A.DB.isReadOnly && !B.DB.isReadOnly;
      assert.equal(bothWritable, false, 'at most one tab may end up writable — a hello-ack that arrives mid-reload must not be silently discarded');
      // B was already the legitimately-elected, older leader when A rejoined — A rejoining (with a
      // fresh, newer timestamp per rejoinAsNewTab) must not usurp it once the race is resolved.
      assert.equal(B.DB.isReadOnly, false, 'B remains the writer');
      assert.equal(A.DB.isReadOnly, true, 'A must stay (or return to) read-only once its reload actually finishes and re-checks the election');
    } finally {
      globalThis.BroadcastChannel = savedBC;
      globalThis.indexedDB = savedIDB;
      globalThis.initSqlJs = savedInit;
      globalThis.App = savedApp;
    }
  });
});

describe('multi-tab guard: a fast post-bfcache reload must not promote before the round-trip that could disprove it', () => {
  // C5-rejoin. The INVERSE of the race above: here the promotion's IndexedDB reload finishes
  // BEFORE the surviving leader's `hello-ack` gets a chance to arrive (a slow BroadcastChannel,
  // not a slow reload) — reproduced from the red team's verify8/attack3.js harness. Pre-fix,
  // rejoinAsNewTab() routed straight into recompute() with `peers` freshly cleared, so recompute()
  // saw "nobody's heard from" and concluded "nobody else is here", promoting A on the spot. A
  // write landing in that window was accepted (dirty, never persisted); the late ack then demoted
  // A correctly, but the row was gone — persist bails out on isReadOnly, and the next promotion's
  // disk reload silently discards whatever was sitting only in memory.
  test('a write attempted in the round-trip window is refused, not accepted-then-dropped', async () => {
    const savedBC = globalThis.BroadcastChannel;
    const savedIDB = globalThis.indexedDB;
    const savedInit = globalThis.initSqlJs;
    const savedApp = globalThis.App;
    try {
      // Reload stays fast (the default, un-slowed initSqlJs); only the BroadcastChannel is slow —
      // 150ms is comfortably longer than REJOIN_GRACE_MS's own poll granularity but still well
      // inside the 300ms grace itself, so a `hello-ack` sent right at rejoin should still land
      // before the grace timer fires on its own.
      globalThis.BroadcastChannel = makeDelayedBroadcastChannelClass(150);
      const fake = makeFakeIndexedDB();
      globalThis.indexedDB = { open: (...args) => fake.open(...args) };
      globalThis.App = { onSaving() {}, onSaved() {}, onSaveFailed() {}, onMultiTabState() {} };

      // Every message now takes 150ms one-way, and B's own read-only state only settles once
      // A's `hello-ack` (itself a reply to B's `hello`) makes it back to B — two hops, ~300ms —
      // so give the initial handshake room to actually finish before asserting on it.
      const A = await bootTab();
      await sleep(30);
      const B = await bootTab();
      await sleep(500);
      assert.equal(A.DB.isReadOnly, false, 'sanity: A is the first (and so far only) tab — writable');
      assert.equal(B.DB.isReadOnly, true, 'sanity: B arrived second — read-only under A');

      // A leaves — B legitimately promotes.
      await A.fire('pagehide', {});
      await sleep(700);
      assert.equal(B.DB.isReadOnly, false, 'sanity: B has promoted after A left');

      // A comes back from the bfcache. Its own reload from IndexedDB is fast; B's hello-ack, sent
      // in reply to A's `hello`, takes 150ms to arrive over the (slowed) BroadcastChannel.
      await A.fire('pageshow', { persisted: true });
      await sleep(40); // well before B's hello-ack (150ms) and before REJOIN_GRACE_MS (300ms)

      // Without the fix, A would already believe itself the writer here. Attempt a write in
      // exactly that window.
      let wrote = false;
      let threw = null;
      try {
        A.DB.run('INSERT INTO people (name, type, email) VALUES (?,?,?)', ['RaceGhost', 'User', 'rg@x.com']);
        wrote = true;
      } catch (e) {
        threw = e;
      }
      assert.equal(wrote, false, 'a write attempted during the grace window must be refused, not accepted and later dropped');
      assert.ok(threw && threw.dbReadOnly, 'expected the same read-only error assertWritable() throws for any other read-only tab');

      // Let the ack arrive, the grace timer resolve either way, and any autosave settle.
      await sleep(1000);
      const bothWritable = !A.DB.isReadOnly && !B.DB.isReadOnly;
      assert.equal(bothWritable, false, 'exactly one writer once the dust settles');
      assert.equal(B.DB.isReadOnly, false, 'B remains the writer — it was already the legitimately-elected leader when A rejoined');
      assert.equal(A.DB.isReadOnly, true, 'A stays read-only — it never had a legitimate writer window to lose');

      // RaceGhost must never have reached A's own in-memory copy (the write was refused outright,
      // not accepted and later reloaded away).
      const inMemory = A.DB.rows("SELECT name FROM people WHERE name = 'RaceGhost'");
      assert.equal(inMemory.length, 0, 'the refused write must not be sitting in A\'s memory either');
    } finally {
      globalThis.BroadcastChannel = savedBC;
      globalThis.indexedDB = savedIDB;
      globalThis.initSqlJs = savedInit;
      globalThis.App = savedApp;
    }
  });
});

/* ---------------------------------------------------------------------------------------------
 * C6-guard — three follow-up defects in the C5-rejoin machinery above, all in the same
 * multi-tab guard section of js/db.js:
 *
 *   1. Demoting a tab that HAS been through a real promotion only reloaded the leader's bytes
 *      and warned the user when this tab's own `dirty` flag was still set. But the 400ms
 *      autosave debounce can flush a phantom edit to disk before the real leader's late
 *      `hello-ack` arrives — `dirty` is already false by then, so the old code left this tab's
 *      stale in-memory copy standing (showing a row that isn't on disk once the real leader's
 *      own next save overwrites it) with no toast and no reload.
 *   2. teardown() (the `pagehide` handler) never cleared a pending `rejoinGraceTimer` — a
 *      pagehide landing inside REJOIN_GRACE_MS left the timer armed against a channel about to
 *      be closed, and it could still fire afterward and promote a tab that will never announce
 *      itself to anyone again.
 *   3. The `hello-ack` handler cleared `rejoinGraceTimer` unconditionally, on an ack from ANY
 *      peer — including one strictly newer than the rejoining tab itself, which proves nothing
 *      about whether the real (older) leader is still out there and can let the rejoiner
 *      promote off an incomplete peer set before the leader's own (slower) ack arrives.
 *
 * These tests use a tagged, per-sender-delay BroadcastChannel fake (mirroring the review's own
 * verifier harness) so a "leader" tab's messages can be made slow without slowing every tab, and
 * a raw same-name BroadcastChannel instance to inject a synthetic `hello-ack` with a controlled
 * timestamp — the only reliable way to prove the ts-comparison branch in isolation, since a real
 * third tab booted after the rejoin never actually receives the rejoining tab's original `hello`
 * in this fake (it isn't registered yet when that message goes out), and so could never produce
 * the ack this bug is actually about.
 * ------------------------------------------------------------------------------------------- */

// A BroadcastChannel fake where every channel is tagged at construction time (from a shared,
// mutable ref the test flips before booting each tab) and postMessage's delivery delay is looked
// up per SENDER tag — so, e.g., the real leader's acknowledgements can be made slow while every
// other tab's messages stay instant, reproducing the "late ack" window the review's own harness
// used without slowing down the whole test.
function makeTaggedBroadcastChannelClass(currentTagRef, delayForTag) {
  const registry = new Map();
  return class TaggedBroadcastChannel {
    constructor(name) {
      this.name = name; this.tag = currentTagRef.tag; this.onmessage = null; this.closed = false;
      if (!registry.has(name)) registry.set(name, new Set());
      registry.get(name).add(this);
    }
    postMessage(data) {
      const ms = delayForTag(this.tag);
      for (const c of registry.get(this.name)) {
        if (c === this || c.closed) continue;
        const target = c;
        setTimeout(() => { if (!target.closed && target.onmessage) target.onmessage({ data }); }, ms);
      }
    }
    close() { this.closed = true; const set = registry.get(this.name); if (set) set.delete(this); }
  };
}

// Same shape as the file's own bootTab(), but tags the tab (for the delay map above) and records
// toasts/refreshes/onMultiTabState calls instead of discarding them — the C6-guard tests assert on
// exactly those (a discard toast fired once, App.refresh() called, the promoted/demoted sequence).
function bootTaggedTab(currentTagRef, tag) {
  currentTagRef.tag = tag;
  const listeners = {};
  const realAdd = globalThis.addEventListener;
  globalThis.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  const app = loadApp(['consts', 'db', 'ui']);
  const events = { toasts: [], states: [], refreshes: 0 };
  app.UI.toast = (msg, kind) => { events.toasts.push([msg, kind]); };
  globalThis.initSqlJs = realInitSqljs;
  globalThis.App = {
    onSaving() {}, onSaved() {}, onSaveFailed() {},
    onMultiTabState(ro, o) { events.states.push([ro, o || null]); },
    refresh() { events.refreshes++; },
  };
  return app.DB.boot().then(() => {
    globalThis.addEventListener = realAdd;
    return { tag, DB: app.DB, events, fire: (type, ev) => Promise.all((listeners[type] || []).map((fn) => fn(ev))) };
  });
}

describe('C6-guard item 1: demotion after a phantom autosave must still reload and warn', () => {
  test('memory converges on disk and the discard toast fires exactly once even though `dirty` was already false', async () => {
    const savedBC = globalThis.BroadcastChannel;
    const savedIDB = globalThis.indexedDB;
    const savedInit = globalThis.initSqlJs;
    const savedApp = globalThis.App;
    const tagRef = { tag: '?' };
    const slowLeader = { on: false };
    try {
      // The initial election (O boots, then R boots and learns of O) must settle at normal speed —
      // only once R is about to rejoin does O's ack need to be slow. Gating the delay on
      // `slowLeader.on` (flipped right before R's rejoin) keeps the two phases independent, unlike
      // tagging the delay by sender alone, which would leave R optimistically writable for the
      // whole 900ms after its very first boot too.
      globalThis.BroadcastChannel = makeTaggedBroadcastChannelClass(tagRef, (tag) => (tag === 'O' && slowLeader.on ? 900 : 0));
      const fake = makeFakeIndexedDB();
      globalThis.indexedDB = { open: (...args) => fake.open(...args) };

      const O = await bootTaggedTab(tagRef, 'O');
      await sleep(60);
      const R = await bootTaggedTab(tagRef, 'R');
      await sleep(600);
      assert.equal(O.DB.isReadOnly, false, 'sanity: O is the real leader');
      assert.equal(R.DB.isReadOnly, true, 'sanity: R is the reader');

      // Give O a baseline row and let it actually persist before the race starts.
      O.DB.run('INSERT INTO people (name, type, email) VALUES (?,?,?)', ['Leader', 'User', 'o@x.com']);
      await sleep(700);

      R.events.states.length = 0; R.events.toasts.length = 0; R.events.refreshes = 0;
      slowLeader.on = true; // from here on, O's messages (its late ack) take 900ms
      await R.fire('pageshow', { persisted: true }); // R rejoins; O's ack is 900ms away
      await sleep(320); // grace (300ms) elapses with no ack yet — R wrongly promotes
      assert.equal(R.DB.isReadOnly, false, 'sanity: R wrongly promoted before O\'s slow ack landed');

      // R's phantom edit — accepted because R (wrongly) believes itself the writer.
      R.DB.run('INSERT INTO people (name, type, email) VALUES (?,?,?)', ['Phantom', 'User', 'p@x.com']);
      // The real leader keeps working too, a beat later — its own IndexedDB write is a plain
      // local autosave, never delayed by the (broadcast-only) slow tag, so its 400ms debounce
      // fires strictly after R's own, deterministically landing last on disk, and still well
      // before O's 900ms-delayed ack ever reaches R.
      await sleep(50);
      O.DB.run('INSERT INTO people (name, type, email) VALUES (?,?,?)', ['LaterLeader', 'User', 'o2@x.com']);
      await sleep(500); // both tabs' own 400ms autosave debounces land; O's overwrites last

      await sleep(900); // O's slow (900ms) ack finally reaches R, demoting it for real

      assert.equal(R.DB.isReadOnly, true, 'R is correctly demoted once O\'s real ack arrives');
      const diskRows = await readDiskRows(fake, "SELECT name FROM people WHERE name IN ('Leader','Phantom','LaterLeader') ORDER BY name");
      const rMemRows = R.DB.rows("SELECT name FROM people WHERE name IN ('Leader','Phantom','LaterLeader') ORDER BY name");
      assert.deepEqual(rMemRows, diskRows, 'R\'s in-memory copy must converge on disk, not keep showing the never-persisted-for-real Phantom row');
      assert.equal(rMemRows.some((r) => r.name === 'Phantom'), false, 'the phantom row must not survive in R\'s memory once demoted');
      assert.equal(rMemRows.some((r) => r.name === 'LaterLeader'), true, 'R\'s memory must reflect the real leader\'s later work');

      const discardToasts = R.events.toasts.filter((t) => t[0] === 'Unsaved changes in this tab were discarded because another tab is saving.' && t[1] === 'error');
      assert.equal(discardToasts.length, 1, 'the discard warning must fire exactly once, even though `dirty` was already false when the demotion happened');
      assert.ok(R.events.refreshes > 0, 'the screen must be re-rendered from the reloaded (correct) bytes');
    } finally {
      globalThis.BroadcastChannel = savedBC;
      globalThis.indexedDB = savedIDB;
      globalThis.initSqlJs = savedInit;
      globalThis.App = savedApp;
    }
  });
});

describe('C6-guard item 2: teardown must clear a pending rejoin grace timer and lock the tab read-only', () => {
  test('a pagehide mid-grace never lets a torn-down tab promote or write afterward', async () => {
    const savedBC = globalThis.BroadcastChannel;
    const savedIDB = globalThis.indexedDB;
    const savedInit = globalThis.initSqlJs;
    const savedApp = globalThis.App;
    const tagRef = { tag: '?' };
    try {
      // O's ack is slow (900ms) — comfortably outside both the 300ms grace and the window this
      // test waits out, so the only thing that could ever promote B is the leftover grace timer.
      globalThis.BroadcastChannel = makeTaggedBroadcastChannelClass(tagRef, (tag) => (tag === 'O' ? 900 : 0));
      const fake = makeFakeIndexedDB();
      globalThis.indexedDB = { open: (...args) => fake.open(...args) };

      const O = await bootTaggedTab(tagRef, 'O');
      await sleep(30);
      const B = await bootTaggedTab(tagRef, 'B');
      await sleep(60);
      O.DB.run('INSERT INTO people (name, type, email) VALUES (?,?,?)', ['Baseline', 'User', 'b@x.com']);
      await sleep(700);

      B.events.states.length = 0;
      await B.fire('pageshow', { persisted: true }); // starts B's rejoin grace timer
      await sleep(30);
      await B.fire('pagehide', {}); // torn down mid-grace, well before the 300ms timer would fire
      assert.equal(B.DB.isReadOnly, true, 'B is still read-only right after teardown');

      await sleep(900); // past both the 300ms grace and (for good measure) O's 900ms ack window

      const promotedAfterTeardown = B.events.states.some((s) => s[0] === false && s[1] && s[1].promoted);
      assert.equal(promotedAfterTeardown, false, 'the leftover grace timer must never promote a torn-down tab');
      assert.equal(B.DB.isReadOnly, true, 'B must remain read-only permanently once torn down');

      let wrote = false;
      try { B.DB.run("INSERT INTO people (name, type, email) VALUES (?,?,?)", ['Zombie', 'User', 'z@x.com']); wrote = true; } catch (_) {}
      assert.equal(wrote, false, 'a torn-down tab must never be able to write, even long after teardown');

      const diskRows = await readDiskRows(fake, "SELECT name FROM people WHERE name IN ('Baseline','Zombie')");
      assert.deepEqual(diskRows.map((r) => r.name), ['Baseline'], 'no zombie write may ever reach disk');
    } finally {
      globalThis.BroadcastChannel = savedBC;
      globalThis.indexedDB = savedIDB;
      globalThis.initSqlJs = savedInit;
      globalThis.App = savedApp;
    }
  });
});

describe('C6-guard item 3: only an ack from an older peer may end the rejoin grace early', () => {
  test('a hello-ack from a peer with a NEWER timestamp must not cause an early promotion', async () => {
    const savedBC = globalThis.BroadcastChannel;
    const savedIDB = globalThis.indexedDB;
    const savedInit = globalThis.initSqlJs;
    const savedApp = globalThis.App;
    const tagRef = { tag: '?' };
    try {
      globalThis.BroadcastChannel = makeTaggedBroadcastChannelClass(tagRef, () => 0);
      const fake = makeFakeIndexedDB();
      globalThis.indexedDB = { open: (...args) => fake.open(...args) };

      const A = await bootTaggedTab(tagRef, 'A');
      await sleep(30);
      assert.equal(A.DB.isReadOnly, false, 'sanity: A is alone, so it is the writer');

      A.events.states.length = 0;
      await A.fire('pageshow', { persisted: true }); // A rejoins: read-only, fresh ts, grace starts
      assert.equal(A.DB.isReadOnly, true, 'A is read-only the instant it rejoins');

      // Inject a synthetic hello-ack from a peer with a timestamp strictly NEWER than A's own
      // freshly-reset one. A real third tab booted at this point could never actually produce
      // this ack in this fake (it isn't registered when A's own `hello` goes out), which is
      // exactly why this is injected directly on the same-named channel instead.
      const spy = new globalThis.BroadcastChannel('cf-tab-guard:core-facility');
      spy.postMessage({ type: 'hello-ack', id: 'newer-peer', ts: Date.now() + 60000 });

      await sleep(100); // comfortably before the 300ms grace elapses on its own
      assert.equal(A.DB.isReadOnly, true, 'a newer peer\'s ack must not end the grace early or promote A');

      await sleep(250); // past the natural 300ms grace — nobody OLDER ever answered, so A promotes for real
      assert.equal(A.DB.isReadOnly, false, 'A still promotes once the grace genuinely elapses with no older peer proven');
      const promotedStates = A.events.states.filter((s) => s[0] === false && s[1] && s[1].promoted);
      assert.equal(promotedStates.length, 1, 'exactly one (correctly-timed) promotion, not an early one triggered by the newer ack');
    } finally {
      globalThis.BroadcastChannel = savedBC;
      globalThis.indexedDB = savedIDB;
      globalThis.initSqlJs = savedInit;
      globalThis.App = savedApp;
    }
  });

  test('a hello-ack from a peer with an OLDER timestamp keeps the rejoiner read-only past the grace window', async () => {
    const savedBC = globalThis.BroadcastChannel;
    const savedIDB = globalThis.indexedDB;
    const savedInit = globalThis.initSqlJs;
    const savedApp = globalThis.App;
    const tagRef = { tag: '?' };
    try {
      globalThis.BroadcastChannel = makeTaggedBroadcastChannelClass(tagRef, () => 0);
      const fake = makeFakeIndexedDB();
      globalThis.indexedDB = { open: (...args) => fake.open(...args) };

      const B = await bootTaggedTab(tagRef, 'B');
      await sleep(30);

      B.events.states.length = 0;
      await B.fire('pageshow', { persisted: true });

      const spy = new globalThis.BroadcastChannel('cf-tab-guard:core-facility');
      spy.postMessage({ type: 'hello-ack', id: 'older-peer', ts: Date.now() - 60000 });

      await sleep(350); // well past the 300ms grace window
      assert.equal(B.DB.isReadOnly, true, 'an ack proving an older peer exists must keep this tab read-only past the whole grace window');
      const promotedStates = B.events.states.filter((s) => s[0] === false && s[1] && s[1].promoted);
      assert.equal(promotedStates.length, 0, 'no promotion should ever have been attempted once an older peer was proven to exist');
    } finally {
      globalThis.BroadcastChannel = savedBC;
      globalThis.indexedDB = savedIDB;
      globalThis.initSqlJs = savedInit;
      globalThis.App = savedApp;
    }
  });
});

describe('C6-guard coverage: a lone tab still becomes writer once the grace genuinely elapses', () => {
  test('~300ms after a lone rejoin, with nobody else ever announcing, the tab promotes and can write', async () => {
    const savedBC = globalThis.BroadcastChannel;
    const savedIDB = globalThis.indexedDB;
    const savedInit = globalThis.initSqlJs;
    const savedApp = globalThis.App;
    const tagRef = { tag: '?' };
    try {
      globalThis.BroadcastChannel = makeTaggedBroadcastChannelClass(tagRef, () => 0);
      const fake = makeFakeIndexedDB();
      globalThis.indexedDB = { open: (...args) => fake.open(...args) };

      const A = await bootTaggedTab(tagRef, 'A');
      await sleep(30);
      await A.fire('pageshow', { persisted: true });
      assert.equal(A.DB.isReadOnly, true, 'read-only for the duration of the grace window');
      await sleep(150);
      assert.equal(A.DB.isReadOnly, true, 'still read-only mid-grace');
      await sleep(200); // total > REJOIN_GRACE_MS (300ms)
      assert.equal(A.DB.isReadOnly, false, 'promoted once the grace elapses with nobody else ever heard from');
      assert.doesNotThrow(() => A.DB.run("INSERT INTO people (name, type, email) VALUES (?,?,?)", ['Lone', 'User', 'l@x.com']));
    } finally {
      globalThis.BroadcastChannel = savedBC;
      globalThis.indexedDB = savedIDB;
      globalThis.initSqlJs = savedInit;
      globalThis.App = savedApp;
    }
  });
});

// Reads rows straight off the fake IndexedDB's persisted bytes (never through a live `db` handle)
// so a test can assert what's actually on disk independent of any tab's in-memory state.
async function readDiskRows(fake, sql) {
  const raw = await new Promise((resolve, reject) => {
    const req = fake.open('core-facility', 1);
    req.onsuccess = () => {
      const handle = req.result;
      const tx = handle.transaction('kv', 'readonly');
      const get = tx.objectStore('kv').get('core.db');
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    };
  });
  const bytes = raw && raw.v !== undefined ? raw.v : raw;
  if (!bytes) return [];
  const SQL = await realInitSqljs();
  const d = new SQL.Database(bytes);
  const res = d.exec(sql);
  if (!res.length) return [];
  return res[0].values.map((row) => {
    const obj = {};
    res[0].columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}
