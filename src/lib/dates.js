// Calendar-date helpers. All dates are plain ISO strings (YYYY-MM-DD) and arithmetic is done on UTC day numbers,
// so results never depend on the machine's timezone or daylight-saving changes.

const MS_PER_DAY = 86400000;

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function makeIso(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function checkParts(y, m, d, format) {
  if (y < 1900 || y > 2100) return { ok: false, error: `year ${y} is outside 1900-2100` };
  if (m < 1 || m > 12) return { ok: false, error: `month ${m} does not exist` };
  if (d < 1 || d > daysInMonth(y, m)) return { ok: false, error: `day ${d} does not exist in ${makeIso(y, m, 1).slice(0, 7)}` };
  return { ok: true, iso: makeIso(y, m, d), format };
}

/**
 * Parse a date in one of the accepted formats. Returns { ok, iso, format } or { ok:false, error }.
 * Accepted: YYYY-MM-DD, YYYY/MM/DD, ISO 8601 date-time (date part kept as written, no timezone shift),
 * DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY (day first; US month-first dates are NOT accepted).
 */
export function parseDateInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, empty: true, error: 'empty' };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return checkParts(+m[1], +m[2], +m[3], 'YYYY-MM-DD');
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    if (+m[4] > 23 || +m[5] > 59) return { ok: false, error: 'time of day is out of range' };
    return checkParts(+m[1], +m[2], +m[3], 'ISO date-time');
  }
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return checkParts(+m[1], +m[2], +m[3], 'YYYY/MM/DD');
  m = s.match(/^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/);
  if (m) {
    const label = m[2] === '/' ? 'DD/MM/YYYY' : m[2] === '.' ? 'DD.MM.YYYY' : 'DD-MM-YYYY';
    return checkParts(+m[4], +m[3], +m[1], label);
  }
  return { ok: false, error: `"${s}" is not in an accepted date format` };
}

export function isIsoDate(s) {
  const r = parseDateInput(s);
  return r.ok && r.format === 'YYYY-MM-DD' && /^\d{4}-\d{2}-\d{2}$/.test(String(s).trim());
}

export function isoToDayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function dayNumberToIso(n) {
  const dt = new Date(n * MS_PER_DAY);
  return makeIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(iso) {
  return new Date(isoToDayNumber(iso) * MS_PER_DAY).getUTCDay();
}

export function isWeekend(iso) {
  const w = weekdayOf(iso);
  return w === 0 || w === 6;
}

/** Whole days from a to b (b - a). */
export function daysBetween(aIso, bIso) {
  return isoToDayNumber(bIso) - isoToDayNumber(aIso);
}

/**
 * Due date = start + n days. With skipWeekends, n counts business days (Mon-Fri) and a 0-day offset that
 * falls on a weekend rolls forward to Monday. Public holidays are not considered.
 */
export function addDays(startIso, n, skipWeekends = false) {
  let day = isoToDayNumber(startIso);
  if (!skipWeekends) return dayNumberToIso(day + n);
  let remaining = n;
  while (remaining > 0) {
    day += 1;
    if (!isWeekend(dayNumberToIso(day))) remaining -= 1;
  }
  while (isWeekend(dayNumberToIso(day))) day += 1;
  return dayNumberToIso(day);
}

/** Local calendar date of a Date object as YYYY-MM-DD. */
export function localIsoDate(date = new Date()) {
  return makeIso(date.getFullYear(), date.getMonth() + 1, date.getDate());
}
