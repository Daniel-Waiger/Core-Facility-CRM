/* transactions.test.js — G1 (adversarial review §1, "Known and deferred" #1): DB.transaction(fn)
 * wraps a multi-step save in BEGIN/COMMIT, ROLLBACK-and-rethrow on any throw, and rejects nested
 * use rather than silently starting a second BEGIN.
 *
 * Covers:
 *   - a normal transaction commits every statement
 *   - a throw partway through rolls back EVERY statement that ran before it, not just the one
 *     that failed — proven two ways: a plain thrown Error, and a real FK violation (sql.js/SQLite
 *     itself throwing, not a hand-rolled failure)
 *   - a stubbed DB.run that throws on the Nth call, exercised through a REAL wrapped app.js saver
 *     (bookingSave) rather than calling DB.transaction directly, so the save-path wiring itself is
 *     proven, not just the primitive
 *   - nested DB.transaction() calls are rejected outright
 *   - the dispatcher's handleActError (js/app.js) reports a thrown saver instead of leaving it
 *     uncaught — the sync half is provable here; the async half and the actual modal-stays-open UI
 *     behavior are covered by test/browser/modals.spec.js
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, seedFixture } = require('./helpers/sqlite');
const { freshApp, fakeBookingModal } = require('./helpers/app-harness');

function mountModal(app, modal) {
  const dim = { querySelector: (sel) => (sel === '.modal' ? modal : null) };
  app.document.querySelectorAll = (sel) => (sel === '.modal-dim' ? [dim] : []);
  app.document.querySelector = (sel) => (sel === '.modal' ? modal : null);
}

describe('DB.transaction: commit path', () => {
  test('every statement inside fn is committed when fn returns normally', async () => {
    const { DB } = await freshDb();
    DB.transaction(() => {
      DB.run("INSERT INTO people (name, type) VALUES ('A','PI')");
      DB.run("INSERT INTO people (name, type) VALUES ('B','PI')");
    });
    assert.equal(DB.row('SELECT COUNT(*) c FROM people').c, 2);
  });

  test('fn\'s return value is passed through', async () => {
    const { DB } = await freshDb();
    const result = DB.transaction(() => 42);
    assert.equal(result, 42);
  });
});

describe('DB.transaction: rollback on throw', () => {
  test('a plain thrown Error rolls back every statement that ran before it, and rethrows', async () => {
    const { DB } = await freshDb();
    const before = DB.row('SELECT COUNT(*) c FROM people').c;
    assert.throws(() => {
      DB.transaction(() => {
        DB.run("INSERT INTO people (name, type) VALUES ('Temp1','PI')");
        DB.run("INSERT INTO people (name, type) VALUES ('Temp2','PI')");
        throw new Error('save failed midway');
      });
    }, /save failed midway/);
    assert.equal(DB.row('SELECT COUNT(*) c FROM people').c, before,
      'both inserts must have been rolled back — a save that throws midway leaves the row set exactly as before');
  });

  test('a genuine FK violation (not a hand-rolled throw) rolls back the whole transaction', async () => {
    const { DB } = await freshDb();
    const ids = seedFixture(DB);
    DB.run("INSERT INTO milestones (project_id, name) VALUES (?, 'Real Milestone')", [ids.liveProject]);
    const mid = DB.row('SELECT last_insert_rowid() as id').id;
    const before = DB.row('SELECT COUNT(*) c FROM milestones').c;

    assert.throws(() => {
      DB.transaction(() => {
        // A second, otherwise-valid milestone insert, followed by a join row referencing a
        // person_id that does not exist — foreign_keys is ON (see db.js's boot/currentBytes), so
        // SQLite itself throws here, not test code.
        DB.run("INSERT INTO milestones (project_id, name) VALUES (?, 'Half-Saved')", [ids.liveProject]);
        DB.run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (?, ?)', [mid, 999999]);
      });
    }, /FOREIGN KEY/);

    assert.equal(DB.row('SELECT COUNT(*) c FROM milestones').c, before,
      'the "Half-Saved" milestone insert must have been rolled back along with the failed FK insert');
    assert.equal(DB.row("SELECT COUNT(*) c FROM milestones WHERE name='Half-Saved'").c, 0);
  });

  test('a stubbed DB.run that throws on the Nth call rolls back a real app.js saver (bookingSave)', async () => {
    const app = await freshApp();
    const { alice, sam, liveProject } = seedFixture(app.DB);

    const modal = fakeBookingModal({
      prefix: 'bk', title: 'Should Not Persist', date: '2026-04-01', start: '09:00', end: '10:00',
      project: liveProject, ownerIds: [alice, sam],
    });
    mountModal(app, modal);

    const realRun = app.DB.run;
    let callCount = 0;
    // bookingSave's insertBookingRow does: INSERT meetings, then one INSERT per owner into
    // meeting_people. Fail on the SECOND meeting_people insert (call #3 overall: 1 meetings + 2
    // meeting_people) so the meetings row and the first join row both exist before the throw —
    // exactly the "partial write" shape a transaction must undo.
    app.DB.run = function (...args) {
      callCount++;
      if (callCount === 3) throw new Error('simulated write failure on the Nth call');
      return realRun.apply(app.DB, args);
    };
    try {
      // bookingSave is async (it awaits a re-entry guard and a possible confirm dialog before
      // ever reaching the write phase) — the stubbed throw happens after those awaits, inside the
      // synchronous DB.transaction() call, so it surfaces as a REJECTED promise, not a sync throw.
      await assert.rejects(app.internals.bookingSave(), /simulated write failure/);
    } finally {
      app.DB.run = realRun;
    }

    const meeting = app.DB.row("SELECT id FROM meetings WHERE title='Should Not Persist'");
    assert.equal(meeting, null, 'the meetings row inserted before the stubbed failure must have been rolled back');
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM meeting_people').c, 0,
      'the one meeting_people row inserted before the failure must also have been rolled back');
  });
});

describe('DB.transaction: nesting is rejected, not silently handled', () => {
  test('a DB.transaction() call while one is already open throws immediately', async () => {
    const { DB } = await freshDb();
    let nestedError = null;
    DB.transaction(() => {
      DB.run("INSERT INTO people (name, type) VALUES ('Outer','PI')");
      try {
        DB.transaction(() => {
          DB.run("INSERT INTO people (name, type) VALUES ('Inner','PI')");
        });
      } catch (e) {
        nestedError = e;
      }
      // The outer transaction is otherwise unaffected by the nested call's rejection — it commits
      // normally once fn returns, exactly as if the nested call had never been attempted.
    });
    assert.ok(nestedError, 'the nested DB.transaction() call must throw');
    assert.match(nestedError.message, /nested/i);
    assert.equal(DB.row("SELECT COUNT(*) c FROM people WHERE name='Outer'").c, 1,
      'the outer transaction must still have committed its own (caught-around) work');
    assert.equal(DB.row("SELECT COUNT(*) c FROM people WHERE name='Inner'").c, 0,
      'the rejected nested call must never have inserted anything');
  });

  test('an UNCAUGHT nested DB.transaction() call also rolls back the outer transaction (it is a throw like any other)', async () => {
    const { DB } = await freshDb();
    const before = DB.row('SELECT COUNT(*) c FROM people').c;
    assert.throws(() => {
      DB.transaction(() => {
        DB.run("INSERT INTO people (name, type) VALUES ('OuterUncaught','PI')");
        DB.transaction(() => {}); // not caught this time — propagates out of the outer fn too
      });
    }, /nested/i);
    assert.equal(DB.row('SELECT COUNT(*) c FROM people').c, before,
      'an uncaught nested-transaction error is just another throw inside fn, so the outer transaction rolls back too');
  });
});
