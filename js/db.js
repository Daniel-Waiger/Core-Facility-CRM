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
    min_duration_mins INTEGER DEFAULT 0,
    max_duration_mins INTEGER DEFAULT 0,
    min_gap_mins INTEGER DEFAULT 0,
    min_notice_hours REAL DEFAULT 0,
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
    tier_id INTEGER,
    tier_overhead_pct REAL,
    category_staff_pct REAL,
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
  CREATE TABLE IF NOT EXISTS pricing_tiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    overhead_pct REAL DEFAULT 0,
    is_retired INTEGER DEFAULT 0,
    retired_at TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS group_tiers (
    org TEXT PRIMARY KEY,
    tier_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS instrument_tier_rates (
    instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    tier_id INTEGER NOT NULL,
    cost REAL DEFAULT 0,
    PRIMARY KEY(instrument_id, tier_id)
  );
  CREATE TABLE IF NOT EXISTS category_policies (
    category TEXT PRIMARY KEY,
    staff_pct REAL DEFAULT 100,
    requires_staff INTEGER DEFAULT 0,
    follow_assisted INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS service_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    grant_id INTEGER,
    person_id INTEGER,
    instrument_id INTEGER,
    date TEXT DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    qty REAL DEFAULT 0,
    unit TEXT DEFAULT 'hour',
    rate REAL DEFAULT 0,
    total_cost REAL DEFAULT 0,
    is_cancelled INTEGER DEFAULT 0,
    cancelled_at TEXT DEFAULT '',
    billing_retained INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS project_outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'publication',
    title TEXT NOT NULL DEFAULT '',
    reference TEXT DEFAULT '',
    date TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ix_milestones_project ON milestones(project_id);
  CREATE INDEX IF NOT EXISTS ix_meetings_project ON meetings(project_id);
  CREATE INDEX IF NOT EXISTS ix_files_project ON files(project_id);
  CREATE INDEX IF NOT EXISTS ix_kv_project ON kv(project_id);
  CREATE INDEX IF NOT EXISTS ix_service_entries_project ON service_entries(project_id);
  CREATE INDEX IF NOT EXISTS ix_project_outputs_project ON project_outputs(project_id);
  `;

  /* ---------------- sql.js bootstrap ---------------- */
  let db = null;
  const DB_KEY = 'core.db';
  const UPLOAD_KEY = 'uploads';
  // Demo mode gets its own IndexedDB *database* (not just a differently-prefixed key) so that a
  // demo tab (`?demo=1`, see js/consts.js's IS_DEMO) is physically isolated from a real facility's
  // data. This single database also holds `uploads:*` (file attachments, see saveUpload/getUpload
  // below) and `auto-backup-dir-handle` (the user's real backup folder handle, see
  // saveAutoBackupDirHandle/getAutoBackupDirHandle below) — switching the database name isolates
  // all three at once, so a demo tab cannot resolve the user's backup folder or see their uploads,
  // not just its own sample rows in the 'kv' object store. Keying only the value inside the same
  // database would leave those other two reachable from a demo session, which is exactly the kind
  // of leak this is meant to close.
  const IDB_NAME = global.IS_DEMO ? 'core-facility-demo' : 'core-facility';

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

    // Per-instrument booking constraints (min/max session duration, minimum gap between bookings
    // on the same instrument, minimum advance notice before a booking's start). Zero = unconstrained,
    // so an existing instrument with no configured constraints behaves exactly as before. Enforced
    // in app.js's findBookingConflicts.
    try { db.exec('ALTER TABLE instruments ADD COLUMN min_duration_mins INTEGER DEFAULT 0'); } catch (_) {}
    try { db.exec('ALTER TABLE instruments ADD COLUMN max_duration_mins INTEGER DEFAULT 0'); } catch (_) {}
    try { db.exec('ALTER TABLE instruments ADD COLUMN min_gap_mins INTEGER DEFAULT 0'); } catch (_) {}
    try { db.exec('ALTER TABLE instruments ADD COLUMN min_notice_hours REAL DEFAULT 0'); } catch (_) {}

    // Pricing tiers (roadmap 2.2): named overhead tiers replacing the binary internal/external
    // overhead pair. A group/lab is assigned a tier (group_tiers, soft link like grant_id — org is
    // already the PK precedent from group_discounts); an instrument's rate can be overridden per
    // tier (instrument_tier_rates, absent row => instruments.cost applies). Runs at the very end of
    // migrate() — meetings.tier_id/tier_overhead_pct in particular must come after the meetings
    // rebuild earlier in this function, which copies an explicit (older) column list into a fresh
    // table and would otherwise silently drop a column added before it ran.
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pricing_tiers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          overhead_pct REAL DEFAULT 0,
          is_retired INTEGER DEFAULT 0,
          retired_at TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS group_tiers (
          org TEXT PRIMARY KEY,
          tier_id INTEGER
        );
        CREATE TABLE IF NOT EXISTS instrument_tier_rates (
          instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
          tier_id INTEGER NOT NULL,
          cost REAL DEFAULT 0,
          PRIMARY KEY(instrument_id, tier_id)
        );
      `);
    } catch (_) {}
    try { db.exec('ALTER TABLE meetings ADD COLUMN tier_id INTEGER'); } catch (_) {}
    try { db.exec('ALTER TABLE meetings ADD COLUMN tier_overhead_pct REAL'); } catch (_) {}

    // Standalone service entries (roadmap 2.3): billable work logged outside any booking —
    // technician time, sample prep, per-unit items. project_id carries ON DELETE SET NULL, same
    // "facility-wide" precedent as meetings.project_id; grant_id/person_id/instrument_id carry NO
    // REFERENCES clause, matching meetings.grant_id and projects.pi_id — a retired person/
    // instrument or retired grant must stay attributable on a historical entry rather than being
    // cascaded away, and any delete path for those tables must null/clean these up explicitly
    // (see countPersonRefs/countInstrumentRefs/countGrantRefs and app.js's retire*/archiveProject).
    // total_cost is a SNAPSHOT (qty*rate at save time, no overhead/tax — a direct charge), frozen
    // like every other cost snapshot in this app: never recomputed after save. Cancel semantics
    // mirror bookings' is_cancelled/billing_retained pair (see setServiceEntryCancelled below) but
    // with no before/after-start timing rule — an entry is logged retrospectively, so cancelling
    // one simply asks whether the charge still stands. No denormalized name columns: every display
    // resolves person/instrument/grant via a join (UI.retiredName / DB.grantLabel), same as
    // meetings' project_id and grant_id joins.
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
          grant_id INTEGER,
          person_id INTEGER,
          instrument_id INTEGER,
          date TEXT DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          qty REAL DEFAULT 0,
          unit TEXT DEFAULT 'hour',
          rate REAL DEFAULT 0,
          total_cost REAL DEFAULT 0,
          is_cancelled INTEGER DEFAULT 0,
          cancelled_at TEXT DEFAULT '',
          billing_retained INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS ix_service_entries_project ON service_entries(project_id);
      `);
    } catch (_) {}

    // One-time migration of the legacy overhead_internal/overhead_external app_config pair into
    // two default tiers, so an existing facility sees its old rates as named, editable tiers
    // instead of losing them. Guarded by 'pricing_tiers_seeded' rather than just "pricing_tiers is
    // empty": migrate() runs on EVERY boot of an existing database, and without the flag, a
    // facility that deletes both default tiers (a real zero-ref Delete is offered once nothing
    // references them) got them right back on the next reload, because the legacy config values
    // are never cleared. The flag makes this genuinely one-time — set the moment this block is
    // evaluated at all, whether or not it actually had anything to seed — so a re-empty table never
    // re-triggers it. LEGACY FALLBACK STAYS IN FORCE regardless: any org with no group_tiers row
    // keeps pricing at the (unedited-from-here-on) overhead_internal + overhead_external sum — see
    // resolveOverheadForOrg — so an untouched facility (or a group nobody ever assigns a tier to)
    // behaves exactly as before this feature, and a first upgrade behaves exactly as it did before
    // this flag existed.
    // Deferred item (1.11.0 "Known and deferred" #3): the flag above only protects a database
    // that already has it — a real 1.10.2 install upgrading straight to this version has NEVER
    // written 'pricing_tiers_seeded' (the flag itself is new here), so if that facility had
    // already used the zero-ref Delete on both default tiers before upgrading, `already.c` reads
    // 0 exactly like a database that never had tiers at all, and the block above would reseed them
    // once more on this very first migrate() pass — the gap CHANGELOG.md records. There is no
    // boolean to read (a database that legitimately never had tiers looks identical to one that had
    // them deleted), so this checks for *evidence* that pricing_tiers rows existed and were removed,
    // rather than trusting the row count alone:
    //   - sqlite_sequence.seq for 'pricing_tiers' — AUTOINCREMENT (see the CREATE TABLE above) means
    //     the counter is never reused or reset by a plain DELETE, so seq > 0 proves a row was once
    //     inserted even though none remain now.
    //   - group_tiers / instrument_tier_rates rows — a lab or instrument override can only exist if
    //     a real tier was assigned at some point; pricing_tiers.id carries no REFERENCES to either
    //     (tiers retire, never delete while referenced — see setTierRetired's comment), so these can
    //     dangle after a tier row is gone and still prove one existed.
    //   - meetings.tier_id — a booking's price snapshot column; any non-null value was copied from a
    //     real pricing_tiers row at save time.
    // Any one of these means "had and deleted", so the legacy reseed is skipped even though
    // pricing_tiers itself is empty and the flag is unset.
    try {
      if (getConfig('pricing_tiers_seeded', null) == null) {
        const already = row('SELECT COUNT(*) as c FROM pricing_tiers') || { c: 0 };
        let hadTiersBefore = false;
        if (!already.c) {
          try {
            const seqRow = row("SELECT seq FROM sqlite_sequence WHERE name='pricing_tiers'");
            if (seqRow && Number(seqRow.seq) > 0) hadTiersBefore = true;
          } catch (_) { /* sqlite_sequence doesn't exist yet on a brand-new database */ }
          if (!hadTiersBefore) {
            const gt = row('SELECT COUNT(*) as c FROM group_tiers') || { c: 0 };
            if (gt.c) hadTiersBefore = true;
          }
          if (!hadTiersBefore) {
            const itr = row('SELECT COUNT(*) as c FROM instrument_tier_rates') || { c: 0 };
            if (itr.c) hadTiersBefore = true;
          }
          if (!hadTiersBefore) {
            const mt = row('SELECT COUNT(*) as c FROM meetings WHERE tier_id IS NOT NULL') || { c: 0 };
            if (mt.c) hadTiersBefore = true;
          }
        }
        if (!already.c && !hadTiersBefore) {
          const hasInternal = getConfig('overhead_internal', null);
          const hasExternal = getConfig('overhead_external', null);
          if (hasInternal != null || hasExternal != null) {
            run('INSERT INTO pricing_tiers (name, overhead_pct) VALUES (?,?)', ['Internal', getConfigNum('overhead_internal', 0)]);
            run('INSERT INTO pricing_tiers (name, overhead_pct) VALUES (?,?)', ['External', getConfigNum('overhead_external', 0)]);
          }
        }
        setConfig('pricing_tiers_seeded', 1);
      }
    } catch (_) {}

    // Per-category staff billing policy (roadmap item B): what percent of a Facility Staff
    // member's normal rate a booking's category bills, plus whether that category requires a
    // facility staff assignee at all. A facility-SETTINGS table (like group_discounts/
    // pricing_tiers above) — clearAllData() deliberately leaves it alone. Runs at the very end of
    // migrate() for the same reason as the pricing-tier block above: meetings.category_staff_pct
    // just below must come after the meetings_new rebuild earlier in this function, which copies
    // an explicit (older) column list into a fresh table and would otherwise silently drop a
    // column added before it ran.
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS category_policies (
          category TEXT PRIMARY KEY,
          staff_pct REAL DEFAULT 100,
          requires_staff INTEGER DEFAULT 0,
          follow_assisted INTEGER DEFAULT 0
        );
      `);
    } catch (_) {}
    seedDefaultCategoryPolicies();
    try { db.exec('ALTER TABLE meetings ADD COLUMN category_staff_pct REAL'); } catch (_) {}

    // Project outputs (roadmap 3.3) — the funnel's exit stage (publication/acknowledgement/
    // dataset/other). A data table, not a settings table, so it belongs in clearAllData() and
    // the ref-counters, not the org-keyed-settings exemption list above. CREATE TABLE IF NOT
    // EXISTS here (idempotent, same pattern as category_policies above) covers every DB that
    // migrated before this table existed; the SCHEMA string above covers a brand-new DB.
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_outputs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          type TEXT NOT NULL DEFAULT 'publication',
          title TEXT NOT NULL DEFAULT '',
          reference TEXT DEFAULT '',
          date TEXT DEFAULT '',
          note TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS ix_project_outputs_project ON project_outputs(project_id);
      `);
    } catch (_) {}
  }

  // Seeds the four built-in categories' default policies exactly once (idempotent: no-ops once
  // category_policies has any row at all, seeded or user-edited) — defaults preserve current
  // behavior exactly: every staff_pct is 100 (no scaling until a facility configures one), and
  // 'training'/'assisted session' start out requiring a facility staff assignee, since that was
  // already the de facto expectation for those two categories. 'training' also starts with
  // follow_assisted=1 (a live link to 'assisted session'.staff_pct, not a value copy) so the
  // owner's "train same as assisted" default holds without anyone touching Settings — with both
  // rows at 100% that link changes nothing to look at until a facility actually configures a
  // percent. Runs from BOTH migrate() (an existing database being upgraded) and boot()'s
  // fresh-SCHEMA path below (a brand-new database, which never calls migrate()) so a facility
  // sees these defaults either way. Any other/user-added category (sync, consult, or a
  // facility-added vocab term) simply gets no row — categoryPolicy()'s {100, false} fallback
  // already reproduces "unscaled, no staff required" for those.
  function seedDefaultCategoryPolicies() {
    const already = row('SELECT COUNT(*) as c FROM category_policies') || { c: 0 };
    if (already.c) return;
    const defaults = [
      // [category, staff_pct, requires_staff, follow_assisted]
      ['sync', 100, 0, 0],
      ['consult', 100, 0, 0],
      ['assisted session', 100, 1, 0],
      ['training', 100, 1, 1]
    ];
    defaults.forEach(([category, staff_pct, requires_staff, follow_assisted]) => {
      run('INSERT INTO category_policies (category, staff_pct, requires_staff, follow_assisted) VALUES (?,?,?,?)',
        [category, staff_pct, requires_staff, follow_assisted]);
    });
  }

  /* ---------------- Per-category staff billing policy (roadmap item B) ----------------
     Resolves ONE category to {staff_pct, requires_staff} — the single place app.js's live modal
     (recomputeBomTotals) and this file's own seedBooking resolve it, so a seeded booking can
     never price differently than the live modal would for the same category (same pattern as
     resolveOverheadForOrg/resolveInstrumentCost above). follow_assisted is a LIVE LINK, not a
     value copy: it reads 'assisted session'.staff_pct fresh every time, one level deep only (no
     chains — a category that follows assisted-session's OWN staff_pct, never another category's
     follow_assisted). requires_staff is never inherited via follow_assisted — that flag only
     links the percent. Missing category (blank, or no row at all — an unknown/user-added vocab
     term) resolves to {100, false}, i.e. unscaled and no staff required: exactly today's
     behavior, so an unconfigured category changes nothing. */
  function getCategoryPolicyRaw(category) {
    if (!category) return { staff_pct: 100, requires_staff: false, follow_assisted: false };
    const r = row('SELECT staff_pct, requires_staff, follow_assisted FROM category_policies WHERE category=?', [category]);
    if (!r) return { staff_pct: 100, requires_staff: false, follow_assisted: false };
    // Same non-negative clamp as categoryPolicy/setCategoryPolicy — this raw form feeds the
    // Settings UI, which must never display a negative from a row written before the clamp.
    return { staff_pct: Math.max(0, Number(r.staff_pct) || 0), requires_staff: !!r.requires_staff, follow_assisted: !!r.follow_assisted };
  }
  function categoryPolicy(category) {
    const raw = getCategoryPolicyRaw(category);
    if (raw.follow_assisted) {
      // One level, no chains: read 'assisted session'.staff_pct directly, not through another
      // recursive categoryPolicy() call (which would let a chain of follow_assisted flags loop).
      const assisted = row('SELECT staff_pct FROM category_policies WHERE category=?', ['assisted session']);
      // Same non-negative clamp as setCategoryPolicy, for rows written before the clamp existed.
      return { staff_pct: assisted ? Math.max(0, Number(assisted.staff_pct) || 0) : 100, requires_staff: raw.requires_staff };
    }
    return { staff_pct: Math.max(0, Number(raw.staff_pct) || 0), requires_staff: raw.requires_staff };
  }
  function setCategoryPolicy(category, { staff_pct, requires_staff, follow_assisted }) {
    if (!category) return;
    // Clamp to non-negative: a negative percent would flow through computeBookingBOM's
    // staffPctFactor and produce negative staff lines and booking totals.
    run(`INSERT INTO category_policies (category, staff_pct, requires_staff, follow_assisted) VALUES (?,?,?,?)
         ON CONFLICT(category) DO UPDATE SET staff_pct=excluded.staff_pct, requires_staff=excluded.requires_staff, follow_assisted=excluded.follow_assisted`,
      [category, Math.max(0, Number(staff_pct) || 0), requires_staff ? 1 : 0, follow_assisted ? 1 : 0]);
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
      // migrate() never runs for a brand-new database (SCHEMA already has every current column/
      // table), but the category-policy defaults still need seeding here — see
      // seedDefaultCategoryPolicies's comment for why this can't just live inside migrate().
      seedDefaultCategoryPolicies();
      // M5 fix: migrate()'s pricing-tier seed guard (see its comment) is only ever reached by an
      // EXISTING database going through migrate() — a brand-new database never runs migrate() at
      // all, so 'pricing_tiers_seeded' was never written here, and the very first migrate() this
      // fresh database eventually goes through (its next reload) would find the flag unset and
      // reseed Internal/External from whatever overhead_internal/overhead_external happen to be
      // set — even if a facility had deliberately deleted both tiers in the meantime (the only way
      // to delete a tier is the zero-ref path, so a deleted tier really was meant to stay gone).
      // Setting the flag here, the moment this fresh database is created, makes "no tiers seeded
      // yet" a one-time-only decision exactly as migrate() intends, on a fresh DB too.
      setConfig('pricing_tiers_seeded', 1);
    }
    if (!memoryMode) multiTabGuard = startMultiTabGuard();
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
      const req = indexedDB.open(IDB_NAME, 1);
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
  // Resolve only once the TRANSACTION commits (tx.oncomplete), not once the individual request
  // succeeds (req.onsuccess) — a request can succeed and still have its transaction abort/fail to
  // commit (e.g. a quota error surfacing at commit time), and a caller awaiting idbSet/idbDelete
  // needs "durably written", not "queued". req.onsuccess/req.onerror are NOT wired to resolve/
  // reject here on purpose: a Promise settles on its first resolve/reject call, so if req.onsuccess
  // also called resolve() it would win the race and the promise would settle before tx.oncomplete
  // ever fires, making the tx handlers below dead code (this is exactly the bug being fixed).
  // req.onerror is still surfaced via tx.onerror/tx.onabort, which fire for the same failure.
  async function idbSet(key, val) {
    if (memoryMode) { memoryStore.set(key, val); return; }
    const s = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = s.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ k: key, v: val });
      tx.oncomplete = () => resolve();
      // Item 4 follow-up (found while browser-testing item 4's fix): tx.error can be null/undefined
      // for a transaction that failed WITHOUT an underlying request error (e.g. an explicit
      // transaction.abort() call, as a real IndexedDB failure can look like) — rejecting with that
      // bare null used to reach a caller's `catch (e) { ...e.message... }` and throw a SECOND,
      // unrelated TypeError ("Cannot read properties of null") instead of the failure the caller
      // was trying to report. Fall back to a real Error the same way onabort already does below.
      tx.onerror = () => reject(tx.error || new Error('idbSet transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('idbSet transaction aborted'));
    });
  }
  async function idbDelete(key) {
    if (memoryMode) { memoryStore.delete(key); return; }
    const s = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = s.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = () => resolve();
      // Same null-error fallback as idbSet's tx.onerror above.
      tx.onerror = () => reject(tx.error || new Error('idbDelete transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('idbDelete transaction aborted'));
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

  /* ---------------- Multi-tab guard ----------------
     Two tabs on the SAME database (same IDB_NAME — a demo tab and the real app never share one)
     each ran their own independent 400ms autosave with no idea the other existed, so whichever
     tab's timer fired last silently overwrote the other's edits with no toast, no conflict, no
     trace (H2). There is no real multi-writer support here — no merge, no locking on the actual
     writes — so the fix is to guarantee only ONE tab ever persists at a time: every tab announces
     itself over a BroadcastChannel scoped to this IDB_NAME; each tab independently computes the
     same leader (the tab with the oldest announced timestamp, ties broken by id) from the set of
     announcements it has seen, so every tab converges on the same answer without a central
     coordinator, and two tabs opened in the same instant still pick exactly one leader between
     them (the tie-break on id is total, so both sides of the race agree). The newer tab(s) go
     read-only rather than the reverse, so the tab that was already there (and whose data is
     authoritative) keeps writing.
     A read-only tab is READ-ONLY, not just non-persisting: assertWritable() (called from run() and
     clearAllData(), the two ways this file ever mutates rows on a user's behalf) throws and toasts
     instead of letting the edit happen at all — so a form submitted in a read-only tab never
     touches even this tab's own in-memory copy, and the very next line in whatever saver called it
     (closing its modal, refreshing the view) never runs either. onMultiTabState surfaces the state
     so the UI can show a persistent banner (reusing temp-session-banner) rather than let this fail
     silently or as a wall of uncaught-exception noise.
     Promotion (a read-only tab becomes the leader, e.g. because the leader tab closed) is the
     dangerous direction, not the safe one: this tab's in-memory `db` was never written to (it was
     read-only) but it IS possibly stale — the outgoing leader kept autosaving while this tab did
     nothing, so resuming this tab's own autosave loop as-is would flush a stale image right over
     the leader's last, newer save. So promotion reloads `db` from IndexedDB FIRST — discarding
     this tab's in-memory image entirely, which is safe precisely because it was read-only and so
     never diverged from what it last loaded/saw broadcast — re-renders the current screen from
     that fresh copy, and only THEN flips readOnly to false and lets normal autosave resume.
     Writes stay blocked for the whole async gap the reload takes (see `promoting` below), so a
     click landing in that narrow window is refused exactly like any other read-only write.
     Falls back to doing nothing (every tab stays a writer, i.e. today's pre-existing behavior) if
     BroadcastChannel doesn't exist — any pre-2021 browser — rather than fail boot over a guard
     that is an improvement, not a requirement.
     Started lazily from boot(), only once memoryMode is known and false: Node itself ships a real
     global BroadcastChannel (v15.4+), and one left open with a live listener keeps the process's
     event loop alive — under `node --test`, which never has a real IndexedDB to guard in the
     first place, that hung the whole run rather than exiting. There is also nothing worth
     guarding in memoryMode (no shared IndexedDB another tab could race for). */
  let multiTabGuard = { isReadOnly: () => false };
  function startMultiTabGuard() {
    if (typeof BroadcastChannel === 'undefined') return { isReadOnly: () => false };
    let bc;
    try { bc = new BroadcastChannel('cf-tab-guard:' + IDB_NAME); } catch (e) { return { isReadOnly: () => false }; }
    const selfId = Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
    const selfTs = Date.now();
    const peers = new Map(); // id -> ts, other known tabs (never includes selfId)
    let readOnly = false;
    let promoting = false; // true only during the async reload-from-disk gap on promotion
    // Counts consecutive failed promotion attempts (reset to 0 on a successful one) — mirrors
    // db.js's own autosave `failureStreak` pattern. Each retry re-runs reloadFromDiskAndPromote,
    // so without this a stuck promotion would toast BOTH its own message and app.js's generic
    // read-only toast every 3 seconds forever; toasting only on the first failure of a streak
    // keeps a genuinely stuck tab quiet after the first warning instead of spamming one every retry.
    let promoteFailStreak = 0;

    // Promotion: reload the in-memory database from IndexedDB before this tab is allowed to write
    // or autosave again — see the big comment above. Never throws outward: a failed reload leaves
    // this tab's existing (still merely stale, never divergent) copy in place, keeps the tab
    // READ-ONLY (it never falls through to the success path below, so `readOnly` stays true), and
    // retries the reload every 3 seconds until one succeeds — it does NOT let the tab become a
    // writer with a possibly-stale copy just because a reload attempt failed.
    async function reloadFromDiskAndPromote() {
      try {
        const SQL = await initSqljs();
        const blob = await idbGet(DB_KEY);
        if (blob) {
          db = new SQL.Database(blob);
          db.exec('PRAGMA foreign_keys = ON;');
        }
      } catch (e) {
        // The reload failed, so this tab's in-memory `db` might still be the stale copy it had
        // as a reader — promoting it to writer anyway would risk autosaving that stale image
        // right over whatever the outgoing leader last wrote. Stay read-only (never fall through
        // to the success path below), tell the UI so it can keep showing the read-only banner,
        // and retry the reload after a short delay rather than leaving this tab stuck read-only
        // forever with no way back in short of a manual reload.
        console.error('multi-tab promotion: reload from IndexedDB failed — staying read-only and retrying', e);
        promoting = false; // allow a retry to actually run reloadFromDiskAndPromote() again
        promoteFailStreak++;
        if (promoteFailStreak === 1 && global.UI && global.UI.toast) {
          global.UI.toast('Could not switch this tab to the active database copy. Retrying…', 'error');
        }
        // `promoteFailed` tells app.js's onMultiTabState this is still the SAME read-only tab
        // failing to catch up, not a fresh "database opened in another tab" transition — the two
        // read very differently and only one of them is true right now.
        if (global.App && global.App.onMultiTabState) global.App.onMultiTabState(true, { promoteFailed: true, repeat: promoteFailStreak > 1 });
        setTimeout(() => {
          if (readOnly && !promoting) { promoting = true; reloadFromDiskAndPromote(); }
        }, 3000);
        return;
      }
      // This tab was read-only, so nothing here should be unsaved — but clear any leftover autosave
      // state anyway rather than trust that invariant blindly (belt-and-suspenders, same reasoning
      // as the explicit child-row deletes CLAUDE.md documents alongside cascade).
      dirty = false;
      pendingDuringSave = false;
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      readOnly = false;
      promoting = false;
      promoteFailStreak = 0;
      if (global.App && global.App.onMultiTabState) global.App.onMultiTabState(false, { promoted: true });
    }

    function recompute() {
      let leaderId = selfId, leaderTs = selfTs;
      for (const [id, ts] of peers) {
        if (ts < leaderTs || (ts === leaderTs && id < leaderId)) { leaderId = id; leaderTs = ts; }
      }
      const next = leaderId !== selfId;
      if (next === readOnly) return; // no change
      if (readOnly && !next) {
        // Promotion. Block writes for the duration (isReadOnly() below checks `promoting` too) and
        // do the disk reload before anything is allowed to touch `db` again.
        if (promoting) return; // already in flight
        promoting = true;
        reloadFromDiskAndPromote();
        return;
      }
      // Demotion (another, older tab showed up) needs no reload — this tab simply stops writing;
      // its own in-memory copy stays exactly what it was, which is fine since read-only tabs never
      // diverge from what they last legitimately saw.
      readOnly = next;
      if (global.App && global.App.onMultiTabState) global.App.onMultiTabState(readOnly);
    }

    bc.onmessage = (ev) => {
      const msg = ev.data || {};
      if (!msg || msg.id === selfId) return;
      if (msg.type === 'hello') {
        peers.set(msg.id, msg.ts);
        recompute();
        try { bc.postMessage({ type: 'hello-ack', id: selfId, ts: selfTs }); } catch (_) {}
      } else if (msg.type === 'hello-ack') {
        peers.set(msg.id, msg.ts);
        recompute();
      } else if (msg.type === 'bye') {
        peers.delete(msg.id);
        recompute();
      }
    };
    try { bc.postMessage({ type: 'hello', id: selfId, ts: selfTs }); } catch (_) {}

    function teardown() {
      try { bc.postMessage({ type: 'bye', id: selfId }); } catch (_) {}
      try { bc.close(); } catch (_) {}
    }
    if (typeof global.addEventListener === 'function') global.addEventListener('pagehide', teardown);

    return { isReadOnly: () => readOnly || promoting };
  }

  // Every user-facing write funnels through here (run()'s single call site for every parameterized
  // INSERT/UPDATE/DELETE, and clearAllData()'s raw multi-statement DELETE) — see the multi-tab
  // guard comment above for why a read-only tab must refuse the write itself, not merely skip
  // persisting it afterwards. Throws so the caller's remaining statements (e.g. a saver's join-row
  // inserts, its closeDim/toast/refresh) never run either; the toast fires here so every caller
  // gets the same message without each of the ~24 save functions having to catch this individually.
  function assertWritable() {
    if (!multiTabGuard.isReadOnly()) return;
    if (global.UI && global.UI.toast) {
      global.UI.toast('This tab is read-only because the database is open in another tab.', 'error');
    }
    const err = new Error('This tab is read-only because the database is open in another tab.');
    err.dbReadOnly = true;
    throw err;
  }

  /* Debounced autosave: every mutation calls markDirty().
     H3 fix: previously cleared `dirty` before the idbSet await settled, so a rejected save was
     silently swallowed (nothing retried, nothing told the user) and a 400ms setTimeout with no
     flush-on-close meant an edit made right before the tab closed was simply never written.
     Now: `dirty` stays true until idbSet actually resolves, a rejection notifies onSaveFailed and
     leaves dirty=true so the very next markDirty()'s timer retries, and pagehide/visibilitychange
     force an immediate flush instead of waiting out the debounce. */
  let saveTimer = null;
  let dirty = false;
  let saving = false;
  let pendingDuringSave = false;
  // Bumped by restoreBackup() in the SAME synchronous block where it swaps the live `db` handle
  // (no `await` in between the two — see restoreBackup itself). What this guards: flush() reads
  // `dbGeneration` into a local `myGen` before it does anything async, then checks `myGen !==
  // dbGeneration` both before and after its own `idbSet` write; if either check trips, flush()
  // drops its snapshot instead of persisting it. Because the bump and the swap happen together,
  // any flush() that read `myGen` before the bump is guaranteed to have captured bytes from the
  // database `db` still pointed at when it read them — so a flush already past that read, even one
  // that started and is still in flight when restoreBackup runs, can never write OLD bytes labeled
  // with the NEW generation number. restoreBackup also waits (waitForSaveIdle, itself bounded — see
  // below) for any flush already in flight to finish before it ever swaps `db`, so this counter is
  // the belt to that suspenders for the narrower window in between; it is not a substitute for it,
  // since a flush that is only SCHEDULED (not yet started) when restoreBackup runs is caught
  // entirely by this generation check, with nothing to wait for.
  let dbGeneration = 0;
  // How long restoreBackup() will wait for an in-flight autosave to finish before giving up and
  // proceeding anyway (see waitForSaveIdle and restoreBackup below). A save can be stuck rather
  // than merely slow — a blocked/full IndexedDB, a browser storage bug — and waiting on it forever
  // would hang the whole restore (and the UI showing it) with nothing the user can do about it.
  // The generation guard above is what makes proceeding safe enough: a stuck save that eventually
  // completes has already ISSUED its write, so the guard cannot un-write those pre-swap bytes — it
  // refuses to acknowledge them as saved, leaves the live database dirty, and reschedules a flush
  // (settleStaleGeneration) that rewrites the restored bytes moments later. A tab closed inside
  // that brief window could lose the restore; that needs storage that hangs and then recovers.
  const SAVE_IDLE_TIMEOUT_MS = 5000;
  function waitForSaveIdle() {
    if (!saving) return Promise.resolve();
    const startedAt = Date.now();
    return new Promise((resolve) => {
      (function check() {
        if (!saving || Date.now() - startedAt >= SAVE_IDLE_TIMEOUT_MS) return resolve();
        setTimeout(check, 15);
      })();
    });
  }
  // Races `promise` against a `ms` timer; on timeout, rejects with `err` instead of waiting any
  // longer. The real work behind `promise` (e.g. an in-flight idbSet's actual IndexedDB write) is
  // NOT cancelled — there is no way to cancel it — this only stops AWAITING it, so a caller can
  // report failure and move on instead of hanging forever on something that may never settle.
  function withDeadline(promise, ms, err) {
    let timer;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(err), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
  // Red-team D: a failed save used to leave `dirty` true with nothing armed to retry it until the
  // NEXT edit happened to call markDirty() again — a facility that stops typing right after a
  // failure (the exact moment it's most likely to notice something's wrong) would sit unsaved
  // indefinitely. And onSaveFailed toasted on every single failed attempt, which — once retries
  // exist — would mean one toast every retry forever. failureStreak counts consecutive failures so
  // the toast fires once per streak (see flush()'s catch) rather than once per attempt, and a
  // RETRY_BACKOFF_MS timer is armed after a failure so the save keeps retrying on its own.
  let failureStreak = 0;
  const RETRY_BACKOFF_MS = 5000;

  function scheduleFlush(delayMs) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; flush(); }, delayMs == null ? 400 : delayMs);
  }

  function markDirty() {
    dirty = true;
    if (saving) pendingDuringSave = true;
    if (global.App && global.App.onSaving) global.App.onSaving();
    scheduleFlush();
  }

  // A stale-generation return (see the two call sites below) means THIS flush's snapshot is
  // worthless — restoreBackup() has since swapped in a different database — but that must not
  // leave `dirty` stuck true with nothing scheduled to clear it: markDirty() already called
  // onSaving() for whatever edit armed this flush, and with no timer left running and `dirty` never
  // reset, the saved-indicator would sit on "unsaved" forever even after restoreBackup's own write
  // succeeds. `dirty` is a single flag shared across generations (not per-generation), so if it is
  // still true here that means the CURRENT (live, post-restore) database has something worth
  // flushing too — schedule that. If it somehow isn't, there is nothing left pending, so report
  // saved now instead of leaving the indicator stuck on whatever markDirty() last set it to.
  function settleStaleGeneration() {
    pendingDuringSave = false;
    if (dirty) {
      scheduleFlush();
    } else if (global.App && global.App.onSaved) {
      global.App.onSaved();
    }
  }

  // Item 3 (second review): flushNow() used to just call flush(), which returns immediately (a
  // no-op) whenever a save is already `saving` — so an edit made WHILE that save is in flight
  // (pendingDuringSave) had nothing to make it go out during a lifecycle event; it waited for the
  // 400ms timer scheduleFlush() re-armed, which pagehide/beforeunload may not give time to fire.
  // `currentFlushPromise` exposes the in-flight call's own promise (set right as `saving` flips
  // true, cleared once that call's own await settles) so flushNow() can await it and then call
  // flush() again for whatever landed during it — see flushNow() below.
  let currentFlushPromise = null;
  async function flush() {
    if (!dirty) return;
    if (saving) return; // a save is already in flight; markDirty() already flagged pendingDuringSave
    if (multiTabGuard.isReadOnly()) return; // this tab lost the leader race — never persist over it
    const myGen = dbGeneration;
    saving = true;
    const thisFlush = (async () => {
    try {
      if (myGen !== dbGeneration) {
        // A restore superseded this database between markDirty() scheduling us and us actually
        // starting — writing this snapshot now would stomp the just-restored database. Drop it;
        // restoreBackup() persists the new database itself.
        settleStaleGeneration();
        return;
      }
      const bytes = currentBytes(); // snapshot taken now; pendingDuringSave catches anything later
      await idbSet(DB_KEY, bytes);
      if (myGen !== dbGeneration) {
        // Same race, caught after the write went out: a restore happened while this idbSet was
        // in flight. The bytes we just wrote are stale (the old database); don't clear `dirty` or
        // report success for them — restoreBackup()'s own write is what actually matters now.
        settleStaleGeneration();
        return;
      }
      if (pendingDuringSave) {
        // More edits landed while this save was writing — those aren't in `bytes`, so stay dirty.
        // Normally the timer markDirty() (re)armed while `saving` was true covers this — but a
        // lifecycle flush (pagehide/beforeunload/visibilitychange, via flushNow()) clears that
        // timer to jump the debounce queue, and if THIS save was the one already in flight when
        // that happened, the timer it relied on is gone with nothing left to fire. Schedule one
        // explicitly here so a save that raced a tab-close flush is never left dirty forever.
        pendingDuringSave = false;
        scheduleFlush();
      } else {
        dirty = false;
        if (global.App && global.App.onSaved) global.App.onSaved();
      }
      failureStreak = 0;
    } catch (e) {
      console.error('autosave failed', e);
      pendingDuringSave = false;
      failureStreak++;
      // Toast once per failure streak, not once per retry — onSaveFailed still updates the
      // persistent saved-dot every time (cheap, and it's supposed to stay visible), but a repeated
      // toast for the same ongoing failure would just be noise.
      if (global.App && global.App.onSaveFailed) global.App.onSaveFailed(e, { repeat: failureStreak > 1 });
      // dirty is left true on purpose, AND a backoff retry is armed here explicitly — the next
      // markDirty() (if any) would re-arm it too, but nothing guarantees another edit ever
      // happens, so this save must be able to retry itself with no further user action.
      scheduleFlush(RETRY_BACKOFF_MS);
    } finally {
      saving = false;
    }
    })();
    currentFlushPromise = thisFlush;
    try {
      await thisFlush;
    } finally {
      if (currentFlushPromise === thisFlush) currentFlushPromise = null;
    }
  }

  // Flush immediately, skipping the remainder of the debounce — used when the tab is about to
  // disappear (pagehide) or go to the background (visibilitychange → hidden), so an edit made
  // just before close isn't lost waiting out the 400ms window. Also wired to `beforeunload`,
  // which — unlike pagehide — fires BEFORE the browser starts actually tearing the page down, so
  // it gives the async idbSet inside flush() strictly more real time to land before the tab is
  // gone; nothing here calls preventDefault or returns a value, so it never shows a "leave site?"
  // prompt, it only gets a head start on the same save pagehide would otherwise trigger alone.
  function flushNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (saving && currentFlushPromise) {
      // A save is already in flight (its snapshot was taken before this edit landed) — flush()
      // itself would just return immediately here. Await the in-flight save, then call flush()
      // again so whatever markDirty() flagged as pendingDuringSave goes out now, during this same
      // lifecycle event, instead of waiting on a debounce timer the event may not allow to fire.
      // Not awaited by callers that don't need to (the event handlers below fire-and-forget this),
      // but the returned promise lets a caller/test wait for the real end-to-end completion.
      return currentFlushPromise.then(() => flush(), () => flush());
    }
    return flush();
  }
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('beforeunload', flushNow);
    global.addEventListener('pagehide', flushNow);
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushNow();
    });
  }

  /* ---------------- Backup (single self-contained file) ---------------- */
  // Every table a restored database must have before the app can even route to Dashboard/
  // Projects/People/Instruments/Settings without throwing "no such table" — see H1 below.
  const CORE_TABLES = ['projects', 'people', 'instruments', 'meetings', 'milestones'];

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
      // Lets a restore in the real app refuse a demo sandbox's data outright (doRestore in
      // app.js) while the sandbox itself is free to accept either kind of file for testing.
      demo: !!global.IS_DEMO,
      db: Array.from(currentBytes()),
      uploads,
    };
  }

  /* Row counts + a headline fact per core table, read from whichever sql.js Database instance is
     passed in — the live `db` for the "what you have now" side of a restore preview, or a scratch
     database opened over an uploaded file for the "what you're about to load" side. Never assumes
     a table exists: a missing one just contributes 0, since the caller (inspectBackupCandidate)
     has already required every CORE_TABLES entry to exist before this runs on untrusted bytes. */
  function summarizeCoreTables(handle) {
    const counts = {};
    for (const t of CORE_TABLES) {
      const res = handle.exec(`SELECT COUNT(*) AS c FROM ${t}`);
      counts[t] = (res && res[0] && res[0].values && res[0].values[0]) ? Number(res[0].values[0][0]) || 0 : 0;
    }
    let newestBooking = '';
    try {
      const res = handle.exec("SELECT MAX(date) AS d FROM meetings WHERE date IS NOT NULL AND TRIM(date) != ''");
      newestBooking = (res && res[0] && res[0].values && res[0].values[0] && res[0].values[0][0]) || '';
    } catch (_) { /* meetings.date not present yet on a very old backup — leave blank */ }
    return { counts, newestBooking };
  }

  // What's actually in the live, currently-open database — the "before" half of a restore
  // preview (doRestore in app.js shows this next to inspectBackupCandidate's "after").
  function liveSummary() {
    return summarizeCoreTables(db);
  }

  /* H1 fix. Before: restoreBackup checked only `kind` and `!data.db`, so `db: []`/`db: {}` (or
     any bytes sql.js could open but that never had this app's schema) passed straight through —
     `new SQL.Database(rawBytes)` succeeds on an empty/foreign image, migrate() only ever adds
     columns to tables that already exist (see migrate() above) and never recreates
     projects/people/instruments/meetings/milestones from scratch, and the bad image was written
     to IndexedDB before a single query ever proved it usable. Every route then threw "no such
     table" on reload, including Settings, so Restore itself became unreachable — the app was
     bricked with no in-app recovery. Fix: open the candidate bytes in a throwaway SQL.Database,
     require every core table to exist and be queryable, and hand back a preview (row counts,
     newest booking date, the backup's own version/created/demo fields) — all BEFORE
     restoreBackup below ever touches the live `db` or IndexedDB. Throws (never returns) on
     anything that fails the check, with a message meant to be shown to the user as-is. */
  async function inspectBackupCandidate(data) {
    if (!data || typeof data !== 'object' || data.kind !== 'core-facility-backup') {
      throw new Error('Not a valid backup file — it does not look like a Core Facility Tracker backup.');
    }
    if (!data.db || (Array.isArray(data.db) && data.db.length === 0)) {
      throw new Error('Not a valid backup file — no database was found inside it.');
    }
    let rawBytes;
    try {
      rawBytes = Array.isArray(data.db) ? new Uint8Array(data.db) : data.db;
      if (!rawBytes || !rawBytes.length) throw new Error('empty');
    } catch (e) {
      throw new Error('Not a valid backup file — its database could not be read.');
    }
    const SQL = await initSqljs();
    let scratch;
    try {
      scratch = new SQL.Database(rawBytes);
    } catch (e) {
      throw new Error('Not a valid backup file — its database could not be opened.');
    }
    try {
      for (const t of CORE_TABLES) {
        try {
          scratch.exec(`SELECT COUNT(*) FROM ${t}`);
        } catch (e) {
          throw new Error(`Not a valid backup file — it is missing required data (no "${t}" table).`);
        }
      }
      const { counts, newestBooking } = summarizeCoreTables(scratch);
      return {
        counts,
        newestBooking,
        version: data.version != null ? data.version : null,
        created: data.created || null,
        // Old backups (pre this fix) never wrote `demo` at all — treat that as "not a demo
        // backup" so they keep restoring exactly as before, per the package brief.
        demo: data.demo === true,
      };
    } finally {
      try { scratch.close(); } catch (_) {}
    }
  }

  async function restoreBackup(data) {
    // G1 fix: F1 (multi-tab read-only) guarded every write path through run()/clearAllData()'s
    // assertWritable() call, but restoreBackup() replaces the whole `db` handle directly and
    // never goes through run() — so a read-only second tab could still restore over the tab
    // that's actually saving, exactly the silent-overwrite H2 was written to stop. Same guard,
    // same toast, checked first so a read-only tab never even opens the scratch database below.
    assertWritable();
    // Validates BEFORE anything below touches the live `db` or IndexedDB — see
    // inspectBackupCandidate's comment. A throw here leaves the live handle exactly as it was.
    const preview = await inspectBackupCandidate(data);

    // Second-review item 1: this used to validate each upload entry (`typeof entry.data ===
    // 'string'`) INSIDE the apply loop below, which ran AFTER old uploads had already been
    // deleted and the SQL database already swapped in and persisted — so a malformed entry
    // (`{}`, or a `data` string that isn't valid base64) left the restore half-applied: new
    // database, old uploads gone, new uploads short by whatever failed to decode. Decode every
    // entry into a Blob here, before the db swap or any IndexedDB delete — a malformed entry now
    // rejects the WHOLE restore, with the live database and upload set untouched.
    const uploadBlobs = new Map();
    for (const [name, entry] of Object.entries(data.uploads || {})) {
      if (!entry || typeof entry !== 'object' || typeof entry.data !== 'string') {
        throw new Error(`Not a valid backup file — the attached file "${name}" is malformed.`);
      }
      let blob;
      try {
        blob = base64ToBlob(entry);
      } catch (e) {
        throw new Error(`Not a valid backup file — the attached file "${name}" could not be decoded.`);
      }
      uploadBlobs.set(name, blob);
    }

    // All async prep — engine init and parsing the incoming bytes into a standalone Database —
    // happens BEFORE waitForSaveIdle() is even called, specifically so that once that wait
    // resolves, the generation bump and the `db` swap below run with NOTHING async in between.
    // Doing this the other way around (as an earlier version of this fix did) reopens the exact
    // gap item 2 exists to close: an `await initSqljs()` sitting between waitForSaveIdle() and the
    // bump would let a brand-new flush() start during it, read the still-OLD dbGeneration while
    // `db` is still the OLD database, and only be caught (if at all) by the post-write generation
    // check below — by which point its write may already have reached IndexedDB.
    const SQL = await initSqljs();
    const rawBytes = Array.isArray(data.db) ? new Uint8Array(data.db) : data.db;
    const newDb = new SQL.Database(rawBytes);
    newDb.exec('PRAGMA foreign_keys = ON;');
    // 4c: let any autosave already in flight finish writing the OLD database first. Without this,
    // that flush's idbSet (bytes captured from the pre-restore `db`) could still be pending when
    // we swap `db` and write below, and land in IndexedDB AFTER our write — silently putting the
    // old database back. Bounded (SAVE_IDLE_TIMEOUT_MS): a save that is stuck rather than merely
    // slow must not hang this restore (and the UI showing it) forever — see waitForSaveIdle and the
    // comment above dbGeneration for why proceeding after the bound is still safe. This is the LAST
    // await before the generation bump and the swap immediately below it — see the comment above.
    await waitForSaveIdle();
    // Bump the generation and swap `db` in the SAME synchronous block — no `await` between them —
    // so no flush can ever read the bumped `dbGeneration` while `db` still points at the OLD
    // database (see the comment above dbGeneration for exactly what this guarantees).
    dbGeneration++;
    const previousDb = db;
    db = newDb;
    try {
      migrate();
      // Bounded like the wait above: if this write itself stalls (the same stuck-IndexedDB
      // scenario), reject rather than leave the restored database only ever in memory while the
      // user stares at nothing — doRestore() in app.js surfaces this as a failed restore.
      await withDeadline(
        idbSet(DB_KEY, currentBytes()),
        SAVE_IDLE_TIMEOUT_MS,
        Object.assign(new Error('Restoring timed out while saving to this browser. Your browser storage may be unavailable; try again or reload and retry.'), { dbSaveTimedOut: true })
      );
    } catch (e) {
      // Never leave the live handle dead on a throw: put the working database back so the app
      // keeps running on what it had before this restore attempt, and surface the real error.
      db = previousDb;
      try { newDb.close(); } catch (_) {}
      throw e;
    }
    // previousDb is kept OPEN (not closed yet) past this point — if the upload apply below fails,
    // the rollback branch needs it live to re-export and re-persist as the working database again.
    // 4b: restore must REPLACE the upload set, not merge into it — an attachment removed from the
    // facility's data before this backup was taken (or never present in it) must not survive the
    // restore just because some earlier database left its blob sitting in IndexedDB. Delete every
    // uploads:* entry the incoming backup doesn't carry before writing the ones it does. Every
    // entry was already decoded and validated above, so nothing here can fail on malformed input —
    // only a genuine IndexedDB error (a full/blocked store) reaches the catch below.
    try {
      const backupUploadNames = new Set(uploadBlobs.keys());
      const existingUploads = await idbGetAllWithPrefix(UPLOAD_KEY + ':');
      for (const { key } of existingUploads) {
        const name = key.slice((UPLOAD_KEY + ':').length);
        if (!backupUploadNames.has(name)) await idbDelete(key);
      }
      for (const [name, blob] of uploadBlobs) {
        await idbSet(UPLOAD_KEY + ':' + name, blob);
      }
    } catch (e) {
      // Roll back rather than leave the SQL database restored with the upload set only half
      // applied: put previousDb back as the live database, re-persist IT (bumping the generation
      // again so any lingering flush targeting the now-abandoned newDb is dropped, same guard as
      // the swap above), and rethrow so doRestore reports the failure honestly instead of the
      // toast in app.js claiming "Database restored successfully" over a half-done restore.
      db = previousDb;
      dbGeneration++;
      try { await withDeadline(idbSet(DB_KEY, currentBytes()), SAVE_IDLE_TIMEOUT_MS, e); } catch (_) { /* best effort re-persist; the original error is what we throw */ }
      try { newDb.close(); } catch (_) {}
      throw e;
    }
    try { previousDb.close(); } catch (_) {}
    return preview;
  }

  /* ---------------- Uploads (IndexedDB) ----------------
     Attachment blobs (`uploads:<storageKey>`) used to have no delete path at all: removing an
     attachment (deleteFile), deleting a project with no history to protect (archiveProject's
     zero-ref branch), and Clear All Data every deleted the `files` row that pointed at a blob but
     never the blob itself — it lingered forever in IndexedDB and kept shipping inside every
     future backup (M9). deleteUpload/deleteUploads close that gap; callers pass the same
     storageKey `files.path` already holds for kind='upload' rows. */
  async function saveUpload(name, blob) { await idbSet(UPLOAD_KEY + ':' + name, blob); }
  async function getUpload(name) { return idbGet(UPLOAD_KEY + ':' + name); }
  // Propagates a failure instead of swallowing it (previously: caught, logged, and silently
  // returned success) — a caller that awaits this and reports "removed"/"deleted" while the blob
  // is still sitting in IndexedDB is lying to the user. Every caller now awaits this AFTER its own
  // row-delete transaction commits and catches the rejection to toast rather than assume success.
  async function deleteUpload(name) {
    if (!name) return;
    await idbDelete(UPLOAD_KEY + ':' + name);
  }
  async function deleteUploads(names) {
    for (const name of names || []) await deleteUpload(name);
  }
  // Every uploaded blob, regardless of which project or file row it belonged to — used by Clear
  // All Data, which wipes every table and so must also wipe every attachment.
  // Item 4 (second review): this used to catch-and-log a failure here and resolve successfully
  // anyway, so clearAllData() (which awaits this) reported "cleared" while blobs were still
  // sitting in IndexedDB. Let a rejection propagate — callers now decide how to report it rather
  // than being lied to about the outcome.
  async function deleteAllUploads() {
    const entries = await idbGetAllWithPrefix(UPLOAD_KEY + ':');
    for (const { key } of entries) await idbDelete(key);
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
    assertWritable();
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

  /* ---------------- Transactions (G1) ----------------
     Every "rebuild the join rows" save (a booking's attendees/instruments/staff, a milestone's
     owners, a project's team, …) is really several DELETE/INSERT statements in a row, each its
     own run() call. Before this, a throw partway through — an FK violation, a stubbed failure, a
     genuine bug — left whatever ran so far committed and the rest missing: a real half-written
     record with no rollback, exactly the "Known and deferred" gap this closes. DB.transaction(fn)
     wraps such a save's statements in one SQLite transaction: BEGIN before fn() runs, COMMIT if it
     returns normally, ROLLBACK-then-rethrow if it throws — so a half-finished multi-step save
     leaves the row set exactly as it was before the save was attempted, not half of it.

     fn MUST be synchronous and must never span an `await` — see below for why that matters, and
     every caller in app.js (bookingSave, msSave, etc.) only wraps the plain run()/exec() calls
     that come after all of a save's own awaits (file uploads, confirm dialogs, …) resolve.

     Nesting: REJECTED, not handled via SAVEPOINT. A second DB.transaction() call while one is
     already open throws immediately rather than silently starting a nested BEGIN (SQLite itself
     would just error on a literal nested BEGIN, but a savepoint-based scheme would swallow that
     confusion invisibly). None of this codebase's save paths call into another wrapped save
     function today; if one ever needs to, the right fix is one shared transaction() call around
     both, not making transaction() itself re-entrant.

     Is db.export() (called by every autosave, via currentBytes()) safe to run WHILE a transaction
     is open? Investigated and answered: it can never happen, by construction, not because export()
     itself is transaction-aware. markDirty() (called by run() inside fn()) only calls
     scheduleFlush(), which arms a 400ms setTimeout — it never calls flush()/currentBytes()
     synchronously. Because transaction() requires fn to be fully synchronous (no `await` inside
     it), JavaScript's single-threaded run-to-completion means BEGIN, every statement fn() runs,
     and COMMIT/ROLLBACK all execute back-to-back with no yield to the event loop in between — so
     the setTimeout callback that would eventually call flush() cannot fire until AFTER the
     transaction has already resolved one way or the other. There is therefore no instant at which
     an autosave could observe a half-open transaction; enforcing "fn is synchronous" is what makes
     that guarantee hold, so a caller must never turn fn into (or call from) an async function. */
  let inTransaction = false;
  function transaction(fn) {
    assertWritable();
    if (inTransaction) {
      throw new Error('DB.transaction() calls cannot be nested — wrap the whole multi-step save in one transaction instead.');
    }
    inTransaction = true;
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) { /* nothing to roll back if BEGIN itself never completed */ }
      throw e;
    } finally {
      inTransaction = false;
    }
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
    const clamped = Math.min(100, Math.max(0, Number(percent) || 0));
    run('INSERT INTO group_discounts (org, percent) VALUES (?,?) ON CONFLICT(org) DO UPDATE SET percent=excluded.percent', [org, clamped]);
  }
  function listGroupDiscounts() {
    return rows('SELECT org, percent FROM group_discounts ORDER BY org');
  }

  /* ---------------- Pricing tiers (named overhead, replacing the internal/external pair) ----------------
     A pricing tier is just {name, overhead_pct}, retired (not deleted) once anything references it —
     same is_retired/retired_at pattern as people/instruments/grants (see setRetired below, which
     accepts 'pricing_tiers' as a table). A group/lab is assigned AT MOST one tier via group_tiers
     (org TEXT PRIMARY KEY, same precedent as group_discounts — a soft link, no REFERENCES clause,
     matching projects.pi_id/meetings.grant_id). An org with no group_tiers row has no tier, and
     resolveOverheadForOrg falls back to the legacy overhead_internal+overhead_external sum for it —
     that fallback is mandatory, not a migration nicety: it's what keeps every booking under a lab
     nobody has re-assigned pricing identical to before this feature existed. */
  function getTierForOrg(org) {
    if (!org) return null;
    const gt = row('SELECT tier_id FROM group_tiers WHERE org=?', [org]);
    if (!gt || gt.tier_id == null) return null;
    const t = row('SELECT id, overhead_pct FROM pricing_tiers WHERE id=?', [gt.tier_id]);
    if (!t) return null; // orphaned link (shouldn't happen — tiers retire, never delete, once referenced)
    return { tier_id: t.id, overhead_pct: Number(t.overhead_pct) || 0 };
  }
  // The one place a booking's overhead percent is resolved, so app.js's live modal math
  // (recomputeBomTotals) and this file's own seedBooking can never compute it two different ways.
  // Returns the resolved percent PLUS the {tier_id, tier_overhead_pct} pair callers snapshot onto
  // the booking row at save time (both null together ⇒ this booking priced via the legacy fallback).
  function resolveOverheadForOrg(org) {
    const tier = getTierForOrg(org);
    if (tier) return { overheadPct: tier.overhead_pct, tierId: tier.tier_id, tierOverheadPct: tier.overhead_pct };
    const legacyPct = getConfigNum('overhead_internal', 0) + getConfigNum('overhead_external', 0);
    return { overheadPct: legacyPct, tierId: null, tierOverheadPct: null };
  }
  function getGroupTierId(org) {
    if (!org) return null;
    const r = row('SELECT tier_id FROM group_tiers WHERE org=?', [org]);
    return r && r.tier_id != null ? r.tier_id : null;
  }
  // tierId falsy clears the assignment (row deleted, not nulled) — same "absent row" convention
  // instrument_tier_rates uses, so getTierForOrg/getGroupTierId never have to distinguish "no row"
  // from "row present but null".
  function setGroupTier(org, tierId) {
    if (!org) return;
    if (!tierId) { run('DELETE FROM group_tiers WHERE org=?', [org]); return; }
    run('INSERT INTO group_tiers (org, tier_id) VALUES (?,?) ON CONFLICT(org) DO UPDATE SET tier_id=excluded.tier_id', [org, Number(tierId)]);
  }
  function listGroupTiers() {
    return rows('SELECT org, tier_id FROM group_tiers ORDER BY org');
  }
  // Seed-only idempotent upsert by name (pricing_tiers.name is not itself a key — id is a real
  // surrogate key, unlike group_discounts/group_tiers' org PK — so this does a plain check-then-
  // write instead of group_discounts' ON CONFLICT one-liner). Lets seedSampleData re-run without
  // duplicating its 'Internal'/'External' tiers, matching setConfig/setGroupDiscount's re-seed-safe
  // pattern above.
  function upsertPricingTierByName(name, pct) {
    const existing = row('SELECT id FROM pricing_tiers WHERE name=?', [name]);
    if (existing) {
      run("UPDATE pricing_tiers SET overhead_pct=?, is_retired=0, retired_at='' WHERE id=?", [Number(pct) || 0, existing.id]);
      return existing.id;
    }
    run('INSERT INTO pricing_tiers (name, overhead_pct) VALUES (?,?)', [name, Number(pct) || 0]);
    const inserted = row('SELECT last_insert_rowid() as id');
    return inserted ? inserted.id : null;
  }
  /* How much of the app a pricing tier touches, for the retire-vs-delete gate: labs assigned to it
     (group_tiers) and bookings billed with it (meetings.tier_id, a snapshot column). Deliberately
     excludes instrument_tier_rates — a per-tier rate override is current pricing configuration, not
     a historical fact to protect, same reasoning countInstrumentRefs gives for excluding
     instrument_staff. retirePricingTier's zero-ref delete branch still cleans those rows up
     explicitly before deleting, so a rate-overridden-but-otherwise-unused tier can still be deleted
     without leaving orphaned rows. */
  function countTierRefs(id) {
    const r = row(`SELECT
      (SELECT COUNT(*) FROM group_tiers WHERE tier_id=?) AS groups,
      (SELECT COUNT(*) FROM meetings WHERE tier_id=?) AS bookings`, [id, id]) || {};
    const parts = { groups: r.groups || 0, bookings: r.bookings || 0 };
    parts.total = parts.groups + parts.bookings;
    return parts;
  }
  /* The one place that resolves a STORED tier_id to display text (grantLabel's pattern) — every
     caller (the booking modal's summary, views.js's Project Costs card, exports.js's XLSX/DOCX/PDF
     paths) reads this instead of re-deriving "what tier was this" on its own. Unlike grantLabel,
     the "(Retired)" suffix is folded in here rather than left to the caller: every call site only
     has the bare tier_id (a booking snapshot column, not a joined row), so there's no separate
     is_retired flag for a caller to wrap with UI.retiredName itself. '—' covers both a genuinely
     legacy booking (tier_id NULL) and an orphaned id. */
  function tierLabel(tierId, map) {
    if (tierId == null) return '—';
    // `map` (from buildTierLabelMap below) skips the per-call SELECT — an export loop over every
    // booking in the facility used to issue one `row()` query per row just to resolve its tier
    // name; the exact same answer comes from one query read into a Map once, then a lookup here.
    if (map) return map.has(tierId) ? map.get(tierId) : '—';
    const t = row('SELECT name, is_retired FROM pricing_tiers WHERE id=?', [tierId]);
    if (!t) return '—';
    return global.UI.retiredName(t.name, t.is_retired);
  }
  // One query, reused by any export loop that would otherwise call tierLabel(id) once per row
  // (js/exports.js's Meetings/Bookings & Costs sheets, DOCX, PDF). Built once per export, not
  // cached across calls, so a tier renamed mid-session is never read stale.
  function buildTierLabelMap() {
    const map = new Map();
    rows('SELECT id, name, is_retired FROM pricing_tiers').forEach((t) => {
      map.set(t.id, global.UI.retiredName(t.name, t.is_retired));
    });
    return map;
  }

  /* ---------------- Per-tier instrument rate overrides ----------------
     instrument_tier_rates has no REFERENCES to pricing_tiers (tiers retire, never delete while
     referenced, so a dangling tier_id here would only happen if a tier were force-deleted at zero
     refs — see retirePricingTier, which cleans these rows up explicitly in that branch). Absent
     row for a given (instrument, tier) pair ⇒ the instrument's own `cost` column applies, exactly
     as if no tiers existed. */
  function getInstrumentTierRate(instrumentId, tierId) {
    if (!tierId) return null;
    const r = row('SELECT cost FROM instrument_tier_rates WHERE instrument_id=? AND tier_id=?', [instrumentId, tierId]);
    return r ? (Number(r.cost) || 0) : null;
  }
  // The one place a booking's per-instrument cost is resolved against a tier override — shared by
  // app.js's live modal (renderBomRows/recomputeBomTotals) and this file's seedBooking, same
  // reasoning as resolveOverheadForOrg above.
  function resolveInstrumentCost(instrumentId, baseCost, tierId) {
    const override = getInstrumentTierRate(instrumentId, tierId);
    return override != null ? override : baseCost;
  }
  function setInstrumentTierRate(instrumentId, tierId, cost) {
    run('INSERT INTO instrument_tier_rates (instrument_id, tier_id, cost) VALUES (?,?,?) ON CONFLICT(instrument_id, tier_id) DO UPDATE SET cost=excluded.cost',
      [instrumentId, tierId, Number(cost) || 0]);
  }
  function deleteInstrumentTierRate(instrumentId, tierId) {
    run('DELETE FROM instrument_tier_rates WHERE instrument_id=? AND tier_id=?', [instrumentId, tierId]);
  }
  function listInstrumentTierRates(instrumentId) {
    return rows('SELECT tier_id, cost FROM instrument_tier_rates WHERE instrument_id=?', [instrumentId]);
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
      (SELECT COUNT(*) FROM service_entries WHERE person_id=?) AS entries,
      (SELECT COUNT(*) FROM projects WHERE pi_id=?) AS pi`, [id, id, id, id, id, id]) || {};
    const parts = {
      projects: r.projects || 0, milestones: r.milestones || 0,
      bookings: r.bookings || 0, staffed: r.staffed || 0, entries: r.entries || 0, pi: r.pi || 0
    };
    parts.total = parts.projects + parts.milestones + parts.bookings + parts.staffed + parts.entries + parts.pi;
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
      (SELECT COUNT(*) FROM meeting_instruments WHERE instrument_id=?) AS bookings,
      (SELECT COUNT(*) FROM service_entries WHERE instrument_id=?) AS entries`,
      [id, id, id, id]) || {};
    const parts = {
      projects: r.projects || 0, milestones: r.milestones || 0, bookings: r.bookings || 0, entries: r.entries || 0
    };
    parts.total = parts.projects + parts.milestones + parts.bookings + parts.entries;
    return parts;
  }
  // `billed` follows the same Project Costs rule as views.js/reports.js (CLAUDE.md: "a row counts
  // unless is_cancelled && !billing_retained") — a cancelled-and-waived booking or service entry
  // bills 0 on that screen, so the Archive dialog quoting a different (raw) figure here would be
  // telling the admin a project "carries" money that Project Costs itself shows as zero.
  function countProjectRefs(id) {
    const r = row(`SELECT
      (SELECT COUNT(*) FROM project_people WHERE project_id=?) AS team,
      (SELECT COUNT(*) FROM project_instruments WHERE project_id=?) AS instruments,
      (SELECT COUNT(*) FROM milestones WHERE project_id=?) AS milestones,
      (SELECT COUNT(*) FROM meetings WHERE project_id=?) AS bookings,
      (SELECT COUNT(*) FROM service_entries WHERE project_id=?) AS entries,
      (SELECT COUNT(*) FROM files WHERE project_id=?) AS files,
      (SELECT COUNT(*) FROM kv WHERE project_id=?) AS fields,
      (SELECT COUNT(*) FROM project_outputs WHERE project_id=?) AS outputs,
      (SELECT COALESCE(SUM(CASE WHEN is_cancelled=1 AND billing_retained=0 THEN 0 ELSE total_cost END),0) FROM meetings WHERE project_id=?) AS billed,
      (SELECT COALESCE(SUM(CASE WHEN is_cancelled=1 AND billing_retained=0 THEN 0 ELSE total_cost END),0) FROM service_entries WHERE project_id=?) AS entriesBilled`,
      [id, id, id, id, id, id, id, id, id, id]) || {};
    const parts = {
      team: r.team || 0, instruments: r.instruments || 0, milestones: r.milestones || 0,
      bookings: r.bookings || 0, entries: r.entries || 0, files: r.files || 0, fields: r.fields || 0,
      outputs: r.outputs || 0,
      billed: (Number(r.billed) || 0) + (Number(r.entriesBilled) || 0)
    };
    parts.total = parts.team + parts.instruments + parts.milestones + parts.bookings + parts.entries + parts.files + parts.fields + parts.outputs;
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

  /* Rebuilds ONE meeting's denormalized `attendees` display string from meeting_people — the
     single source of truth for who was actually there. Exists so every writer of `people.name`
     (today, just pEditSave) can keep the two in sync per CLAUDE.md's "denormalized display string
     + join table must both be written on every save", the same way bookingSave/bookingEditSave
     already do for a booking's own attendee edits. */
  function refreshAttendeesForMeeting(meetingId) {
    const names = rows(
      `SELECT p.name AS name FROM meeting_people mp JOIN people p ON p.id = mp.person_id WHERE mp.meeting_id=?`,
      [meetingId]
    ).map((r) => r.name).join(', ');
    run('UPDATE meetings SET attendees=? WHERE id=?', [names, meetingId]);
  }
  // Every meeting a person is on, recomputed — call this after ANY write to people.name so a
  // rename can never leave meetings.attendees stale (it drifted silently until this existed:
  // pEditSave updated people.name only, and every export/list kept showing the old name).
  function refreshAttendeesForPerson(personId) {
    rows('SELECT DISTINCT meeting_id FROM meeting_people WHERE person_id=?', [personId])
      .forEach((r) => refreshAttendeesForMeeting(r.meeting_id));
  }

  /* How much of the app a grant touches: projects billed against it and bookings billed against
     it (both via a nullable, REFERENCES-less grant_id column — see the migrate() comment for why).
     Zero references means there's nothing to preserve, so retireGrant offers a real delete instead
     of retirement, same rule as countPersonRefs/countInstrumentRefs/countProjectRefs above. */
  function countGrantRefs(id) {
    const r = row(`SELECT
      (SELECT COUNT(*) FROM projects WHERE grant_id=?) AS projects,
      (SELECT COUNT(*) FROM meetings WHERE grant_id=?) AS bookings,
      (SELECT COUNT(*) FROM service_entries WHERE grant_id=?) AS entries`, [id, id, id]) || {};
    const parts = { projects: r.projects || 0, bookings: r.bookings || 0, entries: r.entries || 0 };
    parts.total = parts.projects + parts.bookings + parts.entries;
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
  /* Same idea as setBookingCancelled above, applied to a standalone service entry: no before/
     after-start timing rule (an entry is logged retrospectively, not scheduled), so the caller
     decides directly whether the charge still stands. */
  function setServiceEntryCancelled(id, cancelled, retained) {
    if (cancelled) {
      run("UPDATE service_entries SET is_cancelled=1, cancelled_at=datetime('now'), billing_retained=? WHERE id=?",
        [retained ? 1 : 0, id]);
    } else {
      run("UPDATE service_entries SET is_cancelled=0, cancelled_at='', billing_retained=0 WHERE id=?", [id]);
    }
  }
  function setProjectArchived(id, archived) {
    if (archived) {
      run("UPDATE projects SET is_archived=1, archived_at=datetime('now'), updated_at=datetime('now') WHERE id=?", [id]);
    } else {
      run("UPDATE projects SET is_archived=0, archived_at='', updated_at=datetime('now') WHERE id=?", [id]);
    }
  }
  // table is 'people', 'instruments', 'grants' or 'pricing_tiers' — nothing else is retirable.
  function setRetired(table, id, retired) {
    if (table !== 'people' && table !== 'instruments' && table !== 'grants' && table !== 'pricing_tiers') return;
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
    rows("SELECT DISTINCT org FROM group_tiers WHERE org IS NOT NULL AND TRIM(org) != ''").forEach((r) => set.add(r.org));
    rows("SELECT DISTINCT group_org as org FROM meetings WHERE group_org IS NOT NULL AND TRIM(group_org) != ''").forEach((r) => set.add(r.org));
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // How much of the app a lab name touches, for the rename/merge confirm dialog: people rows
  // that would be relabeled, bookings whose saved group snapshot would be relabeled, and whether
  // it carries a standing discount row or a pricing tier assignment.
  function countOrgRefs(org) {
    const peopleCount = (row('SELECT COUNT(*) as c FROM people WHERE organization=?', [org]) || {}).c || 0;
    const bookingsCount = (row('SELECT COUNT(*) as c FROM meetings WHERE group_org=?', [org]) || {}).c || 0;
    const hasDiscount = !!row('SELECT 1 as x FROM group_discounts WHERE org=?', [org]);
    const hasTier = !!row('SELECT 1 as x FROM group_tiers WHERE org=?', [org]);
    return { peopleCount, bookingsCount, hasDiscount, hasTier };
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
    // Same PK-collision-as-merge reasoning as group_discounts just below, applied to group_tiers.
    const oldTier = row('SELECT tier_id FROM group_tiers WHERE org=?', [oldName]);
    const targetHadTier = !!row('SELECT 1 as x FROM group_tiers WHERE org=?', [newName]);
    const tierMerged = !!(oldTier && targetHadTier);
    // The ORG vocab table (facility-registered "+ Add New" lab names, listed by orgNames()) is
    // ANOTHER place this name lives, independent of people/discounts/tiers — a lab entered via
    // vocab but not yet assigned to anyone would otherwise still show the old name in every
    // Lab/Group/Company picker after a rename. category/value carries a UNIQUE constraint, so a
    // rename that collides with an existing vocab entry for newName is a merge (drop the old row)
    // exactly like group_discounts/group_tiers above, not a raced UPDATE.
    const oldVocab = !!row("SELECT 1 as x FROM vocab WHERE category='ORG' AND value=?", [oldName]);
    const targetHadVocab = !!row("SELECT 1 as x FROM vocab WHERE category='ORG' AND value=?", [newName]);
    const vocabMerged = !!(oldVocab && targetHadVocab);

    // G1: a rename touches up to four tables (people, meetings, group_discounts/group_tiers,
    // vocab) — wrapped so a throw partway through can never leave some of them renamed to newName
    // and others still reading oldName.
    return transaction(() => {
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

      let tierMoved = false;
      if (oldTier) {
        if (targetHadTier) {
          // Merge: the destination's own tier assignment wins; drop the source row rather than
          // fight it for the org primary key.
          run('DELETE FROM group_tiers WHERE org=?', [oldName]);
        } else {
          run('UPDATE group_tiers SET org=? WHERE org=?', [newName, oldName]);
          tierMoved = true;
        }
      }

      let vocabMoved = false;
      if (oldVocab) {
        if (targetHadVocab) {
          run("DELETE FROM vocab WHERE category='ORG' AND value=?", [oldName]);
        } else {
          run("UPDATE vocab SET value=? WHERE category='ORG' AND value=?", [newName, oldName]);
          vocabMoved = true;
        }
      }

      return {
        peopleCount, bookingsCount, discountMoved, merged, hadDiscount: !!oldDiscount,
        tierMoved, tierMerged, hadTier: !!oldTier,
        vocabMoved, vocabMerged, hadVocab: oldVocab
      };
    });
  }

  /* ---------------- Sample Data Seeding & Database Reset ---------------- */
  async function clearAllData() {
    assertWritable();
    db.exec(`
      DELETE FROM project_people;
      DELETE FROM project_instruments;
      DELETE FROM instrument_staff;
      DELETE FROM instrument_tier_rates;
      DELETE FROM milestone_owners;
      DELETE FROM milestone_instruments;
      DELETE FROM milestones;
      DELETE FROM meeting_people;
      DELETE FROM meeting_instruments;
      DELETE FROM meeting_staff;
      DELETE FROM meetings;
      DELETE FROM service_entries;
      DELETE FROM grant_users;
      DELETE FROM grants;
      DELETE FROM files;
      DELETE FROM kv;
      DELETE FROM project_outputs;
      DELETE FROM projects;
      DELETE FROM people;
      DELETE FROM instruments;
    `);
    try {
      // Reset AUTOINCREMENT counters so re-seeding starts IDs from 1 again;
      // otherwise seedSampleData's hardcoded cross-references (e.g. milestone.project_id)
      // point at IDs that no longer match once counters have advanced past a prior seed/clear.
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('projects','people','instruments','milestones','meetings','files','kv','grants','service_entries','project_outputs')");
    } catch (_) { /* sqlite_sequence doesn't exist yet on a brand-new, never-inserted-into database */ }
    // M9: every attachment blob this database ever held is now orphaned (its `files` row is
    // gone above) — without this they lingered in IndexedDB forever and kept shipping inside
    // every future backup. clearAllData() is now async specifically so callers CAN await this —
    // a caller that reports "cleared" before the blobs actually finish deleting would let a user
    // re-seed/reload while stale uploads are still being wiped underneath them.
    await deleteAllUploads();
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

    // resolveOverheadForOrg reads group_tiers (falling back to the legacy overhead_internal/
    // overhead_external sum) — same one place app.js's recomputeBomTotals resolves it, so a
    // seeded booking can never price differently than the live modal would for the same group.
    const resolvedOverhead = resolveOverheadForOrg(groupOrg);

    const instRows = instruments.length
      ? rows(`SELECT id, cost, cost_unit FROM instruments WHERE id IN (${instruments.map(() => '?').join(',')})`, instruments.map((i) => i.id))
      : [];
    const instrumentsForCalc = instRows.map((r) => {
      const s = instruments.find((i) => i.id === r.id) || {};
      // A tier's per-instrument rate override (instrument_tier_rates), when present, replaces the
      // instrument's own cost — same resolution renderBomRows/recomputeBomTotals apply live.
      return { id: r.id, cost: resolveInstrumentCost(r.id, r.cost, resolvedOverhead.tierId), cost_unit: r.cost_unit, amount: s.amount || 0 };
    });

    const staffRows = staff.length
      ? rows(`SELECT id, rate FROM people WHERE id IN (${staff.map(() => '?').join(',')})`, staff.map((s) => s.id))
      : [];
    const staffForCalc = staffRows.map((r) => {
      const s = staff.find((x) => x.id === r.id) || {};
      return { id: r.id, rate: r.rate, start: s.start || '', end: s.end || '' };
    });

    // getGroupDiscount/getConfigNum read the app_config/group_discounts rows the real Settings
    // screen reads — which is exactly why those (and the pricing tiers resolveOverheadForOrg reads)
    // are seeded BEFORE any seedBooking() call below; reading them from empty tables here would
    // silently compute every booking at 0% discount and 0% overhead/tax.
    const groupPct = getGroupDiscount(groupOrg);
    const rates = {
      overheadPct: resolvedOverhead.overheadPct,
      taxPct: getConfigNum('tax_pct', 0)
    };
    // Same one place (categoryPolicy) app.js's recomputeBomTotals resolves this from, so a seeded
    // booking can never bill staff time differently than the live modal would for the same
    // category. Every seeded category defaults to 100% (see seedDefaultCategoryPolicies), so this
    // is a no-op factor of 1 unless a caller's own seed data has edited category_policies —
    // seedSampleData never does, which is exactly why its cost regression triple stays valid.
    const catPolicy = categoryPolicy(category);
    const staffPctFactor = (Number(catPolicy.staff_pct) || 0) / 100;
    const bom = global.UI.computeBookingBOM({ start, end, instruments: instrumentsForCalc, staff: staffForCalc, groupPct, manualPct: 0, rates, staffPctFactor });

    const attendees = peopleIds.length
      ? rows(`SELECT name FROM people WHERE id IN (${peopleIds.map(() => '?').join(',')})`, peopleIds).map((r) => r.name).join(', ')
      : '';

    const isCancelled = !!(cancelled && cancelled.cancelled !== false);
    run(`INSERT INTO meetings (project_id, grant_id, title, date, start_time, end_time, attendees, note, actions,
          discount_pct, group_org, group_discount_pct, subtotal, total_before_tax, total_cost,
          is_cancelled, cancelled_at, billing_retained, category, tier_id, tier_overhead_pct, category_staff_pct)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      projectId, grantId, title, date, start, end, attendees, note, actions,
      0, groupOrg, groupPct, bom.subtotal, bom.beforeTax, bom.total,
      isCancelled ? 1 : 0,
      // Full timestamp, not a calendar day — toISOString() is the right tool here (see CLAUDE.md).
      isCancelled ? new Date().toISOString() : '',
      isCancelled && cancelled.retained ? 1 : 0,
      category, resolvedOverhead.tierId, resolvedOverhead.tierOverheadPct, catPolicy.staff_pct
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

  async function seedSampleData({ force = false } = {}) {
    // Hard refusal, deliberately placed as the first statement of the destructive function itself
    // rather than left to whatever calls it. A check at the call site only makes the call
    // *currently unused* outside the sandbox; a guard here makes the destructive path itself
    // *unreachable* outside the sandbox, so a future stray call — a new button, a mis-merge, a
    // console invocation, a copy-pasted onClick — cannot wipe a real facility's data no matter
    // where it comes from. The user's requirement is emphatic: demo data never deletes user input
    // data, ever. Note this only protects the *seed*; the surrounding IDB_NAME split above is what
    // keeps the demo database itself distinct from a real one in the first place.
    if (!global.IS_DEMO) {
      console.error('seedSampleData() refused: not running in demo mode (window.IS_DEMO is false). Sample data can only be seeded into the isolated demo database (?demo=1).');
      return false;
    }

    // Re-seeding an already-populated sandbox would throw (projects.code is UNIQUE, and
    // milestones.id values are inserted explicitly below) unless the caller explicitly asks for a
    // reset. clearAllData() is safe to call here because IS_DEMO already guarantees this is the
    // demo database, never a real facility's.
    if (!force && hasAnyDataLocal()) return true;

    await clearAllData();

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

    // 2. Instruments (cost_unit 'time' = price/hour; other units price per amount entered on a booking).
    // Trailing 4 columns are booking constraints (min/max duration mins, min gap mins, min notice
    // hours) — 0 = unconstrained. Olympus FV3000 carries a min/max session length, Nikon AX R a
    // minimum gap between bookings, Zeiss Lightsheet a minimum advance-notice window; Glacios is left
    // unconstrained on duration since its seed data includes a 45-minute consult.
    const instData = [
      ['Leica SP8 FALCON', 'FLIM / Confocal', 'Available', 'Room 118', 'Fluorescence lifetime imaging, White Light Laser 470-670nm + 405nm', 120, 'time', 0, 0, 0, 0],
      ['Olympus FV3000', 'Multiphoton / Confocal', 'In-use', 'Room 204', 'High-sensitivity spectral GaAsP detectors, heated stage chamber', 150, 'time', 60, 480, 0, 0],
      ['Zeiss Lightsheet Z.1', 'Lightsheet (Volume)', 'Available', 'Room 210', 'Dual-side illumination for cleared tissue & whole organ 3D imaging', 200, 'time', 0, 0, 0, 24],
      ['Nikon AX R Resonant', 'Resonant Confocal', 'Available', 'Room 212', '2K x 2K resonant scanning for high-speed calcium dynamics', 100, 'time', 0, 0, 30, 0],
      ['Glacios Cryo-TEM', 'Cryo-EM', 'Maintenance', 'Room B14', '200kV autoloader - undergoing routine monthly beam alignment', 45, 'unit', 0, 0, 0, 0]
    ];
    for (const i of instData) {
      run('INSERT INTO instruments (name, kind, status, location, note, cost, cost_unit, min_duration_mins, max_duration_mins, min_gap_mins, min_notice_hours) VALUES (?,?,?,?,?,?,?,?,?,?,?)', i);
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

    // 3b. Backdated created_at (roadmap 3.3 funnel — see the rejection note this fixes below).
    // Every INSERT above stamped created_at at datetime('now') (the schema default), which would
    // put each project's "created" event AFTER its own first booking below (bookings are dated
    // day(-100)..day(-1), i.e. in the past) — a negative created->first-booking delta on every
    // single seed project. That's honest for a truly backfilled/imported project, but it would
    // leave the funnel's median time-in-stage permanently empty on fresh sample data, which is
    // its own kind of misleading demo. So each project's created_at is set here to a few days
    // BEFORE its own first seed booking (see the day() offsets on each seedBooking() call below):
    // project 1's first booking is day(-95), project 2's is day(-70), project 3's is day(-100).
    // Uses UPDATE (not a column on the INSERT above) so the offset stays visibly tied to the
    // booking dates it has to precede, rather than a second copy of "day(-100)" duplicated with
    // no visible connection between the two. Does not touch any booking, so seed booking #1's
    // cost triple is unaffected.
    run(`UPDATE projects SET created_at = ? WHERE id = 1`, [day(-100) + ' 09:00:00']);
    run(`UPDATE projects SET created_at = ? WHERE id = 2`, [day(-75) + ' 09:00:00']);
    run(`UPDATE projects SET created_at = ? WHERE id = 3`, [day(-105) + ' 09:00:00']);

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
    // M5: the demo database goes through boot()'s fresh-DB branch too (see the comment there),
    // which already sets this — but seedSampleData can also run via Settings > Load Sample Data
    // (force reset) against a demo DB restored from an older backup made before that fresh-DB
    // fix existed. Setting it again here, right where the legacy overhead values it guards
    // against re-seeding from are (re)written, keeps a later migrate() from recreating tiers a
    // facility deliberately deleted, on every path that writes these two config values.
    setConfig('pricing_tiers_seeded', 1);
    setGroupDiscount('Bio-Photonics Lab', 5); // only lab with a standing discount, on purpose —
    // Neural Dynamics Institute and Therapeutics & Onco-Therapy deliberately have none, so
    // Reports' By Lab/Group table shows a real contrast, not three identical discounted rows.

    // 7b. Pricing tiers (roadmap 2.2) — upsertPricingTierByName so re-running Load Sample Data
    // doesn't duplicate these (pricing_tiers, like app_config/group_discounts above, is facility
    // settings clearAllData deliberately leaves alone). 'Internal'/10 and 'External'/5 mirror the
    // legacy overhead_internal/overhead_external values above so the tier system starts from
    // exactly the same numbers the old binary pair used.
    // Bio-Photonics Lab is deliberately LEFT UNASSIGNED here — booking #1 below depends on it
    // still pricing via the legacy overhead_internal+overhead_external fallback (10%+5%=15%) for
    // the documented 490 / 546.25 / 589.95 regression triple to keep holding. Neural Dynamics
    // Institute is assigned the 'Internal' tier instead, so Reports/Settings show one lab actually
    // using the new tier system (flat 10%) alongside two still on the legacy fallback (15%) —
    // real contrast, not three identical rows, same reasoning as the group-discount comment above.
    const internalTierId = upsertPricingTierByName('Internal', 10);
    upsertPricingTierByName('External', 5);
    setGroupTier('Neural Dynamics Institute', internalTierId);

    // 8. Meetings (start_time/end_time drive calendar display + instrument/staff conflict checks;
    // every booking below goes through seedBooking(), which calls the exact same
    // UI.computeBookingBOM() the booking modal uses — see the helper above seedSampleData for how
    // subtotal/total_before_tax/total_cost are derived). 13 bookings, chosen to exercise every
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
    // — and the roadmap's other consult modality: a booking with the core member's time billed
    // retroactively (1-hour floor), attributed to the instrument it was about via
    // meeting_instruments (amount 0 ⇒ no per-grid charge — only Priya's time is billed). This is
    // the seed row that gives the Consults report's per-instrument panel something to show.
    seedBooking({
      projectId: 3,
      grantId: 3, // Islet Imaging State Grant — matches project 3's own grant
      title: 'Vitrification Troubleshooting Consult',
      date: day(-60), start: '14:00', end: '14:45',
      instruments: [{ id: 5 }], // Glacios Cryo-TEM — what the consult was about; 0 units billed
      staff: [{ id: 7 }], // Dr. Priya Anand — 45 min, billed at the 1-hour floor
      peopleIds: [3, 7], // Sarah Lin, Priya Anand
      groupOrg: 'Therapeutics & Onco-Therapy',
      note: 'Walked through blot-force and humidity settings after repeated thin-ice failures on islet grids.',
      actions: 'Priya\'s time billed retroactively per facility consult policy; new plunge parameters logged on the instrument sheet.',
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

    // #11 — training category (roadmap 3.4 seed): no training-category booking existed before
    // this, so the Activity Mix report's training segment would never have anything to show.
    // category_policies seeds training with requires_staff=1, so this needs a staff assignee (Dr.
    // Priya Anand, the Cryo-EM specialist) even though only her time — not the instrument — is
    // billed at the training rate. day(-50) on the Zeiss Lightsheet Z.1 (instrument id 3) is a
    // date+instrument combination no other seed booking touches (Z.1's only other booking is
    // day(-30)), so this cannot overlap despite seed inserts bypassing the conflict gate.
    seedBooking({
      projectId: 3,
      title: 'New User Training: Zeiss Lightsheet Z.1 Acquisition Basics',
      date: day(-50), start: '09:00', end: '10:30',
      instruments: [{ id: 3 }], // Zeiss Lightsheet Z.1
      staff: [{ id: 7 }], // Dr. Priya Anand
      peopleIds: [3, 7], // Sarah Lin, Priya Anand
      groupOrg: 'Therapeutics & Onco-Therapy',
      note: 'Walked Sarah through sample mounting, chamber refractive-index matching, and multi-view acquisition setup on the Z.1.',
      actions: '',
      category: 'training'
    });

    // #12 — facility-wide (project_id NULL) CONSULT: the seed dataset previously had a
    // facility-wide booking (#6) but it was tagged 'assisted session', not 'consult', so
    // Consult Volume / computeFunnelRows' consult stage had no fixture demonstrating that a
    // facility-wide consult (never linked to any project) still counts toward volume. day(-20)
    // with no instrument/staff line avoids any overlap with existing seed bookings.
    seedBooking({
      projectId: null,
      title: 'Walk-in Consult: Choosing an Imaging Modality for a New Grant',
      date: day(-20), start: '11:00', end: '11:30',
      peopleIds: [6], // David Kim
      note: 'General walk-in consult with a PI who has not yet started a project, discussing which core instrument would suit a planned new grant.',
      actions: 'Sent follow-up reading on confocal vs. lightsheet tradeoffs; no project opened yet.',
      category: 'consult'
    });

    // 8b. Standalone Service Entries (roadmap 2.3) — billable work logged outside any booking,
    // following the exact same Project Costs counting rule as a booking's cost snapshot. Priced
    // from the seeded people rows above, not invented numbers: Tom Alvarez (person id 8) is
    // seeded at $80/hr (see peopleData above), so 2 hours of retroactive image-analysis support
    // on project 1 (grant 1 — CAR-T Immunology R01, matching that project's own grant) totals
    // $160. The second is a per-sample prep charge — a different unit (samples, not hours), so it
    // is deliberately NOT priced off anyone's hourly rate — attributed to project 3 and to David
    // Kim (person id 6), already that project's Core Facility Support team member (see
    // project_people above).
    run(`INSERT INTO service_entries (project_id, grant_id, person_id, date, description, qty, unit, rate, total_cost)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      [1, 1, 8, day(-2), 'Retroactive image analysis support (Imaris batch reprocessing)', 2, 'hour', 80, 160]);
    run(`INSERT INTO service_entries (project_id, person_id, date, description, qty, unit, rate, total_cost)
         VALUES (?,?,?,?,?,?,?,?)`,
      [3, 6, day(-20), 'CUBIC-cleared islet sample preparation (per-sample fee)', 5, 'sample', 20, 100]);

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

    // 11. Project Outputs (roadmap 3.3) — the funnel's exit stage. Project 3 (Completed, first
    // booking day(-100)) gets a publication and a later acknowledgement, so both the
    // first-booking->first-output median and the "output" stage itself have something real to
    // show. Project 1 (still Active) gets a dataset deposit — outputs aren't only for finished
    // projects. Project 2 deliberately gets none, so the funnel's created->output conversion is
    // visibly less than 100%, same as any honest funnel.
    run(`INSERT INTO project_outputs (project_id, type, title, reference, date) VALUES (3, 'publication', 'Volumetric mapping of pancreatic islet distribution in cleared murine tissue', 'J. Endocrine Imaging 12(3):200-214', ?)`, [day(-40)]);
    run(`INSERT INTO project_outputs (project_id, type, title, reference, date) VALUES (3, 'acknowledgement', 'Core facility acknowledged in State Health Initiative renewal report', 'State Health Initiative #4401 — Year 2 progress report', ?)`, [day(-10)]);
    run(`INSERT INTO project_outputs (project_id, type, title, reference, date) VALUES (1, 'dataset', 'Intravital CAR-T 4D time-lapse volumes (raw + segmented)', 'NAS-Bioimaging-Vol4 dataset DOI pending', ?)`, [day(-1)]);

    markDirty();
    return true;
  }

  // Same emptiness check as js/app.js's hasAnyData(), duplicated locally rather than reaching
  // across module boundaries: db.js is loaded before app.js (see CLAUDE.md's module load order),
  // so app.js's helper isn't available here to call. Used only to decide whether an unforced
  // seedSampleData() call should skip re-seeding a sandbox that already has rows.
  function hasAnyDataLocal() {
    const r = row(`SELECT
      (SELECT COUNT(*) FROM projects) + (SELECT COUNT(*) FROM people) + (SELECT COUNT(*) FROM instruments) +
      (SELECT COUNT(*) FROM meetings) + (SELECT COUNT(*) FROM milestones) + (SELECT COUNT(*) FROM grants) +
      (SELECT COUNT(*) FROM service_entries) + (SELECT COUNT(*) FROM project_outputs) + (SELECT COUNT(*) FROM files)
      as c`);
    return !!(r && r.c);
  }

  // The "effective date" of a research output: its own `date` when set, else the
  // calendar day it was logged. `project_outputs.date` is OPTIONAL and the UI
  // falls back to `created_at` when it is blank, so every ordering and range
  // filter must use this expression -- otherwise a blank-dated output sorts to
  // the bottom of a list that displays it with a recent timestamp.
  //
  // It lives here, not in reports.js, because views.js loads first and needs it
  // too. One definition is what stops the funnel, the project screen and the
  // three export paths from quietly disagreeing about the same rows -- the same
  // reasoning that keeps UI.billableStaffHours out of app.js and reports.js.
  //
  // Same UTC/local caveat the funnel already documents: created_at is a UTC
  // timestamp while `date` is a local calendar day, so at UTC+ offsets the
  // fallback can read one day early. Ordering only, and strictly better than
  // sorting every undated row last.
  function outputEffDate(alias) {
    const a = alias ? alias + '.' : '';
    return `CASE WHEN TRIM(COALESCE(${a}date,'')) != '' THEN ${a}date ELSE date(${a}created_at) END`;
  }

  global.DB = {
    boot,
    get memoryMode() { return memoryMode; },
    get isDemo() { return !!global.IS_DEMO; },
    currentBytes,
    markDirty,
    flushNow,
    get isReadOnly() { return multiTabGuard.isReadOnly(); },
    buildBackup,
    restoreBackup,
    inspectBackupCandidate,
    liveSummary,
    saveUpload,
    getUpload,
    deleteUpload,
    deleteUploads,
    saveAutoBackupDirHandle,
    getAutoBackupDirHandle,
    clearAutoBackupDirHandle,
    rows,
    outputEffDate,
    row,
    q,
    q1,
    run,
    transaction,
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
    getTierForOrg,
    resolveOverheadForOrg,
    getGroupTierId,
    setGroupTier,
    listGroupTiers,
    upsertPricingTierByName,
    countTierRefs,
    tierLabel,
    buildTierLabelMap,
    getInstrumentTierRate,
    resolveInstrumentCost,
    setInstrumentTierRate,
    deleteInstrumentTierRate,
    listInstrumentTierRates,
    getCategoryPolicyRaw,
    categoryPolicy,
    setCategoryPolicy,
    countPersonRefs,
    countInstrumentRefs,
    countProjectRefs,
    countGrantRefs,
    grantLabel,
    setProjectArchived,
    countBookingRefs,
    refreshAttendeesForMeeting,
    refreshAttendeesForPerson,
    setBookingCancelled,
    setServiceEntryCancelled,
    setRetired,
    listAllOrgNames,
    countOrgRefs,
    renameOrganization,
    seedSampleData,
    clearAllData
  };

})(window);
