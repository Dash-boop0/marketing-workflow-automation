import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText, normaliseName, normaliseEmail, normaliseCountry, normalisePhone, normaliseSource,
  normaliseOptIn, parseCompanySize, companyKey, nameCompanyKey, normaliseRecord, recordIdFor,
} from '../src/lib/normalise.js';

test('cleanText trims and collapses whitespace including NBSP and newlines', () => {
  assert.equal(cleanText('  a   b\n c  '), 'a b c');
  assert.equal(cleanText(null), '');
});

test('names: title-case all-lower/all-upper, keep deliberate mixed case', () => {
  assert.equal(normaliseName('liam'), 'Liam');
  assert.equal(normaliseName("o'connor"), "O'Connor");
  assert.equal(normaliseName('NOAH'), 'Noah');
  assert.equal(normaliseName('mary-jane'), 'Mary-Jane');
  assert.equal(normaliseName('McKenzie'), 'McKenzie');
  assert.equal(normaliseName('van Dijk'), 'van Dijk');
});

test('email is trimmed and lower-cased', () => {
  assert.equal(normaliseEmail(' AVA.PATEL@EXAMPLE.COM '), 'ava.patel@example.com');
});

test('country aliases map to ISO codes; unknown -> null; blank -> ""', () => {
  assert.equal(normaliseCountry('USA'), 'US');
  assert.equal(normaliseCountry('U.S.'), 'US');
  assert.equal(normaliseCountry('United Kingdom'), 'GB');
  assert.equal(normaliseCountry('scotland'), 'GB');
  assert.equal(normaliseCountry('Deutschland'), 'DE');
  assert.equal(normaliseCountry('in'), 'IN');
  assert.equal(normaliseCountry('Atlantis'), null);
  assert.equal(normaliseCountry(''), '');
});

test('phones: digits only with calling code', () => {
  assert.deepEqual(normalisePhone('01632 960011', 'GB'), { phone: '+441632960011', status: 'ok' });
  assert.deepEqual(normalisePhone('202-555-0101', 'US'), { phone: '+12025550101', status: 'ok' });
  assert.deepEqual(normalisePhone('1 (202) 555-0101', 'CA'), { phone: '+12025550101', status: 'ok' });
  assert.deepEqual(normalisePhone('+1 202 555 0102', ''), { phone: '+12025550102', status: 'ok' });
  assert.deepEqual(normalisePhone('0044 1632 960055', 'GB'), { phone: '+441632960055', status: 'ok' });
  assert.deepEqual(normalisePhone('2025550112', ''), { phone: '2025550112', status: 'no_country' });
  assert.equal(normalisePhone('555-01', 'US').status, 'invalid');
  assert.equal(normalisePhone('call me', 'US').status, 'invalid');
  assert.equal(normalisePhone('+1234567890123456', '').status, 'invalid'); // 16 digits > E.164 max
  assert.equal(normalisePhone('', 'US').status, 'empty');
});

test('source aliases map to canonical names', () => {
  assert.equal(normaliseSource('web form').source, 'Website');
  assert.equal(normaliseSource('LinkedIn Ads').source, 'LinkedIn');
  assert.equal(normaliseSource('Trade Show').source, 'Event');
  assert.equal(normaliseSource('whitepaper').source, 'Content download');
  assert.equal(normaliseSource('Webinar ').source, 'Webinar');
  assert.deepEqual(normaliseSource('Podcast'), { source: 'Other', known: false });
  assert.equal(normaliseSource('').source, 'Unknown');
});

test('opt-in values', () => {
  assert.equal(normaliseOptIn('Y').value, 'yes');
  assert.equal(normaliseOptIn('true').value, 'yes');
  assert.equal(normaliseOptIn('No').value, 'no');
  assert.equal(normaliseOptIn('0').value, 'no');
  assert.deepEqual(normaliseOptIn('maybe'), { value: 'unknown', valid: false });
  assert.equal(normaliseOptIn('').value, 'unknown');
});

test('company size parsing', () => {
  assert.equal(parseCompanySize('1,200').value, 1200);
  assert.equal(parseCompanySize('500+').value, 500);
  assert.equal(parseCompanySize('about 200').valid, false);
  assert.equal(parseCompanySize('-5').valid, false);
  assert.equal(parseCompanySize('').value, null);
});

test('company key ignores case, punctuation, parentheses, & vs and, and legal suffixes', () => {
  assert.equal(companyKey('Harbor & Finch Ltd (synthetic)'), 'harbor and finch');
  assert.equal(companyKey('Harbor and Finch (synthetic)'), 'harbor and finch');
  assert.equal(companyKey('Oakhurst Consulting, LLC (synthetic)'), 'oakhurst consulting');
  assert.equal(companyKey('Ashcombe Manufacturing GmbH'), 'ashcombe manufacturing');
  assert.equal(nameCompanyKey('Liam', "O'Connor", 'X Ltd'), "liam o'connor|x");
  assert.equal(nameCompanyKey('Liam', '', 'X'), '');
});

test('record ID uses email when present, otherwise name+company, and is stable', () => {
  const a = recordIdFor({ email: 'a@example.com' });
  assert.equal(a, recordIdFor({ email: 'a@example.com', first_name: 'Other' }));
  const b = recordIdFor({ email: '', first_name: 'Jack', last_name: 'Turner', company: 'Copperleaf Retail (synthetic)' });
  assert.equal(b, recordIdFor({ email: '', first_name: 'JACK', last_name: 'turner', company: 'Copperleaf Retail' }));
  assert.notEqual(a, b);
});

test('normaliseRecord builds derived fields and lists changes', () => {
  const { record, changes } = normaliseRecord({
    first_name: ' liam ', last_name: "o'connor", email: ' Liam@Example.org ', phone: '01632 960011', company: 'Harbor  & Finch',
    job_title: 'Manager', company_size: '1,200', country: 'uk', source: 'web form', created_at: '05/10/2026', opt_in: 'Y', notes: '',
  }, { today: '2026-10-20', row: 3 });
  assert.equal(record.full_name, "Liam O'Connor");
  assert.equal(record.email, 'liam@example.org');
  assert.equal(record.email_domain, 'example.org');
  assert.equal(record.phone, '+441632960011');
  assert.equal(record.company, 'Harbor & Finch');
  assert.equal(record.company_size, 1200);
  assert.equal(record.country, 'GB');
  assert.equal(record.source, 'Website');
  assert.equal(record.created_at, '2026-10-05');
  assert.equal(record.lead_age_days, 15);
  assert.equal(record.opt_in, 'yes');
  assert.equal(record.has_phone, true);
  assert.deepEqual(record.source_rows, [3]);
  assert.ok(changes.some((c) => c.startsWith('phone:')));
});
