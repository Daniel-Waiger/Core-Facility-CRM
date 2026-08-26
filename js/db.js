/* db.js — sql.js init, schema, persistence, backup */
(function (global) {
  'use strict';

  /* ---------------- Schema ---------------- */
  const SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'Initiated',
    priority TEXT DEFAULT 'Medium',
    funding TEXT DEFAULT '',
    modality TEXT DEFAULT '',
    sample TEXT DEFAULT '',
    flags TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    pi_id INTEGER,
    start_date TEXT,
    end_date TEXT,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    organization TEXT DEFAULT '',
    email TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS instruments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT DEFAULT '',
    status TEXT DEFAULT 'Available',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS project_people (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role TEXT DEFAULT '',
    PRIMARY KEY (project_id, person_id)
  );
  CREATE TABLE IF NOT EXISTS project_instruments (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, instrument_id)
  );
  CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS milestone_owners (
    milestone_id INTEGER NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (milestone_id, person_id)
  );
  CREATE TABLE IF NOT EXISTS milestone_instruments (
    milestone_id INTEGER NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    PRIMARY KEY (milestone_id, instrument_id)
  );
  CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    date TEXT,
    attendees TEXT DEFAULT '',
    note TEXT DEFAULT '',
    actions TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT DEFAULT 'upload',
    path TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS kv (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ix_milestones_project ON milestones(project_id);
  CREATE INDEX IF NOT EXISTS ix_meetings_project ON meetings(project_id);
  CREATE INDEX IF NOT EXISTS ix_files_project ON files(project_id);
  CREATE INDEX IF NOT EXISTS ix_kv_project ON kv(project_id);
  `;

  /* ---------------- sql.js bootstrap ---------------- */
  let db = null;
  const DB_KEY = 'core.db';
  const UPLOAD_KEY = 'uploads';

  async function initSqljs() {
    if (!global.initSqlJs) throw new Error('sql.js not loaded — check libs/');
    return global.initSqlJs();
  }

  function migrate() {
    // Graceful column migrations for existing databases
    try { db.exec("ALTER TABLE projects ADD COLUMN sample TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE projects ADD COLUMN flags TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE people ADD COLUMN organization TEXT DEFAULT ''"); } catch (_) {}
  }

  async function boot() {
    const SQL = await initSqljs();
    const blob = await idbGet(DB_KEY);
    if (blob) {
      db = new SQL.Database(blob);
      db.exec('PRAGMA foreign_keys = ON;');
      migrate();
    } else {
      db = new SQL.Database();
      db.exec(SCHEMA);
    }
    return db;
  }

  /* ---------------- Persistence (IndexedDB) ---------------- */
  let idbHandle = null;
  function idbOpen() {
    if (idbHandle) return Promise.resolve(idbHandle);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('core-facility', 1);
      req.onupgradeneeded = () => {
        const s = req.result;
        if (!s.objectStoreNames.contains('kv')) s.createObjectStore('kv', { keyPath: 'k' });
      };
      req.onsuccess = () => {
        idbHandle = req.result;
        resolve(idbHandle);
      };
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const s = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = s.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result && req.result.v);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, val) {
    const s = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = s.transaction('kv', 'readwrite');
      const req = tx.objectStore('kv').put({ k: key, v: val });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function currentBytes() { return db.export(); }

  /* Debounced autosave: every mutation calls markDirty() */
  let saveTimer = null;
  let dirty = false;
  function markDirty() {
    dirty = true;
    if (global.App && global.App.onSaving) global.App.onSaving();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!dirty) return;
      dirty = false;
      try {
        await idbSet(DB_KEY, currentBytes());
        if (global.App && global.App.onSaved) global.App.onSaved();
      } catch (e) {
        console.error('autosave failed', e);
      }
    }, 400);
  }

  /* ---------------- Backup (single self-contained file) ---------------- */
  function buildBackup() {
    return {
      kind: 'core-facility-backup',
      version: 1,
      created: new Date().toISOString(),
      db: Array.from(currentBytes()),
      uploads: global.__uploads || {},
    };
  }

  async function restoreBackup(data) {
    if (data.kind !== 'core-facility-backup' || !data.db) throw new Error('Not a valid backup file.');
    const SQL = await initSqljs();
    const rawBytes = Array.isArray(data.db) ? new Uint8Array(data.db) : data.db;
    db = new SQL.Database(rawBytes);
    db.exec('PRAGMA foreign_keys = ON;');
    migrate();
    global.__uploads = data.uploads || {};
    await idbSet(DB_KEY, currentBytes());
    for (const [k, v] of Object.entries(data.uploads || {})) await idbSet(UPLOAD_KEY + ':' + k, v);
  }

  /* ---------------- Uploads (IndexedDB) ---------------- */
  async function saveUpload(name, blob) { await idbSet(UPLOAD_KEY + ':' + name, blob); }
  async function getUpload(name) { return idbGet(UPLOAD_KEY + ':' + name); }

  /* ---------------- Query helpers ---------------- */
  // Object-based rows helper
  function rows(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params && params.length) stmt.bind(params);
    const list = [];
    while (stmt.step()) {
      list.push(stmt.getAsObject());
    }
    stmt.free();
    return list;
  }

  // Object-based single row helper
  function row(sql, params = []) {
    const list = rows(sql, params);
    return list.length ? list[0] : null;
  }

  // Array-based backwards compatible helpers
  function q(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params && params.length) stmt.bind(params);
    const list = [];
    while (stmt.step()) list.push(stmt.getArray());
    stmt.free();
    return list;
  }
  function q1(sql, params = []) { return q(sql, params)[0] || null; }

  // Parameterized mutation helper
  function run(sql, params = []) {
    if (!params || params.length === 0) {
      db.exec(sql);
    } else {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      stmt.step();
      stmt.free();
    }
    markDirty();
  }

  /* ---------------- Compute: progress + flags ---------------- */
  function projectProgress(pid) {
    const r = row('SELECT COUNT(*) as c, COALESCE(SUM(CASE WHEN status="done" THEN 1 ELSE 0 END),0) as d FROM milestones WHERE project_id=?', [pid]);
    const c = (r && r.c) || 0;
    const d = (r && r.d) || 0;
    return { total: c, done: d, pct: c ? Math.round((d / c) * 100) : 0 };
  }

  function projectFlags(pid) {
    const flags = [];
    const now = new Date().toISOString().slice(0, 10);
    const ms = rows('SELECT status, due_date FROM milestones WHERE project_id=? AND status!="done"', [pid]);
    for (const m of ms) {
      if (m.due_date && m.due_date < now) {
        flags.push('overdue');
        break;
      }
    }
    return flags;
  }

  global.DB = {
    boot,
    currentBytes,
    markDirty,
    buildBackup,
    restoreBackup,
    saveUpload,
    getUpload,
    rows,
    row,
    q,
    q1,
    run,
    projectProgress,
    projectFlags
  };

})(window);
