/* exports.js — robust XLSX, DOCX, and multi-page PDF generation */
(function (global) {
  'use strict';
  const DB = global.DB;
  const UI = global.UI;

  function loadProject(id) {
    const p = DB.row('SELECT p.*, pe.name as pi_name, pe.email as pi_email, pe.organization as pi_org FROM projects p LEFT JOIN people pe ON pe.id = p.pi_id WHERE p.id=?', [id]);
    if (!p) return null;

    const ppl = DB.rows(`
      SELECT pp.role, pe.name, pe.type, pe.organization, pe.email
      FROM project_people pp
      JOIN people pe ON pe.id = pp.person_id
      WHERE pp.project_id=?
      ORDER BY pe.name`, [id]);

    const inst = DB.rows(`
      SELECT i.name, i.kind, i.status
      FROM project_instruments pi
      JOIN instruments i ON i.id = pi.instrument_id
      WHERE pi.project_id=?
      ORDER BY i.name`, [id]);

    const ms = DB.rows(`
      SELECT m.*,
             (SELECT GROUP_CONCAT(pe.name, ', ') FROM milestone_owners mo JOIN people pe ON pe.id = mo.person_id WHERE mo.milestone_id = m.id) as owners,
             (SELECT GROUP_CONCAT(i.name, ', ') FROM milestone_instruments mi JOIN instruments i ON i.id = mi.instrument_id WHERE mi.milestone_id = m.id) as instruments
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
    const teamRows = [['Member Name', 'Role in Project', 'Position / Type', 'Lab / Group / Company', 'Email']];
    d.ppl.forEach((pe) => {
      teamRows.push([pe.name, pe.role || '—', pe.type || '—', pe.organization || '—', pe.email || '—']);
    });
    const ws3 = XLSX.utils.aoa_to_sheet(teamRows);
    ws3['!cols'] = [{ wch: 25 }, { wch: 25 }, { wch: 20 }, { wch: 30 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Team');

    // Sheet 4: Instruments
    const instRows = [['Instrument Name', 'Kind / Modality', 'Status']];
    d.inst.forEach((i) => {
      instRows.push([i.name, i.kind || '—', i.status || '—']);
    });
    const ws4 = XLSX.utils.aoa_to_sheet(instRows);
    ws4['!cols'] = [{ wch: 30 }, { wch: 25 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws4, 'Instruments');

    // Sheet 5: Meetings
    const mtRows = [['Meeting Title', 'Date', 'Attendees', 'Notes', 'Action Items']];
    d.mtgs.forEach((m) => {
      mtRows.push([m.title, m.date || '—', m.attendees || '—', m.note || '', m.actions || '']);
    });
    const ws5 = XLSX.utils.aoa_to_sheet(mtRows);
    ws5['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 30 }, { wch: 40 }, { wch: 40 }];
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
        const orgStr = pe.organization ? ` • ${pe.organization}` : '';
        children.push(new Paragraph({ text: `• ${pe.name} (${pe.type}${orgStr}) ${pe.role ? '— Role: ' + pe.role : ''} ${pe.email ? '<' + pe.email + '>' : ''}` }));
      });
    } else {
      children.push(new Paragraph({ text: 'No team members assigned.' }));
    }

    // Instruments
    children.push(new Paragraph({ text: 'Assigned Instruments', heading: HeadingLevel.HEADING_2 }));
    if (d.inst.length) {
      d.inst.forEach((i) => {
        children.push(new Paragraph({ text: `• ${i.name} (${i.kind || 'Facility Instrument'}) — Status: ${i.status}` }));
      });
    } else {
      children.push(new Paragraph({ text: 'No instruments assigned.' }));
    }

    // Meetings
    children.push(new Paragraph({ text: 'Meetings & Discussions', heading: HeadingLevel.HEADING_2 }));
    if (d.mtgs.length) {
      d.mtgs.forEach((m) => {
        children.push(new Paragraph({ text: `${UI.fmtDate(m.date)}: ${m.title}`, heading: HeadingLevel.HEADING_3 }));
        if (m.attendees) children.push(new Paragraph({ text: `Attendees: ${m.attendees}`, italics: true }));
        if (m.note) children.push(new Paragraph({ text: m.note }));
        if (m.actions) children.push(new Paragraph({ text: `Actions: ${m.actions}`, bold: true }));
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
        const orgStr = pe.organization ? ` • ${pe.organization}` : '';
        pdf.text(`• ${pe.name} (${pe.type}${orgStr}) ${pe.role ? '— Role: ' + pe.role : ''} ${pe.email ? '<' + pe.email + '>' : ''}`, margin, y);
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
        pdf.text(`• ${i.name} (${i.kind || 'Facility Instrument'}) — Status: ${i.status}`, margin, y);
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
        pdf.text(`${UI.fmtDate(m.date)}: ${m.title}`, margin, y);
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
          const split = pdf.splitTextToSize(m.note, 210 - margin * 2 - 4);
          for (const l of split) {
            checkPage(5);
            pdf.text(l, margin + 4, y);
            y += 4.5;
          }
        }
        if (m.actions) {
          checkPage(6);
          pdf.setFont('helvetica', 'bold');
          pdf.text(`Actions: ${m.actions}`, margin + 4, y);
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

  global.Exports = { exportXlsx, exportDocx, exportPdf };

})(window);
