/* ui.js — toasts, theme, tour, modals, misc */
(function (global) {
  'use strict';

  /* ---------------- Safe localStorage ----------------
     Locked-down mobile WebViews (and private-browsing modes) can throw on any
     localStorage access, not just IndexedDB. Route all reads/writes through here so a
     blocked browser degrades to an in-memory value instead of crashing the page. */
  const memoryStorageFallback = {};
  let localStorageBlocked = false;
  function storageGet(key) {
    if (localStorageBlocked) {
      return Object.prototype.hasOwnProperty.call(memoryStorageFallback, key) ? memoryStorageFallback[key] : null;
    }
    try { return localStorage.getItem(key); } catch (_) { localStorageBlocked = true; return storageGet(key); }
  }
  function storageSet(key, val) {
    if (localStorageBlocked) { memoryStorageFallback[key] = String(val); return; }
    try { localStorage.setItem(key, val); } catch (_) { localStorageBlocked = true; storageSet(key, val); }
  }

  /* ---------------- OS detection (for tailored guidance text only — never for logic) ---------------- */
  function detectOS() {
    try {
      const uaData = navigator.userAgentData;
      if (uaData && uaData.platform) {
        const p = uaData.platform.toLowerCase();
        if (p.includes('android')) return 'android';
        if (p.includes('ios')) return 'ios';
        if (p.includes('win')) return 'windows';
        if (p.includes('mac')) return 'mac';
        if (p.includes('linux') || p.includes('chrome os')) return 'linux';
      }
      const ua = (navigator.userAgent || '').toLowerCase();
      if (/android/.test(ua)) return 'android';
      // iPadOS 13+ reports its UA as "Macintosh"; touch points distinguish it from a real Mac.
      if (/iphone|ipad|ipod/.test(ua) || (/macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
      if (/windows/.test(ua)) return 'windows';
      if (/mac os/.test(ua)) return 'mac';
      if (/linux/.test(ua)) return 'linux';
    } catch (_) { /* best-effort only */ }
    return 'other';
  }

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
    let t = storageGet('theme');
    if (!t) {
      try { t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (_) { t = 'light'; }
    }
    document.documentElement.setAttribute('data-theme', t);
    updateThemeToggleButtons(t);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    storageSet('theme', next);
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

  /* ---------------- Modal ----------------
     openModal returns the inner `.modal` card (not the `.modal-dim` overlay) — callers that
     need to close the dim themselves should get it via `m.closest('.modal-dim')` or the `dim`
     param onMount receives, not by assuming the return value IS the dim (that mismatch used to
     leave the blurred backdrop stuck on screen after a promise-based modal like confirmModal
     resolved — the inner card was removed but the outer overlay never was). */
  function openModal(html, onMount, onOutsideClick) {
    const dim = document.createElement('div');
    dim.className = 'modal-dim';
    dim.innerHTML = `<div class="modal">${html}</div>`;
    document.body.appendChild(dim);
    const m = dim.querySelector('.modal');
    // Stash the dismissal handler so Esc can reuse the exact outside-click semantics
    // (important for promise-based modals like confirmModal, which resolve on dismissal).
    dim._onDismiss = onOutsideClick || null;
    if (onMount) onMount(m, dim);
    dim.addEventListener('click', (e) => {
      if (e.target !== dim) return;
      closeDim(dim);
      if (onOutsideClick) onOutsideClick();
    });
    return m;
  }
  function closeDim(dim) { if (dim) dim.remove(); }

  /* ---------------- Global keyboard shortcuts ----------------
     Esc closes the topmost modal (reusing its dismissal handler so promise-based modals
     resolve as if the backdrop was clicked). "/" focuses the current view's search box. */
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const dims = document.querySelectorAll('.modal-dim');
      if (!dims.length) return;
      const dim = dims[dims.length - 1]; // topmost
      const onDismiss = dim._onDismiss;
      closeDim(dim);
      if (onDismiss) onDismiss();
      return;
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isTypingTarget(document.activeElement)) return;      // let the user type a real slash
      if (document.querySelector('.modal-dim')) return;         // don't hijack while a modal is open
      const box = document.getElementById('proj-search')
        || document.getElementById('people-search')
        || document.getElementById('inst-search');
      if (box) { e.preventDefault(); box.focus(); box.select && box.select(); }
    }
  });

  /* ---------------- Clipboard ---------------- */
  async function copyToClipboard(text, label) {
    const value = String(text == null ? '' : text);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // Legacy fallback for non-secure contexts (e.g. plain http, older WebViews).
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast(label || 'Copied to clipboard');
    } catch (_) {
      toast('Could not copy — your browser blocked clipboard access', 'error');
    }
  }
  /* On a destructive confirmation the RED button is Cancel, not Confirm. Colour is what the eye
     lands on first, and on a dialog that exists to prevent an accident the safe way out is what
     deserves that attention — a red "Confirm" advertises the irreversible choice. The
     destructive action stays plainly labelled ("Delete", "Retire" — see confirmText) but is
     styled quietly, so going through with it is a deliberate read rather than a reflex.
     Non-destructive confirmations keep the ordinary neutral-Cancel / primary-Confirm pairing. */
  function confirmModal(title, body, { danger = false, confirmText = 'Confirm', cancelText = 'Cancel' } = {}) {
    return new Promise((resolve) => {
      // Tapping outside the dialog (easy to do by accident on a touch screen) still needs to
      // settle this promise — otherwise whatever's awaiting the answer hangs forever even
      // though the modal itself has visibly closed. Treat it as Cancel.
      const m = openModal(`
        <div class="head"><span class="t" style="font-weight:600">${title}</span></div>
        <div class="body"><p class="mt-0 mb-8">${body}</p></div>
        <div class="foot">
          <button class="btn ${danger ? 'btn-danger' : 'btn-secondary'}" data-act="no">${esc(cancelText)}</button>
          <button class="btn ${danger ? 'btn-secondary' : 'btn-primary'}" data-act="yes">${esc(confirmText)}</button>
        </div>`, null, () => resolve(false));
      const dim = m.closest('.modal-dim');
      const yes = m.querySelector('[data-act="yes"]');
      const no = m.querySelector('[data-act="no"]');
      no.onclick = () => { closeDim(dim); resolve(false); };
      yes.onclick = () => { closeDim(dim); resolve(true); };
    });
  }

  /* ---------------- Tour (crisp focus, multi-screen, modal showcases, soft transitions) ----------------
     The highlight box and bubble are created ONCE and reused across steps, so their CSS transitions
     animate the move/resize between steps (a soft glide + cross-fade) instead of the old
     destroy-and-recreate flicker. A step may:
       - route: '<view>'      navigate to a view first (page is scrolled to the top after)
       - action: fn           run something before highlighting (e.g. open a modal to showcase it)
       - sel: '<css>'         element to spotlight ('.modal' spotlights a just-opened dialog)
     Positioning always runs AFTER an instant scroll settles (no smooth-scroll race), and a
     passive scroll/resize listener keeps the spotlight glued to its target for the whole step.
     Any modal a step opens is auto-dismissed when the tour advances. */
  let tourState = null;
  let tourEls = null;
  let tourTrackRAF = 0;
  const TOUR_SETTLE = 90;

  // Events that could change app state / enter data. Blocked (except from the tour bubble, and
  // Escape) for the whole tour so nobody types into a form while just looking around.
  const TOUR_BLOCKED_EVENTS = ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu',
    'keydown', 'keypress', 'keyup', 'input', 'beforeinput', 'paste', 'submit', 'dragstart'];
  function tourEventGuard(e) {
    if (!tourState || !tourEls) return;
    if (tourEls.bubble.contains(e.target)) return;                 // the tour's own controls
    if (e.type === 'keydown' && e.key === 'Escape') {              // Esc exits the whole tour
      e.stopImmediatePropagation();
      if (e.cancelable) e.preventDefault();
      stopTour();
      return;
    }
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
  }

  function startTour(steps) {
    stopTour();
    tourState = { steps, i: 0 };
    window.addEventListener('scroll', onTourScroll, { passive: true });
    window.addEventListener('resize', onTourResize);
    TOUR_BLOCKED_EVENTS.forEach((t) => document.addEventListener(t, tourEventGuard, true));
    renderTour();
  }

  function ensureTourEls() {
    if (tourEls && document.body.contains(tourEls.box) && document.body.contains(tourEls.bubble)) return tourEls;
    const blocker = document.createElement('div');
    blocker.className = 'tour-blocker';                            // eats pointer events + text selection
    const box = document.createElement('div');
    box.className = 'tour-box is-entering';
    const bubble = document.createElement('div');
    bubble.className = 'tour-bubble is-entering';
    document.body.append(blocker, box, bubble);
    tourEls = { blocker, box, bubble };
    return tourEls;
  }

  function closeTourModals() {
    document.querySelectorAll('.modal-dim').forEach((d) => d.remove());
  }

  function stepTarget(step) {
    return step && step.sel ? document.querySelector(step.sel) : null;
  }

  function renderTour() {
    if (!tourState) return;
    const step = tourState.steps[tourState.i];

    // Leaving the previous step: dismiss any modal it opened before we route/act again.
    closeTourModals();

    if (step.route && global.App && global.App.route) {
      global.App.route(step.route, step.projectId);
      window.scrollTo(0, 0);                 // a fresh view starts at the top, not wherever we were
    }
    if (typeof step.action === 'function') {
      try { step.action(); } catch (_) { /* showcase is best-effort */ }
    }

    const { bubble } = ensureTourEls();
    bubble.classList.add('is-moving');       // fade out while the new target renders + settles

    // rAF + a short settle lets the routed view / opened modal lay out before we measure.
    requestAnimationFrame(() => setTimeout(() => {
      if (!tourState) return;
      layoutStep();
    }, TOUR_SETTLE));
  }

  function layoutStep() {
    const step = tourState.steps[tourState.i];
    const { box, bubble } = tourEls;
    const isLast = tourState.i >= tourState.steps.length - 1;

    const hasBack = tourState.i > 0;
    bubble.innerHTML =
      '<div class="t">' + step.title + '</div>' +
      '<div class="b">' + step.body + '</div>' +
      '<div class="foot">' +
        '<span class="step">' + (tourState.i + 1) + ' / ' + tourState.steps.length + '</span>' +
        '<div class="grow"></div>' +
        (hasBack ? '<button class="btn btn-ghost btn-sm" data-tour="back">Back</button>' : '') +
        '<button class="btn btn-ghost btn-sm" data-tour="skip">Skip</button>' +
        '<button class="btn btn-tour btn-sm" data-tour="next">' + (isLast ? 'Finish' : 'Next') + '</button>' +
      '</div>';
    bubble.querySelector('[data-tour="next"]').onclick = () => {
      if (!tourState) return;
      tourState.i++;
      if (tourState.i >= tourState.steps.length) stopTour();
      else renderTour();
    };
    const back = bubble.querySelector('[data-tour="back"]');
    if (back) back.onclick = () => {
      if (!tourState || tourState.i === 0) return;
      tourState.i--;
      renderTour();
    };
    const skip = bubble.querySelector('[data-tour="skip"]');
    if (skip) skip.onclick = stopTour;

    // Drop focus from anything in the app so a pre-focused input can't take keystrokes / show a caret.
    const af = document.activeElement;
    if (af && af !== document.body && !bubble.contains(af)) { try { af.blur(); } catch (_) {} }

    const target = stepTarget(step);
    if (target && !target.closest('.modal-dim')) scrollTargetIntoView(target);
    placeSpotlight(box, bubble, target, true);

    requestAnimationFrame(() => { box.classList.remove('is-entering'); bubble.classList.remove('is-moving', 'is-entering'); });
  }

  // Instant (no smooth-scroll race) scroll so `target` sits comfortably below the sticky topbar.
  function scrollTargetIntoView(target) {
    const topbar = document.querySelector('.topbar');
    const topGap = (topbar ? topbar.getBoundingClientRect().height : 0) + 18;
    const r = target.getBoundingClientRect();
    const viewH = window.innerHeight;
    const docTop = r.top + window.scrollY;
    let dest;
    if (r.height >= viewH - topGap - 32) {
      dest = docTop - topGap;                                   // taller than the space → pin its top
    } else {
      const room = viewH - topGap;
      dest = docTop - topGap - Math.max(0, (room - r.height) / 2 - 12);
    }
    window.scrollTo(0, Math.max(0, Math.round(dest)));
  }

  function placeSpotlight(box, bubble, target, animate) {
    const winW = window.innerWidth, winH = window.innerHeight;
    const bw = Math.min(360, winW - 32);
    bubble.style.maxWidth = bw + 'px';
    box.classList.toggle('no-anim', !animate);
    bubble.classList.toggle('no-anim', !animate);

    if (!target) {                                              // pure orientation: dim + centre bubble
      box.classList.add('bare');
      box.style.left = Math.round(winW / 2) + 'px';
      box.style.top = Math.round(winH / 2) + 'px';
      box.style.width = '0px';
      box.style.height = '0px';
      const bh = bubble.offsetHeight || 160;
      bubble.style.left = Math.round((winW - bw) / 2) + 'px';
      bubble.style.top = Math.round((winH - bh) / 2) + 'px';
      return;
    }

    box.classList.remove('bare');
    const r = target.getBoundingClientRect();
    const pad = 6;
    // Clamp to the viewport so a target taller than the screen still frames cleanly.
    const t = Math.max(4, r.top - pad);
    const l = Math.max(4, r.left - pad);
    const b = Math.min(winH - 4, r.bottom + pad);
    const rt = Math.min(winW - 4, r.right + pad);
    box.style.left = l + 'px';
    box.style.top = t + 'px';
    box.style.width = Math.max(0, rt - l) + 'px';
    box.style.height = Math.max(0, b - t) + 'px';

    // Bubble: prefer to the right of the target, then left, then below, then above, then centred.
    const bh = bubble.offsetHeight || 160;
    const gap = 16;
    const clampY = (y) => Math.max(12, Math.min(y, winH - bh - 12));
    const clampX = (x) => Math.max(12, Math.min(x, winW - bw - 12));
    let bx, by;
    if (r.right + gap + bw <= winW - 8) { bx = r.right + gap; by = clampY(r.top); }
    else if (r.left - gap - bw >= 8) { bx = r.left - gap - bw; by = clampY(r.top); }
    else if (b + gap + bh <= winH - 8) { bx = clampX(r.left); by = b + gap; }
    else if (t - gap - bh >= 8) { bx = clampX(r.left); by = t - gap - bh; }
    else { bx = (winW - bw) / 2; by = winH - bh - 14; }
    bubble.style.left = Math.round(bx) + 'px';
    bubble.style.top = Math.round(by) + 'px';
  }

  // Keep the spotlight on its target if anything scrolls/shifts mid-step (no re-scroll, no glide).
  function onTourScroll() {
    if (!tourState || !tourEls || tourTrackRAF) return;
    tourTrackRAF = requestAnimationFrame(() => {
      tourTrackRAF = 0;
      if (!tourState || !tourEls) return;
      placeSpotlight(tourEls.box, tourEls.bubble, stepTarget(tourState.steps[tourState.i]), false);
    });
  }
  function onTourResize() {
    if (!tourState || !tourEls) return;
    const target = stepTarget(tourState.steps[tourState.i]);
    if (target && !target.closest('.modal-dim')) scrollTargetIntoView(target);
    placeSpotlight(tourEls.box, tourEls.bubble, target, false);
  }

  function stopTour() {
    tourState = null; tourEls = null;
    window.removeEventListener('scroll', onTourScroll);
    window.removeEventListener('resize', onTourResize);
    TOUR_BLOCKED_EVENTS.forEach((t) => document.removeEventListener(t, tourEventGuard, true));
    closeTourModals();
    stopTourDom();
  }
  function stopTourDom() { document.querySelectorAll('.tour-dim, .tour-blocker, .tour-box, .tour-bubble').forEach((e) => e.remove()); }

  /* ---------------- Icons (Lucide-style, inline) ---------------- */
  const ICONS = {
    home: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    folder: '<path d="M4 7h16"/><path d="M4 7v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7"/><path d="M4 7l2-3h8l2 3"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3"/><path d="M15 7a4 4 0 0 0 4 4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M2 8h2M20 8h2M2 16h2M20 16h2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M7 2v2M15 2v2M3 14h18"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    alert: '<path d="M12 22v-6M12 16V8M5 12h14"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    'file-plus': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
    sparkles: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    play: '<path d="M5 3l14 9-14 9z"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    'chevron-left': '<path d="M15 18l-6-6 6-6"/>',
    'chevron-right': '<path d="M9 6l6 6-6 6"/>',
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
    expand: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m11 9 3 3-3 3"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    archive: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>'
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
  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
    return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString();
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  /* A retired person/instrument keeps its real name in the database — the suffix is added at
     display time only, so historical records still read back exactly as they were entered. */
  function retiredName(name, isRetired) {
    return isRetired ? String(name == null ? '' : name) + ' (Retired)' : String(name == null ? '' : name);
  }
  function isSafeUrl(u) { return /^https?:\/\//i.test(String(u || '').trim()); }

  /* ---------------- Rich-text notes: sanitize + render ----------------
     Notes (meeting bookings) are stored as a small HTML subset produced by a contentEditable
     editor. sanitizeHtml() whitelists tags/attrs so nothing unsafe is ever persisted or shown;
     noteHtml() renders a stored value, treating legacy tag-free notes as plain text. */
  const RTE_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, UL: 1, OL: 1, LI: 1, BR: 1, P: 1, DIV: 1, SPAN: 1 };
  function sanitizeHtml(html) {
    const src = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const out = document.implementation.createHTMLDocument('').body;

    function clean(srcNode, destParent) {
      srcNode.childNodes.forEach((child) => {
        if (child.nodeType === 3) {                                       // text
          destParent.appendChild(out.ownerDocument.createTextNode(child.nodeValue));
          return;
        }
        if (child.nodeType !== 1) return;                                 // skip comments etc.
        const tag = child.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE') return;
        if (!RTE_TAGS[tag]) { clean(child, destParent); return; }         // unwrap unknown tags

        const el = out.ownerDocument.createElement(tag);
        const size = (child.getAttribute('style') || '').match(/font-size:\s*([0-9.]+(?:em|px))/i);
        if (size) {
          let v = size[1];
          const px = v.match(/^([0-9.]+)px$/i);
          if (px && parseFloat(px[1]) > 48) v = '48px';
          el.setAttribute('style', 'font-size:' + v);
        }
        destParent.appendChild(el);
        clean(child, el);
      });
    }
    clean(src.body, out);

    if (!out.textContent.trim() && !out.querySelector('li')) return '';   // empty editor
    return out.innerHTML.trim();
  }
  function noteHtml(s) {
    s = String(s || '');
    if (!s.trim()) return '';
    if (/<[a-z][\s\S]*>/i.test(s)) return sanitizeHtml(s);
    return esc(s).replace(/\n/g, '<br>');
  }

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
    sanitizeHtml,
    noteHtml,
    fmtDate,
    today,
    retiredName,
    isSafeUrl,
    detectOS,
    copyToClipboard,
    storage: { getItem: storageGet, setItem: storageSet }
  };

})(window);
