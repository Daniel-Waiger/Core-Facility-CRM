/* app.js — router, modals with inline person creation, collapsible sidebar & action dispatcher */
(function (global) {
  'use strict';
  const Views = global.Views, UI = global.UI, DB = global.DB, Exports = global.Exports;
  const C = global.CONST, esc = UI.esc, ic = UI.icon;
  const ctx = { route: 'dashboard', project: null };

  global.App = {
    boot: boot,
    route: route,
    refresh: refresh,
    get project() { return ctx.project; },
    onSaving() { UI.setSavedState('pending'); },
    onSaved() { UI.setSavedState('saved'); },
  };

  const TITLES = {
    dashboard: 'Dashboard',
    projects: 'Projects Registry',
    project: 'Project Details',
    people: 'People, Labs &amp; Researchers',
    instruments: 'Core Instruments',
    calendar: 'Schedule &amp; Milestones',
    settings: 'Settings &amp; Portable Data'
  };

  /* ---------------- Shell ---------------- */
  function renderShell() {
    const isCollapsed = localStorage.getItem('sidebar-collapsed') === '1';

    document.getElementById('app').innerHTML = `
      <div class="app">
        <aside class="sidebar ${isCollapsed ? 'collapsed' : ''}" id="app-sidebar">
          <div class="brand">
            <div class="logo">${ic('cpu')}</div>
            <div style="min-width:0">
              <div class="name">Core Tracker</div>
              <div class="sub">Bioimaging Facility</div>
            </div>
            <button class="sidebar-collapse-btn" data-act="toggle-sidebar" data-tooltip="Toggle Sidebar Width">
              ${ic('collapse')}
            </button>
          </div>
          <nav class="nav">
            <div class="nav-item" data-nav="dashboard" data-tooltip="Overview &amp; Metrics">${ic('home')}<span class="lbl">Dashboard</span></div>
            <div class="nav-item" data-nav="projects" data-tooltip="Project Registry">${ic('folder')}<span class="lbl">Projects</span></div>
            <div class="nav-item" data-nav="people" data-tooltip="Researchers &amp; Labs">${ic('users')}<span class="lbl">People &amp; Labs</span></div>
            <div class="nav-item" data-nav="instruments" data-tooltip="Facility Equipment">${ic('cpu')}<span class="lbl">Instruments</span></div>
            <div class="nav-item" data-nav="calendar" data-tooltip="Monthly Schedule">${ic('calendar')}<span class="lbl">Calendar</span></div>
            <div class="nav-item" data-nav="settings" data-tooltip="Backups &amp; Config">${ic('settings')}<span class="lbl">Settings</span></div>
          </nav>
          <div class="nav-spacer"></div>
          <div class="sidebar-foot">
            <button class="btn btn-primary btn-sm" data-act="new-project" data-tooltip="Initiate Project">${ic('plus')}<span class="lbl">New Project</span></button>
            <button class="btn btn-ghost btn-sm" data-act="tour" data-tooltip="Interactive Tour">${ic('play')}<span class="lbl">Tour</span></button>
            <button class="btn btn-secondary btn-sm sidebar-theme-btn" data-act="theme-toggle" data-tooltip="Switch Appearance"></button>
          </div>
        </aside>
        <div class="main">
          <div class="topbar">
            <span class="title" id="page-title">Dashboard</span>
            <div class="grow"></div>
            <span class="saved-dot" id="saved-state" data-tooltip="Real-time SQLite autosave status"><span class="dot"></span><span class="txt">Saved</span></span>
          </div>
          <div class="main-inner" id="view"></div>
        </div>
      </div>`;

    document.querySelectorAll('[data-nav]').forEach((n) => (n.onclick = () => route(n.dataset.nav)));
    UI.updateThemeToggleButtons(document.documentElement.getAttribute('data-theme') || 'light');
  }

  function toggleSidebar() {
    const sb = document.getElementById('app-sidebar');
    if (!sb) return;
    sb.classList.toggle('collapsed');
    const isCollapsed = sb.classList.contains('collapsed');
    localStorage.setItem('sidebar-collapsed', isCollapsed ? '1' : '0');
    const collapseBtn = sb.querySelector('.sidebar-collapse-btn');
    if (collapseBtn) collapseBtn.innerHTML = ic(isCollapsed ? 'expand' : 'collapse');
  }

  /* ---------------- Routing ---------------- */
  function route(name, id) {
    ctx.route = name;
    ctx.project = id ? Number(id) : null;
    document.querySelectorAll('[data-nav]').forEach((n) => n.classList.toggle('active', n.dataset.nav === name));
    document.getElementById('page-title').innerHTML = TITLES[name] || 'Dashboard';
    renderView();
  }

  function renderView() {
    const v = document.getElementById('view');
    const { route: name, project: id } = ctx;
    v.innerHTML =
      name === 'project' ? Views.projectDetail(id) :
      name === 'projects' ? Views.projects() :
      name === 'dashboard' ? Views.dashboard() :
      name === 'people' ? Views.people() :
      name === 'instruments' ? Views.instruments() :
      name === 'calendar' ? Views.calendar() :
      name === 'settings' ? Views.settings() : '';

    if (name === 'projects') {
      const searchInput = document.getElementById('proj-search');
      if (searchInput) searchInput.oninput = (e) => Views.setProjectFilter({ query: e.target.value });
      const stFilter = document.getElementById('proj-status-filter');
      if (stFilter) stFilter.onchange = (e) => Views.setProjectFilter({ status: e.target.value });
      const prFilter = document.getElementById('proj-priority-filter');
      if (prFilter) prFilter.onchange = (e) => Views.setProjectFilter({ priority: e.target.value });
      const modFilter = document.getElementById('proj-modality-filter');
      if (modFilter) modFilter.onchange = (e) => Views.setProjectFilter({ modality: e.target.value });
    }
  }

  function refresh() { renderView(); }

  /* ---------------- Boot ---------------- */
  async function boot() {
    await DB.boot();
    UI.initTheme();
    renderShell();
    route('dashboard');
    wireGlobal();
    if (!localStorage.getItem('seen-tour')) {
      localStorage.setItem('seen-tour', '1');
      startTour();
    }
  }

  /* ---------------- Global Event Delegation ---------------- */
  function wireGlobal() {
    document.addEventListener('click', (e) => {
      const goto = e.target.closest('[data-goto]');
      if (goto && !e.target.closest('[data-act]')) {
        route(goto.dataset.goto, goto.dataset.id);
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act) handleAct(act.dataset.act, act);
    });
  }

  function handleAct(act, el) {
    switch (act) {
      case 'toggle-sidebar': return toggleSidebar();
      case 'theme-toggle': return UI.toggleTheme();
      case 'tour': return startTour();
      case 'backup': return doBackup();
      case 'restore': return doRestore();
      case 'cal-prev': return Views.navCalendar(-1);
      case 'cal-next': return Views.navCalendar(1);
      case 'cal-today': return Views.navCalendar(0);
      case 'close': {
        const m = document.querySelector('.modal');
        if (m) UI.closeDim(m.closest('.modal-dim'));
        return;
      }

      // Projects CRUD
      case 'new-project': return newProject();
      case 'np-save': return npSave();
      case 'edit-project': return editProject(el.dataset.id || ctx.project);
      case 'ep-save': return epSave(el.dataset.id);
      case 'set-project-status': return setProjectStatus(el.dataset.status);
      case 'delete-project': return deleteProject();

      // Exports
      case 'export-xlsx': return Exports.exportXlsx(ctx.project);
      case 'export-docx': return Exports.exportDocx(ctx.project);
      case 'export-pdf': return Exports.exportPdf(ctx.project);

      // Milestones CRUD & Toggle
      case 'add-milestone': return addMilestone();
      case 'ms-save': return msSave();
      case 'edit-milestone': return editMilestone(el.dataset.id);
      case 'ms-edit-save': return msEditSave(el.dataset.id);
      case 'toggle-ms-status': return toggleMilestoneStatus(el.dataset.id);
      case 'ms-del': return msDel(el.dataset.id);

      // People CRUD
      case 'add-person': return addPerson();
      case 'p-save': return pSave();
      case 'edit-person': return editPerson(el.dataset.id);
      case 'p-edit-save': return pEditSave(el.dataset.id);
      case 'delete-person': return deletePerson(el.dataset.id);

      // Project Collaborators & Instruments link
      case 'add-project-person': return addProjectPerson();
      case 'app-person-save': return appPersonSave();
      case 'remove-project-person': return removeProjectPerson(el.dataset.id);
      case 'add-project-instrument': return addProjectInstrument();
      case 'app-inst-save': return appInstSave();
      case 'remove-project-instrument': return removeProjectInstrument(el.dataset.id);

      // Instruments CRUD
      case 'add-instrument': return addInstrument();
      case 'i-save': return iSave();
      case 'edit-instrument': return editInstrument(el.dataset.id);
      case 'i-edit-save': return iEditSave(el.dataset.id);
      case 'delete-instrument': return deleteInstrument(el.dataset.id);

      // Meetings CRUD
      case 'add-meeting': return addMeeting();
      case 'm-save': return mSave();
      case 'edit-meeting': return editMeeting(el.dataset.id);
      case 'm-edit-save': return mEditSave(el.dataset.id);
      case 'meeting-del': return deleteMeeting(el.dataset.id);

      // Custom KV Fields CRUD
      case 'kv-add': return addKV();
      case 'kv-save': return kvSave();
      case 'kv-edit': return editKV(el.dataset.id);
      case 'kv-edit-save': return kvEditSave(el.dataset.id);
      case 'kv-del': return kvDel(el.dataset.id);

      // Files CRUD
      case 'add-file': return addFile();
      case 'f-save': return fSave();
      case 'download-file': return downloadFile(el.dataset.id, el.dataset.name);
      case 'file-del': return deleteFile(el.dataset.id);
    }
  }

  /* ---------------- Helper: Generate Unique Project Code ---------------- */
  function generateProjectCode() {
    const d = new Date();
    const prefix = 'PRJ-' + d.getFullYear().toString().slice(2) + (d.getMonth() + 1).toString().padStart(2, '0');
    const existing = DB.rows('SELECT code FROM projects WHERE code LIKE ?', [prefix + '%']);
    const seq = (existing.length + 1).toString().padStart(3, '0');
    return `${prefix}-${seq}`;
  }

  /* ---------------- Project Creation with Inline Person Adding ---------------- */
  function newProject() {
    const peopleList = DB.rows('SELECT id, name, type, organization FROM people ORDER BY name');

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('folder')} Initiate Facility Project</span></div>
      <div class="body"><div class="stack">
        <div class="field">
          <label>Project Title *</label>
          <input class="input" id="np-title" placeholder="e.g. Multiplex Confocal Imaging of Pancreatic Islets" />
        </div>
        <div class="grid cols-2">
          <div class="field">
            <label>Status</label>
            <select class="input" id="np-status">${C.STATUS.map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label>Priority</label>
            <select class="input" id="np-priority">${C.PRIORITY.map((pr) => `<option value="${pr}" ${pr === 'Medium' ? 'selected' : ''}>${pr}</option>`).join('')}</select>
          </div>
        </div>

        <!-- PI Selection with inline Add option -->
        <div class="field">
          <label>Principal Investigator (PI)</label>
          <select class="input" id="np-pi">
            <option value="">-- Select Existing Person or Leave Blank --</option>
            ${peopleList.map((pe) => `<option value="${pe.id}">${esc(pe.name)} (${pe.type}${pe.organization ? ' • ' + esc(pe.organization) : ''})</option>`).join('')}
          </select>
        </div>

        <!-- Inline New Person Section -->
        <div class="card" style="background:var(--surface-2);border-style:dashed;padding:12px">
          <div class="row mb-8">
            <span style="font-weight:600;font-size:12.5px">${ic('users')} Or Register New Person Now</span>
          </div>
          <div class="grid cols-2">
            <div class="field"><label>First Name</label><input class="input" id="np-p-first" placeholder="e.g. Elena" /></div>
            <div class="field"><label>Last Name</label><input class="input" id="np-p-last" placeholder="e.g. Rostova" /></div>
          </div>
          <div class="grid cols-2 mt-8">
            <div class="field"><label>Position / Role</label><select class="input" id="np-p-type">${C.PERSON_TYPES.map((s) => `<option value="${s}" ${s === 'PI' ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
            <div class="field"><label>Lab / Group / Company</label><input class="input" id="np-p-org" placeholder="e.g. Molecular Neurobiology Lab" /></div>
          </div>
          <div class="field mt-8"><label>Email Address</label><input type="email" class="input" id="np-p-email" placeholder="elena.rostova@institute.org" /></div>
        </div>

        <div class="grid cols-2">
          <div class="field">
            <label>Modality / Technique</label>
            <select class="input" id="np-modality">
              <option value="">-- Select Modality --</option>
              ${C.MODALITY.map((m) => `<option value="${m}">${m}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Funding Source</label>
            <select class="input" id="np-funding">
              <option value="">-- Select Funding --</option>
              ${C.FUNDING.map((f) => `<option value="${f}">${f}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid cols-2">
          <div class="field">
            <label>Sample Type</label>
            <select class="input" id="np-sample">
              <option value="">-- Select Sample --</option>
              ${C.SAMPLE.map((s) => `<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Risk / Status Flags</label>
            <div class="chips">
              ${C.FLAGS.map((fl) => `<span class="chip" data-flag="${fl}">${fl}</span>`).join('')}
            </div>
          </div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label>Start Date</label><input type="date" class="input" id="np-start" value="${UI.today()}" /></div>
          <div class="field"><label>Target End Date</label><input type="date" class="input" id="np-end" /></div>
        </div>
        <div class="field"><label>Tags (comma-separated)</label><input class="input" id="np-tags" placeholder="e.g. live-cell, grant-aim-1, time-lapse" /></div>
        <div class="field"><label>Scope &amp; Protocol Notes</label><textarea class="input" id="np-notes" placeholder="Objectives, imaging parameters, antibody details..."></textarea></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="np-save">Create Project</button>
      </div>`, (m) => {
      m.querySelectorAll('[data-flag]').forEach((c) => (c.onclick = () => c.classList.toggle('on')));
    });
  }

  function npSave() {
    const m = document.querySelector('.modal');
    const title = m.querySelector('#np-title').value.trim();
    if (!title) { UI.toast('Project title is required', 'error'); return; }

    // Check if new person is specified inline
    let piId = m.querySelector('#np-pi').value ? Number(m.querySelector('#np-pi').value) : null;
    const pFirst = m.querySelector('#np-p-first').value.trim();
    const pLast = m.querySelector('#np-p-last').value.trim();

    if (pFirst || pLast) {
      const fullName = `${pFirst} ${pLast}`.trim();
      const pType = m.querySelector('#np-p-type').value;
      const pOrg = m.querySelector('#np-p-org').value.trim();
      const pEmail = m.querySelector('#np-p-email').value.trim();

      DB.run('INSERT INTO people (name, type, organization, email) VALUES (?,?,?,?)', [fullName, pType, pOrg, pEmail]);
      const newPerson = DB.row('SELECT last_insert_rowid() as id');
      if (newPerson) {
        piId = newPerson.id;
        UI.toast(`Registered ${fullName} (${pType})`);
      }
    }

    const code = generateProjectCode();
    const status = m.querySelector('#np-status').value;
    const priority = m.querySelector('#np-priority').value;
    const modality = m.querySelector('#np-modality').value;
    const funding = m.querySelector('#np-funding').value;
    const sample = m.querySelector('#np-sample').value;
    const flags = [...m.querySelectorAll('[data-flag].on')].map((c) => c.dataset.flag).join(',');
    const start = m.querySelector('#np-start').value || null;
    const end = m.querySelector('#np-end').value || null;
    const tags = m.querySelector('#np-tags').value.trim();
    const notes = m.querySelector('#np-notes').value.trim();

    DB.run(`
      INSERT INTO projects (title, code, status, priority, pi_id, modality, funding, sample, flags, start_date, end_date, tags, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [title, code, status, priority, piId, modality, funding, sample, flags, start, end, tags, notes]
    );

    const inserted = DB.row('SELECT id FROM projects WHERE code=?', [code]);
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Project created successfully');
    route('project', inserted ? inserted.id : null);
  }

  function editProject(id) {
    const p = DB.row('SELECT * FROM projects WHERE id=?', [id]);
    if (!p) return;
    const pis = DB.rows('SELECT id, name, type, organization FROM people ORDER BY name');
    const currentFlags = (p.flags || '').split(',').filter(Boolean);

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('edit')} Edit Project Details</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Project Title *</label><input class="input" id="ep-title" value="${esc(p.title)}" /></div>
        <div class="grid cols-3">
          <div class="field"><label>Project Code</label><input class="input" id="ep-code" value="${esc(p.code)}" /></div>
          <div class="field"><label>Status</label><select class="input" id="ep-status">${C.STATUS.map((s) => `<option value="${s}" ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div class="field"><label>Priority</label><select class="input" id="ep-priority">${C.PRIORITY.map((pr) => `<option value="${pr}" ${pr === p.priority ? 'selected' : ''}>${pr}</option>`).join('')}</select></div>
        </div>
        <div class="grid cols-2">
          <div class="field">
            <label>Principal Investigator (PI)</label>
            <select class="input" id="ep-pi">
              <option value="">-- Select or None --</option>
              ${pis.map((pe) => `<option value="${pe.id}" ${pe.id === p.pi_id ? 'selected' : ''}>${esc(pe.name)} (${pe.type}${pe.organization ? ' • ' + esc(pe.organization) : ''})</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Modality / Technique</label>
            <select class="input" id="ep-modality">
              <option value="">-- Select Modality --</option>
              ${C.MODALITY.map((m) => `<option value="${m}" ${m === p.modality ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label>Funding Source</label><select class="input" id="ep-funding"><option value="">-- Select Funding --</option>${C.FUNDING.map((f) => `<option value="${f}" ${f === p.funding ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
          <div class="field"><label>Sample Type</label><select class="input" id="ep-sample"><option value="">-- Select Sample --</option>${C.SAMPLE.map((s) => `<option value="${s}" ${s === p.sample ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        </div>
        <div class="field">
          <label>Risk / Status Flags</label>
          <div class="chips">
            ${C.FLAGS.map((fl) => `<span class="chip ${currentFlags.includes(fl) ? 'on' : ''}" data-flag="${fl}">${fl}</span>`).join('')}
          </div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label>Start Date</label><input type="date" class="input" id="ep-start" value="${p.start_date || ''}" /></div>
          <div class="field"><label>Target End Date</label><input type="date" class="input" id="ep-end" value="${p.end_date || ''}" /></div>
        </div>
        <div class="field"><label>Tags (comma-separated)</label><input class="input" id="ep-tags" value="${esc(p.tags || '')}" /></div>
        <div class="field"><label>Project Notes &amp; Scope</label><textarea class="input" id="ep-notes">${esc(p.notes || '')}</textarea></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="ep-save" data-id="${p.id}">Save Changes</button>
      </div>`, (m) => {
      m.querySelectorAll('[data-flag]').forEach((c) => (c.onclick = () => c.classList.toggle('on')));
    });
  }

  function epSave(id) {
    const m = document.querySelector('.modal');
    const title = m.querySelector('#ep-title').value.trim();
    if (!title) { UI.toast('Title is required', 'error'); return; }

    const code = m.querySelector('#ep-code').value.trim() || generateProjectCode();
    const status = m.querySelector('#ep-status').value;
    const priority = m.querySelector('#ep-priority').value;
    const piId = m.querySelector('#ep-pi').value ? Number(m.querySelector('#ep-pi').value) : null;
    const modality = m.querySelector('#ep-modality').value;
    const funding = m.querySelector('#ep-funding').value;
    const sample = m.querySelector('#ep-sample').value;
    const flags = [...m.querySelectorAll('[data-flag].on')].map((c) => c.dataset.flag).join(',');
    const start = m.querySelector('#ep-start').value || null;
    const end = m.querySelector('#ep-end').value || null;
    const tags = m.querySelector('#ep-tags').value.trim();
    const notes = m.querySelector('#ep-notes').value.trim();

    DB.run(`
      UPDATE projects
      SET title=?, code=?, status=?, priority=?, pi_id=?, modality=?, funding=?, sample=?, flags=?, start_date=?, end_date=?, tags=?, notes=?, updated_at=datetime('now')
      WHERE id=?`,
      [title, code, status, priority, piId, modality, funding, sample, flags, start, end, tags, notes, id]
    );

    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Project updated');
    refresh();
  }

  function setProjectStatus(status) {
    if (!ctx.project) return;
    DB.run("UPDATE projects SET status=?, updated_at=datetime('now') WHERE id=?", [status, ctx.project]);
    UI.toast(`Status updated to ${status}`);
    refresh();
  }

  async function deleteProject() {
    const p = DB.row('SELECT title FROM projects WHERE id=?', [ctx.project]);
    if (!p) return;
    const ok = await UI.confirmModal('Delete Project', `Are you sure you want to permanently delete "${p.title}" and all its milestones, files, and meeting records?`, { danger: true });
    if (!ok) return;

    DB.run('DELETE FROM projects WHERE id=?', [ctx.project]);
    UI.toast('Project deleted');
    route('projects');
  }

  /* ---------------- Milestone Modals & Status Toggle ---------------- */
  function addMilestone() {
    const ppl = DB.rows('SELECT id, name, type, organization FROM people ORDER BY name');
    const inst = DB.rows('SELECT id, name FROM instruments ORDER BY name');

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('target')} Add Deliverable / Milestone</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Milestone Title *</label><input class="input" id="ms-name" placeholder="e.g. Sample preparation &amp; fluorophore labeling" /></div>
        <div class="grid cols-2">
          <div class="field"><label>Due Date</label><input type="date" class="input" id="ms-due" value="${UI.today()}" /></div>
          <div class="field"><label>Status</label><select class="input" id="ms-status">${C.MS_STATUS.map((s) => `<option value="${s}">${s}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Notes / Deliverables</label><input class="input" id="ms-note" placeholder="Specific criteria for completion..." /></div>
        <div class="field"><label>Assign Responsible People</label><div class="chips">${ppl.map((r) => `<span class="chip" data-owner="${r.id}">${esc(r.name)} (${r.type}${r.organization ? ' • ' + esc(r.organization) : ''})</span>`).join('')}</div></div>
        <div class="field"><label>Assign Core Instruments</label><div class="chips">${inst.map((r) => `<span class="chip" data-inst="${r.id}">${esc(r.name)}</span>`).join('')}</div></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="ms-save">Add Milestone</button>
      </div>`, (m) => {
      m.querySelectorAll('[data-owner]').forEach((c) => (c.onclick = () => c.classList.toggle('on')));
      m.querySelectorAll('[data-inst]').forEach((c) => (c.onclick = () => c.classList.toggle('on')));
    });
  }

  function msSave() {
    const m = document.querySelector('.modal');
    const name = m.querySelector('#ms-name').value.trim();
    if (!name) { UI.toast('Milestone title required', 'error'); return; }

    const pid = ctx.project;
    const due = m.querySelector('#ms-due').value || null;
    const status = m.querySelector('#ms-status').value;
    const note = m.querySelector('#ms-note').value.trim();

    DB.run('INSERT INTO milestones (project_id, name, due_date, status, note) VALUES (?,?,?,?,?)', [pid, name, due, status, note]);
    const mid = DB.q1('SELECT last_insert_rowid()')[0];

    const owners = [...m.querySelectorAll('[data-owner].on')].map((c) => Number(c.dataset.owner));
    const insts = [...m.querySelectorAll('[data-inst].on')].map((c) => Number(c.dataset.inst));

    owners.forEach((oid) => DB.run('INSERT OR IGNORE INTO milestone_owners (milestone_id, person_id) VALUES (?,?)', [mid, oid]));
    insts.forEach((iid) => DB.run('INSERT OR IGNORE INTO milestone_instruments (milestone_id, instrument_id) VALUES (?,?)', [mid, iid]));

    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Milestone added');
    refresh();
  }

  function editMilestone(id) {
    const m = DB.row('SELECT * FROM milestones WHERE id=?', [id]);
    if (!m) return;
    const ppl = DB.rows('SELECT id, name, type, organization FROM people ORDER BY name');
    const inst = DB.rows('SELECT id, name FROM instruments ORDER BY name');
    const currentOwners = DB.rows('SELECT person_id FROM milestone_owners WHERE milestone_id=?', [id]).map((r) => r.person_id);
    const currentInsts = DB.rows('SELECT instrument_id FROM milestone_instruments WHERE milestone_id=?', [id]).map((r) => r.instrument_id);

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('edit')} Edit Milestone</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Milestone Title *</label><input class="input" id="mse-name" value="${esc(m.name)}" /></div>
        <div class="grid cols-2">
          <div class="field"><label>Due Date</label><input type="date" class="input" id="mse-due" value="${m.due_date || ''}" /></div>
          <div class="field"><label>Status</label><select class="input" id="mse-status">${C.MS_STATUS.map((s) => `<option value="${s}" ${s === m.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Notes / Deliverables</label><input class="input" id="mse-note" value="${esc(m.note || '')}" /></div>
        <div class="field"><label>Assign Responsible People</label><div class="chips">${ppl.map((r) => `<span class="chip ${currentOwners.includes(r.id) ? 'on' : ''}" data-owner="${r.id}">${esc(r.name)} (${r.type}${r.organization ? ' • ' + esc(r.organization) : ''})</span>`).join('')}</div></div>
        <div class="field"><label>Assign Core Instruments</label><div class="chips">${inst.map((r) => `<span class="chip ${currentInsts.includes(r.id) ? 'on' : ''}" data-inst="${r.id}">${esc(r.name)}</span>`).join('')}</div></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="ms-edit-save" data-id="${m.id}">Save Milestone</button>
      </div>`, (modalEl) => {
      modalEl.querySelectorAll('[data-owner]').forEach((c) => (c.onclick = () => c.classList.toggle('on')));
      modalEl.querySelectorAll('[data-inst]').forEach((c) => (c.onclick = () => c.classList.toggle('on')));
    });
  }

  function msEditSave(id) {
    const m = document.querySelector('.modal');
    const name = m.querySelector('#mse-name').value.trim();
    if (!name) { UI.toast('Milestone title required', 'error'); return; }

    const due = m.querySelector('#mse-due').value || null;
    const status = m.querySelector('#mse-status').value;
    const note = m.querySelector('#mse-note').value.trim();

    DB.run("UPDATE milestones SET name=?, due_date=?, status=?, note=?, updated_at=datetime('now') WHERE id=?", [name, due, status, note, id]);

    DB.run('DELETE FROM milestone_owners WHERE milestone_id=?', [id]);
    DB.run('DELETE FROM milestone_instruments WHERE milestone_id=?', [id]);

    const owners = [...m.querySelectorAll('[data-owner].on')].map((c) => Number(c.dataset.owner));
    const insts = [...m.querySelectorAll('[data-inst].on')].map((c) => Number(c.dataset.inst));

    owners.forEach((oid) => DB.run('INSERT OR IGNORE INTO milestone_owners (milestone_id, person_id) VALUES (?,?)', [id, oid]));
    insts.forEach((iid) => DB.run('INSERT OR IGNORE INTO milestone_instruments (milestone_id, instrument_id) VALUES (?,?)', [id, iid]));

    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Milestone updated');
    refresh();
  }

  function toggleMilestoneStatus(id) {
    const m = DB.row('SELECT status FROM milestones WHERE id=?', [id]);
    if (!m) return;
    const nextStatus = m.status === 'pending' ? 'in-progress' : m.status === 'in-progress' ? 'done' : 'pending';
    DB.run("UPDATE milestones SET status=?, updated_at=datetime('now') WHERE id=?", [nextStatus, id]);
    UI.toast(`Milestone marked ${nextStatus}`);
    refresh();
  }

  function msDel(id) {
    DB.run('DELETE FROM milestones WHERE id=?', [id]);
    UI.toast('Milestone removed');
    refresh();
  }

  /* ---------------- People CRUD with Labs / Organizations ---------------- */
  function addPerson() {
    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('users')} Register Researcher / Staff</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Full Name *</label><input class="input" id="p-name" placeholder="e.g. Dr. Jane Doe" /></div>
        <div class="grid cols-2">
          <div class="field"><label>Position / Role</label><select class="input" id="p-type">${C.PERSON_TYPES.map((s) => `<option value="${s}">${s}</option>`).join('')}</select></div>
          <div class="field"><label>Lab / Group / Company</label><input class="input" id="p-org" placeholder="e.g. Chen Lab, Genentech, Pathology" /></div>
        </div>
        <div class="field"><label>Email Address</label><input type="email" class="input" id="p-email" placeholder="jane.doe@university.edu" /></div>
        <div class="field"><label>Department &amp; Research Focus Notes</label><input class="input" id="p-note" placeholder="e.g. Single-molecule localization microscopy" /></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="p-save">Save Person</button>
      </div>`);
  }

  function pSave() {
    const m = document.querySelector('.modal');
    const name = m.querySelector('#p-name').value.trim();
    if (!name) { UI.toast('Name required', 'error'); return; }
    const type = m.querySelector('#p-type').value;
    const org = m.querySelector('#p-org').value.trim();
    const email = m.querySelector('#p-email').value.trim();
    const note = m.querySelector('#p-note').value.trim();

    DB.run('INSERT INTO people (name, type, organization, email, note) VALUES (?,?,?,?,?)', [name, type, org, email, note]);
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Person registered');
    refresh();
  }

  function editPerson(id) {
    const p = DB.row('SELECT * FROM people WHERE id=?', [id]);
    if (!p) return;

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('edit')} Edit Profile</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Full Name *</label><input class="input" id="pe-name" value="${esc(p.name)}" /></div>
        <div class="grid cols-2">
          <div class="field"><label>Position / Role</label><select class="input" id="pe-type">${C.PERSON_TYPES.map((s) => `<option value="${s}" ${s === p.type ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div class="field"><label>Lab / Group / Company</label><input class="input" id="pe-org" value="${esc(p.organization || '')}" /></div>
        </div>
        <div class="field"><label>Email Address</label><input type="email" class="input" id="pe-email" value="${esc(p.email || '')}" /></div>
        <div class="field"><label>Department &amp; Research Focus Notes</label><input class="input" id="pe-note" value="${esc(p.note || '')}" /></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="p-edit-save" data-id="${p.id}">Save Changes</button>
      </div>`);
  }

  function pEditSave(id) {
    const m = document.querySelector('.modal');
    const name = m.querySelector('#pe-name').value.trim();
    if (!name) { UI.toast('Name required', 'error'); return; }
    const type = m.querySelector('#pe-type').value;
    const org = m.querySelector('#pe-org').value.trim();
    const email = m.querySelector('#pe-email').value.trim();
    const note = m.querySelector('#pe-note').value.trim();

    DB.run('UPDATE people SET name=?, type=?, organization=?, email=?, note=? WHERE id=?', [name, type, org, email, note, id]);
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Person updated');
    refresh();
  }

  async function deletePerson(id) {
    const p = DB.row('SELECT name FROM people WHERE id=?', [id]);
    if (!p) return;
    const ok = await UI.confirmModal('Delete Person', `Are you sure you want to remove "${p.name}"? This will unlink them from projects.`, { danger: true });
    if (!ok) return;
    DB.run('DELETE FROM people WHERE id=?', [id]);
    UI.toast('Person deleted');
    refresh();
  }

  /* ---------------- Instruments CRUD ---------------- */
  function addInstrument() {
    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('cpu')} Add Core Instrument</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Instrument Name *</label><input class="input" id="i-name" placeholder="e.g. Zeiss LSM 980 with Airyscan 2" /></div>
        <div class="field"><label>Modality / Technique</label><select class="input" id="i-kind">${C.MODALITY.map((s) => `<option value="${s}">${s}</option>`).join('')}</select></div>
        <div class="field"><label>Operational Status</label><select class="input" id="i-status">${C.INSTRUMENT_STATUS.map((s) => `<option value="${s}">${s}</option>`).join('')}</select></div>
        <div class="field"><label>Location / Configuration Notes</label><input class="input" id="i-note" placeholder="Room 204, 405/488/561/633nm lasers" /></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="i-save">Save Instrument</button>
      </div>`);
  }

  function iSave() {
    const m = document.querySelector('.modal');
    const name = m.querySelector('#i-name').value.trim();
    if (!name) { UI.toast('Instrument name required', 'error'); return; }
    DB.run('INSERT INTO instruments (name, kind, status, note) VALUES (?,?,?,?)', [name, m.querySelector('#i-kind').value, m.querySelector('#i-status').value, m.querySelector('#i-note').value.trim()]);
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Instrument added');
    refresh();
  }

  function editInstrument(id) {
    const inst = DB.row('SELECT * FROM instruments WHERE id=?', [id]);
    if (!inst) return;

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('edit')} Edit Instrument</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Instrument Name *</label><input class="input" id="ie-name" value="${esc(inst.name)}" /></div>
        <div class="field"><label>Modality / Technique</label><select class="input" id="ie-kind">${C.MODALITY.map((s) => `<option value="${s}" ${s === inst.kind ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Operational Status</label><select class="input" id="ie-status">${C.INSTRUMENT_STATUS.map((s) => `<option value="${s}" ${s === inst.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Location / Configuration Notes</label><input class="input" id="ie-note" value="${esc(inst.note || '')}" /></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="i-edit-save" data-id="${inst.id}">Save Changes</button>
      </div>`);
  }

  function iEditSave(id) {
    const m = document.querySelector('.modal');
    const name = m.querySelector('#ie-name').value.trim();
    if (!name) { UI.toast('Instrument name required', 'error'); return; }
    DB.run('UPDATE instruments SET name=?, kind=?, status=?, note=? WHERE id=?', [name, m.querySelector('#ie-kind').value, m.querySelector('#ie-status').value, m.querySelector('#ie-note').value.trim(), id]);
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Instrument updated');
    refresh();
  }

  async function deleteInstrument(id) {
    const i = DB.row('SELECT name FROM instruments WHERE id=?', [id]);
    if (!i) return;
    const ok = await UI.confirmModal('Delete Instrument', `Are you sure you want to delete "${i.name}"?`, { danger: true });
    if (!ok) return;
    DB.run('DELETE FROM instruments WHERE id=?', [id]);
    UI.toast('Instrument deleted');
    refresh();
  }

  /* ---------------- Collaborators Linking ---------------- */
  function addProjectPerson() {
    const assigned = DB.rows('SELECT person_id FROM project_people WHERE project_id=?', [ctx.project]).map((r) => r.person_id);
    const available = DB.rows('SELECT id, name, type, organization FROM people ORDER BY name').filter((p) => !assigned.includes(p.id));

    if (!available.length) {
      UI.toast('All registered people are already on this team.', 'warning');
      return;
    }

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('users')} Add Team Member</span></div>
      <div class="body"><div class="stack">
        <div class="field">
          <label>Select Person *</label>
          <select class="input" id="app-person-id">
            ${available.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.type}${p.organization ? ' • ' + esc(p.organization) : ''})</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Role on Project</label>
          <input class="input" id="app-person-role" placeholder="e.g. Lead Analyst, Postdoc Fellow, Primary Operator" />
        </div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="app-person-save">Add Member</button>
      </div>`);
  }

  function appPersonSave() {
    const m = document.querySelector('.modal');
    const personId = Number(m.querySelector('#app-person-id').value);
    const role = m.querySelector('#app-person-role').value.trim();

    DB.run('INSERT OR REPLACE INTO project_people (project_id, person_id, role) VALUES (?,?,?)', [ctx.project, personId, role]);
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Team member added');
    refresh();
  }

  function removeProjectPerson(personId) {
    DB.run('DELETE FROM project_people WHERE project_id=? AND person_id=?', [ctx.project, personId]);
    UI.toast('Member removed');
    refresh();
  }

  function addProjectInstrument() {
    const assigned = DB.rows('SELECT instrument_id FROM project_instruments WHERE project_id=?', [ctx.project]).map((r) => r.instrument_id);
    const available = DB.rows('SELECT id, name, kind, status FROM instruments ORDER BY name').filter((i) => !assigned.includes(i.id));

    if (!available.length) {
      UI.toast('All facility instruments are already assigned.', 'warning');
      return;
    }

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('cpu')} Assign Core Instrument</span></div>
      <div class="body"><div class="stack">
        <div class="field">
          <label>Select Instrument *</label>
          <select class="input" id="app-inst-id">
            ${available.map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(i.kind || 'Instrument')} - ${i.status})</option>`).join('')}
          </select>
        </div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="app-inst-save">Assign Instrument</button>
      </div>`);
  }

  function appInstSave() {
    const m = document.querySelector('.modal');
    const instId = Number(m.querySelector('#app-inst-id').value);
    DB.run('INSERT OR IGNORE INTO project_instruments (project_id, instrument_id) VALUES (?,?)', [ctx.project, instId]);
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Instrument assigned');
    refresh();
  }

  function removeProjectInstrument(instId) {
    DB.run('DELETE FROM project_instruments WHERE project_id=? AND instrument_id=?', [ctx.project, instId]);
    UI.toast('Instrument unassigned');
    refresh();
  }

  /* ---------------- Meetings CRUD with Inline Attendees & Labs ---------------- */
  function addMeeting() {
    const allPeople = DB.rows('SELECT id, name, type, organization FROM people ORDER BY name');

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('calendar')} Log Consultation / Sync Meeting</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Meeting Title *</label><input class="input" id="m-title" placeholder="e.g. Initial Image Analysis Pipeline Sync" /></div>
        <div class="field"><label>Date</label><input type="date" class="input" id="m-date" value="${UI.today()}" /></div>
        
        <div class="field">
          <label>Select Attendees (Known People &amp; Labs)</label>
          <div class="chips">
            ${allPeople.map((p) => `<span class="chip" data-att-person="${esc(p.name)}${p.organization ? ' (' + esc(p.organization) + ')' : ''}">${esc(p.name)} <span style="opacity:0.75">${p.organization ? '• ' + esc(p.organization) : '(' + p.type + ')'}</span></span>`).join('')}
          </div>
        </div>

        <div class="field">
          <label>Attendees List (Edit or add manual names)</label>
          <input class="input" id="m-att" placeholder="Selected attendees will appear here, or type comma-separated..." />
        </div>

        <!-- Inline Quick Add Person for Meeting -->
        <div class="card" style="background:var(--surface-2);border-style:dashed;padding:12px">
          <div class="row mb-8"><span style="font-weight:600;font-size:12.5px">${ic('users')} Or Register New Attendee &amp; Lab</span></div>
          <div class="grid cols-2">
            <div class="field"><label>Name</label><input class="input" id="m-new-name" placeholder="e.g. Alex Rivera" /></div>
            <div class="field"><label>Lab / Group</label><input class="input" id="m-new-org" placeholder="e.g. Neuroscience Lab" /></div>
          </div>
        </div>

        <div class="field"><label>Discussion Notes</label><textarea class="input" id="m-note" placeholder="Consultation notes, requirements, experimental design..."></textarea></div>
        <div class="field"><label>Next Steps / Action Items</label><input class="input" id="m-act" placeholder="e.g. Transfer RAW Nikon ND2 files to facility NAS" /></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="m-save">Log Meeting</button>
      </div>`, (modalEl) => {
      const attInput = modalEl.querySelector('#m-att');
      modalEl.querySelectorAll('[data-att-person]').forEach((chip) => {
        chip.onclick = () => {
          chip.classList.toggle('on');
          const selected = [...modalEl.querySelectorAll('[data-att-person].on')].map((c) => c.dataset.attPerson);
          attInput.value = selected.join(', ');
        };
      });
    });
  }

  function mSave() {
    const m = document.querySelector('.modal');
    const title = m.querySelector('#m-title').value.trim();
    if (!title) { UI.toast('Meeting title required', 'error'); return; }

    let attendees = m.querySelector('#m-att').value.trim();
    const newName = m.querySelector('#m-new-name').value.trim();
    const newOrg = m.querySelector('#m-new-org').value.trim();

    if (newName) {
      DB.run('INSERT INTO people (name, type, organization) VALUES (?,?,?)', [newName, 'Researcher', newOrg]);
      const formatted = `${newName}${newOrg ? ' (' + newOrg + ')' : ''}`;
      attendees = attendees ? `${attendees}, ${formatted}` : formatted;
      UI.toast(`Registered ${newName}`);
    }

    const date = m.querySelector('#m-date').value || UI.today();
    const note = m.querySelector('#m-note').value.trim();
    const actions = m.querySelector('#m-act').value.trim();

    DB.run('INSERT INTO meetings (project_id, title, date, attendees, note, actions) VALUES (?,?,?,?,?,?)', [ctx.project, title, date, attendees, note, actions]);
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Meeting logged');
    refresh();
  }

  function editMeeting(id) {
    const mt = DB.row('SELECT * FROM meetings WHERE id=?', [id]);
    if (!mt) return;

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('edit')} Edit Meeting Record</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Meeting Title *</label><input class="input" id="mte-title" value="${esc(mt.title)}" /></div>
        <div class="field"><label>Date</label><input type="date" class="input" id="mte-date" value="${mt.date || ''}" /></div>
        <div class="field"><label>Attendees</label><input class="input" id="mte-att" value="${esc(mt.attendees || '')}" /></div>
        <div class="field"><label>Discussion Notes</label><textarea class="input" id="mte-note">${esc(mt.note || '')}</textarea></div>
        <div class="field"><label>Next Steps / Action Items</label><input class="input" id="mte-act" value="${esc(mt.actions || '')}" /></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="m-edit-save" data-id="${mt.id}">Save Changes</button>
      </div>`);
  }

  function mEditSave(id) {
    const m = document.querySelector('.modal');
    const title = m.querySelector('#mte-title').value.trim();
    if (!title) { UI.toast('Title required', 'error'); return; }

    const date = m.querySelector('#mte-date').value || null;
    const attendees = m.querySelector('#mte-att').value.trim();
    const note = m.querySelector('#mte-note').value.trim();
    const actions = m.querySelector('#mte-act').value.trim();

    DB.run("UPDATE meetings SET title=?, date=?, attendees=?, note=?, actions=?, updated_at=datetime('now') WHERE id=?", [title, date, attendees, note, actions, id]);
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Meeting updated');
    refresh();
  }

  function deleteMeeting(id) {
    DB.run('DELETE FROM meetings WHERE id=?', [id]);
    UI.toast('Meeting removed');
    refresh();
  }

  /* ---------------- Custom Key-Value Fields ---------------- */
  function addKV() {
    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('tag')} Add Custom Metadata Field</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Field Name / Key *</label><input class="input" id="kv-k" placeholder="e.g. Grant Number, Ethical Protocol #, Lab Code" /></div>
        <div class="field"><label>Value *</label><input class="input" id="kv-v" placeholder="e.g. NIH-R01-EB028456" /></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="kv-save">Add Field</button>
      </div>`);
  }

  function kvSave() {
    const m = document.querySelector('.modal');
    const k = m.querySelector('#kv-k').value.trim();
    const v = m.querySelector('#kv-v').value.trim();
    if (!k || !v) { UI.toast('Both field name and value are required', 'error'); return; }

    DB.run('INSERT INTO kv (project_id, key, value) VALUES (?,?,?)', [ctx.project, k, v]);
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Field added');
    refresh();
  }

  function editKV(id) {
    const item = DB.row('SELECT * FROM kv WHERE id=?', [id]);
    if (!item) return;

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('edit')} Edit Metadata Field</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Field Name / Key *</label><input class="input" id="kve-k" value="${esc(item.key)}" /></div>
        <div class="field"><label>Value *</label><input class="input" id="kve-v" value="${esc(item.value)}" /></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="kv-edit-save" data-id="${item.id}">Save Field</button>
      </div>`);
  }

  function kvEditSave(id) {
    const m = document.querySelector('.modal');
    const k = m.querySelector('#kve-k').value.trim();
    const v = m.querySelector('#kve-v').value.trim();
    if (!k || !v) { UI.toast('Both field name and value are required', 'error'); return; }

    DB.run('UPDATE kv SET key=?, value=? WHERE id=?', [k, v, id]);
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Field updated');
    refresh();
  }

  function kvDel(id) {
    DB.run('DELETE FROM kv WHERE id=?', [id]);
    UI.toast('Field deleted');
    refresh();
  }

  /* ---------------- Files CRUD ---------------- */
  function addFile() {
    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('file')} Attach File or Link</span></div>
      <div class="body"><div class="stack">
        <div class="field">
          <label>Upload File (Instant IndexedDB Storage)</label>
          <input type="file" class="input" id="f-file" />
        </div>
        <div class="divider"></div>
        <div class="field">
          <label>Or Web Link / File Share Path</label>
          <input class="input" id="f-link" placeholder="https://drive.google.com/... or \\\\server\\share\\data" />
        </div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="f-save">Save Attachment</button>
      </div>`);
  }

  async function fSave() {
    const m = document.querySelector('.modal');
    const fileInput = m.querySelector('#f-file');
    const link = m.querySelector('#f-link').value.trim();
    const pid = ctx.project;

    if (fileInput.files.length) {
      const f = fileInput.files[0];
      const name = f.name;
      const storageKey = `${pid}_${Date.now()}_${name}`;

      DB.run('INSERT INTO files (project_id, name, kind, path) VALUES (?,?,?,?)', [pid, name, 'upload', storageKey]);
      await DB.saveUpload(storageKey, f);
      UI.closeDim(m.closest('.modal-dim'));
      UI.toast('File attached');
      refresh();
    } else if (link) {
      DB.run('INSERT INTO files (project_id, name, kind, path) VALUES (?,?,?,?)', [pid, link, 'link', link]);
      UI.closeDim(m.closest('.modal-dim'));
      UI.toast('Link added');
      refresh();
    } else {
      UI.toast('Choose a file or enter a link', 'error');
    }
  }

  async function downloadFile(id, name) {
    const f = DB.row('SELECT * FROM files WHERE id=?', [id]);
    if (!f || f.kind !== 'upload') return;

    const blob = await DB.getUpload(f.path);
    if (!blob) {
      UI.toast('File not found in local storage', 'error');
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function deleteFile(id) {
    DB.run('DELETE FROM files WHERE id=?', [id]);
    UI.toast('Attachment removed');
    refresh();
  }

  /* ---------------- Backup & Restore ---------------- */
  function doBackup() {
    const data = DB.buildBackup();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `core-facility-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    UI.toast('Complete backup exported');
  }

  async function doRestore() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      const text = await f.text();
      const ok = await UI.confirmModal('Restore Facility Backup', 'Restoring a backup will replace your current database with the backup file. Continue?', { danger: true });
      if (!ok) return;
      try {
        await DB.restoreBackup(JSON.parse(text));
        UI.toast('Database restored successfully');
        route('projects');
      } catch (e) {
        UI.toast('Restore failed: ' + e.message, 'error');
      }
    };
    input.click();
  }

  /* ---------------- Onboarding Tour ---------------- */
  function startTour() {
    UI.startTour([
      { sel: '.sidebar', title: 'Navigation & Core Modules', body: 'Access Dashboard, Projects Registry, People & Labs, Core Instruments, Calendar, and Portable Backups.' },
      { sel: '[data-nav="projects"]', title: 'Projects Registry', body: 'Search, filter, and review ongoing and completed facility research projects.' },
      { sel: '[data-act="new-project"]', title: 'Initiate Projects & People', body: 'Start a project, register new PIs and lab members on the fly, and set modalities & deadlines.' },
      { sel: '#saved-state', title: 'Instant SQLite Autosave', body: 'Every action is continuously and automatically saved to your browser’s embedded SQLite storage.' },
      { sel: '.sidebar-theme-btn', title: 'Adaptive Theme', body: 'Toggle between clean Light and sleek Dark mode anytime.' }
    ]);
  }

})(window);
