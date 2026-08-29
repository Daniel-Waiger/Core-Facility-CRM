/* views.js — all screens & renderers */
(function (global) {
  'use strict';
  const C = global.CONST;
  const esc = global.UI.esc;
  const ic = global.UI.icon;
  const fmt = global.UI.fmtDate;
  const today = global.UI.today;

  /* ---------------- Dashboard ---------------- */
  function dashboard() {
    const now = today();
    const counts = {};
    for (const s of C.STATUS) counts[s] = 0;
    const stRows = global.DB.rows('SELECT status, COUNT(*) as n FROM projects GROUP BY status');
    for (const r of stRows) counts[r.status] = r.n;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const active = counts['Active'] || 0;

    const win = new Date(); win.setDate(win.getDate() + 30);
    const winStr = win.toISOString().slice(0, 10);
    const upcoming = global.DB.rows(`
      SELECT m.id, m.name, m.due_date, m.status, p.id as project_id, p.title as project_title
      FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE m.due_date IS NOT NULL AND m.due_date <= ? AND m.status != 'done'
      ORDER BY m.due_date ASC LIMIT 10`, [winStr]);

    const overdue = global.DB.rows(`
      SELECT m.id, m.name, m.due_date, m.status, p.id as project_id, p.title as project_title
      FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE m.due_date IS NOT NULL AND m.due_date < ? AND m.status != 'done'
      ORDER BY m.due_date ASC LIMIT 10`, [now]);

    return `
    <div class="grid cols-4 mb-16">
      <div class="card stat"><span class="n">${total}</span><span class="l">Total projects</span></div>
      <div class="card stat"><span class="n" style="color:var(--primary)">${active}</span><span class="l">Active</span></div>
      <div class="card stat"><span class="n" style="color:var(--danger)">${overdue.length}</span><span class="l">Overdue milestones</span></div>
      <div class="card stat"><span class="n" style="color:var(--success)">${counts['Completed'] || 0}</span><span class="l">Completed</span></div>
    </div>
    <div class="grid cols-2">
      <div class="card">
        <div class="card-title">${ic('target')} Upcoming milestones (Next 30 days)</div>
        <div class="card-body">
          ${upcoming.length ? upcoming.map((m) => `
            <div class="row milestone-quick-row">
              <span class="grow font-medium row-link" data-goto="project" data-id="${m.project_id}">${esc(m.name)}</span>
              <span class="faint small row-link" data-goto="project" data-id="${m.project_id}">${esc(m.project_title)}</span>
              <span class="badge ${m.status === 'in-progress' ? 'primary' : 'neutral'} clickable" data-act="toggle-ms-status" data-id="${m.id}" title="Click to cycle status">${m.status}</span>
              <span class="mono small">${fmt(m.due_date)}</span>
            </div>`).join('') : emptyState('calendar', 'Nothing due soon', 'No pending milestones in the next 30 days.')}
        </div>
      </div>
      <div class="card">
        <div class="card-title" style="color:var(--danger)">${ic('alert')} Overdue milestones</div>
        <div class="card-body">
          ${overdue.length ? overdue.map((m) => `
            <div class="row milestone-quick-row">
              <span class="grow font-medium row-link" data-goto="project" data-id="${m.project_id}">${esc(m.name)}</span>
              <span class="faint small row-link" data-goto="project" data-id="${m.project_id}">${esc(m.project_title)}</span>
              <span class="badge danger clickable" data-act="toggle-ms-status" data-id="${m.id}" title="Click to mark done">overdue</span>
              <span class="mono small" style="color:var(--danger)">${fmt(m.due_date)}</span>
            </div>`).join('') : emptyState('check', 'All clear', 'No overdue milestones across any active project.')}
        </div>
      </div>
    </div>`;
  }

  /* ---------------- Projects list ---------------- */
  let projectFilter = { query: '', status: '', priority: '', modality: '' };
  function setProjectFilter(f) {
    projectFilter = Object.assign(projectFilter, f);
    global.App.refresh();
  }

  function projects() {
    const allProjects = global.DB.rows(`
      SELECT p.*,
             (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id) as ms_total,
             (SELECT COALESCE(SUM(CASE WHEN m.status='done' THEN 1 ELSE 0 END),0) FROM milestones m WHERE m.project_id = p.id) as ms_done,
             pe.name as pi_name
      FROM projects p
      LEFT JOIN people pe ON pe.id = p.pi_id
      ORDER BY p.updated_at DESC`);

    // Apply client-side filters
    const qLower = (projectFilter.query || '').trim().toLowerCase();
    const rows = allProjects.filter((p) => {
      if (projectFilter.status && p.status !== projectFilter.status) return false;
      if (projectFilter.priority && p.priority !== projectFilter.priority) return false;
      if (projectFilter.modality && !(p.modality || '').includes(projectFilter.modality)) return false;
      if (qLower) {
        const textToSearch = `${p.title} ${p.code} ${p.pi_name || ''} ${p.funding || ''} ${p.modality || ''} ${p.sample || ''} ${p.tags || ''} ${p.notes || ''}`.toLowerCase();
        if (!textToSearch.includes(qLower)) return false;
      }
      return true;
    });

    return `
    <div class="card mb-16">
      <div class="filter-bar">
        <div class="search-input-wrap grow">
          <span class="search-icon">${ic('search')}</span>
          <input type="text" class="input search-input" id="proj-search" placeholder="Search by title, code, PI, tags, modality, funding..." value="${esc(projectFilter.query)}" />
        </div>
        <select class="input select-filter" id="proj-status-filter" style="width:140px">
          <option value="">All Statuses</option>
          ${C.STATUS.map((s) => `<option value="${s}" ${projectFilter.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <select class="input select-filter" id="proj-priority-filter" style="width:130px">
          <option value="">All Priorities</option>
          ${C.PRIORITY.map((pr) => `<option value="${pr}" ${projectFilter.priority === pr ? 'selected' : ''}>${pr}</option>`).join('')}
        </select>
        <select class="input select-filter" id="proj-modality-filter" style="width:140px">
          <option value="">All Modalities</option>
          ${C.MODALITY.map((m) => `<option value="${m}" ${projectFilter.modality === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <button class="btn btn-secondary" data-act="export-all-xlsx" title="Export all projects to one spreadsheet">${ic('file')} Export All</button>
        <button class="btn btn-primary" data-act="new-project">${ic('plus')} New Project</button>
      </div>
    </div>

    ${!rows.length ? emptyState('folder', 'No matching projects', projectFilter.query || projectFilter.status ? 'Try changing your search or filters.' : 'Create your first project to start tracking.') : `
    <div class="card">
      <div class="tbl-wrap">
        <table class="tbl">
          <colgroup>
            <col style="width:24%"><col style="width:10%"><col style="width:9%"><col style="width:15%">
            <col style="width:15%"><col style="width:9%"><col style="width:11%"><col style="width:7%">
          </colgroup>
          <thead>
            <tr>
              <th>Project</th>
              <th>Status</th>
              <th>Priority</th>
              <th>PI</th>
              <th>Modality / Tags</th>
              <th>Progress</th>
              <th>Timeline</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((p) => {
              const total = p.ms_total || 0;
              const done = p.ms_done || 0;
              const pct = total ? Math.round((done / total) * 100) : 0;
              const flags = (p.flags || '').split(',').filter(Boolean);
              return `
              <tr class="row-link" data-goto="project" data-id="${p.id}">
                <td>
                  <div style="font-weight:600;font-size:14px;color:var(--text)">${esc(p.title)}</div>
                  <div class="faint mono small">Code: ${esc(p.code)}</div>
                </td>
                <td>${statusBadge(p.status)}</td>
                <td><span class="badge ${p.priority === 'High' ? 'danger' : p.priority === 'Low' ? 'neutral' : 'warning'}">${esc(p.priority || 'Medium')}</span></td>
                <td class="muted small">${esc(p.pi_name || '—')}</td>
                <td>
                  <div class="chips">
                    ${p.modality ? `<span class="chip-sm">${esc(p.modality)}</span>` : ''}
                    ${p.sample ? `<span class="chip-sm">${esc(p.sample)}</span>` : ''}
                    ${flags.map((f) => `<span class="badge danger" style="padding:1px 6px;font-size:10px">${esc(f)}</span>`).join('')}
                  </div>
                </td>
                <td>
                  <div class="row" style="gap:6px">
                    <div class="progress seg" style="width:80px"><i style="width:${pct}%"></i></div>
                    <span class="mono small faint">${pct}%</span>
                  </div>
                  <div class="faint small">${done}/${total} done</div>
                </td>
                <td class="mono small">
                  <div>${fmt(p.start_date)}</div>
                  <div class="faint">to ${fmt(p.end_date)}</div>
                </td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-ghost btn-xs" data-act="edit-project" data-id="${p.id}" title="Edit Project">${ic('edit')}</button>
                  <button class="btn btn-ghost btn-xs" data-goto="project" data-id="${p.id}" title="Open Details">${ic('chevron')}</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`}`;
  }

  function statusBadge(s) {
    const map = { 'Initiated': 'neutral', 'Active': 'primary', 'On-hold': 'warning', 'Completed': 'success', 'Archived': 'neutral' };
    return `<span class="badge ${map[s] || 'neutral'}">${esc(s)}</span>`;
  }

  /* ---------------- Project detail ---------------- */
  function projectDetail(id) {
    const p = global.DB.row('SELECT p.*, pe.name as pi_name FROM projects p LEFT JOIN people pe ON pe.id = p.pi_id WHERE p.id=?', [id]);
    if (!p) return emptyState('folder', 'Project not found', 'This project may have been deleted.');

    const ppl = global.DB.rows(`
      SELECT pp.role, pe.id, pe.name, pe.type, pe.email
      FROM project_people pp
      JOIN people pe ON pe.id = pp.person_id
      WHERE pp.project_id=?`, [id]);

    const inst = global.DB.rows(`
      SELECT pi.instrument_id, i.name, i.kind, i.status
      FROM project_instruments pi
      JOIN instruments i ON i.id = pi.instrument_id
      WHERE pi.project_id=?`, [id]);

    const ms = global.DB.rows(`
      SELECT m.*,
             (SELECT GROUP_CONCAT(pe.name, ', ') FROM milestone_owners mo JOIN people pe ON pe.id = mo.person_id WHERE mo.milestone_id = m.id) as owners,
             (SELECT GROUP_CONCAT(i.name, ', ') FROM milestone_instruments mi JOIN instruments i ON i.id = mi.instrument_id WHERE mi.milestone_id = m.id) as instruments
      FROM milestones m
      WHERE m.project_id=?
      ORDER BY m.due_date IS NULL, m.due_date ASC, m.id ASC`, [id]);

    const kv = global.DB.rows('SELECT * FROM kv WHERE project_id=? ORDER BY id ASC', [id]);
    const mtgs = global.DB.rows('SELECT * FROM meetings WHERE project_id=? ORDER BY date DESC, id DESC', [id]);
    const files = global.DB.rows('SELECT * FROM files WHERE project_id=? ORDER BY created_at DESC', [id]);
    const prog = global.DB.projectProgress(p.id);
    const flags = (p.flags || '').split(',').filter(Boolean);

    return `
    <div class="card mb-16 project-header-card">
      <div class="row" style="align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div class="grow">
          <div class="row" style="gap:10px;flex-wrap:wrap">
            <span class="project-title">${esc(p.title)}</span>
            ${statusBadge(p.status)}
            <span class="badge ${p.priority === 'High' ? 'danger' : p.priority === 'Low' ? 'neutral' : 'warning'}">${esc(p.priority || 'Medium')} Priority</span>
          </div>
          <div class="faint small mt-8" style="display:flex;gap:16px;flex-wrap:wrap">
            <span><strong>Code:</strong> <span class="mono">${esc(p.code)}</span> <button class="btn btn-ghost btn-xs" data-act="copy" data-copy="${esc(p.code)}" data-copy-label="Project code copied" title="Copy project code">${ic('copy')}</button></span>
            <span><strong>PI:</strong> ${esc(p.pi_name || 'None')}</span>
            <span><strong>Created:</strong> ${fmt(p.created_at)}</span>
            <span><strong>Timeline:</strong> ${fmt(p.start_date)} → ${fmt(p.end_date)}</span>
          </div>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" data-act="edit-project" data-id="${p.id}">${ic('edit')} Edit Project</button>
          <button class="btn btn-secondary btn-sm" data-act="duplicate-project" data-id="${p.id}" title="Duplicate as a new project template">${ic('layers')} Duplicate</button>
          <button class="btn btn-secondary btn-sm" data-act="export-xlsx" title="Export Spreadsheet">${ic('file')} XLSX</button>
          <button class="btn btn-secondary btn-sm" data-act="export-docx" title="Export Word Document">${ic('file')} DOCX</button>
          <button class="btn btn-secondary btn-sm" data-act="export-pdf" title="Export Formatted PDF">${ic('file')} PDF</button>
          <button class="btn btn-danger btn-sm" data-act="delete-project" title="Delete Project">${ic('trash')} Delete</button>
        </div>
      </div>

      <!-- Quick Status Lifecycle Bar -->
      <div class="lifecycle-bar mt-16">
        <span class="faint small font-medium">Quick Status:</span>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          ${C.STATUS.map((st) => `
            <button class="btn btn-sm ${p.status === st ? 'btn-primary' : 'btn-ghost'}" data-act="set-project-status" data-status="${st}">
              ${st}
            </button>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- Progress Card -->
    <div class="card mb-16">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('target')} Overall Progress</span></div>
        <span class="mono font-medium">${prog.pct}% (${prog.done} of ${prog.total} milestones done)</span>
      </div>
      <div class="progress seg" style="height:12px"><i style="width:${prog.pct}%"></i></div>
    </div>

    <div class="grid cols-2 mb-16">
      <!-- Project Metadata & Tags Card -->
      <div class="card">
        <div class="row mb-8">
          <div class="grow"><span class="card-title">${ic('tag')} Metadata &amp; Tags</span></div>
          <button class="btn btn-ghost btn-sm" data-act="kv-add">${ic('plus')} Add Field</button>
        </div>
        <div class="card-body">
          <div class="metadata-grid">
            <div class="meta-item"><span class="meta-label">Funding:</span> <span class="meta-val">${esc(p.funding || '—')}</span></div>
            <div class="meta-item"><span class="meta-label">Modality:</span> <span class="meta-val">${esc(p.modality || '—')}</span></div>
            <div class="meta-item"><span class="meta-label">Sample Type:</span> <span class="meta-val">${esc(p.sample || '—')}</span></div>
            <div class="meta-item"><span class="meta-label">Flags:</span> <span class="meta-val">${flags.length ? flags.map((f) => `<span class="badge danger">${esc(f)}</span>`).join(' ') : '—'}</span></div>
            <div class="meta-item" style="grid-column: span 2"><span class="meta-label">Tags:</span> <span class="meta-val">${esc(p.tags || '—')}</span></div>
            ${p.notes ? `<div class="meta-item" style="grid-column: span 2"><span class="meta-label">Notes:</span> <span class="meta-val">${esc(p.notes)}</span></div>` : ''}
          </div>

          ${kv.length ? `
          <div class="divider"></div>
          <div class="kv">
            ${kv.map((r) => `
              <div class="kv-row">
                <span class="k">${esc(r.key)}</span>
                <span class="v">${esc(r.value)}</span>
                <div class="row" style="gap:4px">
                  <span class="del" data-act="kv-edit" data-id="${r.id}" title="Edit field">${ic('edit')}</span>
                  <span class="del" data-act="kv-del" data-id="${r.id}" title="Delete field">${ic('x')}</span>
                </div>
              </div>`).join('')}
          </div>` : ''}
        </div>
      </div>

      <!-- Team Card -->
      <div class="card">
        <div class="row mb-8">
          <div class="grow"><span class="card-title">${ic('users')} Team &amp; Collaborators</span></div>
          <button class="btn btn-ghost btn-sm" data-act="add-project-person">${ic('plus')} Add Member</button>
        </div>
        <div class="card-body">
          ${ppl.length ? ppl.map((r) => `
            <div class="person-card">
              <div class="avatar">${esc((r.name || '?')[0])}</div>
              <div class="grow">
                <div style="font-weight:600">${esc(r.name)} <span class="badge neutral" style="font-size:10.5px">${esc(r.type)}</span></div>
                <div class="faint small">${r.role ? 'Role: ' + esc(r.role) + ' · ' : ''}${esc(r.email || '')}</div>
              </div>
              <button class="btn btn-ghost btn-sm" data-act="remove-project-person" data-id="${r.id}" title="Remove member">${ic('trash')}</button>
            </div>`).join('') : emptyState('users', 'No team members', 'Add collaborators, PIs, or technicians to this project.')}
        </div>
      </div>
    </div>

    <!-- Instruments Card -->
    <div class="card mb-16">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('cpu')} Assigned Instruments</span></div>
        <button class="btn btn-ghost btn-sm" data-act="add-project-instrument">${ic('plus')} Assign Instrument</button>
      </div>
      <div class="card-body">
        ${inst.length ? `
        <div class="grid cols-3">
          ${inst.map((i) => `
            <div class="instrument-box">
              <div class="row">
                <span class="font-medium grow">${esc(i.name)}</span>
                <span class="badge neutral">${esc(i.status)}</span>
                <button class="btn btn-ghost btn-sm" data-act="remove-project-instrument" data-id="${i.instrument_id}" title="Remove instrument">${ic('trash')}</button>
              </div>
              <div class="faint small mt-8">${esc(i.kind || 'Facility Instrument')}</div>
            </div>`).join('')}
        </div>` : emptyState('cpu', 'No instruments linked', 'Link instruments used by this project.')}
      </div>
    </div>

    <!-- Milestones Timeline Card -->
    <div class="card mb-16">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('target')} Milestones &amp; Deliverables</span></div>
        <button class="btn btn-primary btn-sm" data-act="add-milestone">${ic('plus')} Add Milestone</button>
      </div>
      <div class="card-body">
        ${ms.length ? ms.map((r) => milestoneRow(r, p.id)).join('') : emptyState('target', 'No milestones yet', 'Add deliverables and track due dates and progress.')}
      </div>
    </div>

    <div class="grid cols-2">
      <!-- Files Card -->
      <div class="card">
        <div class="row mb-8">
          <div class="grow"><span class="card-title">${ic('file')} Files &amp; Attachments</span></div>
          <button class="btn btn-ghost btn-sm" data-act="add-file">${ic('plus')} Add File</button>
        </div>
        <div class="card-body">
          ${files.length ? files.map((f) => {
            const isSafeLink = f.kind === 'link' && global.UI.isSafeUrl(f.path);
            const box = isSafeLink
              ? `<a href="${esc(f.path)}" target="_blank" rel="noopener noreferrer" class="file-link" data-tooltip="${esc(f.path)}">${ic('file')}<span>${esc(f.name)}</span>${ic('external')}</a>`
              : `<span class="file-link file-link-static">${ic('file')}<span>${esc(f.name)}</span></span>`;
            const meta = f.kind === 'upload' ? 'Uploaded File' : (isSafeLink ? esc(f.path) : esc(f.path || ''));
            return `
            <div class="row file-row" style="padding:8px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
              ${box}
              <div class="grow faint small">${meta} · ${fmt(f.created_at)}</div>
              ${f.kind === 'upload' ? `<button class="btn btn-secondary btn-sm" data-act="download-file" data-id="${f.id}" data-name="${esc(f.name)}">Download</button>` : ''}
              <button class="btn btn-ghost btn-sm" data-act="file-del" data-id="${f.id}" title="Delete file">${ic('trash')}</button>
            </div>`;
          }).join('') : emptyState('file', 'No files linked', 'Attach data files, scripts, or external links.')}
        </div>
      </div>

      <!-- Meetings Card -->
      <div class="card">
        <div class="row mb-8">
          <div class="grow"><span class="card-title">${ic('calendar')} Meetings &amp; Syncs</span></div>
          <button class="btn btn-ghost btn-sm" data-act="add-meeting">${ic('plus')} Add Meeting</button>
        </div>
        <div class="card-body">
          ${mtgs.length ? mtgs.map((m) => `
            <div class="meeting-box mb-8">
              <div class="row">
                <span class="font-medium grow">${esc(m.title)}</span>
                <span class="faint mono small">${fmt(m.date)}</span>
                <button class="btn btn-ghost btn-sm" data-act="edit-booking" data-id="${m.id}" title="Edit meeting">${ic('edit')}</button>
                <button class="btn btn-ghost btn-sm" data-act="meeting-del" data-id="${m.id}" title="Delete meeting">${ic('trash')}</button>
              </div>
              ${m.attendees ? `<div class="faint small mt-8"><strong>Attendees:</strong> ${esc(m.attendees)}</div>` : ''}
              ${m.note ? `<div class="small muted mt-8 rte-content">${global.UI.noteHtml(m.note)}</div>` : ''}
              ${m.actions ? `<div class="action-items mt-8"><span class="badge warning font-medium">Actions:</span> ${esc(m.actions)}</div>` : ''}
            </div>`).join('') : emptyState('calendar', 'No meetings recorded', 'Log sync meetings, consultation notes, and action items.')}
        </div>
      </div>
    </div>`;
  }

  function milestoneRow(m, pid) {
    const now = today();
    const isOverdue = m.due_date && m.due_date < now && m.status !== 'done';
    return `
    <div class="ms" data-ms-id="${m.id}">
      <div class="rail">
        <div class="node ${m.status === 'done' ? 'done' : isOverdue ? 'overdue' : m.status === 'in-progress' ? 'next' : ''} clickable"
             data-act="toggle-ms-status" data-id="${m.id}" title="Click to cycle status"></div>
        <div class="line"></div>
      </div>
      <div class="body">
        <div class="row" style="flex-wrap:wrap;gap:8px">
          <span class="ttl">${esc(m.name)}</span>
          <div class="grow"></div>
          <span class="badge ${m.status === 'done' ? 'success' : m.status === 'in-progress' ? 'primary' : 'neutral'} clickable"
                data-act="toggle-ms-status" data-id="${m.id}" title="Click to cycle status">${m.status}</span>
          ${isOverdue ? '<span class="badge danger">overdue</span>' : ''}
          <button class="btn btn-ghost btn-sm" data-act="edit-milestone" data-id="${m.id}" title="Edit milestone">${ic('edit')}</button>
          <button class="btn btn-ghost btn-sm" data-act="ms-del" data-id="${m.id}" title="Delete milestone">${ic('trash')}</button>
        </div>
        <div class="meta mt-8">
          <span class="mono">${fmt(m.due_date)}</span>
          ${m.note ? ' · ' + esc(m.note) : ''}
        </div>
        ${(m.owners || m.instruments) ? `
        <div class="chips mt-8">
          ${m.owners ? `<span class="chip-sm">${ic('users')} ${esc(m.owners)}</span>` : ''}
          ${m.instruments ? `<span class="chip-sm">${ic('cpu')} ${esc(m.instruments)}</span>` : ''}
        </div>` : ''}
      </div>
    </div>`;
  }

  /* ---------------- People ---------------- */
  let peopleFilter = { query: '', type: '' };
  function setPeopleFilter(f) {
    peopleFilter = Object.assign(peopleFilter, f);
    global.App.refresh();
  }

  function people() {
    const allRows = global.DB.rows(`
      SELECT pe.*,
             (SELECT COUNT(*) FROM project_people pp WHERE pp.person_id = pe.id) as proj_count
      FROM people pe
      ORDER BY pe.type, pe.name`);

    const qLower = (peopleFilter.query || '').trim().toLowerCase();
    const rows = allRows.filter((r) => {
      if (peopleFilter.type && r.type !== peopleFilter.type) return false;
      if (qLower) {
        const textToSearch = `${r.name} ${r.type} ${r.organization || ''} ${r.department || ''} ${r.email || ''} ${r.note || ''}`.toLowerCase();
        if (!textToSearch.includes(qLower)) return false;
      }
      return true;
    });

    return `
    <div class="card mb-16">
      <div class="filter-bar">
        <div class="search-input-wrap grow">
          <span class="search-icon">${ic('search')}</span>
          <input type="text" class="input search-input" id="people-search" placeholder="Search by name, role, lab, or email..." value="${esc(peopleFilter.query)}" />
        </div>
        <select class="input select-filter" id="people-type-filter" style="width:150px">
          <option value="">All Roles</option>
          ${C.PERSON_TYPES.map((t) => `<option value="${t}" ${peopleFilter.type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <button class="btn btn-primary" data-act="add-person" data-tooltip="Register a new researcher or staff">${ic('plus')} Add Person</button>
      </div>
    </div>

    <div class="card">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('users')} People, Labs &amp; Researchers</span></div>
      </div>
      ${!rows.length ? emptyState('users', 'No matching people', allRows.length ? 'Try changing your search or filters.' : 'Add Principal Investigators, lab members, and facility technicians.') : `
      <div class="tbl-wrap">
        <table class="tbl">
          <colgroup>
            <col style="width:16%"><col style="width:11%"><col style="width:17%"><col style="width:14%">
            <col style="width:16%"><col style="width:14%"><col style="width:56px"><col style="width:78px">
          </colgroup>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role / Position</th>
              <th>Lab / Group / Company</th>
              <th>Department</th>
              <th>Email</th>
              <th>Notes</th>
              <th title="Active projects">Proj.</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td style="font-weight:600">${esc(r.name)}</td>
                <td><span class="badge neutral">${esc(r.type)}</span></td>
                <td>${r.organization ? `<span class="chip-sm" style="font-weight:600">${esc(r.organization)}</span>` : '<span class="faint small">—</span>'}</td>
                <td>${r.department ? `<span class="chip-sm" style="font-weight:600">${esc(r.department)}</span>` : '<span class="faint small">—</span>'}</td>
                <td class="muted small">${esc(r.email || '—')}</td>
                <td class="faint small">${esc(r.note || '—')}</td>
                <td><span class="badge primary" title="${r.proj_count} active project${r.proj_count === 1 ? '' : 's'}">${r.proj_count}</span></td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-ghost btn-xs" data-act="edit-person" data-id="${r.id}" title="Edit Person">${ic('edit')}</button>
                  <button class="btn btn-ghost btn-xs" data-act="delete-person" data-id="${r.id}" title="Delete Person">${ic('trash')}</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>`;
  }

  /* ---------------- Instruments ---------------- */
  let instrumentFilter = { query: '', status: '', kind: '' };
  function setInstrumentFilter(f) {
    instrumentFilter = Object.assign(instrumentFilter, f);
    global.App.refresh();
  }

  function instruments() {
    const allRows = global.DB.rows(`
      SELECT i.*,
             (SELECT COUNT(*) FROM project_instruments pi WHERE pi.instrument_id = i.id) as proj_count
      FROM instruments i
      ORDER BY i.name`);

    const qLower = (instrumentFilter.query || '').trim().toLowerCase();
    const rows = allRows.filter((r) => {
      if (instrumentFilter.status && r.status !== instrumentFilter.status) return false;
      if (instrumentFilter.kind && r.kind !== instrumentFilter.kind) return false;
      if (qLower) {
        const textToSearch = `${r.name} ${r.kind || ''} ${r.status || ''} ${r.location || ''} ${r.note || ''}`.toLowerCase();
        if (!textToSearch.includes(qLower)) return false;
      }
      return true;
    });

    return `
    <div class="card mb-16">
      <div class="filter-bar">
        <div class="search-input-wrap grow">
          <span class="search-icon">${ic('search')}</span>
          <input type="text" class="input search-input" id="inst-search" placeholder="Search by name, modality, or notes..." value="${esc(instrumentFilter.query)}" />
        </div>
        <select class="input select-filter" id="inst-status-filter" style="width:140px">
          <option value="">All Statuses</option>
          ${C.INSTRUMENT_STATUS.map((s) => `<option value="${s}" ${instrumentFilter.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <select class="input select-filter" id="inst-kind-filter" style="width:150px">
          <option value="">All Modalities</option>
          ${C.MODALITY.map((m) => `<option value="${m}" ${instrumentFilter.kind === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <button class="btn btn-primary" data-act="add-instrument">${ic('plus')} Add Instrument</button>
      </div>
    </div>

    <div class="card">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('cpu')} Core Instruments</span></div>
      </div>
      ${!rows.length ? emptyState('cpu', 'No matching instruments', allRows.length ? 'Try changing your search or filters.' : 'Add microscopes, cytometers, or analysis workstations.') : `
      <div class="tbl-wrap">
        <table class="tbl">
          <colgroup>
            <col style="width:20%"><col style="width:16%"><col style="width:10%"><col style="width:12%">
            <col style="width:24%"><col style="width:10%"><col style="width:8%">
          </colgroup>
          <thead><tr><th>Instrument Name</th><th>Modality / Kind</th><th>Status</th><th>Location</th><th>Config Notes</th><th>Active In</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td style="font-weight:600">${esc(r.name)}</td>
                <td class="muted small">${esc(r.kind || '—')}</td>
                <td><span class="badge ${r.status === 'Available' ? 'success' : r.status === 'In-use' ? 'primary' : r.status === 'Down' ? 'danger' : 'warning'}">${esc(r.status)}</span></td>
                <td class="faint small">${esc(r.location || '—')}</td>
                <td class="faint small">${esc(r.note || '—')}</td>
                <td><span class="badge neutral">${r.proj_count} projects</span></td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-ghost btn-xs" data-act="edit-instrument" data-id="${r.id}" title="Edit Instrument">${ic('edit')}</button>
                  <button class="btn btn-ghost btn-xs" data-act="delete-instrument" data-id="${r.id}" title="Delete Instrument">${ic('trash')}</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>`;
  }

  /* ---------------- Calendar (Fixed 7-Day Grid) ---------------- */
  let calOffset = 0;
  function navCalendar(delta) { calOffset += delta; global.App.refresh(); }
  function calendar() {
    const base = new Date();
    const shifted = new Date(base.getFullYear(), base.getMonth() + calOffset, 1);
    const sy = shifted.getFullYear(), sm = shifted.getMonth();
    const monthLabel = shifted.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const firstDayOfMonth = new Date(sy, sm, 1);
    const lastDayOfMonth = new Date(sy, sm + 1, 0);

    // Calculate first Monday on or before the 1st
    const start = new Date(firstDayOfMonth);
    const dayOfWeek = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dayOfWeek);

    // Calculate last Sunday on or after last day
    const end = new Date(lastDayOfMonth);
    const endDayOfWeek = (end.getDay() + 6) % 7;
    end.setDate(end.getDate() + (6 - endDayOfWeek));

    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);

    const ms = global.DB.rows(`
      SELECT m.id, m.due_date, m.name, m.status, p.id as project_id, p.title as project_title
      FROM milestones m
      JOIN projects p ON p.id = m.project_id
      WHERE m.due_date >= ? AND m.due_date <= ?`, [startStr, endStr]);

    const mtgs = global.DB.rows(`
      SELECT m.id, m.date, m.title, p.id as project_id, p.title as project_title
      FROM meetings m
      LEFT JOIN projects p ON p.id = m.project_id
      WHERE m.date >= ? AND m.date <= ?`, [startStr, endStr]);

    const byDay = {};
    for (const m of ms) {
      (byDay[m.due_date] = byDay[m.due_date] || []).push({
        id: m.id,
        name: m.name,
        kind: 'ms',
        status: m.status,
        project_id: m.project_id,
        project_title: m.project_title
      });
    }
    for (const mt of mtgs) {
      (byDay[mt.date] = byDay[mt.date] || []).push({
        id: mt.id,
        name: mt.title,
        kind: 'mt',
        project_id: mt.project_id,
        project_title: mt.project_title
      });
    }

    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let headerCells = dow.map((d) => `<div class="dow">${d}</div>`).join('');
    let cells = '';

    const cur = new Date(start);
    const todayStr = today();

    while (cur <= end) {
      const ds = cur.toISOString().slice(0, 10);
      const isToday = ds === todayStr;
      const inMonth = cur.getMonth() === sm;
      const evs = byDay[ds] || [];

      cells += `
      <div class="cal-cell clickable ${isToday ? 'today' : ''} ${!inMonth ? 'other-month' : ''}"
           data-act="new-booking" data-date="${ds}" data-tooltip="Click to add a booking on ${ds}">
        <div class="cal-cell-head">
          <span class="num">${cur.getDate()}</span>
          ${isToday ? '<span class="today-tag">Today</span>' : ''}
        </div>
        <div class="cal-events">
          ${evs.map((e) => `
            <div class="ev ${e.kind === 'mt' ? 'mt' : e.status === 'done' ? 'done' : ''}"
                 data-act="${e.kind === 'mt' ? 'edit-booking' : 'edit-milestone'}" data-id="${e.id}"
                 title="${esc(e.name)}${e.project_title ? ' (' + esc(e.project_title) + ')' : ''}">
              ${e.kind === 'mt' ? '📅 ' : '🎯 '}${esc(e.name)}
            </div>`).join('')}
        </div>
      </div>`;
      cur.setDate(cur.getDate() + 1);
    }

    return `
    <div class="card">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('calendar')} ${monthLabel}</span></div>
        <div class="row" style="gap:6px">
          <button class="btn btn-secondary btn-sm" data-act="cal-prev" data-tooltip="Previous Month">${ic('chevron-left')} Prev</button>
          <button class="btn btn-primary btn-sm" data-act="open-today-modal" data-tooltip="Expand Today's Agenda &amp; Milestones">Today</button>
          <button class="btn btn-secondary btn-sm" data-act="cal-next" data-tooltip="Next Month">Next ${ic('chevron-right')}</button>
        </div>
      </div>
      <div class="cal-grid-header">${headerCells}</div>
      <div class="cal-grid">${cells}</div>
    </div>`;
  }

  /* ---------------- Settings ---------------- */
  function settings() {
    const hideStartup = UI.storage.getItem('crm-hide-startup-modal') === '1';
    const autoBackupEnabled = UI.storage.getItem('auto-backup-enabled') !== '0';
    const lastAutoBackup = UI.storage.getItem('last-auto-backup-at');
    const lastAutoBackupLabel = lastAutoBackup ? new Date(lastAutoBackup).toLocaleString() : 'Never yet';
    const folderStatus = global.App.autoBackupFolderStatus;

    return `
    <div class="card mb-16">
      <div class="card-title">${ic('settings')} Preferences</div>
      <div class="card-body">
        <div class="row mb-8">
          <div class="grow">
            <div style="font-weight:600">Startup Welcome Modal</div>
            <div class="faint small">Show the welcome modal with Quick Demo vs Fresh Start options upon opening the app.</div>
          </div>
          <label class="row" style="cursor:pointer;gap:8px">
            <input type="checkbox" id="pref-hide-startup" ${!hideStartup ? 'checked' : ''} onchange="UI.storage.setItem('crm-hide-startup-modal', this.checked ? '0' : '1'); UI.toast('Startup preference updated');" />
            <span class="small font-medium">Show on startup</span>
          </label>
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-title">${ic('sparkles')} Sample Data &amp; Walkthrough</div>
      <div class="card-body">
        <div class="row mb-8">
          <div class="grow">
            <div style="font-weight:600">Facility Sandbox &amp; Interactive Tour</div>
            <div class="faint small">Load a complete multi-modality research dataset (projects, PIs, microscopes, milestones, meetings, calendar events) or start the guided walkthrough.</div>
          </div>
        </div>
        <div class="row mt-8" style="gap:10px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" data-act="open-startup-modal">${ic('compass')} Open Welcome Screen</button>
          <button class="btn btn-secondary btn-sm" data-act="load-sample-data">${ic('sparkles')} Load Sample Data</button>
          <button class="btn btn-tour btn-sm" data-act="tour">${ic('play')} Launch Field Walkthrough</button>
          <button class="btn btn-ghost btn-sm text-danger" style="color:var(--danger)" data-act="clear-data">${ic('trash')} Clear All Data</button>
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-title">${ic('folder')} Portable Data &amp; Backups</div>
      <div class="card-body">
        <div class="row mb-8">
          <div class="grow">
            <div style="font-weight:600">Single-File Backup &amp; Recovery</div>
            <div class="faint small">Your entire facility database lives securely in your browser's persistent storage. Export a portable JSON backup anytime for safekeeping or to transfer to another workstation.</div>
          </div>
        </div>
        <div class="row mt-8" style="gap:10px">
          <button class="btn btn-primary btn-sm" data-act="backup">${ic('file')} Export Backup (.json)</button>
          <button class="btn btn-secondary btn-sm" data-act="restore">${ic('external')} Restore from Backup</button>
        </div>
        <div class="divider"></div>
        <div class="row mb-8">
          <div class="grow">
            <div style="font-weight:600">Automatic Daily Backup</div>
            <div class="faint small">Roughly once every 24 hours while the app is open (skipped when there's no data yet). Last automatic backup: ${esc(lastAutoBackupLabel)}</div>
          </div>
          <label class="row" style="cursor:pointer;gap:8px">
            <input type="checkbox" id="pref-auto-backup" ${autoBackupEnabled ? 'checked' : ''} onchange="UI.storage.setItem('auto-backup-enabled', this.checked ? '1' : '0'); UI.toast('Automatic backup preference updated');" />
            <span class="small font-medium">Enabled</span>
          </label>
        </div>
        <div class="row mb-8" style="flex-wrap:wrap">
          <div class="grow">
            <div style="font-weight:600">Silent Backup Folder</div>
            <div class="faint small">${
              !folderStatus.supported
                ? "Not supported in this browser (Chrome/Edge only). Without it, automatic backups use your browser's normal file download — if that shows a save dialog every time, disable \"Ask where to save each file before downloading\" in your browser's download settings for a fully silent experience."
                : folderStatus.name && folderStatus.granted
                ? `Automatic backups write silently into <strong>${esc(folderStatus.name)}</strong> — no download prompts.`
                : folderStatus.name && !folderStatus.granted
                ? `Backup folder "${esc(folderStatus.name)}" was configured but needs permission again (this can happen after a browser restart).`
                : 'Not set up. Pick the folder where this app is saved (or any folder) — a "backups" subfolder will be created inside it automatically, and every automatic backup writes there silently with no download dialog.'
            }</div>
          </div>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            ${!folderStatus.supported ? '' :
              folderStatus.name && folderStatus.granted ? `
                <button class="btn btn-secondary btn-sm" data-act="choose-auto-backup-folder">${ic('folder')} Change Folder</button>
                <button class="btn btn-ghost btn-sm" data-act="disable-auto-backup-folder">${ic('x')} Disable</button>` :
              folderStatus.name && !folderStatus.granted ? `
                <button class="btn btn-primary btn-sm" data-act="regrant-auto-backup-folder">${ic('check')} Re-enable</button>
                <button class="btn btn-ghost btn-sm" data-act="disable-auto-backup-folder">${ic('x')} Disable</button>` :
                `<button class="btn btn-primary btn-sm" data-act="choose-auto-backup-folder">${ic('folder')} Choose App Folder</button>`
            }
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">${ic('cpu')} Core Facility Tracker</div>
      <div class="card-body">
        <div class="faint small" style="line-height:1.7">
          <p class="mt-0 mb-8"><strong>Version:</strong> ${esc(global.APP_VERSION || '—')}</p>
          <p class="mb-8"><strong>Platform:</strong> Standalone Portable Web App (Zero Install / Zero Server).</p>
          <p class="mb-8"><strong>Database:</strong> SQLite Engine via WebAssembly/asm.js + IndexedDB persistent storage.</p>
          <p class="mb-8"><strong>Export Engines:</strong> SheetJS (.xlsx), docx (.docx), jsPDF (.pdf).</p>
          <p class="mb-0">Designed for advanced microscopy, bioimaging, and scientific core facilities.</p>
        </div>
      </div>
    </div>`;
  }

  /* ---------------- Empty state ---------------- */
  function emptyState(icName, t, s) {
    return `<div class="empty"><div class="ic">${ic(icName)}</div><div class="t">${esc(t)}</div><div class="s">${esc(s)}</div></div>`;
  }

  global.Views = {
    dashboard,
    projects,
    setProjectFilter,
    projectDetail,
    people,
    setPeopleFilter,
    instruments,
    setInstrumentFilter,
    calendar,
    settings,
    emptyState,
    navCalendar,
    statusBadge
  };

})(window);
