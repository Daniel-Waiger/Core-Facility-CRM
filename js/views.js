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
    for (const s of global.DB.vocabList('STATUS')) counts[s] = 0;
    const stRows = global.DB.rows('SELECT status, COUNT(*) as n FROM projects WHERE is_archived=0 GROUP BY status');
    for (const r of stRows) counts[r.status] = r.n;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const active = counts['Active'] || 0;

    const winStr = global.UI.todayPlusDays(30);
    const upcoming = global.DB.rows(`
      SELECT m.id, m.name, m.due_date, m.status, p.id as project_id, p.title as project_title
      FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE p.is_archived=0 AND m.due_date IS NOT NULL AND m.due_date <= ? AND m.status != 'done'
      ORDER BY m.due_date ASC LIMIT 10`, [winStr]);

    const overdue = global.DB.rows(`
      SELECT m.id, m.name, m.due_date, m.status, p.id as project_id, p.title as project_title
      FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE p.is_archived=0 AND m.due_date IS NOT NULL AND m.due_date < ? AND m.status != 'done'
      ORDER BY m.due_date ASC LIMIT 10`, [now]);

    return `
    <div class="grid cols-4 mb-16">
      <div class="card stat"><span class="n">${total}</span><span class="l">Total Projects</span></div>
      <div class="card stat"><span class="n" style="color:var(--primary)">${active}</span><span class="l">Active</span></div>
      <div class="card stat"><span class="n" style="color:var(--danger)">${overdue.length}</span><span class="l">Overdue Milestones</span></div>
      <div class="card stat"><span class="n" style="color:var(--success)">${counts['Completed'] || 0}</span><span class="l">Completed</span></div>
    </div>
    <div class="grid cols-2">
      <div class="card">
        <div class="card-title">${ic('target')} Upcoming Milestones (Next 30 Days)</div>
        <div class="card-body">
          ${upcoming.length ? upcoming.map((m) => `
            <div class="row milestone-quick-row">
              <div class="grow row-link" data-goto="project" data-id="${m.project_id}">
                <div class="font-medium">${esc(m.name)}</div>
                <div class="faint small">${esc(m.project_title)}</div>
              </div>
              <span class="ms-quick-meta">
                <span class="badge ${m.status === 'in-progress' ? 'primary' : 'neutral'} clickable" data-act="toggle-ms-status" data-id="${m.id}" title="Click to set status">${esc(global.UI.msStatusLabel(m.status))}</span>
                <span class="mono small">${fmt(m.due_date)}</span>
              </span>
            </div>`).join('') : emptyState('calendar', 'Nothing due soon', 'No pending milestones in the next 30 days.')}
        </div>
      </div>
      <div class="card">
        <div class="card-title" style="color:var(--danger)">${ic('alert')} Overdue Milestones</div>
        <div class="card-body">
          ${overdue.length ? overdue.map((m) => `
            <div class="row milestone-quick-row">
              <div class="grow row-link" data-goto="project" data-id="${m.project_id}">
                <div class="font-medium">${esc(m.name)}</div>
                <div class="faint small">${esc(m.project_title)}</div>
              </div>
              <span class="ms-quick-meta">
                <span class="badge danger clickable" data-act="toggle-ms-status" data-id="${m.id}" title="Click to set status">${esc(global.UI.msStatusLabel('overdue'))}</span>
                <span class="mono small" style="color:var(--danger)">${fmt(m.due_date)}</span>
              </span>
            </div>`).join('') : emptyState('check', 'All clear', 'No overdue milestones across any active project.')}
        </div>
      </div>
    </div>`;
  }

  /* ---------------- Projects list ---------------- */
  let projectFilter = { query: '', status: '', priority: '', modality: '', showArchived: false };
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
      ORDER BY p.is_archived, p.updated_at DESC`);
    const archivedCount = allProjects.filter((p) => p.is_archived).length;

    // Apply client-side filters
    const qLower = (projectFilter.query || '').trim().toLowerCase();
    const rows = allProjects.filter((p) => {
      // Archived projects keep everything (team, instruments, bookings and their billing) but
      // step out of the day-to-day registry until the toggle brings them back.
      if (p.is_archived && !projectFilter.showArchived) return false;
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
          ${global.DB.vocabList('STATUS').map((s) => `<option value="${esc(s)}" ${projectFilter.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
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
        ${archivedCount ? `<label class="retired-toggle" data-tooltip="Archived projects keep their team, instruments, bookings and billing"><input type="checkbox" id="proj-archived-filter" ${projectFilter.showArchived ? 'checked' : ''} /> Show archived (${archivedCount})</label>` : ''}
        <button class="btn btn-primary" data-act="new-project">${ic('plus')} New Project</button>
      </div>
    </div>

    ${!rows.length ? (allProjects.length
      // Whether a FILTER is set is the wrong question: rows can also be hidden because every
      // project is archived and the "Show archived" toggle is off, which sets no filter at all.
      // The only thing that distinguishes the two empty states is whether any project EXISTS —
      // if one does, something is hiding it and the filter bar is where to look; if none does,
      // blaming a filter the user never set just sends them hunting. Same rule as people() and
      // instruments() below.
      ? emptyState('folder', 'No matching projects', 'Try changing your search or filters.')
      : emptyState('folder', 'No projects yet', 'Create your first project to start tracking.')) : `
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
              <tr class="row-link ${p.is_archived ? 'row-retired' : ''}" data-goto="project" data-id="${p.id}">
                <td>
                  <div style="font-weight:600;font-size:14px;color:var(--text)">${esc(p.title)}${p.is_archived ? ' <span class="badge neutral" data-tooltip="Archived — every record kept, out of the active registry">Archived</span>' : ''}</div>
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
    const map = {
      'Initiated': 'neutral', 'Submitted for review': 'warning', 'Under review': 'warning',
      'Kickoff scheduled': 'primary', 'Active': 'primary', 'On-hold': 'warning',
      'Completed': 'success', 'Invoiced': 'warning', 'Paid': 'success', 'Archived': 'neutral'
    };
    return `<span class="badge ${map[s] || 'neutral'}">${esc(s)}</span>`;
  }

  /* ---------------- Project detail ---------------- */
  function projectDetail(id) {
    const p = global.DB.row(`
      SELECT p.*, pe.name as pi_name, g.name as grant_name, g.number as grant_number, g.is_retired as grant_is_retired
      FROM projects p
      LEFT JOIN people pe ON pe.id = p.pi_id
      LEFT JOIN grants g ON g.id = p.grant_id
      WHERE p.id=?`, [id]);
    if (!p) return emptyState('folder', 'Project not found', 'This project may have been deleted.');
    // No denormalized grant-name column — the Settings name/number toggle would make a frozen
    // string wrong by design, so this always joins fresh and resolves via DB.grantLabel (the one
    // shared label helper app.js/views.js/exports.js all read).
    const grantDisplayStr = p.grant_id
      ? global.UI.retiredName(global.DB.grantLabel({ name: p.grant_name, number: p.grant_number }), p.grant_is_retired)
      : '';

    const ppl = global.DB.rows(`
      SELECT pp.role, pe.id, pe.name, pe.type, pe.email, pe.is_retired
      FROM project_people pp
      JOIN people pe ON pe.id = pp.person_id
      WHERE pp.project_id=?`, [id]);

    const inst = global.DB.rows(`
      SELECT pi.instrument_id, i.name, i.kind, i.status, i.is_retired
      FROM project_instruments pi
      JOIN instruments i ON i.id = pi.instrument_id
      WHERE pi.project_id=?`, [id]);

    const ms = global.DB.rows(`
      SELECT m.*,
             (SELECT GROUP_CONCAT(pe.name || CASE WHEN pe.is_retired THEN ' (Retired)' ELSE '' END, ', ') FROM milestone_owners mo JOIN people pe ON pe.id = mo.person_id WHERE mo.milestone_id = m.id) as owners,
             (SELECT GROUP_CONCAT(i.name || CASE WHEN i.is_retired THEN ' (Retired)' ELSE '' END, ', ') FROM milestone_instruments mi JOIN instruments i ON i.id = mi.instrument_id WHERE mi.milestone_id = m.id) as instruments
      FROM milestones m
      WHERE m.project_id=?
      ORDER BY m.due_date IS NULL, m.due_date ASC, m.id ASC`, [id]);

    const kv = global.DB.rows('SELECT * FROM kv WHERE project_id=? ORDER BY id ASC', [id]);
    // Research outputs (roadmap 3.3) — the funnel's exit stage. Cloned from the same
    // "load flat, query fresh, no denormalized name column" pattern as kv above.
    const outputs = global.DB.rows(`SELECT * FROM project_outputs WHERE project_id=? ORDER BY ${global.DB.outputEffDate()} DESC, id DESC`, [id]);
    const mtgs = global.DB.rows(`
      SELECT m.*, g.name as grant_name, g.number as grant_number, g.is_retired as grant_is_retired
      FROM meetings m
      LEFT JOIN grants g ON g.id = m.grant_id
      WHERE m.project_id=?
      ORDER BY m.date DESC, m.id DESC`, [id]);
    // Standalone service entries (roadmap 2.3) — no denormalized name columns, so staff/
    // instrument/grant are joined fresh here, same as the bookings query above.
    const entries = global.DB.rows(`
      SELECT se.*, g.name as grant_name, g.number as grant_number, g.is_retired as grant_is_retired,
             pe.name as person_name, pe.is_retired as person_retired,
             i.name as instrument_name, i.is_retired as instrument_retired
      FROM service_entries se
      LEFT JOIN grants g ON g.id = se.grant_id
      LEFT JOIN people pe ON pe.id = se.person_id
      LEFT JOIN instruments i ON i.id = se.instrument_id
      WHERE se.project_id=?
      ORDER BY se.date DESC, se.id DESC`, [id]);
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
            <span><strong>Code:</strong> <span class="mono">${esc(p.code)}</span> <button class="btn btn-ghost btn-xs" data-act="copy" data-copy="${esc(p.code)}" data-copy-label="Project code copied" title="Copy Project Code">${ic('copy')}</button></span>
            <span><strong>PI:</strong> ${esc(p.pi_name || 'None')}</span>
            <span><strong>Created:</strong> ${fmt(p.created_at)}</span>
            <span><strong>Timeline:</strong> ${fmt(p.start_date)} → ${fmt(p.end_date)}</span>
          </div>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap" data-tour="proj-exports">
          <button class="btn btn-primary btn-sm" data-act="edit-project" data-id="${p.id}">${ic('edit')} Edit Project</button>
          <button class="btn btn-secondary btn-sm" data-act="duplicate-project" data-id="${p.id}" title="Duplicate as a new project template">${ic('layers')} Duplicate</button>
          <button class="btn btn-secondary btn-sm" data-act="export-xlsx" title="Export Spreadsheet">${ic('file')} XLSX</button>
          <button class="btn btn-secondary btn-sm" data-act="export-docx" title="Export Word Document">${ic('file')} DOCX</button>
          <button class="btn btn-secondary btn-sm" data-act="export-pdf" title="Export Formatted PDF">${ic('file')} PDF</button>
          ${p.is_archived
            ? `<button class="btn btn-secondary btn-sm" data-act="restore-project" data-id="${p.id}" title="Restore to the active registry">${ic('rocket')} Restore</button>`
            : `<button class="btn btn-secondary btn-sm" data-act="archive-project" title="Archive — keeps the team, instruments, bookings and billing">${ic('archive')} Archive</button>`}
        </div>
      </div>

      ${p.is_archived ? `<div class="archived-banner mt-16">${ic('archive')} <span>This project is archived. Its team, instruments, milestones, bookings and billing are all kept — it's simply out of the active registry. Use <strong>Restore</strong> to bring it back.</span></div>` : ''}

      <!-- Quick Status Lifecycle Bar -->
      <div class="lifecycle-bar mt-16">
        <span class="faint small font-medium">Quick Status:</span>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          ${global.DB.vocabList('STATUS').map((st) => `
            <button class="btn btn-sm ${p.status === st ? 'btn-primary' : 'btn-ghost'}" data-act="set-project-status" data-status="${esc(st)}">
              ${esc(st)}
            </button>
          `).join('')}
          <button class="btn btn-sm btn-secondary" data-act="vocab-add" data-cat="STATUS" data-target="" data-label="Status" data-tooltip="Add a custom project status">${ic('plus')} Add Status</button>
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
            <div class="meta-item"><span class="meta-label">Grant:</span> <span class="meta-val">${grantDisplayStr ? esc(grantDisplayStr) : '—'}</span></div>
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
                  <span class="del" data-act="kv-edit" data-id="${r.id}" title="Edit Field">${ic('edit')}</span>
                  <span class="del" data-act="kv-del" data-id="${r.id}" title="Delete Field">${ic('x')}</span>
                </div>
              </div>`).join('')}
          </div>` : ''}
        </div>
      </div>

      <!-- Team Card -->
      <div class="card" data-tour="proj-team">
        <div class="row mb-8">
          <div class="grow"><span class="card-title">${ic('users')} Team &amp; Collaborators</span></div>
          <button class="btn btn-ghost btn-sm" data-act="add-project-person">${ic('plus')} Add Member</button>
        </div>
        <div class="card-body">
          ${ppl.length ? ppl.map((r) => `
            <div class="person-card">
              <div class="avatar">${esc((r.name || '?')[0])}</div>
              <div class="grow">
                <div style="font-weight:600">${esc(global.UI.retiredName(r.name, r.is_retired))} <span class="badge neutral" style="font-size:10.5px">${esc(r.type)}</span></div>
                <div class="faint small">${r.role ? 'Role: ' + esc(r.role) + ' · ' : ''}${esc(r.email || '')}</div>
              </div>
              <button class="btn btn-ghost btn-sm" data-act="remove-project-person" data-id="${r.id}" title="Remove Member">${ic('trash')}</button>
            </div>`).join('') : emptyState('users', 'No team members', 'Add collaborators, PIs, or technicians to this project.')}
        </div>
      </div>
    </div>

    <!-- Research Outputs Card (roadmap 3.3) — cloned from the Custom Fields card's add/edit/
         delete pattern above; the funnel's exit stage lives here per-project. -->
    <div class="card mb-16">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('tag')} Research Outputs</span></div>
        <button class="btn btn-ghost btn-sm" data-act="output-add" data-project-id="${p.id}">${ic('plus')} Add Output</button>
      </div>
      <div class="card-body">
        ${outputs.length ? `
        <div class="kv">
          ${outputs.map((o) => `
            <div class="kv-row">
              <span class="k"><span class="badge neutral" style="text-transform:capitalize">${esc(o.type)}</span> ${esc(o.title)}</span>
              <span class="v">${o.reference ? esc(o.reference) + ' — ' : ''}${o.date ? fmt(o.date) : fmt(o.created_at)}</span>
              <div class="row" style="gap:4px">
                <span class="del" role="button" tabindex="0" aria-label="Edit Output" data-act="output-edit" data-id="${o.id}" title="Edit Output">${ic('edit')}</span>
                <span class="del" role="button" tabindex="0" aria-label="Delete Output" data-act="output-del" data-id="${o.id}" title="Delete Output">${ic('x')}</span>
              </div>
            </div>`).join('')}
        </div>` : emptyState('tag', 'No research outputs yet', 'Log a publication, acknowledgement, dataset, or other output once this project produces one.')}
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
                <span class="font-medium grow">${esc(global.UI.retiredName(i.name, i.is_retired))}</span>
                <span class="badge neutral">${esc(i.status)}</span>
                <button class="btn btn-ghost btn-sm" data-act="remove-project-instrument" data-id="${i.instrument_id}" title="Remove Instrument">${ic('trash')}</button>
              </div>
              <div class="faint small mt-8">${esc(i.kind || 'Facility Instrument')}</div>
            </div>`).join('')}
        </div>` : emptyState('cpu', 'No instruments linked', 'Link instruments used by this project.')}
      </div>
    </div>

    <!-- Milestones Timeline Card -->
    <div class="card mb-16" data-tour="proj-milestones">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('target')} Milestones &amp; Deliverables</span></div>
        <button class="btn btn-primary btn-sm" data-act="add-milestone">${ic('plus')} Add Milestone</button>
      </div>
      <div class="card-body">
        ${ms.length ? ms.map((r) => milestoneRow(r, p.id)).join('') : emptyState('target', 'No milestones yet', 'Add deliverables and track due dates and progress.')}
      </div>
    </div>

    <!-- Project Costs Card — a running list of every booking's stored cost snapshot (see
         computeBookingBOM in app.js for how each figure below was originally computed; these
         are the numbers as saved at booking time, not recalculated live) plus every standalone
         service entry (roadmap 2.3), which follows the identical counting rule. -->
    <div class="card mb-16">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('tag')} Project Costs</span></div>
        <span class="mono font-medium">${esc(global.UI.fmtMoney(
          mtgs.reduce((s, m) => s + ((m.is_cancelled && !m.billing_retained) ? 0 : (m.total_cost || 0)), 0) +
          entries.reduce((s, e) => s + ((e.is_cancelled && !e.billing_retained) ? 0 : (e.total_cost || 0)), 0)
        ))} total</span>
        <button class="btn btn-ghost btn-sm" data-act="add-service-entry" data-project-id="${p.id}" title="Log standalone billable work outside any booking">${ic('plus')} Service Entry</button>
      </div>
      <div class="card-body">
        ${mtgs.length ? `
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Booking</th><th>Grant</th><th>Tier</th><th>Date / Time</th><th style="text-align:right">Subtotal</th><th style="text-align:right">Before Tax</th><th style="text-align:right">Total</th><th style="text-align:right">Details</th></tr></thead>
            <tbody>
              ${mtgs.map((m) => {
                const waived = m.is_cancelled && !m.billing_retained;
                const bookingGrantStr = m.grant_id
                  ? global.UI.retiredName(global.DB.grantLabel({ name: m.grant_name, number: m.grant_number }), m.grant_is_retired)
                  : '';
                // Resolved fresh from the STORED tier_id (a snapshot column, like grant_id) —
                // null/legacy bookings (priced via the Internal+External fallback) show '—'.
                const tierStr = global.DB.tierLabel(m.tier_id);
                return `
                <tr class="${m.is_cancelled ? 'row-retired' : ''}">
                  <td class="font-medium small">${esc(m.title)}${m.is_cancelled ? ` <span class="badge neutral" data-tooltip="${waived ? 'Cancelled — charge dropped, not counted in Project Costs' : 'Cancelled — charge stands and counts toward Project Costs'}">Cancelled${waived ? '' : ' · charged'}</span>` : ''}</td>
                  <td class="small">${bookingGrantStr ? esc(bookingGrantStr) : '<span class="faint">—</span>'}</td>
                  <td class="small">${tierStr === '—' ? '<span class="faint">—</span>' : esc(tierStr)}</td>
                  <td class="mono small faint">${fmt(m.date)}${m.start_time ? ' ' + esc(m.start_time) + (m.end_time ? '–' + esc(m.end_time) : '') : ''}</td>
                  <td class="mono small" style="text-align:right">${esc(global.UI.fmtMoney(m.subtotal || 0))}</td>
                  <td class="mono small" style="text-align:right">${esc(global.UI.fmtMoney(m.total_before_tax || 0))}</td>
                  <td class="mono font-medium" style="text-align:right">${waived ? `<span class="faint" style="text-decoration:line-through">${esc(global.UI.fmtMoney(m.total_cost || 0))}</span>` : esc(global.UI.fmtMoney(m.total_cost || 0))}</td>
                  <td style="text-align:right"><button class="btn btn-ghost btn-xs" data-act="edit-booking" data-id="${m.id}" title="View full cost breakdown">${ic('eye')}</button></td>
                </tr>`; }).join('')}
            </tbody>
          </table>
        </div>` : ''}
        ${entries.length ? `
        <div class="tbl-wrap mt-16">
          <table class="tbl">
            <thead><tr><th>Service Entry</th><th>Staff</th><th>Instrument</th><th>Grant</th><th>Date</th><th style="text-align:right">Qty</th><th>Unit</th><th style="text-align:right">Rate</th><th style="text-align:right">Total</th><th style="text-align:right">Actions</th></tr></thead>
            <tbody>
              ${entries.map((e) => {
                const waived = e.is_cancelled && !e.billing_retained;
                const entryGrantStr = e.grant_id
                  ? global.UI.retiredName(global.DB.grantLabel({ name: e.grant_name, number: e.grant_number }), e.grant_is_retired)
                  : '';
                return `
                <tr class="${e.is_cancelled ? 'row-retired' : ''}">
                  <td class="font-medium small">${esc(e.description)}${e.is_cancelled ? ` <span class="badge neutral" data-tooltip="${waived ? 'Cancelled — charge dropped, not counted in Project Costs' : 'Cancelled — charge stands and counts toward Project Costs'}">Cancelled${waived ? '' : ' · charged'}</span>` : ''}</td>
                  <td class="small">${e.person_name ? esc(global.UI.retiredName(e.person_name, e.person_retired)) : '<span class="faint">—</span>'}</td>
                  <td class="small">${e.instrument_name ? esc(global.UI.retiredName(e.instrument_name, e.instrument_retired)) : '<span class="faint">—</span>'}</td>
                  <td class="small">${entryGrantStr ? esc(entryGrantStr) : '<span class="faint">—</span>'}</td>
                  <td class="mono small faint">${fmt(e.date)}</td>
                  <td class="mono small" style="text-align:right">${e.qty || 0}</td>
                  <td class="small">${esc(e.unit || '')}</td>
                  <td class="mono small" style="text-align:right">${esc(global.UI.fmtMoney(e.rate || 0))}</td>
                  <td class="mono font-medium" style="text-align:right">${waived ? `<span class="faint" style="text-decoration:line-through">${esc(global.UI.fmtMoney(e.total_cost || 0))}</span>` : esc(global.UI.fmtMoney(e.total_cost || 0))}</td>
                  <td style="text-align:right">
                    <button class="btn btn-ghost btn-xs" data-act="edit-service-entry" data-id="${e.id}" title="Edit Entry">${ic('edit')}</button>
                    ${e.is_cancelled
                      ? `<button class="btn btn-ghost btn-xs" data-act="se-reinstate" data-id="${e.id}" title="Reinstate">${ic('rocket')}</button>`
                      : `<button class="btn btn-ghost btn-xs" data-act="se-cancel" data-id="${e.id}" title="Cancel Entry">${ic('archive')}</button>`}
                  </td>
                </tr>`; }).join('')}
            </tbody>
          </table>
        </div>` : ''}
        ${(!mtgs.length && !entries.length) ? emptyState('tag', 'No bookings or service entries yet', 'Costs from instrument/staff bookings and standalone service entries will appear here once you add one.') : ''}
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
              <button class="btn btn-ghost btn-sm" data-act="file-del" data-id="${f.id}" title="Delete File">${ic('trash')}</button>
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
            <div class="meeting-box mb-8 ${m.is_cancelled ? 'row-retired' : ''}">
              <div class="row">
                <span class="font-medium grow">${esc(m.title)}${m.category ? ` <span class="badge primary" style="font-size:10.5px">${esc(m.category)}</span>` : ''}${m.is_cancelled ? ` <span class="badge neutral" data-tooltip="Kept on the record; its instrument and staff time is free again">Cancelled${m.billing_retained ? ' · charged' : ''}</span>` : ''}</span>
                <span class="faint mono small">${fmt(m.date)}</span>
                <button class="btn btn-ghost btn-sm" data-act="email-attendees" data-id="${m.id}" title="Email Attendees">${ic('mail')}</button>
                <button class="btn btn-ghost btn-sm" data-act="edit-booking" data-id="${m.id}" title="Edit Meeting">${ic('edit')}</button>
                ${m.is_cancelled
                  ? `<button class="btn btn-ghost btn-sm" data-act="booking-reinstate" data-id="${m.id}" title="Reinstate — puts it back in the schedule">${ic('rocket')}</button>`
                  : `<button class="btn btn-ghost btn-sm" data-act="meeting-cancel" data-id="${m.id}" title="Cancel — keeps the record, frees the slot">${ic('archive')}</button>`}
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
             data-act="toggle-ms-status" data-id="${m.id}" title="Click to set status"></div>
        <div class="line"></div>
      </div>
      <div class="body">
        <div class="row" style="flex-wrap:wrap;gap:8px">
          <span class="ttl">${esc(m.name)}</span>
          <div class="grow"></div>
          <span class="badge ${m.status === 'done' ? 'success' : m.status === 'in-progress' ? 'primary' : 'neutral'} clickable"
                data-act="toggle-ms-status" data-id="${m.id}" title="Click to set status">${esc(global.UI.msStatusLabel(m.status))}</span>
          ${isOverdue ? `<span class="badge danger">${esc(global.UI.msStatusLabel('overdue'))}</span>` : ''}
          <button class="btn btn-ghost btn-sm" data-act="edit-milestone" data-id="${m.id}" title="Edit Milestone">${ic('edit')}</button>
          <button class="btn btn-ghost btn-sm" data-act="ms-del" data-id="${m.id}" title="Delete Milestone">${ic('trash')}</button>
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
  let peopleFilter = { query: '', type: '', showRetired: false, staffOnly: false };
  function setPeopleFilter(f) {
    peopleFilter = Object.assign(peopleFilter, f);
    global.App.refresh();
  }

  function people() {
    const allRows = global.DB.rows(`
      SELECT pe.*,
             (SELECT COUNT(*) FROM project_people pp JOIN projects p ON p.id = pp.project_id
                WHERE pp.person_id = pe.id AND p.is_archived=0) as proj_count
      FROM people pe
      ORDER BY pe.is_retired, pe.type, pe.name`);
    const retiredCount = allRows.filter((r) => r.is_retired).length;
    const staffCount = allRows.filter((r) => r.is_staff).length;

    const qLower = (peopleFilter.query || '').trim().toLowerCase();
    const rows = allRows.filter((r) => {
      // Retired people are kept out of the everyday view but never deleted — the toggle in the
      // filter bar brings them back into sight (it only appears once there are any).
      if (r.is_retired && !peopleFilter.showRetired) return false;
      if (peopleFilter.staffOnly && !r.is_staff) return false;
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
        ${retiredCount ? `<label class="retired-toggle" data-tooltip="Retired people stay on every record they were ever part of"><input type="checkbox" id="people-retired-filter" ${peopleFilter.showRetired ? 'checked' : ''} /> Show retired (${retiredCount})</label>` : ''}
        ${staffCount ? `<label class="retired-toggle" data-tooltip="Billable by the hour on bookings; set on the person's own record"><input type="checkbox" id="people-staff-filter" ${peopleFilter.staffOnly ? 'checked' : ''} /> Facility staff only (${staffCount})</label>` : ''}
        <button class="btn btn-primary" data-act="add-person" data-tooltip="Register a new researcher or staff">${ic('plus')} Add Person</button>
      </div>
    </div>

    <div class="card">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('users')} People, Labs &amp; Researchers</span></div>
      </div>
      ${!rows.length ? (allRows.length
        ? emptyState('users', 'No matching people', 'Try changing your search or filters.')
        : emptyState('users', 'No people yet', 'Add Principal Investigators, lab members, and facility technicians.')) : `
      <div class="tbl-wrap">
        <table class="tbl">
          <colgroup>
            <col style="width:15%"><col style="width:10%"><col style="width:15%"><col style="width:12%">
            <col style="width:14%"><col style="width:10%"><col style="width:56px"><col style="width:120px">
            <col style="width:78px"><col style="width:78px">
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
              <th title="Billable by the hour on bookings; set on the person's own record">Facility Staff</th>
              <th>Rate/hr</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr class="${r.is_retired ? 'row-retired' : ''}">
                <td style="font-weight:600">${esc(r.name)}${r.is_retired ? ' <span class="badge neutral" data-tooltip="Kept for history; not offered for new work">Retired</span>' : ''}</td>
                <td><span class="badge neutral">${esc(r.type)}</span></td>
                <td>${r.organization ? `<span class="chip-sm" style="font-weight:600">${esc(r.organization)}</span>` : '<span class="faint small">—</span>'}</td>
                <td>${r.department ? `<span class="chip-sm" style="font-weight:600">${esc(r.department)}</span>` : '<span class="faint small">—</span>'}</td>
                <td class="muted small">${esc(r.email || '—')}</td>
                <td class="faint small">${esc(r.note || '—')}</td>
                <td><span class="badge primary" title="${r.proj_count} active project${r.proj_count === 1 ? '' : 's'}">${r.proj_count}</span></td>
                <td>${r.is_staff ? `<span class="badge success" data-tooltip="Facility Staff — billable by the hour on bookings">${ic('check')}</span>` : '<span class="faint small">—</span>'}</td>
                <td class="mono small">${r.is_staff ? esc(global.UI.fmtMoney(r.rate || 0)) : '—'}</td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-ghost btn-xs" data-act="edit-person" data-id="${r.id}" title="Edit Person">${ic('edit')}</button>
                  ${r.is_retired
                    ? `<button class="btn btn-ghost btn-xs" data-act="restore-person" data-id="${r.id}" title="Restore — make available for new work again">${ic('rocket')}</button>`
                    : `<button class="btn btn-ghost btn-xs" data-act="retire-person" data-id="${r.id}" title="Retire — keeps every record they appear on">${ic('archive')}</button>`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>`;
  }

  /* ---------------- Instruments ---------------- */
  let instrumentFilter = { query: '', status: '', kind: '', showRetired: false };
  function setInstrumentFilter(f) {
    instrumentFilter = Object.assign(instrumentFilter, f);
    global.App.refresh();
  }

  function instruments() {
    const allRows = global.DB.rows(`
      SELECT i.*,
             (SELECT COUNT(*) FROM project_instruments pi JOIN projects p ON p.id = pi.project_id
                WHERE pi.instrument_id = i.id AND p.is_archived=0) as proj_count,
             (SELECT GROUP_CONCAT(pe.name || CASE WHEN pe.is_retired THEN ' (Retired)' ELSE '' END, ', ')
                FROM instrument_staff ist JOIN people pe ON pe.id = ist.person_id
                WHERE ist.instrument_id = i.id) as supervisors
      FROM instruments i
      ORDER BY i.is_retired, i.name`);
    const retiredCount = allRows.filter((r) => r.is_retired).length;

    const qLower = (instrumentFilter.query || '').trim().toLowerCase();
    const rows = allRows.filter((r) => {
      // Decommissioned instruments stay on every booking that used them; hidden here by default.
      if (r.is_retired && !instrumentFilter.showRetired) return false;
      if (instrumentFilter.status && r.status !== instrumentFilter.status) return false;
      if (instrumentFilter.kind && r.kind !== instrumentFilter.kind) return false;
      if (qLower) {
        const textToSearch = `${r.name} ${r.kind || ''} ${r.status || ''} ${r.location || ''} ${r.note || ''} ${r.supervisors || ''}`.toLowerCase();
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
        ${retiredCount ? `<label class="retired-toggle" data-tooltip="Retired instruments stay on every booking they were used for"><input type="checkbox" id="inst-retired-filter" ${instrumentFilter.showRetired ? 'checked' : ''} /> Show retired (${retiredCount})</label>` : ''}
        <button class="btn btn-primary" data-act="add-instrument">${ic('plus')} Add Instrument</button>
      </div>
    </div>

    <div class="card">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('cpu')} Core Instruments</span></div>
      </div>
      ${!rows.length ? (allRows.length
        ? emptyState('cpu', 'No matching instruments', 'Try changing your search or filters.')
        : emptyState('cpu', 'No instruments yet', 'Add microscopes, cytometers, or analysis workstations.')) : `
      <div class="tbl-wrap">
        <table class="tbl">
          <colgroup>
            <col style="width:14%"><col style="width:10%"><col style="width:7%"><col style="width:9%">
            <col style="width:13%"><col style="width:13%"><col style="width:6%"><col style="width:6%"><col style="width:6%"><col style="width:78px">
          </colgroup>
          <thead><tr><th>Instrument Name</th><th>Modality / Kind</th><th>Status</th><th>Location</th><th>Config Notes</th><th>Supervisor(s)</th><th>Cost</th><th>Unit</th><th title="Active projects">Active Projects</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr class="${r.is_retired ? 'row-retired' : ''}">
                <td style="font-weight:600">${esc(r.name)}${r.is_retired ? ' <span class="badge neutral" data-tooltip="Kept for history; not offered for new bookings">Retired</span>' : ''}</td>
                <td class="muted small">${esc(r.kind || '—')}</td>
                <td><span class="badge ${r.status === 'Available' ? 'success' : r.status === 'In-use' ? 'primary' : r.status === 'Down' ? 'danger' : 'warning'}">${esc(r.status)}</span></td>
                <td class="faint small">${esc(r.location || '—')}</td>
                <td class="faint small">${esc(r.note || '—')}</td>
                <td class="faint small">${esc(r.supervisors || '—')}</td>
                <td class="mono small">${esc(global.UI.fmtMoney(r.cost || 0))}</td>
                <td class="muted small">${esc(global.UI.unitLabel(r.cost_unit || 'time'))}</td>
                <td><span class="badge neutral">${r.proj_count} projects</span></td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-ghost btn-xs" data-act="edit-instrument" data-id="${r.id}" title="Edit Instrument">${ic('edit')}</button>
                  ${r.is_retired
                    ? `<button class="btn btn-ghost btn-xs" data-act="restore-instrument" data-id="${r.id}" title="Restore — make available for new bookings again">${ic('rocket')}</button>`
                    : `<button class="btn btn-ghost btn-xs" data-act="retire-instrument" data-id="${r.id}" title="Retire — keeps every booking it appears on">${ic('archive')}</button>`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>`;
  }

  /* ---------------- Calendar (Month grid + Week hourly view + per-instrument Timeline) ---------------- */
  let calOffset = 0; // Month mode: whole months. Week/Timeline mode: whole weeks. Reset on mode switch.
  let calMode = 'month'; // 'month' | 'week' | 'timeline'
  function navCalendar(delta) { calOffset += delta; global.App.refresh(); }
  function calToday() { calOffset = 0; global.App.refresh(); }
  function setCalMode(mode) {
    if (mode !== 'month' && mode !== 'week' && mode !== 'timeline') return;
    // calOffset's unit changes (months <-> weeks) when the mode changes, so a stale offset from
    // the other mode would jump to the wrong month/week — reset it whenever the mode actually flips.
    // Week and Timeline share the same unit (whole weeks), so hopping directly between those two
    // keeps whatever week you were looking at instead of jumping back to the current one.
    const sameUnit = (a, b) => (a === 'week' || a === 'timeline') && (b === 'week' || b === 'timeline');
    if (mode !== calMode && !sameUnit(mode, calMode)) calOffset = 0;
    calMode = mode;
    global.App.refresh();
  }

  // Shared toolbar for all three calendar renderers: Month/Week/Timeline toggle + prev/today/next.
  function calToolbarHtml(label, unitLabel) {
    return `
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('calendar')} ${label}</span></div>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn ${calMode === 'month' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-act="cal-mode" data-mode="month">Month</button>
          <button class="btn ${calMode === 'week' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-act="cal-mode" data-mode="week">Week</button>
          <button class="btn ${calMode === 'timeline' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-act="cal-mode" data-mode="timeline">Timeline</button>
          <button class="btn btn-secondary btn-sm" data-act="cal-prev" data-tooltip="Previous ${unitLabel}">${ic('chevron-left')} Prev</button>
          <button class="btn btn-primary btn-sm" data-act="cal-today" data-tooltip="Jump back to the current ${unitLabel}">Today</button>
          <button class="btn btn-secondary btn-sm" data-act="cal-next" data-tooltip="Next ${unitLabel}">Next ${ic('chevron-right')}</button>
          <button class="btn btn-secondary btn-sm" data-act="open-today-modal" data-tooltip="Expand Today's Agenda &amp; Milestones">${ic('clock')} Agenda</button>
        </div>
      </div>`;
  }

  // Monday..Sunday of (today + calOffset weeks) as local-midnight Date objects. Shared by Week
  // mode and the Timeline (both are week-unit views over the same offset) so there's one date
  // computation to keep right — see UI.ymd/issue #14 on why this never touches toISOString().
  function calWeekDays() {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // local midnight, no string parsing
    base.setDate(base.getDate() + calOffset * 7);
    const mondayOffset = (base.getDay() + 6) % 7; // Mon=0..Sun=6
    const monday = new Date(base);
    monday.setDate(monday.getDate() - mondayOffset);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }

  // Milestones (by due_date) + meetings (by date) in [startStr, endStr] (inclusive, local
  // 'YYYY-MM-DD' strings), bucketed by day string. Shared by the month and week renderers so
  // there's one query pair to keep in sync — this used to omit m.is_cancelled from the meetings
  // SELECT even though the chip renderer read mt.is_cancelled for the ev-cancelled style, so
  // cancelled bookings never actually looked cancelled on the calendar. Fixed here, once.
  function calFetchByDay(startStr, endStr) {
    const ms = global.DB.rows(`
      SELECT m.id, m.due_date, m.name, m.status, p.id as project_id, p.title as project_title
      FROM milestones m
      JOIN projects p ON p.id = m.project_id
      WHERE m.due_date >= ? AND m.due_date <= ?`, [startStr, endStr]);

    const mtgs = global.DB.rows(`
      SELECT m.id, m.date, m.start_time, m.end_time, m.title, m.is_cancelled, p.id as project_id, p.title as project_title
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
        cancelled: !!mt.is_cancelled,
        start_time: mt.start_time || '',
        end_time: mt.end_time || '',
        project_id: mt.project_id,
        project_title: mt.project_title
      });
    }
    // Timed bookings first (earliest to latest), untimed ones after — milestones have no time
    // of their own so they sort alongside the untimed group in whatever order the query returned.
    for (const day of Object.keys(byDay)) {
      byDay[day].sort((a, b) => {
        const at = a.start_time || '', bt = b.start_time || '';
        if (!at && !bt) return 0;
        if (!at) return 1;
        if (!bt) return -1;
        return at < bt ? -1 : at > bt ? 1 : 0;
      });
    }
    return byDay;
  }

  // One event chip, shared by month cells (no styleAttr) and week event blocks (styleAttr carries
  // the absolute top/height positioning from calEventBlockLayout).
  function calEvChipHtml(e, styleAttr) {
    return `
      <div class="ev ${e.kind === 'mt' ? 'mt' : e.status === 'done' ? 'done' : ''} ${e.cancelled ? 'ev-cancelled' : ''}"
           style="${styleAttr || ''}"
           data-act="${e.kind === 'mt' ? 'edit-booking' : 'edit-milestone'}" data-id="${e.id}"
           title="${e.start_time ? e.start_time + (e.end_time ? '–' + e.end_time : '') + ' ' : ''}${esc(e.name)}${e.project_title ? ' (' + esc(e.project_title) + ')' : ''}">
        ${e.kind === 'mt' ? '📅 ' : '🎯 '}${e.start_time ? `<span class="mono" style="font-size:10px">${esc(e.start_time)}</span> ` : ''}${esc(e.name)}
      </div>`;
  }

  /* ---- Hour-grid layout helpers ----
     Shared by the week view below and (per the roadmap) the resource timeline that follows it:
     turning an "HH:MM" time into a vertical pixel offset within a day column, and laying out a
     timed event's block (top + height) from its start/end. hourPx is a parameter rather than
     baked in so a denser timeline grid can reuse the same math at a different scale. */
  const CAL_HOUR_PX = 48; // px per hour row at the week view's default scale
  const CAL_DAY_HOURS = 24;
  // The Timeline lays days out horizontally at whatever width the lane column happens to be, so
  // "px per hour" doesn't apply — calTimeToPx/calEventBlockLayout's math is unit-agnostic (it's
  // just mins/60*hourPx), so passing a "% per hour" scale instead reuses the exact same helpers
  // to place a block as a percentage of the day-cell's width rather than a pixel height.
  const CAL_TL_HOUR_PCT = 100 / CAL_DAY_HOURS;

  function calTimeToPx(hhmm, hourPx) {
    const mins = global.UI.timeToMinutes(hhmm);
    return mins == null ? null : (mins / 60) * (hourPx || CAL_HOUR_PX);
  }

  // { top, height } in px for a timed event's block. A missing/unparsable/non-positive duration
  // still gets a small fixed-height block so the event stays visible and clickable.
  function calEventBlockLayout(start, end, hourPx) {
    const px = hourPx || CAL_HOUR_PX;
    const top = calTimeToPx(start, px);
    if (top == null) return null;
    const endPx = calTimeToPx(end, px);
    const MIN_H = 20;
    const height = (endPx != null && endPx > top) ? Math.max(MIN_H, endPx - top) : MIN_H;
    return { top, height };
  }

  // Hour-label gutter markup (00:00, 01:00, ... 23:00), one row per hour at hourPx tall.
  function calHourLabelsHtml(hourPx) {
    const px = hourPx || CAL_HOUR_PX;
    let out = '';
    for (let h = 0; h < CAL_DAY_HOURS; h++) {
      out += `<div class="cal-hour-row" style="height:${px}px"><span class="cal-hour-label">${String(h).padStart(2, '0')}:00</span></div>`;
    }
    return out;
  }

  // One day column's backing click-to-book layer: an hour-tall slot per hour, each pre-filling
  // that hour as the new booking's start/end. Event blocks render on top of these (both are
  // positioned, so they stack above in DOM order) and click dispatch resolves the nearest
  // ancestor with data-act, so clicking an event still opens edit-booking/edit-milestone rather
  // than falling through to the slot underneath it.
  function calHourSlotsHtml(ds, hourPx) {
    const px = hourPx || CAL_HOUR_PX;
    let out = '';
    for (let h = 0; h < CAL_DAY_HOURS; h++) {
      const startHH = String(h).padStart(2, '0') + ':00';
      // The 23:00 slot gets no end prefill: a hard-coded 23:59 would make a 59-minute booking
      // that can trip a 60-minute min-duration constraint before the user has touched anything.
      const endHH = h + 1 < 24 ? String(h + 1).padStart(2, '0') + ':00' : '';
      out += `
        <div class="cal-hour-slot clickable" role="button" tabindex="0" style="height:${px}px"
             data-act="new-booking" data-date="${ds}" data-start="${startHH}"${endHH ? ` data-end="${endHH}"` : ''}
             aria-label="Add a booking at ${startHH} on ${ds}"
             data-tooltip="Click to add a booking at ${startHH} on ${ds}"></div>`;
    }
    return out;
  }

  // Timeline's per-lane, per-day analog of calHourSlotsHtml: horizontal instead of vertical, so
  // slots are equal-width percentages rather than fixed px, and each one also carries data-inst
  // so a click prefills the lane's instrument alongside the date/time (see the new-booking
  // dispatcher case and newBooking's optional instrumentId parameter).
  function calTimelineHourSlotsHtml(ds, instId) {
    let out = '';
    for (let h = 0; h < CAL_DAY_HOURS; h++) {
      const startHH = String(h).padStart(2, '0') + ':00';
      // Same rule as calHourSlotsHtml: no 23:59 end prefill on the last slot.
      const endHH = h + 1 < 24 ? String(h + 1).padStart(2, '0') + ':00' : '';
      out += `
        <div class="cal-tl-hour-slot clickable" role="button" tabindex="0" style="width:${CAL_TL_HOUR_PCT}%"
             data-act="new-booking" data-date="${ds}" data-start="${startHH}"${endHH ? ` data-end="${endHH}"` : ''}${instId ? ` data-inst="${instId}"` : ''}
             aria-label="Add a booking at ${startHH} on ${ds}${instId ? ' for this instrument' : ''}"
             data-tooltip="Click to add a booking at ${startHH} on ${ds}${instId ? ' for this instrument' : ''}"></div>`;
    }
    return out;
  }

  function calendar() {
    if (calMode === 'week') return calendarWeek();
    if (calMode === 'timeline') return calendarTimeline();
    return calendarMonth();
  }

  function calendarMonth() {
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

    const startStr = global.UI.ymd(start);
    const endStr = global.UI.ymd(end);
    const byDay = calFetchByDay(startStr, endStr);

    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let headerCells = dow.map((d) => `<div class="dow">${d}</div>`).join('');
    let cells = '';

    const cur = new Date(start);
    const todayStr = today();

    while (cur <= end) {
      // Use local ymd(), not toISOString().slice(0,10): `cur` is a local-midnight Date, and at a
      // UTC+ offset (e.g. Israel) toISOString() re-describes that instant in UTC, which falls on
      // the PREVIOUS day — so the event lookup key, the "new booking" prefill date, and the
      // tooltip would all be one day behind the visible day-of-month label. See UI.ymd's own
      // comment in js/ui.js and GitHub issue #14.
      const ds = global.UI.ymd(cur);
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
          ${evs.map((e) => calEvChipHtml(e)).join('')}
        </div>
      </div>`;
      cur.setDate(cur.getDate() + 1);
    }

    return `
    <div class="card">
      ${calToolbarHtml(monthLabel, 'Month')}
      <div class="cal-grid-header">${headerCells}</div>
      <div class="cal-grid">${cells}</div>
    </div>`;
  }

  // Monday..Sunday of (today + calOffset weeks), hourly grid with an all-day lane above it for
  // untimed events (milestones, and any booking saved without a start time).
  function calendarWeek() {
    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const days = calWeekDays();

    const startStr = global.UI.ymd(days[0]);
    const endStr = global.UI.ymd(days[6]);
    const byDay = calFetchByDay(startStr, endStr);
    const todayStr = today();

    const weekLabel = `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – `
      + `${days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;

    const dayInfos = days.map((d, i) => {
      const ds = global.UI.ymd(d); // local calendar day, not toISOString() — see calFetchByDay/ymd comments
      const evs = byDay[ds] || [];
      return {
        ds,
        date: d,
        dow: dow[i],
        isToday: ds === todayStr,
        allDay: evs.filter((e) => !e.start_time), // milestones + untimed bookings
        timed: evs.filter((e) => e.start_time)
      };
    });

    const headHtml = dayInfos.map((d) => `
      <div class="cal-week-daycol-head ${d.isToday ? 'today' : ''}">
        <span class="dow">${d.dow}</span><span class="num">${d.date.getDate()}</span>
        ${d.isToday ? '<span class="today-tag">Today</span>' : ''}
      </div>`).join('');

    const alldayHtml = dayInfos.map((d) => `
      <div class="cal-week-allday-col clickable" role="button" tabindex="0" data-act="new-booking" data-date="${d.ds}" aria-label="Add a booking on ${d.ds}" data-tooltip="Click to add a booking on ${d.ds}">
        ${d.allDay.map((e) => calEvChipHtml(e)).join('')}
      </div>`).join('');

    const gridHeight = CAL_HOUR_PX * CAL_DAY_HOURS;
    const bodyHtml = dayInfos.map((d) => `
      <div class="cal-week-daycol" style="height:${gridHeight}px">
        ${calHourSlotsHtml(d.ds, CAL_HOUR_PX)}
        ${d.timed.map((e) => {
          const layout = calEventBlockLayout(e.start_time, e.end_time, CAL_HOUR_PX);
          if (!layout) return '';
          return calEvChipHtml(e, `position:absolute;left:2px;right:2px;top:${layout.top}px;height:${layout.height}px`);
        }).join('')}
      </div>`).join('');

    return `
    <div class="card">
      ${calToolbarHtml(weekLabel, 'Week')}
      <div class="cal-week">
        <div class="cal-week-header">
          <div class="cal-week-gutter"></div>
          ${headHtml}
        </div>
        <div class="cal-week-allday">
          <div class="cal-week-gutter cal-week-allday-label">All day</div>
          ${alldayHtml}
        </div>
        <div class="cal-week-scroll">
          <div class="cal-week-body" style="height:${gridHeight}px">
            <div class="cal-week-gutter cal-week-hours">${calHourLabelsHtml(CAL_HOUR_PX)}</div>
            ${bodyHtml}
          </div>
        </div>
      </div>
    </div>`;
  }

  // Per-instrument resource timeline: one lane (row) per instrument, the same Monday..Sunday
  // week range as Week mode (calWeekDays, calOffset counted in weeks) across as columns. A
  // booking renders as a proportional block inside its day cell — reusing calTimeToPx at a
  // percent-per-hour scale (CAL_TL_HOUR_PCT) rather than a full 24-row hour axis, which would be
  // too dense stacked one row per instrument. Cancelled bookings still render (styled via the
  // shared .ev-cancelled class from calEvChipHtml) rather than disappearing from the lane.
  function calendarTimeline() {
    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const days = calWeekDays();
    const startStr = global.UI.ymd(days[0]);
    const endStr = global.UI.ymd(days[6]);
    const todayStr = today();

    const weekLabel = `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – `
      + `${days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;

    // Lanes: every active instrument, plus any retired instrument booked somewhere in this
    // range — history renders (labelled via UI.retiredName), it just doesn't clutter every other
    // week once nothing in view still references it.
    const instruments = global.DB.rows(`
      SELECT id, name, is_retired FROM instruments
      WHERE is_retired = 0
         OR id IN (
           SELECT DISTINCT mi.instrument_id FROM meeting_instruments mi
           JOIN meetings m ON m.id = mi.meeting_id
           WHERE m.date >= ? AND m.date <= ?
         )
      ORDER BY is_retired ASC, name ASC`, [startStr, endStr]);

    // One row per (instrument, booking) via meeting_instruments — a multi-instrument booking
    // appears in every one of its lanes, the same attribution rule reports.js documents for its
    // per-instrument aggregations. is_cancelled is selected (not filtered out) so cancelled
    // bookings still render, just styled via calEvChipHtml's ev-cancelled class.
    const bookingRows = global.DB.rows(`
      SELECT mi.instrument_id, m.id, m.date, m.start_time, m.end_time, m.title, m.is_cancelled,
             p.id as project_id, p.title as project_title
      FROM meeting_instruments mi
      JOIN meetings m ON m.id = mi.meeting_id
      LEFT JOIN projects p ON p.id = m.project_id
      WHERE m.date >= ? AND m.date <= ?`, [startStr, endStr]);

    // "instrument_id|date" -> [events], mirroring calFetchByDay's per-day bucketing.
    const byInstDay = {};
    for (const r of bookingRows) {
      const key = r.instrument_id + '|' + r.date;
      (byInstDay[key] = byInstDay[key] || []).push({
        id: r.id, name: r.title, kind: 'mt', cancelled: !!r.is_cancelled,
        start_time: r.start_time || '', end_time: r.end_time || '',
        project_id: r.project_id, project_title: r.project_title
      });
    }

    const headHtml = days.map((d, i) => {
      const ds = global.UI.ymd(d);
      return `
      <div class="cal-tl-daycol-head ${ds === todayStr ? 'today' : ''}">
        <span class="dow">${dow[i]}</span><span class="num">${d.getDate()}</span>
      </div>`;
    }).join('');

    const rowsHtml = instruments.map((inst) => {
      const label = global.UI.retiredName(inst.name, !!inst.is_retired);
      const dayCells = days.map((d) => {
        const ds = global.UI.ymd(d);
        const evs = byInstDay[inst.id + '|' + ds] || [];
        const blocksHtml = evs.map((e) => {
          // Reuses calTimeToPx (the same time→position math the Week grid uses) at a % scale —
          // see CAL_TL_HOUR_PCT. calEventBlockLayout's own MIN_H clamp assumes px, so its 20px
          // floor isn't reused verbatim here: at a % width, a 20% minimum would make short
          // bookings look hours long, so a small % floor (MIN_W) is applied directly instead.
          const leftPct = calTimeToPx(e.start_time, CAL_TL_HOUR_PCT);
          if (leftPct == null) {
            // Untimed booking (saved without a start_time) — still shown, as a full-width strip,
            // rather than silently vanishing from the lane.
            return calEvChipHtml(e, 'position:absolute;left:2px;right:2px;top:2px;bottom:2px');
          }
          const endPct = calTimeToPx(e.end_time, CAL_TL_HOUR_PCT);
          const MIN_W = 4;
          const widthPct = (endPct != null && endPct > leftPct) ? Math.max(MIN_W, endPct - leftPct) : MIN_W;
          return calEvChipHtml(e, `position:absolute;left:${leftPct}%;width:${widthPct}%;top:2px;bottom:2px`);
        }).join('');
        // A retired instrument's lane still shows its history, but an empty slot in it should not
        // pre-lock a brand-new booking to a resource that's no longer available for new work —
        // omit data-inst there so the click still opens New Booking (date/time prefilled) without
        // the instrument. mountTokenPicker's own dropdown would exclude a retired instrument from
        // a new booking anyway; this just keeps the timeline's shortcut consistent with that.
        return `
          <div class="cal-tl-daycell ${ds === todayStr ? 'today' : ''}">
            ${calTimelineHourSlotsHtml(ds, inst.is_retired ? '' : inst.id)}
            ${blocksHtml}
          </div>`;
      }).join('');
      return `
        <div class="cal-tl-row">
          <div class="cal-tl-lane-label" title="${esc(label)}">${esc(label)}</div>
          ${dayCells}
        </div>`;
    }).join('');

    return `
    <div class="card">
      ${calToolbarHtml(weekLabel, 'Week')}
      ${instruments.length === 0
        ? `<div class="faint small" style="padding:16px 4px">No instruments to show.</div>`
        : `
      <div class="cal-tl">
        <div class="cal-tl-header">
          <div class="cal-tl-lane-label cal-tl-lane-label-head">Instrument</div>
          ${headHtml}
        </div>
        <div class="cal-tl-body">
          ${rowsHtml}
        </div>
      </div>`}
    </div>`;
  }

  /* ---------------- Settings ---------------- */
  function settings() {
    const hideStartup = UI.storage.getItem('crm-hide-startup-modal') === '1';
    const autoBackupEnabled = UI.storage.getItem('auto-backup-enabled') !== '0';
    const lastAutoBackup = UI.storage.getItem('last-auto-backup-at');
    const lastAutoBackupLabel = lastAutoBackup ? new Date(lastAutoBackup).toLocaleString() : 'Never yet';
    const folderStatus = global.App.autoBackupFolderStatus;
    const adminOn = UI.storage.getItem('admin-mode') === '1';
    const skipSingleInstrumentPrompt = UI.storage.getItem('skip-single-instrument-prompt') === '1';
    const orgs = global.DB.rows("SELECT DISTINCT organization FROM people WHERE organization IS NOT NULL AND TRIM(organization) != '' ORDER BY organization").map((r) => r.organization);
    const renameOrgs = global.DB.listAllOrgNames(); // includes orgs that only show up in group_discounts/meetings.group_org
    const grants = global.DB.rows(`
      SELECT g.*, (SELECT COUNT(*) FROM grant_users gu WHERE gu.grant_id = g.id) as user_count
      FROM grants g ORDER BY g.is_retired ASC, g.name ASC`);
    const grantDisplay = global.DB.getConfig('grant_display', 'name');
    const tiers = global.DB.rows(`
      SELECT t.*, (SELECT COUNT(*) FROM group_tiers gt WHERE gt.tier_id = t.id) as group_count,
             (SELECT COUNT(*) FROM meetings m WHERE m.tier_id = t.id) as booking_count
      FROM pricing_tiers t ORDER BY t.is_retired ASC, t.name ASC`);
    // One row per booking category (built-ins plus any facility-added vocab term) — an unlisted
    // category simply hasn't been given a row yet, and DB.categoryPolicy's {100, false} default
    // reproduces exactly what booking billing did before this feature existed.
    const bookingCategories = global.DB.vocabList('BOOKING_CATEGORY');
    const categoryPolicies = bookingCategories.map((cat) => Object.assign({ category: cat }, global.DB.getCategoryPolicyRaw(cat)));

    return `
    <div class="card mb-16">
      <div class="card-title">${ic('settings')} Preferences</div>
      <div class="card-body">
        <div class="row mb-8">
          <div class="grow">
            <div style="font-weight:600">Startup Welcome Screen</div>
            <div class="faint small">Show the welcome screen, offering "Demo Sandbox &amp; Walkthrough" or "Start Fresh (Empty Workspace)", when the app opens.</div>
          </div>
          <label class="row" style="cursor:pointer;gap:8px">
            <input type="checkbox" id="pref-hide-startup" ${!hideStartup ? 'checked' : ''} onchange="UI.storage.setItem('crm-hide-startup-modal', this.checked ? '0' : '1'); UI.toast('Startup preference updated');" />
            <span class="small font-medium">Show on startup</span>
          </label>
        </div>
        <div class="row mb-8">
          <div class="grow">
            <div style="font-weight:600">Single-Instrument Booking Prompt</div>
            <div class="faint small">Ask whether to lock a booking to one instrument the first time you pick one for it. Turned off automatically if you tick "Don't ask me again" on that prompt.</div>
          </div>
          <label class="row" style="cursor:pointer;gap:8px">
            <input type="checkbox" id="pref-single-instrument-prompt" ${!skipSingleInstrumentPrompt ? 'checked' : ''} onchange="UI.storage.setItem('skip-single-instrument-prompt', this.checked ? '0' : '1'); UI.toast('Preference updated');" />
            <span class="small font-medium">Ask about single-instrument bookings</span>
          </label>
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-title">${ic('sparkles')} Sample Data &amp; Walkthrough</div>
      <div class="card-body">
        <div class="row mb-8">
          <div class="grow">
            <div style="font-weight:600">Facility Sandbox &amp; Guided Tour</div>
            <div class="faint small">Load a complete multi-modality research dataset (projects, PIs, microscopes, milestones, meetings, calendar events) or start the guided tour.</div>
          </div>
        </div>
        <div class="row mt-8" style="gap:10px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" data-act="open-startup-modal">${ic('compass')} Open Welcome Screen</button>
          <button class="btn btn-secondary btn-sm" data-act="load-sample-data">${ic('sparkles')} Open Demo Sandbox</button>
          <button class="btn btn-tour btn-sm" data-act="tour">${ic('play')} Launch Guided Tour</button>
          <button class="btn btn-ghost btn-sm text-danger" style="color:var(--danger)" data-act="clear-data">${ic('trash')} Clear All Data</button>
        </div>
      </div>
    </div>

    <div class="card mb-16" data-tour="settings-backup">
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
                ? `Automatic backups write silently into <strong>${esc(folderStatus.name)}</strong> — a full JSON backup plus an XLSX export of every project, milestone, person, instrument and booking — no download prompts.`
                : folderStatus.name && !folderStatus.granted
                ? `Backup folder "${esc(folderStatus.name)}" was configured but needs permission again (this can happen after a browser restart).`
                : 'Not set up. Pick the folder where this app is saved (or any folder) — a "backups" subfolder will be created inside it automatically, and every automatic backup writes a JSON backup and an XLSX export there silently with no download dialog.'
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

    <div class="card mb-16">
      <div class="card-title">${ic('tag')} Billing Rates</div>
      <div class="card-body">
        <div class="faint small mb-8">Tax is applied on top of a booking's after-overhead total. Overhead itself is set per Pricing Tier below — a lab/group with no tier assigned (Admin Mode &gt; Group Discounts) prices at the legacy Internal + External overhead sum this app used before named tiers existed. See a booking's "Cost &amp; Time Breakdown" for the full walkthrough.</div>
        <div class="grid cols-2">
          <div class="field"><label>Tax %</label><input type="number" min="0" step="any" class="input" id="cfg-tax" value="${esc(global.DB.getConfigNum('tax_pct', 0))}" /></div>
          <div class="field"><label>Currency Symbol</label><input class="input" id="cfg-currency" value="${esc(global.DB.getConfig('currency', '$'))}" maxlength="4" /></div>
        </div>
        <button class="btn btn-primary btn-sm mt-8" data-act="save-billing-rates">${ic('check')} Save Rates</button>
        <!-- Read-only: the "legacy Internal + External overhead sum" mentioned above and in the
             Pricing Tiers / Group Discounts cards is a resolved number nowhere else on screen —
             show it so the text isn't naming a figure the user can't see. Not editable; those two
             config values have no editor anywhere and this doesn't add one. -->
        <div class="faint small mt-8">Labs with no pricing tier are charged ${esc(String(global.DB.getConfigNum('overhead_internal', 0) + global.DB.getConfigNum('overhead_external', 0)))}% overhead — the Internal + External rates this app used before named tiers. Assign a tier below to replace it.</div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('tag')} Pricing Tiers</span></div>
        <button class="btn btn-primary btn-sm" data-act="add-tier">${ic('plus')} Add Tier</button>
      </div>
      <div class="card-body">
        <div class="faint small mb-8">Named overhead tiers a lab/group can be assigned to (see the Group Discounts editor under Admin Mode below), replacing the old flat Internal/External overhead split. An instrument's own rate can also be overridden per tier from its Edit Instrument screen (Admin Mode).</div>
        ${tiers.length ? `
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Name</th><th>Overhead %</th><th title="Labs/groups assigned this tier">Groups</th><th title="Bookings billed under this tier">Bookings</th><th style="text-align:right">Actions</th></tr></thead>
            <tbody>
              ${tiers.map((t) => `
                <tr class="${t.is_retired ? 'row-retired' : ''}">
                  <td style="font-weight:600">${esc(global.UI.retiredName(t.name, t.is_retired))}</td>
                  <td class="mono small">${esc(t.overhead_pct)}%</td>
                  <td><span class="badge neutral">${t.group_count}</span></td>
                  <td><span class="badge neutral">${t.booking_count}</span></td>
                  <td style="text-align:right;white-space:nowrap">
                    <button class="btn btn-ghost btn-xs" data-act="edit-tier" data-id="${t.id}" title="Edit Tier">${ic('edit')}</button>
                    ${t.is_retired
                      ? `<button class="btn btn-ghost btn-xs" data-act="restore-tier" data-id="${t.id}" title="Restore — make available for new group assignments again">${ic('rocket')}</button>`
                      : `<button class="btn btn-ghost btn-xs" data-act="retire-tier" data-id="${t.id}" title="Retire — keeps every group/booking billed under it">${ic('archive')}</button>`}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : emptyState('tag', 'No pricing tiers yet', 'Add a tier to assign labs a named overhead rate instead of the legacy Internal/External split.')}
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-title">${ic('tag')} Category Billing</div>
      <div class="card-body">
        <div class="faint small mb-8">What percent of a Facility Staff member's normal rate a booking category bills, and whether that category requires a facility staff assignee at all. Instrument time is unaffected — tiers and discounts already govern that. An existing booking keeps its saved price until it is edited and re-saved — like every other rate in the app, a re-save prices at the rules in force at that moment.</div>
        ${categoryPolicies.map((p) => `
          <div class="row mb-8 cat-policy-row" style="gap:14px;align-items:center;flex-wrap:wrap" data-category="${esc(p.category)}">
            <span class="small font-medium" style="min-width:130px">${esc(p.category)}</span>
            <div class="field" style="margin:0">
              <label class="small faint">Staff %</label>
              <input type="number" min="0" step="1" class="input cat-staff-pct" value="${esc(p.staff_pct)}" style="width:90px" ${p.category === 'training' && p.follow_assisted ? 'disabled' : ''} ${p.category === 'assisted session' ? 'oninput="window.App && window.App.syncCategoryBillingHints && window.App.syncCategoryBillingHints()"' : ''} />
            </div>
            <label class="row small" style="gap:6px;align-items:center;cursor:pointer">
              <input type="checkbox" class="cat-requires-staff" ${p.requires_staff ? 'checked' : ''} /> Requires facility staff
            </label>
            ${p.category === 'training' ? `
            <label class="row small" style="gap:6px;align-items:center;cursor:pointer">
              <input type="checkbox" class="cat-follow-assisted" ${p.follow_assisted ? 'checked' : ''} onchange="window.App && window.App.syncCategoryBillingHints && window.App.syncCategoryBillingHints()" /> Same as assisted session
            </label>
            <span class="cat-follow-hint small faint" ${p.follow_assisted ? '' : 'hidden'}>→ billing at assisted session's ${esc((categoryPolicies.find((q) => q.category === 'assisted session') || { staff_pct: 100 }).staff_pct)}% (the disabled value above is ignored)</span>` : ''}
          </div>`).join('')}
        <button class="btn btn-primary btn-sm mt-8" data-act="save-category-policies">${ic('check')} Save Category Billing</button>
      </div>
    </div>

    <div class="card mb-16">
      <div class="row mb-8">
        <div class="grow"><span class="card-title">${ic('tag')} Grants</span></div>
        <button class="btn btn-primary btn-sm" data-act="add-grant">${ic('plus')} Add Grant</button>
      </div>
      <div class="card-body">
        <div class="faint small mb-8">Grants are picked on bookings and projects for billing reconciliation. There is no stored grant name on those records — every display resolves fresh through the setting below, so a rename never leaves a stale string behind.</div>
        <div class="row mb-16" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="field" style="margin:0;max-width:220px">
            <label>Display Grants By</label>
            <select class="input" id="cfg-grant-display">
              <option value="name" ${grantDisplay === 'number' ? '' : 'selected'}>Name</option>
              <option value="number" ${grantDisplay === 'number' ? 'selected' : ''}>Number</option>
            </select>
          </div>
          <button class="btn btn-secondary btn-sm" data-act="save-grant-display">${ic('check')} Save Display Setting</button>
        </div>
        ${grants.length ? `
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Name</th><th>Number</th><th>Note</th><th title="People associated with this grant, for reference — bookings and projects are not restricted to them">Allowed Users</th><th style="text-align:right">Actions</th></tr></thead>
            <tbody>
              ${grants.map((g) => `
                <tr class="${g.is_retired ? 'row-retired' : ''}">
                  <td style="font-weight:600">${esc(global.UI.retiredName(g.name, g.is_retired))}</td>
                  <td class="mono small">${esc(g.number || '—')}</td>
                  <td class="faint small">${esc(g.note || '—')}</td>
                  <td><span class="badge neutral">${g.user_count}</span></td>
                  <td style="text-align:right;white-space:nowrap">
                    <button class="btn btn-ghost btn-xs" data-act="edit-grant" data-id="${g.id}" title="Edit Grant">${ic('edit')}</button>
                    ${g.is_retired
                      ? `<button class="btn btn-ghost btn-xs" data-act="restore-grant" data-id="${g.id}" title="Restore — make available for new work again">${ic('rocket')}</button>`
                      : `<button class="btn btn-ghost btn-xs" data-act="retire-grant" data-id="${g.id}" title="Retire — keeps every project/booking billed against it">${ic('archive')}</button>`}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : emptyState('tag', 'No grants yet', 'Add a grant to make it pickable on projects and bookings.')}
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-title">${ic('clock')} Cancellation Billing Rules</div>
      <div class="card-body">
        <div class="faint small mb-8">Controls whether a booking's cost still counts toward Project Costs when it's cancelled, based on whether the cancellation happens before or after the booking's scheduled start time. Admin Mode can still override this per booking for after-start cancellations.</div>
        <div class="grid cols-2">
          <div class="field">
            <label>Cancelling Before Start Time</label>
            <select class="input" id="cfg-cancel-before-charge">
              <option value="0" ${global.DB.getConfigNum('cancel_before_start_charge', 0) === 1 ? '' : 'selected'}>Charge Dropped</option>
              <option value="1" ${global.DB.getConfigNum('cancel_before_start_charge', 0) === 1 ? 'selected' : ''}>Charge Kept</option>
            </select>
          </div>
          <div class="field">
            <label>Cancelling After Start Time</label>
            <select class="input" id="cfg-cancel-after-charge">
              <option value="0" ${global.DB.getConfigNum('cancel_after_start_charge', 1) === 1 ? '' : 'selected'}>Charge Dropped</option>
              <option value="1" ${global.DB.getConfigNum('cancel_after_start_charge', 1) === 1 ? 'selected' : ''}>Charge Kept</option>
            </select>
          </div>
        </div>
        <button class="btn btn-primary btn-sm mt-8" data-act="save-cancellation-rules">${ic('check')} Save Cancellation Rules</button>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-title">${ic('settings')} Admin Mode</div>
      <div class="card-body">
        <div class="row mb-8">
          <div class="grow">
            <div style="font-weight:600">Admin Mode (this browser only)</div>
            <div class="faint small">Reveals the Group Discounts editor below and the manual per-booking discount override. This app has no accounts or login, so this is a local convenience switch, not real access control — anyone using this browser can turn it on.</div>
          </div>
          <label class="row" style="cursor:pointer;gap:8px">
            <input type="checkbox" id="pref-admin-mode" ${adminOn ? 'checked' : ''} data-act="toggle-admin-mode" />
            <span class="small font-medium">${adminOn ? 'On' : 'Off'}</span>
          </label>
        </div>
        ${adminOn ? `
        <div class="divider"></div>
        <div style="font-weight:600" class="mb-8">Group (Lab / Organization) Discounts &amp; Pricing Tiers</div>
        <div class="faint small mb-8">A standing discount percent per lab, auto-applied on a booking whose project's PI belongs to that lab (see the booking's Cost &amp; Time Breakdown) — applies to time-billed instrument cost only. The tier picks which overhead percent that same booking uses; "No tier (legacy)" keeps pricing at the Internal + External overhead sum from Billing Rates above.</div>
        ${orgs.length ? orgs.map((org) => {
          const currentTierId = global.DB.getGroupTierId(org);
          const tierOpts = global.DB.rows('SELECT id, name, is_retired FROM pricing_tiers WHERE is_retired=0 OR id=? ORDER BY is_retired, name', [currentTierId || 0]);
          return `
          <div class="row mb-8" style="gap:8px;align-items:center;flex-wrap:wrap">
            <span class="grow small">${esc(org)}</span>
            <select class="input group-tier-select" data-org="${esc(org)}" style="width:170px" data-tooltip="Pricing tier — decides this lab's overhead percent">
              <option value="">-- No tier (legacy) --</option>
              ${tierOpts.map((t) => `<option value="${t.id}" ${t.id === currentTierId ? 'selected' : ''}>${esc(global.UI.retiredName(t.name, t.is_retired))}</option>`).join('')}
            </select>
            <input type="number" min="0" max="100" step="1" class="input group-discount-input" data-org="${esc(org)}" value="${esc(global.DB.getGroupDiscount(org))}" style="width:80px" data-tooltip="Standing discount %" />
            <span class="faint small">% disc</span>
          </div>`; }).join('') : '<div class="faint small">No labs/organizations on record yet — add people with a Lab / Group / Company to set discounts and tiers for them.</div>'}
        ${orgs.length ? `<button class="btn btn-primary btn-sm mt-8" data-act="save-group-discounts">${ic('check')} Save Group Discounts &amp; Tiers</button>` : ''}
        <div class="divider"></div>
        <div style="font-weight:600" class="mb-8">Rename / Merge Lab</div>
        <div class="faint small mb-8">Labs are free-text names, so a typo forks a duplicate with its own discount row, pricing tier assignment and Reports line. Rename one everywhere at once — or merge it into an existing name if that name is already in use.</div>
        ${renameOrgs.length ? `
        <div class="row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="field" style="margin:0">
            <label>Existing Name</label>
            <select class="input" id="rename-org-from" style="min-width:200px">
              ${renameOrgs.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="margin:0">
            <label>New Name</label>
            <input class="input" id="rename-org-to" placeholder="e.g. Bio-Photonics Lab" style="min-width:200px" />
          </div>
          <button class="btn btn-primary btn-sm" data-act="rename-org">${ic('edit')} Rename</button>
        </div>` : '<div class="faint small">No labs/organizations on record yet.</div>'}
        ` : ''}
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
    setCalMode,
    settings,
    emptyState,
    navCalendar,
    calToday,
    statusBadge,
    // Hour-grid layout helpers factored out of the week calendar, reused by the per-instrument
    // resource timeline (calendarTimeline, roadmap 1.4): time->px, an event's {top,height} block,
    // and hour-row markup.
    calLayout: {
      HOUR_PX: CAL_HOUR_PX,
      DAY_HOURS: CAL_DAY_HOURS,
      timeToPx: calTimeToPx,
      eventBlockLayout: calEventBlockLayout,
      hourLabelsHtml: calHourLabelsHtml,
      hourSlotsHtml: calHourSlotsHtml
    }
  };

})(window);
