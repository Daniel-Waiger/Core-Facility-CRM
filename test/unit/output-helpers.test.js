/* output-helpers.test.js — UI.pdfTitleFromBytes / normalizeDoi / doiUrl / splitAuthors.
 *
 * These are pure text/byte helpers (no DOM, no database), so ['consts', 'ui'] is enough to load
 * them — see test/unit/helpers/load-module.js's own comment on why evaluating the app's real
 * source is the only way in.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-module');

const { UI } = loadApp(['consts', 'ui']);

describe('UI.pdfTitleFromBytes', () => {
  test('a literal /Title string with escaped parens is unescaped, not left with backslashes', () => {
    const pdf = '%PDF-1.4\n1 0 obj\n<< /Title (Volumetric \\(islet\\) mapping) /Author (A) >>\nendobj\n%%EOF';
    const bytes = Buffer.from(pdf, 'latin1');
    assert.equal(UI.pdfTitleFromBytes(bytes), 'Volumetric (islet) mapping');
  });

  test('accepts a plain ArrayBuffer, not only a Uint8Array/Buffer', () => {
    const pdf = '%PDF-1.4\n<< /Title (Plain Buffer Title) >>\n%%EOF';
    const u8 = Buffer.from(pdf, 'latin1');
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    assert.equal(UI.pdfTitleFromBytes(ab), 'Plain Buffer Title');
  });

  test('a hex /Title string with a UTF-16BE BOM decodes to real UTF-16, not raw hex bytes', () => {
    // FEFF (BOM) 0056 006F 006C = "Vol"
    const pdf = '%PDF-1.4\n<< /Title <FEFF0056006F006C> >>\n%%EOF';
    const bytes = Buffer.from(pdf, 'latin1');
    assert.equal(UI.pdfTitleFromBytes(bytes), 'Vol');
  });

  test('no /Title entry anywhere in the bytes returns empty, so the caller falls back to the filename', () => {
    const pdf = '%PDF-1.4\n1 0 obj\n<< /Author (Someone) /Subject (No title here) >>\nendobj\n%%EOF';
    const bytes = Buffer.from(pdf, 'latin1');
    assert.equal(UI.pdfTitleFromBytes(bytes), '');
  });

  test('a /Title of exactly "untitled" (case-insensitive) is treated as no title', () => {
    const pdf = '%PDF-1.4\n<< /Title (untitled) >>\n%%EOF';
    const bytes = Buffer.from(pdf, 'latin1');
    assert.equal(UI.pdfTitleFromBytes(bytes), '');
    const pdfMixedCase = '%PDF-1.4\n<< /Title (UnTitled) >>\n%%EOF';
    assert.equal(UI.pdfTitleFromBytes(Buffer.from(pdfMixedCase, 'latin1')), '');
  });

  test('a /Title that is only whitespace returns empty, not a blank-looking string', () => {
    const pdf = '%PDF-1.4\n<< /Title (   ) >>\n%%EOF';
    const bytes = Buffer.from(pdf, 'latin1');
    assert.equal(UI.pdfTitleFromBytes(bytes), '');
  });

  test('when a PDF has been incrementally saved with two /Title entries, the LAST one wins', () => {
    const pdf = '%PDF-1.4\n<< /Title (Old Draft Title) >>\n%%EOF\n%% updated trailer below %%\n<< /Title (Final Title) >>\n%%EOF';
    const bytes = Buffer.from(pdf, 'latin1');
    assert.equal(UI.pdfTitleFromBytes(bytes), 'Final Title');
  });

  test('a value that is neither ArrayBuffer nor Uint8Array returns empty rather than throwing', () => {
    assert.equal(UI.pdfTitleFromBytes(null), '');
    assert.equal(UI.pdfTitleFromBytes('not bytes'), '');
    assert.equal(UI.pdfTitleFromBytes(undefined), '');
  });
});

describe('UI.normalizeDoi', () => {
  test('a resolver URL (https://doi.org/...) is stripped down to the bare DOI', () => {
    assert.equal(UI.normalizeDoi('https://doi.org/10.1000/abc'), '10.1000/abc');
  });

  test('a "doi:" prefix (any case) is stripped down to the bare DOI', () => {
    assert.equal(UI.normalizeDoi('doi:10.1000/abc'), '10.1000/abc');
    assert.equal(UI.normalizeDoi('DOI:10.1000/abc'), '10.1000/abc');
  });

  test('the http:// and dx.doi.org resolver variants are also stripped', () => {
    assert.equal(UI.normalizeDoi('http://doi.org/10.1000/abc'), '10.1000/abc');
    assert.equal(UI.normalizeDoi('https://dx.doi.org/10.1000/abc'), '10.1000/abc');
  });

  test('text that is not shaped like a DOI returns empty rather than storing garbage', () => {
    assert.equal(UI.normalizeDoi('not a doi'), '');
  });

  test('empty/null/undefined input returns empty without throwing', () => {
    assert.equal(UI.normalizeDoi(''), '');
    assert.equal(UI.normalizeDoi(null), '');
    assert.equal(UI.normalizeDoi(undefined), '');
  });
});

describe('UI.doiUrl', () => {
  test('builds a clickable resolver link from a bare or prefixed DOI', () => {
    assert.equal(UI.doiUrl('10.1000/abc'), 'https://doi.org/10.1000/abc');
    assert.equal(UI.doiUrl('doi:10.1000/abc'), 'https://doi.org/10.1000/abc');
  });

  test('returns empty for anything normalizeDoi rejects, never a broken link', () => {
    assert.equal(UI.doiUrl('not a doi'), '');
    assert.equal(UI.doiUrl(''), '');
  });
});

describe('UI.splitAuthors', () => {
  test('splits on ";" and newline, NOT on "," — "Smith, J." is one author, not two', () => {
    const authors = UI.splitAuthors('Smith, J.; Doe, A.\nLee, K');
    assert.equal(authors.length, 3);
    assert.deepEqual(authors, ['Smith, J.', 'Doe, A.', 'Lee, K']);
  });

  test('trims whitespace around each name and drops empty entries from stray separators', () => {
    assert.deepEqual(UI.splitAuthors(' Smith, J. ;; \nDoe, A.\n'), ['Smith, J.', 'Doe, A.']);
  });

  test('empty/null/undefined input returns an empty array, not [""]', () => {
    assert.deepEqual(UI.splitAuthors(''), []);
    assert.deepEqual(UI.splitAuthors(null), []);
    assert.deepEqual(UI.splitAuthors(undefined), []);
  });
});
