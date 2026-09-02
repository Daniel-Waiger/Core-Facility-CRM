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
    status TEXT NOT NULL DEFAULT 'Draft',
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
    container_uid TEXT DEFAULT '',
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS instruments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT DEFAULT '',
    status TEXT DEFAULT 'Available',
    location TEXT DEFAULT '',
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
    uid TEXT DEFAULT '',
    origin_side TEXT DEFAULT '',
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
    attendees TEXT DEFAULT '',
    link TEXT DEFAULT '',
    note TEXT DEFAULT '',
    actions TEXT DEFAULT '',
    uid TEXT DEFAULT '',
    origin_side TEXT DEFAULT '',
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
    PRIMARY KEY (meeting_id, instrument_id)
  );
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT DEFAULT 'upload',
    path TEXT DEFAULT '',
    uid TEXT DEFAULT '',
    origin_side TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    uid TEXT DEFAULT '',
    from_status TEXT DEFAULT '',
    to_status TEXT NOT NULL,
    actor TEXT DEFAULT '',
    side TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS project_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    uid TEXT DEFAULT '',
    author TEXT DEFAULT '',
    side TEXT DEFAULT 'lab',
    body TEXT NOT NULL,
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
  CREATE INDEX IF NOT EXISTS ix_milestones_project ON milestones(project_id);
  CREATE INDEX IF NOT EXISTS ix_meetings_project ON meetings(project_id);
  CREATE INDEX IF NOT EXISTS ix_files_project ON files(project_id);
  CREATE INDEX IF NOT EXISTS ix_kv_project ON kv(project_id);
  CREATE INDEX IF NOT EXISTS ix_status_history_project ON status_history(project_id);
  CREATE INDEX IF NOT EXISTS ix_project_comments_project ON project_comments(project_id);
  CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_container_uid ON projects(container_uid) WHERE container_uid <> '';
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
          PRIMARY KEY (meeting_id, instrument_id)
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
            attendees TEXT DEFAULT '',
            link TEXT DEFAULT '',
            note TEXT DEFAULT '',
            actions TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO meetings_new (id, project_id, title, date, attendees, link, note, actions, created_at, updated_at)
            SELECT id, project_id, title, date, attendees, link, note, actions, created_at, updated_at FROM meetings;
          DROP TABLE meetings;
          ALTER TABLE meetings_new RENAME TO meetings;
          CREATE INDEX IF NOT EXISTS ix_meetings_project ON meetings(project_id);
          PRAGMA foreign_keys = ON;
        `);
      }
    } catch (e) { console.warn('meetings.project_id migration skipped:', e); }

    /* ---- v1.3.0: Lab <-> Facility workflow (statuses, container export/import, uids) ---- */
    try { db.exec("ALTER TABLE projects ADD COLUMN container_uid TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE milestones ADD COLUMN uid TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE milestones ADD COLUMN origin_side TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE meetings ADD COLUMN uid TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE meetings ADD COLUMN origin_side TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE files ADD COLUMN uid TEXT DEFAULT ''"); } catch (_) {}
    try { db.exec("ALTER TABLE files ADD COLUMN origin_side TEXT DEFAULT ''"); } catch (_) {}
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS status_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          uid TEXT DEFAULT '',
          from_status TEXT DEFAULT '',
          to_status TEXT NOT NULL,
          actor TEXT DEFAULT '',
          side TEXT DEFAULT '',
          note TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS project_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          uid TEXT DEFAULT '',
          author TEXT DEFAULT '',
          side TEXT DEFAULT 'lab',
          body TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS ix_status_history_project ON status_history(project_id);
        CREATE INDEX IF NOT EXISTS ix_project_comments_project ON project_comments(project_id);
      `);
    } catch (_) {}
    try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_container_uid ON projects(container_uid) WHERE container_uid <> ''"); } catch (_) {}

    // 'Initiated' (pre-1.3.0 initial status) becomes 'Draft' — the new workflow's starting point.
    try { db.exec("UPDATE projects SET status='Draft' WHERE status='Initiated'"); } catch (_) {}

    // Backfill container_uid on every project that doesn't have one yet, so every project can
    // be exported as a container without needing a save first.
    try {
      const mySide = (function () {
        try { return global.UI && global.UI.storage.getItem('crm-side') || ''; } catch (_) { return ''; }
      })();
      const missing = rows("SELECT id FROM projects WHERE container_uid IS NULL OR container_uid=''");
      for (const r of missing) {
        run('UPDATE projects SET container_uid=? WHERE id=?', [newUid(), r.id]);
      }
      for (const table of ['milestones', 'meetings', 'files']) {
        const need = rows(`SELECT id FROM ${table} WHERE uid IS NULL OR uid=''`);
        for (const r of need) run(`UPDATE ${table} SET uid=? WHERE id=?`, [newUid(), r.id]);
        // Pre-1.3 rows are treated as owned by whichever side this install currently is (or
        // left blank pre-mode, which import treats as "protected/local" — see importProjectContainer).
        run(`UPDATE ${table} SET origin_side=? WHERE origin_side IS NULL OR origin_side=''`, [mySide]);
      }

      // Synthetic first history row for any project that has none yet, so the history card
      // is never empty for pre-1.3 data and the upgrade is visible in the log.
      const noHistory = rows(`SELECT id, status FROM projects WHERE id NOT IN (SELECT DISTINCT project_id FROM status_history)`);
      for (const p of noHistory) {
        run('INSERT INTO status_history (project_id, uid, from_status, to_status, actor, side, note) VALUES (?,?,?,?,?,?,?)',
          [p.id, newUid(), '', p.status, '', '', 'Recorded at upgrade']);
      }
    } catch (e) { console.warn('v1.3.0 backfill skipped:', e); }
  }

  /* ---------------- Identity ---------------- */
  function newUid() {
    try {
      if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    } catch (_) {}
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
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

  /* ---------------- Status: the single writer for projects.status + status_history ---------------- */
  function setStatus(projectId, to, opts = {}) {
    const { actor = '', side = '', note = '' } = opts;
    const cur = row('SELECT status FROM projects WHERE id=?', [projectId]);
    const from = cur ? cur.status : '';
    run("UPDATE projects SET status=?, updated_at=datetime('now') WHERE id=?", [to, projectId]);
    run('INSERT INTO status_history (project_id, uid, from_status, to_status, actor, side, note) VALUES (?,?,?,?,?,?,?)',
      [projectId, newUid(), from, to, actor, side, note]);
    return { from, to };
  }

  function currentIdentity() {
    try {
      return {
        name: (global.UI && global.UI.storage.getItem('crm-actor-name')) || '',
        side: (global.UI && global.UI.storage.getItem('crm-side')) || '',
        org: (global.UI && global.UI.storage.getItem('crm-org-name')) || ''
      };
    } catch (_) { return { name: '', side: '', org: '' }; }
  }

  /* ---------------- Project container: single-project export/import ----------------
     Self-contained JSON snapshot of one project designed to travel between two independent
     installs (a lab's and a facility's) — see CLAUDE.md / ROADMAP.md for the full rationale.
     People/instruments are embedded and referenced by array INDEX (not local row id, which is
     meaningless on the other install) so identity resolution happens entirely at import time. */
  async function buildProjectContainer(projectId, opts = {}) {
    const includeUploads = opts.includeUploads !== false;
    let p = row('SELECT * FROM projects WHERE id=?', [projectId]);
    if (!p) throw new Error('Project not found');
    if (!p.container_uid) {
      run('UPDATE projects SET container_uid=? WHERE id=?', [newUid(), projectId]);
      p = row('SELECT * FROM projects WHERE id=?', [projectId]);
    }

    const msRows = rows('SELECT * FROM milestones WHERE project_id=? ORDER BY id', [projectId]);
    const mtRows = rows('SELECT * FROM meetings WHERE project_id=? ORDER BY id', [projectId]);
    const fileRows = rows('SELECT * FROM files WHERE project_id=? ORDER BY id', [projectId]);
    const kvRows = rows('SELECT key, value FROM kv WHERE project_id=? ORDER BY id', [projectId]);
    const teamRows = rows('SELECT person_id, role FROM project_people WHERE project_id=?', [projectId]);
    const commentRows = rows('SELECT * FROM project_comments WHERE project_id=? ORDER BY id', [projectId]);
    const historyRows = rows('SELECT * FROM status_history WHERE project_id=? ORDER BY id', [projectId]);
    const projInst = rows('SELECT instrument_id FROM project_instruments WHERE project_id=?', [projectId]).map((r) => r.instrument_id);

    const msOwners = {}, msInst = {};
    for (const m of msRows) {
      msOwners[m.id] = rows('SELECT person_id FROM milestone_owners WHERE milestone_id=?', [m.id]).map((r) => r.person_id);
      msInst[m.id] = rows('SELECT instrument_id FROM milestone_instruments WHERE milestone_id=?', [m.id]).map((r) => r.instrument_id);
    }
    const mtPeople = {}, mtInst = {};
    for (const m of mtRows) {
      mtPeople[m.id] = rows('SELECT person_id FROM meeting_people WHERE meeting_id=?', [m.id]).map((r) => r.person_id);
      mtInst[m.id] = rows('SELECT instrument_id FROM meeting_instruments WHERE meeting_id=?', [m.id]).map((r) => r.instrument_id);
    }

    // People: union of team + PI + milestone owners + meeting attendees, indexed by array position.
    const personIds = new Set();
    teamRows.forEach((r) => personIds.add(r.person_id));
    if (p.pi_id) personIds.add(p.pi_id);
    Object.values(msOwners).forEach((arr) => arr.forEach((id) => personIds.add(id)));
    Object.values(mtPeople).forEach((arr) => arr.forEach((id) => personIds.add(id)));
    const personIdList = [...personIds];
    const personIndex = new Map(personIdList.map((id, i) => [id, i]));
    const teamRoleByPerson = new Map(teamRows.map((r) => [r.person_id, r.role]));
    const people = personIdList.map((id) => {
      const person = row('SELECT * FROM people WHERE id=?', [id]) || {};
      return {
        name: person.name || '', type: person.type || '', organization: person.organization || '',
        department: person.department || '', email: person.email || '', note: person.note || '',
        project_role: teamRoleByPerson.get(id) || ''
      };
    });

    // Instruments: union of project + milestone + meeting instruments, indexed by array position.
    const instIds = new Set(projInst);
    Object.values(msInst).forEach((arr) => arr.forEach((id) => instIds.add(id)));
    Object.values(mtInst).forEach((arr) => arr.forEach((id) => instIds.add(id)));
    const instIdList = [...instIds];
    const instIndex = new Map(instIdList.map((id, i) => [id, i]));
    const instruments = instIdList.map((id) => {
      const inst = row('SELECT * FROM instruments WHERE id=?', [id]) || {};
      return { name: inst.name || '', kind: inst.kind || '', status: inst.status || '', location: inst.location || '', note: inst.note || '' };
    });

    const milestones = msRows.map((m) => ({
      uid: m.uid || newUid(), origin_side: m.origin_side || '', name: m.name, due_date: m.due_date,
      status: m.status, note: m.note,
      owners: (msOwners[m.id] || []).map((id) => personIndex.get(id)).filter((i) => i != null),
      instruments: (msInst[m.id] || []).map((id) => instIndex.get(id)).filter((i) => i != null),
      created_at: m.created_at, updated_at: m.updated_at
    }));
    const meetings = mtRows.map((m) => ({
      uid: m.uid || newUid(), origin_side: m.origin_side || '', title: m.title, date: m.date, link: m.link,
      note: m.note, actions: m.actions,
      people: (mtPeople[m.id] || []).map((id) => personIndex.get(id)).filter((i) => i != null),
      instruments: (mtInst[m.id] || []).map((id) => instIndex.get(id)).filter((i) => i != null),
      created_at: m.created_at, updated_at: m.updated_at
    }));

    const files = [];
    for (const f of fileRows) {
      const entry = { uid: f.uid || newUid(), origin_side: f.origin_side || '', name: f.name, kind: f.kind, path: f.path, created_at: f.created_at };
      if (includeUploads && f.kind === 'upload') {
        try {
          const blob = await getUpload(f.path);
          if (blob) entry.data = await blobToBase64(blob);
        } catch (_) { /* skip content, metadata row still travels */ }
      }
      files.push(entry);
    }

    const comments = commentRows.map((c) => ({ uid: c.uid || newUid(), author: c.author, side: c.side, body: c.body, created_at: c.created_at }));
    const status_history = historyRows.map((h) => ({ uid: h.uid || newUid(), from_status: h.from_status, to_status: h.to_status, actor: h.actor, side: h.side, note: h.note, created_at: h.created_at }));

    return {
      kind: global.CONST.CONTAINER_KIND,
      container_version: global.CONST.CONTAINER_VERSION,
      exported_at: new Date().toISOString(),
      exported_by: currentIdentity(),
      project: {
        title: p.title, code: p.code, status: p.status, priority: p.priority, funding: p.funding,
        modality: p.modality, sample: p.sample, flags: p.flags, tags: p.tags,
        pi: p.pi_id != null && personIndex.has(p.pi_id) ? personIndex.get(p.pi_id) : null,
        start_date: p.start_date, end_date: p.end_date, notes: p.notes,
        container_uid: p.container_uid, created_at: p.created_at, updated_at: p.updated_at
      },
      people, instruments, milestones, meetings, kv: kvRows, files, comments, status_history
    };
  }

  // Ownership-protected merge: only rows this container's exporting side owns (origin_side ===
  // its side, or whose uid it carries — i.e. an update) are replaced; rows owned by the
  // receiving side are never touched. Comments/status_history are unioned by uid and never
  // deleted, in either direction — see CLAUDE.md / ROADMAP.md for the rationale.
  async function importProjectContainer(data) {
    if (!data || data.kind !== global.CONST.CONTAINER_KIND) throw new Error('Not a valid project container file.');
    if ((data.container_version || 1) > global.CONST.CONTAINER_VERSION) {
      throw new Error('This container was exported by a newer version of the app — please update the app before importing it.');
    }
    const side = (data.exported_by && data.exported_by.side) || '';
    const summary = {
      created: false, projectId: null, codeCollision: false,
      people: { matched: 0, created: 0 }, instruments: { matched: 0, created: 0 },
      milestones: { added: 0 }, meetings: { added: 0 }, files: { added: 0 },
      comments: { added: 0 }, history: { added: 0 }
    };

    // ---- People: match by email, then unique name (prefer same org on ties); else create ----
    const personLocalId = [];
    (data.people || []).forEach((pp) => {
      let local = null;
      const email = (pp.email || '').trim().toLowerCase();
      if (email) local = row('SELECT * FROM people WHERE lower(email)=?', [email]);
      if (!local && pp.name) {
        const nameMatches = rows('SELECT * FROM people WHERE lower(trim(name))=?', [String(pp.name).trim().toLowerCase()]);
        if (nameMatches.length === 1) local = nameMatches[0];
        else if (nameMatches.length > 1) {
          local = (pp.organization && nameMatches.find((m) => (m.organization || '').toLowerCase() === pp.organization.toLowerCase())) || nameMatches[0];
        }
      }
      if (local) {
        summary.people.matched++;
        const updates = {};
        if (!local.email && email) updates.email = pp.email;
        if (!local.organization && pp.organization) updates.organization = pp.organization;
        if (!local.department && pp.department) updates.department = pp.department;
        const keys = Object.keys(updates);
        if (keys.length) run(`UPDATE people SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`, [...keys.map((k) => updates[k]), local.id]);
        personLocalId.push(local.id);
      } else {
        summary.people.created++;
        run('INSERT INTO people (name, type, organization, department, email, note) VALUES (?,?,?,?,?,?)',
          [pp.name || '', pp.type || 'Other', pp.organization || '', pp.department || '', pp.email || '', pp.note || '']);
        personLocalId.push(row('SELECT last_insert_rowid() as id').id);
      }
    });

    // ---- Instruments: match by name; create if missing; never update existing ----
    const instLocalId = [];
    (data.instruments || []).forEach((ii) => {
      const local = row('SELECT * FROM instruments WHERE lower(name)=?', [String(ii.name || '').trim().toLowerCase()]);
      if (local) { summary.instruments.matched++; instLocalId.push(local.id); }
      else {
        summary.instruments.created++;
        run('INSERT INTO instruments (name, kind, status, location, note) VALUES (?,?,?,?,?)',
          [ii.name || '', ii.kind || '', ii.status || 'Available', ii.location || '', ii.note || '']);
        instLocalId.push(row('SELECT last_insert_rowid() as id').id);
      }
    });

    // ---- Project: upsert by container_uid ----
    const proj = data.project || {};
    const existing = proj.container_uid ? row('SELECT * FROM projects WHERE container_uid=?', [proj.container_uid]) : null;
    const piLocal = (proj.pi != null && personLocalId[proj.pi] != null) ? personLocalId[proj.pi] : null;
    let pid;

    if (!existing) {
      summary.created = true;
      const wantCode = proj.code || ('PRJ-IMPORT-' + newUid().slice(0, 6));
      let finalCode = wantCode, n = 2;
      while (row('SELECT id FROM projects WHERE code=?', [finalCode])) { finalCode = wantCode + '-' + n; n++; }
      if (finalCode !== wantCode) summary.codeCollision = true;
      run(`INSERT INTO projects (title, code, status, priority, funding, modality, sample, flags, tags, pi_id, start_date, end_date, notes, container_uid)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [proj.title || 'Untitled', finalCode, proj.status || 'Draft', proj.priority || 'Medium', proj.funding || '',
          proj.modality || '', proj.sample || '', proj.flags || '', proj.tags || '', piLocal, proj.start_date || null,
          proj.end_date || null, proj.notes || '', proj.container_uid || newUid()]);
      pid = row('SELECT id FROM projects WHERE code=?', [finalCode]).id;
    } else {
      pid = existing.id;
      let finalCode = existing.code;
      if (proj.code && proj.code !== existing.code) {
        const collide = row('SELECT id FROM projects WHERE code=? AND id!=?', [proj.code, pid]);
        if (!collide) finalCode = proj.code; else summary.codeCollision = true;
      }
      run(`UPDATE projects SET title=?, code=?, status=?, priority=?, funding=?, modality=?, sample=?, flags=?, tags=?, pi_id=?, start_date=?, end_date=?, notes=?, updated_at=datetime('now') WHERE id=?`,
        [proj.title || existing.title, finalCode, proj.status || existing.status, proj.priority || existing.priority,
          proj.funding || '', proj.modality || '', proj.sample || '', proj.flags || '', proj.tags || '', piLocal,
          proj.start_date || null, proj.end_date || null, proj.notes || '', pid]);
    }
    summary.projectId = pid;

    // ---- project_people / kv: replace wholesale (project-level metadata, last-writer-wins) ----
    run('DELETE FROM project_people WHERE project_id=?', [pid]);
    (data.people || []).forEach((pp, i) => {
      if (pp.project_role) run('INSERT OR IGNORE INTO project_people (project_id, person_id, role) VALUES (?,?,?)', [pid, personLocalId[i], pp.project_role]);
    });
    if (piLocal) run('INSERT OR IGNORE INTO project_people (project_id, person_id, role) VALUES (?,?,?)', [pid, piLocal, 'Principal Investigator']);
    run('DELETE FROM kv WHERE project_id=?', [pid]);
    (data.kv || []).forEach((k) => run('INSERT INTO kv (project_id, key, value) VALUES (?,?,?)', [pid, k.key, k.value]));

    // project_instruments: union in anything referenced by the container (never removes locals)
    const instUsed = new Set(instLocalId);
    (data.milestones || []).forEach((m) => (m.instruments || []).forEach((i) => instUsed.add(instLocalId[i])));
    (data.meetings || []).forEach((m) => (m.instruments || []).forEach((i) => instUsed.add(instLocalId[i])));
    instUsed.forEach((id) => { if (id != null) run('INSERT OR IGNORE INTO project_instruments (project_id, instrument_id) VALUES (?,?)', [pid, id]); });

    // ---- Milestones: replace only what the sender owns (origin_side===side, or an updated uid) ----
    const incomingMsUids = new Set((data.milestones || []).map((m) => m.uid).filter(Boolean));
    rows('SELECT * FROM milestones WHERE project_id=?', [pid])
      .filter((m) => (m.origin_side && m.origin_side === side) || (m.uid && incomingMsUids.has(m.uid)))
      .forEach((m) => {
        run('DELETE FROM milestone_owners WHERE milestone_id=?', [m.id]);
        run('DELETE FROM milestone_instruments WHERE milestone_id=?', [m.id]);
        run('DELETE FROM milestones WHERE id=?', [m.id]);
      });
    (data.milestones || []).forEach((m) => {
      run('INSERT INTO milestones (project_id, name, due_date, status, note, uid, origin_side, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [pid, m.name || '', m.due_date || null, m.status || 'pending', m.note || '', m.uid || newUid(), side,
          m.created_at || new Date().toISOString(), m.updated_at || new Date().toISOString()]);
      const mid = row('SELECT last_insert_rowid() as id').id;
      (m.owners || []).forEach((i) => { const lid = personLocalId[i]; if (lid != null) run('INSERT OR IGNORE INTO milestone_owners (milestone_id, person_id) VALUES (?,?)', [mid, lid]); });
      (m.instruments || []).forEach((i) => { const lid = instLocalId[i]; if (lid != null) run('INSERT OR IGNORE INTO milestone_instruments (milestone_id, instrument_id) VALUES (?,?)', [mid, lid]); });
      summary.milestones.added++;
    });

    // ---- Meetings: same ownership-protected replace, rebuild denormalized attendees string ----
    const incomingMtUids = new Set((data.meetings || []).map((m) => m.uid).filter(Boolean));
    rows('SELECT * FROM meetings WHERE project_id=?', [pid])
      .filter((m) => (m.origin_side && m.origin_side === side) || (m.uid && incomingMtUids.has(m.uid)))
      .forEach((m) => {
        run('DELETE FROM meeting_people WHERE meeting_id=?', [m.id]);
        run('DELETE FROM meeting_instruments WHERE meeting_id=?', [m.id]);
        run('DELETE FROM meetings WHERE id=?', [m.id]);
      });
    (data.meetings || []).forEach((m) => {
      const peopleIds = (m.people || []).map((i) => personLocalId[i]).filter((x) => x != null);
      const attendees = peopleIds.length
        ? rows(`SELECT name FROM people WHERE id IN (${peopleIds.map(() => '?').join(',')})`, peopleIds).map((r) => r.name).join(', ')
        : '';
      const note = (global.UI && global.UI.sanitizeHtml) ? global.UI.sanitizeHtml(m.note || '') : (m.note || '');
      run('INSERT INTO meetings (project_id, title, date, attendees, link, note, actions, uid, origin_side, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [pid, m.title || '', m.date || null, attendees, m.link || '', note, m.actions || '', m.uid || newUid(), side,
          m.created_at || new Date().toISOString(), m.updated_at || new Date().toISOString()]);
      const mid = row('SELECT last_insert_rowid() as id').id;
      peopleIds.forEach((lid) => run('INSERT OR IGNORE INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [mid, lid]));
      (m.instruments || []).forEach((i) => { const lid = instLocalId[i]; if (lid != null) run('INSERT OR IGNORE INTO meeting_instruments (meeting_id, instrument_id) VALUES (?,?)', [mid, lid]); });
      summary.meetings.added++;
    });

    // ---- Files: same ownership-protected replace; uploads keep the container's opaque path key ----
    const incomingFileUids = new Set((data.files || []).map((f) => f.uid).filter(Boolean));
    rows('SELECT * FROM files WHERE project_id=?', [pid])
      .filter((f) => (f.origin_side && f.origin_side === side) || (f.uid && incomingFileUids.has(f.uid)))
      .forEach((f) => run('DELETE FROM files WHERE id=?', [f.id]));
    for (const f of (data.files || [])) {
      run('INSERT INTO files (project_id, name, kind, path, uid, origin_side, created_at) VALUES (?,?,?,?,?,?,?)',
        [pid, f.name || '', f.kind || 'link', f.path || '', f.uid || newUid(), side, f.created_at || new Date().toISOString()]);
      summary.files.added++;
      if (f.data && typeof f.data === 'object' && typeof f.data.data === 'string' && f.path) {
        try { await idbSet(UPLOAD_KEY + ':' + f.path, base64ToBlob(f.data)); } catch (_) { /* metadata row still imported */ }
      }
    }

    // ---- Comments & status history: union by uid, never delete (lossless in both directions) ----
    const existingCommentUids = new Set(rows('SELECT uid FROM project_comments WHERE project_id=?', [pid]).map((r) => r.uid).filter(Boolean));
    (data.comments || []).forEach((c) => {
      if (c.uid && existingCommentUids.has(c.uid)) return;
      const body = (global.UI && global.UI.sanitizeHtml) ? global.UI.sanitizeHtml(c.body || '') : (c.body || '');
      run('INSERT INTO project_comments (project_id, uid, author, side, body, created_at) VALUES (?,?,?,?,?,?)',
        [pid, c.uid || newUid(), c.author || '', c.side || 'lab', body, c.created_at || new Date().toISOString()]);
      summary.comments.added++;
    });
    const existingHistUids = new Set(rows('SELECT uid FROM status_history WHERE project_id=?', [pid]).map((r) => r.uid).filter(Boolean));
    (data.status_history || []).forEach((h) => {
      if (h.uid && existingHistUids.has(h.uid)) return;
      run('INSERT INTO status_history (project_id, uid, from_status, to_status, actor, side, note, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [pid, h.uid || newUid(), h.from_status || '', h.to_status || '', h.actor || '', h.side || '', h.note || '', h.created_at || new Date().toISOString()]);
      summary.history.added++;
    });

    markDirty();
    return summary;
  }

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
      DELETE FROM meetings;
      DELETE FROM files;
      DELETE FROM kv;
      DELETE FROM status_history;
      DELETE FROM project_comments;
      DELETE FROM projects;
      DELETE FROM people;
      DELETE FROM instruments;
    `);
    try {
      // Reset AUTOINCREMENT counters so re-seeding starts IDs from 1 again;
      // otherwise seedSampleData's hardcoded cross-references (e.g. milestone.project_id)
      // point at IDs that no longer match once counters have advanced past a prior seed/clear.
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('projects','people','instruments','milestones','meetings','files','kv','status_history','project_comments')");
    } catch (_) { /* sqlite_sequence doesn't exist yet on a brand-new, never-inserted-into database */ }
    markDirty();
  }

  function seedSampleData() {
    clearAllData();

    // 1. People
    const peopleData = [
      ['Dr. Elena Rostova', 'PI', 'Bio-Photonics Lab', 'Harvard Immunology', 'elena.rostova@harvard.edu', 'Specializes in deep-tissue intravital 2-photon imaging'],
      ['Prof. Marcus Thorne', 'PI', 'Neural Dynamics Institute', 'MIT', 'mthorne@mit.edu', 'Synaptic plasticity & optogenetics grant leader'],
      ['Dr. Sarah Lin', 'PI', 'Therapeutics & Onco-Therapy', 'Stanford', 'slin@stanford.edu', 'High-throughput 3D organoid drug screening'],
      ['Alex Chen', 'Researcher', 'Bio-Photonics Lab', 'Harvard Immunology', 'achen@harvard.edu', 'Postdoc running resonant intravital time-lapses'],
      ['Maya Patel', 'Researcher', 'Neural Dynamics Institute', 'MIT', 'mpatel@mit.edu', 'PhD candidate in STED super-resolution assays'],
      ['David Kim', 'Facility Staff', 'Bioimaging Core Facility', '', 'dkim@corefacility.edu', 'Senior optical specialist & laser safety officer']
    ];
    for (const p of peopleData) {
      run('INSERT INTO people (name, type, organization, department, email, note) VALUES (?,?,?,?,?,?)', p);
    }

    // 2. Instruments
    const instData = [
      ['Leica SP8 FALCON', 'FLIM / Confocal', 'Available', 'Room 118', 'Fluorescence lifetime imaging, White Light Laser 470-670nm + 405nm'],
      ['Olympus FV3000', 'Multiphoton / Confocal', 'In-use', 'Room 204', 'High-sensitivity spectral GaAsP detectors, heated stage chamber'],
      ['Zeiss Lightsheet Z.1', 'Lightsheet (Volume)', 'Available', 'Room 210', 'Dual-side illumination for cleared tissue & whole organ 3D imaging'],
      ['Nikon AX R Resonant', 'Resonant Confocal', 'Available', 'Room 212', '2K x 2K resonant scanning for high-speed calcium dynamics'],
      ['Glacios Cryo-TEM', 'Cryo-EM', 'Maintenance', 'Room B14', '200kV autoloader - undergoing routine monthly beam alignment']
    ];
    for (const i of instData) {
      run('INSERT INTO instruments (name, kind, status, location, note) VALUES (?,?,?,?,?)', i);
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

    // Project 2: Submitted (lab has submitted to the facility, awaiting review)
    run(`INSERT INTO projects (title, code, status, priority, pi_id, modality, funding, sample, flags, tags, start_date, end_date, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      'Super-Resolution Mapping of Synaptic Density Compounds',
      'PRJ-2026-002',
      'Submitted',
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

    // 7. Meetings
    run(`INSERT INTO meetings (project_id, title, date, attendees, note, actions) VALUES (?,?,?,?,?,?)`, [
      1,
      'Project Kickoff & Laser Alignment Review',
      '2026-01-12',
      'Elena Rostova, Alex Chen, David Kim',
      'Reviewed intravital laser power levels and live-animal heating stage protocol.',
      'Alex to reserve recurring Monday/Thursday blocks on Olympus FV3000; David to verify gas calibration.'
    ]);
    run(`INSERT INTO meetings (project_id, title, date, attendees, note, actions) VALUES (?,?,?,?,?,?)`, [
      1,
      'Interim Progress & Channel Bleaching Check',
      '2026-02-28',
      'Alex Chen, David Kim',
      'Observed minor fluorophore quenching in red channel. Switched to resonant line accumulation.',
      'Pulse power dialed down to 7.5%; signal-to-noise preserved without phototoxicity.'
    ]);
    run(`INSERT INTO meetings (project_id, title, date, attendees, note, actions) VALUES (?,?,?,?,?,?)`, [
      2,
      'Screening Protocol Design & STED Parameter Setup',
      '2026-03-05',
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

    // 10. Lab <-> Facility workflow demo data (v1.3.0): container identity, per-row ownership,
    // status history, and a discussion thread. Backfilled in one pass rather than threading uid/
    // origin_side/container_uid through every INSERT above.
    rows('SELECT id FROM projects').forEach((p) => run('UPDATE projects SET container_uid=? WHERE id=?', [newUid(), p.id]));
    ['milestones', 'meetings', 'files'].forEach((table) => {
      rows(`SELECT id FROM ${table}`).forEach((r) => run(`UPDATE ${table} SET uid=?, origin_side='lab' WHERE id=?`, [newUid(), r.id]));
    });
    // One facility-owned milestone, to demonstrate the ownership-protection rule on import/export.
    run("UPDATE milestones SET origin_side='facility' WHERE id=6");

    // Status history (last row per project must match the project's current status).
    run('INSERT INTO status_history (project_id, uid, from_status, to_status, actor, side, note) VALUES (1, ?, "", "Kick-off Scheduled", "David Kim", "facility", "Recorded at upgrade")', [newUid()]);
    run('INSERT INTO status_history (project_id, uid, from_status, to_status, actor, side, note) VALUES (1, ?, "Kick-off Scheduled", "Active", "David Kim", "facility", "Recorded at upgrade")', [newUid()]);
    run('INSERT INTO status_history (project_id, uid, from_status, to_status, actor, side, note) VALUES (2, ?, "", "Draft", "Prof. Marcus Thorne", "lab", "Project created")', [newUid()]);
    run('INSERT INTO status_history (project_id, uid, from_status, to_status, actor, side, note) VALUES (2, ?, "Draft", "Submitted", "Prof. Marcus Thorne", "lab", "Ready for facility review")', [newUid()]);
    run('INSERT INTO status_history (project_id, uid, from_status, to_status, actor, side, note) VALUES (3, ?, "", "Completed", "David Kim", "facility", "Recorded at upgrade")', [newUid()]);

    // Discussion thread (one comment per side).
    run('INSERT INTO project_comments (project_id, uid, author, side, body) VALUES (2, ?, "Prof. Marcus Thorne", "lab", ?)',
      [newUid(), '<p>Submitting for facility review — STED parameters are finalized on our end.</p>']);
    run('INSERT INTO project_comments (project_id, uid, author, side, body) VALUES (1, ?, "David Kim", "facility", ?)',
      [newUid(), '<p>Laser safety paperwork confirmed — cleared for the intravital imaging sessions.</p>']);

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
    seedSampleData,
    clearAllData,
    newUid,
    setStatus,
    buildProjectContainer,
    importProjectContainer
  };

})(window);
