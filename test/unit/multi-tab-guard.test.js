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
