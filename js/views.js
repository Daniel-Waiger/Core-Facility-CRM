/* views.js — all screens */
(function (global) {
  'use strict';
  const C = global.CONST;
  const esc = global.UI.esc;
  const ic = global.UI.icon;
  const fmt = global.UI.fmtDate;
  const today = global.UI.today;

  /* ---------------- Dashboard ---------------- */
  function dashboard() {
    const now = new Date().toISOString().slice(0, 10);
    const counts = {};
    for (const s of C.STATUS) counts[s] = 0;
    const rows = global.DB.q('SELECT status, COUNT(*) FROM projects GROUP BY status');
    for (const [st, n] of rows) counts[st] = n;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const active = counts['Active'] || 0;

    const win = new Date(); win.setDate(win.getDate() + 30);
    const winStr = win.toISOString().slice(0, 10);
    const upcoming = global.DB.q(`
      SELECT m.name, m.due_date, m.status, p.title
      FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE m.due_date IS NOT NULL AND m.due_date <= ? AND m.status != 'done'
      ORDER BY m.due_date ASC LIMIT 8`, [winStr]);
    const overdue = global.DB.q(`
      SELECT m.name, m.due_date, p.title
      FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE m.due_date < ? AND m.status != 'done'
      ORDER BY m.due_date ASC`, [now]);

    return `
    <div class="grid cols-4">
      <div class="card stat"><span class="n">${total}</span><span class="l">Total projects</span></div>
      <div class="card stat"><span class="n">${active}</span><span class="l">Active</span></div>
      <div class="card stat"><span class="n">${overdue.length}</span><span class="l">Overdue milestones</span></div>
      <div class="card stat"><span class="n">${counts['Completed'] || 0}</span><span class="l">Completed</span></div>
    </div>
    <div class="grid cols-2">
      <div class="card">
        <div class="card-title">${ic('target')} Upcoming milestones</div>
        <div class="card-body">
          ${upcoming.length ? upcoming.map((r) => `
            <div class="row" style="padding:8px 0;border-bottom:1px solid var(--border)">
              <span class="grow" style="font-weight:500">${esc(r[0])}</span>
              <span class="faint small">${esc(r[3])}</span>
              <span class="badge ${r[2] === 'in-progress' ? 'primary' : 'neutral'}">${r[2]}</span>
              <span class="mono small">${fmt(r[1])}</span>
            </div>`).join('') : `<div class="empty"><div class="ic">${ic('calendar')}</div><div class="t">Nothing due</div><div class="s">No milestones in the next 30 days.</div></div>`}
        </div>
      </div>
      <div class="card">
        <div class="card-title">${ic('alert')} Overdue</div>
        <div class="card-body">
          ${overdue.length ? overdue.map((r) => `
            <div class="row" style="padding:8px 0;border-bottom:1px solid var(--border)">
              <span class="grow" style="font-weight:500">${esc(r[0])}</span>
              <span class="faint small">${esc(r[1])}</span>
              <span class="badge danger">overdue</span>
            </div>`).join('') : `<div class="empty"><div class="ic">${ic('check')}</div><div class="t">All clear</div><div class="s">No overdue milestones.</div></div>`}
        </div>
      </div>
    </div>`;
  }

  /* ---------------- Projects list ---------------- */
  function projects() {
    const rows = global.DB.q(`
      SELECT p.id, p.title, p.status, p.priority, p.pi_id, p.start_date, p.end_date,
             (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id),
             (SELECT COALESCE(SUM(CASE WHEN m.status='done' THEN 1 ELSE 0 END),0) FROM milestones m WHERE m.project_id = p.id)
      FROM projects p ORDER BY p.updated_at DESC`);
    const piNames = global.DB.q('SELECT id, name FROM people');
    const piMap = Object.fromEntries(piNames.map((r) => [r[0], r[1]]));
    if (!rows.length) return emptyState('folder', 'No projects yet', 'Create your first project to start tracking.');
    return `
    <div class="card">
      <table class="tbl">
        <thead><tr><th>Title</th><th>Status</th><th>Priority</th><th>PI</th><th>Progress</th><th>Start</th><th>End</th><th></th></tr></thead>
        <tbody>
          ${rows.map((r) => {
            const [id, title, status, priority, piId, start, end, total, done] = r;
            const pct = total ? Math.round((done / total) * 100) : 0;
            return `<tr class="row-link" data-goto="project" data-id="${id}">
              <td><span style="font-weight:600">${esc(title)}</span></td>
              <td>${statusBadge(status)}</td>
              <td><span class="badge neutral">${esc(priority)}</span></td>
              <td class="muted small">${esc(piMap[piId] || '—')}</td>
              <td><div class="row"><div class="progress seg" style="width:90px"><i style="width:${pct}%"></i></div><span class="faint small">${pct}%</span></div></td>
              <td class="mono small">${fmt(start)}</td>
              <td class="mono small">${fmt(end)}</td>
              <td class="faint">${ic('chevron')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }

  function statusBadge(s) {
    const map = { 'Initiated': 'neutral', 'Active': 'primary', 'On-hold': 'warning', 'Completed': 'success', 'Archived': 'neutral' };
    return `<span class="badge ${map[s] || 'neutral'}">${esc(s)}</span>`;
  }

  /* ---------------- Project detail ---------------- */
  function projectDetail(id) {
    const p = global.DB.q1('SELECT * FROM projects WHERE id=?', [id]);
    if (!p) return `<div class="empty"><div class="t">Project not found</div></div>`;
    const [pid, title, code, status, priority, funding, modality, tags, piId, start, end, notes, createdAt, updatedAt] = p;

    const ppl = global.DB.q(`
      SELECT pp.role, pe.id, pe.name, pe.type FROM project_people pp
      JOIN people pe ON pe.id = pp.person_id
      WHERE pp.project_id=?`, [id]);
    const inst = global.DB.q(`
      SELECT pi.instrument_id, i.name, i.kind, i.status FROM project_instruments pi
      JOIN instruments i ON i.id = pi.instrument_id
      WHERE pi.project_id=?`, [id]);
    const ms = global.DB.q('SELECT * FROM milestones WHERE project_id=? ORDER BY rowid', [id]);
    const kv = global.DB.q('SELECT * FROM kv WHERE project_id=? ORDER BY rowid', [id]);
    const mtgs = global.DB.q('SELECT * FROM meetings WHERE project_id=? ORDER BY date DESC', [id]);
    const files = global.DB.q('SELECT * FROM files WHERE project_id=? ORDER BY created_at DESC', [id]);
    const prog = global.DB.projectProgress(pid);

    return `
    <div class="row mb-8" style="align-items:flex-start">
      <div class="grow">
        <div class="row"><span class="t" style="font-size:20px;font-weight:700">${esc(title)}</span> ${statusBadge(status)}</div>
        <div class="faint small mt-8">Code ${esc(code)} · created ${fmt(createdAt)}</div>
      </div>
      <div class="row">
        <button class="btn btn-secondary btn-sm" data-act="export-xlsx">XLSX</button>
        <button class="btn btn-secondary btn-sm" data-act="export-docx">DOCX</button>
        <button class="btn btn-secondary btn-sm" data-act="export-pdf">PDF</button>
        <button class="btn btn-danger btn-sm" data-act="delete-project">Delete</button>
      </div>
    </div>

    <div class="card">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('target')} Progress</span></div>
        <span class="faint small">${prog.done}/${prog.total} milestones</span>
      </div>
      <div class="progress seg"><i style="width:${prog.pct}%"></i></div>
      <div class="row mt-8">
        <span class="mono small">${prog.pct}%</span>
        <span class="faint small">computed from milestones</span>
      </div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <div class="card-title">${ic('folder')} Details</div>
        <div class="card-body">
          <div class="kv">
            ${kv.map((r) => `<div class="kv-row"><span class="k">${esc(r[1])}</span><span class="v">${esc(r[2])}</span><span class="del" data-act="kv-del" data-id="${r[0]}">${ic('x')}</span></div>`).join('')}
          </div>
          <div class="row mt-8">
            <button class="btn btn-ghost btn-sm" data-act="kv-add">${ic('plus')} Add field</button>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">${ic('users')} Team</div>
        <div class="card-body">
          ${ppl.length ? ppl.map((r) => `<div class="person-card"><div class="avatar">${esc(r[2][0] || '?')}</div><div class="grow"><div style="font-weight:500">${esc(r[2])}</div><div class="faint small">${esc(r[3])}${r[0] ? ' · ' + esc(r[0]) : ''}</div></div></div>`).join('') : `<div class="empty"><div class="t">No team</div><div class="s">Add people to this project.</div></div>`}
          <div class="row mt-8"><button class="btn btn-ghost btn-sm" data-act="add-person">${ic('plus')} Add person</button></div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('cpu')} Instruments</span></div>
        <button class="btn btn-ghost btn-sm" data-act="add-instrument">${ic('plus')} Add</button>
      </div>
      <div class="card-body">
        ${inst.length ? inst.map((r) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="grow" style="font-weight:500">${esc(r[1])}</span><span class="faint small">${esc(r[2] || '')}</span><span class="badge neutral">${esc(r[3])}</span></div>`).join('') : `<div class="empty"><div class="t">No instruments</div><div class="s">Link the instruments this project uses.</div></div>`}
      </div>
    </div>

    <div class="card">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('target')} Milestones</span></div>
        <button class="btn btn-primary btn-sm" data-act="add-milestone">${ic('plus')} Add milestone</button>
      </div>
      <div class="card-body">
        ${ms.length ? ms.map((r) => milestoneRow(r, id)).join('') : `<div class="empty"><div class="t">No milestones</div><div class="s">Add the first milestone to start tracking progress.</div></div>`}
      </div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <div class="row mb-8"><div class="grow"><span class="card-title">${ic('file')} Files</span></div><button class="btn btn-ghost btn-sm" data-act="add-file">${ic('plus')} Add</button></div>
        <div class="card-body">
          ${files.length ? files.map((r) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="faint">${ic('file')}</span><span class="grow" style="font-weight:500">${esc(r[2])}</span><span class="faint small">${esc(r[3])}</span></div>`).join('') : `<div class="empty"><div class="t">No files</div><div class="s">Upload or link files.</div></div>`}
        </div>
      </div>
      <div class="card">
        <div class="row mb-8"><div class="grow"><span class="card-title">${ic('calendar')} Meetings</span></div><button class="btn btn-ghost btn-sm" data-act="add-meeting">${ic('plus')} Add</button></div>
        <div class="card-body">
          ${mtgs.length ? mtgs.map((r) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><div class="row"><span style="font-weight:500">${esc(r[2])}</span><span class="faint small">${fmt(r[3])}</span></div><div class="small muted mt-8">${esc(r[5] || '')}</div></div>`).join('') : `<div class="empty"><div class="t">No meetings</div><div class="s">Add meeting notes.</div></div>`}
        </div>
      </div>
    </div>`;
  }

  function milestoneRow(r, pid) {
    const [mid, projectId, name, due, status, note, ca, ua] = r;
    const now = today();
    const isOverdue = due && due < now && status !== 'done';
    return `
    <div class="ms" data-ms-id="${mid}">
      <div class="rail">
        <div class="node ${status === 'done' ? 'done' : isOverdue ? 'overdue' : ''}"></div>
        <div class="line"></div>
      </div>
      <div class="body">
        <div class="row">
          <span class="ttl">${esc(name)}</span>
          <span class="grow"></span>
          <span class="badge ${status === 'done' ? 'success' : status === 'in-progress' ? 'primary' : 'neutral'}">${status}</span>
          ${isOverdue ? '<span class="badge danger">overdue</span>' : ''}
          <button class="btn btn-ghost btn-sm" data-act="ms-del" data-id="${mid}">${ic('trash')}</button>
        </div>
        <div class="meta mt-8">
          <span class="mono">${fmt(due)}</span>
          ${note ? ' · ' + esc(note) : ''}
        </div>
      </div>
    </div>`;
  }

  /* ---------------- People ---------------- */
  function people() {
    const rows = global.DB.q('SELECT * FROM people ORDER BY type, name');
    if (!rows.length) return emptyState('users', 'No people yet', 'Add PIs, lab members, and technicians.');
    return `
    <div class="card">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('users')} People</span></div><button class="btn btn-primary btn-sm" data-act="add-person">${ic('plus')} Add</button></div>
      <table class="tbl"><thead><tr><th>Name</th><th>Type</th><th>Email</th><th>Projects</th></tr></thead><tbody>
        ${rows.map((r) => {
          const [id, name, type, email, note] = r;
          const pids = global.DB.q('SELECT COUNT(*) FROM project_people WHERE person_id=?', [id]);
          return `<tr><td style="font-weight:500">${esc(name)}</td><td><span class="badge neutral">${esc(type)}</span></td><td class="muted small">${esc(email || '—')}</td><td class="faint small">${pids[0][0]} projects</td></tr>`;
        }).join('')}
      </tbody></table>
    </div>`;
  }

  /* ---------------- Instruments ---------------- */
  function instruments() {
    const rows = global.DB.q('SELECT * FROM instruments ORDER BY name');
    if (!rows.length) return emptyState('cpu', 'No instruments yet', 'Add the instruments in your facility.');
    return `
    <div class="card">
      <div class="row mb-8"><div class="grow"><span class="card-title">${ic('cpu')} Instruments</span></div><button class="btn btn-primary btn-sm" data-act="add-instrument">${ic('plus')} Add</button></div>
      <table class="tbl"><thead><tr><th>Name</th><th>Type</th><th>Status</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td style="font-weight:500">${esc(r[1])}</td><td class="muted small">${esc(r[2] || '—')}</td><td><span class="badge neutral">${esc(r[3])}</span></td></tr>`).join('')}
      </tbody></table>
    </div>`;
  }

  /* ---------------- Calendar ---------------- */
  let calOffset = 0;
  function navCalendar(delta) { calOffset += delta; global.App.refresh(); }
  function calendar() {
    const base = new Date();
    const shifted = new Date(base.getFullYear(), base.getMonth() + calOffset, 1);
    const sy = shifted.getFullYear(), sm = shifted.getMonth();
    const monthLabel = shifted.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const start = new Date(sy, sm, 1);
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    const endStr = new Date(sy, sm + 1, 0).toISOString().slice(0, 10);
    const startStr = start.toISOString().slice(0, 10);

    const ms = global.DB.q(`
      SELECT m.due_date, m.name, m.status, p.title FROM milestones m
      JOIN projects p ON p.id = m.project_id
      WHERE m.due_date >= ? AND m.due_date <= ? AND m.status != 'done'`, [startStr, endStr]);
    const mtgs = global.DB.q(`
      SELECT m.date, m.title, p.title FROM meetings m
      JOIN projects p ON p.id = m.project_id
      WHERE m.date >= ? AND m.date <= ?`, [startStr, endStr]);
    const byDay = {};
    for (const [d, name, st, ptitle] of ms) (byDay[d] = byDay[d] || []).push({ name, kind: 'ms', st });
    for (const [d, title] of mtgs) (byDay[d] = byDay[d] || []).push({ name: title, kind: 'mt' });

    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let cells = dow.map((d) => `<div class="dow">${d}</div>`).join('');
    const cur = new Date(start);
    while (cur.getMonth() === sm) {
      const ds = cur.toISOString().slice(0, 10);
      const isToday = ds === today();
      const evs = byDay[ds] || [];
      cells += `<div class="cal-cell ${isToday ? 'today' : ''}"><div class="num">${cur.getDate()}</div>${evs.map((e) => `<div class="ev ${e.kind === 'mt' ? 'mt' : ''}" title="${esc(e.name)}">${esc(e.name)}</div>`).join('')}</div>`;
      cur.setDate(cur.getDate() + 1);
    }

    return `
    <div class="card">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('calendar')} ${monthLabel}</span></div>
        <div class="row">
          <button class="btn btn-secondary btn-sm" data-act="cal-prev">${ic('chevron')} Prev</button>
          <button class="btn btn-secondary btn-sm" data-act="cal-next">Next ${ic('chevron')}</button>
        </div>
      </div>
      <div class="cal-grid">${cells}</div>
    </div>`;
  }

  /* ---------------- Settings ---------------- */
  function settings() {
    return `
    <div class="card">
      <div class="card-title">${ic('settings')} Settings</div>
      <div class="card-body">
        <div class="row mb-8">
          <div class="grow"><span class="muted">Theme</span></div>
          <div class="theme-toggle" data-act="theme-toggle"><div class="knob"></div></div>
        </div>
        <div class="divider"></div>
        <div class="row mb-8">
          <div class="grow">
            <div style="font-weight:600">Backup &amp; restore</div>
            <div class="faint small">Your data lives in a single SQLite file. Export it to a file to back up or move machines; load a backup to recover.</div>
          </div>
        </div>
        <div class="row">
          <button class="btn btn-secondary btn-sm" data-act="backup">Export backup</button>
          <button class="btn btn-secondary btn-sm" data-act="restore">Load backup</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">${ic('folder')} About</div>
      <div class="card-body">
        <div class="faint small">
          <p class="mt-0 mb-8">Core Facility Project Tracker — v1 pilot.</p>
          <p class="mb-8">Data: single SQLite file (sql.js, in-browser) + IndexedDB.</p>
          <p class="mb-0">Stack: vanilla JS, sql.js, SheetJS, docx, jsPDF.</p>
        </div>
      </div>
    </div>`;
  }

  /* ---------------- Empty state ---------------- */
  function emptyState(icName, t, s) {
    return `<div class="empty"><div class="ic">${ic(icName)}</div><div class="t">${esc(t)}</div><div class="s">${esc(s)}</div></div>`;
  }

  global.Views = { dashboard, projects, projectDetail, people, instruments, calendar, settings, emptyState, navCalendar };

})(window);
