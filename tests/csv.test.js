import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, serializeCsv, escapeCsvCell, objectsToCsv, CsvParseError } from '../src/lib/csv.js';

test('parses simple rows with LF and CRLF line endings', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\r1,2'), [['a', 'b'], ['1', '2']]);
});

test('strips a UTF-8 BOM', () => {
  assert.deepEqual(parseCsv('﻿email\nx@example.com'), [['email'], ['x@example.com']]);
});

test('handles quoted commas, escaped quotes and newlines inside quotes', () => {
  const rows = parseCsv('name,notes\n"Harbor & Finch, LLC","He said ""hi""\nsecond line"\n');
  assert.deepEqual(rows, [['name', 'notes'], ['Harbor & Finch, LLC', 'He said "hi"\nsecond line']]);
});

test('keeps empty fields, quoted empty fields and a trailing empty field', () => {
  assert.deepEqual(parseCsv('a,,c,\n"",x,,'), [['a', '', 'c', ''], ['', 'x', '', '']]);
});

test('empty input gives no rows; last line without newline is kept', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('a'), [['a']]);
});

test('unterminated quote throws a CsvParseError with a record number', () => {
  assert.throws(() => parseCsv('a,b\n"open,2\n'), (e) => e instanceof CsvParseError && /record 2/.test(e.message));
});

test('serializer quotes only when needed and round-trips', () => {
  const rows = [['id', 'text'], ['1', 'plain'], ['2', 'a,b'], ['3', 'say "x"'], ['4', 'line1\nline2'], ['5', ' padded ']];
  const text = serializeCsv(rows, { protect: false });
  assert.equal(text.split('\r\n')[2], '2,"a,b"');
  assert.deepEqual(parseCsv(text), rows);
});

test('formula injection protection prefixes = + - @ but not plain numbers', () => {
  assert.equal(escapeCsvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(escapeCsvCell('@cmd'), "'@cmd");
  assert.equal(escapeCsvCell('-2+3'), "'-2+3");
  assert.equal(escapeCsvCell('+441632960001'), '+441632960001');
  assert.equal(escapeCsvCell('-12.5'), '-12.5');
  assert.equal(escapeCsvCell('=HYPERLINK("x","y")'), '"\'=HYPERLINK(""x"",""y"")"');
  assert.equal(escapeCsvCell('=x', false), '=x');
});

test('objectsToCsv uses the given column order and blanks null/undefined', () => {
  assert.equal(objectsToCsv([{ b: 2, a: null }], ['a', 'b']), 'a,b\r\n,2\r\n');
});
