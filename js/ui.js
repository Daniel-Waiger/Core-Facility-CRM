/* ui.js — toasts, theme, tour, modals, misc */
(function (global) {
  'use strict';

  /* ---------------- Toasts ---------------- */
  function toast(msg, type = 'success') {
    const host = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<span class="ic"></span><span></span>`;
    el.querySelector('.ic').innerHTML = icon(type === 'success' ? 'check' : 'alert');
    el.querySelector('span:last-child').textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; }, 2200);
    setTimeout(() => el.remove(), 2600);
  }

  /* ---------------- Theme ---------------- */
  function initTheme() {
    const t = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', t);
    updateThemeToggleButtons(t);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeToggleButtons(next);
    const knob = document.querySelector('.theme-toggle .knob');
    if (knob) knob.style.left = next === 'dark' ? '22px' : '2px';
  }
  function updateThemeToggleButtons(curTheme) {
    const nextTheme = curTheme === 'dark' ? 'light' : 'dark';
    const isNextDark = nextTheme === 'dark';
    document.querySelectorAll('[data-act="theme-toggle"]').forEach((btn) => {
      const isSidebar = btn.classList.contains('sidebar-theme-btn');
      if (isSidebar) {
        btn.innerHTML = `${icon(isNextDark ? 'moon' : 'sun')}<span class="lbl">${isNextDark ? 'Dark Mode' : 'Light Mode'}</span>`;
        btn.setAttribute('title', `Switch to ${isNextDark ? 'Dark' : 'Light'} Mode`);
        btn.setAttribute('data-tooltip', `Switch to ${isNextDark ? 'Dark' : 'Light'} Mode`);
      } else {
        btn.innerHTML = `${icon(isNextDark ? 'moon' : 'sun')} ${isNextDark ? 'Dark Mode' : 'Light Mode'}`;
        btn.setAttribute('title', `Switch to ${isNextDark ? 'Dark' : 'Light'} Mode`);
      }
    });
  }

  /* ---------------- Modal ---------------- */
  function openModal(html, onMount) {
    const dim = document.createElement('div');
    dim.className = 'modal-dim';
    dim.innerHTML = `<div class="modal">${html}</div>`;
    document.body.appendChild(dim);
    const m = dim.querySelector('.modal');
    if (onMount) onMount(m, dim);
    dim.addEventListener('click', (e) => { if (e.target === dim) closeDim(dim); });
    return m;
  }
  function closeDim(dim) { if (dim) dim.remove(); }
  function confirmModal(title, body, { danger = false } = {}) {
    return new Promise((resolve) => {
      const dim = openModal(`
        <div class="head"><span class="t" style="font-weight:600">${title}</span></div>
        <div class="body"><p class="mt-0 mb-8">${body}</p></div>
        <div class="foot">
          <button class="btn btn-secondary" data-act="no">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="yes">Confirm</button>
        </div>`);
      const yes = dim.querySelector('[data-act="yes"]');
      const no = dim.querySelector('[data-act="no"]');
      no.onclick = () => { closeDim(dim); resolve(false); };
      yes.onclick = () => { closeDim(dim); resolve(true); };
    });
  }

  /* ---------------- Tour (Crisp Focus & No Blur on Target) ---------------- */
  let tourState = null;
  function startTour(steps) {
    stopTour();
    tourState = { steps, i: 0 };
    renderTour();
  }
  function renderTour() {
    stopTourDom();
    if (!tourState) return;
    const step = tourState.steps[tourState.i];
    const box = document.createElement('div');
    box.className = 'tour-box';
    const bubble = document.createElement('div');
    bubble.className = 'tour-bubble';
    document.body.append(box, bubble);

    const target = document.querySelector(step.sel);
    if (target) {
      const r = target.getBoundingClientRect();
      const pad = 6;
      box.style.left = (r.left - pad) + 'px';
      box.style.top = (r.top - pad) + 'px';
      box.style.width = (r.width + pad * 2) + 'px';
      box.style.height = (r.height + pad * 2) + 'px';
      const bw = 320;
      let bx = r.left + r.width + 16;
      if (bx + bw > window.innerWidth - 16) bx = r.left - bw - 16;
      if (bx < 16) bx = 16;
      let by = Math.min(r.top, window.innerHeight - 220);
      bubble.style.left = bx + 'px';
      bubble.style.top = Math.max(16, by) + 'px';
      bubble.innerHTML = `
        <div class="t">${step.title}</div>
        <div class="b">${step.body}</div>
        <div class="foot">
          <span class="step">${tourState.i + 1} / ${tourState.steps.length}</span>
          <div class="grow"></div>
          <button class="btn btn-ghost btn-sm" data-tour="skip">Skip</button>
          <button class="btn btn-primary btn-sm" data-tour="next">${tourState.i < tourState.steps.length - 1 ? 'Next' : 'Done'}</button>
        </div>`;
    } else {
      bubble.style.left = '50%'; bubble.style.top = '50%';
      bubble.style.transform = 'translate(-50%,-50%)';
      bubble.innerHTML = `<div class="t">${step.title}</div><div class="b">${step.body}</div>
        <div class="foot"><div class="grow"></div><button class="btn btn-primary btn-sm" data-tour="next">Next</button></div>`;
    }
    bubble.querySelector('[data-tour="next"]').onclick = () => {
      tourState.i++;
      if (tourState.i >= tourState.steps.length) { stopTour(); }
      else renderTour();
    };
    const skip = bubble.querySelector('[data-tour="skip"]');
    if (skip) skip.onclick = stopTour;
  }
  function stopTour() { tourState = null; stopTourDom(); }
  function stopTourDom() { document.querySelectorAll('.tour-dim, .tour-box, .tour-bubble').forEach((e) => e.remove()); }
  window.addEventListener('resize', () => { if (tourState) renderTour(); });

  /* ---------------- Icons (Lucide-style, inline) ---------------- */
  const ICONS = {
    home: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    folder: '<path d="M4 7h16"/><path d="M4 7v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7"/><path d="M4 7l2-3h8l2 3"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3"/><path d="M15 7a4 4 0 0 0 4 4"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M2 8h2M20 8h2M2 16h2M20 16h2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M7 2v2M15 2v2M3 14h18"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M19 19l-1.5-1.5M5 19l1.5-1.5M19 5l-1.5 1.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    alert: '<path d="M12 22v-6M12 16V8M5 12h14"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    // Redesigned modern, high-contrast trash can with distinct lid, can body, and ribs
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    play: '<path d="M5 3l14 9-14 9z"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.6 17.6l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.6 6.4l1.4-1.4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    tag: '<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><circle cx="7" cy="7" r=".5" fill="currentColor"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    collapse: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9-3 3 3 3"/>',
    expand: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m11 9 3 3-3 3"/>'
  };
  function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  }

  /* ---------------- Autosave indicator ---------------- */
  function setSavedState(state) {
    const el = document.getElementById('saved-state');
    if (!el) return;
    el.className = 'saved-dot' + (state === 'pending' ? ' pending' : '');
    el.querySelector('.txt').textContent = state === 'pending' ? 'Saving…' : 'Saved';
  }

  /* ---------------- Helpers ---------------- */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString() : '—'; }
  function today() { return new Date().toISOString().slice(0, 10); }

  global.UI = {
    toast,
    initTheme,
    toggleTheme,
    updateThemeToggleButtons,
    openModal,
    closeDim,
    confirmModal,
    startTour,
    stopTour,
    stopTourDom,
    icon,
    setSavedState,
    esc,
    fmtDate,
    today
  };

})(window);
