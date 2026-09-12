/* booking-sync.test.js — meetings.attendees (denormalized display string) stays in sync with
 * meeting_people (the real relational link) through the APP'S OWN SAVE PATH, not just the demo
 * seed — CLAUDE.md's "keep both in sync on every save", and the exact class of bug it documents
 * (a demo meeting once showed attendee names while every join-based feature saw zero attendees).
 * schema.test.js already covers the seed path (DB.seedSampleData()); this file covers
 * bookingSave/bookingEditSave themselves, which is what the review report's "untested invariants"
 * list actually asked for.
 *
 * bookingSave/bookingEditSave are DOM-bound (`document.querySelector('.modal')`, then a dozen more
 * lookups inside it — see js/app.js), so this file runs the REAL functions against a hand-built
 * stand-in for an open modal (helpers/app-harness.js's fakeBookingModal) rather than a real DOM.
 * That stand-in only models the no-instrument/no-staff shape (see its own header comment for why),
 * which is exactly what this file needs: it is testing the People picker's effect on attendees/
 * meeting_people, not the cost breakdown.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, fakeBookingModal } = require('./helpers/app-harness');
/* The savers read their form off UI.topModal() — the `.modal` inside the LAST `.modal-dim` in the
 * document (see js/ui.js). Present the fake modal through exactly that lookup. */
function mountModal(app, modal) {
  const dim = { querySelector: (sel) => (sel === '.modal' ? modal : null) };
  app.document.querySelectorAll = (sel) => (sel === '.modal-dim' ? [dim] : []);
  app.document.querySelector = (sel) => (sel === '.modal' ? modal : null);
}

const { seedFixture } = require('./helpers/sqlite');

function attendeeState(DB, meetingId) {
  const m = DB.row('SELECT attendees FROM meetings WHERE id=?', [meetingId]);
  const joinNames = DB.rows(
    'SELECT p.name FROM meeting_people mp JOIN people p ON p.id = mp.person_id WHERE mp.meeting_id=? ORDER BY p.name',
    [meetingId]
  ).map((r) => r.name);
  const stringNames = (m.attendees || '').split(',').map((s) => s.trim()).filter(Boolean).sort();
  return { joinNames: joinNames.slice().sort(), stringNames };
}

describe('bookingSave: attendees string and meeting_people are written together', () => {
  test('saving a new booking with two owners inserts BOTH the meeting_people rows and the matching attendees string', async () => {
    const app = await freshApp();
    const { alice, sam, liveProject } = seedFixture(app.DB);

    const modal = fakeBookingModal({
      prefix: 'bk', title: 'New Session', date: '2026-04-01', start: '09:00', end: '10:00',
      project: liveProject, ownerIds: [alice, sam],
    });
    mountModal(app, modal);

    app.internals.bookingSave();

    const meeting = app.DB.row("SELECT id FROM meetings WHERE title='New Session'");
    assert.ok(meeting, 'bookingSave must have inserted a meetings row');
    const { joinNames, stringNames } = attendeeState(app.DB, meeting.id);
    assert.deepEqual(joinNames, ['Alice', 'Sam']);
    assert.deepEqual(stringNames, ['Alice', 'Sam']);
    assert.deepEqual(joinNames, stringNames, 'meeting_people and the denormalized attendees string must agree — CLAUDE.md');
  });

  test('saving a new booking with NO owners leaves both the attendees string and meeting_people empty', async () => {
    const app = await freshApp();
    const { liveProject } = seedFixture(app.DB);

    const modal = fakeBookingModal({
      prefix: 'bk', title: 'No Owners', date: '2026-04-01', start: '09:00', end: '10:00',
      project: liveProject, ownerIds: [],
    });
    mountModal(app, modal);

    app.internals.bookingSave();

    const meeting = app.DB.row("SELECT id, attendees FROM meetings WHERE title='No Owners'");
    assert.ok(meeting);
    assert.equal(meeting.attendees, '');
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM meeting_people WHERE meeting_id=?', [meeting.id]).c, 0);
  });
});

describe('bookingEditSave: the delete-then-reinsert rebuild keeps attendees and meeting_people in sync', () => {
  function existingBooking(app, { liveProject, alice }) {
    app.DB.run(
      "INSERT INTO meetings (project_id, title, date, start_time, end_time, attendees, category) VALUES (?, 'Existing', '2026-04-01','09:00','10:00','Alice','')",
      [liveProject]
    );
    const id = app.DB.row('SELECT last_insert_rowid() as id').id;
    app.DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [id, alice]);
    return id;
  }

  test('adding a second owner on edit updates BOTH meeting_people and the attendees string', async () => {
    const app = await freshApp();
    const { alice, sam, liveProject } = seedFixture(app.DB);
    const id = existingBooking(app, { liveProject, alice });

    const modal = fakeBookingModal({
      prefix: 'bke', title: 'Existing', date: '2026-04-01', start: '09:00', end: '10:00',
      project: liveProject, ownerIds: [alice, sam],
    });
    mountModal(app, modal);

    app.internals.bookingEditSave(id);

    const { joinNames, stringNames } = attendeeState(app.DB, id);
    assert.deepEqual(joinNames, ['Alice', 'Sam']);
    assert.deepEqual(joinNames, stringNames);
  });

  test('REMOVING an owner on edit drops them from meeting_people AND recomputes the attendees string — ' +
    'the exact drift CLAUDE.md warns a "rebuild from whatever the form currently renders" save must avoid', async () => {
    const app = await freshApp();
    const { alice, sam, liveProject } = seedFixture(app.DB);
    // Start with BOTH Alice and Sam already attending.
    app.DB.run(
      "INSERT INTO meetings (project_id, title, date, start_time, end_time, attendees, category) VALUES (?, 'Existing', '2026-04-01','09:00','10:00','Alice, Sam','')",
      [liveProject]
    );
    const id = app.DB.row('SELECT last_insert_rowid() as id').id;
    app.DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [id, alice]);
    app.DB.run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [id, sam]);

    // The form now only shows Alice — Sam was unpicked.
    const modal = fakeBookingModal({
      prefix: 'bke', title: 'Existing', date: '2026-04-01', start: '09:00', end: '10:00',
      project: liveProject, ownerIds: [alice],
    });
    mountModal(app, modal);

    app.internals.bookingEditSave(id);

    const { joinNames, stringNames } = attendeeState(app.DB, id);
    assert.deepEqual(joinNames, ['Alice'], 'meeting_people must drop Sam');
    assert.deepEqual(stringNames, ['Alice'], 'the attendees string must be recomputed, not left stale with "Sam" still in it');
  });

  test('clearing every owner on edit empties both the attendees string and meeting_people', async () => {
    const app = await freshApp();
    const { alice, liveProject } = seedFixture(app.DB);
    const id = existingBooking(app, { liveProject, alice });

    const modal = fakeBookingModal({
      prefix: 'bke', title: 'Existing', date: '2026-04-01', start: '09:00', end: '10:00',
      project: liveProject, ownerIds: [],
    });
    mountModal(app, modal);

    app.internals.bookingEditSave(id);

    const m = app.DB.row('SELECT attendees FROM meetings WHERE id=?', [id]);
    assert.equal(m.attendees, '');
    assert.equal(app.DB.row('SELECT COUNT(*) c FROM meeting_people WHERE meeting_id=?', [id]).c, 0);
  });
});
