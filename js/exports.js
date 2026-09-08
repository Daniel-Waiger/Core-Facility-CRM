/* exports.js — robust XLSX, DOCX, and multi-page PDF generation */
(function (global) {
  'use strict';
  const DB = global.DB;
  const UI = global.UI;

  // The one place every export path resolves a grant row to display text — wraps DB.grantLabel
  // (the shared name/number-toggle logic app.js and views.js also read) with the "(Retired)"
  // suffix and this file's own fallback string, so no export path re-derives the name-vs-number
  // choice on its own. `row` is any record carrying grant_id/grant_name/grant_number/grant_is_retired
  // from a LEFT JOIN grants — every query below joins those columns rather than storing a
  // denormalized grant name, since the name/number toggle would make a frozen string wrong later.
  function grantLabelFor(row) {
    if (!row || !row.grant_id) return '—';
    // grant_id is a soft link (no FK), so a joined row can come back empty; an orphaned id must
    // still render the fallback rather than a blank cell.
    const label = DB.grantLabel({ name: row.grant_name, number: row.grant_number });
    return label ? UI.retiredName(label, row.grant_is_retired) : '—';
  }

  function loadProject(id) {
    const p = DB.row(`
      SELECT p.*, pe.name as pi_name, pe.email as pi_email, pe.organization as pi_org,
             g.name as grant_name, g.number as grant_number, g.is_retired as grant_is_retired
      FROM projects p
      LEFT JOIN people pe ON pe.id = p.pi_id
      LEFT JOIN grants g ON g.id = p.grant_id
      WHERE p.id=?`, [id]);
    if (!p) return null;

    const ppl = DB.rows(`
      SELECT pp.role, pe.name || CASE WHEN pe.is_retired THEN ' (Retired)' ELSE '' END AS name,
             pe.type, pe.organization, pe.department, pe.email, pe.is_staff, pe.rate
      FROM project_people pp
      JOIN people pe ON pe.id = pp.person_id
      WHERE pp.project_id=?
      ORDER BY pe.name`, [id]);

    const inst = DB.rows(`
      SELECT i.name || CASE WHEN i.is_retired THEN ' (Retired)' ELSE '' END AS name,
             i.kind, i.status, i.cost, i.cost_unit
      FROM project_instruments pi
      JOIN instruments i ON i.id = pi.instrument_id
      WHERE pi.project_id=?
      ORDER BY i.name`, [id]);

    const ms = DB.rows(`
      SELECT m.*,
             (SELECT GROUP_CONCAT(pe.name || CASE WHEN pe.is_retired THEN ' (Retired)' ELSE '' END, ', ') FROM milestone_owners mo JOIN people pe ON pe.id = mo.person_id WHERE mo.milestone_id = m.id) as owners,
             (SELECT GROUP_CONCAT(i.name || CASE WHEN i.is_retired THEN ' (Retired)' ELSE '' END, ', ') FROM milestone_instruments mi JOIN instruments i ON i.id = mi.instrument_id WHERE mi.milestone_id = m.id) as instruments
      FROM milestones m
      WHERE m.project_id=?
      ORDER BY m.due_date IS NULL, m.due_date ASC, m.id ASC`, [id]);

    const kv = DB.rows('SELECT * FROM kv WHERE project_id=? ORDER BY id ASC', [id]);
    const mtgs = DB.rows(`
      SELECT m.*, g.name as grant_name, g.number as grant_number, g.is_retired as grant_is_retired
      FROM meetings m
      LEFT JOIN grants g ON g.id = m.grant_id
      WHERE m.project_id=?
      ORDER BY m.date DESC, m.id DESC`, [id]);
    // Standalone service entries (roadmap 2.3) — no denormalized name columns, joined fresh here
    // same as mtgs' grant join above.
    const entries = DB.rows(`
      SELECT se.*, g.name as grant_name, g.number as grant_number, g.is_retired as grant_is_retired,
             pe.name as person_name, pe.is_retired as person_retired,
             i.name as instrument_name, i.is_retired as instrument_retired
      FROM service_entries se
      LEFT JOIN grants g ON g.id = se.grant_id
      LEFT JOIN people pe ON pe.id = se.person_id
      LEFT JOIN instruments i ON i.id = se.instrument_id
      WHERE se.project_id=?
      ORDER BY se.date DESC, se.id DESC`, [id]);
    const files = DB.rows('SELECT * FROM files WHERE project_id=? ORDER BY created_at DESC', [id]);
    // Research outputs (roadmap 3.3) — no denormalized columns, same as kv above.
    const outputs = DB.rows(`SELECT * FROM project_outputs WHERE project_id=? ORDER BY ${DB.outputEffDate()} DESC, id DESC`, [id]);
    const prog = DB.projectProgress(id);

    return { p, ppl, inst, ms, kv, mtgs, entries, files, outputs, prog };
  }

  function blobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ---------------- Rich-text (meeting notes) → export formats ----------------
     Meeting notes are stored as a small HTML subset (see UI.sanitizeHtml). Excel/CSV get plain
     text; Word and PDF preserve bold / italic / underline / bullet lists / font size. */
  function noteDoc(html) {
    return new DOMParser().parseFromString(UI.sanitizeHtml(html || ''), 'text/html').body;
  }
  const BLOCK_TAGS = { P: 1, DIV: 1, UL: 1, OL: 1, LI: 1 };
  // A cancelled booking still appears in every report — it is part of the record — flagged with
  // whether its charge still counts toward the project's costs.
  function bookingStatusSuffix(m) {
    if (!m.is_cancelled) return '';
    return m.billing_retained ? '  [CANCELLED — charge kept]' : '  [CANCELLED — charge waived]';
  }
  function htmlToPlainText(html) {
    let s = '';
    (function walk(node) {
      node.childNodes.forEach((c) => {
        if (c.nodeType === 3) { s += c.nodeValue.replace(/\s+/g, ' '); return; }
        if (c.nodeType !== 1) return;
        if (c.tagName === 'BR') { s += '\n'; return; }
        const block = BLOCK_TAGS[c.tagName];
        if (block && s && !s.endsWith('\n')) s += '\n';
        if (c.tagName === 'LI') s += '• ';
        walk(c);
        if (block && !s.endsWith('\n')) s += '\n';
      });
    })(noteDoc(html));
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Walk inline content into styled runs: [{text, bold, italic, underline, sizeEm}]
  function inlineRuns(node, style, out) {
    const s = Object.assign({}, style);
    if (node.nodeType === 1) {
      const tag = node.tagName;
      if (tag === 'B' || tag === 'STRONG') s.bold = true;
      if (tag === 'I' || tag === 'EM') s.italic = true;
      if (tag === 'U') s.underline = true;
      const fs = (node.getAttribute('style') || '').match(/font-size:\s*([0-9.]+)(em|px)/i);
      if (fs) s.sizeEm = fs[2].toLowerCase() === 'em' ? parseFloat(fs[1]) : parseFloat(fs[1]) / 13;
      if (tag === 'BR') { out.push({ br: true }); return; }
    }
    if (node.nodeType === 3) {
      if (node.nodeValue) out.push({ text: node.nodeValue.replace(/\s+/g, ' '), style: s });
      return;
    }
    node.childNodes.forEach((c) => inlineRuns(c, s, out));
  }

  function htmlToDocxParagraphs(html, docx) {
    const { Paragraph, TextRun } = docx;
    const body = noteDoc(html);
    const paras = [];
    function runsFor(node) {
      const raw = [];
      inlineRuns(node, {}, raw);
      return raw.filter((r) => r.text != null && r.text !== '').map((r) => new TextRun({
        text: r.text,
        bold: !!r.style.bold,
        italics: !!r.style.italic,
        underline: r.style.underline ? {} : undefined,
        size: r.style.sizeEm ? Math.round(r.style.sizeEm * 22) : undefined
      }));
    }
    function block(node, opts) {
      const children = runsFor(node);
      if (children.length) paras.push(new Paragraph(Object.assign({ children }, opts)));
    }
    body.childNodes.forEach((n) => {
      if (n.nodeType === 3 && n.nodeValue.trim()) { paras.push(new Paragraph({ children: [new TextRun(n.nodeValue.trim())] })); return; }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'UL' || n.tagName === 'OL') {
        n.querySelectorAll('li').forEach((li) => block(li, { bullet: { level: 0 } }));
      } else {
        block(n, {});
      }
    });
    if (!paras.length) {
      const t = htmlToPlainText(html);
      if (t) paras.push(new Paragraph({ children: [new TextRun(t)] }));
    }
    return paras;
  }

  // Render note HTML into a jsPDF doc. `cur` = { get y / set y, checkPage } so page-break
  // bookkeeping stays in sync with the caller's cursor. Returns the final y.
  function htmlToPdf(pdf, html, x, width, cur) {
    const body = noteDoc(html);
    const baseSize = 9;
    const checkPage = cur.checkPage;
    function emitBlock(node, indent, bullet) {
      const runs = [];
      inlineRuns(node, {}, runs);
      let line = '';
      let lineStyle = null;
      const startX = x + indent;
      const avail = width - indent;
      const flush = () => {
        if (line === '') return;
        checkPage(6);
        setStyle(lineStyle || {});
        pdf.text((bullet ? '• ' : '') + line, startX, cur.y);
        cur.y += 4.6;
        line = '';
      };
      const setStyle = (st) => {
        const fs = st.sizeEm ? Math.max(7, Math.round(baseSize * st.sizeEm)) : baseSize;
        pdf.setFontSize(fs);
        pdf.setFont('helvetica', st.bold && st.italic ? 'bolditalic' : st.bold ? 'bold' : st.italic ? 'italic' : 'normal');
      };
      runs.forEach((r) => {
        if (r.br) { flush(); return; }
        if (!r.text) return;
        lineStyle = r.style;
        r.text.split(/(\s+)/).forEach((word) => {
          if (!word) return;
          setStyle(r.style);
          const test = line + word;
          if (pdf.getTextWidth((bullet ? '• ' : '') + test) > avail && line !== '') {
            flush();
            bullet = false;               // wrapped continuation lines are not re-bulleted
            line = word.replace(/^\s+/, '');
          } else {
            line = test;
          }
        });
      });
      flush();
      pdf.setFontSize(baseSize);
      pdf.setFont('helvetica', 'normal');
    }
    body.childNodes.forEach((n) => {
      if (n.nodeType === 3 && n.nodeValue.trim()) { emitBlock(n, 0, false); return; }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'UL' || n.tagName === 'OL') {
        n.querySelectorAll('li').forEach((li) => emitBlock(li, 4, true));
      } else {
        emitBlock(n, 0, false);
      }
    });
    return cur.y;
  }

  /* ---------------- XLSX Export ---------------- */
  function exportXlsx(id) {
    const d = loadProject(id);
    if (!d) { UI.toast('Project not found', 'error'); return; }
    const XLSX = global.XLSX;
    if (!XLSX) { UI.toast('XLSX library not loaded', 'error'); return; }

    const wb = XLSX.utils.book_new();

    // Sheet 1: Project Overview & Metadata
    const summary = [
      ['CORE FACILITY PROJECT REPORT', ''],
      ['', ''],
      ['Project Title', d.p.title],
      ['Project Code', d.p.code],
      ['Status', d.p.status],
      ['Priority', d.p.priority || 'Medium'],
      ['Principal Investigator', d.p.pi_name || '—'],
      ['PI Email', d.p.pi_email || '—'],
      ['Funding Source', d.p.funding || '—'],
      ['Grant', grantLabelFor(d.p)],
      ['Modality / Technique', d.p.modality || '—'],
      ['Sample Type', d.p.sample || '—'],
      ['Flags / Risk', d.p.flags || '—'],
      ['Tags', d.p.tags || '—'],
      ['Start Date', d.p.start_date || '—'],
      ['End Date', d.p.end_date || '—'],
      ['Progress %', d.prog.pct + '%'],
      ['Milestones Completed', `${d.prog.done} of ${d.prog.total}`],
      ['Created At', d.p.created_at],
      ['Updated At', d.p.updated_at],
      ['Notes', d.p.notes || '—'],
      ['', ''],
      ['CUSTOM METADATA FIELDS', ''],
    ];

    if (d.kv.length) {
      d.kv.forEach((k) => summary.push([k.key, k.value]));
    } else {
      summary.push(['(No custom fields)', '']);
    }

    const ws1 = XLSX.utils.aoa_to_sheet(summary);
    ws1['!cols'] = [{ wch: 25 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Overview');

    // Sheet 2: Milestones
    const msRows = [['Milestone Name', 'Status', 'Due Date', 'Assigned Owners', 'Instruments', 'Notes']];
    d.ms.forEach((m) => {
      msRows.push([
        m.name,
        m.status,
        m.due_date || '—',
        m.owners || '—',
        m.instruments || '—',
        m.note || ''
      ]);
    });
    const ws2 = XLSX.utils.aoa_to_sheet(msRows);
    ws2['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 25 }, { wch: 25 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Milestones');

    // Sheet 3: Team
    const teamRows = [['Member Name', 'Role in Project', 'Position / Type', 'Lab / Group / Company', 'Department', 'Email', 'Facility Staff', 'Rate/hr']];
    d.ppl.forEach((pe) => {
      teamRows.push([pe.name, pe.role || '—', pe.type || '—', pe.organization || '—', pe.department || '—', pe.email || '—', pe.is_staff ? 'Yes' : 'No', pe.is_staff ? (pe.rate || 0) : '—']);
    });
    const ws3 = XLSX.utils.aoa_to_sheet(teamRows);
    ws3['!cols'] = [{ wch: 25 }, { wch: 25 }, { wch: 20 }, { wch: 30 }, { wch: 22 }, { wch: 30 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Team');

    // Sheet 4: Instruments
    const instRows = [['Instrument Name', 'Kind / Modality', 'Status', 'Cost', 'Unit']];
    d.inst.forEach((i) => {
      instRows.push([i.name, i.kind || '—', i.status || '—', i.cost || 0, i.cost_unit || 'time']);
    });
    const ws4 = XLSX.utils.aoa_to_sheet(instRows);
    ws4['!cols'] = [{ wch: 30 }, { wch: 25 }, { wch: 15 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws4, 'Instruments');

    // Sheet 5: Meetings
    const mtRows = [['Meeting Title', 'Grant', 'Tier', 'Category', 'Status', 'Date', 'Start', 'End', 'Attendees', 'Notes', 'Action Items', 'Subtotal', 'Before Tax', 'Total Cost']];
    d.mtgs.forEach((m) => {
      // A cancelled booking stays in the report — it is part of the record — with its status and
      // whether its charge still counts, so a total can be reconciled against the rows.
      const status = m.is_cancelled ? (m.billing_retained ? 'Cancelled (charged)' : 'Cancelled (waived)') : 'Booked';
      const counts = !(m.is_cancelled && !m.billing_retained);
      mtRows.push([m.title, grantLabelFor(m), DB.tierLabel(m.tier_id), m.category || '—', status, m.date || '—', m.start_time || '—', m.end_time || '—', m.attendees || '—', htmlToPlainText(m.note), m.actions || '', m.subtotal || 0, m.total_before_tax || 0, counts ? (m.total_cost || 0) : 0]);
    });
    const ws5 = XLSX.utils.aoa_to_sheet(mtRows);
    ws5['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 40 }, { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws5, 'Meetings');

    // Sheet 5b: Service Entries (roadmap 2.3) — standalone billable work outside any booking.
    const seRows = [['Description', 'Staff', 'Instrument', 'Grant', 'Status', 'Date', 'Qty', 'Unit', 'Rate', 'Total Cost']];
    d.entries.forEach((e) => {
      const status = e.is_cancelled ? (e.billing_retained ? 'Cancelled (charged)' : 'Cancelled (waived)') : 'Active';
      const counts = !(e.is_cancelled && !e.billing_retained);
      seRows.push([
        e.description,
        e.person_name ? UI.retiredName(e.person_name, e.person_retired) : '—',
        e.instrument_name ? UI.retiredName(e.instrument_name, e.instrument_retired) : '—',
        grantLabelFor(e), status, e.date || '—', e.qty || 0, e.unit || '—', e.rate || 0,
        counts ? (e.total_cost || 0) : 0
      ]);
    });
    const ws5b = XLSX.utils.aoa_to_sheet(seRows);
    ws5b['!cols'] = [{ wch: 30 }, { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws5b, 'Service Entries');

    // Sheet 6: Files
    const fRows = [['File Name', 'Kind', 'Path / Link', 'Logged At']];
    d.files.forEach((f) => {
      fRows.push([f.name, f.kind, f.path || '—', f.created_at]);
    });
    const ws6 = XLSX.utils.aoa_to_sheet(fRows);
    ws6['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 40 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws6, 'Files');

    // Sheet 7: Research Outputs (roadmap 3.3) — the funnel's exit stage.
    const outRows = [['Type', 'Title', 'Reference', 'Date', 'Note']];
    d.outputs.forEach((o) => {
      outRows.push([o.type, o.title, o.reference || '—', o.date || '—', o.note || '']);
    });
    const ws7 = XLSX.utils.aoa_to_sheet(outRows);
    ws7['!cols'] = [{ wch: 16 }, { wch: 40 }, { wch: 40 }, { wch: 12 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws7, 'Research Outputs');

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    blobDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${d.p.code}_${d.p.title.replace(/[^a-z0-9_-]/gi, '_')}.xlsx`);
    UI.toast('Exported XLSX report');
  }

  /* ---------------- DOCX Export ---------------- */
  function exportDocx(id) {
    const d = loadProject(id);
    if (!d) { UI.toast('Project not found', 'error'); return; }
    const docx = global.docx;
    if (!docx) { UI.toast('DOCX library not loaded', 'error'); return; }

    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = docx;

    const children = [
      new Paragraph({ text: d.p.title, heading: HeadingLevel.TITLE }),
      new Paragraph({ text: `Project Code: ${d.p.code}  •  Core Facility Report`, heading: HeadingLevel.SUBTITLE }),
      new Paragraph({ text: `Status: ${d.p.status}   |   Priority: ${d.p.priority || 'Medium'}   |   Progress: ${d.prog.pct}% (${d.prog.done}/${d.prog.total} milestones)` }),
      new Paragraph({ text: `Principal Investigator: ${d.p.pi_name || '—'}   |   Funding: ${d.p.funding || '—'}   |   Modality: ${d.p.modality || '—'}` }),
      new Paragraph({ text: `Sample: ${d.p.sample || '—'}   |   Timeline: ${UI.fmtDate(d.p.start_date)} → ${UI.fmtDate(d.p.end_date)}` }),
      new Paragraph({ text: `Grant: ${grantLabelFor(d.p)}` }),
    ];

    if (d.p.notes) {
      children.push(new Paragraph({ text: 'Project Notes', heading: HeadingLevel.HEADING_2 }));
      children.push(new Paragraph({ text: d.p.notes }));
    }

    if (d.kv.length) {
      children.push(new Paragraph({ text: 'Custom Metadata', heading: HeadingLevel.HEADING_2 }));
      d.kv.forEach((k) => {
        children.push(new Paragraph({ text: `• ${k.key}: ${k.value}` }));
      });
    }

    // Milestones
    children.push(new Paragraph({ text: 'Milestones & Deliverables', heading: HeadingLevel.HEADING_2 }));
    if (d.ms.length) {
      d.ms.forEach((m) => {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `[${m.status.toUpperCase()}] `, bold: true }),
            new TextRun({ text: `${m.name} `, bold: true }),
            new TextRun({ text: `(Due: ${UI.fmtDate(m.due_date)}) ` }),
            new TextRun({ text: m.owners ? `Owners: ${m.owners} ` : '', italics: true }),
            new TextRun({ text: m.instruments ? `Instruments: ${m.instruments} ` : '', italics: true }),
            new TextRun({ text: m.note ? `— ${m.note}` : '' }),
          ]
        }));
      });
    } else {
      children.push(new Paragraph({ text: 'No milestones recorded.' }));
    }

    // Team
    children.push(new Paragraph({ text: 'Team & Collaborators', heading: HeadingLevel.HEADING_2 }));
    if (d.ppl.length) {
      d.ppl.forEach((pe) => {
        const orgStr = [pe.organization, pe.department].filter(Boolean).join(' • ');
        children.push(new Paragraph({ text: `• ${pe.name} (${pe.type}${orgStr ? ' • ' + orgStr : ''}) ${pe.role ? '— Role: ' + pe.role : ''} ${pe.email ? '<' + pe.email + '>' : ''}${pe.is_staff ? ' — Facility Staff, ' + (pe.rate || 0) + '/hr' : ''}` }));
      });
    } else {
      children.push(new Paragraph({ text: 'No team members assigned.' }));
    }

    // Instruments
    children.push(new Paragraph({ text: 'Assigned Instruments', heading: HeadingLevel.HEADING_2 }));
    if (d.inst.length) {
      d.inst.forEach((i) => {
        children.push(new Paragraph({ text: `• ${i.name} (${i.kind || 'Facility Instrument'}) — Status: ${i.status} — Cost: ${i.cost || 0} per ${i.cost_unit || 'time'}` }));
      });
    } else {
      children.push(new Paragraph({ text: 'No instruments assigned.' }));
    }

    // Meetings
    children.push(new Paragraph({ text: 'Meetings & Discussions', heading: HeadingLevel.HEADING_2 }));
    if (d.mtgs.length) {
      d.mtgs.forEach((m) => {
        const timeStr = m.start_time ? ` ${m.start_time}${m.end_time ? '–' + m.end_time : ''}` : '';
        const catStr = m.category ? ` [${m.category}]` : '';
        children.push(new Paragraph({ text: `${UI.fmtDate(m.date)}${timeStr}: ${m.title}${catStr}${bookingStatusSuffix(m)}`, heading: HeadingLevel.HEADING_3 }));
        if (m.grant_id) children.push(new Paragraph({ text: `Grant: ${grantLabelFor(m)}`, italics: true }));
        if (m.attendees) children.push(new Paragraph({ text: `Attendees: ${m.attendees}`, italics: true }));
        if (m.note) htmlToDocxParagraphs(m.note, docx).forEach((p) => children.push(p));
        if (m.actions) children.push(new Paragraph({ text: `Actions: ${m.actions}`, bold: true }));
        if (m.total_cost) {
          if (m.tier_id) children.push(new Paragraph({ text: `Tier: ${DB.tierLabel(m.tier_id)}`, italics: true }));
          children.push(new Paragraph({ text: `Cost: Subtotal ${m.subtotal || 0}, Before Tax ${m.total_before_tax || 0}, Total ${m.total_cost}`, bold: true }));
        }
      });
    } else {
      children.push(new Paragraph({ text: 'No meetings logged.' }));
    }

    // Service Entries (roadmap 2.3)
    children.push(new Paragraph({ text: 'Service Entries', heading: HeadingLevel.HEADING_2 }));
    if (d.entries.length) {
      d.entries.forEach((e) => {
        children.push(new Paragraph({ text: `${UI.fmtDate(e.date)}: ${e.description}${bookingStatusSuffix(e)}`, heading: HeadingLevel.HEADING_3 }));
        if (e.person_name) children.push(new Paragraph({ text: `Staff: ${UI.retiredName(e.person_name, e.person_retired)}`, italics: true }));
        if (e.instrument_name) children.push(new Paragraph({ text: `Instrument: ${UI.retiredName(e.instrument_name, e.instrument_retired)}`, italics: true }));
        if (e.grant_id) children.push(new Paragraph({ text: `Grant: ${grantLabelFor(e)}`, italics: true }));
        children.push(new Paragraph({ text: `Qty: ${e.qty || 0} ${e.unit || ''}   |   Rate: ${e.rate || 0}   |   Total: ${e.total_cost || 0}`, bold: true }));
      });
    } else {
      children.push(new Paragraph({ text: 'No service entries recorded.' }));
    }

    // Research Outputs (roadmap 3.3)
    children.push(new Paragraph({ text: 'Research Outputs', heading: HeadingLevel.HEADING_2 }));
    if (d.outputs.length) {
      d.outputs.forEach((o) => {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `[${o.type.toUpperCase()}] `, bold: true }),
            new TextRun({ text: `${o.title} `, bold: true }),
            new TextRun({ text: o.date ? `(${UI.fmtDate(o.date)}) ` : '' }),
            new TextRun({ text: o.reference ? `${o.reference} ` : '', italics: true }),
            new TextRun({ text: o.note ? `— ${o.note}` : '' }),
          ]
        }));
      });
    } else {
      children.push(new Paragraph({ text: 'No research outputs recorded.' }));
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: children
      }]
    });

    Packer.toBlob(doc).then((blob) => {
      blobDownload(blob, `${d.p.code}_${d.p.title.replace(/[^a-z0-9_-]/gi, '_')}.docx`);
      UI.toast('Exported DOCX report');
    });
  }

  /* ---------------- Multi-Page PDF Export ---------------- */
  function exportPdf(id) {
    const d = loadProject(id);
    if (!d) { UI.toast('Project not found', 'error'); return; }
    const jsPDF = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDF) { UI.toast('jsPDF library not loaded', 'error'); return; }

    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageHeight = 280;
    const margin = 14;
    let y = 20;

    function checkPage(need = 10) {
      if (y + need > pageHeight) {
        pdf.addPage();
        y = 20;
        // Header on extra pages
        pdf.setFontSize(8);
        pdf.setTextColor(140, 150, 165);
        pdf.text(`Core Facility Tracker • ${d.p.code} • ${d.p.title}`, margin, 10);
        pdf.line(margin, 12, 210 - margin, 12);
        pdf.setTextColor(20, 20, 20);
      }
    }

    function addHeading(text) {
      checkPage(14);
      y += 4;
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(79, 70, 229); // Primary indigo
      pdf.text(text, margin, y);
      y += 2;
      pdf.setDrawColor(226, 232, 240);
      pdf.line(margin, y, 210 - margin, y);
      y += 6;
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(20, 20, 20);
    }

    // Title
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.text(d.p.title, margin, y);
    y += 7;

    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100, 116, 139);
    pdf.text(`Core Facility Project Report • Code: ${d.p.code} • Created: ${UI.fmtDate(d.p.created_at)}`, margin, y);
    y += 8;

    // Summary Box
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(margin, y, 210 - (margin * 2), 32, 2, 2, 'FD');
    y += 6;
    pdf.setFontSize(9);
    pdf.setTextColor(20, 20, 20);
    pdf.text(`Status: ${d.p.status}   |   Priority: ${d.p.priority || 'Medium'}   |   Progress: ${d.prog.pct}% (${d.prog.done}/${d.prog.total} milestones done)`, margin + 4, y);
    y += 6;
    pdf.text(`Principal Investigator: ${d.p.pi_name || '—'}   |   Funding: ${d.p.funding || '—'}   |   Modality: ${d.p.modality || '—'}`, margin + 4, y);
    y += 6;
    pdf.text(`Sample: ${d.p.sample || '—'}   |   Timeline: ${UI.fmtDate(d.p.start_date)} → ${UI.fmtDate(d.p.end_date)}`, margin + 4, y);
    y += 6;
    pdf.text(`Grant: ${grantLabelFor(d.p)}`, margin + 4, y);
    y += 12;

    if (d.p.notes) {
      addHeading('Project Notes');
      pdf.setFontSize(9);
      const splitNotes = pdf.splitTextToSize(d.p.notes, 210 - (margin * 2));
      for (const line of splitNotes) {
        checkPage(5);
        pdf.text(line, margin, y);
        y += 5;
      }
    }

    // Milestones
    addHeading('Milestones & Deliverables');
    if (d.ms.length) {
      pdf.setFontSize(9);
      d.ms.forEach((m) => {
        checkPage(12);
        const statusPrefix = m.status === 'done' ? '[✓ DONE]' : m.status === 'in-progress' ? '[IN PROGRESS]' : '[PENDING]';
        pdf.setFont('helvetica', 'bold');
        pdf.text(`${statusPrefix} ${m.name}`, margin, y);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`Due: ${UI.fmtDate(m.due_date)}`, 160, y);
        y += 5;
        if (m.owners || m.instruments || m.note) {
          const detail = [
            m.owners ? `Owners: ${m.owners}` : '',
            m.instruments ? `Instruments: ${m.instruments}` : '',
            m.note ? `Note: ${m.note}` : ''
          ].filter(Boolean).join(' • ');
          pdf.setFontSize(8);
          pdf.setTextColor(100, 116, 139);
          pdf.text(detail, margin + 4, y);
          pdf.setTextColor(20, 20, 20);
          pdf.setFontSize(9);
          y += 5;
        }
      });
    } else {
      pdf.setFontSize(9);
      pdf.text('No milestones recorded.', margin, y);
      y += 6;
    }

    // Team
    addHeading('Team & Collaborators');
    if (d.ppl.length) {
      pdf.setFontSize(9);
      d.ppl.forEach((pe) => {
        checkPage(6);
        const orgStr = [pe.organization, pe.department].filter(Boolean).join(' • ');
        pdf.text(`• ${pe.name} (${pe.type}${orgStr ? ' • ' + orgStr : ''}) ${pe.role ? '— Role: ' + pe.role : ''} ${pe.email ? '<' + pe.email + '>' : ''}${pe.is_staff ? ' — Facility Staff, ' + (pe.rate || 0) + '/hr' : ''}`, margin, y);
        y += 5;
      });
    } else {
      pdf.setFontSize(9);
      pdf.text('No team members assigned.', margin, y);
      y += 6;
    }

    // Instruments
    addHeading('Assigned Instruments');
    if (d.inst.length) {
      pdf.setFontSize(9);
      d.inst.forEach((i) => {
        checkPage(6);
        pdf.text(`• ${i.name} (${i.kind || 'Facility Instrument'}) — Status: ${i.status} — Cost: ${i.cost || 0} per ${i.cost_unit || 'time'}`, margin, y);
        y += 5;
      });
    } else {
      pdf.setFontSize(9);
      pdf.text('No instruments assigned.', margin, y);
      y += 6;
    }

    // Meetings
    if (d.mtgs.length) {
      addHeading('Meetings & Notes');
      pdf.setFontSize(9);
      d.mtgs.forEach((m) => {
        checkPage(14);
        pdf.setFont('helvetica', 'bold');
        const timeStr = m.start_time ? ` ${m.start_time}${m.end_time ? '–' + m.end_time : ''}` : '';
        const catStr = m.category ? ` [${m.category}]` : '';
        pdf.text(`${UI.fmtDate(m.date)}${timeStr}: ${m.title}${catStr}${bookingStatusSuffix(m)}`, margin, y);
        pdf.setFont('helvetica', 'normal');
        y += 5;
        if (m.grant_id) {
          pdf.setFontSize(8);
          pdf.setTextColor(100, 116, 139);
          pdf.text(`Grant: ${grantLabelFor(m)}`, margin + 4, y);
          pdf.setTextColor(20, 20, 20);
          pdf.setFontSize(9);
          y += 4;
        }
        if (m.attendees) {
          pdf.setFontSize(8);
          pdf.setTextColor(100, 116, 139);
          pdf.text(`Attendees: ${m.attendees}`, margin + 4, y);
          pdf.setTextColor(20, 20, 20);
          pdf.setFontSize(9);
          y += 4;
        }
        if (m.note) {
          htmlToPdf(pdf, m.note, margin + 4, 210 - margin * 2 - 4, {
            get y() { return y; }, set y(v) { y = v; }, checkPage
          });
          pdf.setFontSize(9);
        }
        if (m.actions) {
          checkPage(6);
          pdf.setFont('helvetica', 'bold');
          pdf.text(`Actions: ${m.actions}`, margin + 4, y);
          pdf.setFont('helvetica', 'normal');
          y += 5;
        }
        if (m.total_cost) {
          if (m.tier_id) {
            checkPage(5);
            pdf.setFontSize(8);
            pdf.setTextColor(100, 116, 139);
            pdf.text(`Tier: ${DB.tierLabel(m.tier_id)}`, margin + 4, y);
            pdf.setTextColor(20, 20, 20);
            pdf.setFontSize(9);
            y += 4;
          }
          checkPage(6);
          pdf.setFont('helvetica', 'bold');
          pdf.text(`Cost: Subtotal ${m.subtotal || 0}, Before Tax ${m.total_before_tax || 0}, Total ${m.total_cost}`, margin + 4, y);
          pdf.setFont('helvetica', 'normal');
          y += 5;
        }
        y += 2;
      });
    }

    // Service Entries (roadmap 2.3)
    if (d.entries.length) {
      addHeading('Service Entries');
      pdf.setFontSize(9);
      d.entries.forEach((e) => {
        checkPage(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`${UI.fmtDate(e.date)}: ${e.description}${bookingStatusSuffix(e)}`, margin, y);
        pdf.setFont('helvetica', 'normal');
        y += 5;
        const bits = [];
        if (e.person_name) bits.push(`Staff: ${UI.retiredName(e.person_name, e.person_retired)}`);
        if (e.instrument_name) bits.push(`Instrument: ${UI.retiredName(e.instrument_name, e.instrument_retired)}`);
        if (e.grant_id) bits.push(`Grant: ${grantLabelFor(e)}`);
        if (bits.length) {
          pdf.setFontSize(8);
          pdf.setTextColor(100, 116, 139);
          pdf.text(bits.join('   |   '), margin + 4, y);
          pdf.setTextColor(20, 20, 20);
          pdf.setFontSize(9);
          y += 4;
        }
        checkPage(6);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`Qty: ${e.qty || 0} ${e.unit || ''}   |   Rate: ${e.rate || 0}   |   Total: ${e.total_cost || 0}`, margin + 4, y);
        pdf.setFont('helvetica', 'normal');
        y += 5;
        y += 2;
      });
    }

    // Research Outputs (roadmap 3.3)
    if (d.outputs.length) {
      addHeading('Research Outputs');
      pdf.setFontSize(9);
      d.outputs.forEach((o) => {
        checkPage(12);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`[${o.type.toUpperCase()}] ${o.title}${o.date ? ' (' + UI.fmtDate(o.date) + ')' : ''}`, margin, y);
        pdf.setFont('helvetica', 'normal');
        y += 5;
        if (o.reference || o.note) {
          const detail = [o.reference, o.note].filter(Boolean).join(' — ');
          pdf.setFontSize(8);
          pdf.setTextColor(100, 116, 139);
          pdf.text(detail, margin + 4, y);
          pdf.setTextColor(20, 20, 20);
          pdf.setFontSize(9);
          y += 5;
        }
      });
    }

    // Custom Metadata
    if (d.kv.length) {
      addHeading('Custom Metadata Fields');
      pdf.setFontSize(9);
      d.kv.forEach((k) => {
        checkPage(6);
        pdf.text(`• ${k.key}: ${k.value}`, margin, y);
        y += 5;
      });
    }

    // Add page numbers
    const totalPages = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(140, 150, 165);
      pdf.text(`Page ${i} of ${totalPages}`, 210 / 2, 290, { align: 'center' });
    }

    pdf.save(`${d.p.code}_${d.p.title.replace(/[^a-z0-9_-]/gi, '_')}.pdf`);
    UI.toast('Exported formatted PDF report');
  }

  /* ---------------- Facility-wide XLSX Export (all projects) ----------------
     buildAllXlsxBlob() does the actual workbook construction and returns the Blob; exportAllXlsx()
     is the user-initiated entry point (build + prompt-download). The silent periodic auto-backup
     (app.js's performBackupDownload) calls buildAllXlsxBlob() directly so it never fires an
     unprompted browser download. */
  function buildAllXlsxBlob() {
    const XLSX = global.XLSX;
    if (!XLSX) return null;

    const projects = DB.rows(`
      SELECT p.*, pe.name as pi_name, pe.email as pi_email,
             g.name as grant_name, g.number as grant_number, g.is_retired as grant_is_retired
      FROM projects p
      LEFT JOIN people pe ON pe.id = p.pi_id
      LEFT JOIN grants g ON g.id = p.grant_id
      ORDER BY p.updated_at DESC`);

    if (!projects.length) return null;

    const wb = XLSX.utils.book_new();

    // Sheet 1: Projects overview (one row per project)
    const projRows = [[
      'Code', 'Title', 'Status', 'Priority', 'PI', 'PI Email', 'Funding', 'Grant', 'Modality',
      'Sample', 'Flags', 'Tags', 'Start Date', 'End Date', 'Progress %', 'Milestones', 'Created', 'Updated'
    ]];
    projects.forEach((p) => {
      const prog = DB.projectProgress(p.id);
      projRows.push([
        p.code, p.title, p.status, p.priority || 'Medium', p.pi_name || '—', p.pi_email || '—',
        p.funding || '—', grantLabelFor(p), p.modality || '—', p.sample || '—', p.flags || '—', p.tags || '—',
        p.start_date || '—', p.end_date || '—', prog.pct + '%', `${prog.done} of ${prog.total}`,
        p.created_at, p.updated_at
      ]);
    });
    const wsP = XLSX.utils.aoa_to_sheet(projRows);
    wsP['!cols'] = [{ wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 26 }, { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsP, 'Projects');

    // Sheet 2: All milestones (across every project)
    const msRows = [['Project Code', 'Project', 'Milestone', 'Status', 'Due Date', 'Owners', 'Instruments', 'Notes']];
    DB.rows(`
      SELECT m.*, p.code as project_code, p.title as project_title,
             (SELECT GROUP_CONCAT(pe.name, ', ') FROM milestone_owners mo JOIN people pe ON pe.id = mo.person_id WHERE mo.milestone_id = m.id) as owners,
             (SELECT GROUP_CONCAT(i.name, ', ') FROM milestone_instruments mi JOIN instruments i ON i.id = mi.instrument_id WHERE mi.milestone_id = m.id) as instruments
      FROM milestones m JOIN projects p ON p.id = m.project_id
      ORDER BY p.code ASC, m.due_date IS NULL, m.due_date ASC, m.id ASC`).forEach((m) => {
      msRows.push([m.project_code, m.project_title, m.name, m.status, m.due_date || '—', m.owners || '—', m.instruments || '—', m.note || '']);
    });
    const wsM = XLSX.utils.aoa_to_sheet(msRows);
    wsM['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 24 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsM, 'Milestones');

    // Sheet 3: People
    const peopleRows = [['Name', 'Status', 'Type', 'Lab / Group / Company', 'Department', 'Email', 'Notes', 'Facility Staff', 'Rate/hr']];
    DB.rows('SELECT name, type, organization, department, email, note, is_staff, rate, is_retired FROM people ORDER BY is_retired, name').forEach((pe) => {
      peopleRows.push([pe.name, pe.is_retired ? 'Retired' : 'Active', pe.type || '—', pe.organization || '—', pe.department || '—', pe.email || '—', pe.note || '', pe.is_staff ? 'Yes' : 'No', pe.is_staff ? (pe.rate || 0) : '—']);
    });
    const wsPe = XLSX.utils.aoa_to_sheet(peopleRows);
    wsPe['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 14 }, { wch: 30 }, { wch: 22 }, { wch: 30 }, { wch: 40 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsPe, 'People');

    // Sheet 4: Instruments
    const instRows = [['Name', 'In Service', 'Kind / Modality', 'Status', 'Location', 'Notes', 'Supervisor(s)', 'Cost', 'Unit']];
    DB.rows(`
      SELECT i.name, i.kind, i.status, i.location, i.note, i.cost, i.cost_unit, i.is_retired,
             (SELECT GROUP_CONCAT(pe.name || CASE WHEN pe.is_retired THEN ' (Retired)' ELSE '' END, ', ')
                FROM instrument_staff ist JOIN people pe ON pe.id = ist.person_id
                WHERE ist.instrument_id = i.id) as supervisors
      FROM instruments i ORDER BY i.is_retired, i.name`).forEach((i) => {
      instRows.push([i.name, i.is_retired ? 'Retired' : 'Active', i.kind || '—', i.status || '—', i.location || '—', i.note || '', i.supervisors || '—', i.cost || 0, i.cost_unit || 'time']);
    });
    const wsI = XLSX.utils.aoa_to_sheet(instRows);
    wsI['!cols'] = [{ wch: 30 }, { wch: 11 }, { wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 40 }, { wch: 24 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsI, 'Instruments');

    // Sheet 5: All meetings/bookings (project-less "facility-wide" bookings included)
    const mtRows = [['Project Code', 'Project', 'Meeting', 'Grant', 'Category', 'Status', 'Date', 'Start', 'End', 'Attendees', 'Link', 'Notes', 'Action Items']];
    DB.rows(`
      SELECT mt.*, p.code as project_code, p.title as project_title,
             g.name as grant_name, g.number as grant_number, g.is_retired as grant_is_retired
      FROM meetings mt
      LEFT JOIN projects p ON p.id = mt.project_id
      LEFT JOIN grants g ON g.id = mt.grant_id
      ORDER BY mt.date DESC, mt.id DESC`).forEach((m) => {
      mtRows.push([m.project_code || '—', m.project_title || 'Facility-wide', m.title, grantLabelFor(m), m.category || '—',
        m.is_cancelled ? (m.billing_retained ? 'Cancelled (charged)' : 'Cancelled (waived)') : 'Booked',
        m.date || '—', m.start_time || '—', m.end_time || '—', m.attendees || '—', m.link || '—', htmlToPlainText(m.note), m.actions || '']);
    });
    const wsMt = XLSX.utils.aoa_to_sheet(mtRows);
    wsMt['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 26 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 30 }, { wch: 40 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsMt, 'Meetings'); // !cols is intentionally shorter than the header row — SheetJS just applies its default width past the end

    // Sheet 6: Bookings & Costs — the invoice-oriented view: what was booked, who worked it,
    // and the stored cost snapshot for each booking (discount → overhead → tax, as computed by
    // computeBookingBOM in app.js at the time the booking was saved).
    const bcRows = [['Project Code', 'Project', 'Booking', 'Grant', 'Tier', 'Status', 'Date', 'Start', 'End', 'Instruments', 'Facility Staff', 'Subtotal', 'Group Disc %', 'Manual Disc %', 'Before Tax', 'Total Cost']];
    DB.rows(`
      SELECT mt.*, p.code as project_code, p.title as project_title,
             g.name as grant_name, g.number as grant_number, g.is_retired as grant_is_retired,
             (SELECT GROUP_CONCAT(i.name, ', ') FROM meeting_instruments mi JOIN instruments i ON i.id = mi.instrument_id WHERE mi.meeting_id = mt.id) as instruments,
             (SELECT GROUP_CONCAT(pe.name, ', ') FROM meeting_staff ms JOIN people pe ON pe.id = ms.person_id WHERE ms.meeting_id = mt.id) as staff
      FROM meetings mt
      LEFT JOIN projects p ON p.id = mt.project_id
      LEFT JOIN grants g ON g.id = mt.grant_id
      ORDER BY mt.date DESC, mt.id DESC`).forEach((m) => {
      // A waived cancellation contributes 0 to the Total Cost column so the column sums to what
      // the facility actually bills; the Status column says why.
      const counts = !(m.is_cancelled && !m.billing_retained);
      bcRows.push([
        m.project_code || '—', m.project_title || 'Facility-wide', m.title, grantLabelFor(m), DB.tierLabel(m.tier_id),
        m.is_cancelled ? (m.billing_retained ? 'Cancelled (charged)' : 'Cancelled (waived)') : 'Booked',
        m.date || '—', m.start_time || '—', m.end_time || '—',
        m.instruments || '—', m.staff || '—', m.subtotal || 0, m.group_discount_pct || 0, m.discount_pct || 0,
        m.total_before_tax || 0, counts ? (m.total_cost || 0) : 0
      ]);
    });
    const wsBc = XLSX.utils.aoa_to_sheet(bcRows);
    wsBc['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 26 }, { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsBc, 'Bookings & Costs');

    // Sheet 7: Service Entries (roadmap 2.3) — standalone billable work outside any booking,
    // across every project plus facility-wide (project-less) entries, same shape as the Meetings
    // sheet above.
    const seRows = [['Project Code', 'Project', 'Description', 'Staff', 'Instrument', 'Grant', 'Status', 'Date', 'Qty', 'Unit', 'Rate', 'Total Cost']];
    DB.rows(`
      SELECT se.*, p.code as project_code, p.title as project_title,
             pe.name as person_name, pe.is_retired as person_retired,
             i.name as instrument_name, i.is_retired as instrument_retired,
             g.name as grant_name, g.number as grant_number, g.is_retired as grant_is_retired
      FROM service_entries se
      LEFT JOIN projects p ON p.id = se.project_id
      LEFT JOIN people pe ON pe.id = se.person_id
      LEFT JOIN instruments i ON i.id = se.instrument_id
      LEFT JOIN grants g ON g.id = se.grant_id
      ORDER BY se.date DESC, se.id DESC`).forEach((e) => {
      const counts = !(e.is_cancelled && !e.billing_retained);
      seRows.push([
        e.project_code || '—', e.project_title || 'Facility-wide', e.description,
        e.person_name ? UI.retiredName(e.person_name, e.person_retired) : '—',
        e.instrument_name ? UI.retiredName(e.instrument_name, e.instrument_retired) : '—',
        grantLabelFor(e),
        e.is_cancelled ? (e.billing_retained ? 'Cancelled (charged)' : 'Cancelled (waived)') : 'Active',
        e.date || '—', e.qty || 0, e.unit || '—', e.rate || 0, counts ? (e.total_cost || 0) : 0
      ]);
    });
    const wsSe = XLSX.utils.aoa_to_sheet(seRows);
    wsSe['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 30 }, { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsSe, 'Service Entries');

    // Sheet 8: Research Outputs (roadmap 3.3) — across every project, same "Project Code /
    // Project" leading columns as the Meetings/Service Entries sheets above.
    const outRows = [['Project Code', 'Project', 'Type', 'Title', 'Reference', 'Date', 'Note']];
    DB.rows(`
      SELECT po.*, p.code as project_code, p.title as project_title
      FROM project_outputs po
      JOIN projects p ON p.id = po.project_id
      ORDER BY ${DB.outputEffDate('po')} DESC, po.id DESC`).forEach((o) => {
      outRows.push([o.project_code || '—', o.project_title || '—', o.type, o.title, o.reference || '—', o.date || '—', o.note || '']);
    });
    const wsOut = XLSX.utils.aoa_to_sheet(outRows);
    wsOut['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 40 }, { wch: 30 }, { wch: 12 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsOut, 'Research Outputs');

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), count: projects.length };
  }

  function exportAllXlsx() {
    if (!global.XLSX) { UI.toast('XLSX library not loaded', 'error'); return; }
    const built = buildAllXlsxBlob();
    if (!built) { UI.toast('No projects to export', 'error'); return; }
    blobDownload(built.blob, `Facility-Projects-Overview-${new Date().toISOString().slice(0, 10)}.xlsx`);
    UI.toast(`Exported ${built.count} project${built.count === 1 ? '' : 's'} to XLSX`);
  }

  /* ---------------- Reports & Utilization XLSX Export ---------------- */
  /* Every row here comes from js/reports.js's own compute* functions — the exact same
     aggregation the Reports screen renders from — so this file can never disagree with what the
     screen shows for the same date range. See js/reports.js's file header for the full
     cancellation-rule writeup; the short version is repeated in the Notes sheet below so an
     exported file is self-explanatory without the app open next to it. */
  function exportReportsXlsx(from, to) {
    const XLSX = global.XLSX;
    if (!XLSX) { UI.toast('XLSX library not loaded', 'error'); return; }
    const Reports = global.Reports;
    if (!Reports) { UI.toast('Reports module not loaded', 'error'); return; }

    const instr = Reports.computeInstrumentRows(from, to);
    const staff = Reports.computeStaffRows(from, to);
    const matrix = Reports.computeStaffInstrumentMatrix(from, to);
    const proj = Reports.computeProjectRows(from, to);
    const stewardship = Reports.computeStewardshipRows(from, to);
    const consult = Reports.computeConsultRows(from, to);
    const svc = Reports.computeServiceEntryRows(from, to);
    const breadth = Reports.computeBreadthRows(from, to);
    const mix = Reports.computeActivityMixRows(from, to);
    const funnel = Reports.computeFunnelRows(from, to);
    const labConsultsOn = Reports.getLabConsultsEnabled(); // mirror the on-screen opt-in toggle exactly

    const wb = XLSX.utils.book_new();
    const rangeLabel = `${from || 'earliest'} to ${to || 'latest'}`;

    // Sheet 1: Notes — the date range and both cancellation rules, spelled out, so the numbers
    // in every other sheet can be reconciled without needing this code open alongside it.
    const notes = [
      ['FACILITY REPORTS & UTILIZATION EXPORT'],
      [''],
      ['Date range', rangeLabel],
      ['Exported', new Date().toLocaleString()],
      [''],
      ['Occupancy rule (Bookings / Hours / Sessions columns)'],
      ['A cancelled booking releases its slot — the instrument or staff time was never actually spent — so cancelled bookings are excluded entirely from these columns, regardless of whether the cancellation charge was retained.'],
      [''],
      ['Money rule (Revenue / Total Cost columns)'],
      ["A booking's charge still counts unless it was BOTH cancelled AND the charge was waived. So a cancelled-but-charged booking still contributes revenue even though it contributes zero occupied hours — the facility got paid for a slot nobody used."],
      [''],
      ['Staff x Instrument attribution'],
      ['Instrument hours need no split (two instruments running in parallel were each genuinely occupied for the full time). A staff member’s time on a multi-instrument booking is ambiguous, so Sessions is an unsplit count of bookings (answers "which instruments do I spend my time on"), while Attributed Hours divides that booking’s staff hours evenly across every instrument on it, so the column sums back to the person’s true raw-hours total.'],
      [''],
      ['Instrument stewardship scorecard'],
      ['Grouped by supervising staff (Instruments -> supervisor mapping); an instrument with more than one supervisor is repeated under each of them — a grouping for review, not a partition of ownership, and never summed into a per-person score. "New Users" counts people whose first-ever non-cancelled booking on that instrument (checked across its whole history, not just the exported range) falls inside the exported dates. Omitted on purpose (need data this app does not track yet): trained-user pool trend and downtime share.'],
      [''],
      ['Breadth'],
      ['Distinct labs/people and new-lab counts exclude cancelled bookings entirely; a booking with no lab/group on file is omitted from lab counts. "New Labs" counts labs whose first-ever non-cancelled booking (checked across the facility’s whole history, not just the exported range) falls inside the exported dates.'],
      [''],
      ['Activity Mix'],
      ['Hours booked per meetings.category per month, excluding cancelled bookings; a booking with no category on file is grouped under "(uncategorized)". Categories are read from the data, not a fixed list. Standalone service entries are not included — they are logged in units/quantity, not hours.'],
      [''],
      ['Per-Lab Consults'],
      [labConsultsOn
        ? 'Per-lab consult attribution was ON (opt-in) at export time — see the "Per-Lab Consults" sheet.'
        : 'Per-lab consult attribution is OFF by default (opt-in, not a standing report column) — the "Per-Lab Consults" sheet is omitted from this export. Enable the checkbox on the Breadth card and re-export to include it.'],
      [''],
      ['Funnel: Consult to Output'],
      ['Stages count different kinds of things (consult/output are events, milestones are edits, the rest are projects) — read the counts as facility activity over the period, not one population literally narrowing. Consult volume includes facility-wide (project-less) consults, which cannot feed any later stage. "Milestones Progressing" counts any milestone edited in the period (updated_at moves on any edit), not a status change specifically. "Completed" is count-only via status=\'Completed\' or archived, dated by end_date (or archive date) as a labeled proxy when set; with neither date available a completed project is excluded from a bounded range' + (funnel.completedNoDateCount ? ` (${funnel.completedNoDateCount} such project${funnel.completedNoDateCount === 1 ? '' : 's'} excluded from this export\'s range).` : ' (none excluded in this export\'s range).')],
      ['Both time-in-stage medians (created->first booking, first booking->first output) exclude negative day-deltas — the later event predating the earlier one, real for backfilled/imported data — from the median itself, but every excluded project is counted here: '
        + `${funnel.medians.createdToActive.excludedNegative} project${funnel.medians.createdToActive.excludedNegative === 1 ? '' : 's'} excluded: first booking predates the project record. `
        + `${funnel.medians.activeToOutput.excludedNegative} project${funnel.medians.activeToOutput.excludedNegative === 1 ? '' : 's'} excluded: first output predates the first booking.`],
      [''],
      ['Retired people/instruments and archived projects are shown with a "(Retired)" / "(Archived)" suffix rather than removed, per this app’s history-preservation rule.']
    ];
    const wsNotes = XLSX.utils.aoa_to_sheet(notes);
    wsNotes['!cols'] = [{ wch: 100 }];
    XLSX.utils.book_append_sheet(wb, wsNotes, 'Notes');

    // Sheet 2: Instrument utilisation
    const instrRows = [['Instrument', 'Bookings', 'Booked Hours', 'Billed Revenue', 'Share of Total Hours %']];
    instr.rows.forEach((r) => {
      instrRows.push([UI.retiredName(r.name, r.retired), r.bookings, round2(r.hours), round2(r.revenue), round2(r.sharePct)]);
    });
    const wsInstr = XLSX.utils.aoa_to_sheet(instrRows);
    wsInstr['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrument Utilisation');

    // Sheet 3: Facility staff time
    const staffRows = [['Staff Member', 'Sessions', 'Raw Hours', 'Billed Hours', 'Staff Revenue']];
    staff.rows.forEach((r) => {
      staffRows.push([UI.retiredName(r.name, r.retired), r.sessions, round2(r.rawHours), round2(r.billHours), round2(r.revenue)]);
    });
    const wsStaff = XLSX.utils.aoa_to_sheet(staffRows);
    wsStaff['!cols'] = [{ wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsStaff, 'Facility Staff Time');

    // Sheet 4: Staff x instrument matrix — one row per non-empty (staff, instrument) pair rather
    // than a wide grid, so the sheet reads cleanly regardless of how many instruments there are.
    const matrixRows = [['Staff Member', 'Instrument', 'Sessions', 'Attributed Hours']];
    const staffById = new Map(matrix.staffList.map((s) => [s.id, s]));
    const instById = new Map(matrix.instrumentList.map((i) => [i.id, i]));
    matrix.cells.forEach((cell) => {
      const s = staffById.get(cell.personId), i = instById.get(cell.instrumentId);
      matrixRows.push([UI.retiredName(s.name, s.retired), UI.retiredName(i.name, i.retired), cell.sessions, round2(cell.attributedHours)]);
    });
    const wsMatrix = XLSX.utils.aoa_to_sheet(matrixRows);
    wsMatrix['!cols'] = [{ wch: 26 }, { wch: 26 }, { wch: 10 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsMatrix, 'Staff x Instrument');

    // Sheet 5: Projects & groups
    const pgRows = [['Scope', 'Name', 'Bookings', 'Hours', 'Total Cost']];
    proj.projects.forEach((r) => pgRows.push(['Project', r.label, r.bookings, round2(r.hours), round2(r.cost)]));
    proj.groups.forEach((r) => pgRows.push(['Lab / Group', r.label, r.bookings, round2(r.hours), round2(r.cost)]));
    const wsPg = XLSX.utils.aoa_to_sheet(pgRows);
    wsPg['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsPg, 'Projects & Groups');

    // Sheet 6: Instrument stewardship scorecard — flat row per supervisor x instrument, same
    // pattern as the Staff x Instrument sheet above (a wide grid would grow unboundedly with
    // supervisor count). Fed from the exact same Reports.computeStewardshipRows the screen
    // renders from. A shared instrument repeats under every supervisor it's linked to — see the
    // Notes sheet for why that's intentional.
    const stewardRows = [['Supervisor', 'Instrument', 'Bookings', 'Hours', 'Revenue', 'Distinct Users', 'New Users', 'Projects Served', 'Facility-Wide Sessions', 'Consults']];
    stewardship.groups.forEach((g) => {
      const supLabel = g.supervisor ? UI.retiredName(g.supervisor.name, g.supervisor.retired) : 'Unassigned';
      g.rows.forEach((r) => {
        stewardRows.push([supLabel, UI.retiredName(r.name, r.retired), r.bookings, round2(r.hours), round2(r.revenue), r.distinctUsers, r.newUsers, r.projectsServed, r.facilityWideSessions, r.consultCount]);
      });
    });
    const wsSteward = XLSX.utils.aoa_to_sheet(stewardRows);
    wsSteward['!cols'] = [{ wch: 22 }, { wch: 26 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 20 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsSteward, 'Stewardship');

    // Sheet 7: Consults — bookings tagged Category = "consult", counted per instrument and per
    // calendar-month period. Fed from the exact same Reports.computeConsultRows the screen
    // renders from, so this sheet can never disagree with what's on screen.
    const consultRows = [['Breakdown', 'Instrument / Month', 'Consults']];
    consultRows.push(['Total', 'All', consult.totalConsults]);
    consult.instrumentRows.forEach((r) => consultRows.push(['By Instrument', UI.retiredName(r.name, r.retired), r.count]));
    consult.periodRows.forEach((r) => consultRows.push(['By Period', r.period, r.count]));
    const wsConsult = XLSX.utils.aoa_to_sheet(consultRows);
    wsConsult['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsConsult, 'Consults');

    // Sheet 8: Service Entries — standalone billable work outside any booking, fed from the exact
    // same Reports.computeServiceEntryRows the screen renders from.
    const svcRows = [['Description', 'Project', 'Staff', 'Instrument', 'Grant', 'Status', 'Date', 'Qty', 'Unit', 'Rate', 'Total Cost']];
    svc.rows.forEach((r) => {
      const status = r.is_cancelled ? (r.billing_retained ? 'Cancelled (charged)' : 'Cancelled (waived)') : 'Active';
      svcRows.push([
        r.description, r.project_id == null ? 'Facility-wide' : (r.project_code ? r.project_code + ' — ' + r.project_title : r.project_title),
        r.person_name ? UI.retiredName(r.person_name, r.person_retired) : '—',
        r.instrument_name ? UI.retiredName(r.instrument_name, r.instrument_retired) : '—',
        grantLabelFor(r), status, r.date || '—', r.qty || 0, r.unit || '—', r.rate || 0, round2(r.countedCost)
      ]);
    });
    const wsSvc = XLSX.utils.aoa_to_sheet(svcRows);
    wsSvc['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsSvc, 'Service Entries');

    // Sheet 9: Breadth — distinct labs/people per period and per instrument, plus new-labs-onboarded
    // per period. Fed from the exact same Reports.computeBreadthRows the screen renders from.
    const breadthRows = [['Breakdown', 'Period / Instrument', 'Distinct Labs', 'Distinct People', 'New Labs']];
    breadth.periodRows.forEach((r) => breadthRows.push(['By Period', r.period, r.distinctLabs, r.distinctPeople, r.newLabs]));
    breadth.instrumentRows.forEach((r) => breadthRows.push(['By Instrument', UI.retiredName(r.name, r.retired), r.distinctLabs, r.distinctPeople, '']));
    const wsBreadth = XLSX.utils.aoa_to_sheet(breadthRows);
    wsBreadth['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 14 }, { wch: 16 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsBreadth, 'Breadth');

    // Sheet 10: Activity Mix — period x category hours matrix, fed from the exact same
    // Reports.computeActivityMixRows the screen renders from. Wide (one column per category value
    // actually present in the data) rather than the tall shape used elsewhere in this file, because
    // this sheet is meant to feed a stacked chart (roadmap 3.5) directly.
    const mixHeader = ['Month', ...mix.categories];
    const mixRows = [mixHeader];
    mix.rows.forEach((r) => mixRows.push([r.period, ...mix.categories.map((c) => round2(r.hours[c]))]));
    const wsMix = XLSX.utils.aoa_to_sheet(mixRows);
    wsMix['!cols'] = [{ wch: 10 }, ...mix.categories.map(() => ({ wch: 16 }))];
    XLSX.utils.book_append_sheet(wb, wsMix, 'Activity Mix');

    // Sheet 11 (opt-in only): Per-Lab Consults — mirrors the Breadth card's opt-in checkbox exactly;
    // the sheet is omitted entirely when the toggle is off, same as the on-screen table.
    if (labConsultsOn) {
      const labConsultRows = [['Lab / Group', 'Consults']];
      breadth.consultLabRows.forEach((r) => labConsultRows.push([r.lab, r.count]));
      const wsLabConsult = XLSX.utils.aoa_to_sheet(labConsultRows);
      wsLabConsult['!cols'] = [{ wch: 30 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsLabConsult, 'Per-Lab Consults');
    }

    // Sheet 12: Funnel: Consult to Output — fed from the exact same Reports.computeFunnelRows
    // the screen renders from. Both medians and their disclosed negative-delta exclusion counts
    // are repeated here (not just in the Notes sheet) so the sheet is self-explanatory on its own.
    const funnelRows = [['Stage', 'Count', 'Conversion from Previous %']];
    funnel.stages.forEach((s) => funnelRows.push([s.label, s.count, s.conversionPct == null ? '' : round2(s.conversionPct)]));
    funnelRows.push(['', '', '']);
    funnelRows.push(['Median: created -> first booking (days)', funnel.medians.createdToActive.days == null ? '' : round2(funnel.medians.createdToActive.days), `n=${funnel.medians.createdToActive.sampleSize}, excluded (negative delta)=${funnel.medians.createdToActive.excludedNegative}`]);
    funnelRows.push(['Median: first booking -> first output (days)', funnel.medians.activeToOutput.days == null ? '' : round2(funnel.medians.activeToOutput.days), `n=${funnel.medians.activeToOutput.sampleSize}, excluded (negative delta)=${funnel.medians.activeToOutput.excludedNegative}`]);
    const wsFunnel = XLSX.utils.aoa_to_sheet(funnelRows);
    wsFunnel['!cols'] = [{ wch: 36 }, { wch: 12 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, wsFunnel, 'Funnel');

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    blobDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Facility-Reports-${(from || 'earliest')}_to_${(to || 'latest')}.xlsx`);
    UI.toast('Exported Reports & Utilization to XLSX');
  }
  // Two-decimal rounding for exported hour/money figures — avoids floating-point noise (e.g.
  // 1.9999999999998) showing up in a spreadsheet cell.
  function round2(n) { return Math.round((n || 0) * 100) / 100; }

  /* Custom report generator (roadmap 3.6). spec = { entity, columns: ['key',...], from, to } —
     built by app.js from the Custom Report modal's current selection; from/to are always the
     explicit range the modal is showing (mirrors the screen's Reports.getRange() at open time —
     see js/app.js's rep-custom case), never module state. Single-sheet workbook (plus the
     standing Notes sheet every export in this file carries) built from the EXACT SAME
     Reports.computeCustomRows the modal's own preview table renders from, via the same
     aoa_to_sheet pattern as every other sheet above, so the exported numbers can never disagree
     with what the user previewed before exporting. */
  function exportCustomXlsx(spec) {
    const XLSX = global.XLSX;
    if (!XLSX) { UI.toast('XLSX library not loaded', 'error'); return; }
    const Reports = global.Reports;
    if (!Reports) { UI.toast('Reports module not loaded', 'error'); return; }

    const from = spec.from || '', to = spec.to || '';
    const result = Reports.computeCustomRows(spec, from, to);
    if (!result.columns.length) { UI.toast('Select at least one column', 'error'); return; }

    const wb = XLSX.utils.book_new();
    const rangeLabel = `${from || 'earliest'} to ${to || 'latest'}`;

    // Notes sheet: date range + both standing cancellation rules (identical wording to the
    // Reports & Utilization export above) + this dataset's own duplication note, if it has one —
    // the same note the modal shows as a preview footnote, never only shown in one of the two.
    const notes = [
      ['CUSTOM REPORT — ' + Reports.getCustomReportLabel(spec.entity)],
      [''],
      ['Date range', rangeLabel],
      ['Exported', new Date().toLocaleString()],
      [''],
      ['Occupancy rule (Hours / Sessions / Bookings columns)'],
      ['A cancelled booking releases its slot — the instrument or staff time was never actually spent — so cancelled bookings contribute zero to these columns, regardless of whether the cancellation charge was retained.'],
      [''],
      ['Money rule (Revenue / Cost / Total columns)'],
      ["A booking's or entry's charge still counts unless it was BOTH cancelled AND the charge was waived — a cancelled-but-charged row still contributes money even though it contributes zero occupied hours."],
      ['']
    ];
    const dsNotes = result.notes;
    if (dsNotes.length) {
      notes.push(['Dataset note (this entity repeats an entity across rows)']);
      dsNotes.forEach((n) => notes.push([n]));
      notes.push(['']);
    }
    notes.push(['Retired people/instruments and archived projects are shown with a "(Retired)" / "(Archived)" suffix rather than removed, per this app’s history-preservation rule.']);
    const wsNotes = XLSX.utils.aoa_to_sheet(notes);
    wsNotes['!cols'] = [{ wch: 100 }];
    XLSX.utils.book_append_sheet(wb, wsNotes, 'Notes');

    // Data sheet: header from the selected columns' labels, cells via the exact same
    // Reports.formatCustomCellXlsx the modal's own export button triggers — no second formatting
    // path to drift from the preview.
    const header = result.columns.map((c) => c.label);
    const dataRows = [header];
    result.rows.forEach((r) => {
      dataRows.push(result.columns.map((c) => Reports.formatCustomCellXlsx(c, r[c.key])));
    });
    const ws = XLSX.utils.aoa_to_sheet(dataRows);
    ws['!cols'] = result.columns.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Custom Report');

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    blobDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Custom-Report-${spec.entity}-${(from || 'earliest')}_to_${(to || 'latest')}.xlsx`);
    UI.toast('Exported custom report to XLSX');
  }

  global.Exports = { exportXlsx, exportDocx, exportPdf, exportAllXlsx, buildAllXlsxBlob, exportReportsXlsx, exportCustomXlsx };

})(window);
