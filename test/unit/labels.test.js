/* labels.test.js — display-vs-data helpers: translate ONLY at render time, never touch storage.
 *
 * fmtMoney reads DB.getConfig('currency', ...), which needs a real, booted sql.js database (its
 * fallback only kicks in for a MISSING row, not a missing DB — DB.getConfig throws on an
 * unbooted DB). So this file uses test/unit/helpers/sqlite.js's freshDb(), which boots the app's
 * real schema/migrations in Node's in-memory sql.js mode (see that file's own comment for why
 * that's a genuine DB, not a fake one) rather than hand-rolling a currency stub.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { freshDb } = require('./helpers/sqlite');

describe('labels: UI.fmtMoney', () => {
  test('formats zero, integers, and thousands separators with two decimals and the default currency', async () => {
    const { UI } = await freshDb();
    // No app_config row for 'currency' yet — DB.getConfig('currency', '$') falls back to '$'.
    assert.equal(UI.fmtMoney(0), '$0.00');
    assert.equal(UI.fmtMoney(5), '$5.00');
    assert.equal(UI.fmtMoney(1250), '$1,250.00', 'locale thousands separator');
    assert.equal(UI.fmtMoney(1234567), '$1,234,567.00');
  });

  test('null/undefined/NaN all format as zero, not as blank or "NaN"', async () => {
    const { UI } = await freshDb();
    assert.equal(UI.fmtMoney(null), '$0.00');
    assert.equal(UI.fmtMoney(undefined), '$0.00');
    assert.equal(UI.fmtMoney(NaN), '$0.00');
  });

  test('a numeric string is coerced the same as a number', async () => {
    const { UI } = await freshDb();
    assert.equal(UI.fmtMoney('42.5'), '$42.50');
  });

  test('honours a changed currency symbol (read live from DB.getConfig, not cached)', async () => {
    const { UI, DB } = await freshDb();
    DB.setConfig('currency', '€');
    assert.equal(UI.fmtMoney(10), '€10.00');
  });

  // Binary floating point: 1.005 is actually stored as 1.00499999999999989..., and 2.675 as
  // 2.67499999999999982... — so Math.round(n*100)/100 rounds each DOWN to the nearest cent that
  // is actually representable. Asserting $1.01 / $2.68 as some "more correct" rounding would be
  // asserting a rounding behavior fmtMoney does not have; $1.00 / $2.68 is what this exact
  // implementation produces, and it is a floating-point truth, not a bug in this app's code.
  test('half-cent floating-point cases: fmtMoney(1.005) is $1.00 and fmtMoney(2.675) is $2.68', async () => {
    const { UI } = await freshDb();
    assert.equal(UI.fmtMoney(1.005), '$1.00', '1.005 is actually stored as ~1.00499999999999989 in IEEE 754 double');
    assert.equal(UI.fmtMoney(2.675), '$2.68', '2.675 is actually stored as ~2.67499999999999982 in IEEE 754 double');
  });
});

describe('labels: UI.unitLabel', () => {
  const { UI, CONST } = require('./helpers/load-module').loadApp(['consts', 'db', 'ui']);

  test('every CONST.UNIT vocabulary member has a distinct label', () => {
    for (const u of CONST.UNIT) {
      const label = UI.unitLabel(u);
      assert.notEqual(label, u, `UNIT member '${u}' must map to a real label, not fall through unchanged`);
    }
  });

  test("'' and null default to the 'time' label", () => {
    assert.equal(UI.unitLabel(''), UI.unitLabel('time'));
    assert.equal(UI.unitLabel(null), UI.unitLabel('time'));
  });

  test('a facility-added (unknown) unit value falls through unchanged, since UNIT is user-extensible', () => {
    assert.equal(UI.unitLabel('per-slide'), 'per-slide');
  });
});

describe('labels: UI.msStatusLabel', () => {
  const { UI, CONST } = require('./helpers/load-module').loadApp(['consts', 'db', 'ui']);

  test('every CONST.MS_STATUS vocabulary member has a distinct label', () => {
    for (const s of CONST.MS_STATUS) {
      const label = UI.msStatusLabel(s);
      assert.notEqual(label, s, `MS_STATUS member '${s}' must map to a real label, not fall through unchanged`);
    }
  });

  test("'overdue' (derived, not a stored status) also has a real label", () => {
    assert.equal(UI.msStatusLabel('overdue'), 'Overdue');
  });

  test('an unknown status value falls through unchanged', () => {
    assert.equal(UI.msStatusLabel('some-future-status'), 'some-future-status');
  });

  test("'' renders as itself (empty), not a crash", () => {
    assert.equal(UI.msStatusLabel(''), '');
  });
});

describe('labels: UI.retiredName', () => {
  const { UI } = require('./helpers/load-module').loadApp(['consts', 'db', 'ui']);

  test("appends ' (Retired)' only when isRetired is true", () => {
    assert.equal(UI.retiredName('David Kim', true), 'David Kim (Retired)');
    assert.equal(UI.retiredName('David Kim', false), 'David Kim');
  });

  test('null/undefined name is handled safely', () => {
    assert.equal(UI.retiredName(null, true), ' (Retired)');
    assert.equal(UI.retiredName(undefined, false), '');
  });

  test('does not mutate its input', () => {
    const name = 'Dr. Elena Rostova';
    const original = name;
    UI.retiredName(name, true);
    assert.equal(name, original, 'retiredName must be a pure display formatter, never touching the stored value');
  });
});

describe('labels: UI.esc', () => {
  const { UI } = require('./helpers/load-module').loadApp(['consts', 'db', 'ui']);

  test('escapes & < > " \' ', () => {
    assert.equal(UI.esc(`& < > " '`), '&amp; &lt; &gt; &quot; &#39;');
  });

  test('plain text is left alone', () => {
    assert.equal(UI.esc('Olympus FV3000'), 'Olympus FV3000');
  });

  test('null/undefined escape to empty string', () => {
    assert.equal(UI.esc(null), '');
    assert.equal(UI.esc(undefined), '');
  });
});

describe('labels: UI.isSafeUrl (security boundary for clickable project file links)', () => {
  const { UI } = require('./helpers/load-module').loadApp(['consts', 'db', 'ui']);

  test('accepts http and https URLs', () => {
    assert.equal(UI.isSafeUrl('http://example.com/file.pdf'), true);
    assert.equal(UI.isSafeUrl('https://example.com/file.pdf'), true);
  });

  test('rejects javascript:, data:, file:, relative paths, empty, and null', () => {
    assert.equal(UI.isSafeUrl('javascript:alert(1)'), false);
    assert.equal(UI.isSafeUrl('data:text/html,<script>alert(1)</script>'), false);
    assert.equal(UI.isSafeUrl('file:///etc/passwd'), false);
    assert.equal(UI.isSafeUrl('/local/relative/path.pdf'), false);
    assert.equal(UI.isSafeUrl(''), false);
    assert.equal(UI.isSafeUrl(null), false);
  });
});
