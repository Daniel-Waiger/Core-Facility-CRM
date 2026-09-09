// Core Facility Tracker — User Manual scaffolding.
// Renders the sidebar (title, search, chapter nav) and the prev/next pager on every chapter
// page, and drives the search box (here and on the hub). Vanilla JS, no libraries, no build step.
//
// GitHub Pages serves this file (and manual.css) with `cache-control: max-age=600` and no other
// invalidation — every <script src="manual.js?v=N"> and <link href="manual.css?v=N"> tag across
// all 17 manual pages must have its `?v=N` bumped whenever either file changes, or visitors keep
// getting the stale cached copy for up to 10 minutes after a change ships (this is the same class
// of bug CLAUDE.md documents for the app shell's own `?v=`/service-worker cache-busting).
(function () {
  'use strict';

  var CHAPTERS = [
    { num: 1, file: 'getting-started.html', title: 'Getting Started',
      blurb: 'Open the app for the first time, take the guided tour, and load practice data so nothing you try is real.' },
    { num: 2, file: 'big-ideas.html', title: 'The Big Ideas',
      blurb: 'The handful of concepts — where your data lives, retire vs. delete, local dates — that make the rest of the app make sense.' },
    { num: 3, file: 'dashboard.html', title: "Dashboard & Today's Agenda",
      blurb: 'Read the summary tiles and the upcoming/overdue feeds you land on every time you open the app.' },
    { num: 4, file: 'projects.html', title: 'Projects',
      blurb: 'Create a project, track its status, and keep its team, files and custom fields organized.' },
    { num: 5, file: 'milestones.html', title: 'Milestones',
      blurb: 'Break a project into dated milestones, assign owners and instruments, and keep overdue ones visible.' },
    { num: 6, file: 'people-labs.html', title: 'People & Labs',
      blurb: 'Add researchers and staff, organize them by lab or department, and retire people who move on.' },
    { num: 7, file: 'instruments.html', title: 'Instruments',
      blurb: 'Register a microscope or instrument, set what it costs to run, and retire one that leaves the facility.' },
    { num: 8, file: 'bookings.html', title: 'Booking a Session',
      blurb: 'Reserve an instrument for a project, add attendees and staff, and avoid double-booking a slot.' },
    { num: 9, file: 'costs-math.html', title: 'How Costs Are Calculated',
      blurb: 'A worked example of exactly how a booking turns instrument time and staff hours into a dollar figure.' },
    { num: 10, file: 'cancelling.html', title: 'Cancelling & Billing Rules',
      blurb: 'What happens — and what gets billed — when a session is cancelled before or after it starts.' },
    { num: 11, file: 'service-entries.html', title: 'Service Entries',
      blurb: 'Charge for technician time or sample prep without a booking, and cancel a charge the right way.' },
    { num: 12, file: 'email-attendees.html', title: 'Emailing Attendees',
      blurb: 'How the Email Attendees button hands off to your own mail app, and why it cannot send mail itself.' },
    { num: 13, file: 'reports.html', title: 'Reports & Utilization',
      blurb: 'Pull instrument hours, staff time, and spend by project or lab over any date range.' },
    { num: 14, file: 'backups-exports.html', title: 'Backups, Restore & Exports',
      blurb: 'Back up your data, restore it, move it to a new computer, and export projects or reports to file.' },
    { num: 15, file: 'settings-admin.html', title: 'Settings, Admin Mode & Discounts',
      blurb: 'Set billing rates, turn on Admin Mode, and manage per-lab group discounts.' },
    { num: 16, file: 'rough-edges.html', title: 'Appendix A — Rough Edges & Workarounds',
      blurb: 'Known quirks and awkward corners of the app, and the workaround for each.' },
    { num: 17, file: 'glossary-faq.html', title: 'Appendix B — Glossary & FAQ',
      blurb: 'Plain-English definitions of every term used in this manual, plus answers to common questions.' }
  ];

  var HUB = 'index.html';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ----------------------------------------------------------------- theme
  // The very first inline <script> in every page's <head> already set data-theme before
  // paint (reading the same 'theme' localStorage key the app itself uses, since the app and
  // the docs site share an origin) — this just renders/wires the button to match and change it.
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  function updateThemeButtons(theme) {
    var next = theme === 'dark' ? 'light' : 'dark';
    var btns = document.querySelectorAll('.theme-btn');
    for (var i = 0; i < btns.length; i++) {
      var ic = btns[i].querySelector('.ic');
      var lbl = btns[i].querySelector('.lbl');
      if (ic) ic.textContent = next === 'dark' ? '🌙' : '☀️';
      if (lbl) lbl.textContent = next === 'dark' ? 'Dark Mode' : 'Light Mode';
    }
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (e) {}
    updateThemeButtons(theme);
  }
  function wireThemeButtons() {
    var btns = document.querySelectorAll('.theme-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      });
    }
    updateThemeButtons(currentTheme());
  }

  // ---------------------------------------------------------------- sidebar
  function renderSidebar() {
    var el = document.getElementById('sidebar');
    if (!el) return;
    var current = document.body.dataset.chapter || '';

    var navHtml = CHAPTERS.map(function (c) {
      var isCurrent = c.file === current;
      return '<a href="' + c.file + '"' + (isCurrent ? ' class="current" aria-current="page"' : '') + '>' +
        '<span class="toc-num">' + c.num + '</span><span>' + esc(c.title) + '</span></a>';
    }).join('');

    el.innerHTML =
      '<a class="manual-title" href="' + HUB + '">Core Facility Tracker</a>' +
      '<span class="manual-sub">User Manual</span>' +
      '<button type="button" class="theme-btn" aria-label="Switch color theme">' +
      '<span class="ic"></span><span class="lbl"></span></button>' +
      '<div class="search-box">' +
      '<input type="search" id="manual-search" placeholder="Search the manual…" autocomplete="off" aria-label="Search the manual">' +
      '<div id="search-results" hidden></div>' +
      '</div>' +
      '<button type="button" class="toc-toggle" id="toc-toggle">☰ Chapters</button>' +
      '<nav class="toc" id="manual-toc">' + navHtml + '</nav>';

    var toggle = document.getElementById('toc-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        el.classList.toggle('expanded');
      });
    }
  }

  // ------------------------------------------------------------------ pager
  function renderPager() {
    var el = document.getElementById('pager');
    if (!el) return;
    var current = document.body.dataset.chapter || '';
    var idx = -1;
    for (var i = 0; i < CHAPTERS.length; i++) {
      if (CHAPTERS[i].file === current) { idx = i; break; }
    }
    if (idx === -1) { el.innerHTML = ''; return; }

    var prev = idx > 0 ? CHAPTERS[idx - 1] : null;
    var next = idx < CHAPTERS.length - 1 ? CHAPTERS[idx + 1] : null;

    var html = '';
    if (prev) {
      html += '<a class="prev" href="' + prev.file + '">' +
        '<span class="pager-label">← Previous</span>' +
        '<span class="pager-title">' + esc(prev.title) + '</span></a>';
    } else {
      html += '<a class="prev" href="' + HUB + '">' +
        '<span class="pager-label">← Back to</span>' +
        '<span class="pager-title">Manual home</span></a>';
    }
    if (next) {
      html += '<a class="next" href="' + next.file + '">' +
        '<span class="pager-label">Next →</span>' +
        '<span class="pager-title">' + esc(next.title) + '</span></a>';
    } else {
      html += '<a class="next" href="' + HUB + '">' +
        '<span class="pager-label">Back to</span>' +
        '<span class="pager-title">Manual home</span></a>';
    }
    el.innerHTML = html;
  }

  // ----------------------------------------------------------------- search
  // Lazily builds an in-memory index of every chapter's h2/h3 sections the first time the
  // user types into a search box (there may be several instances of the box on one page —
  // just the sidebar, or the sidebar plus the hub's big search box).
  var index = null;        // array of {file, title, chapterTitle, chapterNum, id, text}
  var indexPromise = null;
  var fetchFailed = false;

  function buildIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = Promise.all(CHAPTERS.map(function (c) {
      return fetch(c.file)
        .then(function (r) { if (!r.ok) throw new Error('bad response'); return r.text(); })
        .then(function (html) { return { chapter: c, html: html }; })
        .catch(function () { return { chapter: c, html: null }; });
    })).then(function (results) {
      var sections = [];
      var anyOk = false;
      results.forEach(function (res) {
        if (!res.html) return;
        anyOk = true;
        var doc;
        try {
          doc = new DOMParser().parseFromString(res.html, 'text/html');
        } catch (e) { return; }
        var main = doc.querySelector('.content') || doc.body;
        if (!main) return;
        var heads = main.querySelectorAll('h2[id], h3[id]');
        heads.forEach(function (h) {
          var text = '';
          var node = h.nextElementSibling;
          while (node && !/^H[23]$/.test(node.tagName)) {
            text += ' ' + (node.textContent || '');
            node = node.nextElementSibling;
          }
          sections.push({
            file: res.chapter.file,
            chapterNum: res.chapter.num,
            chapterTitle: res.chapter.title,
            id: h.id,
            heading: h.textContent || '',
            text: text.replace(/\s+/g, ' ').trim()
          });
        });
      });
      if (!anyOk) fetchFailed = true;
      index = sections;
      return sections;
    }).catch(function () {
      fetchFailed = true;
      index = [];
      return index;
    });
    return indexPromise;
  }

  function highlight(text, terms) {
    var out = esc(text);
    terms.forEach(function (t) {
      if (!t) return;
      var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      out = out.replace(re, '<mark>$1</mark>');
    });
    return out;
  }

  function snippetAround(text, terms) {
    if (!text) return '';
    var lower = text.toLowerCase();
    var pos = -1;
    for (var i = 0; i < terms.length && pos === -1; i++) {
      pos = lower.indexOf(terms[i]);
    }
    if (pos === -1) pos = 0;
    var start = Math.max(0, pos - 60);
    var end = Math.min(text.length, pos + 140);
    var snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    return highlight(snippet, terms);
  }

  function runSearch(query, resultsEl) {
    var q = query.trim();
    if (!q) { resultsEl.hidden = true; resultsEl.innerHTML = ''; return; }

    if (fetchFailed) {
      resultsEl.hidden = false;
      resultsEl.innerHTML = '<div class="sr-note">Search needs this manual to be loaded from a web server ' +
        '(not opened directly as a file) — try the hosted version, or run a local server and reload.</div>';
      return;
    }
    if (!index) {
      resultsEl.hidden = false;
      resultsEl.innerHTML = '<div class="sr-note">Building search index…</div>';
      return;
    }

    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    var scored = [];
    index.forEach(function (sec) {
      var hay = (sec.heading + ' ' + sec.chapterTitle + ' ' + sec.text).toLowerCase();
      var score = 0;
      terms.forEach(function (t) {
        if (sec.heading.toLowerCase().indexOf(t) !== -1) score += 6;
        if (sec.chapterTitle.toLowerCase().indexOf(t) !== -1) score += 2;
        var re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        var m = sec.text.toLowerCase().match(re);
        if (m) score += m.length;
      });
      if (score > 0) scored.push({ sec: sec, score: score });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    scored = scored.slice(0, 8);

    resultsEl.hidden = false;
    if (!scored.length) {
      resultsEl.innerHTML = '<div class="sr-empty">No matches for &ldquo;' + esc(q) + '&rdquo;.</div>';
      return;
    }

    resultsEl.innerHTML = scored.map(function (r, i) {
      var sec = r.sec;
      var snippet = snippetAround(sec.text, terms) || snippetAround(sec.heading, terms);
      return '<a class="sr-item' + (i === 0 ? ' active' : '') + '" href="' + sec.file + '#' + sec.id + '">' +
        '<div class="sr-title">' + highlight(sec.heading, terms) +
        '<span class="sr-chapter">' + esc(sec.chapterTitle) + '</span></div>' +
        '<div class="sr-snippet">' + snippet + '</div></a>';
    }).join('');
  }

  function wireSearchBox(input, resultsEl) {
    if (!input || !resultsEl || input.dataset.wired) return;
    input.dataset.wired = '1';
    var timer = null;

    input.addEventListener('focus', function () {
      if (!index && !indexPromise) buildIndex().then(function () { runSearch(input.value, resultsEl); });
    });

    input.addEventListener('input', function () {
      var val = input.value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        if (!index && !fetchFailed) {
          buildIndex().then(function () { runSearch(val, resultsEl); });
          runSearch(val, resultsEl); // shows "Building search index…" immediately
        } else {
          runSearch(val, resultsEl);
        }
      }, 200);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        resultsEl.hidden = true;
        resultsEl.innerHTML = '';
      } else if (e.key === 'Enter') {
        var top = resultsEl.querySelector('.sr-item');
        if (top) {
          e.preventDefault();
          window.location.href = top.getAttribute('href');
        }
      }
    });

    document.addEventListener('click', function (e) {
      if (e.target !== input && !resultsEl.contains(e.target)) {
        resultsEl.hidden = true;
      }
    });
  }

  function wireAllSearchBoxes() {
    wireSearchBox(document.getElementById('manual-search'), document.getElementById('search-results'));
    wireSearchBox(document.getElementById('hub-search'), document.getElementById('hub-search-results'));
  }

  // ------------------------------------------------------------- hub extras
  function renderChapterGrid() {
    var el = document.getElementById('chapter-grid');
    if (!el) return;
    el.innerHTML = CHAPTERS.map(function (c) {
      return '<a class="chapter-card" href="' + c.file + '">' +
        '<span class="cc-num">Chapter ' + c.num + '</span>' +
        '<h3>' + esc(c.title) + '</h3>' +
        '<p>' + esc(c.blurb) + '</p></a>';
    }).join('');
  }

  // -------------------------------------------------------------------- API
  window.ManualApp = {
    CHAPTERS: CHAPTERS,
    renderSidebar: renderSidebar,
    renderPager: renderPager
  };

  function boot() {
    renderSidebar();
    renderPager();
    renderChapterGrid();
    wireAllSearchBoxes();
    wireThemeButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
