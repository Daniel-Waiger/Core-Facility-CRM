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
     Either bound may be '' (unbounded). Defaults to the current calendar year, so the screen
     shows something useful the moment it opens. */
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
      SELECT mt.id, mt.project_id, mt.title, mt.date, mt.start_time, mt.end_time, mt.group_org,
             mt.total_cost, mt.is_cancelled, mt.billing_retained, mt.category,
             p.code AS project_code, p.title AS project_title
      FROM meetings mt LEFT JOIN projects p ON p.id = mt.project_id
      WHERE ${RANGE_SQL}
      ORDER BY mt.date ASC, mt.id ASC`, rangeParams(from, to));
  }
  // Bounded by the same date range as the meetings pull. Loading every join row and discarding
  // the out-of-range ones in JS worked, but made the cost of a one-month report grow with the
  // facility's whole history rather than with what the report actually shows.
  function loadInstrumentLines(from, to) {
    return DB.rows(`
      SELECT mi.meeting_id, mi.instrument_id, mi.line_cost,
             i.name AS instrument_name, i.is_retired AS instrument_retired
      FROM meeting_instruments mi
      JOIN instruments i ON i.id = mi.instrument_id
      JOIN meetings mt ON mt.id = mi.meeting_id
      WHERE ${RANGE_SQL}`, rangeParams(from, to));
  }
  // Standalone service entries (roadmap 2.3) in range, joined fresh (no denormalized name
  // columns) — same shape/precedent as loadMeetingsInRange above, just keyed off se.date instead
  // of mt.date since entries have no alias in RANGE_SQL.
  function loadServiceEntriesInRange(from, to) {
    return DB.rows(`
      SELECT se.*, p.code AS project_code, p.title AS project_title,
             pe.name AS person_name, pe.is_retired AS person_retired,
             i.name AS instrument_name, i.is_retired AS instrument_retired,
             g.name AS grant_name, g.number AS grant_number, g.is_retired AS grant_is_retired
      FROM service_entries se
      LEFT JOIN projects p ON p.id = se.project_id
      LEFT JOIN people pe ON pe.id = se.person_id
      LEFT JOIN instruments i ON i.id = se.instrument_id
      LEFT JOIN grants g ON g.id = se.grant_id
      WHERE (? = '' OR se.date >= ?) AND (? = '' OR se.date <= ?)
      ORDER BY se.date DESC, se.id DESC`, rangeParams(from, to));
  }
  // Roadmap 3.2. Mirrors loadInstrumentLines's shape (bounded by the same range, joined fresh) but
  // walks meeting_people x meetings x meeting_instruments to answer "which people touched this
  // instrument", not "which instrument lines cost what". The is_cancelled filter is done here in
  // SQL (rather than via annotateMeetings) because all this needs is distinct occupancy-filtered
  // (instrument, person) pairs — rule 1, no money involved.
  function loadAttendeeLines(from, to) {
    return DB.rows(`
      SELECT DISTINCT mi.instrument_id, mp.person_id
      FROM meeting_instruments mi
      JOIN meeting_people mp ON mp.meeting_id = mi.meeting_id
      JOIN meetings mt ON mt.id = mi.meeting_id
      WHERE ${RANGE_SQL} AND mt.is_cancelled = 0`, rangeParams(from, to));
  }
  // Roadmap 3.2. Occupancy-filtered (instrument, project) pairs in range — feeds "projects served"
  // and the facility-wide (project_id IS NULL) session count. Bounded like every loader above.
  function loadProjectInstrumentLines(from, to) {
    return DB.rows(`
      SELECT mi.instrument_id, mt.project_id
      FROM meeting_instruments mi
      JOIN meetings mt ON mt.id = mi.meeting_id
      WHERE ${RANGE_SQL} AND mt.is_cancelled = 0`, rangeParams(from, to));
  }
  // Roadmap 3.2/3.6a. Current-state mapping (who supervises which instrument today) — not a
  // historical fact tied to a date range, so unlike every loader above this one is NOT bounded by
  // (from,to); it reads instrument_staff x people directly.
  function loadInstrumentSupervisors() {
    return DB.rows(`
      SELECT ist.instrument_id, pe.id AS person_id, pe.name AS person_name, pe.is_retired AS person_retired
      FROM instrument_staff ist
      JOIN people pe ON pe.id = ist.person_id`);
  }
  /* Roadmap 3.2. DELIBERATELY UNBOUNDED — the one loader in this file that does not take
     (from,to). To know whether a person's booking on this instrument in the selected range was
     their FIRST EVER (not just their first in-range one), the query must see the instrument's
     entire booking history; restricting it to the range would misreport every returning user
     whose true first visit predates `from` as "new". Feeds countNewInRange below, which applies
     the (from,to) filter afterward, against this pre-computed unbounded MIN(date). */
  function loadFirstInstrumentUserDates() {
    return DB.rows(`
      SELECT mi.instrument_id, mp.person_id, MIN(mt.date) AS first_date
      FROM meeting_instruments mi
      JOIN meeting_people mp ON mp.meeting_id = mi.meeting_id
      JOIN meetings mt ON mt.id = mi.meeting_id
      WHERE mt.is_cancelled = 0
      GROUP BY 1, 2`);
  }
  /* Reusable "first-ever appearance in range" helper (roadmap 3.2, reused by 3.4 keyed on
     group_org instead of instrument_id). Takes rows already MIN-aggregated per (groupId, entityId)
     pair by an UNBOUNDED query like loadFirstInstrumentUserDates above, and counts, per groupId,
     how many entityIds had their first-ever appearance fall inside [from, to]. */
  function countNewInRange(firstDateRows, from, to) {
    const counts = new Map();
    firstDateRows.forEach((r) => {
      if (from && r.firstDate < from) return;
      if (to && r.firstDate > to) return;
      counts.set(r.groupId, (counts.get(r.groupId) || 0) + 1);
    });
    return counts;
  }
  // Roadmap 3.4. (instrument, lab) pairs in range, occupancy-filtered — one row per meeting the
  // instrument was on, carrying that meeting's group_org snapshot. Distinctness (a Set per
  // instrument) is left to the caller, same pattern as loadAttendeeLines.
  function loadInstrumentLabLines(from, to) {
    return DB.rows(`
      SELECT mi.instrument_id, mt.group_org
      FROM meeting_instruments mi
      JOIN meetings mt ON mt.id = mi.meeting_id
      WHERE ${RANGE_SQL} AND mt.is_cancelled = 0`, rangeParams(from, to));
  }
  // Roadmap 3.4. (date, person_id) pairs in range, occupancy-filtered, with NO instrument join —
  // feeds the per-period distinct-people count, which is facility-wide, not instrument-scoped.
  function loadPeriodPeopleLines(from, to) {
    return DB.rows(`
      SELECT mt.date, mp.person_id
      FROM meetings mt
      JOIN meeting_people mp ON mp.meeting_id = mt.id
      WHERE ${RANGE_SQL} AND mt.is_cancelled = 0`, rangeParams(from, to));
  }
  /* Roadmap 3.4. DELIBERATELY UNBOUNDED — same reasoning as loadFirstInstrumentUserDates above,
     just keyed on group_org instead of instrument_id: to know whether a lab's booking in the
     selected range was its FIRST EVER, the query must see the facility's entire booking history.
     Feeds countNewInRange (the reusable helper already built for 3.2) below, bucketed by the
     PERIOD of each lab's first-ever date rather than a single in/out-of-range count. */
  // TRIMMED, same as every distinct-lab count elsewhere in this file (labsByPeriod/labsByInstrument
  // both key on `(m.group_org || '').trim()`) — grouping on the raw column here let 'Zeta Lab' and
  // 'Zeta Lab ' (trailing space) count as two different labs with two different "first ever"
  // dates, so a lab could appear as "new" a second time under its own untrimmed duplicate even
  // though computeBreadthRows' distinct-lab counts already merge the two. Trimming both the GROUP
  // BY key and the selected column keeps this loader's notion of "a lab" identical to every other
  // lab-counting query in this file.
  function loadFirstLabDates() {
    return DB.rows(`
      SELECT TRIM(group_org) AS group_org, MIN(date) AS first_date
      FROM meetings
      WHERE is_cancelled = 0 AND TRIM(COALESCE(group_org, '')) != ''
      GROUP BY TRIM(group_org)`);
  }
  function loadStaffLines(from, to) {
    // meeting_staff always names a facility-staff assignee, but a person's is_staff flag could in
    // theory have been unset after the fact (retiring doesn't do this, but be defensive) — join
    // on people without filtering is_staff so no historical row silently disappears.
    return DB.rows(`
      SELECT ms.meeting_id, ms.person_id, ms.start_time, ms.end_time, ms.line_cost,
             pe.name AS person_name, pe.is_retired AS person_retired, pe.rate AS person_rate
      FROM meeting_staff ms
      JOIN people pe ON pe.id = ms.person_id
      JOIN meetings mt ON mt.id = ms.meeting_id
      WHERE ${RANGE_SQL}`, rangeParams(from, to));
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
     Card 1 — Instrument utilization
     ================================================================================ */
  function computeInstrumentRows(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }
    const meetings = annotateMeetings(loadMeetingsInRange(from, to));
    const lines = loadInstrumentLines(from, to);

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
    const lines = loadStaffLines(from, to);

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
  // Sentinel instrument id for staff time on an instrument-less booking (a pure consult/sync with
  // no instrument line) — a string so it can never collide with a real (numeric) instrument_id.
  // Without this bucket, computeStaffInstrumentMatrix used to `return` early on such a booking
  // (see the removed early-out below), which silently dropped that booking's staff hours from the
  // matrix entirely — so a person's row here summed to LESS than their true rawHours total on
  // Card 2, breaking the on-screen and Notes-sheet footnote's promise that the matrix always sums
  // back to that total. Bucketing those hours under "No Instrument" instead keeps the promise true.
  const NO_INSTRUMENT_KEY = '__no_instrument__';
  function computeStaffInstrumentMatrix(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }
    const meetings = annotateMeetings(loadMeetingsInRange(from, to));
    const instrumentLines = loadInstrumentLines(from, to);
    const staffLines = loadStaffLines(from, to);

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
      // A booking with no instrument line (a pure consult/sync) still has real staff hours to
      // attribute — bucket them under the single "No Instrument" column rather than dropping the
      // booking from the matrix, so this person's row still sums to their Card 2 rawHours total.
      const insts = instrumentsByMeeting.get(ln.meeting_id) || [];
      const attributeTo = insts.length ? insts : [{ id: NO_INSTRUMENT_KEY, name: 'No Instrument', retired: false }];

      const rawHours = (ln.start_time && ln.end_time) ? UI.hoursBetween(ln.start_time, ln.end_time) : mm.bookingHours;
      // The even split: one staff member's real hours on THIS booking, shared equally across
      // however many instruments that booking touched, so summing this column for a person
      // reproduces their true raw-hours total from the Facility staff time card.
      const perInstrumentHours = rawHours / attributeTo.length;

      staffMeta.set(ln.person_id, { name: ln.person_name, retired: !!ln.person_retired });
      attributeTo.forEach((inst) => {
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
    // "No Instrument" sorted last, same precedent as computeActivityMixRows' "(uncategorized)"
    // bucket — real instrument names lead the matrix, the catch-all column reads as an appendix.
    const instrumentList = Array.from(instrumentMeta.entries()).map(([id, v]) => ({ id, name: v.name, retired: v.retired }))
      .sort((a, b) => {
        if (a.id === NO_INSTRUMENT_KEY) return 1;
        if (b.id === NO_INSTRUMENT_KEY) return -1;
        return a.name.localeCompare(b.name);
      });
    return { staffList, instrumentList, cells };
  }

  /* ================================================================================
     Card 4 — Projects & groups
     ================================================================================ */
  function computeProjectRows(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }
    const meetings = loadMeetingsInRange(from, to);
    const entries = loadServiceEntriesInRange(from, to);

    const byProject = new Map(); // key (project_id or 'facility') -> row
    const byGroup = new Map();   // key (group_org or '(none)') -> row
    function projectRow(projectId, projectCode, projectTitle) {
      const pKey = projectId == null ? 'facility' : String(projectId);
      let prow = byProject.get(pKey);
      if (!prow) {
        prow = { key: pKey, label: projectId == null ? 'Facility-wide' : (projectCode ? projectCode + ' — ' + projectTitle : projectTitle), bookings: 0, hours: 0, cost: 0 };
        byProject.set(pKey, prow);
      }
      return prow;
    }
    meetings.forEach((m) => {
      const bookingHours = UI.hoursBetween(m.start_time, m.end_time);
      const occupancyCounts = !m.is_cancelled;                          // rule 1
      const moneyCounts = !(m.is_cancelled && !m.billing_retained);     // rule 2

      const prow = projectRow(m.project_id, m.project_code, m.project_title);
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

    // Service entries (roadmap 2.3) add revenue-only rows here — they carry no start/end times
    // (no hours to attribute) and no group_org column, so they only ever touch the project side of
    // this aggregation, under the identical money-counting rule as a booking.
    entries.forEach((e) => {
      const moneyCounts = !(e.is_cancelled && !e.billing_retained); // rule 2
      if (!moneyCounts) return;
      const prow = projectRow(e.project_id, e.project_code, e.project_title);
      prow.cost += (e.total_cost || 0);
    });

    const projects = Array.from(byProject.values()).sort((a, b) => b.hours - a.hours);
    const groups = Array.from(byGroup.values()).sort((a, b) => b.hours - a.hours);
    return { projects, groups };
  }

  /* ================================================================================
     Card 6 — Standalone service entries (roadmap 2.3)
     Billable work logged outside any booking (technician time, sample prep, per-unit items).
     No occupancy rule applies here (an entry has no start/end time, so it never held a slot) —
     only the money rule, identical to a booking's: a row counts unless it was BOTH cancelled AND
     the charge was waived.
     ================================================================================ */
  function computeServiceEntryRows(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }
    const rows = loadServiceEntriesInRange(from, to).map((r) => {
      const moneyCounts = !(r.is_cancelled && !r.billing_retained);
      return Object.assign({}, r, { moneyCounts, countedCost: moneyCounts ? (r.total_cost || 0) : 0 });
    });
    const totalRevenue = rows.reduce((s, r) => s + r.countedCost, 0);
    return { rows, totalRevenue };
  }

  /* ================================================================================
     Card 5 — Consult-type breakdown (ROADMAP 3.1)
     Counts meetings/bookings tagged category === 'consult', per instrument they touched and
     per period (calendar month, from the meeting's own local 'YYYY-MM-DD' date string — no
     Date object involved, so no UTC-shift risk). Mirrors the occupancy rule: a cancelled
     consult never happened, so it's excluded regardless of whether its charge was retained.
     A consult with no instrument line (a pure conversation) still counts toward the period
     total but contributes no instrument row — nothing to attribute it to there. */
  function computeConsultRows(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }
    const allMeetings = loadMeetingsInRange(from, to);
    const consults = allMeetings.filter((m) => m.category === 'consult' && !m.is_cancelled);
    const consultIds = new Set(consults.map((m) => m.id));

    const byInstrument = new Map(); // instrument_id -> { id, name, retired, count }
    if (consultIds.size) {
      loadInstrumentLines(from, to).forEach((ln) => {
        if (!consultIds.has(ln.meeting_id)) return;
        let row = byInstrument.get(ln.instrument_id);
        if (!row) {
          row = { id: ln.instrument_id, name: ln.instrument_name, retired: !!ln.instrument_retired, count: 0 };
          byInstrument.set(ln.instrument_id, row);
        }
        row.count += 1;
      });
    }
    const instrumentRows = Array.from(byInstrument.values()).sort((a, b) => b.count - a.count);

    const byPeriod = new Map(); // 'YYYY-MM' -> count
    consults.forEach((m) => {
      const period = (m.date || '').slice(0, 7) || 'Unknown';
      byPeriod.set(period, (byPeriod.get(period) || 0) + 1);
    });
    const periodRows = Array.from(byPeriod.entries())
      .map(([period, count]) => ({ period, count }))
      .sort((a, b) => a.period.localeCompare(b.period));

    return { instrumentRows, periodRows, totalConsults: consults.length };
  }

  /* ================================================================================
     Card — Instrument stewardship scorecard (ROADMAP 3.2)
     A per-instrument justification view, grouped by supervising staff (instrument_staff): what
     the instrument is actually doing for the facility, for whoever is on the hook to justify it.
     Deliberately built ON TOP of computeInstrumentRows / computeConsultRows (never duplicating
     their aggregation) plus two new occupancy-filtered loaders above.

     A multi-supervisor instrument appears under EVERY supervisor it's linked to — this is a
     GROUPING for review, not a partition of ownership, and the per-instrument numbers are
     deliberately NOT rolled up into a per-supervisor total (that would silently double-count any
     shared instrument into a fabricated "score" per person, which this app does not do).

     OMITTED, on purpose, with a labeled footnote rather than a fake column: trained-user pool
     trend and downtime share both need Tier 4 data (training records, downtime logs) this app
     doesn't have yet.
     ================================================================================ */
  function computeStewardshipRows(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }

    const instr = computeInstrumentRows(from, to);                 // reuse — no duplicated utilization math
    const consult = computeConsultRows(from, to);                  // reuse — no duplicated consult-tag math
    const consultByInstrument = new Map(consult.instrumentRows.map((r) => [r.id, r.count]));

    const distinctUsersByInstrument = new Map(); // instrument_id -> Set(person_id)
    loadAttendeeLines(from, to).forEach((ln) => {
      if (!distinctUsersByInstrument.has(ln.instrument_id)) distinctUsersByInstrument.set(ln.instrument_id, new Set());
      distinctUsersByInstrument.get(ln.instrument_id).add(ln.person_id);
    });

    const projectsByInstrument = new Map();      // instrument_id -> Set(project_id), non-null only
    const facilityWideByInstrument = new Map();  // instrument_id -> count of sessions with project_id NULL
    loadProjectInstrumentLines(from, to).forEach((ln) => {
      if (ln.project_id == null) {
        facilityWideByInstrument.set(ln.instrument_id, (facilityWideByInstrument.get(ln.instrument_id) || 0) + 1);
      } else {
        if (!projectsByInstrument.has(ln.instrument_id)) projectsByInstrument.set(ln.instrument_id, new Set());
        projectsByInstrument.get(ln.instrument_id).add(ln.project_id);
      }
    });

    // "New in range" via the reusable unbounded-first-appearance helper (see its own comment).
    const firstRows = loadFirstInstrumentUserDates().map((r) => ({ groupId: r.instrument_id, entityId: r.person_id, firstDate: r.first_date }));
    const newUsersByInstrument = countNewInRange(firstRows, from, to);

    const supervisorsByInstrument = new Map(); // instrument_id -> [{id,name,retired}]
    loadInstrumentSupervisors().forEach((ln) => {
      if (!supervisorsByInstrument.has(ln.instrument_id)) supervisorsByInstrument.set(ln.instrument_id, []);
      supervisorsByInstrument.get(ln.instrument_id).push({ id: ln.person_id, name: ln.person_name, retired: !!ln.person_retired });
    });

    // One scorecard row per instrument that had any booking activity in range (an instrument with
    // nothing booked has nothing to justify here — it simply won't appear).
    const rowsByInstrument = new Map();
    instr.rows.forEach((r) => {
      rowsByInstrument.set(r.id, {
        id: r.id, name: r.name, retired: r.retired,
        bookings: r.bookings, hours: r.hours, revenue: r.revenue,
        distinctUsers: (distinctUsersByInstrument.get(r.id) || new Set()).size,
        newUsers: newUsersByInstrument.get(r.id) || 0,
        projectsServed: (projectsByInstrument.get(r.id) || new Set()).size,
        facilityWideSessions: facilityWideByInstrument.get(r.id) || 0,
        consultCount: consultByInstrument.get(r.id) || 0
      });
    });

    // Group under each supervisor ("Unassigned" heading for instruments with none). See file
    // comment above: this is a grouping, not a partition — a shared instrument lands in more than
    // one group.
    const bySupervisor = new Map(); // key: person_id or 'unassigned' -> { supervisor, rows }
    rowsByInstrument.forEach((row, instId) => {
      const sups = supervisorsByInstrument.get(instId) || [];
      if (!sups.length) {
        if (!bySupervisor.has('unassigned')) bySupervisor.set('unassigned', { supervisor: null, rows: [] });
        bySupervisor.get('unassigned').rows.push(row);
      } else {
        sups.forEach((sup) => {
          const key = String(sup.id);
          if (!bySupervisor.has(key)) bySupervisor.set(key, { supervisor: sup, rows: [] });
          bySupervisor.get(key).rows.push(row);
        });
      }
    });

    const groups = Array.from(bySupervisor.values())
      .map((g) => ({ supervisor: g.supervisor, rows: g.rows.sort((a, b) => b.hours - a.hours) }))
      .sort((a, b) => {
        if (!a.supervisor) return 1;
        if (!b.supervisor) return -1;
        return a.supervisor.name.localeCompare(b.supervisor.name);
      });

    return { groups };
  }

  /* ================================================================================
     Card — Breadth (ROADMAP 3.4)
     "How many distinct labs/people does the facility actually serve, and is that base
     growing?" Per period (calendar month) and per instrument: distinct labs (meetings.group_org,
     non-blank — a booking with no lab/group on file is omitted from lab counts, same precedent as
     the Projects & Groups card), distinct people (meeting_people). "New labs onboarded" per
     period reuses the exact countNewInRange helper built for 3.2, just keyed on group_org and
     bucketed by the period of each lab's own first-ever booking (see loadFirstLabDates above).
     Occupancy rule throughout — a cancelled booking never happened, so it can neither serve a lab
     nor onboard one.

     Per-lab consult attribution (consultLabRows) is OPT-IN, never a default column — see
     getLabConsultsEnabled/setLabConsultsEnabled below. computeBreadthRows always computes it (it's
     cheap, already has the filtered meetings in hand) so the toggle is a pure render/export
     decision, not a second aggregation path that could drift from this one. */
  function computeBreadthRows(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }
    const meetings = loadMeetingsInRange(from, to).filter((m) => !m.is_cancelled); // rule 1
    const instrLines = loadInstrumentLines(from, to);
    const instLabLines = loadInstrumentLabLines(from, to);
    const attendeeLines = loadAttendeeLines(from, to); // already occupancy-filtered (instrument_id, person_id)
    const periodPeopleLines = loadPeriodPeopleLines(from, to);

    // Per instrument.
    const instMeta = new Map(); // id -> {name, retired}
    instrLines.forEach((ln) => instMeta.set(ln.instrument_id, { name: ln.instrument_name, retired: !!ln.instrument_retired }));
    const labsByInstrument = new Map();   // instrument_id -> Set(lab)
    instLabLines.forEach((ln) => {
      const lab = (ln.group_org || '').trim();
      if (!lab) return; // no lab/group on file — nothing to attribute (precedent: Projects & Groups card)
      if (!labsByInstrument.has(ln.instrument_id)) labsByInstrument.set(ln.instrument_id, new Set());
      labsByInstrument.get(ln.instrument_id).add(lab);
    });
    const peopleByInstrument = new Map(); // instrument_id -> Set(person_id)
    attendeeLines.forEach((ln) => {
      if (!peopleByInstrument.has(ln.instrument_id)) peopleByInstrument.set(ln.instrument_id, new Set());
      peopleByInstrument.get(ln.instrument_id).add(ln.person_id);
    });
    const instrumentIds = new Set([...labsByInstrument.keys(), ...peopleByInstrument.keys()]);
    const instrumentRows = Array.from(instrumentIds).map((id) => {
      const meta = instMeta.get(id) || { name: '(unknown)', retired: false };
      return {
        id, name: meta.name, retired: meta.retired,
        distinctLabs: (labsByInstrument.get(id) || new Set()).size,
        distinctPeople: (peopleByInstrument.get(id) || new Set()).size
      };
    }).sort((a, b) => b.distinctPeople - a.distinctPeople);

    // Per period.
    const labsByPeriod = new Map();   // 'YYYY-MM' -> Set(lab)
    const consultByLab = new Map();   // lab -> count (opt-in table; see file header above)
    meetings.forEach((m) => {
      const period = (m.date || '').slice(0, 7);
      if (!period) return;
      const lab = (m.group_org || '').trim();
      if (lab) {
        if (!labsByPeriod.has(period)) labsByPeriod.set(period, new Set());
        labsByPeriod.get(period).add(lab);
        if (m.category === 'consult') consultByLab.set(lab, (consultByLab.get(lab) || 0) + 1);
      }
    });
    const peopleByPeriod = new Map(); // 'YYYY-MM' -> Set(person_id)
    periodPeopleLines.forEach((ln) => {
      const period = (ln.date || '').slice(0, 7);
      if (!period) return;
      if (!peopleByPeriod.has(period)) peopleByPeriod.set(period, new Set());
      peopleByPeriod.get(period).add(ln.person_id);
    });

    // New labs per period: reuse countNewInRange verbatim, with groupId = the PERIOD of the lab's
    // own unbounded first-ever date (not the instrument), entityId = the lab name.
    const firstLabRows = loadFirstLabDates().map((r) => ({ groupId: (r.first_date || '').slice(0, 7), entityId: r.group_org, firstDate: r.first_date }));
    const newLabsByPeriod = countNewInRange(firstLabRows, from, to);

    const periodSet = new Set([...labsByPeriod.keys(), ...peopleByPeriod.keys(), ...newLabsByPeriod.keys()]);
    const periodRows = Array.from(periodSet).sort().map((period) => ({
      period,
      distinctLabs: (labsByPeriod.get(period) || new Set()).size,
      distinctPeople: (peopleByPeriod.get(period) || new Set()).size,
      newLabs: newLabsByPeriod.get(period) || 0
    }));

    const consultLabRows = Array.from(consultByLab.entries())
      .map(([lab, count]) => ({ lab, count }))
      .sort((a, b) => b.count - a.count);

    return { periodRows, instrumentRows, consultLabRows };
  }

  // Module state for the opt-in per-lab consult attribution table (roadmap 3.4). Deliberately
  // ephemeral (not DB.getConfig-backed) — this is a per-load reading choice, not a facility
  // setting or a stored report column, per the roadmap's "opt-in, not a default column" rule.
  // Defaults OFF on every fresh load.
  let labConsultsEnabled = false;
  function getLabConsultsEnabled() { return labConsultsEnabled; }
  function setLabConsultsEnabled(v) { labConsultsEnabled = !!v; }

  /* ================================================================================
     Card — Activity mix (ROADMAP 3.4)
     Facility hours split by meetings.category, per period — a period x category matrix, ordered
     by period, designed so 3.5's stacked chart can consume it directly (one row per period, one
     numeric column per category). The category vocabulary is READ FROM THE DATA, never
     hardcoded — sync/consult/assisted session/training are today's built-ins but a facility can
     add its own via the vocab picker, and this aggregation must pick those up automatically. A
     blank category becomes an explicit "(uncategorized)" bucket rather than being silently
     dropped or merged into another category. Hours use UI.hoursBetween exactly like every other
     hour figure in this file (occupancy rule: cancelled bookings are excluded).

     Standalone service entries (roadmap 2.3) are NOT part of this mix — they carry a qty/unit,
     not a start/end time, so there are no hours to attribute; see the returned footnote text. */
  function computeActivityMixRows(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }
    const meetings = loadMeetingsInRange(from, to).filter((m) => !m.is_cancelled); // rule 1

    const byPeriod = new Map(); // 'YYYY-MM' -> Map(category -> hours)
    const categorySet = new Set();
    meetings.forEach((m) => {
      const period = (m.date || '').slice(0, 7);
      if (!period) return;
      const category = (m.category || '').trim() || '(uncategorized)';
      categorySet.add(category);
      const hours = UI.hoursBetween(m.start_time, m.end_time);
      if (!byPeriod.has(period)) byPeriod.set(period, new Map());
      const catMap = byPeriod.get(period);
      catMap.set(category, (catMap.get(category) || 0) + hours);
    });

    const periods = Array.from(byPeriod.keys()).sort();
    // "(uncategorized)" sorted last rather than alphabetically wherever it would otherwise land,
    // so real vocabulary terms lead the matrix and the fallback bucket reads as an appendix.
    const categories = Array.from(categorySet).sort((a, b) => {
      if (a === '(uncategorized)') return 1;
      if (b === '(uncategorized)') return -1;
      return a.localeCompare(b);
    });
    const rows = periods.map((period) => {
      const catMap = byPeriod.get(period);
      const row = { period, hours: {} };
      categories.forEach((c) => { row.hours[c] = catMap.get(c) || 0; });
      return row;
    });

    return { periods, categories, rows };
  }

  /* ================================================================================
     Card — Funnel analysis with project outputs (ROADMAP 3.3)
     consult -> project created -> active (first booking) -> milestones progressing ->
     completed -> research output. A funnel across genuinely different units (events,
     projects, milestone-edits), stated up front rather than pretending otherwise — this is a
     progression of what's happening at the facility over the period, not a single population
     narrowing stage by stage, and the per-stage counts/labels say what's actually being counted.

     Per-stage counts (bounded by [from,to], same as every other card in this file):
       1. Consult volume       — meetings tagged category='consult', non-cancelled (rule 1).
                                  Facility-wide consults (project_id IS NULL) count toward this
                                  volume — they're real facility activity — but are never linked
                                  to any project, so they don't feed any later stage. Reuses
                                  computeConsultRows verbatim (no duplicated consult-tag math).
       2. Project created      — projects.created_at, sliced to its date part (first 10 chars).
                                  created_at is written via datetime('now'), which is a UTC
                                  timestamp, while every other date in this file is a plain LOCAL
                                  calendar-day string — slicing it mixes a UTC day boundary into a
                                  local-day date range, so a project created within ~a day of
                                  midnight can land one day off from where a human would place it.
                                  Acknowledged imprecision, not a new bug: every other on-screen
                                  "Created" display in this app (views.js's project header,
                                  exports.js) already reads this same column the same way.
       3. Active (first booking) — MIN(meetings.date) per project, occupancy-filtered (rule 1):
                                  a project is "active" the day its first non-cancelled booking
                                  happened, computed from the project's WHOLE history (unbounded),
                                  same reasoning as loadFirstInstrumentUserDates above — then that
                                  date is checked against [from,to].
       4. Milestones progressing — COUNT-ONLY. milestones.updated_at moves on ANY edit (status
                                  change, note edit, due-date change, reassignment...), not just a
                                  status transition, so this counts "a milestone got touched this
                                  period", not "a milestone finished a review stage". No per-project
                                  dedup — a project with 3 milestones edited in-period contributes 3.
       5. Completed             — COUNT-ONLY. A project counts if status='Completed' OR
                                  is_archived=1 (no new column). There's no "date the project
                                  became complete" field to bound this to a period honestly, so a
                                  LABELED PROXY is used when available: projects.end_date if set,
                                  else archived_at (date part) if the project is archived. A
                                  completed project with NEITHER proxy set has no date to place it
                                  in a bounded period, so it's excluded from a bounded [from,to]
                                  count (but included when the range is fully unbounded — "All
                                  Time" has no boundary to place it outside of) — always disclosed.
       6. Research output       — project_outputs.date, falling back to created_at's date part
                                  when date is blank (same UTC/local caveat as stage 2 above).

     Time-in-stage medians — ONLY these two transitions (no median is computed for any other
     adjacent pair). This is a deliberate narrowing of roadmap item 3.3, which asks for
     "conversion and time-in-stage per period"; the roadmap records the narrowing on the item
     itself. Conversion IS reported at every stage — it is only the medians that are limited to
     the two transitions where a duration is both well-defined and worth acting on:
       - created -> first booking
       - first booking -> first output
     Both use each project's UNBOUNDED true first-booking/first-output date (never a date
     merely inside the selected range — the same "look at the whole history" reasoning as
     loadFirstInstrumentUserDates), scoped to the population of projects whose EARLIER end of
     the transition falls in [from,to] (i.e. the same projects counted in the "created" stage for
     the first median, and in the "active" stage for the second).

     HONESTY REQUIREMENT (this item's rejected first attempt): a negative day-delta — the later
     event predating the earlier one — is real, not a bug, for backfilled/imported data (e.g. a
     booking logged before the project record was ever created in this app). EXCLUSION RULE:
     negative deltas are dropped from the median calculation itself (a "the booking happened
     before the project existed" data point does not have a meaningful non-negative duration to
     average in) but every excluded project is COUNTED and the count is surfaced everywhere the
     median is shown — the card footnote below and the exportReportsXlsx Notes sheet — as
     "N projects excluded: first booking predates the project record" (and the equivalent for the
     output transition). Never silently dropped, never clamped to zero. */
  function loadProjectFunnelFacts() {
    // Deliberately UNBOUNDED (no from/to) — same reasoning as loadFirstInstrumentUserDates: to
    // know a project's TRUE first booking/output, the whole history must be visible, not just
    // whatever falls inside the report's selected range.
    return DB.rows(`
      SELECT pr.id, pr.status, pr.is_archived, pr.created_at, pr.end_date, pr.archived_at,
        (SELECT MIN(mt.date) FROM meetings mt WHERE mt.project_id = pr.id AND mt.is_cancelled = 0) AS first_booking_date,
        (SELECT MIN(${DB.outputEffDate('po')})
           FROM project_outputs po WHERE po.project_id = pr.id) AS first_output_date
      FROM projects pr`);
  }
  // updated_at is a UTC timestamp (`datetime('now')`, see db.js), while `from`/`to` are local
  // calendar-day strings the user actually picked. SQL's `date(updated_at)` only truncates the
  // string to its first 10 characters — it does NOT convert UTC to local time — so it silently
  // compares a UTC calendar day against a local-day range. At a UTC+ offset (this app's own
  // required test timezone, Asia/Jerusalem) that mis-files any edit made in the last few hours of
  // the local day into "yesterday" as far as this filter is concerned — the same class of bug as
  // issue #14, just against a timestamp column instead of a date column. Filtering in JS instead,
  // via utcTimestampToLocalDay (below), fixes that: the comparison always happens against the
  // local calendar day the edit actually landed on.
  function loadMilestoneUpdatesInRange(from, to) {
    return DB.rows('SELECT id, updated_at FROM milestones')
      .filter((r) => dateInRange(utcTimestampToLocalDay(r.updated_at), from, to));
  }
  function loadOutputsInRange(from, to) {
    return DB.rows(`
      SELECT po.*, p.code AS project_code, p.title AS project_title,
             ${DB.outputEffDate('po')} AS eff_date
      FROM project_outputs po
      JOIN projects p ON p.id = po.project_id
      WHERE (? = '' OR ${DB.outputEffDate('po')} >= ?)
        AND (? = '' OR ${DB.outputEffDate('po')} <= ?)
      ORDER BY eff_date DESC, po.id DESC`, rangeParams(from, to));
  }
  // created_at/updated_at/archived_at are all written via `datetime('now')` (see db.js), which is
  // a UTC instant, formatted 'YYYY-MM-DD HH:MM:SS' with NO timezone marker — unlike every other
  // date in this file, which is a plain LOCAL calendar day the user actually typed into a date
  // picker. Just slicing the first 10 characters off one of these (as this file used to, and as
  // SQL's own `date(...)` does) reads its UTC calendar day, not its local one — at a UTC+ offset
  // (this app's own required test timezone) an event in the last few hours of the local day comes
  // out dated "tomorrow" in UTC, so it silently sorts into the wrong local day/month/year. Fixed
  // the same way CLAUDE.md's date rules fix the opposite direction (UI.fmtDate appends a bare
  // local time to force local parsing): reparse the stored string as an explicit UTC instant by
  // appending 'Z', then read that instant's LOCAL calendar fields via UI.ymd (never toISOString,
  // which would just undo the fix by re-describing the instant in UTC again).
  function utcTimestampToLocalDay(ts) {
    if (!ts) return '';
    const d = new Date(String(ts).replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return String(ts).slice(0, 10); // not a parseable timestamp — fall back rather than throw
    return UI.ymd(d);
  }
  // 'YYYY-MM-DD' (or a longer datetime string, sliced) in-range check — '' on either bound means
  // unbounded, mirroring RANGE_SQL's own '' = unbounded convention above, just in plain JS for
  // per-project date facts that aren't worth a round-trip to SQL. Callers pass a UTC timestamp
  // through utcTimestampToLocalDay first (created_at/archived_at); a plain local date column
  // (first_booking_date, end_date, first_output_date, ...) is already safe to slice as-is.
  function dateInRange(dateStr, from, to) {
    if (!dateStr) return false;
    const d = String(dateStr).slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }
  // Local-calendar-day difference in whole days, per CLAUDE.md's date rules: both inputs are
  // sliced to their date-only part and parsed with an explicit local midnight ('T00:00:00'), the
  // same construction UI.fmtDate already uses — never toISOString, never a bare `new Date(str)`.
  function daysBetweenDates(aStr, bStr) {
    const a = new Date(String(aStr).slice(0, 10) + 'T00:00:00');
    const b = new Date(String(bStr).slice(0, 10) + 'T00:00:00');
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }
  function median(values) {
    if (!values.length) return null;
    const s = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  function computeFunnelRows(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }
    const unbounded = !from && !to;

    // Stage 1 — reuse computeConsultRows verbatim; see its own header for the cancellation rule.
    const consultCount = computeConsultRows(from, to).totalConsults;

    // created_at/archived_at are UTC timestamps; pre-convert both to the local calendar day they
    // actually fall on (see utcTimestampToLocalDay) ONCE per project here, so every later use below
    // (stage 2, stage 5's proxy date, and median 1) reads the same corrected value rather than
    // re-deriving it — and never accidentally reads the raw UTC string by mistake.
    const facts = loadProjectFunnelFacts().map((f) => Object.assign({}, f, {
      created_local: utcTimestampToLocalDay(f.created_at),
      archived_local: f.archived_at ? utcTimestampToLocalDay(f.archived_at) : ''
    }));

    // Stage 2 — project created, by created_at's LOCAL calendar day (see created_local above).
    const createdIn = facts.filter((f) => dateInRange(f.created_local, from, to));

    // Stage 3 — active (first booking), by the project's true (unbounded) first non-cancelled
    // booking date.
    const activeIn = facts.filter((f) => dateInRange(f.first_booking_date, from, to));

    // Stage 4 — milestones progressing, count-only, no per-project dedup.
    const milestonesCount = loadMilestoneUpdatesInRange(from, to).length;

    // Stage 5 — completed, count-only, end_date/archived_at as a labeled proxy where present.
    let completedCount = 0, completedNoDateCount = 0;
    facts.forEach((f) => {
      const isCompleted = f.status === 'Completed' || !!f.is_archived;
      if (!isCompleted) return;
      const proxyDate = f.end_date || (f.is_archived ? f.archived_local : '') || '';
      if (proxyDate) {
        if (dateInRange(proxyDate, from, to)) completedCount += 1;
      } else if (unbounded) {
        completedCount += 1;
      } else {
        completedNoDateCount += 1;
      }
    });

    // Stage 6 — research output.
    const outputRows = loadOutputsInRange(from, to);
    const outputCount = outputRows.length;

    // Median 1: created -> first booking, over the "created" population (createdIn), using each
    // project's true unbounded first-booking date. Negative deltas (booking predates the
    // project's own created_at) are excluded from the median but counted for disclosure.
    let createdToActiveNegative = 0;
    const createdToActiveDeltas = [];
    createdIn.forEach((f) => {
      if (!f.first_booking_date) return; // no booking at all yet — nothing to measure
      const delta = daysBetweenDates(f.created_local, f.first_booking_date);
      if (delta == null) return;
      if (delta < 0) { createdToActiveNegative += 1; return; }
      createdToActiveDeltas.push(delta);
    });

    // Median 2: first booking -> first output, over the "active" population (activeIn), using
    // each project's true unbounded first-output date. Same negative-delta exclusion+disclosure.
    let activeToOutputNegative = 0;
    const activeToOutputDeltas = [];
    activeIn.forEach((f) => {
      if (!f.first_output_date) return; // no output recorded yet
      const delta = daysBetweenDates(f.first_booking_date, f.first_output_date);
      if (delta == null) return;
      if (delta < 0) { activeToOutputNegative += 1; return; }
      activeToOutputDeltas.push(delta);
    });

    // Adjacent conversion %: each stage's count over the previous stage's count. Stages count
    // different kinds of things (events / projects / milestone-edits) — see file header — so
    // this is a rough period-over-period ratio, not a literal population narrowing; the on-screen
    // footnote says so.
    function pct(num, den) { return den > 0 ? (num / den) * 100 : null; }
    const stages = [
      { key: 'consult', label: 'Consult Volume', count: consultCount, conversionPct: null },
      { key: 'created', label: 'Project Created', count: createdIn.length, conversionPct: pct(createdIn.length, consultCount) },
      { key: 'active', label: 'Active (First Booking)', count: activeIn.length, conversionPct: pct(activeIn.length, createdIn.length) },
      { key: 'milestones', label: 'Milestones Progressing', count: milestonesCount, conversionPct: pct(milestonesCount, activeIn.length) },
      { key: 'completed', label: 'Completed', count: completedCount, conversionPct: pct(completedCount, milestonesCount) },
      { key: 'output', label: 'Research Output', count: outputCount, conversionPct: pct(outputCount, completedCount) }
    ];

    return {
      stages,
      completedNoDateCount,
      medians: {
        createdToActive: {
          days: median(createdToActiveDeltas), sampleSize: createdToActiveDeltas.length,
          excludedNegative: createdToActiveNegative
        },
        activeToOutput: {
          days: median(activeToOutputDeltas), sampleSize: activeToOutputDeltas.length,
          excludedNegative: activeToOutputNegative
        }
      },
      outputRows
    };
  }

  /* ---------------- Small render helpers ---------------- */
  // Locale pinned for the same reason UI.fmtMoney pins it: a viewer's browser locale would
  // otherwise decide whether 2.5 hours reads as "2.5" or "2,5", and a report should not change
  // shape depending on who opened it.
  function fmtHours(h) { return (Math.round((h || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  // The single copy of this now lives in ui.js (UI.fmtMoney) so every screen that prints money —
  // the booking modal, Project Costs, and this report — reads the same configured currency symbol
  // (Settings -> Billing Rates) and rounds the same way. Per CLAUDE.md: "a report that disagrees
  // with the booking modal about money is worse than no report." Kept as a local alias so the
  // ~8 call sites below don't all need renaming.
  function fmtMoney(n) {
    return UI.fmtMoney(n);
  }
  function nameCell(name, retired) { return esc(UI.retiredName(name, retired)); }
  function bar(pct) {
    return `<div class="row" style="gap:8px"><div class="progress seg grow" style="height:8px"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></div><span class="mono small" style="width:42px;text-align:right">${pct.toFixed(1)}%</span></div>`;
  }

  /* ================================================================================
     ROADMAP 3.5 — Hand-rolled inline SVG charts (no chart library).

     Theming: every fill/stroke below is a CSS custom property (var(--primary),
     var(--chart-1)..var(--chart-6), var(--surface-2), var(--text-muted)) defined in
     css/app.css's :root / [data-theme="dark"] blocks, so a theme flip repaints these charts
     with ZERO re-render — the browser just resolves the custom property again.

     Retired-name labels (this item's rejected first attempt got this wrong): the on-chart
     label truncates the BASE name first and appends UI.retiredName's " (Retired)" suffix
     AFTER truncating — never truncate the already-suffixed string, which would cut it down to
     something like "Leica SP8 FALCON (R…" and silently hide that the record is retired. Every
     bar/segment also carries a <title> with the FULL (untruncated) name so the exact record is
     always recoverable via hover/long-press, regardless of how the on-chart label was clipped.

     Each chart is display-only: it consumes the SAME rows object the table below it renders
     from (computed exactly once in render(), per this item's requirement), so a chart can never
     show a number the table disagrees with — no export/app.js touches these. */
  function chartLabel(name, retired, maxChars) {
    const base = String(name == null ? '' : name);
    const trimmed = base.length > maxChars ? base.slice(0, maxChars - 1).trimEnd() + '…' : base;
    return UI.retiredName(trimmed, retired);
  }
  const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

  // Chart 1 of 3 — horizontal bars: instrument utilization by booked hours (from
  // computeInstrumentRows, already sorted by hours descending). Capped to the top 8 rows so the
  // chart stays legible; the full set is always in the table underneath, and the cap is disclosed
  // rather than silently dropping rows from view.
  function chartUtilization(rows) {
    if (!rows.length) return '';
    const shown = rows.slice(0, 8);
    const barH = 22, gap = 10, leftLabelW = 150, chartW = 380, rightPad = 90;
    const maxVal = Math.max(1, ...shown.map((r) => r.hours));
    const height = shown.length * (barH + gap) + gap;
    const width = leftLabelW + chartW + rightPad;
    const bars = shown.map((r, i) => {
      const y = gap + i * (barH + gap);
      const w = (r.hours / maxVal) * chartW;
      const label = chartLabel(r.name, r.retired, 18);
      const full = UI.retiredName(r.name, r.retired);
      return `<g>
        <title>${esc(full)}: ${fmtHours(r.hours)}h (${r.sharePct.toFixed(1)}% of total booked hours)</title>
        <text x="${leftLabelW - 8}" y="${(y + barH / 2 + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--text-muted)">${esc(label)}</text>
        <rect x="${leftLabelW}" y="${y}" width="${chartW}" height="${barH}" rx="4" fill="var(--surface-2)"></rect>
        <rect x="${leftLabelW}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="4" fill="var(--primary)"></rect>
        <text x="${leftLabelW + chartW + 8}" y="${(y + barH / 2 + 4).toFixed(1)}" font-size="11" fill="var(--text-muted)" font-family="var(--mono)">${fmtHours(r.hours)}h</text>
      </g>`;
    }).join('');
    const note = rows.length > shown.length
      ? `<div class="faint small mt-8">Chart shows the top ${shown.length} of ${rows.length} instruments by booked hours; the table below lists all of them.</div>` : '';
    return `<div class="tbl-wrap"><svg role="img" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="max-width:640px" aria-label="Instrument utilization by booked hours"><title>Instrument utilization by booked hours</title>${bars}</svg></div>${note}`;
  }

  // Chart 2 of 3 — funnel: stage bars + adjacent conversion-percentage labels, from
  // computeFunnelRows. Bar length is each stage's count relative to the largest stage's count
  // (not literally "percent of the funnel entrance", since the stages count different kinds of
  // things — see computeFunnelRows' header); the conversion % printed alongside each bar is the
  // exact same number the table below computes, never recomputed here.
  function chartFunnel(stages) {
    if (!stages.length) return '';
    const barH = 24, gap = 12, leftLabelW = 190, chartW = 320, rightPad = 120;
    const maxCount = Math.max(1, ...stages.map((s) => s.count));
    const height = stages.length * (barH + gap) + gap;
    const width = leftLabelW + chartW + rightPad;
    const bars = stages.map((s, i) => {
      const y = gap + i * (barH + gap);
      const w = (s.count / maxCount) * chartW;
      const color = CHART_COLORS[i % CHART_COLORS.length];
      const convText = s.conversionPct == null ? '' : ` — ${s.conversionPct.toFixed(1)}% from previous stage`;
      const convValue = s.conversionPct == null ? '' : ` · ${s.conversionPct.toFixed(1)}%`;
      return `<g>
        <title>${esc(s.label)}: ${s.count}${convText}</title>
        <text x="${leftLabelW - 8}" y="${(y + barH / 2 + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--text-muted)">${esc(s.label)}</text>
        <rect x="${leftLabelW}" y="${y}" width="${chartW}" height="${barH}" rx="4" fill="var(--surface-2)"></rect>
        <rect x="${leftLabelW}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="4" fill="${color}"></rect>
        <text x="${leftLabelW + chartW + 8}" y="${(y + barH / 2 + 4).toFixed(1)}" font-size="11" fill="var(--text-muted)" font-family="var(--mono)">${s.count}${convValue}</text>
      </g>`;
    }).join('');
    return `<div class="tbl-wrap"><svg role="img" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="max-width:680px" aria-label="Funnel from consult to research output"><title>Funnel: consult to research output</title>${bars}</svg></div>`;
  }

  // Chart 3 of 3 — stacked bars + legend: activity mix hours by month/category, from
  // computeActivityMixRows. Bar segment order follows mix.categories (uncategorized always last,
  // per that function's own sort), colored by cycling CHART_COLORS so a category keeps the same
  // color across every bar in the chart; the legend below maps color to category name.
  function chartActivityMix(mix) {
    if (!mix.rows.length) return '';
    const barW = 30, gap = 18, chartH = 140, leftPad = 8, topPad = 8, labelH = 26;
    const totals = mix.rows.map((r) => mix.categories.reduce((s, c) => s + (r.hours[c] || 0), 0));
    const maxTotal = Math.max(1, ...totals);
    const width = leftPad * 2 + mix.rows.length * (barW + gap);
    const height = topPad + chartH + labelH;
    const bars = mix.rows.map((r, i) => {
      const x = leftPad + i * (barW + gap);
      let yTop = topPad + chartH;
      const segs = mix.categories.map((c, ci) => {
        const val = r.hours[c] || 0;
        if (val <= 0) return '';
        const segH = (val / maxTotal) * chartH;
        yTop -= segH;
        return `<rect x="${x}" y="${yTop.toFixed(1)}" width="${barW}" height="${segH.toFixed(1)}" fill="${CHART_COLORS[ci % CHART_COLORS.length]}"><title>${esc(r.period)} — ${esc(c)}: ${fmtHours(val)}h</title></rect>`;
      }).join('');
      return `<g>${segs}<text x="${(x + barW / 2).toFixed(1)}" y="${topPad + chartH + 16}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${esc(r.period)}</text></g>`;
    }).join('');
    const legend = mix.categories.map((c, ci) =>
      `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${CHART_COLORS[ci % CHART_COLORS.length]}"></i><span class="small faint">${esc(c)}</span></span>`
    ).join('');
    const svg = `<div class="tbl-wrap"><svg role="img" viewBox="0 0 ${width} ${height}" width="${Math.max(width, 260)}" height="${height}" style="max-width:100%" aria-label="Activity mix hours by month and category"><title>Activity mix by month and category</title>${bars}</svg></div>`;
    return `${svg}<div class="mt-8">${legend}</div>`;
  }

  /* ================================================================================
     Row-level bookings (ROADMAP 3.6, "Bookings (row-level)" entity for the custom report
     generator below). Unlike every aggregating card above, this is a raw listing — ONE ROW
     PER BOOKING, cancelled bookings included (with their status carrying the fact) rather than
     excluded outright, because a row-level export exists precisely so a user can see what was
     cancelled, not just what wasn't. The occupancy and money rules still apply to the numeric
     columns: a cancelled booking's Hours/Staff Hours are zeroed (it never held its slot) and its
     Cost is zeroed unless the charge was retained — identical math to every other card, just
     applied per-row instead of summed into a total. */
  function loadBookingInstrumentNames(from, to) {
    return DB.rows(`
      SELECT mi.meeting_id, i.name AS instrument_name, i.is_retired AS instrument_retired
      FROM meeting_instruments mi
      JOIN instruments i ON i.id = mi.instrument_id
      JOIN meetings mt ON mt.id = mi.meeting_id
      WHERE ${RANGE_SQL}`, rangeParams(from, to));
  }
  function computeBookingRows(from, to) {
    if (from === undefined) { from = state.from; to = state.to; }
    const meetings = loadMeetingsInRange(from, to);
    const annotated = annotateMeetings(meetings);

    const instrByMeeting = new Map(); // meeting_id -> [retired-suffixed name, ...]
    loadBookingInstrumentNames(from, to).forEach((ln) => {
      if (!instrByMeeting.has(ln.meeting_id)) instrByMeeting.set(ln.meeting_id, []);
      instrByMeeting.get(ln.meeting_id).push(UI.retiredName(ln.instrument_name, ln.instrument_retired));
    });

    const staffByMeeting = new Map(); // meeting_id -> { names: [...], hours: number }
    loadStaffLines(from, to).forEach((ln) => {
      const mm = annotated.get(ln.meeting_id);
      if (!mm) return;
      if (!staffByMeeting.has(ln.meeting_id)) staffByMeeting.set(ln.meeting_id, { names: [], hours: 0 });
      const entry = staffByMeeting.get(ln.meeting_id);
      entry.names.push(UI.retiredName(ln.person_name, ln.person_retired));
      // Same blank-window fallback as computeStaffRows/computeStaffInstrumentMatrix: a blank
      // per-staff start/end means "the whole booking window", not zero.
      const rawHours = (ln.start_time && ln.end_time) ? UI.hoursBetween(ln.start_time, ln.end_time) : mm.bookingHours;
      entry.hours += rawHours;
    });

    const rows = meetings.map((m) => {
      const mm = annotated.get(m.id);
      const insts = instrByMeeting.get(m.id) || [];
      const staffEntry = staffByMeeting.get(m.id) || { names: [], hours: 0 };
      const status = m.is_cancelled ? (m.billing_retained ? 'Cancelled (charged)' : 'Cancelled (waived)') : 'Booked';
      return {
        date: m.date || '',
        title: m.title || '',
        category: m.category || '',
        project: m.project_id == null ? 'Facility-wide' : (m.project_code ? m.project_code + ' — ' + m.project_title : m.project_title),
        lab: m.group_org || '',
        instruments: insts.join(', '),
        staff: staffEntry.names.join(', '),
        hours: mm.occupancyCounts ? mm.bookingHours : 0,        // rule 1
        staffHours: mm.occupancyCounts ? staffEntry.hours : 0,  // rule 1
        status,
        cost: mm.moneyCounts ? (m.total_cost || 0) : 0          // rule 2
      };
    });

    return { rows };
  }

  /* ================================================================================
     Custom report generator (ROADMAP 3.6)

     ENTITY_DEFS is the single declarative field list this item's spec requires: one entry per
     selectable entity, each carrying the columns available for it (label/key/type/required) and
     a `buildRows(from,to)` that delegates to the existing compute* functions above — this file
     never re-derives a number, it only re-shapes/re-flattens what compute* already produced.
     Both the custom-report modal's preview table (app.js) and Exports.exportCustomXlsx read this
     SAME map, so a column can never render differently in the two places.

     FLATTENED-TABLE INTEGRITY: three of these entities emit one row per (discriminator x entity)
     pair, where the same underlying entity is deliberately repeated across rows (mirroring what
     exportReportsXlsx's own sheets already do for these same three cards):
       - projects:     a booking's hours/cost appear once under its Project row AND once under
                        its Lab/Group row — summing across both scopes double-counts every booking.
       - consults:     the same consult count appears three times over (Total / By Instrument /
                        By Period) — three different breakdowns of the same events, not three
                        populations.
       - stewardship:  a multi-supervisor instrument repeats — IDENTICAL bookings/hours/revenue —
                        under every supervisor it's linked to (see computeStewardshipRows' header).
       - activitymix:  the same period repeats once per category present in the data.
     Each of those discriminator columns (scope / breakdown / supervisor / category) is marked
     required:true below so it can never be unchecked into a sheet of silently double-countable
     rows that look identical without it. computeCustomRows force-re-adds any required column the
     caller omitted, and each entity's `notes` string is surfaced in both the modal's preview
     footnote and the XLSX Notes sheet — never only one of the two. */
  function ccol(key, label, type, get, opts) {
    return Object.assign({ key, label, type, get, required: false }, opts || {});
  }

  const CUSTOM_REPORT_ENTITY_ORDER = ['instrument', 'staff', 'projects', 'consults', 'service', 'stewardship', 'activitymix', 'funnel', 'bookings'];

  const ENTITY_DEFS = {
    instrument: {
      label: 'Instrument Utilization',
      // R1 disclosure: "Line Charges" is a sum of raw meeting_instruments.line_cost snapshots —
      // priced BEFORE the booking's group/manual discount, overhead, and tax are applied (those
      // are a whole-booking calculation, not a per-line one — see computeBookingBOM in ui.js). It
      // will not match a project's Total Cost, which is post-discount/overhead/tax. Renamed from
      // "Billed Revenue" (which implied the opposite) rather than leaving the old name with just a
      // footnote, since a column a reader copies straight into their own spreadsheet carries no
      // footnote with it — the name itself needs to say what it is.
      notes: ['"Line Charges" is each instrument\'s raw booking line-cost total, before any group/manual discount, overhead, or tax is applied at the whole-booking level — it will not match a project\'s Total Cost (see Projects & Groups), which is after all three.'],
      buildRows: (from, to) => computeInstrumentRows(from, to).rows,
      columns: [
        ccol('name', 'Instrument', 'text', (r) => UI.retiredName(r.name, r.retired)),
        ccol('bookings', 'Bookings', 'number', (r) => r.bookings),
        ccol('hours', 'Booked Hours', 'hours', (r) => r.hours),
        ccol('revenue', 'Line Charges', 'money', (r) => r.revenue),
        ccol('sharePct', 'Share of Total Hours %', 'number', (r) => Math.round(r.sharePct * 100) / 100)
      ]
    },
    staff: {
      label: 'Staff Time',
      // Same disclosure as the instrument entity above, for meeting_staff.line_cost — staff lines
      // are never discounted, but a booking's overhead/tax is still applied to the whole booking
      // total, not reflected in this per-line figure.
      notes: ['"Line Charges" is each staff member\'s raw booking line-cost total, before the booking\'s overhead or tax is applied at the whole-booking level — it will not match a project\'s Total Cost (see Projects & Groups).'],
      buildRows: (from, to) => computeStaffRows(from, to).rows,
      columns: [
        ccol('name', 'Staff Member', 'text', (r) => UI.retiredName(r.name, r.retired)),
        ccol('sessions', 'Sessions', 'number', (r) => r.sessions),
        ccol('rawHours', 'Raw Hours', 'hours', (r) => r.rawHours),
        ccol('billHours', 'Billed Hours', 'hours', (r) => r.billHours),
        ccol('revenue', 'Line Charges', 'money', (r) => r.revenue)
      ]
    },
    projects: {
      label: 'Projects & Groups',
      notes: ['A booking contributes to both its Project row and its Lab/Group row — the Scope column is required so summing Hours/Total Cost across both scopes can never be mistaken for a single total (it would double every booking).'],
      buildRows: (from, to) => {
        const p = computeProjectRows(from, to);
        const rows = [];
        p.projects.forEach((r) => rows.push({ scope: 'Project', label: r.label, bookings: r.bookings, hours: r.hours, cost: r.cost }));
        p.groups.forEach((r) => rows.push({ scope: 'Lab / Group', label: r.label, bookings: r.bookings, hours: r.hours, cost: r.cost }));
        return rows;
      },
      columns: [
        ccol('scope', 'Scope', 'text', (r) => r.scope, { required: true }),
        ccol('label', 'Name', 'text', (r) => r.label),
        ccol('bookings', 'Bookings', 'number', (r) => r.bookings),
        ccol('hours', 'Hours', 'hours', (r) => r.hours),
        ccol('cost', 'Total Cost', 'money', (r) => r.cost)
      ]
    },
    consults: {
      label: 'Consults',
      notes: ['The same consult count is reported three ways here (Total / By Instrument / By Period) — the Breakdown column is required so those three views are never summed together as if they were three different populations.'],
      buildRows: (from, to) => {
        const c = computeConsultRows(from, to);
        const rows = [{ breakdown: 'Total', label: 'All', count: c.totalConsults }];
        c.instrumentRows.forEach((r) => rows.push({ breakdown: 'By Instrument', label: UI.retiredName(r.name, r.retired), count: r.count }));
        c.periodRows.forEach((r) => rows.push({ breakdown: 'By Period', label: r.period, count: r.count }));
        return rows;
      },
      columns: [
        ccol('breakdown', 'Breakdown', 'text', (r) => r.breakdown, { required: true }),
        ccol('label', 'Instrument / Month', 'text', (r) => r.label),
        ccol('count', 'Consults', 'number', (r) => r.count)
      ]
    },
    service: {
      label: 'Service Entries',
      notes: [],
      buildRows: (from, to) => computeServiceEntryRows(from, to).rows,
      columns: [
        ccol('description', 'Description', 'text', (r) => r.description),
        ccol('project', 'Project', 'text', (r) => r.project_id == null ? 'Facility-wide' : (r.project_code ? r.project_code + ' — ' + r.project_title : r.project_title)),
        ccol('staff', 'Staff', 'text', (r) => r.person_name ? UI.retiredName(r.person_name, r.person_retired) : '—'),
        ccol('instrument', 'Instrument', 'text', (r) => r.instrument_name ? UI.retiredName(r.instrument_name, r.instrument_retired) : '—'),
        ccol('status', 'Status', 'text', (r) => r.is_cancelled ? (r.billing_retained ? 'Cancelled (charged)' : 'Cancelled (waived)') : 'Active'),
        ccol('date', 'Date', 'text', (r) => r.date || '—'),
        ccol('qty', 'Qty', 'number', (r) => r.qty || 0),
        ccol('unit', 'Unit', 'text', (r) => r.unit || '—'),
        ccol('cost', 'Total', 'money', (r) => r.countedCost)
      ]
    },
    stewardship: {
      label: 'Stewardship',
      notes: ['A multi-supervisor instrument is repeated under every supervisor it is linked to — the SAME bookings/hours/revenue on each repeated row (see computeStewardshipRows). The Supervisor column is required so those identical rows can never be silently double- (or triple-) counted as if they were separate instruments.'],
      buildRows: (from, to) => {
        const s = computeStewardshipRows(from, to);
        const rows = [];
        s.groups.forEach((g) => {
          const supLabel = g.supervisor ? UI.retiredName(g.supervisor.name, g.supervisor.retired) : 'Unassigned';
          g.rows.forEach((r) => rows.push({
            supervisor: supLabel, name: r.name, retired: r.retired, bookings: r.bookings, hours: r.hours,
            revenue: r.revenue, distinctUsers: r.distinctUsers, newUsers: r.newUsers,
            projectsServed: r.projectsServed, facilityWideSessions: r.facilityWideSessions, consultCount: r.consultCount
          }));
        });
        return rows;
      },
      columns: [
        ccol('supervisor', 'Supervisor', 'text', (r) => r.supervisor, { required: true }),
        ccol('name', 'Instrument', 'text', (r) => UI.retiredName(r.name, r.retired)),
        ccol('bookings', 'Bookings', 'number', (r) => r.bookings),
        ccol('hours', 'Hours', 'hours', (r) => r.hours),
        ccol('revenue', 'Line Charges', 'money', (r) => r.revenue),
        ccol('distinctUsers', 'Distinct Users', 'number', (r) => r.distinctUsers),
        ccol('newUsers', 'New Users', 'number', (r) => r.newUsers),
        ccol('projectsServed', 'Projects Served', 'number', (r) => r.projectsServed),
        ccol('facilityWideSessions', 'Facility-Wide Sessions', 'number', (r) => r.facilityWideSessions),
        ccol('consultCount', 'Consults', 'number', (r) => r.consultCount)
      ]
    },
    activitymix: {
      label: 'Activity Mix',
      notes: ['Each period repeats once per category present in the data — the Category column is required so hours from different categories in the same period are never mistaken for duplicate rows of the same total.'],
      buildRows: (from, to) => {
        const mix = computeActivityMixRows(from, to);
        const rows = [];
        mix.rows.forEach((r) => mix.categories.forEach((c) => rows.push({ period: r.period, category: c, hours: r.hours[c] || 0 })));
        return rows;
      },
      columns: [
        ccol('period', 'Month', 'text', (r) => r.period),
        ccol('category', 'Category', 'text', (r) => r.category, { required: true }),
        ccol('hours', 'Hours', 'hours', (r) => r.hours)
      ]
    },
    funnel: {
      label: 'Funnel',
      // Static structural note (Stage discriminator) PLUS the data-dependent exclusion counts
      // (completedNoDateCount, both medians' excludedNegative/sampleSize) that computeFunnelRows
      // discloses precisely because item 3.3's honesty requirement forbids silently dropping
      // them — the same counts exportReportsXlsx's own Notes sheet and Funnel sheet surface (see
      // exports.js). A STATIC string array can't carry these, so this is computed per (from,to)
      // instead of a plain `notes` array, and computeCustomRows below calls it that way.
      buildNotes: (from, to) => {
        const f = computeFunnelRows(from, to);
        const notes = ['Each stage repeats the same underlying projects that reached it — the Stage column is required so summing Count across stages can never be mistaken for a count of distinct projects (it would double- or quadruple-count them). The two "Median" rows report days, not project counts, and share the Count column — with Stage visible they can still be told apart from the stage rows.'];
        notes.push('"Completed" is dated by end_date (or archive date) when set; a completed project with neither date has no date to place in a bounded range and ' + (f.completedNoDateCount ? `is excluded here (${f.completedNoDateCount} completed project${f.completedNoDateCount === 1 ? '' : 's'} with no end/archive date).` : 'none are excluded in this range.'));
        notes.push('Both medians exclude (but disclose) projects where the later event predates the earlier one — real for backfilled/imported data: '
          + `${f.medians.createdToActive.excludedNegative} project${f.medians.createdToActive.excludedNegative === 1 ? '' : 's'} excluded from "created → first booking" (n=${f.medians.createdToActive.sampleSize}), `
          + `${f.medians.activeToOutput.excludedNegative} project${f.medians.activeToOutput.excludedNegative === 1 ? '' : 's'} excluded from "first booking → first output" (n=${f.medians.activeToOutput.sampleSize}).`);
        return notes;
      },
      buildRows: (from, to) => {
        const f = computeFunnelRows(from, to);
        const rows = f.stages.map((s) => ({ stage: s.label, count: s.count, conversionPct: s.conversionPct }));
        rows.push({ stage: 'Median: created → first booking (days)', count: f.medians.createdToActive.days, conversionPct: null });
        rows.push({ stage: 'Median: first booking → first output (days)', count: f.medians.activeToOutput.days, conversionPct: null });
        return rows;
      },
      columns: [
        ccol('stage', 'Stage', 'text', (r) => r.stage, { required: true }),
        ccol('count', 'Count', 'number', (r) => r.count == null ? '' : r.count),
        ccol('conversionPct', 'Conversion From Previous %', 'number', (r) => r.conversionPct == null ? '' : Math.round(r.conversionPct * 100) / 100)
      ]
    },
    bookings: {
      label: 'Bookings (Row-Level)',
      notes: [],
      buildRows: (from, to) => computeBookingRows(from, to).rows,
      columns: [
        ccol('date', 'Date', 'text', (r) => r.date || '—'),
        ccol('title', 'Title', 'text', (r) => r.title || '—'),
        ccol('category', 'Category', 'text', (r) => r.category || '—'),
        ccol('project', 'Project', 'text', (r) => r.project),
        ccol('lab', 'Lab / Group', 'text', (r) => r.lab || '—'),
        ccol('instruments', 'Instruments', 'text', (r) => r.instruments || '—'),
        ccol('staff', 'Staff', 'text', (r) => r.staff || '—'),
        ccol('hours', 'Hours', 'hours', (r) => r.hours),
        ccol('staffHours', 'Staff Hours', 'hours', (r) => r.staffHours),
        ccol('status', 'Status', 'text', (r) => r.status),
        ccol('cost', 'Cost', 'money', (r) => r.cost)
      ]
    }
  };

  // Ordered [{key,label}] for the modal's entity radio list — app.js never hardcodes this list.
  function getCustomReportEntities() {
    return CUSTOM_REPORT_ENTITY_ORDER.map((key) => ({ key, label: ENTITY_DEFS[key].label }));
  }
  // Column defs (key/label/type/required) for one entity's checkbox list — app.js renders these,
  // never inventing its own field names.
  function getCustomReportColumns(entityKey) {
    const def = ENTITY_DEFS[entityKey];
    return def ? def.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, required: !!c.required })) : [];
  }
  // Notes for one entity, over an explicit (from,to) — most entities' notes are a fixed
  // structural string, but an entity can instead define `buildNotes(from,to)` when its
  // disclosure text is data-dependent (see the funnel entity's excludedNegative/
  // completedNoDateCount counts above); both app.js's preview and Exports.exportCustomXlsx call
  // this the same way, so the two can never disagree about what gets disclosed.
  function getCustomReportNotes(entityKey, from, to) {
    const def = ENTITY_DEFS[entityKey];
    if (!def) return [];
    return def.buildNotes ? def.buildNotes(from, to) : (def.notes || []);
  }
  function getCustomReportLabel(entityKey) {
    const def = ENTITY_DEFS[entityKey];
    return def ? def.label : entityKey;
  }

  /* spec = { entity: '<key>', columns: ['key1','key2',...] }. Takes explicit (from,to) — like
     every compute* above — and never touches module state, so app.js's live preview and
     Exports.exportCustomXlsx both call this the same way regardless of what the screen itself is
     showing. Required columns are force-re-added even if the caller's spec omitted them (a stale
     persisted column list from before a column became required, or a hand-built spec) — see the
     FLATTENED-TABLE INTEGRITY note above for why that matters. */
  function computeCustomRows(spec, from, to) {
    const entity = spec && spec.entity;
    const def = ENTITY_DEFS[entity];
    if (!def) return { entity, columns: [], rows: [], notes: [] };
    const requested = new Set((spec.columns || []).filter((k) => def.columns.some((c) => c.key === k)));
    def.columns.forEach((c) => { if (c.required) requested.add(c.key); });
    const columns = def.columns.filter((c) => requested.has(c.key));
    const dataRows = def.buildRows(from, to);
    const notes = def.buildNotes ? def.buildNotes(from, to) : (def.notes || []);
    const rows = dataRows.map((r) => {
      const out = {};
      columns.forEach((c) => { out[c.key] = c.get(r); });
      return out;
    });
    return { entity, columns, rows, notes };
  }

  // Shared cell formatting so the modal's preview table and Exports.exportCustomXlsx render the
  // exact same column the exact same way (numbers rounded identically, text escaped identically).
  function formatCustomCellDisplay(col, value) {
    if (value === '' || value == null) return '<span class="faint">—</span>';
    if (col.type === 'hours') return fmtHours(value);
    if (col.type === 'money') return fmtMoney(value);
    if (col.type === 'number') return esc(String(value));
    return esc(String(value));
  }
  function formatCustomCellXlsx(col, value) {
    if (value == null) return '';
    if (col.type === 'hours' || col.type === 'money' || col.type === 'number') {
      return value === '' ? '' : Math.round(Number(value) * 100) / 100;
    }
    return value;
  }

  /* ---------------- Screen ---------------- */
  function render() {
    const { from, to } = getRange();
    const instr = computeInstrumentRows(from, to);
    const staff = computeStaffRows(from, to);
    const matrix = computeStaffInstrumentMatrix(from, to);
    const proj = computeProjectRows(from, to);
    const stewardship = computeStewardshipRows(from, to);
    const consult = computeConsultRows(from, to);
    const svc = computeServiceEntryRows(from, to);
    const breadth = computeBreadthRows(from, to);
    const mix = computeActivityMixRows(from, to);
    const funnel = computeFunnelRows(from, to);
    const labConsultsOn = getLabConsultsEnabled();

    return `
    <div class="card mb-16">
      <div class="filter-bar">
        <div class="field"><label>From</label><input type="date" class="input" id="rep-from" value="${esc(from)}" /></div>
        <div class="field"><label>To</label><input type="date" class="input" id="rep-to" value="${esc(to)}" /></div>
        <button class="btn btn-secondary btn-sm" data-act="rep-preset" data-range="month">This Month</button>
        <button class="btn btn-secondary btn-sm" data-act="rep-preset" data-range="year">This Year</button>
        <button class="btn btn-secondary btn-sm" data-act="rep-preset" data-range="all">All Time</button>
        <div class="grow"></div>
        <button class="btn btn-secondary" data-act="rep-custom">${ic('filter')} Custom Report</button>
        <button class="btn btn-primary" data-act="export-reports-xlsx">${ic('file')} Export XLSX</button>
      </div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('cpu')} Instrument Utilization</span></div></div>
      ${!instr.rows.length ? global.Views.emptyState('cpu', 'No bookings in this range', 'Widen the date range or add instrument bookings.') : `
      <div class="mb-16">${chartUtilization(instr.rows)}</div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Instrument</th><th>Bookings</th><th>Booked Hours</th><th>Line Charges</th><th>Share of Total Hours</th></tr></thead>
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
      <div class="faint small mt-8">Bookings and hours exclude cancelled bookings entirely (a cancelled booking releases its slot). Line Charges follows the same cancellation rule used everywhere else in the app: a cancelled booking's charge still counts only if it was retained rather than waived. It's the raw instrument-charge line for each booking, though — before that booking's group/manual discount, overhead, and tax are applied — so it will not match a project's Total Cost on the Projects &amp; Groups card, which is after all three.</div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('users')} Facility Staff Time</span></div></div>
      ${!staff.rows.length ? global.Views.emptyState('users', 'No staff time in this range', 'Widen the date range or assign facility staff to bookings.') : `
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Staff Member</th><th>Sessions</th><th>Raw Hours</th><th>Billed Hours</th><th>Line Charges</th></tr></thead>
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
      <div class="faint small mt-8">Raw hours are the actual time booked (a blank per-staff window on a booking means "the whole booking window", not zero). Billed hours apply the same 1-hour floor / round-up-to-the-hour rule as the booking cost calculator, which is why they can be higher than raw hours. Line Charges is the raw staff-time line for each booking, before that booking's overhead or tax is applied — it will not match a project's Total Cost on the Projects &amp; Groups card.</div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('layers')} Staff × Instrument</span></div></div>
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
      <div class="faint small mt-8">Sessions count bookings unsplit — the number that actually answers "which instruments do I spend my time on". Attributed hours divide that booking's staff hours evenly across every instrument on it, purely so the column sums back to the person's true total in the Facility staff time card above; the underlying sample runs were mostly parallel, so this split is a bookkeeping convenience, not a claim about which instrument the time "really" belongs to. A booking with no instrument line (a pure consult/sync) still has real staff hours, so those are grouped under a "No Instrument" column — without it, that time would be missing from this table even though it counts on the Facility staff time card.</div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('folder')} Projects &amp; Groups</span></div></div>
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
      <div class="faint small mt-8">Bookings/hours exclude cancelled bookings; Total Cost follows the same retained-charge rule as the cards above. A booking with no project is grouped as "Facility-wide"; a booking with no lab/group on file is omitted from the By Lab/Group table.</div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('target')} Instrument Stewardship</span></div></div>
      ${!stewardship.groups.length ? global.Views.emptyState('target', 'No bookings in this range', 'Widen the date range or add instrument bookings.') : stewardship.groups.map((g) => `
        <div class="mb-16">
          <div class="faint small mb-8" style="font-weight:600;text-transform:uppercase;letter-spacing:.05em">${g.supervisor ? 'Supervisor: ' + nameCell(g.supervisor.name, g.supervisor.retired) : 'Unassigned (no supervisor on file)'}</div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Instrument</th><th>Bookings</th><th>Hours</th><th>Line Charges</th><th>Distinct Users</th><th>New Users</th><th>Projects Served</th><th>Facility-Wide Sessions</th><th>Consults</th></tr></thead>
              <tbody>
                ${g.rows.map((r) => `
                  <tr class="${r.retired ? 'row-retired' : ''}">
                    <td style="font-weight:600">${nameCell(r.name, r.retired)}</td>
                    <td class="mono small">${r.bookings}</td>
                    <td class="mono small">${fmtHours(r.hours)}</td>
                    <td class="mono small">${fmtMoney(r.revenue)}</td>
                    <td class="mono small">${r.distinctUsers}</td>
                    <td class="mono small">${r.newUsers}</td>
                    <td class="mono small">${r.projectsServed}</td>
                    <td class="mono small">${r.facilityWideSessions}</td>
                    <td class="mono small">${r.consultCount}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`).join('')}
      <div class="faint small mt-8">Grouped by supervising staff (Instruments → supervisor mapping); an instrument with more than one supervisor appears under each of them — this is a grouping for review, not a partition of ownership, and these per-instrument figures are deliberately not summed into a per-person score. "New Users" counts people whose first-ever non-cancelled booking on that instrument (checked across its whole history, not just this range) falls inside the selected dates. Bookings/hours/users exclude cancelled bookings; Line Charges follows the retained-charge rule used everywhere else. Omitted on purpose (need Tier 4 data this app doesn't have yet): trained-user pool trend and downtime share.</div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('tag')} Consults</span></div><span class="faint small mono">${consult.totalConsults} total</span></div>
      <div class="grid cols-2">
        <div>
          <div class="faint small mb-8" style="font-weight:600;text-transform:uppercase;letter-spacing:.05em">By Instrument</div>
          ${!consult.instrumentRows.length ? global.Views.emptyState('cpu', 'No consults in this range', 'Tag a booking\'s Category as "consult" for it to show up here.') : `
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Instrument</th><th>Consults</th></tr></thead>
              <tbody>
                ${consult.instrumentRows.map((r) => `
                  <tr class="${r.retired ? 'row-retired' : ''}">
                    <td style="font-weight:600">${nameCell(r.name, r.retired)}</td>
                    <td class="mono small">${r.count}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
        </div>
        <div>
          <div class="faint small mb-8" style="font-weight:600;text-transform:uppercase;letter-spacing:.05em">By Period</div>
          ${!consult.periodRows.length ? global.Views.emptyState('calendar', 'No consults in this range', '') : `
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Month</th><th>Consults</th></tr></thead>
              <tbody>
                ${consult.periodRows.map((r) => `
                  <tr>
                    <td style="font-weight:600">${esc(r.period)}</td>
                    <td class="mono small">${r.count}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
        </div>
      </div>
      <div class="faint small mt-8">Counts bookings tagged Category = "consult", excluding cancelled bookings (a cancelled consult never happened). A consult with no instrument assigned counts toward the period total but has nothing to attribute an instrument row to.</div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('tag')} Service Entries</span></div>
        <span class="mono font-medium">${fmtMoney(svc.totalRevenue)} total</span>
        <button class="btn btn-primary btn-sm" data-act="add-service-entry" title="Log standalone billable work outside any booking">${ic('plus')} Service Entry</button>
      </div>
      ${!svc.rows.length ? global.Views.emptyState('tag', 'No service entries in this range', 'Log standalone billable work — technician time, sample prep, per-unit items — outside any booking.') : `
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Description</th><th>Project</th><th>Staff</th><th>Instrument</th><th>Date</th><th style="text-align:right">Qty</th><th>Unit</th><th style="text-align:right">Total</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            ${svc.rows.map((r) => {
              const waived = r.is_cancelled && !r.billing_retained;
              return `
              <tr class="${r.is_cancelled ? 'row-retired' : ''}">
                <td class="font-medium small">${esc(r.description)}${r.is_cancelled ? ` <span class="badge neutral" data-tooltip="${waived ? 'Cancelled — charge dropped' : 'Cancelled — charge stands'}">Cancelled${waived ? '' : ' · charged'}</span>` : ''}</td>
                <td class="small">${r.project_id == null ? 'Facility-wide' : esc(r.project_code ? r.project_code + ' — ' + r.project_title : r.project_title)}</td>
                <td class="small">${r.person_name ? nameCell(r.person_name, r.person_retired) : '<span class="faint">—</span>'}</td>
                <td class="small">${r.instrument_name ? nameCell(r.instrument_name, r.instrument_retired) : '<span class="faint">—</span>'}</td>
                <td class="mono small faint">${esc(r.date || '—')}</td>
                <td class="mono small" style="text-align:right">${r.qty || 0}</td>
                <td class="small">${esc(r.unit || '—')}</td>
                <td class="mono small" style="text-align:right">${fmtMoney(r.countedCost)}</td>
                <td style="text-align:right">
                  <button class="btn btn-ghost btn-xs" data-act="edit-service-entry" data-id="${r.id}" title="Edit Entry">${ic('edit')}</button>
                  ${r.is_cancelled
                    ? `<button class="btn btn-ghost btn-xs" data-act="se-reinstate" data-id="${r.id}" title="Reinstate">${ic('rocket')}</button>`
                    : `<button class="btn btn-ghost btn-xs" data-act="se-cancel" data-id="${r.id}" title="Cancel Entry">${ic('archive')}</button>`}
                </td>
              </tr>`; }).join('')}
          </tbody>
        </table>
      </div>`}
      <div class="faint small mt-8">Standalone billable work logged outside any booking — technician time, sample prep, per-unit items. Follows the same money rule as bookings: a cancelled entry's charge counts only if it was retained rather than waived; there is no occupancy rule since an entry never held a schedule slot.</div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('users')} Breadth</span></div></div>
      <div class="grid cols-2">
        <div>
          <div class="faint small mb-8" style="font-weight:600;text-transform:uppercase;letter-spacing:.05em">By Period</div>
          ${!breadth.periodRows.length ? global.Views.emptyState('calendar', 'No bookings in this range', '') : `
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Month</th><th>Distinct Labs</th><th>Distinct People</th><th>New Labs</th></tr></thead>
              <tbody>
                ${breadth.periodRows.map((r) => `
                  <tr>
                    <td style="font-weight:600">${esc(r.period)}</td>
                    <td class="mono small">${r.distinctLabs}</td>
                    <td class="mono small">${r.distinctPeople}</td>
                    <td class="mono small">${r.newLabs}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
        </div>
        <div>
          <div class="faint small mb-8" style="font-weight:600;text-transform:uppercase;letter-spacing:.05em">By Instrument</div>
          ${!breadth.instrumentRows.length ? global.Views.emptyState('cpu', 'No bookings in this range', '') : `
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Instrument</th><th>Distinct Labs</th><th>Distinct People</th></tr></thead>
              <tbody>
                ${breadth.instrumentRows.map((r) => `
                  <tr class="${r.retired ? 'row-retired' : ''}">
                    <td style="font-weight:600">${nameCell(r.name, r.retired)}</td>
                    <td class="mono small">${r.distinctLabs}</td>
                    <td class="mono small">${r.distinctPeople}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
        </div>
      </div>
      <label class="row mt-16" style="gap:8px;align-items:center;cursor:pointer">
        <input type="checkbox" data-act="rep-toggle-lab-consults" ${labConsultsOn ? 'checked' : ''} />
        <span class="small">Show per-lab consult attribution (opt-in)</span>
      </label>
      ${labConsultsOn ? `
      <div class="mt-8">
        ${!breadth.consultLabRows.length ? global.Views.emptyState('tag', 'No consults with a lab on file in this range', '') : `
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Lab / Group</th><th>Consults</th></tr></thead>
            <tbody>
              ${breadth.consultLabRows.map((r) => `
                <tr>
                  <td style="font-weight:600">${esc(r.lab)}</td>
                  <td class="mono small">${r.count}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>` : ''}
      <div class="faint small mt-8">Distinct labs/people and new-lab onboarding exclude cancelled bookings entirely (a cancelled booking never served anyone); a booking with no lab/group on file is omitted from lab counts. "New Labs" counts labs whose first-ever non-cancelled booking (checked across the facility's whole history, not just this range) falls inside the selected dates. Per-lab consult attribution is off by default — it stays a deliberate opt-in, not a standing report column, per the facility's per-person/per-lab tracking policy.</div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('layers')} Activity Mix</span></div></div>
      ${!mix.periods.length ? global.Views.emptyState('layers', 'No bookings in this range', '') : `
      <div class="mb-16">${chartActivityMix(mix)}</div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Month</th>${mix.categories.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>
            ${mix.rows.map((r) => `
              <tr>
                <td style="font-weight:600">${esc(r.period)}</td>
                ${mix.categories.map((c) => `<td class="mono small">${fmtHours(r.hours[c])}</td>`).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
      <div class="faint small mt-8">Hours booked per category per month, excluding cancelled bookings; a booking with no category on file is grouped under "(uncategorized)". Category values are read from the data (not a fixed list), so a facility-added category appears here automatically. Standalone service entries are not included — they're logged in units/quantity, not hours, so there's nothing to attribute here.</div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('target')} Funnel: Consult to Output</span></div></div>
      ${!funnel.stages.some((s) => s.count > 0) ? global.Views.emptyState('target', 'No funnel activity in this range', 'Widen the date range or add consults, projects, bookings, milestones and outputs.') : `
      <div class="mb-16">${chartFunnel(funnel.stages)}</div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Stage</th><th>Count</th><th>Conversion From Previous</th></tr></thead>
          <tbody>
            ${funnel.stages.map((s) => `
              <tr>
                <td style="font-weight:600">${esc(s.label)}</td>
                <td class="mono small">${s.count}</td>
                <td class="mono small">${s.conversionPct == null ? '—' : s.conversionPct.toFixed(1) + '%'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="grid cols-2 mt-16">
        <div class="faint small">
          <strong>Median, created &rarr; first booking:</strong>
          ${funnel.medians.createdToActive.days == null ? 'no data' : funnel.medians.createdToActive.days + ' day' + (funnel.medians.createdToActive.days === 1 ? '' : 's') + ` (n=${funnel.medians.createdToActive.sampleSize})`}
          ${funnel.medians.createdToActive.excludedNegative ? `<br/>${funnel.medians.createdToActive.excludedNegative} project${funnel.medians.createdToActive.excludedNegative === 1 ? '' : 's'} excluded: first booking predates the project record.` : ''}
        </div>
        <div class="faint small">
          <strong>Median, first booking &rarr; first output:</strong>
          ${funnel.medians.activeToOutput.days == null ? 'no data' : funnel.medians.activeToOutput.days + ' day' + (funnel.medians.activeToOutput.days === 1 ? '' : 's') + ` (n=${funnel.medians.activeToOutput.sampleSize})`}
          ${funnel.medians.activeToOutput.excludedNegative ? `<br/>${funnel.medians.activeToOutput.excludedNegative} project${funnel.medians.activeToOutput.excludedNegative === 1 ? '' : 's'} excluded: first output predates the first booking.` : ''}
        </div>
      </div>`}
      <div class="faint small mt-8">Stages count different things (consult/output are events, milestones are edits, the rest are projects) — read this as facility activity over the period, not one population literally narrowing. Consult volume includes facility-wide (project-less) consults, which cannot feed any later stage. "Completed" is count-only via status='Completed' or archived, dated by end_date (or archive date) when set — otherwise it has no date to place in a bounded range and${funnel.completedNoDateCount ? ` is excluded here (${funnel.completedNoDateCount} completed project${funnel.completedNoDateCount === 1 ? '' : 's'} with no end/archive date).` : ' none are excluded in this range.'} "Milestones Progressing" counts any milestone edited in the period, not a status change specifically. Both medians exclude (but disclose) projects where the later event predates the earlier one — real for backfilled/imported data.</div>
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
    computeProjectRows,
    computeStewardshipRows,
    computeConsultRows,
    computeServiceEntryRows,
    computeBreadthRows,
    computeActivityMixRows,
    computeFunnelRows,
    computeBookingRows,
    getLabConsultsEnabled,
    setLabConsultsEnabled,
    // Custom report generator (roadmap 3.6)
    getCustomReportEntities,
    getCustomReportColumns,
    getCustomReportNotes,
    getCustomReportLabel,
    computeCustomRows,
    formatCustomCellDisplay,
    formatCustomCellXlsx
  };

})(window);
