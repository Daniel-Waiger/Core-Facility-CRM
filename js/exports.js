/* exports.js — robust XLSX, DOCX, and multi-page PDF generation */
(function (global) {
  'use strict';
  const DB = global.DB;
  const UI = global.UI;

  function loadProject(id) {
    const p = DB.row('SELECT p.*, pe.name as pi_name, pe.email as pi_email, pe.organization as pi_org FROM projects p LEFT JOIN people pe ON pe.id = p.pi_id WHERE p.id=?', [id]);
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
    const mtgs = DB.rows('SELECT * FROM meetings WHERE project_id=? ORDER BY date DESC, id DESC', [id]);
    const files = DB.rows('SELECT * FROM files WHERE project_id=? ORDER BY created_at DESC', [id]);
    const prog = DB.projectProgress(id);

    return { p, ppl, inst, ms, kv, mtgs, files, prog };
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
    const teamRows = [['Member Name', 'Role in Project', 'Position / Type', 'Lab / Group / Company', 'Department', 'Email', 'Core Staff', 'Rate/hr']];
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
    const mtRows = [['Meeting Title', 'Status', 'Date', 'Start', 'End', 'Attendees', 'Notes', 'Action Items', 'Subtotal', 'Before Tax', 'Total Cost']];
    d.mtgs.forEach((m) => {
      // A cancelled booking stays in the report — it is part of the record — with its status and
      // whether its charge still counts, so a total can be reconciled against the rows.
      const status = m.is_cancelled ? (m.billing_retained ? 'Cancelled (charged)' : 'Cancelled (waived)') : 'Booked';
      const counts = !(m.is_cancelled && !m.billing_retained);
      mtRows.push([m.title, status, m.date || '—', m.start_time || '—', m.end_time || '—', m.attendees || '—', htmlToPlainText(m.note), m.actions || '', m.subtotal || 0, m.total_before_tax || 0, counts ? (m.total_cost || 0) : 0]);
    });
    const ws5 = XLSX.utils.aoa_to_sheet(mtRows);
    ws5['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 40 }, { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws5, 'Meetings');

    // Sheet 6: Files
    const fRows = [['File Name', 'Kind', 'Path / Link', 'Logged At']];
    d.files.forEach((f) => {
      fRows.push([f.name, f.kind, f.path || '—', f.created_at]);
    });
    const ws6 = XLSX.utils.aoa_to_sheet(fRows);
    ws6['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 40 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws6, 'Files');

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
        children.push(new Paragraph({ text: `• ${pe.name} (${pe.type}${orgStr ? ' • ' + orgStr : ''}) ${pe.role ? '— Role: ' + pe.role : ''} ${pe.email ? '<' + pe.email + '>' : ''}${pe.is_staff ? ' — Core Staff, ' + (pe.rate || 0) + '/hr' : ''}` }));
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
        children.push(new Paragraph({ text: `${UI.fmtDate(m.date)}${timeStr}: ${m.title}${bookingStatusSuffix(m)}`, heading: HeadingLevel.HEADING_3 }));
        if (m.attendees) children.push(new Paragraph({ text: `Attendees: ${m.attendees}`, italics: true }));
        if (m.note) htmlToDocxParagraphs(m.note, docx).forEach((p) => children.push(p));
        if (m.actions) children.push(new Paragraph({ text: `Actions: ${m.actions}`, bold: true }));
        if (m.total_cost) children.push(new Paragraph({ text: `Cost: Subtotal ${m.subtotal || 0}, Before Tax ${m.total_before_tax || 0}, Total ${m.total_cost}`, bold: true }));
      });
    } else {
      children.push(new Paragraph({ text: 'No meetings logged.' }));
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
    pdf.roundedRect(margin, y, 210 - (margin * 2), 26, 2, 2, 'FD');
    y += 6;
    pdf.setFontSize(9);
    pdf.setTextColor(20, 20, 20);
    pdf.text(`Status: ${d.p.status}   |   Priority: ${d.p.priority || 'Medium'}   |   Progress: ${d.prog.pct}% (${d.prog.done}/${d.prog.total} milestones done)`, margin + 4, y);
    y += 6;
    pdf.text(`Principal Investigator: ${d.p.pi_name || '—'}   |   Funding: ${d.p.funding || '—'}   |   Modality: ${d.p.modality || '—'}`, margin + 4, y);
    y += 6;
    pdf.text(`Sample: ${d.p.sample || '—'}   |   Timeline: ${UI.fmtDate(d.p.start_date)} → ${UI.fmtDate(d.p.end_date)}`, margin + 4, y);
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
        pdf.text(`• ${pe.name} (${pe.type}${orgStr ? ' • ' + orgStr : ''}) ${pe.role ? '— Role: ' + pe.role : ''} ${pe.email ? '<' + pe.email + '>' : ''}${pe.is_staff ? ' — Core Staff, ' + (pe.rate || 0) + '/hr' : ''}`, margin, y);
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
        pdf.text(`${UI.fmtDate(m.date)}${timeStr}: ${m.title}${bookingStatusSuffix(m)}`, margin, y);
        pdf.setFont('helvetica', 'normal');
        y += 5;
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
          checkPage(6);
          pdf.setFont('helvetica', 'bold');
          pdf.text(`Cost: Subtotal ${m.subtotal || 0}, Before Tax ${m.total_before_tax || 0}, Total ${m.total_cost}`, margin + 4, y);
          pdf.setFont('helvetica', 'normal');
          y += 5;
        }
        y += 2;
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

  /* ---------------- Facility-wide XLSX Export (all projects) ---------------- */
  function exportAllXlsx() {
    const XLSX = global.XLSX;
    if (!XLSX) { UI.toast('XLSX library not loaded', 'error'); return; }

    const projects = DB.rows(`
      SELECT p.*, pe.name as pi_name, pe.email as pi_email
      FROM projects p LEFT JOIN people pe ON pe.id = p.pi_id
      ORDER BY p.updated_at DESC`);

    if (!projects.length) { UI.toast('No projects to export', 'error'); return; }

    const wb = XLSX.utils.book_new();

    // Sheet 1: Projects overview (one row per project)
    const projRows = [[
      'Code', 'Title', 'Status', 'Priority', 'PI', 'PI Email', 'Funding', 'Modality',
      'Sample', 'Flags', 'Tags', 'Start Date', 'End Date', 'Progress %', 'Milestones', 'Created', 'Updated'
    ]];
    projects.forEach((p) => {
      const prog = DB.projectProgress(p.id);
      projRows.push([
        p.code, p.title, p.status, p.priority || 'Medium', p.pi_name || '—', p.pi_email || '—',
        p.funding || '—', p.modality || '—', p.sample || '—', p.flags || '—', p.tags || '—',
        p.start_date || '—', p.end_date || '—', prog.pct + '%', `${prog.done} of ${prog.total}`,
        p.created_at, p.updated_at
      ]);
    });
    const wsP = XLSX.utils.aoa_to_sheet(projRows);
    wsP['!cols'] = [{ wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 26 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 20 }, { wch: 20 }];
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
    const peopleRows = [['Name', 'Status', 'Type', 'Lab / Group / Company', 'Department', 'Email', 'Notes', 'Core Staff', 'Rate/hr']];
    DB.rows('SELECT name, type, organization, department, email, note, is_staff, rate, is_retired FROM people ORDER BY is_retired, name').forEach((pe) => {
      peopleRows.push([pe.name, pe.is_retired ? 'Retired' : 'Active', pe.type || '—', pe.organization || '—', pe.department || '—', pe.email || '—', pe.note || '', pe.is_staff ? 'Yes' : 'No', pe.is_staff ? (pe.rate || 0) : '—']);
    });
    const wsPe = XLSX.utils.aoa_to_sheet(peopleRows);
    wsPe['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 14 }, { wch: 30 }, { wch: 22 }, { wch: 30 }, { wch: 40 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsPe, 'People');

    // Sheet 4: Instruments
    const instRows = [['Name', 'In Service', 'Kind / Modality', 'Status', 'Location', 'Notes', 'Cost', 'Unit']];
    DB.rows('SELECT name, kind, status, location, note, cost, cost_unit, is_retired FROM instruments ORDER BY is_retired, name').forEach((i) => {
      instRows.push([i.name, i.is_retired ? 'Retired' : 'Active', i.kind || '—', i.status || '—', i.location || '—', i.note || '', i.cost || 0, i.cost_unit || 'time']);
    });
    const wsI = XLSX.utils.aoa_to_sheet(instRows);
    wsI['!cols'] = [{ wch: 30 }, { wch: 11 }, { wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 40 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsI, 'Instruments');

    // Sheet 5: All meetings/bookings (project-less "facility-wide" bookings included)
    const mtRows = [['Project Code', 'Project', 'Meeting', 'Status', 'Date', 'Start', 'End', 'Attendees', 'Link', 'Notes', 'Action Items']];
    DB.rows(`
      SELECT mt.*, p.code as project_code, p.title as project_title
      FROM meetings mt LEFT JOIN projects p ON p.id = mt.project_id
      ORDER BY mt.date DESC, mt.id DESC`).forEach((m) => {
      mtRows.push([m.project_code || '—', m.project_title || 'Facility-wide', m.title,
        m.is_cancelled ? (m.billing_retained ? 'Cancelled (charged)' : 'Cancelled (waived)') : 'Booked',
        m.date || '—', m.start_time || '—', m.end_time || '—', m.attendees || '—', m.link || '—', htmlToPlainText(m.note), m.actions || '']);
    });
    const wsMt = XLSX.utils.aoa_to_sheet(mtRows);
    wsMt['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 26 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 30 }, { wch: 40 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsMt, 'Meetings');

    // Sheet 6: Bookings & Costs — the invoice-oriented view: what was booked, who worked it,
    // and the stored cost snapshot for each booking (discount → overhead → tax, as computed by
    // computeBookingBOM in app.js at the time the booking was saved).
    const bcRows = [['Project Code', 'Project', 'Booking', 'Status', 'Date', 'Start', 'End', 'Instruments', 'Core Staff', 'Subtotal', 'Group Disc %', 'Manual Disc %', 'Before Tax', 'Total Cost']];
    DB.rows(`
      SELECT mt.*, p.code as project_code, p.title as project_title,
             (SELECT GROUP_CONCAT(i.name, ', ') FROM meeting_instruments mi JOIN instruments i ON i.id = mi.instrument_id WHERE mi.meeting_id = mt.id) as instruments,
             (SELECT GROUP_CONCAT(pe.name, ', ') FROM meeting_staff ms JOIN people pe ON pe.id = ms.person_id WHERE ms.meeting_id = mt.id) as staff
      FROM meetings mt LEFT JOIN projects p ON p.id = mt.project_id
      ORDER BY mt.date DESC, mt.id DESC`).forEach((m) => {
      // A waived cancellation contributes 0 to the Total Cost column so the column sums to what
      // the facility actually bills; the Status column says why.
      const counts = !(m.is_cancelled && !m.billing_retained);
      bcRows.push([
        m.project_code || '—', m.project_title || 'Facility-wide', m.title,
        m.is_cancelled ? (m.billing_retained ? 'Cancelled (charged)' : 'Cancelled (waived)') : 'Booked',
        m.date || '—', m.start_time || '—', m.end_time || '—',
        m.instruments || '—', m.staff || '—', m.subtotal || 0, m.group_discount_pct || 0, m.discount_pct || 0,
        m.total_before_tax || 0, counts ? (m.total_cost || 0) : 0
      ]);
    });
    const wsBc = XLSX.utils.aoa_to_sheet(bcRows);
    wsBc['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 26 }, { wch: 20 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsBc, 'Bookings & Costs');

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    blobDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Facility-Projects-Overview-${new Date().toISOString().slice(0, 10)}.xlsx`);
    UI.toast(`Exported ${projects.length} project${projects.length === 1 ? '' : 's'} to XLSX`);
  }

  global.Exports = { exportXlsx, exportDocx, exportPdf, exportAllXlsx };

})(window);
