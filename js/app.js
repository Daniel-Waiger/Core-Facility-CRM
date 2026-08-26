/* app.js — router, modals, tour, global wiring */
(function (global) {
  'use strict';
  const Views = global.Views, UI = global.UI, DB = global.DB, Exports = global.Exports;
  const C = global.CONST, esc = UI.esc, ic = UI.icon;
  const ctx = { route: 'dashboard', project: null };
  global.App = {
    boot: boot, route: route, refresh: refresh,
    get project() { return ctx.project; },
    onSaved() { UI.setSavedState('saved'); },
  };

  const TITLES = { dashboard: 'Dashboard', projects: 'Projects', project: 'Project', people: 'People', instruments: 'Instruments', calendar: 'Calendar', settings: 'Settings' };

  /* ---------------- Shell ---------------- */
  function renderShell() {
    document.getElementById('app').innerHTML = `
      <div class="app">
        <aside class="sidebar">
          <div class="brand">
            <div class="logo">${ic('cpu')}</div>
            <div><div class="name">Core Tracker</div><div class="sub">Project follow-up</div></div>
          </div>
          <nav class="nav">
            <div class="nav-item" data-nav="dashboard">${ic('home')}<span class="lbl">Dashboard</span></div>
            <div class="nav-item" data-nav="projects">${ic('folder')}<span class="lbl">Projects</span></div>
            <div class="nav-item" data-nav="people">${ic('users')}<span class="lbl">People</span></div>
            <div class="nav-item" data-nav="instruments">${ic('cpu')}<span class="lbl">Instruments</span></div>
            <div class="nav-item" data-nav="calendar">${ic('calendar')}<span class="lbl">Calendar</span></div>
            <div class="nav-item" data-nav="settings">${ic('settings')}<span class="lbl">Settings</span></div>
          </nav>
          <div class="nav-spacer"></div>
          <div class="sidebar-foot">
            <button class="btn btn-primary btn-sm" data-act="new-project">${ic('plus')} New project</button>
            <button class="btn btn-ghost btn-sm" data-act="tour">${ic('play')} Tour</button>
          </div>
        </aside>
        <div class="main">
          <div class="topbar">
            <span class="title" id="page-title">Dashboard</span>
            <div class="grow"></div>
            <span class="saved-dot" id="saved-state"><span class="dot"></span><span class="txt">Saved</span></span>
            <button class="btn btn-ghost btn-sm" data-act="theme-toggle">${ic('sun')} Theme</button>
          </div>
          <div class="main-inner" id="view"></div>
        </div>
      </div>`;
    document.querySelectorAll('[data-nav]').forEach((n) => (n.onclick = () => route(n.dataset.nav)));
  }

  /* ---------------- Routing ---------------- */
  function route(name, id) {
    ctx.route = name; ctx.project = id || null;
    document.querySelectorAll('[data-nav]').forEach((n) => n.classList.toggle('active', n.dataset.nav === name));
    document.getElementById('page-title').textContent = TITLES[name] || 'Dashboard';
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
  }
  function refresh() { renderView(); }

  /* ---------------- Boot ---------------- */
  async function boot() {
    await DB.boot();
    UI.initTheme();
    renderShell();
    route('dashboard');
    wireGlobal();
    if (!localStorage.getItem('seen-tour')) startTour();
  }

  /* ---------------- Global event delegation ---------------- */
  function wireGlobal() {
    document.addEventListener('click', (e) => {
      const goto = e.target.closest('[data-goto]');
      if (goto) { route(goto.dataset.goto, goto.dataset.id); return; }
      const act = e.target.closest('[data-act]');
      if (act) handleAct(act.dataset.act, act);
    });
  }

  function handleAct(act, el) {
    switch (act) {
      case 'new-project': return newProject();
      case 'np-save': return npSave();
      case 'ms-save': return msSave();
      case 'p-save': return pSave();
      case 'i-save': return iSave();
      case 'f-save': return fSave();
      case 'm-save': return mSave();
      case 'kv-save': return kvSave();
      case 'delete-project': return deleteProject();
      case 'ms-del': return msDel(el.dataset.id);
      case 'kv-del': return kvDel(el.dataset.id);
      case 'export-xlsx': return Exports.exportXlsx(ctx.project);
      case 'export-docx': return Exports.exportDocx(ctx.project);
      case 'export-pdf': return Exports.exportPdf(ctx.project);
      case 'cal-prev': return Views.navCalendar(-1);
      case 'cal-next': return Views.navCalendar(1);
      case 'theme-toggle': return UI.toggleTheme();
      case 'tour': return startTour();
      case 'backup': return doBackup();
      case 'restore': return doRestore();
      case 'close': { const m = document.querySelector('.modal'); if (m) UI.closeDim(m); }
      case 'add-person': return addPerson();
      case 'add-instrument': return addInstrument();
      case 'add-milestone': return addMilestone();
      case 'add-file': return addFile();
      case 'add-meeting': return addMeeting();
      case 'kv-add': return addKV();
    }
  }

  /* ---------------- Modals ---------------- */
  function newProject() {
    UI.openModal(`
      <div class="head"><span style="font-weight:600">New project</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Title</label><input class="input" id="np-title" placeholder="e.g. Confocal imaging of tissue section"></div>
        <div class="grid cols-2">
          <div class="field"><label>Status</label><select class="input" id="np-status">${C.STATUS.map((s) => `<option>${s}</option>`).join('')}</select></div>
          <div class="field"><label>Priority</label><select class="input" id="np-priority">${C.PRIORITY.map((s) => `<option>${s}</option>`).join('')}</select></div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label>Start date</label><input type="date" class="input" id="np-start"></div>
          <div class="field"><label>End date</label><input type="date" class="input" id="np-end"></div>
        </div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="np-save">Create</button>
      </div>`);
  }
  function npSave() {
    const m = document.querySelector('.modal');
    const title = m.querySelector('#np-title').value.trim();
    if (!title) { UI.toast('Title is required', 'error'); return; }
    const code = 'P' + (Date.now() % 1000000).toString().padStart(6, '0');
    DB.run('INSERT INTO projects (title, code, status, priority, start_date, end_date) VALUES (?,?,?,?,?,?)',
      [title, code, m.querySelector('#np-status').value, m.querySelector('#np-priority').value, m.querySelector('#np-start').value, m.querySelector('#np-end').value]);
    const id = DB.q1('SELECT last_insert_rowid()')[0];
    UI.closeDim(m); UI.toast('Project created'); route('project', id);
  }

  function addMilestone() {
    const ppl = DB.q('SELECT id, name FROM people ORDER BY type, name');
    const inst = DB.q('SELECT id, name FROM instruments ORDER BY name');
    UI.openModal(`
      <div class="head"><span style="font-weight:600">Add milestone</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Name</label><input class="input" id="ms-name" placeholder="e.g. Sample prep"></div>
        <div class="grid cols-2">
          <div class="field"><label>Due date</label><input type="date" class="input" id="ms-due"></div>
          <div class="field"><label>Status</label><select class="input" id="ms-status">${C.MS_STATUS.map((s) => `<option value="${s}">${s}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Note</label><input class="input" id="ms-note"></div>
        <div class="field"><label>Owners</label><div class="chips">${ppl.map((r) => `<span class="chip" data-owner="${r[0]}" data-name="${esc(r[1])}">${esc(r[1])}</span>`).join('')}</div></div>
        <div class="field"><label>Instruments</label><div class="chips">${inst.map((r) => `<span class="chip" data-inst="${r[0]}" data-name="${esc(r[1])}">${esc(r[1])}</span>`).join('')}</div></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="ms-save">Add</button>
      </div>`);
    // wire chips
    document.querySelectorAll('[data-owner]').forEach((c) => (c.onclick = () => c.classList.toggle('on')));
    document.querySelectorAll('[data-inst]').forEach((c) => (c.onclick = () => c.classList.toggle('on')));
  }
  function msSave() {
    const m = document.querySelector('.modal');
    const name = m.querySelector('#ms-name').value.trim();
    if (!name) { UI.toast('Milestone name required', 'error'); return; }
    const pid = ctx.project;
    const due = m.querySelector('#ms-due').value;
    const status = m.querySelector('#ms-status').value;
    const note = m.querySelector('#ms-note').value;
    const mid = DB.q1('INSERT INTO milestones (project_id, name, due_date, status, note) VALUES (?,?,?,?,?) RETURNING id', [pid, name, due || null, status, note])[0];
    const owners = [...document.querySelectorAll('[data-owner].on')].map((c) => c.dataset.owner);
    const insts = [...document.querySelectorAll('[data-inst].on')].map((c) => c.dataset.inst);
    owners.forEach((oid) => DB.run('INSERT OR IGNORE INTO milestone_owners (milestone_id, person_id) VALUES (?,?)', [mid, oid]));
    insts.forEach((iid) => DB.run('INSERT OR IGNORE INTO milestone_instruments (milestone_id, instrument_id) VALUES (?,?)', [mid, iid]));
    UI.closeDim(m); UI.toast('Milestone added'); refresh();
  }

  function addPerson() {
    UI.openModal(`
      <div class="head"><span style="font-weight:600">Add person</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Name</label><input class="input" id="p-name"></div>
        <div class="field"><label>Type</label><select class="input" id="p-type">${C.PERSON_TYPES.map((s) => `<option>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Email</label><input class="input" id="p-email"></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="p-save">Add</button>
      </div>`);
  }
  function pSave() {
    const m = document.querySelector('.modal');
    const name = m.querySelector('#p-name').value.trim();
    if (!name) { UI.toast('Name required', 'error'); return; }
    DB.run('INSERT INTO people (name, type, email) VALUES (?,?,?)', [name, m.querySelector('#p-type').value, m.querySelector('#p-email').value]);
    UI.closeDim(m); UI.toast('Person added'); refresh();
  }

  function addInstrument() {
    UI.openModal(`
      <div class="head"><span style="font-weight:600">Add instrument</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Name</label><input class="input" id="i-name" placeholder="e.g. Zeiss LSM 900"></div>
        <div class="field"><label>Type</label><select class="input" id="i-kind">${C.MODALITY.map((s) => `<option>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Status</label><select class="input" id="i-status">${C.INSTRUMENT_STATUS.map((s) => `<option>${s}</option>`).join('')}</select></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="i-save">Add</button>
      </div>`);
  }
  function iSave() {
    const m = document.querySelector('.modal');
    const name = m.querySelector('#i-name').value.trim();
    if (!name) { UI.toast('Name required', 'error'); return; }
    DB.run('INSERT INTO instruments (name, kind, status) VALUES (?,?,?)', [name, m.querySelector('#i-kind').value, m.querySelector('#i-status').value]);
    UI.closeDim(m); UI.toast('Instrument added'); refresh();
  }

  function addFile() {
    UI.openModal(`
      <div class="head"><span style="font-weight:600">Add file</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>File</label><input type="file" class="input" id="f-file"></div>
        <div class="field"><label>Or link</label><input class="input" id="f-link" placeholder="https://… or path"></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="f-save">Add</button>
      </div>`);
  }
  function fSave() {
    const m = document.querySelector('.modal');
    const fileInput = m.querySelector('#f-file');
    const link = m.querySelector('#f-link').value.trim();
    const pid = ctx.project;
    if (fileInput.files.length) {
      const f = fileInput.files[0];
      const name = f.name;
      const blob = f;
      DB.run('INSERT INTO files (project_id, name, kind, path) VALUES (?,?,?,?)', [pid, name, 'upload', name]);
      DB.saveUpload(pid + '/' + name, blob).then(() => { UI.closeDim(m); UI.toast('File added'); refresh(); });
    } else if (link) {
      DB.run('INSERT INTO files (project_id, name, kind, path) VALUES (?,?,?,?)', [pid, link, 'link', link]);
      UI.closeDim(m); UI.toast('File added'); refresh();
    } else {
      UI.toast('Choose a file or a link', 'error');
    }
  }

  function addMeeting() {
    UI.openModal(`
      <div class="head"><span style="font-weight:600">Add meeting</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Title</label><input class="input" id="m-title" placeholder="e.g. Weekly sync"></div>
        <div class="field"><label>Date</label><input type="date" class="input" id="m-date"></div>
        <div class="field"><label>Attendees</label><input class="input" id="m-att" placeholder="comma-separated"></div>
        <div class="field"><label>Note</label><textarea class="input" id="m-note"></textarea></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="m-save">Add</button>
      </div>`);
  }
  function mSave() {
    const m = document.querySelector('.modal');
    const title = m.querySelector('#m-title').value.trim();
    if (!title) { UI.toast('Title required', 'error'); return; }
    DB.run('INSERT INTO meetings (project_id, title, date, attendees, note) VALUES (?,?,?,?,?)',
      [ctx.project, title, m.querySelector('#m-date').value || null, m.querySelector('#m-att').value, m.querySelector('#m-note').value]);
    UI.closeDim(m); UI.toast('Meeting added'); refresh();
  }

  function addKV() {
    UI.openModal(`
      <div class="head"><span style="font-weight:600">Add field</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Key</label><input class="input" id="kv-k" placeholder="e.g. Grant #"></div>
        <div class="field"><label>Value</label><input class="input" id="kv-v" placeholder="e.g. NSF-2024-001"></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="kv-save">Add</button>
      </div>`);
  }
  function kvSave() {
    const m = document.querySelector('.modal');
    const k = m.querySelector('#kv-k').value.trim();
    const v = m.querySelector('#kv-v').value.trim();
    if (!k || !v) { UI.toast('Both key and value required', 'error'); return; }
    DB.run('INSERT INTO kv (project_id, key, value) VALUES (?,?,?)', [ctx.project, k, v]);
    UI.closeDim(m); UI.toast('Field added'); refresh();
  }

  /* ---------------- Delete / backup / restore ---------------- */
  async function deleteProject() {
    const p = DB.q1('SELECT title FROM projects WHERE id=?', [ctx.project]);
    if (!p) return;
    const ok = await UI.confirmModal('Delete project', `Delete "${p[0]}" and all its milestones, meetings, files?`, { danger: true });
    if (!ok) return;
    DB.run('DELETE FROM milestones WHERE project_id=?', [ctx.project]);
    DB.run('DELETE FROM meetings WHERE project_id=?', [ctx.project]);
    DB.run('DELETE FROM files WHERE project_id=?', [ctx.project]);
    DB.run('DELETE FROM kv WHERE project_id=?', [ctx.project]);
    DB.run('DELETE FROM project_people WHERE project_id=?', [ctx.project]);
    DB.run('DELETE FROM project_instruments WHERE project_id=?', [ctx.project]);
    DB.run('DELETE FROM projects WHERE id=?', [ctx.project]);
    UI.toast('Project deleted'); route('projects');
  }
  function msDel(id) {
    DB.run('DELETE FROM milestone_owners WHERE milestone_id=?', [id]);
    DB.run('DELETE FROM milestone_instruments WHERE milestone_id=?', [id]);
    DB.run('DELETE FROM milestones WHERE id=?', [id]);
    UI.toast('Milestone removed'); refresh();
  }
  function kvDel(id) {
    DB.run('DELETE FROM kv WHERE id=?', [id]);
    refresh();
  }

  function doBackup() {
    const data = DB.buildBackup();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'core-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); URL.revokeObjectURL(url);
    UI.toast('Backup exported');
  }
  async function doRestore() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      const text = await f.text();
      const ok = await UI.confirmModal('Restore backup', 'This replaces current data. Continue?', { danger: true });
      if (!ok) return;
      try {
        await DB.restoreBackup(JSON.parse(text));
        UI.toast('Backup restored'); route('projects');
      } catch (e) {
        UI.toast('Restore failed: ' + e.message, 'error');
      }
    };
    input.click();
  }

  /* ---------------- Tour ---------------- */
  function startTour() {
    UI.startTour([
      { sel: '.sidebar', title: 'Navigation', body: 'Move between Dashboard, Projects, People, Instruments, Calendar, and Settings.' },
      { sel: '[data-nav="projects"]', title: 'Projects', body: 'Every project you track. Click a row to open it.' },
      { sel: '[data-act="new-project"]', title: 'New project', body: 'Start a project with title, status, priority, and dates.' },
      { sel: '.topbar [data-act="theme-toggle"]', title: 'Theme', body: 'Toggle light/dark. Your choice is remembered.' },
      { sel: '#saved-state', title: 'Autosave', body: 'Every change is saved automatically to your local SQLite database.' },
      { sel: '[data-nav="settings"]', title: 'Backup', body: 'In Settings you can export a backup file and restore from one.' },
    ]);
  }

})(window);
