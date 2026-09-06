/* reports.js — Reports & Utilization screen (GitHub issue #14).
   Answers the facility-manager's question verbatim: "how much booked time does an instrument
   get, and how much of MY (staff) time goes to each instrument?" Built entirely from data
   already in the schema — no new tables, no new columns.

   Loaded after views.js, before exports.js (see index.html script order / CLAUDE.md module
   layout). May call DB/UI freely; App.refresh() is only ever called from inside a function body
   (never at load time), since app.js boots last.

   ---------------------------------------------------------------------------------------------
   TWO CANCELLATION RULES — used everywhere below, and worth restating once, in plain language:

   1. OCCUPANCY rule (bookings / hours / sessions): a cancelled booking releases its slot — the
      instrument/staff time was never actually spent — so cancelled rows are EXCLUDED, full stop,
      regardless of whether the cancellation charge was retained. Mirrors findBookingConflicts()
      in app.js, which only treats non-cancelled bookings as occupying a slot.

   2. MONEY rule (revenue / cost columns): a row's charge still counts unless it was BOTH
      cancelled AND the charge was waived. i.e. `counts = !(is_cancelled && !billing_retained)`.
      This is the exact rule already used in js/views.js (Project Costs) and js/exports.js
      (Bookings & Costs sheet) — a cancelled-but-CHARGED booking still contributes money even
      though it contributes zero occupied hours. That split is intentional, not a bug: the
      facility got paid for a slot nobody used.

   STAFF ATTRIBUTION on multi-instrument bookings (decided with the user — see task notes):
   instrument hours need no split (two instruments running in parallel were each genuinely
   occupied for the full time), but a staff member's time on a multi-instrument booking is
   ambiguous, so:
     - Staff hours are authoritative per session (one row per staff member, their real hours).
     - The staff × instrument matrix reports SESSIONS (an unsplit count of bookings — "how many
       times did I touch this instrument") and ATTRIBUTED HOURS (that booking's staff hours ÷
       instrument count on the booking, so attributed hours sum back to the person's true total).
   --------------------------------------------------------------------------------------------- */
(function (global) {
  'use strict';
  const DB = global.DB;
  const UI = global.UI;
  const esc = UI.esc;
  const ic = UI.icon;

  /* ---------------- Range state ----------------
     Either bound may be '' (unbounded). Defaults to the current calendar year, per spec. */
  let state = { from: '', to: '' };
  (function initDefaultRange() {
    const y = new Date().getFullYear();
    state = { from: y + '-01-01', to: y + '-12-31' };
  })();

  function getRange() { return { from: state.from, to: state.to }; }
  function setRange(patch) {
    state = Object.assign({}, state, patch || {});
    global.App.refresh();
  }
  function setPreset(name) {
    if (name === 'month') {
      const d = new Date();
      const first = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
      // Last day of the current month: day 0 of next month.
      const last = UI.ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      state = { from: first, to: last };
    } else if (name === 'year') {
      const y = new Date().getFullYear();
      state = { from: y + '-01-01', to: y + '-12-31' };
    } else { // 'all'
      state = { from: '', to: '' };
    }
    global.App.refresh();
  }

  /* ---------------- Date-range SQL fragment ----------------
     '' on either side means unbounded, so the same params list always has exactly 4 entries
     (from twice, to twice) regardless of which bounds are actually set. Every compute* function
     below takes an explicit (from,to) — defaulting to the module's own state when the caller
     (the screen's own render()) omits them — rather than mutating shared state as a side effect,
     so js/exports.js can call these with the range it was given without disturbing what the
     screen is showing. */
  function rangeParams(from, to) { return [from, from, to, to]; }
  const RANGE_SQL = `(? = '' OR mt.date >= ?) AND (? = '' OR mt.date <= ?)`;

  /* ---------------- Raw data pull ----------------
     One pass over meetings-in-range plus their instrument/staff join rows, all the plain-JS
     aggregation below builds on this. Doing the hour maths in JS (via UI.hoursBetween /
     UI.billableStaffHours) rather than in SQL keeps this file using the exact same functions the
     booking modal uses for its own cost calculator, so the numbers can never drift apart. */
  function loadMeetingsInRange(from, to) {
    return DB.rows(`
      SELECT mt.id, mt.project_id, mt.date, mt.start_time, mt.end_time, mt.group_org,
             mt.total_cost, mt.is_cancelled, mt.billing_retained,
             p.code AS project_code, p.title AS project_title
      FROM meetings mt LEFT JOIN projects p ON p.id = mt.project_id
      WHERE ${RANGE_SQL}
      ORDER BY mt.date ASC, mt.id ASC`, rangeParams(from, to));
  }
  function loadInstrumentLines() {
    return DB.rows(`
      SELECT mi.meeting_id, mi.instrument_id, mi.line_cost,
             i.name AS instrument_name, i.is_retired AS instrument_retired
      FROM meeting_instruments mi
      JOIN instruments i ON i.id = mi.instrument_id`);
  }
  function loadStaffLines() {
    // meeting_staff always names a facility-staff assignee, but a person's is_staff flag could in
    // theory have been unset after the fact (retiring doesn't do this, but be defensive) — join
    // on people without filtering is_staff so no historical row silently disappears.
    return DB.rows(`
      SELECT ms.meeting_id, ms.person_id, ms.start_time, ms.end_time, ms.line_cost,
             pe.name AS person_name, pe.is_retired AS person_retired, pe.rate AS person_rate
      FROM meeting_staff ms
      JOIN people pe ON pe.id = ms.person_id`);
  }

  // Meeting-level derived facts shared by every aggregator below.
  function annotateMeetings(meetings) {
    const byId = new Map();
    meetings.forEach((m) => {
      const bookingHours = UI.hoursBetween(m.start_time, m.end_time);
      byId.set(m.id, {
        m,
        bookingHours,
        occupancyCounts: !m.is_cancelled,                       // rule 1
        moneyCounts: !(m.is_cancelled && !m.billing_retained)    // rule 2
      });
    });
    return byId;
  }

  /* ================================================================================
     Card 1 — Instrument utilisation
     ================================================================================ */
  function computeInstrumentRows(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }
    const meetings = annotateMeetings(loadMeetingsInRange(from, to));
    const lines = loadInstrumentLines();

    const byInstrument = new Map(); // id -> { name, retired, bookings, hours, revenue }
    lines.forEach((ln) => {
      const mm = meetings.get(ln.meeting_id);
      if (!mm) return; // instrument line belongs to a meeting outside the selected range
      let row = byInstrument.get(ln.instrument_id);
      if (!row) {
        row = { id: ln.instrument_id, name: ln.instrument_name, retired: !!ln.instrument_retired, bookings: 0, hours: 0, revenue: 0 };
        byInstrument.set(ln.instrument_id, row);
      }
      if (mm.occupancyCounts) {
        row.bookings += 1;
        row.hours += mm.bookingHours; // parallel instruments on one booking each get the full hours — real occupancy, not double counting
      }
      if (mm.moneyCounts) row.revenue += (ln.line_cost || 0);
    });

    const rows = Array.from(byInstrument.values()).sort((a, b) => b.hours - a.hours);
    const totalHours = rows.reduce((s, r) => s + r.hours, 0);
    rows.forEach((r) => { r.sharePct = totalHours > 0 ? (r.hours / totalHours) * 100 : 0; });
    return { rows, totalHours };
  }

  /* ================================================================================
     Card 2 — Facility staff time
     ================================================================================ */
  function computeStaffRows(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }
    const meetings = annotateMeetings(loadMeetingsInRange(from, to));
    const lines = loadStaffLines();

    const byPerson = new Map(); // id -> { name, retired, sessions, rawHours, billHours, revenue }
    lines.forEach((ln) => {
      const mm = meetings.get(ln.meeting_id);
      if (!mm) return;
      // meeting_staff.start_time/end_time blank means "the whole booking window" (see
      // computeBookingBOM in app.js) — NOT zero. Fall back to the meeting's own hours exactly
      // the same way the booking cost calculator does.
      const rawHours = (ln.start_time && ln.end_time) ? UI.hoursBetween(ln.start_time, ln.end_time) : mm.bookingHours;
      const billHours = UI.billableStaffHours(rawHours);

      let row = byPerson.get(ln.person_id);
      if (!row) {
        row = { id: ln.person_id, name: ln.person_name, retired: !!ln.person_retired, sessions: 0, rawHours: 0, billHours: 0, revenue: 0 };
        byPerson.set(ln.person_id, row);
      }
      if (mm.occupancyCounts) {
        row.sessions += 1;
        row.rawHours += rawHours;
        row.billHours += billHours;
      }
      if (mm.moneyCounts) row.revenue += (ln.line_cost || 0);
    });

    const rows = Array.from(byPerson.values()).sort((a, b) => b.rawHours - a.rawHours);
    return { rows };
  }

  /* ================================================================================
     Card 3 — Staff × instrument matrix
     Sessions = unsplit count of bookings that touched both this staff member and this
     instrument (answers "which instruments do I actually spend time on"). Attributed hours =
     that booking's staff hours divided evenly across however many instruments were on it, so
     the column sums back to the person's true raw-hours total from Card 2.
     ================================================================================ */
  function computeStaffInstrumentMatrix(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }
    const meetings = annotateMeetings(loadMeetingsInRange(from, to));
    const instrumentLines = loadInstrumentLines();
    const staffLines = loadStaffLines();

    // Instrument count per meeting, restricted to meetings in range (needed for the even split).
    const instrumentsByMeeting = new Map(); // meeting_id -> [{id,name,retired}]
    instrumentLines.forEach((ln) => {
      if (!meetings.has(ln.meeting_id)) return;
      if (!instrumentsByMeeting.has(ln.meeting_id)) instrumentsByMeeting.set(ln.meeting_id, []);
      instrumentsByMeeting.get(ln.meeting_id).push({ id: ln.instrument_id, name: ln.instrument_name, retired: !!ln.instrument_retired });
    });

    // key = `${personId}::${instrumentId}`
    const cells = new Map();
    const staffMeta = new Map();     // person_id -> {name, retired}
    const instrumentMeta = new Map(); // instrument_id -> {name, retired}

    staffLines.forEach((ln) => {
      const mm = meetings.get(ln.meeting_id);
      if (!mm || !mm.occupancyCounts) return; // matrix is a workload view — cancelled bookings didn't happen
      const insts = instrumentsByMeeting.get(ln.meeting_id) || [];
      if (!insts.length) return; // a booking with no instrument line has nothing to attribute here

      const rawHours = (ln.start_time && ln.end_time) ? UI.hoursBetween(ln.start_time, ln.end_time) : mm.bookingHours;
      // The even split: one staff member's real hours on THIS booking, shared equally across
      // however many instruments that booking touched, so summing this column for a person
      // reproduces their true raw-hours total from the Facility staff time card.
      const perInstrumentHours = rawHours / insts.length;

      staffMeta.set(ln.person_id, { name: ln.person_name, retired: !!ln.person_retired });
      insts.forEach((inst) => {
        instrumentMeta.set(inst.id, { name: inst.name, retired: inst.retired });
        const key = ln.person_id + '::' + inst.id;
        let cell = cells.get(key);
        if (!cell) { cell = { personId: ln.person_id, instrumentId: inst.id, sessions: 0, attributedHours: 0 }; cells.set(key, cell); }
        cell.sessions += 1;              // one whole booking, not split — see file header
        cell.attributedHours += perInstrumentHours;
      });
    });

    const staffList = Array.from(staffMeta.entries()).map(([id, v]) => ({ id, name: v.name, retired: v.retired }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const instrumentList = Array.from(instrumentMeta.entries()).map(([id, v]) => ({ id, name: v.name, retired: v.retired }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { staffList, instrumentList, cells };
  }

  /* ================================================================================
     Card 4 — Projects & groups
     ================================================================================ */
  function computeProjectRows(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }
    const meetings = loadMeetingsInRange(from, to);

    const byProject = new Map(); // key (project_id or 'facility') -> row
    const byGroup = new Map();   // key (group_org or '(none)') -> row
    meetings.forEach((m) => {
      const bookingHours = UI.hoursBetween(m.start_time, m.end_time);
      const occupancyCounts = !m.is_cancelled;                          // rule 1
      const moneyCounts = !(m.is_cancelled && !m.billing_retained);     // rule 2

      const pKey = m.project_id == null ? 'facility' : String(m.project_id);
      let prow = byProject.get(pKey);
      if (!prow) {
        prow = { key: pKey, label: m.project_id == null ? 'Facility-wide' : (m.project_code ? m.project_code + ' — ' + m.project_title : m.project_title), bookings: 0, hours: 0, cost: 0 };
        byProject.set(pKey, prow);
      }
      if (occupancyCounts) { prow.bookings += 1; prow.hours += bookingHours; }
      if (moneyCounts) prow.cost += (m.total_cost || 0);

      const gLabel = (m.group_org || '').trim();
      if (gLabel) { // bookings with no lab/group recorded are omitted from the groups table — nothing to attribute them to
        const gKey = gLabel;
        let grow = byGroup.get(gKey);
        if (!grow) { grow = { key: gKey, label: gLabel, bookings: 0, hours: 0, cost: 0 }; byGroup.set(gKey, grow); }
        if (occupancyCounts) { grow.bookings += 1; grow.hours += bookingHours; }
        if (moneyCounts) grow.cost += (m.total_cost || 0);
      }
    });

    const projects = Array.from(byProject.values()).sort((a, b) => b.hours - a.hours);
    const groups = Array.from(byGroup.values()).sort((a, b) => b.hours - a.hours);
    return { projects, groups };
  }

  /* ---------------- Small render helpers ---------------- */
  function fmtHours(h) { return (Math.round((h || 0) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function fmtMoney(n) { return '$' + (Math.round((n || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function nameCell(name, retired) { return esc(UI.retiredName(name, retired)); }
  function bar(pct) {
    return `<div class="row" style="gap:8px"><div class="progress seg grow" style="height:8px"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></div><span class="mono small" style="width:42px;text-align:right">${pct.toFixed(1)}%</span></div>`;
  }

  /* ---------------- Screen ---------------- */
  function render() {
    const { from, to } = getRange();
    const instr = computeInstrumentRows(from, to);
    const staff = computeStaffRows(from, to);
    const matrix = computeStaffInstrumentMatrix(from, to);
    const proj = computeProjectRows(from, to);

    return `
    <div class="card mb-16">
      <div class="filter-bar">
        <div class="field"><label>From</label><input type="date" class="input" id="rep-from" value="${esc(from)}" /></div>
        <div class="field"><label>To</label><input type="date" class="input" id="rep-to" value="${esc(to)}" /></div>
        <button class="btn btn-secondary btn-sm" data-act="rep-preset" data-range="month">This Month</button>
        <button class="btn btn-secondary btn-sm" data-act="rep-preset" data-range="year">This Year</button>
        <button class="btn btn-secondary btn-sm" data-act="rep-preset" data-range="all">All Time</button>
        <div class="grow"></div>
        <button class="btn btn-primary" data-act="export-reports-xlsx">${ic('file')} Export XLSX</button>
      </div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('cpu')} Instrument utilisation</span></div></div>
      ${!instr.rows.length ? global.Views.emptyState('cpu', 'No bookings in this range', 'Widen the date range or add instrument bookings.') : `
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Instrument</th><th>Bookings</th><th>Booked Hours</th><th>Billed Revenue</th><th>Share of Total Hours</th></tr></thead>
          <tbody>
            ${instr.rows.map((r) => `
              <tr class="${r.retired ? 'row-retired' : ''}">
                <td style="font-weight:600">${nameCell(r.name, r.retired)}</td>
                <td class="mono small">${r.bookings}</td>
                <td class="mono small">${fmtHours(r.hours)}</td>
                <td class="mono small">${fmtMoney(r.revenue)}</td>
                <td style="min-width:160px">${bar(r.sharePct)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
      <div class="faint small mt-8">Bookings and hours exclude cancelled bookings entirely (a cancelled booking releases its slot). Billed revenue follows the same rule used everywhere else in the app: a cancelled booking's charge still counts only if it was retained rather than waived.</div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('users')} Facility staff time</span></div></div>
      ${!staff.rows.length ? global.Views.emptyState('users', 'No staff time in this range', 'Widen the date range or assign facility staff to bookings.') : `
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Staff Member</th><th>Sessions</th><th>Raw Hours</th><th>Billed Hours</th><th>Staff Revenue</th></tr></thead>
          <tbody>
            ${staff.rows.map((r) => `
              <tr class="${r.retired ? 'row-retired' : ''}">
                <td style="font-weight:600">${nameCell(r.name, r.retired)}</td>
                <td class="mono small">${r.sessions}</td>
                <td class="mono small">${fmtHours(r.rawHours)}</td>
                <td class="mono small">${fmtHours(r.billHours)}</td>
                <td class="mono small">${fmtMoney(r.revenue)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
      <div class="faint small mt-8">Raw hours are the actual time booked (a blank per-staff window on a booking means "the whole booking window", not zero). Billed hours apply the same 1-hour floor / round-up-to-the-hour rule as the booking cost calculator, which is why they can be higher than raw hours.</div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('layers')} Staff × instrument</span></div></div>
      ${!matrix.staffList.length || !matrix.instrumentList.length ? global.Views.emptyState('layers', 'Nothing to cross-tabulate', 'Widen the date range or add multi-instrument bookings.') : `
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Staff Member</th>${matrix.instrumentList.map((i) => `<th>${nameCell(i.name, i.retired)}</th>`).join('')}</tr></thead>
          <tbody>
            ${matrix.staffList.map((s) => `
              <tr class="${s.retired ? 'row-retired' : ''}">
                <td style="font-weight:600">${nameCell(s.name, s.retired)}</td>
                ${matrix.instrumentList.map((i) => {
                  const cell = matrix.cells.get(s.id + '::' + i.id);
                  if (!cell) return '<td class="faint small">—</td>';
                  return `<td class="mono small" data-tooltip="${cell.sessions} session${cell.sessions === 1 ? '' : 's'} · ${fmtHours(cell.attributedHours)}h attributed">${cell.sessions} sess · ${fmtHours(cell.attributedHours)}h</td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
      <div class="faint small mt-8">Sessions count bookings unsplit — the number that actually answers "which instruments do I spend my time on". Attributed hours divide that booking's staff hours evenly across every instrument on it, purely so the column sums back to the person's true total in the Facility staff time card above; the underlying sample runs were mostly parallel, so this split is a bookkeeping convenience, not a claim about which instrument the time "really" belongs to.</div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('folder')} Projects &amp; groups</span></div></div>
      <div class="grid cols-2">
        <div>
          <div class="faint small mb-8" style="font-weight:600;text-transform:uppercase;letter-spacing:.05em">By Project</div>
          ${!proj.projects.length ? global.Views.emptyState('folder', 'No bookings in this range', '') : `
          <div class="tbl-wrap">
            <table class="tbl">
              <colgroup><col style="width:46%"><col style="width:18%"><col style="width:14%"><col style="width:22%"></colgroup>
              <thead><tr><th>Project</th><th style="white-space:nowrap">Bookings</th><th style="white-space:nowrap">Hours</th><th style="white-space:nowrap">Total Cost</th></tr></thead>
              <tbody>
                ${proj.projects.map((r) => `
                  <tr>
                    <td style="font-weight:600">${esc(r.label)}</td>
                    <td class="mono small">${r.bookings}</td>
                    <td class="mono small">${fmtHours(r.hours)}</td>
                    <td class="mono small">${fmtMoney(r.cost)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
        </div>
        <div>
          <div class="faint small mb-8" style="font-weight:600;text-transform:uppercase;letter-spacing:.05em">By Lab / Group</div>
          ${!proj.groups.length ? global.Views.emptyState('users', 'No lab/group recorded', 'Bookings without a lab/group on file are omitted here.') : `
          <div class="tbl-wrap">
            <table class="tbl">
              <colgroup><col style="width:46%"><col style="width:18%"><col style="width:14%"><col style="width:22%"></colgroup>
              <thead><tr><th>Lab / Group</th><th style="white-space:nowrap">Bookings</th><th style="white-space:nowrap">Hours</th><th style="white-space:nowrap">Total Cost</th></tr></thead>
              <tbody>
                ${proj.groups.map((r) => `
                  <tr>
                    <td style="font-weight:600">${esc(r.label)}</td>
                    <td class="mono small">${r.bookings}</td>
                    <td class="mono small">${fmtHours(r.hours)}</td>
                    <td class="mono small">${fmtMoney(r.cost)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
        </div>
      </div>
      <div class="faint small mt-8">Bookings/hours exclude cancelled bookings; Total Cost follows the same retained-charge rule as the cards above. A meeting with no project is grouped as "Facility-wide"; a meeting with no lab/group on file is omitted from the By Lab/Group table.</div>
    </div>`;
  }

  global.Reports = {
    render,
    setRange,
    setPreset,
    getRange,
    // Exposed so js/exports.js's XLSX exporter builds its sheets from the exact same aggregation
    // the screen renders from — a report whose export disagrees with its screen is worse than no
    // report. Each accepts an explicit (from,to) so the exporter never has to mutate module state.
    computeInstrumentRows,
    computeStaffRows,
    computeStaffInstrumentMatrix,
    computeProjectRows
  };

})(window);
