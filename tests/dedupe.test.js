import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseRecord } from '../src/lib/normalise.js';
import { dedupeRecords } from '../src/lib/dedupe.js';

const mk = (row, patch) => normaliseRecord({
  first_name: 'Ava', last_name: 'Patel', email: 'ava@example.com', phone: '', company: 'Northbridge (synthetic)', job_title: '',
  company_size: '', country: 'US', source: 'Website', created_at: '', opt_in: 'yes', notes: '', ...patch,
}, { today: '2026-10-20', row }).record;

test('exact email duplicates (case/whitespace-insensitive) merge into the first row', () => {
  const { survivors, duplicates } = dedupeRecords([mk(2, {}), mk(5, { email: ' AVA@Example.com ', phone: '202-555-0101' })], { today: '2026-10-20' });
  assert.equal(survivors.length, 1);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].code, 'duplicate_email');
  assert.equal(survivors[0].row, 2);
  assert.equal(survivors[0].phone, '+12025550101'); // blank field filled from duplicate
  assert.deepEqual(duplicates[0].filled, ['phone']);
  assert.deepEqual(survivors[0].source_rows, [2, 5]);
});

test('name + company duplicates with different emails are detected', () => {
  const { survivors, duplicates } = dedupeRecords([mk(2, {}), mk(3, { email: 'ava.p@example.net', company: 'NORTHBRIDGE Ltd' })]);
  assert.equal(survivors.length, 1);
  assert.equal(duplicates[0].code, 'duplicate_name_company');
  assert.equal(survivors[0].email, 'ava@example.com'); // survivor keeps its own email
});

test('opt-out on any duplicate wins (consent is never inferred)', () => {
  const { survivors } = dedupeRecords([mk(2, { opt_in: 'yes' }), mk(3, { opt_in: 'no' })]);
  assert.equal(survivors[0].opt_in, 'no');
  const r2 = dedupeRecords([mk(2, { opt_in: '' }), mk(3, { opt_in: 'yes' })]);
  assert.equal(r2.survivors[0].opt_in, 'yes');
});

test('triple duplicates chain to the same survivor, via email then via name+company', () => {
  const recs = [mk(2, {}), mk(3, { email: 'other@example.com' }), mk(4, { first_name: 'Someone', last_name: 'Else', email: 'other@example.com' })];
  const { survivors, duplicates } = dedupeRecords(recs);
  assert.equal(survivors.length, 1);
  assert.deepEqual(duplicates.map((d) => d.code), ['duplicate_name_company', 'duplicate_email']);
  assert.ok(duplicates.every((d) => d.duplicateOf === survivors[0].record_id));
});

test('different people at the same company are not duplicates; missing last name skips name+company matching', () => {
  const { survivors } = dedupeRecords([mk(2, {}), mk(3, { first_name: 'Ben', email: 'ben@example.com' }), mk(4, { last_name: '', email: 'ava2@example.com' })]);
  assert.equal(survivors.length, 3);
});

test('empty input', () => {
  assert.deepEqual(dedupeRecords([]), { survivors: [], duplicates: [] });
});
