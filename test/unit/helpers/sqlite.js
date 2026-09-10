/* sqlite.js — a real, working DB module backed by an in-memory database.
 *
 * The app already has a fully functional never-persisting mode, and it is reachable here for
 * free. `DB.boot()` calls `probeStorage()`, which sets memoryMode when `typeof indexedDB ===
 * 'undefined'` — which is exactly the situation in Node. So booting without an indexedDB stub
 * gives a genuine sql.js database with the real schema, the real migrations, and every DB.*
 * function wired to it. Nothing is faked, and nothing is written to disk.
 *
 * The one piece to supply is sql.js itself: db.js looks for `global.initSqlJs`, which the browser
 * gets from the <script> tag for libs/sql-asm.js. Requiring that file returns the same function,
 * so assigning it to the global closes the gap.
 *
 * Prefer this over hand-rolling a schema: a test that builds its own tables proves nothing about
 * the schema the app actually ships.
 */
'use strict';

const path = require('path');
const { loadApp, REPO } = require('./load-module');

/* Boot a fresh in-memory DB module. Returns everything loadApp returns, so a caller also gets UI
   (needed by db.js's booking helpers, which call UI.computeBookingBOM and UI.todayPlusDays). */
async function freshDb({ search = '', store = {} } = {}) {
  const app = loadApp(['consts', 'db', 'ui'], { search, store });

  // sql.js, exactly as the browser's <script> tag would provide it.
  globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));

  const status = await app.DB.boot();
  return { ...app, status };
}

/* A small, predictable fixture: two people, two instruments, two projects (one active, one
   archived), wired together. Deliberately hand-built rather than using the demo seed, because the
   demo seed refuses to run outside the sandbox and carries 120 rows of noise a focused assertion
   does not want. Returns the ids it created so tests need not guess. */
function seedFixture(DB) {
  DB.run("INSERT INTO people (name, type, organization, is_staff, rate) VALUES ('Alice','PI','Bio Lab',0,0)");
  DB.run("INSERT INTO people (name, type, organization, is_staff, rate) VALUES ('Sam','Facility Staff','Core',1,90)");
  DB.run("INSERT INTO instruments (name, status, cost, cost_unit) VALUES ('Scope A','Available',200,'time')");
  DB.run("INSERT INTO instruments (name, status, cost, cost_unit) VALUES ('Prep B','Available',15,'sample')");
  DB.run("INSERT INTO projects (title, code, status, is_archived, pi_id) VALUES ('Live','P-1','Active',0,1)");
  DB.run("INSERT INTO projects (title, code, status, is_archived, pi_id) VALUES ('Old','P-2','Completed',1,1)");
  DB.run("INSERT INTO project_people (project_id, person_id, role) VALUES (1,1,'PI')");
  DB.run("INSERT INTO project_people (project_id, person_id, role) VALUES (2,1,'PI')");
  DB.run("INSERT INTO project_instruments (project_id, instrument_id) VALUES (1,1)");
  DB.run("INSERT INTO project_instruments (project_id, instrument_id) VALUES (2,1)");
  return {
    alice: 1, sam: 2,
    scopeA: 1, prepB: 2,
    liveProject: 1, archivedProject: 2,
  };
}

module.exports = { freshDb, seedFixture };
