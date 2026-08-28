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

  /* ---------------- Helper: Organization Datalist ---------------- */
  function getOrgDatalist() {
    const orgs = DB.rows("SELECT DISTINCT organization FROM people WHERE organization IS NOT NULL AND TRIM(organization) != '' ORDER BY organization");
    return `<datalist id="org-list">${orgs.map((r) => `<option value="${esc(r.organization)}"></option>`).join('')}</datalist>`;
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
      case 'choose-auto-backup-folder': return chooseAutoBackupFolder();
      case 'disable-auto-backup-folder': return disableAutoBackupFolder();
      case 'regrant-auto-backup-folder': return regrantAutoBackupFolder();
      case 'cal-prev': return Views.navCalendar(-1);
      case 'cal-next': return Views.navCalendar(1);
      case 'cal-today': return Views.navCalendar(0);
      case 'open-today-modal': return openTodayModal();
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
            <span style="font-weight:600;font-size:12.5px">${ic('users')} Or Register New Person / PI Now</span>
          </div>
          <div class="grid cols-2">
            <div class="field"><label>First Name</label><input class="input" id="np-p-first" placeholder="e.g. Elena" /></div>
            <div class="field"><label>Last Name</label><input class="input" id="np-p-last" placeholder="e.g. Rostova" /></div>
          </div>
          <div class="grid cols-2 mt-8">
            <div class="field"><label>Position / Role</label><select class="input" id="np-p-type">${C.PERSON_TYPES.map((s) => `<option value="${s}" ${s === 'PI' ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
            <div class="field"><label>Lab / Group / Company</label><input class="input" id="np-p-org" list="org-list" placeholder="e.g. Molecular Neurobiology Lab" /></div>
          </div>
          <div class="field mt-8"><label>Email Address</label><input type="email" class="input" id="np-p-email" placeholder="elena.rostova@institute.org" /></div>
        </div>

        ${getOrgDatalist()}

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
          <div class="field"><label>Status</label><select class="input" id="ep-status">${C.STATUS.map((s) => `<option value="${s}" ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
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
    const ok = await UI.confirmModal('Delete Project', `Are you sure you want to permanently delete "${esc(p.title)}" and all its milestones, files, and meeting records?`, { danger: true });
    if (!ok) return;

    DB.run('DELETE FROM projects WHERE id=?', [ctx.project]);
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

  function msDel(id) {
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
          <div class="field"><label>Position / Role</label><select class="input" id="p-type">${C.PERSON_TYPES.map((s) => `<option value="${s}">${s}</option>`).join('')}</select></div>
          <div class="field"><label>Lab / Group / Company</label><input class="input" id="p-org" list="org-list" placeholder="e.g. Chen Lab, Genentech, Pathology" /></div>
        </div>
        ${getOrgDatalist()}
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
          <div class="field"><label>Position / Role</label><select class="input" id="pe-type">${C.PERSON_TYPES.map((s) => `<option value="${s}" ${s === p.type ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div class="field"><label>Lab / Group / Company</label><input class="input" id="pe-org" list="org-list" value="${esc(p.organization || '')}" /></div>
        </div>
        ${getOrgDatalist()}
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
    const ok = await UI.confirmModal('Delete Person', `Are you sure you want to remove "${esc(p.name)}"? This will unlink them from projects.`, { danger: true });
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
    const ok = await UI.confirmModal('Delete Instrument', `Are you sure you want to delete "${esc(i.name)}"?`, { danger: true });
    if (!ok) return;
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
        <div class="field">
          <label>Role on Project</label>
          <input class="input" id="app-person-role" placeholder="e.g. Lead Analyst, Postdoc Fellow, Primary Operator" />
        </div>
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
            <div class="field"><label>Lab / Group</label><input class="input" id="m-new-org" list="org-list" placeholder="e.g. Neuroscience Lab" /></div>
          </div>
        </div>

        ${getOrgDatalist()}

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
      JOIN projects p ON p.id = m.project_id
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
              ${ctx.project ? `<button class="btn btn-ghost btn-sm" data-act="add-meeting">${ic('plus')} Log</button>` : ''}
            </div>
            <div class="card-body">
              ${mtgsToday.length ? mtgsToday.map((m) => `
                <div class="meeting-box mb-8">
                  <div class="row">
                    <span class="font-medium grow" style="cursor:pointer" data-goto="project" data-id="${m.project_id}">${esc(m.title)} (${esc(m.project_title)})</span>
                    <button class="btn btn-ghost btn-sm" data-act="edit-meeting" data-id="${m.id}">${ic('edit')}</button>
                  </div>
                  ${m.attendees ? `<div class="faint small mt-8"><strong>Attendees:</strong> ${esc(m.attendees)}</div>` : ''}
                  ${m.note ? `<div class="small muted mt-8 whitespace-pre">${esc(m.note)}</div>` : ''}
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

    UI.startTour([
      {
        sel: '#view',
        route: 'dashboard',
        title: '1. Facility Dashboard',
        body: 'Welcome to Core Facility Tracker! Your dashboard provides real-time counts for Active Projects, PIs, Core Instruments, and upcoming milestone deliverables at a single glance.'
      },
      {
        sel: '#app-sidebar',
        title: '2. Sidebar Navigation & Collapse',
        body: 'Quickly switch between Projects, People & Labs, Core Instruments, Calendar, and Settings. Click the collapse icon at top to expand your working canvas.'
      },
      {
        sel: '#view',
        route: 'projects',
        title: '3. Projects Registry & Filters',
        body: 'Search across titles, PIs, tags, and grant numbers. Filter projects by Modality (Multiphoton, STED, Lightsheet), Lifecycle Status, and Priority level.'
      },
      {
        sel: '#view',
        route: 'project',
        projectId: pid,
        title: '4. Project Details & Grant Metadata',
        body: 'Each project consolidates Principal Investigator affiliations, funding accounts, optical modalities, tissue/sample conditions, and progress metrics.'
      },
      {
        sel: '.ms',
        title: '5. Milestones & Timeline Deliverables',
        body: 'Track project milestones with status indicators (done, in-progress, pending, overdue), due dates, assigned researcher owners, and required microscopes.'
      },
      {
        sel: '.grid.cols-2',
        title: '6. Collaborators, Hardware & Meetings',
        body: 'Log team member roles, linked instruments, consultation meeting minutes with action items, protocol links, and custom metadata fields (e.g., Laser Wavelength, BSL level).'
      },
      {
        sel: '.row button[data-act="export-pdf"]',
        title: '7. One-Click Report Generation',
        body: 'Export official documentation in 1 click: Multi-page paginated PDF reports (with headers and page numbers), Word (.docx) documents, and Excel (.xlsx) spreadsheets.'
      },
      {
        sel: '#view',
        route: 'people',
        title: '8. People, Labs & Researchers Directory',
        body: 'Centralized registry of Principal Investigators, postdocs, students, and facility staff with organization affiliations, emails, and active project counts.'
      },
      {
        sel: '#view',
        route: 'instruments',
        title: '9. Core Instruments Inventory',
        body: 'Monitor microscope hardware status (Available, In-use, Maintenance, Down), imaging modalities, and active research projects.'
      },
      {
        sel: '#view',
        route: 'calendar',
        title: '10. Schedule & Milestone Calendar',
        body: 'Monthly calendar combining experiment milestone deadlines and scheduled facility consultations for smooth scheduling.'
      },
      {
        sel: '#view',
        route: 'settings',
        title: '11. Zero-Cloud SQLite Portability & Theme',
        body: 'All data is stored directly in your browser with automatic SQLite persistence. Export portable single-file backups (.json) anytime, or toggle between Light & Dark themes!'
      }
    ]);
  }

})(window);
