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

    // Facility-wide "Bookings & Costs" sheet — verifier gap: Subtotal/Before Tax must stay the
    // unchanged priced-at-booking-time snapshot (same rule just asserted above for the per-project
    // Meetings sheet), while the last column — named "Charged Total", not "Total Cost", precisely
    // so a reader doesn't read a zero there as a broken Subtotal->Before Tax->Total chain — zeroes.
    Exports.buildAllXlsxBlob();
    const wbAll = app.captured[app.captured.length - 1];
    const bcRows = sheetRows(wbAll, 'Bookings & Costs');
    assert.deepEqual(bcRows[0].slice(-3), ['Before Tax', 'Effective Tax %', 'Charged Total'], 'the money columns must read Before Tax / Effective Tax % / Charged Total, in that order');
    const bcRow = bcRows.find((r) => r[2] === 'Waived');
    assert.ok(bcRow, 'the waived booking must appear on the facility-wide Bookings & Costs sheet');
    // header: [Project Code, Project, Booking, Grant, Tier, Status, Date, Start, End, Instruments,
    //          Facility Staff, Subtotal, Group Disc %, Manual Disc %, Overhead %, Before Tax,
    //          Effective Tax %, Charged Total]
    assert.equal(bcRow[11], 150, 'Subtotal must stay the unwaived snapshot (150), unchanged by waiving the charge');
    assert.equal(bcRow[15], 150, 'Before Tax must likewise stay the unwaived snapshot (150)');
    assert.equal(bcRow[16], '', 'Effective Tax % is blank — nothing was actually billed to derive a rate from');
    assert.equal(bcRow[17], 0, 'Charged Total must be zeroed for a waived cancellation');
  });
});

describe('exports (#7): facility-wide XLSX carries a Notes sheet, appended last', () => {
  test('Notes is present and is the LAST sheet, so appending it can never renumber/shift a data sheet a row-builder elsewhere indexes positionally', async () => {
    const app = await freshApp();
    XLSX = app.XLSX;
    const { DB, Exports } = app;
    seedFixture(DB);

    const built = Exports.buildAllXlsxBlob();
    assert.ok(built, 'a seeded DB produces a workbook');
    const wbAll = app.captured[app.captured.length - 1];

    assert.ok(wbAll.SheetNames.includes('Notes'), 'workbook has a Notes sheet');
    assert.equal(wbAll.SheetNames[wbAll.SheetNames.length - 1], 'Notes', 'Notes must be the LAST sheet');
  });

  test('Notes discloses legacy-pricing blanks, waived-row status, and the "(Retired)" suffix — one sentence each', async () => {
    const app = await freshApp();
    XLSX = app.XLSX;
    const { DB, Exports } = app;
    seedFixture(DB);

    Exports.buildAllXlsxBlob();
    const wbAll = app.captured[app.captured.length - 1];
    const text = sheetRows(wbAll, 'Notes').map((r) => (r[0] || '')).join('\n');

    assert.match(text, /legacy/i, 'discloses that a blank/"—" tier means legacy (pre-tier) pricing');
    assert.match(text, /overhead/i, 'names the overhead percentage specifically, not just "pricing" in general');
    assert.match(text, /waived/i, 'discloses what a waived cancellation means for the money columns');
    assert.match(text, /\(Retired\)/, 'discloses the "(Retired)" suffix convention used throughout the sheet');
  });
});

describe('PDF font (G3): a Hebrew name is bidi-reversed for jsPDF, and the multi-script font is registered lazily', () => {
  test('_pdfBidiReverse (item 6, revised): a base-RTL line is JUST the plain whole-string reversal — no separate embedded-run fix-up', async () => {
    const app = await freshApp();
    const { Exports } = app;

    // Item 6 (second review) investigated further than the reported regex bug: pdfBidiReverse used
    // to follow the whole-string reversal with a second pass that manually un-reversed each
    // embedded LTR/digit run — and that pass's regex had a real bug (a boundary space got swept
    // into the run and glued it to the neighbouring RTL word). But fixing the regex is not the
    // right fix: a REAL PDF generated with the bundled jsPDF + the app's own multi-script font and
    // inspected via PyMuPDF glyph x-origins (get_texttrace — never a rendered image, see
    // docs/cma-lessons.md) shows that jsPDF's OWN __bidiEngine__ independently restores an embedded
    // LTR/digit run's reading order whenever the string it's given contains RTL characters — so
    // handing it a string whose run was ALREADY manually un-reversed makes jsPDF un-reverse it a
    // SECOND time, and the digits come out backwards on the actual page regardless of the regex.
    // See scratchpad item6-*.js/.pdf for the generating scripts and raw PyMuPDF output this is
    // based on. The correct fix is therefore to do NOTHING beyond the plain whole-string reversal
    // for a base-RTL line — this test pins that down at the pdfBidiReverse level; the actual glyph
    // order jsPDF then produces is exercised by the real-PDF test further below.
    const input = 'שלום 123 עולם';
    const out = Exports._pdfBidiReverse(input);
    assert.equal(out, input.split('').reverse().join(''), `a base-RTL line must be EXACTLY the plain character-by-character reversal, nothing more, got: "${out}"`);

    // A string with nothing to reorder (no RTL characters) must come back byte-for-byte identical
    // — the helper must not touch Latin/digit-only strings at all.
    const latinOnly = 'Extended CAR-T Time-Lapse Re-acquisition 2026';
    assert.equal(Exports._pdfBidiReverse(latinOnly), latinOnly, 'a pure-Latin/digit string must be returned unchanged');
  });

  test('_pdfBidiReverse (item 7): a line starting with Greek, Cyrillic, or an accented Latin name followed by Hebrew is treated as base LTR, not reversed wholesale', () => {
    const app = loadApp(['consts', 'db', 'ui', 'views', 'reports', 'exports']);
    const { Exports } = app;
    const hebrewName = 'שרה כהן';

    // An accented Latin name (Latin-1 Supplement, outside plain ASCII A-Z) starting the line.
    const accented = `René Müller: ${hebrewName}`;
    const outAccented = Exports._pdfBidiReverse(accented);
    assert.equal(outAccented, accented, 'a line whose first strong character is accented Latin must be treated as base-LTR (untouched) — jsPDF\'s own engine handles the embedded Hebrew run');

    // A Greek name starting the line.
    const greek = `Δημήτρης Παπαδόπουλος: ${hebrewName}`;
    const outGreek = Exports._pdfBidiReverse(greek);
    assert.equal(outGreek, greek, 'a line whose first strong character is Greek must be treated as base-LTR (untouched)');

    // A Cyrillic name starting the line.
    const cyrillic = `Дмитрий Иванов: ${hebrewName}`;
    const outCyrillic = Exports._pdfBidiReverse(cyrillic);
    assert.equal(outCyrillic, cyrillic, 'a line whose first strong character is Cyrillic must be treated as base-LTR (untouched)');
  });

  test('_pdfBidiReverse leaves a base-left-to-right line untouched, Hebrew run included, because the bundled jsPDF bidi engine reorders mixed lines', () => {
    // Regression case: exportPdf's own summary line is exactly this shape —
    // "Principal Investigator: <Hebrew name>   |   Funding: —   |   Modality: —". The bundled
    // jsPDF (libs/jspdf.umd.min.js, __bidiEngine__) already reorders a mixed line correctly, so a
    // pre-reversal of the Hebrew run here cancels it out and the name draws scrambled. That was
    // measured on glyph x-origins in the PDF content stream — a rendered image is NOT evidence
    // for bidi, because the viewer re-applies bidi and hides the error. Only a line whose base
    // direction is right-to-left (which jsPDF leaves in logical order) may be reversed.
    const app = loadApp(['consts', 'db', 'ui', 'views', 'reports', 'exports']);
    const Exports = app.Exports;
    const piName = 'שרה כהן'; // שרה כהן
    const line = `Principal Investigator: ${piName}   |   Funding: —   |   Modality: —`;
    const out = Exports._pdfBidiReverse(line);

    assert.ok(out.startsWith('Principal Investigator: '), `the English label must stay first and un-reversed, got: "${out}"`);
    assert.ok(out.includes('   |   Funding: '), 'the surrounding structure/order must be untouched');
    assert.ok(out.includes('   |   Modality: '), 'the surrounding structure/order must be untouched');
    // The embedded Hebrew run must be left in logical order for jsPDF's engine to place.
    assert.equal(out, line, 'a base-LTR line must come back byte-for-byte identical');
  });

  test('_pdfBidiReverse (C4-followups #3) mirrors paired brackets after reversing a base-RTL line, so a parenthesised name reads correctly', () => {
    // A plain character-by-character reversal flips the ORDER of a "(" ... ")" pair but not which
    // glyph each position draws, so "(דנה)" (open, name, close) would reverse into the glyph
    // sequence ")…(" — a close-paren glyph on the left, an open-paren glyph on the right, i.e.
    // backwards-looking brackets around a correctly-reordered name. Verified against a real PDF's
    // glyph x-origins (PyMuPDF get_texttrace, per docs/cma-lessons.md): the fix must make this
    // exact string draw, left to right, as "יפוס (הנד) חוד" — see scratchpad/c4/gen_pdf.js.
    const app = loadApp(['consts', 'db', 'ui', 'views', 'reports', 'exports']);
    const Exports = app.Exports;
    const input = 'דוח (דנה) סופי'; // "Report (Dana) final"
    const out = Exports._pdfBidiReverse(input);
    assert.equal(out, 'יפוס (הנד) חוד', `mirrored brackets must read as an opening paren then the reversed name then a closing paren, got: "${out}"`);
    // Sanity: every character of the reversed name/word run must still be present, just with the
    // bracket glyphs swapped relative to what plain per-character reversal alone would produce.
    const plainReverse = input.split('').reverse().join('');
    assert.notEqual(out, plainReverse, 'a plain per-character reversal alone (no bracket mirroring) is not the fix — brackets must be swapped too');

    // Every other mirrored pair the app might plausibly draw in an RTL line.
    assert.equal(Exports._pdfBidiReverse('א[ב]ג'), 'ג[ב]א', 'square brackets must mirror the same way as parens');
    assert.equal(Exports._pdfBidiReverse('א{ב}ג'), 'ג{ב}א', 'curly braces must mirror');
    assert.equal(Exports._pdfBidiReverse('א<ב>ג'), 'ג<ב>א', 'angle brackets must mirror');
  });

  test('PDF_STRONG_LTR_RE / pdfBaseIsRtl (C4-followups #4): × and ÷ are not strong-LTR, so a line starting with either then Hebrew is base-RTL', () => {
    const app = loadApp(['consts', 'db', 'ui', 'views', 'reports', 'exports']);
    const Exports = app.Exports;

    // Before the fix, × (U+00D7) and ÷ (U+00F7) fell inside the old À-ʯ range and counted as
    // strong LTR — so a line like "× שלום עולם" (all Hebrew apart from the leading math symbol)
    // misclassified as base-LTR and pdfBidiReverse left it untouched, drawing backwards.
    const timesFirst = '× שלום עולם'; // "× שלום עולם"
    const outTimes = Exports._pdfBidiReverse(timesFirst);
    assert.equal(outTimes, timesFirst.split('').reverse().join(''), 'a line starting with × then Hebrew must be treated as base-RTL and reversed, not left untouched as base-LTR');
    assert.notEqual(outTimes, timesFirst, '× must not have made pdfBidiReverse treat this as a no-op base-LTR line');

    const divFirst = '÷ שלום עולם'; // "÷ שלום עולם"
    const outDiv = Exports._pdfBidiReverse(divFirst);
    assert.equal(outDiv, divFirst.split('').reverse().join(''), 'a line starting with ÷ then Hebrew must likewise be base-RTL');

    // A genuine Latin letter still counts as strong LTR immediately, same as before.
    const latinFirst = `M ${'שלום עולם'}`;
    assert.equal(Exports._pdfBidiReverse(latinFirst), latinFirst, 'a line starting with an actual Latin letter must still be treated as base-LTR, untouched');
  });

  test('exportPdf registers the custom font on the jsPDF document once the (stubbed) font fetch resolves', async () => {
    const app = await freshApp();
    const { Exports } = app;

    const fakeFontBytes = new Uint8Array([0x00, 0x01, 0x00, 0x00]).buffer; // content is irrelevant here
    globalThis.fetch = async (url) => {
      assert.match(url, /libs\/fonts\/OpenSans-Regular\.ttf$/, 'the font must be fetched from libs/fonts/, lazily, not bundled inline');
      return { ok: true, arrayBuffer: async () => fakeFontBytes };
    };
    const calls = [];
    const stubPdf = {
      addFileToVFS: (...args) => calls.push(['addFileToVFS', ...args]),
      addFont: (...args) => calls.push(['addFont', ...args]),
    };

    await Exports._preparePdfFont(stubPdf);

    assert.equal(stubPdf.__pdfMultiFont, true, 'a resolved fetch must flag the document as font-loaded');
    assert.ok(calls.some((c) => c[0] === 'addFileToVFS'), 'addFileToVFS must be called to register the font bytes');
    assert.ok(calls.some((c) => c[0] === 'addFont'), 'addFont must be called to make the font selectable by name');
  });

  test('a font fetch that fails (offline before first use) falls back to Helvetica and toasts once, without throwing', async () => {
    const app = await freshApp();
    const { Exports, UI } = app;

    globalThis.fetch = async () => { throw new Error('network unavailable'); };
    let toastMsg = null;
    UI.toast = (msg) => { toastMsg = msg; };
    const stubPdf = { addFileToVFS: () => {}, addFont: () => {} };

    await assert.doesNotReject(Exports._preparePdfFont(stubPdf));
    assert.equal(stubPdf.__pdfMultiFont, false, 'a failed fetch must explicitly flag the document as NOT font-loaded');
    assert.ok(toastMsg, 'a failed fetch must surface a toast rather than failing silently');
  });
});
describe('PDF base direction: accented Latin letters are strong LTR, math signs are not', () => {
  test('a line whose first letter is à, ö, Ø, ß, æ or ñ is base-LTR even when Hebrew follows', () => {
    const app = loadApp(['consts', 'db', 'ui', 'views', 'reports', 'exports']);
    for (const lead of ['à', 'ö', 'Ø', 'ß', 'æ', 'ñ']) {
      const line = `${lead} שלום עולם`;
      assert.equal(app.Exports._pdfBidiReverse(line), line, `"${lead}" must count as a strong left-to-right letter`);
    }
  });
  test('a line starting with × or ÷ followed by Hebrew is still base-RTL', () => {
    const app = loadApp(['consts', 'db', 'ui', 'views', 'reports', 'exports']);
    for (const lead of ['×', '÷']) {
      const line = `${lead} שלום`;
      assert.notEqual(app.Exports._pdfBidiReverse(line), line, `"${lead}" must not decide the base direction`);
    }
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
