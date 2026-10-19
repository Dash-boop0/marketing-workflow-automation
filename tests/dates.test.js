import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDateInput, addDays, isIsoDate, daysBetween, weekdayOf } from '../src/lib/dates.js';

test('accepted date formats normalise to YYYY-MM-DD', () => {
  assert.equal(parseDateInput('2026-10-05').iso, '2026-10-05');
  assert.equal(parseDateInput('2026-1-5').iso, '2026-01-05');
  assert.equal(parseDateInput('2026/10/04').iso, '2026-10-04');
  assert.equal(parseDateInput('05/10/2026').iso, '2026-10-05'); // day first
  assert.equal(parseDateInput('15.09.2026').iso, '2026-09-15');
  assert.equal(parseDateInput('15-09-2026').iso, '2026-09-15');
  assert.equal(parseDateInput('2026-10-07T14:30:00Z').iso, '2026-10-07');
  assert.equal(parseDateInput('2026-10-07 23:59').iso, '2026-10-07');
});

test('impossible or unsupported dates are rejected with a reason', () => {
  assert.equal(parseDateInput('2026-13-05').ok, false);
  assert.match(parseDateInput('31/02/2026').error, /day 31/);
  assert.equal(parseDateInput('2025-02-29').ok, false);
  assert.equal(parseDateInput('2024-02-29').ok, true); // leap year
  assert.equal(parseDateInput('Oct 5 2026').ok, false);
  assert.equal(parseDateInput('10/31/2026').ok, false); // US month-first is not accepted
  assert.equal(parseDateInput('').empty, true);
});

test('isIsoDate only accepts strict YYYY-MM-DD', () => {
  assert.equal(isIsoDate('2026-10-20'), true);
  assert.equal(isIsoDate('2026-1-2'), false);
  assert.equal(isIsoDate('20/10/2026'), false);
  assert.equal(isIsoDate('2026-02-30'), false);
});

test('calendar-day offsets', () => {
  assert.equal(addDays('2026-10-20', 7, false), '2026-10-27');
  assert.equal(addDays('2026-12-30', 3, false), '2027-01-02');
  assert.equal(daysBetween('2026-09-20', '2026-10-20'), 30);
});

test('business-day offsets skip weekends (known cases)', () => {
  assert.equal(weekdayOf('2026-10-20'), 2); // Tuesday
  assert.equal(addDays('2026-10-20', 1, true), '2026-10-21'); // Tue +1 -> Wed
  assert.equal(addDays('2026-10-20', 3, true), '2026-10-23'); // Tue +3 -> Fri
  assert.equal(addDays('2026-10-20', 7, true), '2026-10-29'); // Tue +7 business days -> Thu next week
  assert.equal(addDays('2026-10-23', 1, true), '2026-10-26'); // Fri +1 -> Mon
  assert.equal(addDays('2026-10-24', 0, true), '2026-10-26'); // Sat +0 rolls to Mon
  assert.equal(addDays('2026-10-24', 1, true), '2026-10-26'); // Sat +1 -> Mon
  assert.equal(addDays('2026-10-25', 2, true), '2026-10-27'); // Sun +2 -> Tue
  assert.equal(addDays('2026-10-21', 0, true), '2026-10-21'); // weekday +0 unchanged
});
