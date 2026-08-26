/* exports.js — xlsx, docx, pdf export (all project data + metadata) */
(function (global) {
  'use strict';
  const DB = global.DB;

  function loadProject(id) {
    const p = DB.q1('SELECT * FROM projects WHERE id=?', [id]);
    const ppl = DB.q('SELECT pp.role, pe.name, pe.type FROM project_people pp JOIN people pe ON pe.id=pp.person_id WHERE pp.project_id=?', [id]);
    const inst = DB.q('SELECT i.name, i.kind, i.status FROM project_instruments pi JOIN instruments i ON i.id=pi.instrument_id WHERE pi.project_id=?', [id]);
    const ms = DB.q('SELECT * FROM milestones WHERE project_id=? ORDER BY rowid', [id]);
    const kv = DB.q('SELECT * FROM kv WHERE project_id=? ORDER BY rowid', [id]);
    const mtgs = DB.q('SELECT * FROM meetings WHERE project_id=? ORDER BY date DESC', [id]);
    const files = DB.q('SELECT * FROM files WHERE project_id=? ORDER BY created_at DESC', [id]);
    const prog = DB.projectProgress(id);
    return { p, ppl, inst, ms, kv, mtgs, files, prog };
  }

  function blobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  /* ---------------- XLSX ---------------- */
  function exportXlsx(id) {
    const d = loadProject(id);
    const XLSX = global.XLSX;
    if (!XLSX) { global.UI.toast('XLSX lib missing', 'error'); return; }
    const wb = XLSX.utils.book_new();

    // Sheet 1: project summary (all data + metadata)
    const summary = [
      ['Field', 'Value'],
      ['Title', d.p[1]],
      ['Code', d.p[2]],
      ['Status', d.p[3]],
      ['Priority', d.p[4]],
      ['Start', d.p[9] || ''],
      ['End', d.p[10] || ''],
      ['Created', d.p[12]],
      ['Progress %', d.prog.pct + '%'],
      ['Milestones done', d.prog.done + ' / ' + d.prog.total],
      ['Notes', d.p[11] || ''],
      [],
      ['Metadata', ''],
    ];
    d.kv.forEach((r) => summary.push([r[1], r[2]]));
    summary.push([]);
    summary.push(['Team', ''],
      ...d.ppl.map((r) => [r[2], r[0] || '']));
    summary.push([]);
    summary.push(['Instruments', ''],
      ...d.inst.map((r) => [r[0], r[1]]));
    const ws1 = XLSX.utils.aoa_to_sheet(summary);
    XLSX.utils.book_append_sheet(wb, ws1, 'Project');

    // Sheet 2: milestones
    const msRows = [['Milestone', 'Due', 'Status', 'Note']];
    d.ms.forEach((r) => msRows.push([r[2], r[3] || '', r[4], r[5] || '']));
    const ws2 = XLSX.utils.aoa_to_sheet(msRows);
    XLSX.utils.book_append_sheet(wb, ws2, 'Milestones');

    // Sheet 3: meetings
    const mtRows = [['Meeting', 'Date', 'Attendees', 'Note']];
    d.mtgs.forEach((r) => mtRows.push([r[2], r[3] || '', r[4] || '', r[5] || '']));
    const ws3 = XLSX.utils.aoa_to_sheet(mtRows);
    XLSX.utils.book_append_sheet(wb, ws3, 'Meetings');

    // Sheet 4: files
    const fRows = [['File', 'Kind', 'Path']];
    d.files.forEach((r) => fRows.push([r[2], r[3], r[4] || '']));
    const ws4 = XLSX.utils.aoa_to_sheet(fRows);
    XLSX.utils.book_append_sheet(wb, ws4, 'Files');

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    blobDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), d.p[1] + '.xlsx');
    global.UI.toast('Exported XLSX');
  }

  /* ---------------- DOCX ---------------- */
  function exportDocx(id) {
    const d = loadProject(id);
    const docx = global.docx;
    if (!docx) { global.UI.toast('docx lib missing', 'error'); return; }
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, AlignmentType } = docx;

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({ text: d.p[1], heading: HeadingLevel.TITLE }),
          new Paragraph({ text: 'Core Facility Project Report', heading: HeadingLevel.SUBTITLE }),
          new Paragraph({ text: 'Code: ' + d.p[2] + '   •   Status: ' + d.p[3] + '   •   Priority: ' + d.p[4] }),
          new Paragraph({ text: 'Start: ' + (d.p[9] || '—') + '   •   End: ' + (d.p[10] || '—') }),
          new Paragraph({ text: 'Progress: ' + d.prog.pct + '% (' + d.prog.done + '/' + d.prog.total + ' milestones)', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: 'Milestones', heading: HeadingLevel.HEADING_2 }),
          ...d.ms.map((r) => new Paragraph({ text: (r[3] || '—') + '  —  ' + r[2] + '  (' + r[4] + ')' })),
          new Paragraph({ text: 'Team', heading: HeadingLevel.HEADING_2 }),
          ...d.ppl.map((r) => new Paragraph({ text: r[0] + '  (' + r[2] + ')' })),
          new Paragraph({ text: 'Instruments', heading: HeadingLevel.HEADING_2 }),
          ...d.inst.map((r) => new Paragraph({ text: r[0] + '  (' + r[1] + ')' })),
          new Paragraph({ text: 'Meetings', heading: HeadingLevel.HEADING_2 }),
          ...d.mtgs.map((r) => new Paragraph({ text: (r[3] || '—') + '  —  ' + r[2] + '  ' + (r[5] || '') })),
          new Paragraph({ text: 'Files', heading: HeadingLevel.HEADING_2 }),
          ...d.files.map((r) => new Paragraph({ text: r[2] + '  (' + r[3] + ')' })),
        ],
      }],
    });
    Packer.toBlob(doc).then((blob) => {
      blobDownload(blob, d.p[1] + '.docx');
      global.UI.toast('Exported DOCX');
    });
  }

  /* ---------------- PDF ---------------- */
  function exportPdf(id) {
    const d = loadProject(id);
    const jsPDF = global.jsPDF;
    if (!jsPDF) { global.UI.toast('jsPDF lib missing', 'error'); return; }
    const pdf = new jsPDF();
    pdf.setFontSize(18);
    pdf.text(d.p[1], 14, 20);
    pdf.setFontSize(10);
    pdf.text('Core Facility Project Report', 14, 26);
    pdf.text('Code: ' + d.p[2] + '   Status: ' + d.p[3] + '   Priority: ' + d.p[4], 14, 32);
    pdf.text('Start: ' + (d.p[9] || '—') + '   End: ' + (d.p[10] || '—'), 14, 36);
    pdf.text('Progress: ' + d.prog.pct + '% (' + d.prog.done + '/' + d.prog.total + ' milestones)', 14, 42);
    pdf.text('Milestones', 14, 52);
    pdf.setFontSize(9);
    let y = 56;
    d.ms.forEach((r) => {
      pdf.text((r[3] || '—') + '  ' + r[2] + '  (' + r[4] + ')', 16, y);
      y += 6;
    });
    pdf.text('Team', 14, y + 4);
    y += 8;
    d.ppl.forEach((r) => { pdf.text(r[0] + '  (' + r[2] + ')', 16, y); y += 6; });
    pdf.text('Instruments', 14, y + 4);
    y += 8;
    d.inst.forEach((r) => { pdf.text(r[0] + '  (' + r[1] + ')', 16, y); y += 6; });
    pdf.text('Meetings', 14, y + 4);
    y += 8;
    d.mtgs.forEach((r) => { pdf.text((r[3] || '—') + '  ' + r[2], 16, y); y += 6; });
    pdf.text('Files', 14, y + 4);
    y += 8;
    d.files.forEach((r) => { pdf.text(r[2] + '  (' + r[3] + ')', 16, y); y += 6; });
    pdf.save(d.p[1] + '.pdf');
    global.UI.toast('Exported PDF');
  }

  global.Exports = { exportXlsx, exportDocx, exportPdf };

})(window);
