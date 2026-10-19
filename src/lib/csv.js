// RFC 4180 CSV parser and serializer. Pure functions, no DOM, no dependencies.
// Handles: UTF-8 BOM, CRLF / LF / CR line endings, quoted fields, escaped quotes (""),
// commas and newlines inside quoted fields. Exports protect against CSV/formula injection.

export class CsvParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CsvParseError';
  }
}

/**
 * Parse CSV text into an array of records (arrays of strings).
 * Throws CsvParseError on an unterminated quoted field.
 */
export function parseCsv(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let quotedField = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '' && !quotedField) {
      inQuotes = true;
      quotedField = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      quotedField = false;
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      quotedField = false;
      if (c === '\r' && s[i + 1] === '\n') i++;
      i++;
      continue;
    }
    field += c; // lenient: a stray quote inside an unquoted field is kept literally
    i++;
  }
  if (inQuotes) {
    throw new CsvParseError(`Unterminated quoted field in record ${rows.length + 1}. Check for a missing closing double quote.`);
  }
  if (field !== '' || row.length > 0 || quotedField) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const NUMERIC_CELL = /^[+-]?\d+(\.\d+)?$/;

/** Escape one cell. With protect=true, cells starting with = + - @ TAB or CR are prefixed with ' (formula injection),
 *  except plain numbers such as +441632960001 or -12, which spreadsheets cannot execute as formulas. */
export function escapeCsvCell(value, protect = true) {
  let s = value === null || value === undefined ? '' : String(value);
  if (protect && /^[=+\-@\t\r]/.test(s) && !NUMERIC_CELL.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Serialize an array of arrays to CSV text (CRLF line endings per RFC 4180). */
export function serializeCsv(rows, { eol = '\r\n', protect = true } = {}) {
  if (!rows.length) return '';
  return rows.map((r) => r.map((c) => escapeCsvCell(c, protect)).join(',')).join(eol) + eol;
}

/** Serialize objects using an explicit column list. */
export function objectsToCsv(objects, columns, opts) {
  const rows = [columns];
  for (const o of objects) rows.push(columns.map((col) => (o[col] === undefined || o[col] === null ? '' : o[col])));
  return serializeCsv(rows, opts);
}
