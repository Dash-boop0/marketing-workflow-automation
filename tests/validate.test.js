import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEmail, validateRow, mapHeader, VALIDATION_RULES, canonicalHeader } from '../src/lib/validate.js';

const base = {
  first_name: 'Ava', last_name: 'Patel', email: 'ava@example.com', phone: '', company: 'Northbridge (synthetic)',
  job_title: 'VP', company_size: '100', country: 'US', source: 'Website', created_at: '2026-10-01', opt_in: 'yes', notes: '',
};
const codes = (r) => ({ errors: r.errors.map((e) => e.code), warnings: r.warnings.map((w) => w.code) });
const run = (patch, ctx = {}) => codes(validateRow({ ...base, ...patch }, { today: '2026-10-20', ...ctx }));

test('email syntax: valid examples', () => {
  for (const e of ['a@example.com', 'first.last@example.org', 'a+tag@sub.example.net', "o'brien@example.com", 'A@EXAMPLE.COM']) {
    assert.equal(checkEmail(e).ok, true, e);
  }
});

test('email syntax: invalid examples with reasons', () => {
  const cases = {
    'ethan.brooks@example': /no dot/,
    'zara@@example.com': /more than one @/,
    'noatsign.example.com': /missing @/,
    'olivia hart@example.com': /space/,
    '.lead@example.com': /dots/,
    'a..b@example.com': /dots/,
    'a@-example.com': /invalid domain/,
    'a@example.c0m': /top-level/,
    '@example.com': /nothing before/,
  };
  for (const [e, re] of Object.entries(cases)) {
    const r = checkEmail(e);
    assert.equal(r.ok, false, e);
    assert.match(r.reason, re, e);
  }
  assert.equal(checkEmail('a'.repeat(65) + '@example.com').ok, false);
});

test('clean row passes with no errors or warnings', () => {
  assert.deepEqual(run({}), { errors: [], warnings: [] });
});

test('reject rules', () => {
  assert.deepEqual(run({ first_name: '', last_name: '' }).errors, ['missing_name']);
  assert.deepEqual(run({ company: '  ' }).errors, ['missing_company']);
  assert.deepEqual(run({ email: '', phone: '' }).errors, ['missing_contact']);
  assert.deepEqual(run({ email: '', phone: '12', country: 'US' }).errors, ['missing_contact']); // invalid phone is not usable
  assert.deepEqual(run({ email: 'bad@' }).errors, ['invalid_email']);
  assert.deepEqual(run({}, { extraFields: 1 }).errors, ['malformed_row']);
});

test('warning rules', () => {
  assert.deepEqual(run({ first_name: '' }).warnings, ['missing_first_name']);
  assert.deepEqual(run({ last_name: '' }).warnings, ['missing_last_name']);
  assert.deepEqual(run({ email: '', phone: '202-555-0101' }).warnings, ['missing_email']);
  assert.deepEqual(run({ email: 'info@example.com' }).warnings, ['role_email']);
  assert.deepEqual(run({ phone: '555-01' }).warnings, ['invalid_phone']);
  assert.deepEqual(run({ phone: '2025550112', country: '' }).warnings, ['phone_without_country']);
  assert.deepEqual(run({ created_at: '2026-13-05' }).warnings, ['invalid_date']);
  assert.deepEqual(run({ created_at: '2026-11-15' }).warnings, ['future_date']);
  assert.deepEqual(run({ company_size: 'about 200' }).warnings, ['invalid_company_size']);
  assert.deepEqual(run({ country: 'Atlantis' }).warnings, ['unknown_country']);
  assert.deepEqual(run({ source: 'Podcast' }).warnings, ['unknown_source']);
  assert.deepEqual(run({ opt_in: 'maybe' }).warnings, ['invalid_opt_in']);
  assert.deepEqual(run({}, { shortRow: 2 }).warnings, ['short_row']);
});

test('every documented rule code has a severity of reject or warn', () => {
  for (const [code, r] of Object.entries(VALIDATION_RULES)) assert.ok(['reject', 'warn'].includes(r.severity), code);
});

test('header mapping accepts aliases and reports missing required columns', () => {
  assert.equal(canonicalHeader('E-mail Address'), 'email');
  assert.equal(canonicalHeader('Company Name'), 'company');
  assert.equal(canonicalHeader('Lead Source'), 'source');
  const ok = mapHeader(['First Name', 'Surname', 'Email', 'Organisation', 'Favourite colour']);
  assert.equal(ok.fatal, null);
  assert.deepEqual(ok.ignored, ['Favourite colour']);
  assert.match(mapHeader(['first_name', 'email']).fatal, /company/);
  assert.match(mapHeader(['first_name', 'company']).fatal, /email.*phone/);
  assert.match(mapHeader(['email', 'company']).fatal, /first_name/);
});
