/* exports.test.js — js/exports.js builds workbooks from real data, not just plausible-looking
 * template strings. Per CLAUDE.md ("Reports: aggregation lives in one place") and the R3/R4
 * findings this guards against: the facility-wide XLSX omitting a "(Retired)" suffix the
 * per-project workbook already carries, and the fact that no prior unit test ever loaded
 * js/exports.js at all (an XLSX-shaped mistake could ship and nothing would notice).
 *
 * Technique: load js/exports.js as a browser IIFE (same as every other file in this app) with
 * SheetJS's bundled UMD build assigned to `global.XLSX`, exactly as index.html's <script> tag
 * would provide it, then read the workbook SheetJS actually produced via
 * XLSX.utils.sheet_to_json — never assert against the JS array literal fed to aoa_to_sheet, since
 * that would only prove this file agrees with itself, not that a real .xlsx cell holds what it
 * should.
 *
 * DOMParser/Blob/URL are stubbed minimally, same as the adversarial review's own probe script:
 * every note field used below is '' (blank), so DOMParser never has real HTML to parse.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, REPO } = require('./helpers/load-module');
const { seedFixture } = require('./helpers/sqlite');

function lastId(DB) { return DB.row('SELECT last_insert_rowid() as id').id; }

async function freshApp() {
  const app = loadApp(['consts', 'db', 'ui', 'views', 'reports', 'exports']);
  globalThis.initSqlJs = require(path.join(REPO, 'libs', 'sql-asm.js'));
  await app.DB.boot();

  // Minimal stubs exports.js needs merely to RUN (not to actually render rich text — every note
  // below is left blank, so DOMParser never receives real HTML).
  globalThis.DOMParser = function () { this.parseFromString = () => ({ body: { childNodes: [] } }); };
  globalThis.Blob = globalThis.Blob || class { constructor(parts, opts) { this.parts = parts; this.opts = opts; } };
  globalThis.URL.createObjectURL = () => 'blob:test';
  globalThis.URL.revokeObjectURL = () => {};
  // Real UI.sanitizeHtml needs document.implementation.createHTMLDocument, which the minimal DOM
  // stub above doesn't provide (out of scope here — sanitizeHtml has its own real-browser coverage
  // in test/browser/sanitize.spec.js). Every note in this file is blank, so bypassing it is safe.
  app.UI.sanitizeHtml = (h) => h || '';
  app.UI.toast = () => {}; // toast() touches a #toast-container the DOM stub doesn't render

  const XLSX = require(path.join(REPO, 'libs', 'xlsx.full.min.js'));
  globalThis.XLSX = XLSX;

  // Capture every workbook XLSX.write is asked to serialize, so a test can inspect the actual
  // SheetJS workbook object (via XLSX.utils.sheet_to_json) rather than the JS array literal
  // exports.js built it from.
  const captured = [];
  const realWrite = XLSX.write;
  XLSX.write = function (wb, opts) { captured.push(wb); return realWrite.call(XLSX, wb, opts); };

  return { ...app, XLSX, captured };
}

function sheetRows(wb, name) {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
}
let XLSX; // set per-test from freshApp's return, so the sheetRows helper above can reach it

describe('exports (R3): facility-wide XLSX carries the same "(Retired)" suffix as the per-project workbook', () => {
  test('a retired milestone owner/instrument and a retired booking staff/instrument both read "(Retired)"', async () => {
    const app = await freshApp();
    XLSX = app.XLSX;
    const { DB, Exports } = app;
    const { sam, scopeA, liveProject } = seedFixture(DB);

    DB.run("INSERT INTO milestones (project_id, name, status, due_date) VALUES (?, 'MS1', 'pending', '2026-04-01')", [liveProject]);
    const msId = lastId(DB);
    DB.run('INSERT INTO milestone_owners (milestone_id, person_id) VALUES (?,?)', [msId, sam]);
    DB.run('INSERT INTO milestone_instruments (milestone_id, instrument_id) VALUES (?,?)', [msId, scopeA]);

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, total_cost) VALUES (?, 'Session', '2026-04-02','09:00','10:00', 50)", [liveProject]);
    const meetingId = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id, line_cost) VALUES (?,?,50)', [meetingId, scopeA]);
    DB.run("INSERT INTO meeting_staff (meeting_id, person_id, start_time, end_time) VALUES (?,?,'','')", [meetingId, sam]);

    DB.setRetired('people', sam, true);
    DB.setRetired('instruments', scopeA, true);

    const built = Exports.buildAllXlsxBlob();
    assert.ok(built, 'buildAllXlsxBlob should produce a workbook for a facility with projects');
    const wbAll = app.captured[app.captured.length - 1];

    const msRows = sheetRows(wbAll, 'Milestones');
    const msRow = msRows.find((r) => r[2] === 'MS1'); // [Project Code, Project, Milestone, Status, Due Date, Owners, Instruments, Notes]
    assert.ok(msRow, 'the seeded milestone must appear on the facility-wide Milestones sheet');
    assert.match(msRow[5], /Sam \(Retired\)/, 'facility-wide Milestones Owners column must carry "(Retired)", same as the per-project workbook');
    assert.match(msRow[6], /Scope A \(Retired\)/, 'facility-wide Milestones Instruments column must carry "(Retired)"');

    const bcRows = sheetRows(wbAll, 'Bookings & Costs');
    const bcRow = bcRows.find((r) => r[2] === 'Session');
    assert.ok(bcRow, 'the seeded booking must appear on the Bookings & Costs sheet');
    // header: [Project Code, Project, Booking, Grant, Tier, Status, Date, Start, End, Instruments,
    //          Facility Staff, Subtotal, Group Disc %, Manual Disc %, Overhead %, Before Tax,
    //          Effective Tax %, Total Cost]
    assert.match(bcRow[9], /Scope A \(Retired\)/, 'Bookings & Costs Instruments column must carry "(Retired)"');
    assert.match(bcRow[10], /Sam \(Retired\)/, 'Bookings & Costs Facility Staff column must carry "(Retired)"');
  });
});

describe('exports (R4): DOCX/PDF money follows the same waived-cancellation rule as XLSX (zeroed total)', () => {
  test('a waived-cancelled booking\'s DOCX/XLSX totals agree: both zero', async () => {
    const app = await freshApp();
    XLSX = app.XLSX;
    const { DB, UI, Exports } = app;
    const { scopeA, liveProject } = seedFixture(DB);

    DB.run("INSERT INTO meetings (project_id, title, date, start_time, end_time, subtotal, total_before_tax, total_cost) VALUES (?, 'Waived', '2026-04-05','09:00','10:00', 150, 150, 150)", [liveProject]);
    const meetingId = lastId(DB);
    DB.run('INSERT INTO meeting_instruments (meeting_id, instrument_id, line_cost) VALUES (?,?,150)', [meetingId, scopeA]);
    DB.setBookingCancelled(meetingId, true, false); // charge waived

    // XLSX (per-project) — the existing, already-correct reference behaviour.
    const docx = global.docx = stubDocx();
    Exports.exportXlsx(liveProject);
    const wbProj = app.captured[app.captured.length - 1];
    const mtRows = sheetRows(wbProj, 'Meetings');
    // header: [Meeting Title, Grant, Tier, Category, Status, Date, Start, End, Attendees, Notes,
    //          Action Items, Subtotal, Before Tax, Total Cost]
    const waivedXlsxRow = mtRows.find((r) => r[0] === 'Waived');
    assert.ok(waivedXlsxRow);
    assert.equal(waivedXlsxRow[13], 0, 'XLSX Total Cost must already be zeroed for a waived cancellation');

    // DOCX — must now match: the Cost paragraph's Total must also read as 0 (formatted via
    // UI.fmtMoney), not the raw stored total_cost of 150.
    const paragraphsText = [];
    docx.Paragraph = function (opts) { paragraphsText.push(typeof opts.text === 'string' ? opts.text : ''); return { opts }; };
    Exports.exportDocx(liveProject);
    await new Promise((resolve) => setTimeout(resolve, 0)); // Packer.toBlob is a stubbed Promise chain
    const costLine = paragraphsText.find((t) => t.startsWith('Cost: Subtotal'));
    assert.ok(costLine, 'a Cost paragraph must be emitted for this booking');
    // Subtotal (150) is the priced-at-booking-time snapshot and is UNCHANGED by waiving the
    // charge — only the final Total is zeroed by the money rule — so assert on the Total field
    // specifically, not on whether "150" appears anywhere in the line at all.
    const totalMatch = costLine.match(/Total (\S+)$/);
    assert.ok(totalMatch, `Cost paragraph must end with "Total <amount>"; got: "${costLine}"`);
    assert.equal(totalMatch[1], UI.fmtMoney(0), `DOCX Total must read ${UI.fmtMoney(0)} for a waived-cancelled booking, matching XLSX's zeroed Total Cost; got: "${costLine}"`);
  });
});

// A tiny stand-in for the `docx` UMD global (Document/Packer/Paragraph/TextRun/HeadingLevel/...) —
// just enough for exportDocx to run to completion without throwing. Paragraph is reassigned per
// test (see above) to capture the text passed to it; everything else only needs to exist.
function stubDocx() {
  function Paragraph(opts) { return { opts }; }
  function TextRun(opts) { return { opts }; }
  function Document(opts) { return { opts }; }
  return {
    Document, Packer: { toBlob: () => Promise.resolve({}) }, Paragraph, TextRun,
    HeadingLevel: { TITLE: 'TITLE', SUBTITLE: 'SUBTITLE', HEADING_2: 'HEADING_2', HEADING_3: 'HEADING_3' },
    Table: function () {}, TableRow: function () {}, TableCell: function () {},
    WidthType: { PERCENTAGE: 'PERCENTAGE' }, BorderStyle: { SINGLE: 'SINGLE' },
  };
}
