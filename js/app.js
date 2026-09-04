/* app.js — router, modals with inline person creation, organization reuse, collapsible sidebar & action dispatcher */
(function (global) {
  'use strict';
  const Views = global.Views, UI = global.UI, DB = global.DB, Exports = global.Exports;
  const C = global.CONST, esc = UI.esc, ic = UI.icon;
  const ctx = { route: 'dashboard', project: null };

  let _personSavedCallback = null;
  const autoBackupFolderStatus = { supported: false, name: null, granted: false };

  global.App = {
    boot: boot,
    route: route,
    refresh: refresh,
    get project() { return ctx.project; },
    get autoBackupFolderStatus() { return autoBackupFolderStatus; },
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

  /* ---------------- Helper: Organization / Department value lists ---------------- */
  function distinctPeopleCol(col) {
    return DB.rows(`SELECT DISTINCT ${col} AS v FROM people WHERE ${col} IS NOT NULL AND TRIM(${col}) != '' ORDER BY ${col}`).map((r) => r.v);
  }
  function orgNames() { return distinctPeopleCol('organization'); }
  function deptNames() { return distinctPeopleCol('department'); }

  /* ---------------- Helper: Editable Vocabulary Dropdowns ----------------
     A <select> backed by DB.vocabList(category) (built-in CONST terms plus any
     facility-added ones, with "Other" always sorted last) plus a "+ Add New" button.
     Picking "Other" is itself a trigger, not a storable value — both it and the button
     open the same small nested modal, persist the term via DB.addVocab, and inject+select
     it in the still-open parent select — no reload / re-render of the parent modal needed.
     The select's own change is caught by a global delegated listener (see wireGlobal),
     keyed off the "vocab-select" class plus its data-cat/data-label attributes, so this
     works in every modal without each one having to wire it individually. */
  function vocabField({ category, id, selected = '', label, required = false, placeholder = '-- Select --' }) {
    const opts = DB.vocabList(category);
    // A record's current value may predate this vocab list (older data, or a value entered
    // before this category existed) — always render it as a selectable option so saving the
    // form again can't silently blank the field out just because it's an "unknown" term.
    if (selected && selected !== 'Other' && !opts.includes(selected)) opts.push(selected);
    return `
    <div class="field">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:2px;flex-wrap:wrap;row-gap:4px">
        <label style="margin-bottom:0">${esc(label)}${required ? ' *' : ''}</label>
        <button type="button" class="btn btn-secondary btn-sm" data-act="vocab-add" data-cat="${category}" data-target="${id}" data-label="${esc(label)}" data-tooltip="Add a new ${esc(label)}" style="padding:2px 7px;font-size:11px;white-space:nowrap">${ic('plus')} Add New</button>
      </div>
      <select class="input vocab-select" id="${id}" data-cat="${category}" data-label="${esc(label)}" data-prev="${esc(selected)}">
        <option value="">${placeholder}</option>
        ${opts.map((o) => `<option value="${esc(o)}" ${o === selected ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select>
    </div>`;
  }

  /* ---------------- Helper: free-list <select> + "Add New" ----------------
     For fields whose values are just distinct strings already in the data (Lab / Group,
     Department) — no vocab table. Mirrors the vocab dropdown UX: a <select> of known values
     plus a "+ Add New" button that opens a tiny nested modal, then injects+selects the new
     value in the still-open parent form. `data-list` names the modal title. */
  function listPickerField({ id, label, values, selected = '', modalTitle }) {
    const opts = values.slice();
    if (selected && !opts.includes(selected)) opts.push(selected);
    return `
    <div class="field">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:2px;flex-wrap:wrap;row-gap:4px">
        <label style="margin-bottom:0">${esc(label)}</label>
        <button type="button" class="btn btn-secondary btn-sm" data-act="list-add" data-target="${id}" data-title="${esc(modalTitle || label)}" data-tooltip="Register a new ${esc(label)}" style="padding:2px 7px;font-size:11px;white-space:nowrap">${ic('plus')} Add New</button>
      </div>
      <select class="input" id="${id}">
        <option value="">— None —</option>
        ${opts.map((o) => `<option value="${esc(o)}" ${o === selected ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select>
    </div>`;
  }

  function openAddListValue(targetId, title) {
    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('plus')} Add New ${esc(title || 'Value')}</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>${esc(title || 'Value')} *</label><input class="input" id="list-new-value" placeholder="e.g. ${esc(title || 'Value')}" /></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="list-save" data-target="${targetId}">Add</button>
      </div>`, (m) => { const i = m.querySelector('#list-new-value'); if (i) i.focus(); });
  }

  function listAddSave(targetId) {
    const dims = document.querySelectorAll('.modal-dim');
    const topDim = dims[dims.length - 1];
    if (!topDim) return;
    const value = topDim.querySelector('#list-new-value').value.trim();
    if (!value) { UI.toast('A value is required', 'error'); return; }
    UI.closeDim(topDim);

    const parentDims = document.querySelectorAll('.modal-dim');
    const parentDim = parentDims[parentDims.length - 1];
    const select = parentDim ? parentDim.querySelector('#' + targetId) : null;
    if (select) {
      let opt = [...select.options].find((o) => o.value === value);
      if (!opt) {
        opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        select.appendChild(opt);
      }
      opt.selected = true;
    }
    UI.toast(`Added "${value}"`);
  }

  function openAddVocab(category, targetId, label) {
    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('plus')} Add New ${esc(label || category)}</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>${esc(label || category)} *</label><input class="input" id="vocab-new-value" placeholder="e.g. ${esc(label || category)}" /></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="vocab-save" data-cat="${category}" data-target="${targetId}">Add</button>
      </div>`, (m) => {
      const input = m.querySelector('#vocab-new-value');
      if (input) input.focus();
    });
  }

  function vocabSave(category, targetId) {
    const dims = document.querySelectorAll('.modal-dim');
    const topDim = dims[dims.length - 1];
    if (!topDim) return;
    const value = topDim.querySelector('#vocab-new-value').value.trim();
    if (!value) { UI.toast('A value is required', 'error'); return; }

    DB.addVocab(category, value);
    UI.closeDim(topDim);

    const parentDims = document.querySelectorAll('.modal-dim');
    const parentDim = parentDims[parentDims.length - 1];
    const select = parentDim ? parentDim.querySelector('#' + targetId) : null;
    if (select) {
      const already = [...select.options].find((o) => o.value === value);
      if (already) {
        already.selected = true;
      } else {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        opt.selected = true;
        // Keep "Other" last: insert the new term before it rather than appending after.
        const otherOpt = [...select.options].find((o) => o.value === 'Other');
        select.insertBefore(opt, otherOpt || null);
      }
      select.dataset.prev = value;
    } else {
      // No parent <select> to inject into (e.g. the project page's "+ Add status" button,
      // which isn't a dropdown) — refresh the page underneath so the new term shows up
      // immediately (the modal itself is a separate overlay and is unaffected by this).
      refresh();
    }
    UI.toast(`Added "${value}"`);
  }

  /* ---------------- Shell ---------------- */
  function renderShell() {
    const isCollapsed = UI.storage.getItem('sidebar-collapsed') === '1';

    document.getElementById('app').innerHTML = `
      <div class="app">
        <aside class="sidebar ${isCollapsed ? 'collapsed' : ''}" id="app-sidebar">
          <div class="brand">
            <div class="logo">${ic('cpu')}</div>
            <div style="min-width:0;flex:1">
              <div class="name">Core Facility Tracker</div>
              <div class="sub">Bioimaging Facility</div>
            </div>
            <button class="sidebar-collapse-btn" data-act="toggle-sidebar" data-tooltip="Toggle Sidebar Width">
              ${ic(isCollapsed ? 'expand' : 'collapse')}
            </button>
          </div>
          <nav class="nav">
            <div class="nav-item" data-nav="dashboard" data-tooltip="Overview &amp; Metrics">${ic('home')}<span class="lbl">Dashboard</span></div>
            <div class="nav-item" data-nav="projects" data-tooltip="Project Registry">${ic('folder')}<span class="lbl">Projects</span></div>
            <div class="nav-item" data-nav="people" data-tooltip="Researchers &amp; Labs">${ic('users')}<span class="lbl">People &amp; Labs</span></div>
            <div class="nav-item" data-nav="instruments" data-tooltip="Facility Equipment">${ic('cpu')}<span class="lbl">Instruments</span></div>
            <div class="nav-item" data-nav="calendar" data-tooltip="Monthly Schedule">${ic('calendar')}<span class="lbl">Calendar</span></div>
          </nav>
          <div class="nav-spacer"></div>
          <div class="sidebar-foot">
            <button class="btn btn-primary btn-sm" data-act="new-project" data-tooltip="Initiate Project">${ic('plus')}<span class="lbl">New Project</span></button>
            <button class="btn btn-tour btn-sm" data-act="tour" data-tooltip="Interactive Guided Tour">${ic('play')}<span class="lbl">Tour</span></button>
            <button class="btn btn-secondary btn-sm sidebar-theme-btn" data-act="theme-toggle" data-tooltip="Switch Appearance"></button>
            <button class="btn btn-secondary btn-sm sidebar-settings-btn" data-nav="settings" data-tooltip="Backups &amp; Settings">${ic('gear')}<span class="lbl">Settings</span></button>
            <a class="btn btn-mango btn-sm sidebar-relnotes-btn" href="https://daniel-waiger.github.io/Core-Facility-CRM/docs/" target="_blank" rel="noopener noreferrer" data-tooltip="What&#39;s new — release notes">${ic('sparkles')}<span class="lbl">Release Notes</span></a>
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
    UI.storage.setItem('sidebar-collapsed', isCollapsed ? '1' : '0');
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

    // Re-rendering replaces the DOM wholesale, which would otherwise steal focus away from
    // whatever the user was typing in (e.g. a live search box) on every keystroke. Capture
    // the focused element's identity + cursor position beforehand and restore it after.
    const active = document.activeElement;
    let focusRestore = null;
    if (active && active.id && v.contains(active)) {
      focusRestore = { id: active.id, selStart: active.selectionStart, selEnd: active.selectionEnd };
    }

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

    if (name === 'people') {
      const searchInput = document.getElementById('people-search');
      if (searchInput) searchInput.oninput = (e) => Views.setPeopleFilter({ query: e.target.value });
      const typeFilter = document.getElementById('people-type-filter');
      if (typeFilter) typeFilter.onchange = (e) => Views.setPeopleFilter({ type: e.target.value });
    }

    if (name === 'instruments') {
      const searchInput = document.getElementById('inst-search');
      if (searchInput) searchInput.oninput = (e) => Views.setInstrumentFilter({ query: e.target.value });
      const stFilter = document.getElementById('inst-status-filter');
      if (stFilter) stFilter.onchange = (e) => Views.setInstrumentFilter({ status: e.target.value });
      const kindFilter = document.getElementById('inst-kind-filter');
      if (kindFilter) kindFilter.onchange = (e) => Views.setInstrumentFilter({ kind: e.target.value });
    }

    if (focusRestore) {
      const el = document.getElementById(focusRestore.id);
      if (el) {
        el.focus();
        if (typeof el.setSelectionRange === 'function' && focusRestore.selStart != null) {
          try { el.setSelectionRange(focusRestore.selStart, focusRestore.selEnd); } catch (_) { /* not a text-selectable input */ }
        }
      }
    }
  }

  function refresh() { renderView(); }

  /* ---------------- Startup Welcome Modal ---------------- */
  // afterChoice (optional): runs once the user has made a choice here (or dismissed this modal),
  // so the boot flow can show the first-run device notice AFTER the welcome screen rather than
  // stacked in front of it. Only passed during boot — the Settings "Open Welcome Screen" reuse
  // passes nothing.
  function openStartupModal(afterChoice) {
    let afterChoiceRan = false;
    const runAfterChoice = async () => {
      if (afterChoiceRan) return;
      afterChoiceRan = true;
      if (afterChoice) await afterChoice();
    };
    const isChecked = UI.storage.getItem('crm-hide-startup-modal') === '1';

    UI.openModal(`
      <div class="startup-modal-inner">
        <div class="startup-modal-header">
          <div class="startup-brand-icon">${ic('cpu')}</div>
          <div class="startup-modal-title">Welcome to Core Facility Tracker</div>
          <div class="startup-modal-sub">Choose how you’d like to get started with your research project workspace.</div>
        </div>

        <div class="startup-cards-grid">
          <!-- Option 1: Seeded Example & Walkthrough -->
          <div class="startup-card startup-card-featured" data-act="startup-demo">
            <div class="startup-card-badge"><span class="badge primary">${ic('sparkles')} Explore Sample Data</span></div>
            <div class="startup-card-icon">${ic('compass')}</div>
            <div class="startup-card-title">Seeded Example &amp; Walkthrough</div>
            <div class="startup-card-body">
              Load realistic facility imaging projects (Multiphoton, STED, Lightsheet), instruments, PIs, milestones, and meeting notes — paired with an interactive guided tour explaining every field.
            </div>
            <button class="btn btn-tour startup-card-btn" data-act="startup-demo">
              ${ic('play')} Load Demo &amp; Start Tour
            </button>
          </div>

          <!-- Option 2: Start Fresh -->
          <div class="startup-card" data-act="startup-fresh">
            <div class="startup-card-badge"><span class="badge neutral">${ic('rocket')} Clean Slate</span></div>
            <div class="startup-card-icon">${ic('file-plus')}</div>
            <div class="startup-card-title">Start Fresh (Empty Workspace)</div>
            <div class="startup-card-body">
              Begin immediately with a clean, empty workspace ready for your own facility's projects, microscope equipment, and researcher registry. Best if you already know the app.
            </div>
            <button class="btn btn-secondary startup-card-btn" data-act="startup-fresh">
              ${ic('check')} Start with Clean Database
            </button>
          </div>
        </div>

        <div class="startup-modal-footer">
          <label class="startup-checkbox-label">
            <input type="checkbox" id="startup-never-show" ${isChecked ? 'checked' : ''} />
            <span>Never show this welcome screen again on startup</span>
          </label>
        </div>
      </div>
    `, (m, modalDim) => {
      const neverShowCheck = modalDim.querySelector('#startup-never-show');

      const savePref = () => {
        if (neverShowCheck && neverShowCheck.checked) {
          UI.storage.setItem('crm-hide-startup-modal', '1');
        } else {
          UI.storage.setItem('crm-hide-startup-modal', '0');
        }
      };

      const handleDemo = async () => {
        savePref();
        DB.seedSampleData();
        UI.closeDim(modalDim);
        route('dashboard');
        UI.toast('Sample facility dataset loaded!');
        await runAfterChoice(); // show the first-run notice before the tour takes over the screen
        startTour();
      };

      const handleFresh = () => {
        const proceed = async () => {
          savePref();
          DB.clearAllData();
          UI.closeDim(modalDim);
          route('dashboard');
          UI.toast('All facility data cleared.');
          await runAfterChoice();
        };
        if (hasAnyData()) {
          UI.confirmModal('Start Fresh?', 'This will permanently delete all existing projects, people, instruments, milestones, and meetings currently stored in this browser. This cannot be undone. Continue?', { danger: true }).then((ok) => {
            if (ok) proceed();
          });
        } else {
          proceed();
        }
      };

      modalDim.querySelectorAll('[data-act="startup-demo"]').forEach(el => {
        el.onclick = (e) => { e.stopPropagation(); handleDemo(); };
      });
      modalDim.querySelectorAll('[data-act="startup-fresh"]').forEach(el => {
        el.onclick = (e) => { e.stopPropagation(); handleFresh(); };
      });
    }, () => { runAfterChoice(); }); // dismissing the welcome modal (outside click) still shows the notice
  }

  function hasAnyData() {
    const r = DB.row('SELECT (SELECT COUNT(*) FROM projects) + (SELECT COUNT(*) FROM people) + (SELECT COUNT(*) FROM instruments) as c');
    return !!(r && r.c);
  }

  /* ---------------- Automatic Backup ---------------- */
  const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

  function isAutoBackupEnabled() { return UI.storage.getItem('auto-backup-enabled') !== '0'; }
  function supportsSilentBackupFolder() { return typeof window.showDirectoryPicker === 'function'; }

  async function refreshAutoBackupFolderStatus() {
    autoBackupFolderStatus.supported = supportsSilentBackupFolder();
    autoBackupFolderStatus.name = null;
    autoBackupFolderStatus.granted = false;
    if (!autoBackupFolderStatus.supported) return;
    try {
      const stored = await DB.getAutoBackupDirHandle();
      if (!stored || !stored.dirHandle) return;
      autoBackupFolderStatus.name = stored.parentName ? `${stored.parentName}/backups` : stored.dirHandle.name;
      autoBackupFolderStatus.granted = (await stored.dirHandle.queryPermission({ mode: 'readwrite' })) === 'granted';
    } catch (_) { /* leave as not-configured */ }
  }

  async function regrantAutoBackupFolder() {
    try {
      const stored = await DB.getAutoBackupDirHandle();
      if (!stored || !stored.dirHandle) { UI.toast('No backup folder configured', 'error'); return; }
      const perm = await stored.dirHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') { UI.toast('Permission was not granted', 'error'); return; }
      await refreshAutoBackupFolderStatus();
      UI.toast('Silent backup folder re-enabled');
      refresh();
    } catch (e) {
      UI.toast('Could not re-enable: ' + e.message, 'error');
    }
  }

  // Writes into the previously-granted "backups" subfolder with no dialog. Returns false
  // (never throws) if no folder is configured, permission has lapsed, or the write fails for
  // any reason — callers should fall back to a normal download in that case.
  async function tryWriteSilentBackup(filename, json) {
    if (!supportsSilentBackupFolder()) return false;
    try {
      const stored = await DB.getAutoBackupDirHandle();
      if (!stored || !stored.dirHandle) return false;
      const perm = await stored.dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return false; // re-granting requires a user gesture; don't prompt silently
      const fileHandle = await stored.dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      return true;
    } catch (e) {
      console.error('silent auto-backup write failed', e);
      return false;
    }
  }

  async function chooseAutoBackupFolder() {
    if (!supportsSilentBackupFolder()) {
      UI.toast('Your browser doesn’t support silent folder backups', 'error');
      return;
    }
    try {
      // The user picks the app's own folder (or any folder); we create/reuse a "backups"
      // subfolder inside it and store a handle to THAT, so writes never touch other files there.
      const parentHandle = await window.showDirectoryPicker({ id: 'core-facility-auto-backup', mode: 'readwrite' });
      const perm = await parentHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') { UI.toast('Folder permission was not granted', 'error'); return; }
      const backupsHandle = await parentHandle.getDirectoryHandle('backups', { create: true });
      await DB.saveAutoBackupDirHandle({ dirHandle: backupsHandle, parentName: parentHandle.name });
      await refreshAutoBackupFolderStatus();
      UI.toast(`Silent automatic backups enabled to "${parentHandle.name}/backups"`);
      refresh();
    } catch (e) {
      if (e && e.name !== 'AbortError') UI.toast('Could not set up the backup folder: ' + e.message, 'error');
    }
  }

  async function disableAutoBackupFolder() {
    await DB.clearAutoBackupDirHandle();
    await refreshAutoBackupFolderStatus();
    UI.toast('Silent backup folder disabled — automatic backups will download instead');
    refresh();
  }

  async function performBackupDownload(auto) {
    const data = await DB.buildBackup();
    const json = JSON.stringify(data);
    const filename = `core-facility-${auto ? 'autobackup' : 'backup'}-${new Date().toISOString().slice(0, 10)}.json`;

    if (auto) {
      const wroteSilently = await tryWriteSilentBackup(filename, json);
      UI.storage.setItem('last-auto-backup-at', new Date().toISOString());
      if (wroteSilently) {
        UI.toast('Automatic backup saved silently');
        return;
      }
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    UI.toast(auto ? 'Automatic backup downloaded (set a silent backup folder in Settings to skip the download prompt)' : 'Complete backup exported');
  }

  function maybeAutoBackup() {
    if (!isAutoBackupEnabled()) return;
    if (!hasAnyData()) return;
    const last = UI.storage.getItem('last-auto-backup-at');
    const lastTime = last ? new Date(last).getTime() : 0;
    if (Date.now() - lastTime < AUTO_BACKUP_INTERVAL_MS) return;
    performBackupDownload(true).catch((e) => console.error('auto-backup failed', e));
  }

  async function requestPersistentStorage() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const already = await navigator.storage.persisted();
        if (!already) await navigator.storage.persist();
      }
    } catch (_) { /* best-effort only */ }
  }

  /* ---------------- Boot ---------------- */
  // Storage-blocked / boot-failure guidance is OS-tailored text only; the decision to show
  // it is always feature-detection-based (DB.boot()'s persistence probe or a thrown error),
  // since file:// and locked-down browsers can occur on any OS, not just mobile.
  function storageGuidanceFor(os) {
    const fromFile = location.protocol === 'file:';
    switch (os) {
      case 'android':
        return {
          headline: 'This browser is blocking permanent saving for the app in its current location.',
          steps: [
            fromFile
              ? 'Opening the file directly (by tapping it in a file manager) is the most common cause on Android — saving needs a real web address.'
              : 'Your browser has storage disabled or restricted for this page.',
            'Open the hosted version of this app instead (ask whoever set it up for the link) using Chrome, then use the browser menu → <strong>Add to Home screen</strong> for an app-like icon that saves normally.'
          ]
        };
      case 'ios':
        return {
          headline: 'This browser is blocking permanent saving for the app in its current location.',
          steps: [
            fromFile
              ? 'Opening the file directly is the most common cause on iPad/iPhone — Safari needs a real web address to allow saving.'
              : 'Safari has storage disabled or restricted for this page (this can happen in some in-app browsers, e.g. opened from Mail or Notes).',
            'Open the hosted version of this app in <strong>Safari</strong> (ask whoever set it up for the link), then use Share → <strong>Add to Home Screen</strong> for an app-like icon that saves normally.'
          ]
        };
      case 'windows':
        return {
          headline: 'This browser is blocking permanent saving for the app in its current location.',
          steps: [
            fromFile
              ? 'Opening index.html directly by double-clicking it can trigger this in some browsers/security settings.'
              : 'Your browser has storage disabled or restricted for this page.',
            'Run the included local server (see README) or open the hosted version of this app, then reload.'
          ]
        };
      default:
        return {
          headline: 'This browser is blocking permanent saving for the app in its current location.',
          steps: [
            fromFile ? 'Opening the file directly (file://) is the most common cause.' : 'Your browser has storage disabled or restricted for this page.',
            'Open the hosted version of this app (or run a local server — see README), then reload.'
          ]
        };
    }
  }

  function renderStorageUnavailableScreen() {
    const guidance = storageGuidanceFor(UI.detectOS());
    document.getElementById('app').innerHTML = `
      <div class="boot-screen">
        <div class="boot-card">
          <div class="boot-icon">${ic('cpu')}</div>
          <h1>Storage unavailable</h1>
          <p>${guidance.headline}</p>
          <ol class="boot-steps">${guidance.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
          <p class="boot-note">Note: your data always stays on <strong>this one device/browser</strong> — it never syncs between devices or people, even once saving works. See the README for how to move data between devices.</p>
          <div class="boot-actions">
            <button class="btn btn-secondary" id="boot-continue">Continue anyway (temporary session)</button>
          </div>
          <p class="boot-fine">If you continue, anything you enter will be lost when you close this tab unless you export a backup first (Settings → Export Backup, once the app loads).</p>
        </div>
      </div>`;
    document.getElementById('boot-continue').onclick = () => {
      finishBoot({ persistent: false }).catch(renderBootError);
    };
  }

  function renderBootError(err) {
    console.error('Boot failed:', err);
    const el = document.getElementById('app');
    if (!el) return;
    const detail = esc(String((err && err.stack) || err));
    el.innerHTML = `
      <div class="boot-screen">
        <div class="boot-card boot-card-error">
          <div class="boot-icon">${ic('alert')}</div>
          <h1>Something went wrong while starting up</h1>
          <p>The app hit an unexpected error and couldn't load. Reloading usually fixes a one-off glitch.</p>
          <pre class="boot-error-detail">${detail}</pre>
          <div class="boot-actions">
            <button class="btn btn-primary" id="boot-reload">Reload</button>
          </div>
        </div>
      </div>`;
    const reloadBtn = document.getElementById('boot-reload');
    if (reloadBtn) reloadBtn.onclick = () => location.reload();
  }

  function showTemporarySessionBanner() {
    if (document.getElementById('temp-session-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'temp-session-banner';
    bar.className = 'temp-session-banner';
    bar.innerHTML = `
      <span class="temp-session-banner-ic">${ic('alert')}</span>
      <span>Temporary session — changes here won't be saved on this device. Export a backup before closing this tab.</span>
      <button class="temp-session-banner-close" aria-label="Dismiss" type="button">${ic('x')}</button>`;
    document.body.prepend(bar);
    bar.querySelector('.temp-session-banner-close').onclick = () => bar.remove();
  }

  // Up-front notice with two INDEPENDENT parts (per user request):
  //   1. The per-device data explanation — dismissible for good via "Don't show this again"
  //      (flag: crm-seen-device-notice).
  //   2. The optional silent backup-folder setup — kept in front of the user on every first
  //      boot of a session until they either actually pick a folder OR explicitly decline
  //      (flag: crm-declined-backup-folder). Merely dismissing the info text does NOT hide it.
  // The folder picker needs a real user click, so it can't be auto-triggered — hence the CTA.
  function shouldShowDeviceNotice() {
    const infoNeeded = UI.storage.getItem('crm-seen-device-notice') !== '1';
    const folderNeeded = autoBackupFolderStatus.supported
      && !autoBackupFolderStatus.name
      && UI.storage.getItem('crm-declined-backup-folder') !== '1';
    return { infoNeeded, folderNeeded, show: infoNeeded || folderNeeded };
  }

  function showDeviceNotice(parts) {
    const { infoNeeded, folderNeeded } = parts;
    return new Promise((resolve) => {
      const infoHtml = infoNeeded ? `
          <p>Your data is stored <strong>only in this browser, on this device</strong>. It does not sync between devices or people automatically.</p>
          <p>To move data to another device, or share a snapshot with a colleague, use <strong>Settings → Export Backup</strong>, then <strong>Import Backup</strong> on the other device.</p>
          <p>You can put an exported backup <em>file</em> in a cloud-synced folder (Google Drive, Dropbox, etc.) as a manual convenience — but it's a snapshot, not live sync: it's only as current as your last export, and editing on two devices before re-importing means whichever backup you import last overwrites the other device's changes.</p>` : '';
      const folderHtml = folderNeeded ? `
          <div class="card" id="device-notice-folder-card" style="background:var(--surface-2);border-style:dashed;padding:12px">
            <div style="font-weight:600;font-size:12.5px;margin-bottom:4px">${ic('folder')} Optional: silent automatic backups on this device</div>
            <div class="faint small" style="margin-bottom:8px">Pick a folder once and a dated backup writes there automatically roughly every 24 hours — no download prompts. (Also available anytime later in Settings.)</div>
            <div class="row" style="gap:8px;flex-wrap:wrap">
              <button type="button" class="btn btn-secondary btn-sm" id="device-notice-choose-folder">${ic('folder')} Choose Backup Folder</button>
              <button type="button" class="btn btn-ghost btn-sm" id="device-notice-decline-folder">Don't ask again</button>
            </div>
          </div>` : '';

      UI.openModal(`
        <div class="head"><span class="modal-title">${ic('cpu')} ${infoNeeded ? 'Before you start' : 'Set up automatic backups?'}</span></div>
        <div class="body"><div class="stack">
          ${infoHtml}
          ${folderHtml}
        </div></div>
        <div class="foot">
          ${infoNeeded ? `
          <label class="startup-checkbox-label" style="margin-right:auto">
            <input type="checkbox" id="device-notice-dont-show" />
            <span>Don't show this again</span>
          </label>` : '<span style="margin-right:auto"></span>'}
          <button class="btn btn-primary" id="device-notice-ok">${folderNeeded && !infoNeeded ? 'Not now' : 'Got it'}</button>
        </div>`, (m, dim) => {
        if (folderNeeded) {
          const folderBtn = m.querySelector('#device-notice-choose-folder');
          const declineBtn = m.querySelector('#device-notice-decline-folder');
          const folderCard = m.querySelector('#device-notice-folder-card');
          if (folderBtn) {
            folderBtn.onclick = async () => {
              await chooseAutoBackupFolder();
              // Picking a folder satisfies the CTA permanently (status.name is now set), so it
              // won't reappear. Reflect success inline instead of closing abruptly.
              if (folderCard && autoBackupFolderStatus.name && autoBackupFolderStatus.granted) {
                folderCard.innerHTML = `<div style="font-weight:600;font-size:12.5px">${ic('check')} Silent backups enabled to "${esc(autoBackupFolderStatus.name)}"</div>`;
              }
            };
          }
          if (declineBtn) {
            declineBtn.onclick = () => {
              UI.storage.setItem('crm-declined-backup-folder', '1');
              if (folderCard) folderCard.innerHTML = `<div class="faint small">No problem — you can set this up later in Settings.</div>`;
            };
          }
        }
        m.querySelector('#device-notice-ok').onclick = () => {
          const check = m.querySelector('#device-notice-dont-show');
          if (check && check.checked) UI.storage.setItem('crm-seen-device-notice', '1');
          UI.closeDim(dim);
          resolve();
        };
      }, () => resolve()); // tapping outside (easy on a touch screen) still has to unblock boot
    });
  }

  async function boot() {
    let status;
    try {
      status = await DB.boot();
    } catch (err) {
      renderBootError(err);
      return;
    }

    UI.initTheme();

    if (!status.persistent) {
      renderStorageUnavailableScreen();
      return;
    }

    await finishBoot(status);
  }

  async function finishBoot(status) {
    renderShell();
    route('dashboard');
    wireGlobal();

    if (!status.persistent) showTemporarySessionBanner();

    requestPersistentStorage();
    await refreshAutoBackupFolderStatus();
    maybeAutoBackup();
    setInterval(maybeAutoBackup, 60 * 60 * 1000);

    const noticeParts = shouldShowDeviceNotice();
    const showNotice = () => (noticeParts.show ? showDeviceNotice(noticeParts) : Promise.resolve());

    const hideStartup = UI.storage.getItem('crm-hide-startup-modal') === '1';
    if (!hideStartup) {
      openStartupModal(showNotice); // notice pops after the welcome modal, not before it
    } else {
      await showNotice();
    }
  }

  /* ---------------- Global Event Delegation ---------------- */
  function wireGlobal() {
    document.addEventListener('click', (e) => {
      const goto = e.target.closest('[data-goto]');
      if (goto && !e.target.closest('[data-act]')) {
        // If inside a modal, close modal when navigating to a project
        const openModalDim = document.querySelector('.modal-dim');
        if (openModalDim) UI.closeDim(openModalDim);
        route(goto.dataset.goto, goto.dataset.id);
        return;
      }
      const act = e.target.closest('[data-act]');
      if (act) handleAct(act.dataset.act, act);
    });

    // Editable vocabulary dropdowns: picking "Other" is a trigger, not a real value — open
    // the same "+ Add New" modal the button does, and snap the select back to whatever it
    // held before ("data-prev") so "Other" never sits there mid-flow (e.g. while the nested
    // modal is open, or if the user cancels it).
    document.addEventListener('change', (e) => {
      const sel = e.target.closest('select.vocab-select');
      if (!sel) return;
      if (sel.value === 'Other') {
        const prev = sel.dataset.prev || '';
        sel.value = prev;
        openAddVocab(sel.dataset.cat, sel.id, sel.dataset.label);
      } else {
        sel.dataset.prev = sel.value;
      }
    });
  }

  function handleAct(act, el) {
    switch (act) {
      case 'toggle-sidebar': return toggleSidebar();
      case 'theme-toggle': return UI.toggleTheme();
      case 'tour': return startTour();
      case 'open-startup-modal': return openStartupModal();
      case 'load-sample-data': {
        DB.seedSampleData();
        refresh();
        UI.toast('Sample facility dataset loaded!');
        return;
      }
      case 'clear-data': {
        UI.confirmModal('Clear All Facility Data', 'Are you sure you want to delete all projects, people, instruments, milestones, and meetings? This cannot be undone.', { danger: true }).then((yes) => {
          if (yes) {
            DB.clearAllData();
            refresh();
            UI.toast('All facility data cleared.');
          }
        });
        return;
      }
      case 'backup': return doBackup();
      case 'restore': return doRestore();
      case 'toggle-admin-mode': return toggleAdminMode();
      case 'save-billing-rates': return saveBillingRates();
      case 'save-group-discounts': return saveGroupDiscounts();
      case 'choose-auto-backup-folder': return chooseAutoBackupFolder();
      case 'disable-auto-backup-folder': return disableAutoBackupFolder();
      case 'regrant-auto-backup-folder': return regrantAutoBackupFolder();
      case 'cal-prev': return Views.navCalendar(-1);
      case 'cal-next': return Views.navCalendar(1);
      case 'cal-today': return Views.navCalendar(0);
      case 'open-today-modal': return openTodayModal();
      case 'close': {
        // Close the TOPMOST modal (so a nested "+ Add New" / "Register person" modal
        // dismisses itself, not the form underneath it).
        const dims = document.querySelectorAll('.modal-dim');
        const top = dims[dims.length - 1];
        if (top) { const cb = top._onDismiss; UI.closeDim(top); if (cb) cb(); }
        return;
      }

      // Editable vocabulary dropdowns
      case 'vocab-add': return openAddVocab(el.dataset.cat, el.dataset.target, el.dataset.label);
      case 'vocab-save': return vocabSave(el.dataset.cat, el.dataset.target);

      // Free-list dropdowns (Lab / Group, Department) — "+ Add New"
      case 'list-add': return openAddListValue(el.dataset.target, el.dataset.title);
      case 'list-save': return listAddSave(el.dataset.target);

      // Booking: register a new person without leaving the booking form
      case 'bk-add-person': return bookingAddPerson();

      // Projects CRUD
      case 'new-project': return newProject();
      case 'np-save': return npSave();
      case 'edit-project': return editProject(el.dataset.id || ctx.project);
      case 'ep-save': return epSave(el.dataset.id);
      case 'ep-add-person': return editProjectAddPerson(el.dataset.projectId);
      case 'set-project-status': return setProjectStatus(el.dataset.status);
      case 'duplicate-project': return duplicateProject(el.dataset.id || ctx.project);
      case 'delete-project': return deleteProject();

      // Clipboard
      case 'copy': return UI.copyToClipboard(el.dataset.copy, el.dataset.copyLabel || 'Copied to clipboard');

      // Exports
      case 'export-xlsx': return Exports.exportXlsx(ctx.project);
      case 'export-docx': return Exports.exportDocx(ctx.project);
      case 'export-pdf': return Exports.exportPdf(ctx.project);
      case 'export-all-xlsx': return Exports.exportAllXlsx();

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

      // Bookings (Meetings) CRUD
      case 'new-booking': return newBooking(el.dataset.date, ctx.project);
      case 'add-meeting': return newBooking(UI.today(), ctx.project);
      case 'booking-save': return bookingSave();
      case 'edit-booking': return editBooking(el.dataset.id);
      case 'booking-edit-save': return bookingEditSave(el.dataset.id);
      case 'meeting-del': return deleteMeeting(el.dataset.id);
      case 'booking-del': return deleteBookingFromModal(el.dataset.id);
      case 'email-attendees': return emailAttendees(el.dataset.id);
      case 'email-open-blank': return void (window.location.href = 'mailto:');
      case 'bom-group-revoke': return handleGroupRevoke(el.closest('.modal'), el.closest('.modal')._bomIds);
      case 'bom-group-apply': return handleGroupReapply(el.closest('.modal'), el.closest('.modal')._bomIds);

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
    const existing = DB.rows('SELECT code FROM projects WHERE code LIKE ?', [prefix + '-%']);
    let maxSeq = 0;
    for (const r of existing) {
      const m = /-(\d+)$/.exec(r.code);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    }
    const seq = (maxSeq + 1).toString().padStart(3, '0');
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
          ${vocabField({ category: 'STATUS', id: 'np-status', label: 'Status', selected: 'Initiated', placeholder: '-- Select Status --' })}
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
          <div class="reg-person-head"><span class="reg-person-avatar">${ic('user')}</span><span style="font-weight:600;font-size:12.5px">Or Register New Person / PI Now</span></div>
          <div class="grid cols-2">
            <div class="field"><label>First Name</label><input class="input" id="np-p-first" placeholder="e.g. Elena" /></div>
            <div class="field"><label>Last Name</label><input class="input" id="np-p-last" placeholder="e.g. Rostova" /></div>
          </div>
          <div class="grid cols-2 mt-8">
            ${vocabField({ category: 'PERSON_TYPES', id: 'np-p-type', label: 'Position / Role', selected: 'PI' })}
            ${listPickerField({ id: 'np-p-org', label: 'Lab / Group / Company', values: orgNames(), modalTitle: 'Lab / Group / Company' })}
          </div>
          <div class="field mt-8"><label>Email Address</label><input type="email" class="input" id="np-p-email" placeholder="elena.rostova@institute.org" /></div>
        </div>


        <div class="grid cols-2">
          ${vocabField({ category: 'MODALITY', id: 'np-modality', label: 'Modality / Technique', placeholder: '-- Select Modality --' })}
          ${vocabField({ category: 'FUNDING', id: 'np-funding', label: 'Funding Source', placeholder: '-- Select Funding --' })}
        </div>
        <div class="grid cols-2">
          ${vocabField({ category: 'SAMPLE', id: 'np-sample', label: 'Sample Type', placeholder: '-- Select Sample --' })}
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

    try {
      DB.run(`
        INSERT INTO projects (title, code, status, priority, pi_id, modality, funding, sample, flags, start_date, end_date, tags, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [title, code, status, priority, piId, modality, funding, sample, flags, start, end, tags, notes]
      );
    } catch (e) {
      UI.toast('Could not create project: ' + (e.message || 'unknown error'), 'error');
      return;
    }

    const inserted = DB.row('SELECT id FROM projects WHERE code=?', [code]);
    if (piId && inserted) {
      DB.run('INSERT OR IGNORE INTO project_people (project_id, person_id, role) VALUES (?,?,?)', [inserted.id, piId, 'Principal Investigator']);
    }
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Project created successfully');
    route('project', inserted ? inserted.id : null);
  }

  function editProject(id, selectPersonId = null) {
    const p = DB.row('SELECT * FROM projects WHERE id=?', [id]);
    if (!p) return;
    const pis = DB.rows('SELECT id, name, type, organization FROM people ORDER BY name');
    const currentFlags = (p.flags || '').split(',').filter(Boolean);
    const activePiId = selectPersonId !== null ? selectPersonId : p.pi_id;

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('edit')} Edit Project Details</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Project Title *</label><input class="input" id="ep-title" value="${esc(p.title)}" /></div>
        <div class="grid cols-3">
          <div class="field"><label>Project Code</label><input class="input" id="ep-code" value="${esc(p.code)}" /></div>
          ${vocabField({ category: 'STATUS', id: 'ep-status', label: 'Status', selected: p.status, placeholder: '-- Select Status --' })}
          <div class="field"><label>Priority</label><select class="input" id="ep-priority">${C.PRIORITY.map((pr) => `<option value="${pr}" ${pr === p.priority ? 'selected' : ''}>${pr}</option>`).join('')}</select></div>
        </div>
        
        <div class="grid cols-2">
          <div class="field">
            <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:2px">
              <label style="margin-bottom:0">Principal Investigator (PI)</label>
              <button type="button" class="btn btn-secondary btn-sm" data-act="ep-add-person" data-project-id="${p.id}" data-tooltip="Register new researcher or PI" style="padding:2px 7px;font-size:11px">
                ${ic('plus')} New Member
              </button>
            </div>
            <select class="input" id="ep-pi">
              <option value="">-- Select or None --</option>
              ${pis.map((pe) => `<option value="${pe.id}" ${pe.id === activePiId ? 'selected' : ''}>${esc(pe.name)} (${pe.type}${pe.organization ? ' • ' + esc(pe.organization) : ''})</option>`).join('')}
            </select>
          </div>
          ${vocabField({ category: 'MODALITY', id: 'ep-modality', label: 'Modality / Technique', selected: p.modality, placeholder: '-- Select Modality --' })}
        </div>
        <div class="grid cols-2">
          ${vocabField({ category: 'FUNDING', id: 'ep-funding', label: 'Funding Source', selected: p.funding, placeholder: '-- Select Funding --' })}
          ${vocabField({ category: 'SAMPLE', id: 'ep-sample', label: 'Sample Type', selected: p.sample, placeholder: '-- Select Sample --' })}
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

  function editProjectAddPerson(projectId) {
    addPerson((newPersonId) => {
      editProject(projectId, newPersonId);
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

    try {
      DB.run(`
        UPDATE projects
        SET title=?, code=?, status=?, priority=?, pi_id=?, modality=?, funding=?, sample=?, flags=?, start_date=?, end_date=?, tags=?, notes=?, updated_at=datetime('now')
        WHERE id=?`,
        [title, code, status, priority, piId, modality, funding, sample, flags, start, end, tags, notes, id]
      );
    } catch (e) {
      UI.toast('Could not save project: ' + (e.message || 'unknown error'), 'error');
      return;
    }

    if (piId) {
      DB.run('INSERT OR IGNORE INTO project_people (project_id, person_id, role) VALUES (?,?,?)', [id, piId, 'Principal Investigator']);
    }
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
    const ok = await UI.confirmModal('Delete Project', `Are you sure you want to permanently delete "${esc(p.title)}" and all its milestones, files, and custom fields? Meetings/bookings linked to this project are kept — they become facility-wide bookings rather than being deleted.`, { danger: true });
    if (!ok) return;

    // Defensive explicit cleanup as a belt-and-suspenders guard even though cascade is verified
    // working (see CLAUDE.md's cascading-deletes section) — grandchildren, children, then parent.
    const pid = ctx.project;
    DB.rows('SELECT id FROM milestones WHERE project_id=?', [pid]).forEach((ms) => {
      DB.run('DELETE FROM milestone_owners WHERE milestone_id=?', [ms.id]);
      DB.run('DELETE FROM milestone_instruments WHERE milestone_id=?', [ms.id]);
    });
    DB.run('DELETE FROM project_people WHERE project_id=?', [pid]);
    DB.run('DELETE FROM project_instruments WHERE project_id=?', [pid]);
    DB.run('DELETE FROM milestones WHERE project_id=?', [pid]);
    DB.run('DELETE FROM files WHERE project_id=?', [pid]);
    DB.run('DELETE FROM kv WHERE project_id=?', [pid]);
    // Meetings are NOT deleted — schema declares ON DELETE SET NULL, so unlink them explicitly
    // to preserve that semantics regardless of whether cascade/SET NULL actually fires.
    DB.run('UPDATE meetings SET project_id=NULL WHERE project_id=?', [pid]);

    DB.run('DELETE FROM projects WHERE id=?', [pid]);
    UI.toast('Project deleted');
    route('projects');
  }

  // Clone a project as a starting template: copies the project fields, team, instruments,
  // custom metadata, and milestones (reset to pending, dates cleared). Meetings and files
  // are historical/one-off, so they are intentionally NOT copied. Reuses generateProjectCode()
  // and the same insert + last_insert_rowid() pattern used elsewhere in this file.
  async function duplicateProject(id) {
    const src = DB.row('SELECT * FROM projects WHERE id=?', [id]);
    if (!src) { UI.toast('Project not found', 'error'); return; }

    const ok = await UI.confirmModal(
      'Duplicate Project',
      `Create a copy of "${esc(src.title)}" as a new template? This copies the project details, team, assigned instruments, custom fields, and milestones (reset to pending, dates cleared). Meetings and files are not copied.`
    );
    if (!ok) return;

    const newCode = generateProjectCode();
    try {
      DB.run(`
        INSERT INTO projects (title, code, status, priority, pi_id, modality, funding, sample, flags, start_date, end_date, tags, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [src.title + ' (Copy)', newCode, 'Initiated', src.priority, src.pi_id, src.modality, src.funding, src.sample, src.flags, null, null, src.tags, src.notes]
      );
    } catch (e) {
      UI.toast('Could not duplicate project: ' + (e.message || 'unknown error'), 'error');
      return;
    }

    const created = DB.row('SELECT id FROM projects WHERE code=?', [newCode]);
    if (!created) { UI.toast('Could not duplicate project', 'error'); return; }
    const newId = created.id;

    // Associations
    DB.rows('SELECT person_id, role FROM project_people WHERE project_id=?', [id]).forEach((r) =>
      DB.run('INSERT OR IGNORE INTO project_people (project_id, person_id, role) VALUES (?,?,?)', [newId, r.person_id, r.role]));
    DB.rows('SELECT instrument_id FROM project_instruments WHERE project_id=?', [id]).forEach((r) =>
      DB.run('INSERT OR IGNORE INTO project_instruments (project_id, instrument_id) VALUES (?,?)', [newId, r.instrument_id]));
    DB.rows('SELECT key, value FROM kv WHERE project_id=?', [id]).forEach((r) =>
      DB.run('INSERT INTO kv (project_id, key, value) VALUES (?,?,?)', [newId, r.key, r.value]));

    // Milestones — reset status to pending and clear due dates; carry over owners/instruments.
    DB.rows('SELECT * FROM milestones WHERE project_id=? ORDER BY id ASC', [id]).forEach((m) => {
      DB.run('INSERT INTO milestones (project_id, name, due_date, status, note) VALUES (?,?,?,?,?)', [newId, m.name, null, 'pending', m.note]);
      const nm = DB.row('SELECT last_insert_rowid() as id');
      if (!nm) return;
      const newMid = nm.id;
      DB.rows('SELECT person_id FROM milestone_owners WHERE milestone_id=?', [m.id]).forEach((o) =>
        DB.run('INSERT OR IGNORE INTO milestone_owners (milestone_id, person_id) VALUES (?,?)', [newMid, o.person_id]));
      DB.rows('SELECT instrument_id FROM milestone_instruments WHERE milestone_id=?', [m.id]).forEach((mi) =>
        DB.run('INSERT OR IGNORE INTO milestone_instruments (milestone_id, instrument_id) VALUES (?,?)', [newMid, mi.instrument_id]));
    });

    UI.toast('Project duplicated');
    route('project', newId);
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

  async function msDel(id) {
    const ms = DB.row('SELECT name FROM milestones WHERE id=?', [id]);
    if (!ms) return;
    const ok = await UI.confirmModal('Delete Milestone', `Delete milestone "${esc(ms.name)}"? This cannot be undone.`, { danger: true });
    if (!ok) return;

    // Defensive explicit cleanup as a belt-and-suspenders guard even though cascade is
    // verified working (see CLAUDE.md's cascading-deletes section).
    DB.run('DELETE FROM milestone_owners WHERE milestone_id=?', [id]);
    DB.run('DELETE FROM milestone_instruments WHERE milestone_id=?', [id]);
    DB.run('DELETE FROM milestones WHERE id=?', [id]);
    UI.toast('Milestone removed');
    refresh();
  }

  /* ---------------- People CRUD with Labs / Organizations ---------------- */
  function addPerson(callback = null) {
    _personSavedCallback = callback;

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('users')} Register Researcher / Staff</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Full Name *</label><input class="input" id="p-name" placeholder="e.g. Dr. Jane Doe" /></div>
        <div class="grid cols-2">
          ${vocabField({ category: 'PERSON_TYPES', id: 'p-type', label: 'Position / Role' })}
          ${listPickerField({ id: 'p-org', label: 'Lab / Group / Company', values: orgNames(), modalTitle: 'Lab / Group / Company' })}
        </div>
        <div class="grid cols-2">
          ${listPickerField({ id: 'p-dept', label: 'Department', values: deptNames(), modalTitle: 'Department' })}
          <div class="field"><label>Email Address</label><input type="email" class="input" id="p-email" placeholder="jane.doe@university.edu" /></div>
        </div>
        <div class="field"><label>Research Focus Notes</label><input class="input" id="p-note" placeholder="e.g. Single-molecule localization microscopy" /></div>
        <div class="field">
          <label class="row" style="gap:6px;align-items:center"><input type="checkbox" id="p-is-staff" /> Core Staff (billable on instrument bookings)</label>
        </div>
        <div class="field"><label>Rate ($ per hour, core staff only)</label><input type="number" min="0" step="any" class="input" id="p-rate" placeholder="0" /></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="p-save">Save Person</button>
      </div>`);
  }

  function pSave() {
    // addPerson() can be opened stacked on another modal (e.g. the booking form) — operate on
    // the TOPMOST modal, not the first one in the DOM.
    const dims = document.querySelectorAll('.modal-dim');
    const m = dims[dims.length - 1].querySelector('.modal');
    const name = m.querySelector('#p-name').value.trim();
    if (!name) { UI.toast('Name required', 'error'); return; }
    const type = m.querySelector('#p-type').value;
    const org = m.querySelector('#p-org').value.trim();
    const dept = m.querySelector('#p-dept').value.trim();
    const email = m.querySelector('#p-email').value.trim();
    const note = m.querySelector('#p-note').value.trim();
    const isStaff = m.querySelector('#p-is-staff').checked ? 1 : 0;
    const rate = Number(m.querySelector('#p-rate').value) || 0;

    DB.run('INSERT INTO people (name, type, organization, department, email, note, is_staff, rate) VALUES (?,?,?,?,?,?,?,?)', [name, type, org, dept, email, note, isStaff, rate]);
    const newPerson = DB.row('SELECT last_insert_rowid() as id');
    const newPersonId = newPerson ? newPerson.id : null;

    UI.closeDim(m.closest('.modal-dim'));
    UI.toast(`Registered ${name}`);

    if (_personSavedCallback) {
      const cb = _personSavedCallback;
      _personSavedCallback = null;
      cb(newPersonId);
    } else {
      refresh();
    }
  }

  function editPerson(id) {
    const p = DB.row('SELECT * FROM people WHERE id=?', [id]);
    if (!p) return;

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('edit')} Edit Profile</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Full Name *</label><input class="input" id="pe-name" value="${esc(p.name)}" /></div>
        <div class="grid cols-2">
          ${vocabField({ category: 'PERSON_TYPES', id: 'pe-type', label: 'Position / Role', selected: p.type })}
          ${listPickerField({ id: 'pe-org', label: 'Lab / Group / Company', values: orgNames(), selected: p.organization || '', modalTitle: 'Lab / Group / Company' })}
        </div>
        <div class="grid cols-2">
          ${listPickerField({ id: 'pe-dept', label: 'Department', values: deptNames(), selected: p.department || '', modalTitle: 'Department' })}
          <div class="field"><label>Email Address</label><input type="email" class="input" id="pe-email" value="${esc(p.email || '')}" /></div>
        </div>
        <div class="field"><label>Research Focus Notes</label><input class="input" id="pe-note" value="${esc(p.note || '')}" /></div>
        <div class="field">
          <label class="row" style="gap:6px;align-items:center"><input type="checkbox" id="pe-is-staff" ${p.is_staff ? 'checked' : ''} /> Core Staff (billable on instrument bookings)</label>
        </div>
        <div class="field"><label>Rate ($ per hour, core staff only)</label><input type="number" min="0" step="any" class="input" id="pe-rate" value="${p.rate || 0}" /></div>
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
    const dept = m.querySelector('#pe-dept').value.trim();
    const email = m.querySelector('#pe-email').value.trim();
    const note = m.querySelector('#pe-note').value.trim();
    const isStaff = m.querySelector('#pe-is-staff').checked ? 1 : 0;
    const rate = Number(m.querySelector('#pe-rate').value) || 0;

    DB.run('UPDATE people SET name=?, type=?, organization=?, department=?, email=?, note=?, is_staff=?, rate=? WHERE id=?', [name, type, org, dept, email, note, isStaff, rate, id]);
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Person updated');
    refresh();
  }

  async function deletePerson(id) {
    const p = DB.row('SELECT name, is_staff FROM people WHERE id=?', [id]);
    if (!p) return;
    const ok = await UI.confirmModal('Delete Person', `Are you sure you want to remove "${esc(p.name)}"? This unlinks them from projects and milestones, and removes them from meeting attendee/staff records.` +
      (p.is_staff ? ' Saved bookings they were billable staff on keep their historical snapshot amounts — only the link to this person is removed.' : ''), { danger: true });
    if (!ok) return;

    // Defensive explicit cleanup as a belt-and-suspenders guard even though cascade is
    // verified working (see CLAUDE.md's cascading-deletes section).
    DB.run('DELETE FROM project_people WHERE person_id=?', [id]);
    DB.run('DELETE FROM milestone_owners WHERE person_id=?', [id]);
    // meeting_people/meeting_staff drive meetings.attendees (a denormalized display string) —
    // recompute it for every affected meeting from the remaining join rows before removing this
    // person's rows, so the display string and the join table stay in sync (see CLAUDE.md).
    const affectedMeetingIds = DB.rows(
      'SELECT DISTINCT meeting_id FROM meeting_people WHERE person_id=?', [id]
    ).map((r) => r.meeting_id);
    DB.run('DELETE FROM meeting_people WHERE person_id=?', [id]);
    DB.run('DELETE FROM meeting_staff WHERE person_id=?', [id]);
    affectedMeetingIds.forEach((mid) => {
      const names = DB.rows(
        'SELECT p.name FROM meeting_people mp JOIN people p ON p.id = mp.person_id WHERE mp.meeting_id=?', [mid]
      ).map((r) => r.name).join(', ');
      DB.run('UPDATE meetings SET attendees=? WHERE id=?', [names, mid]);
    });
    // projects.pi_id has no REFERENCES/foreign key clause in the schema, so a dangling reference
    // would otherwise silently survive the person's deletion.
    DB.run('UPDATE projects SET pi_id=NULL WHERE pi_id=?', [id]);

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
        ${vocabField({ category: 'MODALITY', id: 'i-kind', label: 'Modality / Technique' })}
        <div class="field"><label>Operational Status</label><select class="input" id="i-status">${C.INSTRUMENT_STATUS.map((s) => `<option value="${s}">${s}</option>`).join('')}</select></div>
        <div class="grid cols-2">
          <div class="field"><label>Location</label><input class="input" id="i-location" placeholder="e.g. Room 204" /></div>
          <div class="field"><label>Configuration Notes</label><input class="input" id="i-note" placeholder="e.g. 405/488/561/633nm lasers" /></div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label>Cost</label><input type="number" min="0" step="any" class="input" id="i-cost" placeholder="0" /></div>
          ${vocabField({ category: 'UNIT', id: 'i-cost-unit', label: 'Billed per', selected: 'time', placeholder: '-- Select Unit --' })}
        </div>
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
    DB.run('INSERT INTO instruments (name, kind, status, location, note, cost, cost_unit) VALUES (?,?,?,?,?,?,?)',
      [name, m.querySelector('#i-kind').value, m.querySelector('#i-status').value, m.querySelector('#i-location').value.trim(), m.querySelector('#i-note').value.trim(),
       Number(m.querySelector('#i-cost').value) || 0, m.querySelector('#i-cost-unit').value || 'time']);
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
        ${vocabField({ category: 'MODALITY', id: 'ie-kind', label: 'Modality / Technique', selected: inst.kind })}
        <div class="field"><label>Operational Status</label><select class="input" id="ie-status">${C.INSTRUMENT_STATUS.map((s) => `<option value="${s}" ${s === inst.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="grid cols-2">
          <div class="field"><label>Location</label><input class="input" id="ie-location" value="${esc(inst.location || '')}" /></div>
          <div class="field"><label>Configuration Notes</label><input class="input" id="ie-note" value="${esc(inst.note || '')}" /></div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label>Cost</label><input type="number" min="0" step="any" class="input" id="ie-cost" value="${inst.cost || 0}" /></div>
          ${vocabField({ category: 'UNIT', id: 'ie-cost-unit', label: 'Billed per', selected: inst.cost_unit || 'time', placeholder: '-- Select Unit --' })}
        </div>
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
    DB.run('UPDATE instruments SET name=?, kind=?, status=?, location=?, note=?, cost=?, cost_unit=? WHERE id=?',
      [name, m.querySelector('#ie-kind').value, m.querySelector('#ie-status').value, m.querySelector('#ie-location').value.trim(), m.querySelector('#ie-note').value.trim(),
       Number(m.querySelector('#ie-cost').value) || 0, m.querySelector('#ie-cost-unit').value || 'time', id]);
    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Instrument updated');
    refresh();
  }

  async function deleteInstrument(id) {
    const i = DB.row('SELECT name FROM instruments WHERE id=?', [id]);
    if (!i) return;
    const ok = await UI.confirmModal('Delete Instrument', `Are you sure you want to delete "${esc(i.name)}"? This unlinks it from projects and milestones. Bookings that included this instrument lose its line item — their saved totals keep the historical snapshot amounts.`, { danger: true });
    if (!ok) return;

    // Defensive explicit cleanup as a belt-and-suspenders guard even though cascade is
    // verified working (see CLAUDE.md's cascading-deletes section).
    DB.run('DELETE FROM project_instruments WHERE instrument_id=?', [id]);
    DB.run('DELETE FROM milestone_instruments WHERE instrument_id=?', [id]);
    DB.run('DELETE FROM meeting_instruments WHERE instrument_id=?', [id]);
    DB.run('DELETE FROM instruments WHERE id=?', [id]);
    UI.toast('Instrument deleted');
    refresh();
  }

  /* ---------------- Collaborators Linking ---------------- */
  function addProjectPerson() {
    const assigned = DB.rows('SELECT person_id FROM project_people WHERE project_id=?', [ctx.project]).map((r) => r.person_id);
    const available = DB.rows('SELECT id, name, type, organization FROM people ORDER BY name').filter((p) => !assigned.includes(p.id));

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('users')} Add Team Member</span></div>
      <div class="body"><div class="stack">
        <div class="field">
          <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:2px">
            <label style="margin-bottom:0">Select Person *</label>
            <button type="button" class="btn btn-secondary btn-sm" data-act="ep-add-person" data-project-id="${ctx.project}" data-tooltip="Register new researcher or staff" style="padding:2px 7px;font-size:11px">
              ${ic('plus')} New Person
            </button>
          </div>
          <select class="input" id="app-person-id">
            ${available.length ? available.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.type}${p.organization ? ' • ' + esc(p.organization) : ''})</option>`).join('') : '<option value="">-- No available unregistered people --</option>'}
          </select>
        </div>
        ${vocabField({ category: 'ROLE', id: 'app-person-role', label: 'Role on Project', placeholder: '-- Select Role --' })}
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="app-person-save" ${!available.length ? 'disabled' : ''}>Add Member</button>
      </div>`);
  }

  function appPersonSave() {
    const m = document.querySelector('.modal');
    const personId = Number(m.querySelector('#app-person-id').value);
    if (!personId) { UI.toast('Please select a person', 'error'); return; }
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

  /* ---------------- Bookings (Meetings) CRUD — any date, any object, optional project ---------------- */

  // Group/Lab selector: filters the Assign People picker down to one lab (institute-scale
  // relief from an every-person dropdown) and drives the standing group discount. "-- All
  // groups --" clears the filter and, with it, any group discount.
  function groupSelectField(id, selected) {
    return `<div class="field">
      <label>Group / Lab</label>
      <select class="input" id="${id}">
        <option value="">-- All groups --</option>
        ${orgNames().map((o) => `<option value="${esc(o)}" ${o === selected ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select>
    </div>`;
  }

  /* People / instrument options for the booking token-pickers.
     `meta` shows next to the dropdown option; `tip` is the hover tooltip
     (person → role, instrument → modality). */
  function bkPeopleItems() {
    return DB.rows('SELECT id, name, type, organization, department FROM people ORDER BY name')
      .map((r) => ({
        id: r.id,
        name: r.name,
        org: r.organization || '', // discrete field for the Group/Lab filter — `meta` below is just for display
        meta: [r.organization, r.department].filter(Boolean).join(' · ') || r.type || '',
        tip: r.type || 'Person'
      }));
  }
  function bkInstItems() {
    return DB.rows('SELECT id, name, kind FROM instruments ORDER BY name')
      .map((r) => ({ id: r.id, name: r.name, meta: r.kind || '', tip: r.kind || 'Instrument' }));
  }
  // Core Staff are the billable-by-the-hour assignees (people.is_staff=1) — a separate picker
  // from the plain "Assign People" attendee list above, which is never billed.
  function bkStaffItems() {
    return DB.rows('SELECT id, name, rate, organization, department FROM people WHERE is_staff=1 ORDER BY name')
      .map((r) => ({
        id: r.id, name: r.name, rate: r.rate || 0,
        org: r.organization || '', // discrete field for the Group/Lab filter — `meta` below is just for display
        meta: [r.organization, r.department].filter(Boolean).join(' · '), tip: 'Core Staff — ' + fmtMoney(r.rate || 0) + '/hr'
      }));
  }

  /* ---------------- Booking cost math (bill of materials) ----------------
     Plain-language walkthrough of every number below, since this is money math that has to be
     auditable, not just "works":
       1. Booking hours = how long the instrument is reserved for, as a decimal number of hours
          (9:00 to 11:30 is 2.5 hours). No start+end time on the booking → 0 hours.
       2. Each instrument bills either by that duration (unit "time", e.g. $/hour) or by a
          manually-typed amount (any other unit — $/sample, $/gram, etc).
       3. Each core-staff assignee bills by their OWN window inside the booking (left blank =
          the full booking window), but never less than 1 hour, and always rounded UP to a whole
          hour beyond that — so 10 minutes bills as 1 hour, and 65 minutes bills as 2 hours.
       4. Discounts — a standing per-lab percent plus a manual admin override, added together —
          apply ONLY to the time-billed instrument cost, never to staff time or to per-unit/
          per-weight instrument costs.
       5. What's left after the discount then has BOTH overhead percentages (internal + external)
          added on top of it — that "before tax" figure is what a facility would actually invoice
          before any tax line — and finally the tax percentage is added on top of THAT to get the
          final total. */
  function fmtMoney(n) {
    const cur = DB.getConfig('currency', '$');
    return cur + (Number(n) || 0).toFixed(2);
  }
  // "HH:MM" -> minutes since midnight, or null if not a valid time.
  function timeToMinutes(hhmm) {
    const mm = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    return mm ? Number(mm[1]) * 60 + Number(mm[2]) : null;
  }
  // Hours between two "HH:MM" times; missing or non-positive spans count as 0 hours.
  function hoursBetween(start, end) {
    const a = timeToMinutes(start), b = timeToMinutes(end);
    if (a == null || b == null || b <= a) return 0;
    return (b - a) / 60;
  }
  // The 1-hour floor: any staff time above zero bills at least 1 hour, and anything past that
  // rounds UP to the next whole hour.
  function billableStaffHours(rawHours) {
    return rawHours > 0 ? Math.max(1, Math.ceil(rawHours)) : 0;
  }
  function computeBookingBOM({ start, end, instruments, staff, groupPct, manualPct, rates }) {
    const bookingHours = hoursBetween(start, end);
    const ohInternal = (rates && rates.ohInternal) || 0;
    const ohExternal = (rates && rates.ohExternal) || 0;
    const taxPct = (rates && rates.taxPct) || 0;

    let instrTime = 0, instrAmount = 0;
    const instrumentLines = (instruments || []).map((it) => {
      const isTime = (it.cost_unit || 'time') === 'time';
      const line = isTime ? (it.cost || 0) * bookingHours : (it.cost || 0) * (Number(it.amount) || 0);
      if (isTime) instrTime += line; else instrAmount += line;
      return Object.assign({}, it, { isTime, line });
    });

    let staffTotal = 0;
    const staffLines = (staff || []).map((p) => {
      const rawHours = (p.start && p.end) ? hoursBetween(p.start, p.end) : bookingHours;
      const billHours = billableStaffHours(rawHours);
      const line = (p.rate || 0) * billHours;
      staffTotal += line;
      return Object.assign({}, p, { rawHours, billHours, line });
    });

    const subtotal = instrTime + instrAmount + staffTotal;
    const discPct = Math.min(100, (groupPct || 0) + (manualPct || 0));
    const discountAmt = instrTime * (discPct / 100);
    const afterDiscount = subtotal - discountAmt;
    const overheadPct = ohInternal + ohExternal;
    const overheadAmt = afterDiscount * (overheadPct / 100);
    const beforeTax = afterDiscount + overheadAmt;
    const taxAmt = beforeTax * (taxPct / 100);
    const total = beforeTax + taxAmt;

    return {
      bookingHours, instrumentLines, staffLines, instrTime, instrAmount, staffTotal, subtotal,
      groupPct: groupPct || 0, manualPct: manualPct || 0, discPct, discountAmt, afterDiscount,
      ohInternal, ohExternal, overheadAmt, beforeTax, taxPct, taxAmt, total
    };
  }

  function tokenPickerField(kind, label, addLabel) {
    return `<div class="field"><label>${label}</label>
      <div class="token-picker" data-kind="${kind}" data-add="${esc(addLabel)}">
        <div class="token-list"></div>
        <select class="input token-select"></select>
      </div></div>`;
  }
  function rteField(id) {
    return `<div class="field"><label>Notes</label>
      <div class="rte">
        <div class="rte-toolbar">
          <button type="button" class="rte-btn" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
          <button type="button" class="rte-btn" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
          <button type="button" class="rte-btn" data-cmd="insertUnorderedList" title="Bullet list">&bull;</button>
          <select class="rte-size" title="Font size">
            <option value="">Size</option>
            <option value="0.85em">Small</option>
            <option value="1em">Normal</option>
            <option value="1.25em">Large</option>
            <option value="1.6em">Huge</option>
          </select>
        </div>
        <div class="rte-editor input" id="${id}" contenteditable="true" data-placeholder="Short notes, bullet points, action context…"></div>
      </div></div>`;
  }

  // Transient "you can't do that yet" hint: a rounded toast-like box anchored next to the
  // control that blocked the click, auto-dismissed a moment later. Used when the Assign
  // People dropdown is locked pending a Group/Lab pick.
  let lockHintTimer = null;
  function showLockHint(anchor, text) {
    let hint = document.querySelector('.lock-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'lock-hint';
      document.body.appendChild(hint);
    }
    const r = anchor.getBoundingClientRect();
    hint.textContent = text;
    hint.style.left = (r.right + 8) + 'px';
    hint.style.top = (r.top + r.height / 2) + 'px';
    hint.classList.add('show');
    clearTimeout(lockHintTimer);
    lockHintTimer = setTimeout(() => hint.classList.remove('show'), 1600);
  }

  /* Token-picker: <select> of not-yet-picked items + accumulating removable badges.
     Source of truth is the badge DOM; `wrap._setSelected(ids)` seeds it (edit mode).

     Instrument precheck: the first time the user (not `_setSelected` seeding an edit modal)
     picks an instrument, we ask whether the booking only needs that one. Answering yes "locks"
     the picker — the dropdown is disabled so no further instrument can be added — until the
     user removes that instrument badge, which unlocks it again. */
  function mountTokenPicker(m, kind, items, onChange) {
    const wrap = m.querySelector(`.token-picker[data-kind="${kind}"]`);
    if (!wrap) return;
    const list = wrap.querySelector('.token-list');
    const sel = wrap.querySelector('.token-select');
    const addLabel = wrap.dataset.add || '+ Add…';
    const byId = new Map(items.map((it) => [String(it.id), it]));
    const selected = new Set();
    let locked = false, lockMsg = '';
    let filterFn = null; // narrows the dropdown only — an already-picked badge never disappears
    let singleInstrumentLock = false; // 'inst' picker only — set once the user confirms one instrument is enough

    function render() {
      list.innerHTML = [...selected].map((id) => {
        const it = byId.get(id);
        if (!it) return '';
        return `<span class="token" data-id="${id}" data-tooltip="${esc(it.tip)}">` +
          `<button type="button" class="token-x" aria-label="Remove ${esc(it.name)}">&times;</button>${esc(it.name)}</span>`;
      }).join('');
      let avail = items.filter((it) => !selected.has(String(it.id)));
      if (filterFn) avail = avail.filter(filterFn);
      sel.innerHTML = `<option value="">${esc(singleInstrumentLock ? 'Remove the instrument above to add another' : addLabel)}</option>` +
        avail.map((it) => `<option value="${it.id}">${esc(it.name)}${it.meta ? ' — ' + esc(it.meta) : ''}</option>`).join('');
      sel.value = '';
      sel.disabled = singleInstrumentLock;
      // Cost-relevant pickers (instruments/staff) pass this so the BOM re-renders whenever the
      // selection itself changes; the attendees picker doesn't bother — it isn't billed.
      if (onChange) onChange();
    }
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      selected.add(sel.value);
      render();
      // Ask only the first time an instrument is picked by hand (not when an edit modal seeds
      // existing badges via _setSelected) — and only while it's the sole instrument selected.
      if (kind === 'inst' && selected.size === 1) {
        UI.confirmModal(
          'Single Instrument Booking?',
          'Is only one instrument needed for this booking? If yes, you won’t be able to add another instrument until you remove this one.'
        ).then((ok) => { if (ok && selected.size === 1) { singleInstrumentLock = true; render(); } });
      }
    });
    // Blocks opening the native dropdown while locked (e.g. no Group/Lab picked yet) —
    // preventDefault on mousedown stops the browser from popping the option list open, and
    // Enter/Space (keyboard) gets the same treatment. Already-picked badges are unaffected.
    sel.addEventListener('mousedown', (e) => {
      if (!locked) return;
      e.preventDefault();
      showLockHint(sel, lockMsg);
    });
    sel.addEventListener('keydown', (e) => {
      if (!locked || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      showLockHint(sel, lockMsg);
    });
    wrap._setLocked = (isLocked, msg) => {
      locked = !!isLocked;
      lockMsg = msg || '';
      sel.classList.toggle('locked', locked);
    };
    list.addEventListener('click', (e) => {
      const x = e.target.closest('.token-x');
      if (!x) return;
      selected.delete(x.parentElement.dataset.id);
      if (kind === 'inst' && selected.size === 0) singleInstrumentLock = false;
      render();
    });
    wrap._setSelected = (ids) => {
      selected.clear();
      (ids || []).forEach((id) => { if (byId.has(String(id))) selected.add(String(id)); });
      render();
    };
    // Add a brand-new option (e.g. a person just registered from the nested modal) and select it.
    wrap._addItem = (it) => {
      if (!byId.has(String(it.id))) { items.push(it); byId.set(String(it.id), it); }
      selected.add(String(it.id));
      render();
    };
    // Narrow the dropdown to items matching `fn` (e.g. a Group/Lab filter). Pass null/undefined
    // to clear it. Never touches already-selected badges — only the "not yet picked" dropdown.
    wrap._setFilter = (fn) => { filterFn = fn || null; render(); };
    render();
  }
  function readTokenIds(m, kind) {
    return [...m.querySelectorAll(`.token-picker[data-kind="${kind}"] .token-list .token`)].map((t) => Number(t.dataset.id));
  }

  /* Register a new person from inside the booking modal — reuses the standard addPerson()
     modal (which itself has a "+ Add New" lab picker) and drops the result straight into the
     People picker as a selected badge, so several new people can be added in a row. */
  function bookingAddPerson() {
    const bookingModal = document.querySelector('.modal-dim:last-of-type .modal') || document.querySelector('.modal');
    addPerson((newPersonId) => {
      if (newPersonId == null) return;
      const p = DB.row('SELECT id, name, type, organization, department FROM people WHERE id=?', [newPersonId]);
      if (!p) return;
      const picker = bookingModal && bookingModal.querySelector('.token-picker[data-kind="owner"]');
      if (picker && picker._addItem) {
        picker._addItem({
          id: p.id, name: p.name, tip: p.type || 'Person',
          meta: [p.organization, p.department].filter(Boolean).join(' · ') || p.type || ''
        });
      } else {
        refresh();
      }
    });
  }

  /* Minimal rich-text editor for meeting notes. Uses execCommand (deprecated but universally
     supported, fine for a local offline app); output is whitelisted by UI.sanitizeHtml on save. */
  function mountRichText(m, id) {
    const editor = m.querySelector('#' + id);
    if (!editor) return;
    const bar = editor.closest('.rte').querySelector('.rte-toolbar');
    bar.querySelectorAll('.rte-btn').forEach((b) => {
      b.addEventListener('mousedown', (e) => e.preventDefault());     // keep the selection
      b.addEventListener('click', () => { editor.focus(); document.execCommand(b.dataset.cmd, false, null); });
    });
    const sizeSel = bar.querySelector('.rte-size');
    sizeSel.addEventListener('change', () => {
      const v = sizeSel.value;
      sizeSel.value = '';
      if (!v) return;
      editor.focus();
      applyFontSize(editor, v);
    });
    editor.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); document.execCommand('bold'); }
      else if (k === 'i') { e.preventDefault(); document.execCommand('italic'); }
    });
    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, t);
    });
  }
  function applyFontSize(editor, value) {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return;
    document.execCommand('fontSize', false, '7');
    editor.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement('span');
      span.style.fontSize = value;
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
    });
  }
  function readNote(m, id) {
    return UI.sanitizeHtml(m.querySelector('#' + id).innerHTML);
  }

  /* ---------------- Booking cost breakdown (live BOM in the modal) ----------------
     Row structure (which instruments/staff have a row at all) is only rebuilt when the
     picker SELECTION changes — via the `onChange` hook on mountTokenPicker — so typing into
     an amount/time input never gets wiped mid-keystroke. Every other change (booking time,
     project, discount, or one of those inputs) just recomputes the numbers in place via
     recomputeBomTotals. `m._bom` is the small piece of state that survives both: per-id
     instrument amounts, per-id staff partial windows, and the manual discount. */
  function bomSectionHtml(prefix, adminOn) {
    return `
    <div class="card mt-8" id="${prefix}-bom" style="background:var(--surface-2)">
      <div class="card-title" style="font-size:13px">${ic('tag')} Cost & Time Breakdown</div>
      <div class="faint small mb-8">Instruments</div>
      <div id="${prefix}-bom-instruments"></div>
      <div class="faint small mt-8 mb-8">Core Staff</div>
      <div id="${prefix}-bom-staff"></div>
      ${adminOn ? `
      <div class="field mt-8" style="max-width:240px">
        <label>Manual Discount % <span class="faint">(admin override, instrument time only)</span></label>
        <input type="number" min="0" max="100" step="1" class="input" id="${prefix}-discount" value="0" />
      </div>` : ''}
      <div class="mt-8" id="${prefix}-bom-summary"></div>
    </div>`;
  }

  // Narrows the Assign People / Assign Core Staff dropdowns to one lab — an institute-scale
  // relief valve so neither picker lists every person in the building. Already-selected badges
  // are unaffected (mountTokenPicker's _setFilter only ever narrows the *dropdown*, never hides
  // a badge), so switching labs mid-booking never drops a cross-lab collaborator or staff member
  // you'd already picked.
  //
  // Group/Lab itself is mandatory, not optional — every booking either gets it typed in directly
  // or auto-filled from its project's PI (applyProjectDrivenGroup), and both people and core
  // staff belong to a facility group, so neither picker can be used before one is set: no group
  // picked yet locks both dropdowns (not-allowed cursor + "Choose Group/Lab First" hint).
  function filterOwnerPickerByGroup(m, org) {
    ['owner', 'staff'].forEach((kind) => {
      const wrap = m.querySelector(`.token-picker[data-kind="${kind}"]`);
      if (!wrap) return;
      if (wrap._setFilter) wrap._setFilter(org ? (it) => it.org === org : null);
      if (wrap._setLocked) wrap._setLocked(!org, 'Choose Group/Lab First');
    });
  }

  // The "offer" path: a lab is chosen (by hand, or auto-filled from a project's PI) and its
  // CURRENT standing discount is looked up fresh and applied. Used for new bookings and for
  // any live change to the Group or Project select — i.e. whenever the user is actively
  // choosing a lab, not just reopening a booking that already recorded one.
  function offerGroupDiscount(m, ids, org) {
    const groupEl = m.querySelector('#' + ids.group);
    if (groupEl && groupEl.value !== (org || '')) groupEl.value = org || '';
    filterOwnerPickerByGroup(m, org);
    m._bom.groupOrg = org || '';
    m._bom.groupPct = DB.getGroupDiscount(org);
    recomputeBomTotals(m, ids);
  }

  // The "restore" path: seed the modal from a SAVED booking's own group_org/group_discount_pct
  // snapshot rather than re-querying the lab's current standing rate — so reopening a booking
  // where the discount was revoked (see chooseDiscountScope below) doesn't silently re-offer
  // it. Only touching the Group select yourself re-triggers the live "offer" path above.
  function restoreGroupState(m, ids, org, pct) {
    const groupEl = m.querySelector('#' + ids.group);
    if (groupEl) groupEl.value = org || '';
    filterOwnerPickerByGroup(m, org);
    m._bom.groupOrg = org || '';
    m._bom.groupPct = pct || 0;
    recomputeBomTotals(m, ids);
  }

  // Project → Group auto-fill: picking a project fills the Group select from that project's
  // PI's lab (blank if the project has no PI, or no project is selected) and offers that lab's
  // discount. Runs on the Project select's own change, and once at mount for a pre-selected one.
  function applyProjectDrivenGroup(m, ids) {
    const projectEl = m.querySelector('#' + ids.project);
    const pid = projectEl && projectEl.value ? Number(projectEl.value) : null;
    const r = pid ? DB.row('SELECT o.organization as org FROM projects p LEFT JOIN people o ON o.id = p.pi_id WHERE p.id=?', [pid]) : null;
    offerGroupDiscount(m, ids, (r && r.org) || '');
  }

  // Revoking a lab's discount on one booking is ambiguous about scope, so ask: just this
  // booking (session-only — the lab's standing rate in Settings is untouched), or every future
  // booking too (writes DB.setGroupDiscount(org, 0), same as editing it in Settings directly).
  // Mirrors UI.confirmModal's promise-that-resolves-null-on-dismiss shape, with a 3rd choice.
  function chooseDiscountScope(org) {
    return new Promise((resolve) => {
      const m = UI.openModal(`
        <div class="head"><span class="t" style="font-weight:600">Remove ${esc(org)}’s Discount</span></div>
        <div class="body"><p class="mt-0 mb-8">Remove it just for this booking, or for every future booking under <strong>${esc(org)}</strong> too? Applying it to future bookings changes that lab’s standing discount in Settings.</p></div>
        <div class="foot">
          <button class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button class="btn btn-secondary" data-act="once">Just This Booking</button>
          <button class="btn btn-danger" data-act="future">Apply to Future Too</button>
        </div>`, null, () => resolve(null));
      const dim = m.closest('.modal-dim');
      m.querySelector('[data-act="cancel"]').onclick = () => { UI.closeDim(dim); resolve(null); };
      m.querySelector('[data-act="once"]').onclick = () => { UI.closeDim(dim); resolve('once'); };
      m.querySelector('[data-act="future"]').onclick = () => { UI.closeDim(dim); resolve('future'); };
    });
  }

  async function handleGroupRevoke(m, ids) {
    const org = m._bom.groupOrg;
    const scope = await chooseDiscountScope(org);
    if (!scope) return;
    m._bom.groupPct = 0;
    if (scope === 'future') {
      DB.setGroupDiscount(org, 0);
      UI.toast(`${org}’s standing discount removed going forward`);
    } else {
      UI.toast('Discount removed for this booking');
    }
    recomputeBomTotals(m, ids);
  }

  function handleGroupReapply(m, ids) {
    m._bom.groupPct = DB.getGroupDiscount(m._bom.groupOrg);
    recomputeBomTotals(m, ids);
  }

  function renderBomRows(m, ids) {
    const instIds = readTokenIds(m, 'inst');
    const staffIds = readTokenIds(m, 'staff');
    const instItems = instIds.length ? DB.rows(`SELECT id, name, cost, cost_unit FROM instruments WHERE id IN (${instIds.map(() => '?').join(',')})`, instIds) : [];
    const staffItems = staffIds.length ? DB.rows(`SELECT id, name, rate FROM people WHERE id IN (${staffIds.map(() => '?').join(',')})`, staffIds) : [];

    // Drop stashed values for ids that are no longer selected (their row is gone); keep the
    // rest so amounts/partial-times typed for still-selected items survive this rebuild.
    Object.keys(m._bom.instrAmounts).forEach((k) => { if (!instIds.includes(Number(k))) delete m._bom.instrAmounts[k]; });
    Object.keys(m._bom.staffWindows).forEach((k) => { if (!staffIds.includes(Number(k))) delete m._bom.staffWindows[k]; });

    const instHost = m.querySelector('#' + ids.prefix + '-bom-instruments');
    if (instHost) {
      instHost.innerHTML = !instItems.length ? '<div class="faint small">No instruments assigned yet.</div>' : instItems.map((it) => {
        const isTime = (it.cost_unit || 'time') === 'time';
        const amt = m._bom.instrAmounts[it.id] != null ? m._bom.instrAmounts[it.id] : 0;
        return `<div class="row mb-8" style="gap:8px;align-items:center">
          <span class="grow small">${esc(it.name)} <span class="faint">(${esc(it.cost_unit || 'time')})</span></span>
          <span class="mono small faint" style="width:70px">${fmtMoney(it.cost)}${isTime ? '/hr' : ''}</span>
          ${isTime
            ? `<span class="mono small bom-hours" data-id="${it.id}" style="width:80px">0.00 hrs</span>`
            : `<input type="number" min="0" step="any" class="input bom-amount" data-id="${it.id}" value="${amt}" placeholder="amount" style="width:90px" />`}
          <span class="mono font-medium bom-line" data-id="${it.id}" style="width:90px;text-align:right">${fmtMoney(0)}</span>
        </div>`;
      }).join('');
    }

    const staffHost = m.querySelector('#' + ids.prefix + '-bom-staff');
    if (staffHost) {
      staffHost.innerHTML = !staffItems.length ? '<div class="faint small">No core staff assigned yet.</div>' : staffItems.map((p) => {
        const win = m._bom.staffWindows[p.id] || {};
        return `<div class="row mb-8" style="gap:8px;align-items:center">
          <span class="grow small">${esc(p.name)}</span>
          <span class="mono small faint" style="width:70px">${fmtMoney(p.rate)}/hr</span>
          <input type="time" class="input bom-staff-start" data-id="${p.id}" value="${esc(win.start || '')}" placeholder="full booking" style="width:105px" data-tooltip="Leave blank to bill this person for the entire booking window" />
          <input type="time" class="input bom-staff-end" data-id="${p.id}" value="${esc(win.end || '')}" placeholder="full booking" style="width:105px" />
          <span class="mono small faint bom-billhours" data-id="${p.id}" style="width:110px">0 hrs</span>
          <span class="mono font-medium bom-line" data-id="${p.id}" style="width:90px;text-align:right">${fmtMoney(0)}</span>
        </div>`;
      }).join('');
    }
  }

  function recomputeBomTotals(m, ids) {
    const instIds = readTokenIds(m, 'inst');
    const staffIds = readTokenIds(m, 'staff');
    const instItems = instIds.length ? DB.rows(`SELECT id, name, cost, cost_unit FROM instruments WHERE id IN (${instIds.map(() => '?').join(',')})`, instIds) : [];
    const staffItems = staffIds.length ? DB.rows(`SELECT id, name, rate FROM people WHERE id IN (${staffIds.map(() => '?').join(',')})`, staffIds) : [];

    const start = (m.querySelector('#' + ids.start) || {}).value || '';
    const end = (m.querySelector('#' + ids.end) || {}).value || '';

    const instrumentsForCalc = instItems.map((it) => Object.assign({}, it, { amount: m._bom.instrAmounts[it.id] || 0 }));
    const staffForCalc = staffItems.map((p) => {
      const win = m._bom.staffWindows[p.id] || {};
      return Object.assign({}, p, { start: win.start || '', end: win.end || '' });
    });

    const rates = {
      ohInternal: DB.getConfigNum('overhead_internal', 0),
      ohExternal: DB.getConfigNum('overhead_external', 0),
      taxPct: DB.getConfigNum('tax_pct', 0)
    };
    const bom = computeBookingBOM({
      start, end, instruments: instrumentsForCalc, staff: staffForCalc,
      groupPct: m._bom.groupPct || 0, manualPct: m._bom.manualPct || 0, rates
    });
    m._bom.last = bom; // read back at save time so the stored total matches what's on screen

    bom.instrumentLines.forEach((line) => {
      const hoursEl = m.querySelector(`.bom-hours[data-id="${line.id}"]`);
      if (hoursEl) hoursEl.textContent = bom.bookingHours.toFixed(2) + ' hrs';
      const lineEl = m.querySelector(`.bom-line[data-id="${line.id}"]`);
      if (lineEl) lineEl.textContent = fmtMoney(line.line);
    });
    bom.staffLines.forEach((line) => {
      const bhEl = m.querySelector(`.bom-billhours[data-id="${line.id}"]`);
      if (bhEl) bhEl.textContent = line.billHours + (line.billHours === 1 ? ' hr' : ' hrs') + (line.rawHours > 0 && line.rawHours < 1 ? ' (1hr floor)' : '');
      const lineEl = m.querySelector(`.bom-line[data-id="${line.id}"]`);
      if (lineEl) lineEl.textContent = fmtMoney(line.line);
    });

    const summaryEl = m.querySelector('#' + ids.prefix + '-bom-summary');
    if (summaryEl) {
      const row = (label, value, opts2) => `<div class="row" style="justify-content:space-between${opts2 && opts2.strong ? ';border-top:1px solid var(--border);padding-top:4px;margin-top:4px' : ''}"><span class="${opts2 && opts2.strong ? 'font-medium' : 'faint'} small">${label}</span><span class="mono${opts2 && opts2.strong ? ' font-medium' : ''}" ${opts2 && opts2.big ? 'style="font-size:15px"' : ''}>${value}</span></div>`;

      // The lab's own standing rate (unaffected by any revoke on THIS booking) decides whether
      // there's anything to toggle: nothing to revoke if the lab has no discount at all; nothing
      // to re-apply once "future too" has actually zeroed the standing rate.
      const org = m._bom.groupOrg;
      const standingPct = org ? DB.getGroupDiscount(org) : 0;
      const adminOn = UI.storage.getItem('admin-mode') === '1';
      let groupControl = '';
      if (adminOn && standingPct > 0) {
        groupControl = bom.groupPct > 0
          ? `<button type="button" class="btn btn-ghost btn-xs" data-act="bom-group-revoke" data-tooltip="Remove this lab's discount">Revoke</button>`
          : `<button type="button" class="btn btn-ghost btn-xs" data-act="bom-group-apply" data-tooltip="Restore this lab's standing discount">Apply</button>`;
      }
      // groupPct + manualPct can exceed 100% (computeBookingBOM caps the actual deduction —
      // bom.discPct/bom.discountAmt — at 100%, but the two rows below are otherwise independent
      // of that cap). Scale each row's displayed amount down proportionally so they always sum
      // to bom.discountAmt instead of overstating the real deduction.
      const rawGroupAmt = bom.instrTime * bom.groupPct / 100;
      const rawManualAmt = bom.instrTime * bom.manualPct / 100;
      const rawDiscTotal = rawGroupAmt + rawManualAmt;
      const discScale = rawDiscTotal > 0 ? bom.discountAmt / rawDiscTotal : 1;
      const groupAmt = rawGroupAmt * discScale;
      const manualAmt = rawManualAmt * discScale;

      const groupLabel = 'Group discount' + (org ? ` (${esc(org)}, ${bom.groupPct}%)` : ` (${bom.groupPct}%)`);
      const groupRow = `<div class="row" style="justify-content:space-between;gap:8px">
        <span class="faint small">${groupLabel}</span>
        <span class="row" style="gap:8px;align-items:center">${groupControl}<span class="mono">−${fmtMoney(groupAmt)}</span></span>
      </div>`;

      summaryEl.innerHTML =
        row('Subtotal', fmtMoney(bom.subtotal)) +
        groupRow +
        (bom.manualPct ? row(`Manual discount (${bom.manualPct}%)`, '−' + fmtMoney(manualAmt)) : '') +
        row(`Overhead (${bom.ohInternal + bom.ohExternal}%)`, '+' + fmtMoney(bom.overheadAmt)) +
        row('Before tax', fmtMoney(bom.beforeTax), { strong: true }) +
        row(`Tax (${bom.taxPct}%)`, '+' + fmtMoney(bom.taxAmt)) +
        row('Total', fmtMoney(bom.total), { strong: true, big: true });
    }
  }

  function wireBomInputs(m, ids) {
    const recalc = () => recomputeBomTotals(m, ids);
    const startEl = m.querySelector('#' + ids.start);
    const endEl = m.querySelector('#' + ids.end);
    if (startEl) startEl.addEventListener('input', recalc);
    if (endEl) endEl.addEventListener('input', recalc);
    const projectEl = m.querySelector('#' + ids.project);
    if (projectEl) projectEl.addEventListener('change', () => applyProjectDrivenGroup(m, ids));
    const groupEl = m.querySelector('#' + ids.group);
    if (groupEl) groupEl.addEventListener('change', () => offerGroupDiscount(m, ids, groupEl.value));
    const discEl = m.querySelector('#' + ids.prefix + '-discount');
    if (discEl) discEl.addEventListener('input', () => { m._bom.manualPct = Number(discEl.value) || 0; recalc(); });

    // Amount/partial-time inputs live inside rows rebuilt by renderBomRows, so this listener is
    // delegated on the whole modal rather than bound per-row (it survives the row rebuilds).
    m.addEventListener('input', (e) => {
      const amtEl = e.target.closest('.bom-amount');
      if (amtEl) { m._bom.instrAmounts[amtEl.dataset.id] = Number(amtEl.value) || 0; recalc(); return; }
      const stEl = e.target.closest('.bom-staff-start');
      if (stEl) { (m._bom.staffWindows[stEl.dataset.id] = m._bom.staffWindows[stEl.dataset.id] || {}).start = stEl.value; recalc(); return; }
      const etEl = e.target.closest('.bom-staff-end');
      if (etEl) { (m._bom.staffWindows[etEl.dataset.id] = m._bom.staffWindows[etEl.dataset.id] || {}).end = etEl.value; recalc(); return; }
    });
  }

  function mountBookingModal(m, opts) {
    const ids = opts.ids;
    m._bomIds = ids; // read back by the bom-group-revoke/apply dispatcher cases
    m._bom = { instrAmounts: {}, staffWindows: {}, manualPct: opts.discountPct || 0, groupPct: 0, groupOrg: '' };
    (opts.instrumentDetails || []).forEach((row) => { m._bom.instrAmounts[row.instrument_id] = row.amount || 0; });
    (opts.staffDetails || []).forEach((row) => { m._bom.staffWindows[row.person_id] = { start: row.start_time || '', end: row.end_time || '' }; });

    const refreshBom = () => { renderBomRows(m, ids); recomputeBomTotals(m, ids); };

    mountTokenPicker(m, 'owner', bkPeopleItems());
    mountTokenPicker(m, 'inst', bkInstItems(), refreshBom);
    mountTokenPicker(m, 'staff', bkStaffItems(), refreshBom);
    mountRichText(m, opts.noteId);
    if (opts.owners) m.querySelector('.token-picker[data-kind="owner"]')._setSelected(opts.owners);
    if (opts.insts) m.querySelector('.token-picker[data-kind="inst"]')._setSelected(opts.insts);
    if (opts.staffIds) m.querySelector('.token-picker[data-kind="staff"]')._setSelected(opts.staffIds);
    if (opts.note) m.querySelector('#' + opts.noteId).innerHTML = UI.sanitizeHtml(opts.note);

    wireBomInputs(m, ids);
    refreshBom();
    // Editing an existing booking restores exactly what was saved (respecting a prior revoke);
    // a new booking offers the live standing discount for whatever project/group is preselected.
    if (opts.groupOrg != null) restoreGroupState(m, ids, opts.groupOrg, opts.groupPct);
    else applyProjectDrivenGroup(m, ids);
  }

  // Hard-block conflict check: the same instrument OR the same core-staff member cannot be on
  // two bookings whose time windows overlap on the same day. Deliberately checks the whole
  // booking's start/end (not a staff member's partial billing window) — a booking's time window
  // is when the session is actually happening, and a person invited to it is presumed present
  // for all of it whether or not all of that time gets billed to them. Times are "HH:MM"
  // strings, and lexical string comparison already sorts them chronologically, so no time
  // parsing is needed in the SQL itself: two windows overlap unless one ends at/before the
  // other starts.
  function findBookingConflicts({ date, start, end, excludeId, instrumentIds, staffIds }) {
    if (!start || !end) return [];
    const overlapSql = `m.date = ? AND m.id != ? AND m.start_time != '' AND m.end_time != '' AND NOT (m.end_time <= ? OR m.start_time >= ?)`;
    const conflicts = [];
    if (instrumentIds && instrumentIds.length) {
      DB.rows(`
        SELECT m.title, m.start_time, m.end_time, i.name
        FROM meeting_instruments mi JOIN meetings m ON m.id = mi.meeting_id JOIN instruments i ON i.id = mi.instrument_id
        WHERE mi.instrument_id IN (${instrumentIds.map(() => '?').join(',')}) AND ${overlapSql}`,
        [...instrumentIds, date, excludeId || 0, start, end]
      ).forEach((r) => conflicts.push(`${r.name} is already booked ${r.start_time}–${r.end_time} on "${r.title}"`));
    }
    if (staffIds && staffIds.length) {
      DB.rows(`
        SELECT m.title, m.start_time, m.end_time, p.name
        FROM meeting_staff ms JOIN meetings m ON m.id = ms.meeting_id JOIN people p ON p.id = ms.person_id
        WHERE ms.person_id IN (${staffIds.map(() => '?').join(',')}) AND ${overlapSql}`,
        [...staffIds, date, excludeId || 0, start, end]
      ).forEach((r) => conflicts.push(`${r.name} is already booked ${r.start_time}–${r.end_time} on "${r.title}"`));
    }
    return conflicts;
  }

  function newBooking(date, projectId = null) {
    const allProjects = DB.rows('SELECT id, title FROM projects ORDER BY title');
    const pid = projectId != null ? Number(projectId) : null;
    const adminOn = UI.storage.getItem('admin-mode') === '1';

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('calendar')} New Booking</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Title *</label><input class="input" id="bk-title" placeholder="e.g. Initial Image Analysis Pipeline Sync" /></div>
        <div class="grid cols-3">
          <div class="field"><label>Date</label><input type="date" class="input" id="bk-date" value="${esc(date || UI.today())}" /></div>
          <div class="field"><label>Start Time</label><input type="time" class="input" id="bk-start" /></div>
          <div class="field"><label>End Time</label><input type="time" class="input" id="bk-end" /></div>
        </div>
        <div class="grid cols-2">
          <div class="field">
            <label>Project (optional)</label>
            <select class="input" id="bk-project">
              <option value="">-- Facility-wide / No Project --</option>
              ${allProjects.map((p) => `<option value="${p.id}" ${pid === p.id ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}
            </select>
          </div>
          ${groupSelectField('bk-group', '')}
        </div>

        ${tokenPickerField('owner', 'Assign People', '+ Add person…')}
        <div class="row mb-8"><button type="button" class="btn btn-mint btn-sm" data-act="bk-add-person" data-tooltip="Register someone not in the list yet">${ic('user')} Register New Person</button></div>
        ${tokenPickerField('inst', 'Assign Instruments', '+ Add instrument…')}
        ${tokenPickerField('staff', 'Assign Core Staff', '+ Add core staff…')}

        ${bomSectionHtml('bk', adminOn)}

        ${rteField('bk-note')}
        <div class="field"><label>Next Steps / Action Items</label><input class="input" id="bk-act" placeholder="e.g. Transfer RAW Nikon ND2 files to facility NAS" /></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="booking-save">Save Booking</button>
      </div>`, (m) => mountBookingModal(m, { noteId: 'bk-note', ids: { prefix: 'bk', start: 'bk-start', end: 'bk-end', project: 'bk-project', group: 'bk-group' } }));
  }

  function bookingSave() {
    const m = document.querySelector('.modal');
    const title = m.querySelector('#bk-title').value.trim();
    if (!title) { UI.toast('Booking title required', 'error'); return; }

    const date = m.querySelector('#bk-date').value || UI.today();
    const start = m.querySelector('#bk-start').value || '';
    const end = m.querySelector('#bk-end').value || '';
    const projectVal = m.querySelector('#bk-project').value;
    const projectId = projectVal ? Number(projectVal) : null;
    const groupOrg = (m.querySelector('#bk-group') || {}).value || '';
    const note = readNote(m, 'bk-note');
    const actions = m.querySelector('#bk-act').value.trim();

    const ownerIds = readTokenIds(m, 'owner');
    const instIds = readTokenIds(m, 'inst');
    const staffIds = readTokenIds(m, 'staff');

    const conflicts = findBookingConflicts({ date, start, end, instrumentIds: instIds, staffIds });
    if (conflicts.length) { UI.toast(conflicts.join('; '), 'error'); return; }

    const attendees = ownerIds.length
      ? DB.rows(`SELECT name FROM people WHERE id IN (${ownerIds.map(() => '?').join(',')})`, ownerIds).map((r) => r.name).join(', ')
      : '';

    const ids = { prefix: 'bk', start: 'bk-start', end: 'bk-end', project: 'bk-project', group: 'bk-group' };
    recomputeBomTotals(m, ids);
    const bom = m._bom.last;

    DB.run(`INSERT INTO meetings (project_id, title, date, start_time, end_time, attendees, link, note, actions, discount_pct, group_org, group_discount_pct, subtotal, total_before_tax, total_cost)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [projectId, title, date, start, end, attendees, '', note, actions, bom.manualPct, groupOrg, bom.groupPct, bom.subtotal, bom.beforeTax, bom.total]);
    const inserted = DB.row('SELECT last_insert_rowid() as id');
    const mid = inserted ? inserted.id : null;
    if (mid) {
      ownerIds.forEach((oid) => DB.run('INSERT OR IGNORE INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [mid, oid]));
      bom.instrumentLines.forEach((line) => DB.run('INSERT OR IGNORE INTO meeting_instruments (meeting_id, instrument_id, amount, line_cost) VALUES (?,?,?,?)', [mid, line.id, line.amount || 0, line.line]));
      bom.staffLines.forEach((line) => {
        const win = m._bom.staffWindows[line.id] || {};
        DB.run('INSERT OR IGNORE INTO meeting_staff (meeting_id, person_id, start_time, end_time, line_cost) VALUES (?,?,?,?,?)', [mid, line.id, win.start || '', win.end || '', line.line]);
      });
    }

    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Booking saved');
    refresh();
  }

  function editBooking(id) {
    const mt = DB.row('SELECT * FROM meetings WHERE id=?', [id]);
    if (!mt) return;
    const allProjects = DB.rows('SELECT id, title FROM projects ORDER BY title');
    const currentOwners = DB.rows('SELECT person_id FROM meeting_people WHERE meeting_id=?', [id]).map((r) => r.person_id);
    const currentInstDetails = DB.rows('SELECT instrument_id, amount, line_cost FROM meeting_instruments WHERE meeting_id=?', [id]);
    const currentStaffDetails = DB.rows('SELECT person_id, start_time, end_time, line_cost FROM meeting_staff WHERE meeting_id=?', [id]);
    const adminOn = UI.storage.getItem('admin-mode') === '1';

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('edit')} Edit Booking</span></div>
      <div class="body"><div class="stack">
        <div class="field"><label>Title *</label><input class="input" id="bke-title" value="${esc(mt.title)}" /></div>
        <div class="grid cols-3">
          <div class="field"><label>Date</label><input type="date" class="input" id="bke-date" value="${mt.date || ''}" /></div>
          <div class="field"><label>Start Time</label><input type="time" class="input" id="bke-start" value="${esc(mt.start_time || '')}" /></div>
          <div class="field"><label>End Time</label><input type="time" class="input" id="bke-end" value="${esc(mt.end_time || '')}" /></div>
        </div>
        <div class="grid cols-2">
          <div class="field">
            <label>Project (optional)</label>
            <select class="input" id="bke-project">
              <option value="">-- Facility-wide / No Project --</option>
              ${allProjects.map((p) => `<option value="${p.id}" ${mt.project_id === p.id ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}
            </select>
          </div>
          ${groupSelectField('bke-group', mt.group_org || '')}
        </div>

        ${tokenPickerField('owner', 'Assign People', '+ Add person…')}
        <div class="row mb-8"><button type="button" class="btn btn-mint btn-sm" data-act="bk-add-person" data-tooltip="Register someone not in the list yet">${ic('user')} Register New Person</button></div>
        ${tokenPickerField('inst', 'Assign Instruments', '+ Add instrument…')}
        ${tokenPickerField('staff', 'Assign Core Staff', '+ Add core staff…')}

        ${bomSectionHtml('bke', adminOn)}

        ${rteField('bke-note')}
        <div class="field"><label>Next Steps / Action Items</label><input class="input" id="bke-act" value="${esc(mt.actions || '')}" /></div>
      </div></div>
      <div class="foot">
        <button class="btn btn-danger" data-act="booking-del" data-id="${mt.id}" style="margin-right:auto">${ic('trash')} Delete</button>
        <button class="btn btn-secondary" data-act="email-attendees" data-id="${mt.id}">${ic('mail')} Email Attendees</button>
        <button class="btn btn-secondary" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="booking-edit-save" data-id="${mt.id}">Save Changes</button>
      </div>`, (m) => mountBookingModal(m, {
        noteId: 'bke-note', owners: currentOwners,
        insts: currentInstDetails.map((r) => r.instrument_id), staffIds: currentStaffDetails.map((r) => r.person_id),
        instrumentDetails: currentInstDetails, staffDetails: currentStaffDetails,
        discountPct: mt.discount_pct || 0, note: mt.note,
        groupOrg: mt.group_org || '', groupPct: mt.group_discount_pct || 0,
        ids: { prefix: 'bke', start: 'bke-start', end: 'bke-end', project: 'bke-project', group: 'bke-group' }
      }));
  }

  function bookingEditSave(id) {
    const m = document.querySelector('.modal');
    const title = m.querySelector('#bke-title').value.trim();
    if (!title) { UI.toast('Title required', 'error'); return; }

    const date = m.querySelector('#bke-date').value || null;
    const start = m.querySelector('#bke-start').value || '';
    const end = m.querySelector('#bke-end').value || '';
    const projectVal = m.querySelector('#bke-project').value;
    const projectId = projectVal ? Number(projectVal) : null;
    const groupOrg = (m.querySelector('#bke-group') || {}).value || '';
    const note = readNote(m, 'bke-note');
    const actions = m.querySelector('#bke-act').value.trim();

    const ownerIds = readTokenIds(m, 'owner');
    const instIds = readTokenIds(m, 'inst');
    const staffIds = readTokenIds(m, 'staff');

    const conflicts = findBookingConflicts({ date, start, end, excludeId: id, instrumentIds: instIds, staffIds });
    if (conflicts.length) { UI.toast(conflicts.join('; '), 'error'); return; }

    const attendees = ownerIds.length
      ? DB.rows(`SELECT name FROM people WHERE id IN (${ownerIds.map(() => '?').join(',')})`, ownerIds).map((r) => r.name).join(', ')
      : '';

    const ids = { prefix: 'bke', start: 'bke-start', end: 'bke-end', project: 'bke-project', group: 'bke-group' };
    recomputeBomTotals(m, ids);
    const bom = m._bom.last;

    DB.run(`UPDATE meetings SET title=?, date=?, start_time=?, end_time=?, project_id=?, attendees=?, note=?, actions=?,
              discount_pct=?, group_org=?, group_discount_pct=?, subtotal=?, total_before_tax=?, total_cost=?, updated_at=datetime('now') WHERE id=?`,
      [title, date, start, end, projectId, attendees, note, actions, bom.manualPct, groupOrg, bom.groupPct, bom.subtotal, bom.beforeTax, bom.total, id]);

    DB.run('DELETE FROM meeting_people WHERE meeting_id=?', [id]);
    DB.run('DELETE FROM meeting_instruments WHERE meeting_id=?', [id]);
    DB.run('DELETE FROM meeting_staff WHERE meeting_id=?', [id]);
    ownerIds.forEach((oid) => DB.run('INSERT OR IGNORE INTO meeting_people (meeting_id, person_id) VALUES (?,?)', [id, oid]));
    bom.instrumentLines.forEach((line) => DB.run('INSERT OR IGNORE INTO meeting_instruments (meeting_id, instrument_id, amount, line_cost) VALUES (?,?,?,?)', [id, line.id, line.amount || 0, line.line]));
    bom.staffLines.forEach((line) => {
      const win = m._bom.staffWindows[line.id] || {};
      DB.run('INSERT OR IGNORE INTO meeting_staff (meeting_id, person_id, start_time, end_time, line_cost) VALUES (?,?,?,?,?)', [id, line.id, win.start || '', win.end || '', line.line]);
    });

    UI.closeDim(m.closest('.modal-dim'));
    UI.toast('Booking updated');
    refresh();
  }

  // Raw deletion, no confirmation — deleteBookingFromModal shows its own confirmation before
  // calling this, and meeting-del (the dispatcher case for a booking's list-row delete icon)
  // confirms via deleteMeeting() below. Keeping the unconfirmed version separate avoids either
  // caller double-confirming.
  function deleteMeetingRaw(id) {
    // Child rows are deleted explicitly as a defensive measure. Cascade DOES fire in the current
    // codebase (verified empirically — see CLAUDE.md's cascading-deletes section): currentBytes()
    // reasserts PRAGMA foreign_keys after every export. The explicit deletes guard against any
    // future code path that exports without that reassert, silently turning cascades back off.
    DB.run('DELETE FROM meeting_people WHERE meeting_id=?', [id]);
    DB.run('DELETE FROM meeting_instruments WHERE meeting_id=?', [id]);
    DB.run('DELETE FROM meeting_staff WHERE meeting_id=?', [id]);
    DB.run('DELETE FROM meetings WHERE id=?', [id]);
  }

  async function deleteMeeting(id) {
    const mt = DB.row('SELECT title FROM meetings WHERE id=?', [id]);
    if (!mt) return;
    const ok = await UI.confirmModal('Delete Booking', `Delete booking "${esc(mt.title)}"? Its billing line items (instruments, core staff) are deleted too. This cannot be undone.`, { danger: true });
    if (!ok) return;

    deleteMeetingRaw(id);
    UI.toast('Booking removed');
    refresh();
  }

  // mailto: URLs hand off to the OS's mail client, and the browser gets no way back into that
  // program afterward — it can't wait for it to open and inject fields into it. Putting the
  // recipients/subject/body IN the mailto URL also has two problems: those URLs are capped by
  // the OS/browser protocol handler (commonly ~2000-2048 chars) so long notes get silently cut
  // off, and it puts attendee emails + meeting notes into a URL that briefly touches browser
  // history / OS process args. So instead: show the composed message in a modal with a copy
  // button per field, and open a completely bare `mailto:` (no params, nothing to truncate or
  // expose) so the user pastes the fields into the blank compose window themselves.
  function emailAttendees(id) {
    const mt = DB.row('SELECT * FROM meetings WHERE id=?', [id]);
    if (!mt) return;

    const people = DB.rows(
      'SELECT p.name, p.email FROM meeting_people mp JOIN people p ON p.id = mp.person_id WHERE mp.meeting_id=?',
      [id]
    );
    const withEmail = people.filter((p) => p.email && p.email.trim());
    const withoutEmail = people.filter((p) => !p.email || !p.email.trim());

    if (!withEmail.length) {
      UI.toast(people.length ? 'No attendee has an email address' : 'This meeting has no attendees', 'error');
      return;
    }

    // Notes are a rich-text HTML subset — flatten to plain text for the email body.
    const noteText = mt.note ? (function (html) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      return (tmp.textContent || '').trim();
    })(mt.note) : '';

    const bodyLines = [];
    if (mt.date) bodyLines.push('Date: ' + mt.date);
    if (noteText) bodyLines.push('', 'Notes:', noteText);
    if (mt.actions) bodyLines.push('', 'Next Steps / Action Items:', mt.actions);

    const attendeesText = withEmail.map((p) => p.email.trim()).join(', ');
    const subjectText = (mt.date ? '[' + mt.date + '] ' : '') + mt.title;
    const bodyText = bodyLines.join('\n');

    UI.openModal(`
      <div class="head"><span class="modal-title">${ic('mail')} Email Attendees</span></div>
      <div class="body"><div class="stack">
        <div class="field">
          <label>Attendees</label>
          <div class="row" style="align-items:flex-start">
            <button type="button" class="btn btn-ghost btn-sm" data-act="copy" data-copy="${esc(attendeesText)}" data-copy-label="Attendees copied" title="Copy attendees">${ic('copy')}</button>
            <input class="input grow" readonly value="${esc(attendeesText)}" />
          </div>
        </div>
        <div class="field">
          <label>Subject</label>
          <div class="row" style="align-items:flex-start">
            <button type="button" class="btn btn-ghost btn-sm" data-act="copy" data-copy="${esc(subjectText)}" data-copy-label="Subject copied" title="Copy subject">${ic('copy')}</button>
            <input class="input grow" readonly value="${esc(subjectText)}" />
          </div>
        </div>
        <div class="field">
          <label>Body</label>
          <div class="row" style="align-items:flex-start">
            <button type="button" class="btn btn-ghost btn-sm" data-act="copy" data-copy="${esc(bodyText)}" data-copy-label="Body copied" title="Copy body">${ic('copy')}</button>
            <textarea class="input grow" readonly rows="6">${esc(bodyText)}</textarea>
          </div>
        </div>
      </div></div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Close</button>
        <button class="btn btn-primary" data-act="email-open-blank">${ic('mail')} Open Email App</button>
      </div>`);

    UI.toast(
      (withoutEmail.length ? withoutEmail.length + ' attendee(s) skipped — no email on file. ' : '') +
      'Copy each field below, then paste it into the blank email that opens.'
    );
  }

  // A booking with no project (facility-wide) only ever appears on the calendar / in its own
  // edit modal — unlike a project-attached one, it has no list row with its own delete icon —
  // so the edit modal needs its own delete entry point, confirmed and closing itself on delete.
  async function deleteBookingFromModal(id) {
    const ok = await UI.confirmModal('Delete Booking', 'Are you sure you want to delete this booking? Its billing line items (instruments, core staff) are deleted too. This cannot be undone.', { danger: true });
    if (!ok) return;
    deleteMeetingRaw(id);
    UI.toast('Booking removed');
    refresh();
    const dim = document.querySelector('.modal-dim');
    if (dim) UI.closeDim(dim);
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

  async function kvDel(id) {
    const item = DB.row('SELECT key FROM kv WHERE id=?', [id]);
    if (!item) return;
    const ok = await UI.confirmModal('Delete Field', `Delete custom field "${esc(item.key)}"? This cannot be undone.`, { danger: true });
    if (!ok) return;

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

  async function deleteFile(id) {
    const f = DB.row('SELECT name FROM files WHERE id=?', [id]);
    if (!f) return;
    const ok = await UI.confirmModal('Delete Attachment', `Delete "${esc(f.name)}"? This cannot be undone.`, { danger: true });
    if (!ok) return;

    DB.run('DELETE FROM files WHERE id=?', [id]);
    UI.toast('Attachment removed');
    refresh();
  }

  /* ---------------- Backup & Restore ---------------- */
  function doBackup() { return performBackupDownload(false); }

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

  /* ---------------- Billing Rates & Admin Mode (Settings) ----------------
     Admin mode is a local, unsecured Settings toggle — there is no login in this app, so it
     cannot be real access control. It only decides whether the group-discount editor and the
     per-booking manual discount override are shown; anyone with this browser can flip it on. */
  function toggleAdminMode() {
    const on = UI.storage.getItem('admin-mode') === '1';
    UI.storage.setItem('admin-mode', on ? '0' : '1');
    refresh();
  }

  function saveBillingRates() {
    const internalEl = document.getElementById('cfg-overhead-internal');
    const externalEl = document.getElementById('cfg-overhead-external');
    const taxEl = document.getElementById('cfg-tax');
    const curEl = document.getElementById('cfg-currency');
    if (!internalEl) return;
    DB.setConfig('overhead_internal', Number(internalEl.value) || 0);
    DB.setConfig('overhead_external', Number(externalEl.value) || 0);
    DB.setConfig('tax_pct', Number(taxEl.value) || 0);
    DB.setConfig('currency', curEl.value.trim() || '$');
    UI.toast('Billing rates saved');
    refresh();
  }

  function saveGroupDiscounts() {
    document.querySelectorAll('.group-discount-input').forEach((inp) => {
      DB.setGroupDiscount(inp.dataset.org, Number(inp.value) || 0);
    });
    UI.toast('Group discounts saved');
    refresh();
  }

  /* ---------------- Day Focus / Today Agenda Modal ---------------- */
  function openTodayModal() {
    const todayStr = UI.today();
    const dateObj = new Date();
    const dateFormatted = dateObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Milestones due today
    const msToday = DB.rows(`
      SELECT m.*, p.title as project_title, p.id as project_id,
             (SELECT GROUP_CONCAT(pe.name, ', ') FROM milestone_owners mo JOIN people pe ON pe.id = mo.person_id WHERE mo.milestone_id = m.id) as owners
      FROM milestones m
      JOIN projects p ON p.id = m.project_id
      WHERE m.due_date = ?
      ORDER BY m.status = 'done', m.id ASC`, [todayStr]);

    // Meetings scheduled today
    const mtgsToday = DB.rows(`
      SELECT m.*, p.title as project_title, p.id as project_id
      FROM meetings m
      LEFT JOIN projects p ON p.id = m.project_id
      WHERE m.date = ?
      ORDER BY m.id ASC`, [todayStr]);

    // Overdue milestones
    const msOverdue = DB.rows(`
      SELECT m.*, p.title as project_title, p.id as project_id
      FROM milestones m
      JOIN projects p ON p.id = m.project_id
      WHERE m.due_date < ? AND m.status != 'done'
      ORDER BY m.due_date ASC LIMIT 10`, [todayStr]);

    // Active projects snapshot
    const activeProjects = DB.rows(`
      SELECT p.*, pe.name as pi_name
      FROM projects p
      LEFT JOIN people pe ON pe.id = p.pi_id
      WHERE p.status = 'Active'
      ORDER BY p.updated_at DESC LIMIT 6`);

    UI.openModal(`
      <div class="head">
        <span class="modal-title">${ic('calendar')} Today's Agenda &amp; Focus — ${esc(dateFormatted)}</span>
      </div>
      <div class="body" style="max-height:75vh">
        <div class="stack">
          <!-- Milestones Section -->
          <div class="card" style="margin-top:0">
            <div class="row mb-8">
              <span class="card-title grow">${ic('target')} Milestones Due Today (${msToday.length})</span>
              ${ctx.project ? `<button class="btn btn-ghost btn-sm" data-act="add-milestone">${ic('plus')} Add</button>` : ''}
            </div>
            <div class="card-body">
              ${msToday.length ? msToday.map((m) => `
                <div class="row milestone-quick-row">
                  <span class="badge ${m.status === 'done' ? 'success' : m.status === 'in-progress' ? 'primary' : 'neutral'} clickable"
                        data-act="toggle-ms-status" data-id="${m.id}" data-tooltip="Click to toggle status">${m.status}</span>
                  <div class="grow" style="cursor:pointer" data-goto="project" data-id="${m.project_id}">
                    <div style="font-weight:600">${esc(m.name)}</div>
                    <div class="faint small">${esc(m.project_title)}${m.owners ? ' · ' + esc(m.owners) : ''}</div>
                  </div>
                  <button class="btn btn-ghost btn-sm" data-act="edit-milestone" data-id="${m.id}" data-tooltip="Edit">${ic('edit')}</button>
                </div>`).join('') : '<div class="faint small">No deliverables or milestones scheduled to complete today.</div>'}
            </div>
          </div>

          <!-- Meetings Section -->
          <div class="card">
            <div class="row mb-8">
              <span class="card-title grow">${ic('calendar')} Consultations &amp; Syncs Today (${mtgsToday.length})</span>
              <button class="btn btn-ghost btn-sm" data-act="add-meeting">${ic('plus')} Log</button>
            </div>
            <div class="card-body">
              ${mtgsToday.length ? mtgsToday.map((m) => `
                <div class="meeting-box mb-8">
                  <div class="row">
                    <span class="font-medium grow" ${m.project_id ? `style="cursor:pointer" data-goto="project" data-id="${m.project_id}"` : ''}>${esc(m.title)}${m.project_title ? ' (' + esc(m.project_title) + ')' : ''}</span>
                    <button class="btn btn-ghost btn-sm" data-act="edit-booking" data-id="${m.id}">${ic('edit')}</button>
                  </div>
                  ${m.attendees ? `<div class="faint small mt-8"><strong>Attendees:</strong> ${esc(m.attendees)}</div>` : ''}
                  ${m.note ? `<div class="small muted mt-8 rte-content">${UI.noteHtml(m.note)}</div>` : ''}
                  ${m.actions ? `<div class="action-items mt-8"><span class="badge warning font-medium">Actions:</span> ${esc(m.actions)}</div>` : ''}
                </div>`).join('') : '<div class="faint small">No consultation meetings scheduled for today.</div>'}
            </div>
          </div>

          <!-- Overdue Section -->
          ${msOverdue.length ? `
          <div class="card" style="border-left: 4px solid var(--danger)">
            <div class="card-title mb-8" style="color:var(--danger)">${ic('alert')} Overdue Action Items (${msOverdue.length})</div>
            <div class="card-body">
              ${msOverdue.map((m) => `
                <div class="row milestone-quick-row">
                  <span class="badge danger clickable" data-act="toggle-ms-status" data-id="${m.id}" data-tooltip="Mark Done">overdue</span>
                  <div class="grow" style="cursor:pointer" data-goto="project" data-id="${m.project_id}">
                    <div style="font-weight:600">${esc(m.name)}</div>
                    <div class="faint small">${esc(m.project_title)} · Due: <span style="color:var(--danger)">${UI.fmtDate(m.due_date)}</span></div>
                  </div>
                  <button class="btn btn-ghost btn-sm" data-act="edit-milestone" data-id="${m.id}">${ic('edit')}</button>
                </div>`).join('')}
            </div>
          </div>` : ''}

          <!-- Active Projects Snapshot -->
          <div class="card">
            <div class="card-title mb-8">${ic('folder')} Active Projects (${activeProjects.length})</div>
            <div class="card-body">
              <div class="grid cols-2">
                ${activeProjects.map((p) => `
                  <div class="instrument-box clickable" data-goto="project" data-id="${p.id}" data-tooltip="Open project">
                    <div class="font-medium">${esc(p.title)}</div>
                    <div class="faint small">PI: ${esc(p.pi_name || '—')} · ${esc(p.modality || 'Facility')}</div>
                  </div>`).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="foot">
        <button class="btn btn-secondary" data-act="close">Close</button>
      </div>`);
  }

  /* ---------------- Onboarding Tour (Multi-Screen Walkthrough) ---------------- */
  function startTour() {
    // If no project exists, check first project ID
    const firstProj = DB.row('SELECT id FROM projects ORDER BY id ASC LIMIT 1');
    const pid = firstProj ? firstProj.id : 1;

    // Each step targets a real, stable element (data-tour anchors for project sub-sections;
    // '.modal' for dialog showcases the tour opens then auto-dismisses on advance). Project
    // sub-steps re-assert route:'project' so the milestone/field/file dialogs always have a
    // project in context.
    UI.startTour([
      {
        route: 'dashboard',
        sel: '.grid.cols-4',
        title: '1. Facility Dashboard',
        body: 'Welcome to Core Facility Tracker! These tiles give you live counts — total and active projects, overdue milestones, and completed work — with the lists below showing what is due soon.'
      },
      {
        sel: '#app-sidebar',
        title: '2. Sidebar Navigation & Collapse',
        body: 'Switch between Projects, People &amp; Labs, Instruments, Calendar, and Settings. The chevron at the top collapses the sidebar to widen your working canvas.'
      },
      {
        route: 'projects',
        sel: '.filter-bar',
        title: '3. Projects Registry & Filters',
        body: 'Search across titles, codes, PIs, tags, and funding. Filter by Status, Priority, and Modality — and start a new project or export every project to one spreadsheet from here.'
      },
      {
        route: 'projects',
        action: () => newProject(),
        sel: '.modal',
        title: '4. New Project Dialog',
        body: 'Initiate a project: title, status, priority, and PI — or register a brand-new PI inline. Editable dropdowns (Modality, Funding, Sample) each carry a "+ Add New" option that saves a facility-wide term on the spot.'
      },
      {
        route: 'project',
        projectId: pid,
        sel: '.project-header-card',
        title: '5. Project Details & Grant Metadata',
        body: 'The header consolidates the PI, project code, timeline, status, and priority. The quick-status bar below flips a project through its lifecycle in one click.'
      },
      {
        route: 'project',
        projectId: pid,
        sel: '[data-tour="proj-milestones"]',
        title: '6. Milestones & Deliverables',
        body: 'Each milestone shows its status (done, in-progress, pending, overdue), due date, assigned owners, and required instruments. Click a status dot or badge to cycle it.'
      },
      {
        action: () => addMilestone(),
        sel: '.modal',
        title: '7. Add Milestone Dialog',
        body: 'Add a deliverable with a due date, then assign responsible people and the instruments it needs. Edits reuse this same dialog.'
      },
      {
        route: 'project',
        projectId: pid,
        sel: '[data-tour="proj-team"]',
        title: '8. Team & Collaborators',
        body: 'Add PIs, postdocs, students, and technicians with their role on the project. The cards around this one cover assigned instruments, meeting minutes, files, and custom metadata fields.'
      },
      {
        action: () => addKV(),
        sel: '.modal',
        title: '9. Custom Metadata Field Dialog',
        body: 'Attach any key/value your facility tracks — laser lines, objective NA, biosafety level, grant sub-account — as a custom field on the project.'
      },
      {
        action: () => addFile(),
        sel: '.modal',
        title: '10. Attach File or Link Dialog',
        body: 'Link a protocol, a dataset on the NAS, or any external URL. Links render as tidy buttons on the project page.'
      },
      {
        route: 'project',
        projectId: pid,
        sel: '[data-tour="proj-exports"]',
        title: '11. One-Click Report Generation',
        body: 'The XLSX, DOCX, and PDF buttons export official documentation in one click — multi-page paginated PDF reports with headers and page numbers, Word documents, and spreadsheets. Duplicate clones the whole project as a template.'
      },
      {
        route: 'people',
        sel: '.filter-bar',
        title: '12. People, Labs & Researchers',
        body: 'A central registry of PIs, postdocs, students, and staff. The table below carries separate Lab / Group and Department columns, emails, and each person’s active project count.'
      },
      {
        action: () => addPerson(),
        sel: '.modal',
        title: '13. Register Person Dialog',
        body: 'Register a researcher: Position / Role plus separate Lab / Group and Department dropdowns, each with a quick "+ Add New" mini-dialog for values you don\'t have yet.'
      },
      {
        route: 'instruments',
        sel: '.filter-bar',
        title: '14. Core Instruments Inventory',
        body: 'Track microscopes and workstations — status (Available, In-use, Maintenance, Down), modality, location, and which projects currently use them. Filter by status or modality here.'
      },
      {
        action: () => addInstrument(),
        sel: '.modal',
        title: '15. Add Instrument Dialog',
        body: 'Register a microscope or workstation with its modality, status, physical location, and configuration notes.'
      },
      {
        route: 'calendar',
        sel: '.cal-grid',
        title: '16. Schedule & Milestone Calendar',
        body: 'A monthly grid combining milestone deadlines and scheduled facility consultations. Click any day to create a booking on it; use Prev / Next to move months.'
      },
      {
        action: () => newBooking(UI.today()),
        sel: '.modal',
        title: '17. New Booking Dialog',
        body: 'Assign people and instruments from dropdowns that fill up with removable badges (hover for role / modality), register a new person mid-booking (the mint button), and write rich-text notes — bold, italics, bullets, and font sizes.'
      },
      {
        route: 'calendar',
        action: () => openTodayModal(),
        sel: '.modal',
        title: '18. Today’s Agenda Dialog',
        body: 'A focused view of everything due or scheduled today — milestones and consultations — for a quick morning stand-up.'
      },
      {
        route: 'settings',
        sel: '[data-tour="settings-backup"]',
        title: '19. Portable Data & Backups',
        body: 'Your whole facility database lives in this browser. Export a single-file JSON backup anytime, restore one, enable automatic daily backups, or point them at a silent folder. Theme and sample-data controls are on this page too.'
      }
    ]);
  }

})(window);
