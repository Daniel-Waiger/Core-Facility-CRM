/* ui.js — toasts, theme, tour, modals, misc */
(function (global) {
  'use strict';

  /* ---------------- Safe localStorage ----------------
     Locked-down mobile WebViews (and private-browsing modes) can throw on any
     localStorage access, not just IndexedDB. Route all reads/writes through here so a
     blocked browser degrades to an in-memory value instead of crashing the page. */
  const memoryStorageFallback = {};
  let localStorageBlocked = false;

  /* Demo-sandbox key namespacing. localStorage is shared by every tab on this origin, so without
     this the demo tab would write straight into the real app's preferences — and two of those
     keys do real damage: 'last-auto-backup-at' would make the real app think it had already
     backed up today (skipping a backup it should have taken), and the two first-run notice flags
     would permanently dismiss guidance the user never actually saw. The rest ('admin-mode',
     'sidebar-collapsed', …) would just be confusing.
     'theme' is deliberately SHARED and unprefixed: the sandbox should look like the user's own
     app, and a remembered light/dark choice is not state worth isolating. */
  const SHARED_KEYS = { theme: 1 };
  function nsKey(key) {
    return (global.IS_DEMO && !SHARED_KEYS[key]) ? 'demo:' + key : key;
  }
  function storageGet(key) {
    key = nsKey(key);
    if (localStorageBlocked) {
      return Object.prototype.hasOwnProperty.call(memoryStorageFallback, key) ? memoryStorageFallback[key] : null;
    }
    try { return localStorage.getItem(key); } catch (_) { localStorageBlocked = true; return storageGetRaw(key); }
  }
  // Post-namespacing read, so the catch path above doesn't prefix an already-prefixed key.
  function storageGetRaw(key) {
    return Object.prototype.hasOwnProperty.call(memoryStorageFallback, key) ? memoryStorageFallback[key] : null;
  }
  function storageSet(key, val) {
    key = nsKey(key);
    if (localStorageBlocked) { memoryStorageFallback[key] = String(val); return; }
    try { localStorage.setItem(key, val); } catch (_) { localStorageBlocked = true; memoryStorageFallback[key] = String(val); }
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
        // Sidebar controls use the native `title` tooltip only: the styled [data-tooltip] one is
        // positioned above its element, which in this tightly stacked rail lands on the control
        // above it. Cleared here because this button's tooltip text is rebuilt on every toggle.
        btn.removeAttribute('data-tooltip');
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
     resolved — the inner card was removed but the outer overlay never was).

     Modals can stack (a nested "+ Add New" opened from inside another form, a confirm on top of
     an edit dialog, …). `topModal()`/`topDim()` are the one place that answers "which modal is
     the user actually looking at right now" — every save/run function in app.js reads its form
     fields off `UI.topModal()` rather than the first `.modal` in the DOM, which would silently be
     whichever modal happened to open FIRST (e.g. Today's Agenda) instead of whatever is on top of
     it (e.g. Edit Booking opened from that agenda). */
  function topDim() {
    const dims = document.querySelectorAll('.modal-dim');
    return dims.length ? dims[dims.length - 1] : null;
  }
  function topModal() {
    const dim = topDim();
    return dim ? dim.querySelector('.modal') : null;
  }
  // Closes every open modal, topmost first, so each one's stored `_prevFocus` restores focus in
  // the right order (ending on whatever had focus before the FIRST modal opened). Used when the
  // app navigates out from under an open modal (hashchange, a nested `data-goto`) — a draft in a
  // modal is deliberately abandoned in that case, since the record it was bound to may no longer
  // be the one on screen.
  function closeAllModals() {
    const dims = [...document.querySelectorAll('.modal-dim')];
    for (let i = dims.length - 1; i >= 0; i--) closeDim(dims[i]);
  }

  // Elements a modal can usefully move focus to/trap Tab between. Excludes disabled controls and
  // negative-tabindex elements (those are programmatically focusable but deliberately skipped in
  // tab order elsewhere in the app).
  const FOCUSABLE_SEL = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), ' +
    'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  function focusableIn(container) {
    return [...container.querySelectorAll(FOCUSABLE_SEL)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  }
  // Moves focus to the first focusable field in `m` — the first form field for an ordinary
  // dialog, or (confirmModal's DOM order puts it first) the Cancel button on a confirm dialog,
  // which is deliberately "the safe way out" for a danger dialog. Callers with a more specific
  // idea of what should be focused (a search box, a freshly-added row) call `.focus()` themselves
  // afterward from their `onMount`, which simply overrides this.
  function focusFirstIn(m) {
    const first = focusableIn(m)[0];
    if (first) { try { first.focus(); } catch (_) {} }
  }
  function openModal(html, onMount, onOutsideClick) {
    const dim = document.createElement('div');
    dim.className = 'modal-dim';
    dim.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(dim);
    const m = dim.querySelector('.modal');
    // Stash the dismissal handler so Esc can reuse the exact outside-click semantics
    // (important for promise-based modals like confirmModal, which resolve on dismissal).
    dim._onDismiss = onOutsideClick || null;
    // Captured BEFORE we move focus into the modal, so closeDim can put it back afterward.
    dim._prevFocus = document.activeElement;
    focusFirstIn(m);
    if (onMount) onMount(m, dim);
    dim.addEventListener('click', (e) => {
      if (e.target !== dim) return;
      closeDim(dim);
      if (onOutsideClick) onOutsideClick();
    });
    return m;
  }
  function closeDim(dim) {
    if (!dim) return;
    const prev = dim._prevFocus;
    dim.remove();
    if (prev && document.body.contains(prev) && typeof prev.focus === 'function') {
      try { prev.focus(); } catch (_) {}
    }
  }

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
      const dim = topDim();
      if (!dim) return;
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
    if (e.key === 'Tab') {
      const dim = topDim();
      if (!dim) return; // no modal open: ordinary page Tab order
      const m = dim.querySelector('.modal');
      const focusable = focusableIn(m);
      if (!focusable.length) { e.preventDefault(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // Trap Tab/Shift+Tab inside the topmost modal. If focus is already at an edge, wrap instead
      // of letting it escape to whatever's underneath; if focus has somehow ended up OUTSIDE the
      // modal entirely (shouldn't happen, but don't leave the user stuck on the dimmed page
      // behind a danger confirm), pull it back in rather than let Tab do nothing useful.
      if (!m.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.key === 'Enter') {
      const el = e.target;
      if (el.tagName === 'TEXTAREA' || el.isContentEditable) return;      // never hijack multi-line input
      if (el.closest && el.closest('.token-picker')) return;              // filtering/picking, not submitting
      const isSingleLineInput = el.tagName === 'INPUT' &&
        !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'range', 'color'].includes(el.type);
      if (!isSingleLineInput && el.tagName !== 'SELECT') return;
      const dim = topDim();
      if (!dim || !dim.contains(el)) return;
      const primary = dim.querySelector('.modal .foot .btn-primary');
      if (primary && !primary.disabled) { e.preventDefault(); primary.click(); }
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
      global.App.route(step.route, step.projectId, true);
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
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
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
    archive: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>'
  };
  /* The width/height attributes are a floor, not a design choice: an inline <svg> carrying only a
     viewBox has no natural size, so in any context without a `… svg { width; height }` CSS rule it
     lays out at 0×0 and the icon is simply invisible (this is why the sidebar's collapse button
     looked absent and the People table's "facility staff" ticks were empty pills). Presentation
     attributes lose to every CSS rule, so each context that sizes its own icons still wins. */
  function icon(name) {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
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
  /* 'YYYY-MM-DD' for a Date's LOCAL calendar day.
     Why not toISOString().slice(0,10)? A Date is a single instant, and toISOString() re-describes
     that instant in UTC. Local midnight at a UTC+ offset (Israel is UTC+2/+3) happened while it
     was still the PREVIOUS day in UTC, so toISOString() reports yesterday's date. Bookings are
     stored as plain local 'YYYY-MM-DD' strings taken straight from <input type="date">, so every
     Date -> date-string conversion in this app has to read the local calendar fields instead. */
  function ymd(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return '';
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0')
      + '-' + String(dt.getDate()).padStart(2, '0');
  }
  function today() { return ymd(new Date()); }
  // Today shifted by a whole number of days, as a local 'YYYY-MM-DD' string.
  function todayPlusDays(n) {
    const d = new Date();
    d.setDate(d.getDate() + (Number(n) || 0));
    return ymd(d);
  }

  /* ---------------- Booking time maths ----------------
     Shared by the booking cost calculator (app.js) and the Reports screen (reports.js) so both
     count hours the same way. Times are stored as plain 'HH:MM' strings on the same calendar day,
     so this is minute arithmetic — no Date objects and no timezones involved. */
  // "HH:MM" -> minutes since midnight, or null if not a valid time.
  function timeToMinutes(hhmm) {
    const mm = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    return mm ? Number(mm[1]) * 60 + Number(mm[2]) : null;
  }
  // Hours between two "HH:MM" times as a decimal (9:00->11:30 is 2.5). Missing or non-positive
  // spans count as 0 hours, so a booking with no times contributes nothing.
  function hoursBetween(start, end) {
    const a = timeToMinutes(start), b = timeToMinutes(end);
    if (a == null || b == null || b <= a) return 0;
    return (b - a) / 60;
  }
  // The 1-hour floor: any staff time above zero bills at least 1 hour, and anything past that
  // rounds UP to the next whole hour. So 10 minutes bills as 1 hour and 65 minutes as 2 hours.
  function billableStaffHours(rawHours) {
    return rawHours > 0 ? Math.max(1, Math.ceil(rawHours)) : 0;
  }

  /* ---------------- Booking cost math (bill of materials) ----------------
     Plain-language walkthrough of every number below, since this is money math that has to be
     auditable, not just "works":
       1. Booking hours = how long the instrument is reserved for, as a decimal number of hours
          (9:00 to 11:30 is 2.5 hours). No start+end time on the booking → 0 hours.
       2. Each instrument bills either by that duration (unit "time", e.g. $/hour) or by a
          manually-typed amount (any other unit — $/sample, $/gram, etc).
       3. Each Facility Staff assignee bills by their OWN window inside the booking (left blank =
          the full booking window), but never less than 1 hour, and always rounded UP to a whole
          hour beyond that — so 10 minutes bills as 1 hour, and 65 minutes bills as 2 hours — and
          THEN scaled by the booking's category billing policy (staffPctFactor below), if any.
       4. Discounts — a standing per-lab percent plus a manual admin override, added together —
          apply ONLY to the time-billed instrument cost, never to staff time or to per-unit/
          per-weight instrument costs.
       5. What's left after the discount then has ONE overhead percentage added on top of it — the
          lab/group's assigned pricing tier when it has one, or (no tier assigned) the legacy
          Internal+External overhead sum, resolved by the CALLER via DB.resolveOverheadForOrg
          before this function ever runs, so this is just arithmetic on whatever number it's
          handed — that "before tax" figure is what a facility would actually invoice before any
          tax line — and finally the tax percentage is added on top of THAT to get the final
          total. */
  // staffPctFactor (default 1, i.e. 100%): the category billing policy's staff_pct/100, applied to
  // STAFF LINES ONLY, and applied AFTER the 1-hour floor above — the floor is stated policy (a
  // facility always holds at least an hour of staff time), the percent scales what that floored
  // line then bills. Instrument time is never touched by it: tiers/discounts already govern that.
  // Resolving which policy applies to a given category is the CALLER's job (DB.categoryPolicy),
  // same division of labor as overheadPct/instrument tier rates above — this function only does
  // arithmetic on whatever factor it's handed. Omitted/undefined ⇒ 1, so every existing caller
  // that predates this parameter (and any legacy booking recomputation) is unaffected.
  function computeBookingBOM({ start, end, instruments, staff, groupPct, manualPct, rates, staffPctFactor }) {
    const bookingHours = hoursBetween(start, end);
    const overheadPct = (rates && rates.overheadPct) || 0;
    const taxPct = (rates && rates.taxPct) || 0;
    const pctFactor = staffPctFactor == null ? 1 : staffPctFactor;

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
      const line = (p.rate || 0) * billHours * pctFactor;
      staffTotal += line;
      return Object.assign({}, p, { rawHours, billHours, line });
    });

    const subtotal = instrTime + instrAmount + staffTotal;
    const discPct = Math.min(100, (groupPct || 0) + (manualPct || 0));
    const discountAmt = instrTime * (discPct / 100);
    const afterDiscount = subtotal - discountAmt;
    const overheadAmt = afterDiscount * (overheadPct / 100);
    const beforeTax = afterDiscount + overheadAmt;
    const taxAmt = beforeTax * (taxPct / 100);
    const total = beforeTax + taxAmt;

    return {
      bookingHours, instrumentLines, staffLines, instrTime, instrAmount, staffTotal, subtotal,
      groupPct: groupPct || 0, manualPct: manualPct || 0, discPct, discountAmt, afterDiscount,
      overheadPct, overheadAmt, beforeTax, taxPct, taxAmt, total, staffPctFactor: pctFactor
    };
  }  /* A retired person/instrument keeps its real name in the database — the suffix is added at
     display time only, so historical records still read back exactly as they were entered. */
  function retiredName(name, isRetired) {
    return isRetired ? String(name == null ? '' : name) + ' (Retired)' : String(name == null ? '' : name);
  }
  function isSafeUrl(u) { return /^https?:\/\//i.test(String(u || '').trim()); }

  /* ---------------- Display formatters for values that are ALSO data ----------------
     Three of these, and they all exist for the same reason: several columns store a raw value
     that the app must keep byte-for-byte (it is compared with === , written back to the
     database, or round-tripped through a data- attribute) while showing the user something
     readable. So these translate at DISPLAY time only and never touch what is stored — the same
     division of labour as retiredName above.

     fmtMoney lives here rather than in app.js or reports.js because CLAUDE.md requires exactly
     one copy: "a report that disagrees with the booking modal about money is worse than no
     report". ui.js is the only file loaded before all four consumers (views, reports, exports,
     app), which is why the shared hour maths already lives here too. */

  /* Currency symbol from Settings + two decimals and thousands separators, e.g. $1,250.00.

     The locale is pinned deliberately. toLocaleString(undefined, …) follows whatever locale the
     VIEWER's browser is set to, which swaps the separators outright — the same booking renders
     $1,234,567.50 for one person and $1.234.567,50 for another (de-DE), $1 234 567,50 (fr-FR), or
     $12,34,567.50 with Indian lakh grouping. A facility configures a currency SYMBOL here, not a
     locale, so a period acting as the thousands separator next to a "$" is actively misleading —
     and two people reading the same invoice figure should not see two different numbers.
     Pinning also keeps the exports and the printed reports identical whoever generated them. */
  const MONEY_LOCALE = 'en-US';
  function fmtMoney(n) {
    const cur = (global.DB && global.DB.getConfig) ? global.DB.getConfig('currency', '$') : '$';
    return cur + (Math.round((Number(n) || 0) * 100) / 100)
      .toLocaleString(MONEY_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* An instrument's cost_unit says HOW it is priced: 'time' bills the booking's duration, any
     other unit bills a quantity typed in on the booking. The stored value is compared against
     'time' in the cost calculator, so it stays lowercase; only the label changes.
     UNIT is vocab-extensible (facilities add their own via "+ Add New"), so an unknown value
     must fall through to itself rather than render blank. */
  const UNIT_LABELS = { time: 'per hour', unit: 'per unit', weight: 'per weight', other: 'flat rate' };
  function unitLabel(u) {
    const v = String(u == null || u === '' ? 'time' : u);
    return UNIT_LABELS[v] || v;
  }

  /* Milestone statuses are stored lowercase and hyphenated ('in-progress') because that exact
     text is compared in SQL (`status != 'done'`) and round-tripped through data-status on the
     status picker's buttons. 'overdue' is not a stored status at all — it is derived from the due
     date — but it renders in the same badges, so it is mapped here too. Unknown values fall
     through to themselves, matching Views.statusBadge's `|| 'neutral'` tolerance. */
  const MS_STATUS_LABELS = { 'pending': 'Pending', 'in-progress': 'In Progress', 'done': 'Done', 'overdue': 'Overdue' };
  function msStatusLabel(s) {
    const v = String(s == null ? '' : s);
    return MS_STATUS_LABELS[v] || v;
  }

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
    closeAllModals,
    topModal,
    topDim,
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
    computeBookingBOM,
    ymd,
    today,
    todayPlusDays,
    timeToMinutes,
    hoursBetween,
    billableStaffHours,
    retiredName,
    isSafeUrl,
    fmtMoney,
    unitLabel,
    msStatusLabel,
    detectOS,
    copyToClipboard,
    storage: { getItem: storageGet, setItem: storageSet }
  };

})(window);
