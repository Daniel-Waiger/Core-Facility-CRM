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
    is_archived INTEGER DEFAULT 0,
    archived_at TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    organization TEXT DEFAULT '',
    department TEXT DEFAULT '',
    email TEXT DEFAULT '',
    note TEXT DEFAULT '',
    is_staff INTEGER DEFAULT 0,
    rate REAL DEFAULT 0,
    rate_unit TEXT DEFAULT 'hour',
    is_retired INTEGER DEFAULT 0,
    retired_at TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS instruments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT DEFAULT '',
    status TEXT DEFAULT 'Available',
    location TEXT DEFAULT '',
    note TEXT DEFAULT '',
    cost REAL DEFAULT 0,
    cost_unit TEXT DEFAULT 'time',
    is_retired INTEGER DEFAULT 0,
    retired_at TEXT DEFAULT '',
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
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    date TEXT,
    start_time TEXT DEFAULT '',
    end_time TEXT DEFAULT '',
    attendees TEXT DEFAULT '',
    link TEXT DEFAULT '',
    note TEXT DEFAULT '',
    actions TEXT DEFAULT '',
    discount_pct REAL DEFAULT 0,
    group_org TEXT DEFAULT '',
    group_discount_pct REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    total_before_tax REAL DEFAULT 0,
    total_cost REAL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS meeting_people (
    meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (meeting_id, person_id)
  );
  CREATE TABLE IF NOT EXISTS meeting_instruments (
    meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    amount REAL DEFAULT 0,
    line_cost REAL DEFAULT 0,
    PRIMARY KEY (meeting_id, instrument_id)
  );
  CREATE TABLE IF NOT EXISTS meeting_staff (
    meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    start_time TEXT DEFAULT '',
    end_time TEXT DEFAULT '',
    line_cost REAL DEFAULT 0,
    PRIMARY KEY (meeting_id, person_id)
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
  CREATE TABLE IF NOT EXISTS vocab (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    value TEXT NOT NULL,
    UNIQUE(category, value)
  );
  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS group_discounts (
    org TEXT PRIMARY KEY,
    percent REAL DEFAULT 0
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
    try { db.exec("ALTER TABLE people ADD COLUMN department TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE instruments ADD COLUMN location TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE meetings ADD COLUMN link TEXT DEFAULT ''"); } catch (_) {}
    // Instrument/staff booking + billing (cost, rates, times, discounts) — additive columns.
    try { db.exec("ALTER TABLE instruments ADD COLUMN cost REAL DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE instruments ADD COLUMN cost_unit TEXT DEFAULT 'time'"); } catch (_) {}
    try { db.exec("ALTER TABLE people ADD COLUMN is_staff INTEGER DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE people ADD COLUMN rate REAL DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE people ADD COLUMN rate_unit TEXT DEFAULT 'hour'"); } catch (_) {}
    try { db.exec("ALTER TABLE meetings ADD COLUMN start_time TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE meetings ADD COLUMN end_time TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE meetings ADD COLUMN discount_pct REAL DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE meetings ADD COLUMN group_org TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE meetings ADD COLUMN group_discount_pct REAL DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE meetings ADD COLUMN subtotal REAL DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE meetings ADD COLUMN total_before_tax REAL DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE meetings ADD COLUMN total_cost REAL DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE meeting_instruments ADD COLUMN amount REAL DEFAULT 0"); } catch (_) {}
    // Retirement: a person or instrument that leaves the facility is retired, never deleted, so
    // every historical record that references them (bookings, milestones, projects) stays intact.
    try { db.exec("ALTER TABLE people ADD COLUMN is_retired INTEGER DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE people ADD COLUMN retired_at TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE instruments ADD COLUMN is_retired INTEGER DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE instruments ADD COLUMN retired_at TEXT DEFAULT ''"); } catch (_) {}
    // A project is archived rather than deleted, for the same reason: its bookings, their cost
    // snapshots, and the team and instruments that worked on it are the facility's record of
    // what was actually done and billed.
    try { db.exec("ALTER TABLE projects ADD COLUMN is_archived INTEGER DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE projects ADD COLUMN archived_at TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE meeting_instruments ADD COLUMN line_cost REAL DEFAULT 0"); } catch (_) {}
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS vocab (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          value TEXT NOT NULL,
          UNIQUE(category, value)
        );
        CREATE TABLE IF NOT EXISTS meeting_people (
          meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
          person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          PRIMARY KEY (meeting_id, person_id)
        );
        CREATE TABLE IF NOT EXISTS meeting_instruments (
          meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
          instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
          amount REAL DEFAULT 0,
          line_cost REAL DEFAULT 0,
          PRIMARY KEY (meeting_id, instrument_id)
        );
        CREATE TABLE IF NOT EXISTS meeting_staff (
          meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
          person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          start_time TEXT DEFAULT '',
          end_time TEXT DEFAULT '',
          line_cost REAL DEFAULT 0,
          PRIMARY KEY (meeting_id, person_id)
        );
        CREATE TABLE IF NOT EXISTS app_config (
          key TEXT PRIMARY KEY,
          value TEXT
        );
        CREATE TABLE IF NOT EXISTS group_discounts (
          org TEXT PRIMARY KEY,
          percent REAL DEFAULT 0
        );
      `);
    } catch (_) {}

    // Relax meetings.project_id to nullable so a booking can stand alone (facility-wide,
    // not tied to a project). Older databases created it NOT NULL — SQLite can't ALTER a
    // column's constraint in place, so detect the old shape via the table's own SQL and,
    // if found, rebuild it the standard SQLite way (new table, copy rows, swap in).
    try {
      const info = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='meetings'");
      const createSql = (info[0] && info[0].values[0] && info[0].values[0][0]) || '';
      if (/project_id\s+INTEGER\s+NOT\s+NULL/i.test(createSql)) {
        db.exec(`
          PRAGMA foreign_keys = OFF;
          CREATE TABLE meetings_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
            title TEXT NOT NULL,
            date TEXT,
            start_time TEXT DEFAULT '',
            end_time TEXT DEFAULT '',
            attendees TEXT DEFAULT '',
            link TEXT DEFAULT '',
            note TEXT DEFAULT '',
            actions TEXT DEFAULT '',
            discount_pct REAL DEFAULT 0,
            group_org TEXT DEFAULT '',
            group_discount_pct REAL DEFAULT 0,
            subtotal REAL DEFAULT 0,
            total_before_tax REAL DEFAULT 0,
            total_cost REAL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO meetings_new (id, project_id, title, date, start_time, end_time, attendees, link, note, actions, discount_pct, group_org, group_discount_pct, subtotal, total_before_tax, total_cost, created_at, updated_at)
            SELECT id, project_id, title, date, start_time, end_time, attendees, link, note, actions, discount_pct, group_org, group_discount_pct, subtotal, total_before_tax, total_cost, created_at, updated_at FROM meetings;
          DROP TABLE meetings;
          ALTER TABLE meetings_new RENAME TO meetings;
          CREATE INDEX IF NOT EXISTS ix_meetings_project ON meetings(project_id);
          PRAGMA foreign_keys = ON;
        `);
      }
    } catch (e) { console.warn('meetings.project_id migration skipped:', e); }
  }

  async function boot() {
    const SQL = await initSqljs();
    await probeStorage();

    let blob;
    if (!memoryMode) {
      try {
        blob = await idbGet(DB_KEY);
      } catch (e) {
        // IndexedDB opened but a read failed mid-boot (seen on some locked-down mobile
        // WebViews) — fall back to an in-memory session rather than blank-screening.
        console.warn('IndexedDB read failed, continuing in a temporary in-memory session:', e);
        memoryMode = true;
      }
    }

    if (blob) {
      db = new SQL.Database(blob);
      db.exec('PRAGMA foreign_keys = ON;');
      migrate();
    } else {
      db = new SQL.Database();
      db.exec(SCHEMA);
    }
    return { persistent: !memoryMode };
  }

  /* ---------------- Storage availability probe ----------------
     IndexedDB requires a "secure context" (https, or localhost) — a document opened
     via file:// (e.g. double-tapping index.html on a tablet) is commonly treated as an
     untrusted origin, where IndexedDB is disabled outright or hangs without ever firing
     onsuccess/onerror. Rather than let boot() hang or throw and blank the page, we probe
     it up front with a timeout and, if it's unusable, fall back to an in-memory KV store
     so the app still runs (just without saving between sessions on this device). */
  let memoryMode = false;
  const memoryStore = new Map();

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error((label || 'operation') + ' timed out after ' + ms + 'ms'));
      }, ms);
      promise.then(
        (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); },
        (e) => { if (settled) return; settled = true; clearTimeout(timer); reject(e); }
      );
    });
  }

  async function probeStorage() {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      memoryMode = true;
      return false;
    }
    try {
      await withTimeout(idbOpen(), 3000, 'IndexedDB open');
      memoryMode = false;
      return true;
    } catch (e) {
      console.warn('IndexedDB unavailable — running in a temporary in-memory session:', e);
      memoryMode = true;
      return false;
    }
  }

  /* ---------------- Persistence (IndexedDB, with in-memory fallback) ---------------- */
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
    if (memoryMode) return memoryStore.has(key) ? memoryStore.get(key) : undefined;
    const s = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = s.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result && req.result.v);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, val) {
    if (memoryMode) { memoryStore.set(key, val); return; }
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
  async function idbGetAllWithPrefix(prefix) {
    if (memoryMode) {
      const results = [];
      for (const [k, v] of memoryStore) {
        if (String(k).startsWith(prefix)) results.push({ key: k, value: v });
      }
      return results;
    }
    const s = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = s.transaction('kv', 'readonly');
      const store = tx.objectStore('kv');
      const results = [];
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (String(cursor.key).startsWith(prefix)) results.push({ key: cursor.key, value: cursor.value.v });
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  /* ---------------- Blob <-> base64 (for JSON-safe backups) ---------------- */
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result; // data:<mime>;base64,<data>
        const comma = result.indexOf(',');
        resolve({ type: blob.type || 'application/octet-stream', data: result.slice(comma + 1) });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  function base64ToBlob(entry) {
    const bin = atob(entry.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: entry.type || 'application/octet-stream' });
  }

  function currentBytes() {
    const bytes = db.export();
    // sql.js's export() serializes the database as a side effect resets this connection's
    // foreign_keys pragma back to OFF (observed empirically — the pragma reads 1 right up
    // until the first export() call, then 0 forever after, on every build tested). Every
    // mutation schedules an autosave that calls this via markDirty(), so left unpatched,
    // ON DELETE CASCADE would silently stop firing ~400ms after the very first save of a
    // session. Reassert it immediately so cascades (project/person/instrument deletes →
    // their linked milestones/meetings/join-table rows) keep working for the rest of the
    // session, not just before the first autosave.
    db.exec('PRAGMA foreign_keys = ON;');
    return bytes;
  }

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
  async function buildBackup() {
    const uploadEntries = await idbGetAllWithPrefix(UPLOAD_KEY + ':');
    const uploads = {};
    for (const { key, value } of uploadEntries) {
      if (!value) continue;
      const name = key.slice((UPLOAD_KEY + ':').length);
      uploads[name] = await blobToBase64(value);
    }
    return {
      kind: 'core-facility-backup',
      version: 2,
      created: new Date().toISOString(),
      db: Array.from(currentBytes()),
      uploads,
    };
  }

  async function restoreBackup(data) {
    if (data.kind !== 'core-facility-backup' || !data.db) throw new Error('Not a valid backup file.');
    const SQL = await initSqljs();
    const rawBytes = Array.isArray(data.db) ? new Uint8Array(data.db) : data.db;
    db = new SQL.Database(rawBytes);
    db.exec('PRAGMA foreign_keys = ON;');
    migrate();
    await idbSet(DB_KEY, currentBytes());
    for (const [name, entry] of Object.entries(data.uploads || {})) {
      if (entry && typeof entry === 'object' && typeof entry.data === 'string') {
        await idbSet(UPLOAD_KEY + ':' + name, base64ToBlob(entry));
      }
    }
  }

  /* ---------------- Uploads (IndexedDB) ---------------- */
  async function saveUpload(name, blob) { await idbSet(UPLOAD_KEY + ':' + name, blob); }
  async function getUpload(name) { return idbGet(UPLOAD_KEY + ':' + name); }

  /* ---------------- Silent auto-backup folder handle (IndexedDB) ---------------- */
  const AUTO_BACKUP_DIR_KEY = 'auto-backup-dir-handle';
  async function saveAutoBackupDirHandle(handle) { await idbSet(AUTO_BACKUP_DIR_KEY, handle); }
  async function getAutoBackupDirHandle() { return idbGet(AUTO_BACKUP_DIR_KEY); }
  async function clearAutoBackupDirHandle() { await idbSet(AUTO_BACKUP_DIR_KEY, null); }

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
      }
    }
    return flags;
  }

  /* ---------------- Vocab (user-extensible dropdown terms) ----------------
     Built-in CONST[category] values are always shown first, then any
     facility-added terms on top — merged and deduped so callers never need
     to know which list a value came from. */
  function vocabList(category) {
    const defaults = (global.CONST && global.CONST[category]) || [];
    const custom = rows('SELECT value FROM vocab WHERE category=? ORDER BY value', [category]).map((r) => r.value);
    const hasOther = defaults.includes('Other') || custom.includes('Other');
    const seen = new Set();
    const out = [];
    for (const v of [...defaults, ...custom]) {
      // "Other" isn't a real term — it's the escape hatch that opens "+ Add New" — so it's
      // never listed among the regular options; it's appended once at the very end below.
      if (!v || v === 'Other' || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    if (hasOther) out.push('Other');
    return out;
  }
  function addVocab(category, value) {
    const v = String(value || '').trim();
    if (!v) return;
    run('INSERT OR IGNORE INTO vocab (category, value) VALUES (?,?)', [category, v]);
  }

  /* ---------------- App-wide config (billing rates, etc.) ----------------
     A tiny key/value store, same idea as `vocab` above, but for single settings
     rather than dropdown lists. Lives in the DB (not localStorage) so it travels
     with backup/restore — the overhead/tax rates a facility sets are as much
     "their data" as a project record is. */
  function getConfig(key, fallback = '') {
    const r = row('SELECT value FROM app_config WHERE key=?', [key]);
    return r ? r.value : fallback;
  }
  function getConfigNum(key, fallback = 0) {
    const v = getConfig(key, null);
    const n = v == null ? NaN : parseFloat(v);
    return isNaN(n) ? fallback : n;
  }
  function setConfig(key, value) {
    run('INSERT INTO app_config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)]);
  }

  /* ---------------- Group (organization) discounts ----------------
     A standing discount percent a facility can pre-set per lab/organization, so a
     booking under that lab auto-applies it without anyone re-typing it every time. */
  function getGroupDiscount(org) {
    if (!org) return 0;
    const r = row('SELECT percent FROM group_discounts WHERE org=?', [org]);
    return r ? Number(r.percent) || 0 : 0;
  }
  function setGroupDiscount(org, percent) {
    if (!org) return;
    run('INSERT INTO group_discounts (org, percent) VALUES (?,?) ON CONFLICT(org) DO UPDATE SET percent=excluded.percent', [org, Number(percent) || 0]);
  }
  function listGroupDiscounts() {
    return rows('SELECT org, percent FROM group_discounts ORDER BY org');
  }

  /* ---------------- Retirement (people & instruments) ----------------
     A person who leaves the facility, or an instrument that is decommissioned, must never be
     deleted while anything references them: who actually attended a booking and which
     instrument a session actually ran on are historical facts, and a booking's cost snapshot
     is only meaningful if the line items behind it still exist. So the object is marked
     retired instead — it keeps every link it ever had, is labelled "(Retired)" wherever it
     appears, and simply stops being offered when assigning new work.

     countPersonRefs/countInstrumentRefs report how much history a record carries. Zero
     references means there is nothing to preserve, so a genuine delete is safe and offered
     instead of retirement (otherwise a mistyped entry could never be tidied away). */
  function countPersonRefs(id) {
    const r = row(`SELECT
      (SELECT COUNT(*) FROM project_people WHERE person_id=?) AS projects,
      (SELECT COUNT(*) FROM milestone_owners WHERE person_id=?) AS milestones,
      (SELECT COUNT(*) FROM meeting_people WHERE person_id=?) AS bookings,
      (SELECT COUNT(*) FROM meeting_staff WHERE person_id=?) AS staffed,
      (SELECT COUNT(*) FROM projects WHERE pi_id=?) AS pi`, [id, id, id, id, id]) || {};
    const parts = {
      projects: r.projects || 0, milestones: r.milestones || 0,
      bookings: r.bookings || 0, staffed: r.staffed || 0, pi: r.pi || 0
    };
    parts.total = parts.projects + parts.milestones + parts.bookings + parts.staffed + parts.pi;
    return parts;
  }
  function countInstrumentRefs(id) {
    const r = row(`SELECT
      (SELECT COUNT(*) FROM project_instruments WHERE instrument_id=?) AS projects,
      (SELECT COUNT(*) FROM milestone_instruments WHERE instrument_id=?) AS milestones,
      (SELECT COUNT(*) FROM meeting_instruments WHERE instrument_id=?) AS bookings`,
      [id, id, id]) || {};
    const parts = {
      projects: r.projects || 0, milestones: r.milestones || 0, bookings: r.bookings || 0
    };
    parts.total = parts.projects + parts.milestones + parts.bookings;
    return parts;
  }
  function countProjectRefs(id) {
    const r = row(`SELECT
      (SELECT COUNT(*) FROM project_people WHERE project_id=?) AS team,
      (SELECT COUNT(*) FROM project_instruments WHERE project_id=?) AS instruments,
      (SELECT COUNT(*) FROM milestones WHERE project_id=?) AS milestones,
      (SELECT COUNT(*) FROM meetings WHERE project_id=?) AS bookings,
      (SELECT COUNT(*) FROM files WHERE project_id=?) AS files,
      (SELECT COUNT(*) FROM kv WHERE project_id=?) AS fields,
      (SELECT COALESCE(SUM(total_cost),0) FROM meetings WHERE project_id=?) AS billed`,
      [id, id, id, id, id, id, id]) || {};
    const parts = {
      team: r.team || 0, instruments: r.instruments || 0, milestones: r.milestones || 0,
      bookings: r.bookings || 0, files: r.files || 0, fields: r.fields || 0,
      billed: Number(r.billed) || 0
    };
    parts.total = parts.team + parts.instruments + parts.milestones + parts.bookings + parts.files + parts.fields;
    return parts;
  }
  function setProjectArchived(id, archived) {
    if (archived) {
      run("UPDATE projects SET is_archived=1, archived_at=datetime('now'), updated_at=datetime('now') WHERE id=?", [id]);
    } else {
      run("UPDATE projects SET is_archived=0, archived_at='', updated_at=datetime('now') WHERE id=?", [id]);
    }
  }
  // table is 'people' or 'instruments' — nothing else is retirable.
  function setRetired(table, id, retired) {
    if (table !== 'people' && table !== 'instruments') return;
    if (retired) {
      run(`UPDATE ${table} SET is_retired=1, retired_at=datetime('now') WHERE id=?`, [id]);
    } else {
      run(`UPDATE ${table} SET is_retired=0, retired_at='' WHERE id=?`, [id]);
    }
  }

  /* ---------------- Sample Data Seeding & Database Reset ---------------- */
  function clearAllData() {
    db.exec(`
      DELETE FROM project_people;
      DELETE FROM project_instruments;
      DELETE FROM milestone_owners;
      DELETE FROM milestone_instruments;
      DELETE FROM milestones;
      DELETE FROM meeting_people;
      DELETE FROM meeting_instruments;
      DELETE FROM meeting_staff;
      DELETE FROM meetings;
      DELETE FROM files;
      DELETE FROM kv;
      DELETE FROM projects;
      DELETE FROM people;
      DELETE FROM instruments;
    `);
    try {
      // Reset AUTOINCREMENT counters so re-seeding starts IDs from 1 again;
      // otherwise seedSampleData's hardcoded cross-references (e.g. milestone.project_id)
      // point at IDs that no longer match once counters have advanced past a prior seed/clear.
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('projects','people','instruments','milestones','meetings','files','kv')");
    } catch (_) { /* sqlite_sequence doesn't exist yet on a brand-new, never-inserted-into database */ }
    markDirty();
  }

  function seedSampleData() {
    clearAllData();

    // 1. People (is_staff/rate: only facility staff are billable core-staff assignees)
    const peopleData = [
      ['Dr. Elena Rostova', 'PI', 'Bio-Photonics Lab', 'Harvard Immunology', 'elena.rostova@harvard.edu', 'Specializes in deep-tissue intravital 2-photon imaging', 0, 0],
      ['Prof. Marcus Thorne', 'PI', 'Neural Dynamics Institute', 'MIT', 'mthorne@mit.edu', 'Synaptic plasticity & optogenetics grant leader', 0, 0],
      ['Dr. Sarah Lin', 'PI', 'Therapeutics & Onco-Therapy', 'Stanford', 'slin@stanford.edu', 'High-throughput 3D organoid drug screening', 0, 0],
      ['Alex Chen', 'Researcher', 'Bio-Photonics Lab', 'Harvard Immunology', 'achen@harvard.edu', 'Postdoc running resonant intravital time-lapses', 0, 0],
      ['Maya Patel', 'Researcher', 'Neural Dynamics Institute', 'MIT', 'mpatel@mit.edu', 'PhD candidate in STED super-resolution assays', 0, 0],
      ['David Kim', 'Facility Staff', 'Bioimaging Core Facility', '', 'dkim@corefacility.edu', 'Senior optical specialist & laser safety officer', 1, 95]
    ];
    for (const p of peopleData) {
      run('INSERT INTO people (name, type, organization, department, email, note, is_staff, rate) VALUES (?,?,?,?,?,?,?,?)', p);
    }

    // 2. Instruments (cost_unit 'time' = price/hour; other units price per amount entered on a booking)
    const instData = [
      ['Leica SP8 FALCON', 'FLIM / Confocal', 'Available', 'Room 118', 'Fluorescence lifetime imaging, White Light Laser 470-670nm + 405nm', 120, 'time'],
      ['Olympus FV3000', 'Multiphoton / Confocal', 'In-use', 'Room 204', 'High-sensitivity spectral GaAsP detectors, heated stage chamber', 150, 'time'],
      ['Zeiss Lightsheet Z.1', 'Lightsheet (Volume)', 'Available', 'Room 210', 'Dual-side illumination for cleared tissue & whole organ 3D imaging', 200, 'time'],
      ['Nikon AX R Resonant', 'Resonant Confocal', 'Available', 'Room 212', '2K x 2K resonant scanning for high-speed calcium dynamics', 100, 'time'],
      ['Glacios Cryo-TEM', 'Cryo-EM', 'Maintenance', 'Room B14', '200kV autoloader - undergoing routine monthly beam alignment', 45, 'unit']
    ];
    for (const i of instData) {
      run('INSERT INTO instruments (name, kind, status, location, note, cost, cost_unit) VALUES (?,?,?,?,?,?,?)', i);
    }

    // 3. Projects
    // Project 1: Active
    run(`INSERT INTO projects (title, code, status, priority, pi_id, modality, funding, sample, flags, tags, start_date, end_date, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      'Intravital Multi-Photon Imaging of CAR-T Cell Infiltration',
      'PRJ-2026-001',
      'Active',
      'High',
      1, // Dr. Elena Rostova
      'Multiphoton',
      'NIH R01-AI154920',
      'Transgenic murine lymph node (in vivo)',
      '',
      'Immunology, Intravital, CAR-T, In-Vivo',
      '2026-01-10',
      '2026-10-31',
      'Real-time tracking of chimeric antigen receptor T-cell kinetics and tumor cell lysis rates across 4D spatial volumes.'
    ]);

    // Project 2: Initiated
    run(`INSERT INTO projects (title, code, status, priority, pi_id, modality, funding, sample, flags, tags, start_date, end_date, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      'Super-Resolution Mapping of Synaptic Density Compounds',
      'PRJ-2026-002',
      'Initiated',
      'Medium',
      2, // Prof. Marcus Thorne
      'Super-Resolution',
      'Brain Research Grant #8410',
      'Primary hippocampal cultures (96-well glass bottom)',
      '',
      'Neuroscience, Synapse, STED, Screening',
      '2026-03-01',
      '2026-11-30',
      'Targeted STED nanoscopy resolving pre- and post-synaptic scaffold protein cluster colocalization under candidate therapeutics.'
    ]);

    // Project 3: Completed
    run(`INSERT INTO projects (title, code, status, priority, pi_id, modality, funding, sample, flags, tags, start_date, end_date, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      'Whole-Organ 3D Lightsheet Mapping of Pancreatic Islets',
      'PRJ-2025-088',
      'Completed',
      'Low',
      3, // Dr. Sarah Lin
      'Lightsheet',
      'State Health Initiative #4401',
      'CUBIC-cleared murine pancreas',
      '',
      'Endocrinology, Cleared Tissue, Volume 3D',
      '2025-08-01',
      '2026-01-20',
      'Full organ clearing, refractive index matching, and complete volumetric islet distribution mapping completed successfully.'
    ]);

    // 4. Project People Mappings
    run('INSERT INTO project_people (project_id, person_id, role) VALUES (1, 1, "Principal Investigator")');
    run('INSERT INTO project_people (project_id, person_id, role) VALUES (1, 4, "Lead Operator & Image Analyst")');
    run('INSERT INTO project_people (project_id, person_id, role) VALUES (1, 6, "Core Optical Specialist")');

    run('INSERT INTO project_people (project_id, person_id, role) VALUES (2, 2, "Principal Investigator")');
    run('INSERT INTO project_people (project_id, person_id, role) VALUES (2, 5, "Lead Researcher")');

    run('INSERT INTO project_people (project_id, person_id, role) VALUES (3, 3, "Principal Investigator")');
    run('INSERT INTO project_people (project_id, person_id, role) VALUES (3, 6, "Core Facility Support")');

    // 5. Project Instruments Mappings
    run('INSERT INTO project_instruments (project_id, instrument_id) VALUES (1, 2)'); // Olympus FV3000
    run('INSERT INTO project_instruments (project_id, instrument_id) VALUES (1, 1)'); // Leica SP8
    run('INSERT INTO project_instruments (project_id, instrument_id) VALUES (2, 1)'); // Leica SP8
    run('INSERT INTO project_instruments (project_id, instrument_id) VALUES (2, 4)'); // Nikon AX R
    run('INSERT INTO project_instruments (project_id, instrument_id) VALUES (3, 3)'); // Zeiss Lightsheet

    // 6. Milestones
    // Project 1 Milestones
    run('INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (1, 1, "Laser Power Calibration & Biosafety Clearance", "2026-02-15", "done", "Optimized pulse power at 920nm to avoid tissue phototoxicity")');
    run('INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (2, 1, "Intravital 4D Time-lapse Acquisition (100h)", "2026-04-25", "in-progress", "72 hours acquired across 6 cohorts; continuous stage tracking active")');
    run('INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (3, 1, "Cell Tracking & Velocity Segmentation", "2026-06-30", "pending", "Surface reconstruction and track displacement analysis in Imaris")');
    run('INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (4, 1, "Final Report & Publication Figure Rendering", "2026-09-15", "pending", "Render 3D movies and generate statistical figures for manuscript")');

    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (1, 4)');
    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (2, 4)');
    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (3, 4)');
    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (3, 6)');
    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (4, 1)');

    run('INSERT INTO milestone_instruments (milestone_id, instrument_id) VALUES (1, 2)');
    run('INSERT INTO milestone_instruments (milestone_id, instrument_id) VALUES (2, 2)');

    // Project 2 Milestones
    run('INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (5, 2, "Antibody Titration & Depletion Laser Alignment", "2026-03-25", "pending", "Optimize STAR635P / Alexa594 pairs on 775nm depletion line")');
    run('INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (6, 2, "High-Content STED Imaging of 120 Wells", "2026-06-10", "pending", "Automated multi-position tile scanning with autofocus")');
    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (5, 5)');
    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (6, 5)');
    run('INSERT INTO milestone_instruments (milestone_id, instrument_id) VALUES (5, 1)');

    // Project 3 Milestones (Done)
    run('INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (7, 3, "Tissue Clearing & Refractive Index Matching", "2025-09-10", "done", "CUBIC protocol yielded optical transparency with RI=1.520")');
    run('INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (8, 3, "Volumetric Lightsheet Stacks (2.4 TB)", "2025-11-20", "done", "Acquired dual-illumination 5µm z-step stacks on Z.1")');
    run('INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (9, 3, "Final 3D Islet Morphometry Report", "2026-01-15", "done", "Delivered complete volume distribution metrics and data archive")');

    // 7. Meetings (start_time/end_time now drive calendar display + instrument/staff conflict
    // checks; discount/subtotal/total_* on meeting 1 are a snapshot BOM — see meeting_instruments
    // / meeting_staff below for the line items that produced it).
    run(`INSERT INTO meetings (project_id, title, date, start_time, end_time, attendees, note, actions, discount_pct, group_org, group_discount_pct, subtotal, total_before_tax, total_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      1,
      'Project Kickoff & Laser Alignment Review',
      '2026-01-12',
      '09:00',
      '11:00',
      'Elena Rostova, Alex Chen, David Kim',
      'Reviewed intravital laser power levels and live-animal heating stage protocol.',
      'Alex to reserve recurring Monday/Thursday blocks on Olympus FV3000; David to verify gas calibration.',
      0,                  // manual discount_pct
      'Bio-Photonics Lab', // group_org: this project's PI (Elena Rostova) belongs to this lab
      5,      // group_discount_pct snapshot (Bio-Photonics Lab standing discount, see group_discounts below)
      490,    // subtotal: Olympus FV3000 300 (2h @ $150/hr) + David Kim 190 (2h @ $95/hr)
      546.25, // total_before_tax: (490 - 5% of the $300 instrument-time line) x 1.15 overhead (10% internal + 5% external)
      589.95  // total_cost: total_before_tax x 1.08 tax
    ]);
    run(`INSERT INTO meetings (project_id, title, date, start_time, end_time, attendees, note, actions) VALUES (?,?,?,?,?,?,?,?)`, [
      1,
      'Interim Progress & Channel Bleaching Check',
      '2026-02-28',
      '13:00',
      '14:30',
      'Alex Chen, David Kim',
      'Observed minor fluorophore quenching in red channel. Switched to resonant line accumulation.',
      'Pulse power dialed down to 7.5%; signal-to-noise preserved without phototoxicity.'
    ]);
    run(`INSERT INTO meetings (project_id, title, date, start_time, end_time, attendees, note, actions) VALUES (?,?,?,?,?,?,?,?)`, [
      2,
      'Screening Protocol Design & STED Parameter Setup',
      '2026-03-05',
      '10:00',
      '11:30',
      'Marcus Thorne, Maya Patel, David Kim',
      'Discussed depletion laser doughnut alignment and immersion oil selection for 96-well glass plates.',
      'Maya to prepare test 24-well plate for PSF and resolution calibration next week.'
    ]);

    // The `attendees` column above is a denormalized display string only — meeting_people is
    // the join table features (e.g. emailing attendees) actually read from, so it needs the
    // same rows the milestone_owners seeding above already provides for milestones.
    run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (1, 1)'); // Elena Rostova
    run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (1, 4)'); // Alex Chen
    run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (1, 6)'); // David Kim
    run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (2, 4)'); // Alex Chen
    run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (2, 6)'); // David Kim
    run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (3, 2)'); // Marcus Thorne
    run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (3, 5)'); // Maya Patel
    run('INSERT INTO meeting_people (meeting_id, person_id) VALUES (3, 6)'); // David Kim

    // meeting_instruments/meeting_staff are the billable line items behind meeting 1's snapshot
    // totals above: Olympus FV3000 (instrument_id 2) billed by time (amount unused), David Kim
    // (person_id 6, the only is_staff=1 person) billed for the full booking window.
    run('INSERT INTO meeting_instruments (meeting_id, instrument_id, amount, line_cost) VALUES (1, 2, 0, 300)');
    run("INSERT INTO meeting_staff (meeting_id, person_id, start_time, end_time, line_cost) VALUES (1, 6, '', '', 190)");

    // Global billing rates (Settings > Billing Rates) and one standing group discount, so the
    // cost breakdown above is reproducible from Settings rather than a one-off hardcoded total.
    // Uses the upsert helpers, not a plain INSERT — clearAllData() deliberately leaves app_config
    // and group_discounts alone (they're facility settings, not "data" to wipe on Clear/Reseed),
    // so re-running Load Sample Data would otherwise hit a UNIQUE constraint on the second run.
    setConfig('overhead_internal', '10');
    setConfig('overhead_external', '5');
    setConfig('tax_pct', '8');
    setConfig('currency', '$');
    setGroupDiscount('Bio-Photonics Lab', 5);

    // 8. Custom KV Metadata
    run('INSERT INTO kv (project_id, key, value) VALUES (1, "Biosafety Level", "BSL-2 (Murine Live In-Vivo)")');
    run('INSERT INTO kv (project_id, key, value) VALUES (1, "Laser Wavelength", "920nm Ti:Sapphire 80MHz")');
    run('INSERT INTO kv (project_id, key, value) VALUES (1, "Storage Tier", "NAS-Bioimaging-Vol4 / 4.8 TB")');
    run('INSERT INTO kv (project_id, key, value) VALUES (1, "Grant Account", "HARV-IMM-R01-2026")');

    run('INSERT INTO kv (project_id, key, value) VALUES (2, "Plate Standard", "96-Well Glass Bottom #1.5H")');
    run('INSERT INTO kv (project_id, key, value) VALUES (2, "Fluorophores", "Bassoon (STAR635P), PSD-95 (Alexa594)")');
    run('INSERT INTO kv (project_id, key, value) VALUES (2, "Depletion Line", "775nm Pulsed STED Laser")');

    run('INSERT INTO kv (project_id, key, value) VALUES (3, "Clearing Method", "CUBIC Reagent-1 & Reagent-2")');
    run('INSERT INTO kv (project_id, key, value) VALUES (3, "Refractive Index", "1.520 RI Matching Oil")');
    run('INSERT INTO kv (project_id, key, value) VALUES (3, "Archive Volume", "2.8 TB Cold Storage")');

    // 9. Files
    run('INSERT INTO files (project_id, name, kind, path) VALUES (1, "CAR-T_Intravital_Protocol_v3.pdf", "link", "https://core-facility.internal/docs/protocols/cart-v3.pdf")');
    run('INSERT INTO files (project_id, name, kind, path) VALUES (1, "Olympus_FV3000_Config_Laser920.json", "link", "https://core-facility.internal/configs/fv3000-cart.json")');
    run('INSERT INTO files (project_id, name, kind, path) VALUES (2, "STED_Resolution_Calibration_Guide.pdf", "link", "https://core-facility.internal/docs/sted-calib.pdf")');
    run('INSERT INTO files (project_id, name, kind, path) VALUES (3, "Pancreatic_Islets_3D_Summary.xlsx", "link", "https://core-facility.internal/reports/islets-2026.xlsx")');

    markDirty();
  }

  global.DB = {
    boot,
    get memoryMode() { return memoryMode; },
    currentBytes,
    markDirty,
    buildBackup,
    restoreBackup,
    saveUpload,
    getUpload,
    saveAutoBackupDirHandle,
    getAutoBackupDirHandle,
    clearAutoBackupDirHandle,
    rows,
    row,
    q,
    q1,
    run,
    projectProgress,
    projectFlags,
    vocabList,
    addVocab,
    getConfig,
    getConfigNum,
    setConfig,
    getGroupDiscount,
    setGroupDiscount,
    listGroupDiscounts,
    countPersonRefs,
    countInstrumentRefs,
    countProjectRefs,
    setProjectArchived,
    setRetired,
    seedSampleData,
    clearAllData
  };

})(window);
