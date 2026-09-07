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
    grant_id INTEGER,
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
  CREATE TABLE IF NOT EXISTS grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    number TEXT DEFAULT '',
    note TEXT DEFAULT '',
    is_retired INTEGER DEFAULT 0,
    retired_at TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS grant_users (
    grant_id INTEGER NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (grant_id, person_id)
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
  CREATE TABLE IF NOT EXISTS instrument_staff (
    instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (instrument_id, person_id)
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
    grant_id INTEGER,
    title TEXT NOT NULL,
    date TEXT,
    start_time TEXT DEFAULT '',
    end_time TEXT DEFAULT '',
    attendees TEXT DEFAULT '',
    link TEXT DEFAULT '',
    category TEXT DEFAULT '',
    note TEXT DEFAULT '',
    actions TEXT DEFAULT '',
    discount_pct REAL DEFAULT 0,
    group_org TEXT DEFAULT '',
    group_discount_pct REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    total_before_tax REAL DEFAULT 0,
    total_cost REAL DEFAULT 0,
    is_cancelled INTEGER DEFAULT 0,
    cancelled_at TEXT DEFAULT '',
    billing_retained INTEGER DEFAULT 0,
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
        CREATE TABLE IF NOT EXISTS instrument_staff (
          instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
          person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          PRIMARY KEY (instrument_id, person_id)
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

    // Cancellation. Runs AFTER the meetings rebuild above on purpose: that rebuild copies an
    // explicit column list into a fresh table, so anything added before it would be dropped.
    try { db.exec("ALTER TABLE meetings ADD COLUMN is_cancelled INTEGER DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE meetings ADD COLUMN cancelled_at TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE meetings ADD COLUMN billing_retained INTEGER DEFAULT 0"); } catch (_) {}
    // Consult-type tag (sync / consult / training / assisted session, extensible via the vocab
    // table like every other dropdown) so Reports can count consults per instrument and period.
    try { db.exec("ALTER TABLE meetings ADD COLUMN category TEXT DEFAULT ''"); } catch (_) {}

    // Grants: a name/number entity, pickable on bookings and projects, with an allowed-users join
    // table — retired (not deleted) via the same is_retired pattern as people/instruments once
    // anything references it (see countGrantRefs). meetings.grant_id/projects.grant_id carry NO
    // REFERENCES clause, matching the projects.pi_id precedent — a nullable "soft" link that any
    // grant delete path (see retireGrant in app.js) must null out explicitly rather than lean on a
    // FK cascade. Runs at the end of migrate() — meetings.grant_id in particular must come after
    // the meetings rebuild above, which copies an explicit (older) column list into a fresh table
    // and would otherwise silently drop a column added before it ran.
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS grants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          number TEXT DEFAULT '',
          note TEXT DEFAULT '',
          is_retired INTEGER DEFAULT 0,
          retired_at TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS grant_users (
          grant_id INTEGER NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
          person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          PRIMARY KEY (grant_id, person_id)
        );
      `);
    } catch (_) {}
    try { db.exec('ALTER TABLE meetings ADD COLUMN grant_id INTEGER'); } catch (_) {}
    try { db.exec('ALTER TABLE projects ADD COLUMN grant_id INTEGER'); } catch (_) {}
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
    // global.UI is defined by the time this runs (called at render time, after all scripts have
    // loaded), even though db.js itself loads before ui.js — see CLAUDE.md module load order.
    const now = global.UI.today();
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
  // Also deliberately excludes instrument_staff for the same reason as countInstrumentRefs below:
  // supervising an instrument is a current assignment, not history. retirePerson's zero-ref
  // delete branch cleans up instrument_staff rows explicitly before deleting the person.
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
  // Deliberately excludes instrument_staff: a supervisor assignment is current-state ("who looks
  // after this instrument today"), not the historical fact this gate protects (a booking/milestone/
  // project that actually used the instrument). retireInstrument's zero-ref delete branch still
  // cleans up instrument_staff rows explicitly before deleting, so a supervised-but-otherwise-
  // unused instrument can still be deleted without leaving an orphaned join row.
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
  /* What a booking carries: billing line items, its saved total, and the people recorded as
     having been there. A booking with none of that is an empty note and can be deleted; anything
     else is cancelled instead, so the session stays on the record. */
  function countBookingRefs(id) {
    const r = row(`SELECT
      (SELECT COUNT(*) FROM meeting_instruments WHERE meeting_id=?) AS instruments,
      (SELECT COUNT(*) FROM meeting_staff WHERE meeting_id=?) AS staff,
      (SELECT COUNT(*) FROM meeting_people WHERE meeting_id=?) AS attendees,
      (SELECT COALESCE(total_cost,0) FROM meetings WHERE id=?) AS total`,
      [id, id, id, id]) || {};
    const parts = {
      instruments: r.instruments || 0, staff: r.staff || 0,
      attendees: r.attendees || 0, total: Number(r.total) || 0
    };
    parts.lines = parts.instruments + parts.staff;
    parts.any = parts.lines + parts.attendees + (parts.total > 0 ? 1 : 0);
    return parts;
  }
  /* How much of the app a grant touches: projects billed against it and bookings billed against
     it (both via a nullable, REFERENCES-less grant_id column — see the migrate() comment for why).
     Zero references means there's nothing to preserve, so retireGrant offers a real delete instead
     of retirement, same rule as countPersonRefs/countInstrumentRefs/countProjectRefs above. */
  function countGrantRefs(id) {
    const r = row(`SELECT
      (SELECT COUNT(*) FROM projects WHERE grant_id=?) AS projects,
      (SELECT COUNT(*) FROM meetings WHERE grant_id=?) AS bookings`, [id, id]) || {};
    const parts = { projects: r.projects || 0, bookings: r.bookings || 0 };
    parts.total = parts.projects + parts.bookings;
    return parts;
  }

  /* The one place that resolves a grant to display text — honors the Settings name/number toggle
     so every caller (app.js pickers, views.js's Project Costs card, exports.js's XLSX/DOCX/PDF
     paths) agrees on what a grant "is called" without forking that logic per file. Accepts either
     a grant id (looked up fresh) or an already-fetched row/object carrying at least {name, number}
     — callers that already joined grants into their own query (to avoid an extra round-trip) pass
     that row straight through. Falls back to whichever of name/number is present if the configured
     one is blank, so a grant entered with only a number still displays as something. Does NOT
     append "(Retired)" — that's UI.retiredName's job, same split as every other entity here. */
  function grantLabel(grantOrId) {
    if (grantOrId == null) return '';
    let g = grantOrId;
    if (typeof g !== 'object') {
      g = row('SELECT id, name, number FROM grants WHERE id=?', [g]);
    }
    if (!g) return '';
    const mode = getConfig('grant_display', 'name');
    return mode === 'number' ? (g.number || g.name || '') : (g.name || g.number || '');
  }

  /* retained: does this cancelled booking's cost still count toward Project Costs? A session
     cancelled after its start time was still time the facility held; one cancelled beforehand
     was not. Either way the booking itself stays logged. */
  function setBookingCancelled(id, cancelled, retained) {
    if (cancelled) {
      run("UPDATE meetings SET is_cancelled=1, cancelled_at=datetime('now'), billing_retained=?, updated_at=datetime('now') WHERE id=?",
        [retained ? 1 : 0, id]);
    } else {
      run("UPDATE meetings SET is_cancelled=0, cancelled_at='', billing_retained=0, updated_at=datetime('now') WHERE id=?", [id]);
    }
  }
  function setProjectArchived(id, archived) {
    if (archived) {
      run("UPDATE projects SET is_archived=1, archived_at=datetime('now'), updated_at=datetime('now') WHERE id=?", [id]);
    } else {
      run("UPDATE projects SET is_archived=0, archived_at='', updated_at=datetime('now') WHERE id=?", [id]);
    }
  }
  // table is 'people', 'instruments' or 'grants' — nothing else is retirable.
  function setRetired(table, id, retired) {
    if (table !== 'people' && table !== 'instruments' && table !== 'grants') return;
    if (retired) {
      run(`UPDATE ${table} SET is_retired=1, retired_at=datetime('now') WHERE id=?`, [id]);
    } else {
      run(`UPDATE ${table} SET is_retired=0, retired_at='' WHERE id=?`, [id]);
    }
  }

  // Every organization name on record anywhere, not just people.organization — a lab can show
  // up only in a discount row or on a booking's saved group_org snapshot (e.g. after a person
  // who belonged to it was reassigned or removed), and the rename tool needs to offer those too.
  function listAllOrgNames() {
    const set = new Set();
    rows("SELECT DISTINCT organization as org FROM people WHERE organization IS NOT NULL AND TRIM(organization) != ''").forEach((r) => set.add(r.org));
    rows("SELECT DISTINCT org FROM group_discounts WHERE org IS NOT NULL AND TRIM(org) != ''").forEach((r) => set.add(r.org));
    rows("SELECT DISTINCT group_org as org FROM meetings WHERE group_org IS NOT NULL AND TRIM(group_org) != ''").forEach((r) => set.add(r.org));
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // How much of the app a lab name touches, for the rename/merge confirm dialog: people rows
  // that would be relabeled, bookings whose saved group snapshot would be relabeled, and whether
  // it carries a standing discount row.
  function countOrgRefs(org) {
    const peopleCount = (row('SELECT COUNT(*) as c FROM people WHERE organization=?', [org]) || {}).c || 0;
    const bookingsCount = (row('SELECT COUNT(*) as c FROM meetings WHERE group_org=?', [org]) || {}).c || 0;
    const hasDiscount = !!row('SELECT 1 as x FROM group_discounts WHERE org=?', [org]);
    return { peopleCount, bookingsCount, hasDiscount };
  }

  // Renames (or merges) a lab/organization name across the app. `people.organization` and every
  // `meetings.group_org` snapshot are relabeled unconditionally — those are just display strings.
  // The group_discounts row is trickier: org is its PRIMARY KEY, so if newName already has its
  // OWN discount row this is a merge, not a plain rename — the existing target row wins (its
  // percent is left alone) and the old row is dropped, rather than raced through an UPDATE that
  // would collide on the primary key.
  // Deliberately does NOT touch meetings.group_discount_pct: that's a historical snapshot of the
  // percent actually billed on that booking, not a live reference to the lab, so it must not be
  // recomputed just because the lab's name (or even its current standing rate) changed later.
  function renameOrganization(oldName, newName) {
    oldName = String(oldName || '').trim();
    newName = String(newName || '').trim();
    if (!oldName || !newName || oldName === newName) return null;

    const peopleCount = (row('SELECT COUNT(*) as c FROM people WHERE organization=?', [oldName]) || {}).c || 0;
    const bookingsCount = (row('SELECT COUNT(*) as c FROM meetings WHERE group_org=?', [oldName]) || {}).c || 0;
    const oldDiscount = row('SELECT percent FROM group_discounts WHERE org=?', [oldName]);
    const targetHadDiscount = !!row('SELECT 1 as x FROM group_discounts WHERE org=?', [newName]);
    const merged = !!(oldDiscount && targetHadDiscount);

    if (peopleCount) run('UPDATE people SET organization=? WHERE organization=?', [newName, oldName]);
    if (bookingsCount) run('UPDATE meetings SET group_org=? WHERE group_org=?', [newName, oldName]);

    let discountMoved = false;
    if (oldDiscount) {
      if (targetHadDiscount) {
        // Merge: the destination's own standing rate wins; drop the source row rather than
        // fight it for the org primary key.
        run('DELETE FROM group_discounts WHERE org=?', [oldName]);
      } else {
        run('UPDATE group_discounts SET org=? WHERE org=?', [newName, oldName]);
        discountMoved = true;
      }
    }

    return { peopleCount, bookingsCount, discountMoved, merged, hadDiscount: !!oldDiscount };
  }

  /* ---------------- Sample Data Seeding & Database Reset ---------------- */
  function clearAllData() {
    db.exec(`
      DELETE FROM project_people;
      DELETE FROM project_instruments;
      DELETE FROM instrument_staff;
      DELETE FROM milestone_owners;
      DELETE FROM milestone_instruments;
      DELETE FROM milestones;
      DELETE FROM meeting_people;
      DELETE FROM meeting_instruments;
      DELETE FROM meeting_staff;
      DELETE FROM meetings;
      DELETE FROM grant_users;
      DELETE FROM grants;
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
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('projects','people','instruments','milestones','meetings','files','kv','grants')");
    } catch (_) { /* sqlite_sequence doesn't exist yet on a brand-new, never-inserted-into database */ }
    markDirty();
  }

  /* Builds one meetings row plus its meeting_people / meeting_instruments / meeting_staff rows
     from the same inputs UI.computeBookingBOM takes in the real booking modal (mirrors
     bookingSave in app.js) — so every seeded subtotal/total is computed, never typed in by hand.
     Looks up each instrument's cost/cost_unit and each staff member's rate from the rows THIS
     seed just inserted (never a literal), so the BOM always tracks whatever peopleData/instData
     above say, even if those tables change later.
       spec.instruments: [{id, amount}]  — amount only matters for a non-'time' cost_unit.
       spec.staff:       [{id, start, end}] — blank start/end bills the whole booking window.
       spec.peopleIds:   everyone who attended (attendees display string AND meeting_people —
                          built from this ONE list so the two can never drift, see CLAUDE.md).
       spec.cancelled:   {retained} or omitted/null for a live booking. */
  function seedBooking(spec) {
    const {
      projectId = null, grantId = null, title, date, start = '', end = '',
      instruments = [], staff = [], peopleIds = [], groupOrg = '',
      note = '', actions = '', cancelled = null, category = ''
    } = spec;

    const instRows = instruments.length
      ? rows(`SELECT id, cost, cost_unit FROM instruments WHERE id IN (${instruments.map(() => '?').join(',')})`, instruments.map((i) => i.id))
      : [];
    const instrumentsForCalc = instRows.map((r) => {
      const s = instruments.find((i) => i.id === r.id) || {};
      return { id: r.id, cost: r.cost, cost_unit: r.cost_unit, amount: s.amount || 0 };
    });

    const staffRows = staff.length
      ? rows(`SELECT id, rate FROM people WHERE id IN (${staff.map(() => '?').join(',')})`, staff.map((s) => s.id))
      : [];
    const staffForCalc = staffRows.map((r) => {
      const s = staff.find((x) => x.id === r.id) || {};
      return { id: r.id, rate: r.rate, start: s.start || '', end: s.end || '' };
    });

    // getGroupDiscount/getConfigNum read the app_config/group_discounts rows the real Settings
    // screen reads — which is exactly why those are seeded BEFORE any seedBooking() call below;
    // reading them from an empty table here would silently compute every booking at 0% discount
    // and 0% overhead/tax.
    const groupPct = getGroupDiscount(groupOrg);
    const rates = {
      ohInternal: getConfigNum('overhead_internal', 0),
      ohExternal: getConfigNum('overhead_external', 0),
      taxPct: getConfigNum('tax_pct', 0)
    };
    const bom = global.UI.computeBookingBOM({ start, end, instruments: instrumentsForCalc, staff: staffForCalc, groupPct, manualPct: 0, rates });

    const attendees = peopleIds.length
      ? rows(`SELECT name FROM people WHERE id IN (${peopleIds.map(() => '?').join(',')})`, peopleIds).map((r) => r.name).join(', ')
      : '';

    const isCancelled = !!(cancelled && cancelled.cancelled !== false);
    run(`INSERT INTO meetings (project_id, grant_id, title, date, start_time, end_time, attendees, note, actions,
          discount_pct, group_org, group_discount_pct, subtotal, total_before_tax, total_cost,
          is_cancelled, cancelled_at, billing_retained, category)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      projectId, grantId, title, date, start, end, attendees, note, actions,
      0, groupOrg, groupPct, bom.subtotal, bom.beforeTax, bom.total,
      isCancelled ? 1 : 0,
      // Full timestamp, not a calendar day — toISOString() is the right tool here (see CLAUDE.md).
      isCancelled ? new Date().toISOString() : '',
      isCancelled && cancelled.retained ? 1 : 0,
      category
    ]);
    const inserted = row('SELECT last_insert_rowid() as id');
    const mid = inserted ? inserted.id : null;
    if (!mid) return null;

    // Same id list feeds both the `attendees` display string above and meeting_people below, so
    // they can never drift the way CLAUDE.md documents an earlier seed drifting on this pair.
    peopleIds.forEach((pid) => run('INSERT OR IGNORE INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [mid, pid]));
    bom.instrumentLines.forEach((l) => run('INSERT INTO meeting_instruments (meeting_id, instrument_id, amount, line_cost) VALUES (?,?,?,?)', [mid, l.id, l.amount || 0, l.line]));
    bom.staffLines.forEach((l) => run('INSERT INTO meeting_staff (meeting_id, person_id, start_time, end_time, line_cost) VALUES (?,?,?,?,?)', [mid, l.id, l.start || '', l.end || '', l.line]));
    return mid;
  }

  function seedSampleData() {
    clearAllData();

    // Demo dates are relative to the day the sample data is loaded, so the dataset never reads as
    // stale history and always lands inside the Reports screen's default range (the current year).
    // Built on the existing UI.todayPlusDays (local-calendar-day math, see CLAUDE.md's "Dates are
    // local calendar days" section) rather than a second date formatter.
    const day = (n) => global.UI.todayPlusDays(n);

    // 1. People (is_staff/rate: only facility staff are billable core-staff assignees)
    const peopleData = [
      ['Dr. Elena Rostova', 'PI', 'Bio-Photonics Lab', 'Harvard Immunology', 'elena.rostova@harvard.edu', 'Specializes in deep-tissue intravital 2-photon imaging', 0, 0],
      ['Prof. Marcus Thorne', 'PI', 'Neural Dynamics Institute', 'MIT', 'mthorne@mit.edu', 'Synaptic plasticity & optogenetics grant leader', 0, 0],
      ['Dr. Sarah Lin', 'PI', 'Therapeutics & Onco-Therapy', 'Stanford', 'slin@stanford.edu', 'High-throughput 3D organoid drug screening', 0, 0],
      ['Alex Chen', 'Researcher', 'Bio-Photonics Lab', 'Harvard Immunology', 'achen@harvard.edu', 'Postdoc running resonant intravital time-lapses', 0, 0],
      ['Maya Patel', 'Researcher', 'Neural Dynamics Institute', 'MIT', 'mpatel@mit.edu', 'PhD candidate in STED super-resolution assays', 0, 0],
      ['David Kim', 'Facility Staff', 'Bioimaging Core Facility', '', 'dkim@corefacility.edu', 'Senior optical specialist & laser safety officer', 1, 95],
      ['Dr. Priya Anand', 'Facility Staff', 'Bioimaging Core Facility', '', 'panand@corefacility.edu', 'Cryo-EM specialist overseeing grid vitrification and Glacios operation', 1, 110],
      ['Tom Alvarez', 'Facility Staff', 'Bioimaging Core Facility', '', 'talvarez@corefacility.edu', 'Image analysis specialist supporting the Imaris/Fiji quantification pipeline', 1, 80]
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

    // 2b. Instrument supervisors (instrument_staff): David Kim (6) covers the four optical
    // scopes (1-4), Priya Anand (7) is the Cryo-EM specialist supervising the Glacios (5), and
    // Tom Alvarez (8) co-supervises the two highest-throughput/analysis-heavy scopes alongside
    // David Kim — a real many-to-many (an instrument can have more than one supervisor).
    const supervisorPairs = [
      [1, 6], [2, 6], [3, 6], [4, 6], // David Kim — Leica SP8, Olympus FV3000, Zeiss Lightsheet, Nikon AX R
      [5, 7],                         // Priya Anand — Glacios Cryo-TEM
      [2, 8], [4, 8]                  // Tom Alvarez — Olympus FV3000 & Nikon AX R (analysis-heavy pipelines)
    ];
    for (const [instrumentId, personId] of supervisorPairs) {
      run('INSERT OR IGNORE INTO instrument_staff (instrument_id, person_id) VALUES (?,?)', [instrumentId, personId]);
    }

    // 2c. Grants — name/number pairs matching each seed project's own `funding` text (the free-text
    // field on the project itself), plus an allowed-users list (grant_users) so the grant picker's
    // token picker has something real to show. Populating BOTH the grant_id references below AND
    // grant_users here is the same denormalized/join-table drift class CLAUDE.md warns about for
    // meetings.attendees — a grant with no grant_users would look assigned everywhere but pick
    // nobody in its own edit modal.
    const grantsData = [
      ['CAR-T Immunology R01', 'NIH R01-AI154920', 'Elena Rostova lab — intravital CAR-T imaging'],
      ['Synaptic Density Brain Grant', 'Brain Research Grant #8410', 'Marcus Thorne lab — STED synaptic screening'],
      ['Islet Imaging State Grant', 'State Health Initiative #4401', 'Sarah Lin lab — lightsheet islet mapping']
    ];
    for (const g of grantsData) {
      run('INSERT INTO grants (name, number, note) VALUES (?,?,?)', g);
    }
    const grantUserPairs = [
      [1, 1], [1, 4], // CAR-T R01 — Elena Rostova, Alex Chen
      [2, 2], [2, 5], // Brain Research Grant — Marcus Thorne, Maya Patel
      [3, 3]          // Islet Imaging State Grant — Sarah Lin
    ];
    for (const [grantId, personId] of grantUserPairs) {
      run('INSERT OR IGNORE INTO grant_users (grant_id, person_id) VALUES (?,?)', [grantId, personId]);
    }

    // 3. Projects
    // Project 1: Active
    run(`INSERT INTO projects (title, code, status, priority, pi_id, grant_id, modality, funding, sample, flags, tags, start_date, end_date, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      'Intravital Multi-Photon Imaging of CAR-T Cell Infiltration',
      'PRJ-2026-001',
      'Active',
      'High',
      1, // Dr. Elena Rostova
      1, // CAR-T Immunology R01 (NIH R01-AI154920)
      'Multiphoton',
      'NIH R01-AI154920',
      'Transgenic murine lymph node (in vivo)',
      '',
      'Immunology, Intravital, CAR-T, In-Vivo',
      day(-150),
      day(180),
      'Real-time tracking of chimeric antigen receptor T-cell kinetics and tumor cell lysis rates across 4D spatial volumes.'
    ]);

    // Project 2: Initiated
    run(`INSERT INTO projects (title, code, status, priority, pi_id, grant_id, modality, funding, sample, flags, tags, start_date, end_date, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      'Super-Resolution Mapping of Synaptic Density Compounds',
      'PRJ-2026-002',
      'Initiated',
      'Medium',
      2, // Prof. Marcus Thorne
      2, // Synaptic Density Brain Grant (Brain Research Grant #8410)
      'Super-Resolution',
      'Brain Research Grant #8410',
      'Primary hippocampal cultures (96-well glass bottom)',
      '',
      'Neuroscience, Synapse, STED, Screening',
      day(-15),
      day(270),
      'Targeted STED nanoscopy resolving pre- and post-synaptic scaffold protein cluster colocalization under candidate therapeutics.'
    ]);

    // Project 3: Completed
    run(`INSERT INTO projects (title, code, status, priority, pi_id, grant_id, modality, funding, sample, flags, tags, start_date, end_date, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      'Whole-Organ 3D Lightsheet Mapping of Pancreatic Islets',
      'PRJ-2025-088',
      'Completed',
      'Low',
      3, // Dr. Sarah Lin
      3, // Islet Imaging State Grant (State Health Initiative #4401)
      'Lightsheet',
      'State Health Initiative #4401',
      'CUBIC-cleared murine pancreas',
      '',
      'Endocrinology, Cleared Tissue, Volume 3D',
      day(-380),
      day(-70),
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

    // 6. Milestones (due dates are day()-relative; see the narrative note at the top of each
    // project's block for why a given milestone's status/date pairing was chosen)
    // Project 1 Milestones: mid-flight — one done, one actively worked (not yet due), one
    // pending-but-overdue on purpose (feeds the dashboard's overdue list), one pending ahead.
    run(`INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (1, 1, "Laser Power Calibration & Biosafety Clearance", '${day(-120)}', "done", "Optimized pulse power at 920nm to avoid tissue phototoxicity")`);
    run(`INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (2, 1, "Intravital 4D Time-lapse Acquisition (100h)", '${day(15)}', "in-progress", "72 hours acquired across 6 cohorts; continuous stage tracking active")`);
    run(`INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (3, 1, "Cell Tracking & Velocity Segmentation", '${day(-5)}', "pending", "Surface reconstruction and track displacement analysis in Imaris; slipped behind schedule while acquisition ran long")`);
    run(`INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (4, 1, "Final Report & Publication Figure Rendering", '${day(90)}', "pending", "Render 3D movies and generate statistical figures for manuscript")`);

    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (1, 4)');
    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (2, 4)');
    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (3, 4)');
    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (3, 6)');
    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (4, 1)');

    run('INSERT INTO milestone_instruments (milestone_id, instrument_id) VALUES (1, 2)');
    run('INSERT INTO milestone_instruments (milestone_id, instrument_id) VALUES (2, 2)');

    // Project 2 Milestones: project just initiated, so both milestones are still ahead of us.
    run(`INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (5, 2, "Antibody Titration & Depletion Laser Alignment", '${day(45)}', "pending", "Optimize STAR635P / Alexa594 pairs on 775nm depletion line")`);
    run(`INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (6, 2, "High-Content STED Imaging of 120 Wells", '${day(120)}', "pending", "Automated multi-position tile scanning with autofocus")`);
    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (5, 5)');
    run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (6, 5)');
    run('INSERT INTO milestone_instruments (milestone_id, instrument_id) VALUES (5, 1)');

    // Project 3 Milestones (Done) — project completed, so every milestone lands in the past.
    run(`INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (7, 3, "Tissue Clearing & Refractive Index Matching", '${day(-360)}', "done", "CUBIC protocol yielded optical transparency with RI=1.520")`);
    run(`INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (8, 3, "Volumetric Lightsheet Stacks (2.4 TB)", '${day(-260)}', "done", "Acquired dual-illumination 5µm z-step stacks on Z.1")`);
    run(`INSERT INTO milestones (id, project_id, name, due_date, status, note) VALUES (9, 3, "Final 3D Islet Morphometry Report", '${day(-90)}', "done", "Delivered complete volume distribution metrics and data archive")`);

    // 7. Global billing rates (Settings > Billing Rates) and one standing group discount. These
    // MUST be written before any seedBooking() call below — seedBooking reads them (via
    // getGroupDiscount/getConfigNum) to compute each booking's BOM, so writing them after the
    // bookings would silently price every booking at 0% discount and 0% overhead/tax.
    // Uses the upsert helpers, not a plain INSERT — clearAllData() deliberately leaves app_config
    // and group_discounts alone (they're facility settings, not "data" to wipe on Clear/Reseed),
    // so re-running Load Sample Data would otherwise hit a UNIQUE constraint on the second run.
    setConfig('overhead_internal', '10');
    setConfig('overhead_external', '5');
    setConfig('tax_pct', '8');
    setConfig('currency', '$');
    setGroupDiscount('Bio-Photonics Lab', 5); // only lab with a standing discount, on purpose —
    // Neural Dynamics Institute and Therapeutics & Onco-Therapy deliberately have none, so
    // Reports' By Lab/Group table shows a real contrast, not three identical discounted rows.

    // 8. Meetings (start_time/end_time drive calendar display + instrument/staff conflict checks;
    // every booking below goes through seedBooking(), which calls the exact same
    // UI.computeBookingBOM() the booking modal uses — see the helper above seedSampleData for how
    // subtotal/total_before_tax/total_cost are derived). Ten bookings, chosen to exercise every
    // corner of the Reports & Utilization screen (see task notes): all five instruments, all
    // three Facility Staff, a multi-instrument session, a per-unit (non-time) instrument charge,
    // a facility-wide (no project) booking, both cancellation rules, project 3, both no-discount
    // labs, a partial staff window, and a couple of no-line-item consultations. Dates/times are
    // chosen so no instrument or staff member ever overlaps itself on the same day (checked by
    // hand against findBookingConflicts' rule in app.js).

    // #1 — kept as the regression check: same inputs as before (2h on the Olympus FV3000 @
    // $150/hr, David Kim @ $95/hr for the full window, Bio-Photonics Lab's 5% discount, 10%+5%
    // overhead, 8% tax) still has to land on 490 / 546.25 / 589.95.
    seedBooking({
      projectId: 1,
      grantId: 1, // CAR-T Immunology R01 — matches project 1's own grant
      title: 'Project Kickoff & Laser Alignment Review',
      date: day(-95), start: '09:00', end: '11:00',
      instruments: [{ id: 2 }],
      staff: [{ id: 6 }],
      peopleIds: [1, 4, 6], // Elena Rostova, Alex Chen, David Kim
      groupOrg: 'Bio-Photonics Lab',
      note: 'Reviewed intravital laser power levels and live-animal heating stage protocol.',
      actions: 'Alex to reserve recurring Monday/Thursday blocks on Olympus FV3000; David to verify gas calibration.',
      category: 'sync'
    });

    // #2/#3 — realistic no-line-item consultations: plenty of bookings are just a conversation,
    // not a billable session.
    seedBooking({
      projectId: 1,
      title: 'Interim Progress & Channel Bleaching Check',
      date: day(-80), start: '13:00', end: '14:30',
      peopleIds: [4, 6], // Alex Chen, David Kim
      note: 'Observed minor fluorophore quenching in red channel. Switched to resonant line accumulation.',
      actions: 'Pulse power dialed down to 7.5%; signal-to-noise preserved without phototoxicity.',
      category: 'consult'
    });
    seedBooking({
      projectId: 2,
      title: 'Screening Protocol Design & STED Parameter Setup',
      date: day(-70), start: '10:00', end: '11:30',
      peopleIds: [2, 5, 6], // Marcus Thorne, Maya Patel, David Kim
      note: 'Discussed depletion laser doughnut alignment and immersion oil selection for 96-well glass plates.',
      actions: 'Maya to prepare test 24-well plate for PSF and resolution calibration next week.',
      category: 'consult'
    });

    // #4 — multi-instrument (parallel sample runs): the only booking exercising Reports' even
    // split of one staff member's hours across more than one instrument.
    seedBooking({
      projectId: 2,
      grantId: 2, // Synaptic Density Brain Grant — matches project 2's own grant
      title: 'Parallel Confocal Reference Imaging: STED vs. Standard Resolution Benchmarking',
      date: day(-45), start: '09:00', end: '13:00',
      instruments: [{ id: 1 }, { id: 4 }], // Leica SP8 FALCON + Nikon AX R Resonant, side by side
      staff: [{ id: 6 }],
      peopleIds: [2, 5, 6], // Marcus Thorne, Maya Patel, David Kim
      groupOrg: 'Neural Dynamics Institute', // no standing discount — see setGroupDiscount above
      note: 'Ran matched fields on the Leica SP8 FALCON and Nikon AX R Resonant in parallel to benchmark STED resolution gains against confocal and resonant-scan baselines on the same synaptic marker set.',
      actions: 'Maya to tabulate FWHM measurements across both systems for the STED validation section of the grant renewal.',
      category: 'assisted session'
    });

    // #5 — per-unit (non-'time') instrument charge: Glacios Cryo-TEM bills per grid, not per
    // hour, and that per-unit cost is excluded from the discount base (see computeBookingBOM).
    seedBooking({
      projectId: 3,
      grantId: 3, // Islet Imaging State Grant — matches project 3's own grant
      title: 'Cryo-EM Grid Screening for Islet Ultrastructure Micrographs',
      date: day(-100), start: '09:00', end: '12:00',
      instruments: [{ id: 5, amount: 8 }], // Glacios Cryo-TEM, $45/grid x 8 grids screened
      staff: [{ id: 7 }], // Dr. Priya Anand, EM specialist
      peopleIds: [3, 7], // Sarah Lin, Priya Anand
      groupOrg: 'Therapeutics & Onco-Therapy', // no standing discount
      note: 'Screened 8 vitrified grids from the CUBIC-cleared islet prep for ice thickness and particle distribution ahead of high-resolution acquisition.',
      actions: 'Proceed to full data collection on the 3 grids with the most uniform ice; discard grids 4 and 6 for crystalline contamination.',
      category: 'assisted session'
    });

    // #6 — facility-wide (project_id NULL) booking, and also the partial-staff-window example:
    // Tom Alvarez is only billed 10:00-10:40 of the 09:00-13:00 window, so his 0.67 raw hours
    // round up to the 1-hour floor instead of matching the booking's own 4 hours.
    seedBooking({
      projectId: null,
      title: 'Open Office Hours: Image Analysis Pipeline Consultation',
      date: day(-1), start: '09:00', end: '13:00',
      staff: [{ id: 8, start: '10:00', end: '10:40' }], // Tom Alvarez, image analysis specialist
      peopleIds: [4, 5, 8], // Alex Chen, Maya Patel, Tom Alvarez
      note: 'General walk-in session covering Imaris surface reconstruction and STED deconvolution workflows for whichever project needed help that week.',
      actions: 'Circulate the shared Imaris batch-processing macro to both labs.',
      category: 'assisted session'
    });

    // #7 — cancelled BEFORE its start time: nothing was held, so the charge is dropped
    // (retained: false). Dated in the FUTURE relative to today so bookingHasStarted() agrees.
    seedBooking({
      projectId: 2,
      title: 'Extended Resonant-Scan Session for Synaptic Density Screening',
      date: day(10), start: '09:00', end: '10:00',
      instruments: [{ id: 4 }], // Nikon AX R Resonant
      staff: [{ id: 6 }],
      peopleIds: [5, 6], // Maya Patel, David Kim
      groupOrg: 'Neural Dynamics Institute',
      note: 'Requested to add a second resonant-confocal acquisition block for a backup screening plate batch.',
      actions: '',
      cancelled: { cancelled: true, retained: false }, // plate batch delayed in fixation; cancelled while the slot was still ahead of us
      category: 'assisted session'
    });

    // #8 — cancelled AFTER its start time: the slot was held, so the charge stands
    // (retained: true). Dated in the PAST relative to today so bookingHasStarted() agrees.
    seedBooking({
      projectId: 2,
      title: 'Depletion Laser Realignment & Immersion Oil Retest',
      date: day(-8), start: '09:00', end: '10:30',
      instruments: [{ id: 1 }], // Leica SP8 FALCON
      staff: [{ id: 6 }],
      peopleIds: [5, 6], // Maya Patel, David Kim
      groupOrg: 'Neural Dynamics Institute',
      note: 'Booked to redo the 775nm depletion doughnut alignment after an immersion oil swap introduced spherical aberration.',
      actions: '',
      cancelled: { cancelled: true, retained: true }, // failed a safety interlock check after the session had already started; facility held the slot so the charge stands
      category: 'assisted session'
    });

    // #9 — completes instrument coverage (Zeiss Lightsheet Z.1) and gives project 3 a second,
    // billable booking.
    seedBooking({
      projectId: 3,
      title: 'Volumetric Reacquisition & Islet Segmentation QC',
      date: day(-30), start: '09:00', end: '12:00',
      instruments: [{ id: 3 }], // Zeiss Lightsheet Z.1
      staff: [{ id: 8 }], // Tom Alvarez
      peopleIds: [3, 6, 8], // Sarah Lin, David Kim, Tom Alvarez
      groupOrg: 'Therapeutics & Onco-Therapy',
      note: 'Re-ran two z-stacks that showed stitching artifacts and handed the corrected volumes to segmentation QC.',
      actions: 'Tom to re-run the islet counting macro on the corrected volumes before the final report is regenerated.',
      category: 'assisted session'
    });

    // #10 — instrument-only booking (no staff line item): plenty of sessions are unstaffed
    // once a researcher is trained on a scope.
    seedBooking({
      projectId: 1,
      title: 'Extended CAR-T Time-Lapse Re-acquisition (Automated Multipoint)',
      date: day(-3), start: '09:00', end: '11:00',
      instruments: [{ id: 2 }], // Olympus FV3000
      peopleIds: [4], // Alex Chen
      groupOrg: 'Bio-Photonics Lab',
      note: 'Re-ran the multipoint time-lapse unattended overnight after last week’s run was cut short by a stage collision.',
      actions: '',
      category: 'assisted session'
    });

    // 9. Custom KV Metadata
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

    // 10. Files
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
    countGrantRefs,
    grantLabel,
    setProjectArchived,
    countBookingRefs,
    setBookingCancelled,
    setRetired,
    listAllOrgNames,
    countOrgRefs,
    renameOrganization,
    seedSampleData,
    clearAllData
  };

})(window);
