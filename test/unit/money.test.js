/* money.test.js — the booking cost calculator (UI.computeBookingBOM / UI.billableStaffHours).
 *
 * This function is pure arithmetic (no DB access — it takes rates/discounts as plain numbers,
 * resolved by its CALLER per CLAUDE.md/js/ui.js's own comment), so only 'consts' and 'ui' need
 * to be loaded — no DB boot required here.
 *
 * See js/ui.js's long comment block above computeBookingBOM (search "Booking cost math (bill of
 * materials)") and js/db.js's seedBooking/seedSampleData for the shapes and the regression triple.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-module');

const { UI } = loadApp(['consts', 'ui']);

describe('money: instrument pricing', () => {
  test('instrument pricing splits on cost_unit: time bills cost x hours, other units bill cost x amount', () => {
    const bom = UI.computeBookingBOM({
      start: '09:00', end: '11:00', // 2 hours
      instruments: [
        { cost: 150, cost_unit: 'time' },       // time: 150 * 2h = 300
        { cost: 45, cost_unit: 'unit', amount: 3 }, // per-unit: 45 * 3 = 135
      ],
      staff: [],
      groupPct: 0, manualPct: 0,
      rates: { overheadPct: 0, taxPct: 0 },
    });
    // Time-billed and amount-billed instrument cost are tracked in SEPARATE accumulators
    // (instrTime / instrAmount) because the discount rule below applies to instrTime only.
    assert.equal(bom.instrTime, 300, 'time-billed instrument: cost * bookingHours');
    assert.equal(bom.instrAmount, 135, 'amount-billed instrument: cost * amount');
    assert.equal(bom.subtotal, 435, 'subtotal is the sum of both instrument buckets (no staff here)');
  });

  test('no start/end on the booking gives 0 booking hours, so a time-billed instrument contributes 0', () => {
    const bom = UI.computeBookingBOM({
      start: '', end: '',
      instruments: [{ cost: 150, cost_unit: 'time' }],
      staff: [],
      groupPct: 0, manualPct: 0,
      rates: { overheadPct: 0, taxPct: 0 },
    });
    assert.equal(bom.bookingHours, 0);
    assert.equal(bom.instrTime, 0, 'time-billed instrument with 0 booking hours bills nothing');
  });
});

describe('money: the 1-hour staff floor', () => {
  test('billableStaffHours: 0 -> 0, 10min -> 1, 60min -> 1, 65min -> 2, 2.0h -> 2', () => {
    // Any staff time above zero bills at least 1 hour, then rounds UP past that.
    assert.equal(UI.billableStaffHours(0), 0, 'zero raw hours bills zero (no time held)');
    assert.equal(UI.billableStaffHours(10 / 60), 1, '10 minutes floors up to 1 hour');
    assert.equal(UI.billableStaffHours(1), 1, 'exactly 60 minutes bills as 1 hour, not rounded up further');
    assert.equal(UI.billableStaffHours(65 / 60), 2, '65 minutes rounds up past the hour to 2');
    assert.equal(UI.billableStaffHours(2.0), 2, 'a whole 2 hours bills as exactly 2');
  });

  test('the 1-hour floor applies through a full BOM, not just the standalone helper', () => {
    const bom = UI.computeBookingBOM({
      start: '09:00', end: '09:10', // 10 minutes booking window
      instruments: [],
      staff: [{ rate: 100, start: '', end: '' }], // blank window -> whole booking window (10 min)
      groupPct: 0, manualPct: 0,
      rates: { overheadPct: 0, taxPct: 0 },
    });
    assert.equal(bom.staffLines[0].rawHours, 10 / 60);
    assert.equal(bom.staffLines[0].billHours, 1, '10 raw minutes floors to 1 billed hour');
    assert.equal(bom.staffTotal, 100, 'staff line = rate(100) * billHours(1)');
  });
});

describe('money: staff windows', () => {
  test('a blank per-staff window means the WHOLE booking window, not zero (CLAUDE.md data-model trap)', () => {
    // CLAUDE.md: "meeting_staff.start_time = '' means the whole booking window, not zero (so a
    // naive SUM over those columns reports ~0)". A 09:00-11:30 booking is 2.5 raw hours, which
    // floors/rounds (per the 1-hour-floor rule) up to 3 billed hours.
    const bom = UI.computeBookingBOM({
      start: '09:00', end: '11:30',
      instruments: [],
      staff: [{ rate: 80, start: '', end: '' }],
      groupPct: 0, manualPct: 0,
      rates: { overheadPct: 0, taxPct: 0 },
    });
    assert.equal(bom.staffLines[0].rawHours, 2.5, 'blank start/end resolves to the full 2.5h booking window, not 0');
    assert.equal(bom.staffLines[0].billHours, 3, '2.5h rounds up to 3 billed hours');
    assert.equal(bom.staffTotal, 240, '80 * 3');
  });
});

describe('money: discount rule', () => {
  test('discount applies only to time-billed instrument cost', () => {
    // Build a BOM with a time instrument AND a per-unit instrument AND staff, then apply a
    // group discount. Only the time-billed instrument line may move.
    const bom = UI.computeBookingBOM({
      start: '09:00', end: '11:00', // 2h
      instruments: [
        { cost: 150, cost_unit: 'time' },            // instrTime: 150*2 = 300
        { cost: 45, cost_unit: 'unit', amount: 3 },   // instrAmount: 45*3 = 135 (must be untouched)
      ],
      staff: [{ rate: 95, start: '', end: '' }],      // staffTotal: 95*2 = 190 (must be untouched)
      groupPct: 10, manualPct: 0,
      rates: { overheadPct: 0, taxPct: 0 },
    });
    assert.equal(bom.instrTime, 300);
    assert.equal(bom.instrAmount, 135);
    assert.equal(bom.staffTotal, 190);
    // The rule under test: discountAmt === instrTime * pct/100 exactly — staff and per-unit
    // instrument lines are NOT discounted, even though they're part of the same subtotal.
    assert.equal(bom.discountAmt, 300 * 0.10, 'discount is computed off instrTime alone');
    assert.equal(bom.subtotal, 300 + 135 + 190, 'subtotal includes all three lines undiscounted');
    assert.equal(bom.afterDiscount, bom.subtotal - bom.discountAmt, 'only the discount amount is subtracted, once');
  });

  test('groupPct + manualPct is capped at 100', () => {
    const bom = UI.computeBookingBOM({
      start: '09:00', end: '11:00',
      instruments: [{ cost: 100, cost_unit: 'time' }],
      staff: [],
      groupPct: 60, manualPct: 60, // sums to 120, must cap at 100
      rates: { overheadPct: 0, taxPct: 0 },
    });
    assert.equal(bom.discPct, 100, 'combined discount percent is capped at 100');
    assert.equal(bom.discountAmt, bom.instrTime, 'at a 100% cap the entire time-billed instrument cost is discounted');
    assert.equal(bom.afterDiscount, 0);
  });
});

describe('money: order of operations', () => {
  test('subtotal -> afterDiscount -> overhead(afterDiscount) -> beforeTax -> tax(beforeTax) -> total', () => {
    const bom = UI.computeBookingBOM({
      start: '09:00', end: '11:00', // 2h
      instruments: [{ cost: 150, cost_unit: 'time' }], // instrTime = 300
      staff: [{ rate: 95, start: '', end: '' }],        // staffTotal = 95*2 = 190
      groupPct: 5, manualPct: 0,
      rates: { overheadPct: 15, taxPct: 8 },
    });
    // subtotal = 300 + 190 = 490
    assert.equal(bom.subtotal, 490);
    // discount = 300 * 5% = 15; afterDiscount = 490 - 15 = 475
    assert.equal(bom.discountAmt, 15);
    assert.equal(bom.afterDiscount, 475);
    // overhead is applied to afterDiscount, NOT to subtotal: 475 * 15% = 71.25
    assert.equal(bom.overheadAmt, 71.25);
    // beforeTax = afterDiscount + overheadAmt = 475 + 71.25 = 546.25 — the figure a facility invoices
    assert.equal(bom.beforeTax, 546.25);
    // tax is applied to beforeTax, NOT to afterDiscount or subtotal: 546.25 * 8% = 43.7
    assert.equal(bom.taxAmt, 43.7);
    // total = beforeTax + taxAmt = 546.25 + 43.7 = 589.95
    assert.equal(bom.total, 589.95);
  });
});

describe('money: staffPctFactor', () => {
  test('staffPctFactor scales staff lines only (after the floor), instrument time is unchanged', () => {
    const bom = UI.computeBookingBOM({
      start: '09:00', end: '11:00', // 2h
      instruments: [{ cost: 150, cost_unit: 'time' }], // 300, must be untouched by staffPctFactor
      staff: [{ rate: 95, start: '', end: '' }],        // floored/billed at 2h -> 190 before factor
      groupPct: 0, manualPct: 0,
      rates: { overheadPct: 0, taxPct: 0 },
      staffPctFactor: 0.5, // half-price staff billing policy
    });
    assert.equal(bom.instrTime, 300, 'staffPctFactor never touches instrument time');
    assert.equal(bom.staffLines[0].billHours, 2, 'the floor/ceiling is applied BEFORE the factor');
    assert.equal(bom.staffLines[0].line, 95 * 2 * 0.5, 'factor scales the already-floored line');
    assert.equal(bom.staffTotal, 95);
  });

  test('omitting staffPctFactor behaves as 1, so legacy bookings (predating this field) are unaffected', () => {
    const withFactor = UI.computeBookingBOM({
      start: '09:00', end: '11:00',
      instruments: [], staff: [{ rate: 95, start: '', end: '' }],
      groupPct: 0, manualPct: 0, rates: { overheadPct: 0, taxPct: 0 },
      staffPctFactor: 1,
    });
    const omitted = UI.computeBookingBOM({
      start: '09:00', end: '11:00',
      instruments: [], staff: [{ rate: 95, start: '', end: '' }],
      groupPct: 0, manualPct: 0, rates: { overheadPct: 0, taxPct: 0 },
      // staffPctFactor omitted entirely
    });
    assert.equal(omitted.staffTotal, withFactor.staffTotal);
    assert.equal(omitted.staffPctFactor, 1);
  });
});

describe('money: UI.round2 is the one shared 2dp rounding helper', () => {
  // js/app.js's service-entry savers (seSave/seEditSave) round `qty * rate` through UI.round2
  // before storing it, rather than storing the raw float — the same rounding fmtMoney applies at
  // display time, so a stored total and its displayed figure never disagree. CLAUDE.md requires
  // exactly one copy of shared money arithmetic; this pins UI.round2 as that copy so a future
  // change doesn't fork a second rounding formula into app.js.
  test('qty 3 x rate 1.15 rounds to 3.45, not the raw floating-point 3.4499999999999997', () => {
    const raw = 3 * 1.15;
    assert.notEqual(raw, 3.45, 'sanity check: the unrounded float is NOT already 3.45');
    assert.equal(UI.round2(raw), 3.45);
  });

  test('round2 matches the rounding fmtMoney applies for display (same figure, cent-accurate)', () => {
    assert.equal(UI.round2(3 * 1.15), 3.45);
    assert.equal(UI.fmtMoney(3 * 1.15), '$3.45');
  });

  test('round2 tolerates non-numeric/undefined input the same way the rest of the money helpers do', () => {
    assert.equal(UI.round2(undefined), 0);
    assert.equal(UI.round2(NaN), 0);
  });
});

describe('money: the regression triple', () => {
  // js/db.js's seedSampleData, booking #1 (search its comment for "490 / 546.25 / 589.95"),
  // documents the exact inputs this must reproduce, and js/db.js's own seed data (peopleData /
  // instData, also read directly rather than invented) supplies the real numbers behind them:
  //   - Instrument id 2 = 'Olympus FV3000', cost=150, cost_unit='time' (instData row 2).
  //   - Person id 6 = 'David Kim', is_staff=1, rate=95 (peopleData row 6).
  //   - Booking: date/-95d, start '09:00', end '11:00' -> 2 booking hours.
  //   - Bio-Photonics Lab has a standing 5% group discount (setGroupDiscount('Bio-Photonics Lab', 5)),
  //     and is deliberately left unassigned to any pricing tier, so overhead falls back to the
  //     legacy overhead_internal(10) + overhead_external(5) = 15% sum.
  //   - tax_pct = 8 (setConfig('tax_pct', '8')).
  //   - staff David Kim's own start/end are omitted in the spec, so his window is the whole
  //     booking window (2h) per the "blank staff window" rule above; category 'sync' carries the
  //     default 100% staff_pct policy (seedDefaultCategoryPolicies), so staffPctFactor = 1.
  test('booking #1 (2h Olympus FV3000 @ $150/hr + David Kim @ $95/hr, 5% group discount, 15% overhead, 8% tax) lands on subtotal 490, beforeTax 546.25, total 589.95', () => {
    const bom = UI.computeBookingBOM({
      start: '09:00', end: '11:00',
      instruments: [{ cost: 150, cost_unit: 'time' }],
      staff: [{ rate: 95, start: '', end: '' }],
      groupPct: 5, manualPct: 0,
      rates: { overheadPct: 15, taxPct: 8 },
      staffPctFactor: 1,
    });
    assert.equal(bom.subtotal, 490, 'documented regression figure #1: subtotal');
    assert.equal(bom.beforeTax, 546.25, 'documented regression figure #2: total before tax (the invoiced figure)');
    assert.equal(bom.total, 589.95, 'documented regression figure #3: grand total including tax');
  });
});

describe('money: subtotal must equal the sum of the rounded per-line amounts', () => {
  // Item 13 (adversarial review of PR #44): instrTime/instrAmount/staffTotal used to accumulate
  // the UNROUNDED per-line value while each line's own displayed/stored `.line` was round2()'d
  // individually — so the subtotal these totals feed into could differ from the sum of the lines
  // a facility would actually see and add up by hand. Three lines that each round the same
  // direction (0.333... -> 0.33) make that drift land on a real cent, not just a float artifact.
  test('three instrument lines of $0.333... each: subtotal is the sum of the ROUNDED lines (0.99), not 3 * 0.333... rounded once (1.00)', () => {
    const bom = UI.computeBookingBOM({
      start: '10:00', end: '11:00', // 1 booking hour, so a 'time' line's amount is just its cost
      instruments: [
        { cost: 1 / 3, cost_unit: 'time' },
        { cost: 1 / 3, cost_unit: 'time' },
        { cost: 1 / 3, cost_unit: 'time' },
      ],
      staff: [],
      groupPct: 0, manualPct: 0,
      rates: { overheadPct: 0, taxPct: 0 },
    });
    const sumOfLines = bom.instrumentLines.reduce((s, it) => s + it.line, 0);
    assert.equal(bom.instrumentLines.map((it) => it.line).join(','), '0.33,0.33,0.33', 'each line rounds to $0.33 individually');
    assert.equal(sumOfLines, 0.99, 'sanity check on the fixture itself: 0.33 * 3 = 0.99');
    assert.equal(bom.instrTime, 0.99, 'instrTime must equal the sum of the ROUNDED lines the user actually sees, not 3 * (1/3) rounded once');
    assert.equal(bom.subtotal, sumOfLines, 'subtotal must reconcile exactly against the sum of the stored/displayed lines');
  });

  test('same drift, staff side: three staff lines of $0.333... each sum to $0.99, not $1.00', () => {
    const bom = UI.computeBookingBOM({
      start: '10:00', end: '11:00', // 1 booking hour -> billableStaffHours floors to 1
      instruments: [],
      staff: [
        { rate: 1 / 3, start: '', end: '' },
        { rate: 1 / 3, start: '', end: '' },
        { rate: 1 / 3, start: '', end: '' },
      ],
      groupPct: 0, manualPct: 0,
      rates: { overheadPct: 0, taxPct: 0 },
      staffPctFactor: 1,
    });
    const sumOfLines = bom.staffLines.reduce((s, p) => s + p.line, 0);
    assert.equal(bom.staffLines.map((p) => p.line).join(','), '0.33,0.33,0.33');
    assert.equal(bom.staffTotal, 0.99, 'staffTotal must equal the sum of the rounded staff lines, not the unrounded raw total');
    assert.equal(bom.subtotal, sumOfLines, 'subtotal must reconcile exactly against the sum of the stored/displayed staff lines');
  });
});
