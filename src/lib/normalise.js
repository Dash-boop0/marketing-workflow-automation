// Normalisation helpers: trimming, name case, email case, phone digits + country calling codes,
// country aliases -> ISO 3166-1 alpha-2, source-name aliases -> canonical source, opt-in, company size.

import { parseDateInput, daysBetween } from './dates.js';
import { shortId } from './hash.js';

/** Collapse all whitespace (incl. non-breaking spaces, tabs, newlines) to single spaces and trim. */
export function cleanText(value) {
  return String(value ?? '')
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Title-case names typed entirely in lower or upper case; keep deliberate mixed case (e.g. "McKenzie", "van Dijk"). */
export function normaliseName(value) {
  const s = cleanText(value);
  if (!s) return '';
  const hasLower = /\p{Ll}/u.test(s);
  const hasUpper = /\p{Lu}/u.test(s);
  if (hasLower && hasUpper) return s;
  return s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

export function normaliseEmail(value) {
  return cleanText(value).toLowerCase();
}

export const COUNTRIES = {
  US: { name: 'United States', callingCode: '1', aliases: ['us', 'usa', 'united states', 'united states of america', 'america'] },
  CA: { name: 'Canada', callingCode: '1', aliases: ['ca', 'canada'] },
  GB: { name: 'United Kingdom', callingCode: '44', aliases: ['gb', 'uk', 'united kingdom', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland'] },
  IE: { name: 'Ireland', callingCode: '353', aliases: ['ie', 'ireland', 'republic of ireland'] },
  IN: { name: 'India', callingCode: '91', aliases: ['in', 'india', 'bharat'] },
  DE: { name: 'Germany', callingCode: '49', aliases: ['de', 'germany', 'deutschland'] },
  FR: { name: 'France', callingCode: '33', aliases: ['fr', 'france'] },
  NL: { name: 'Netherlands', callingCode: '31', aliases: ['nl', 'netherlands', 'the netherlands', 'holland'] },
  ES: { name: 'Spain', callingCode: '34', aliases: ['es', 'spain', 'espana', 'españa'] },
  IT: { name: 'Italy', callingCode: '39', aliases: ['it', 'italy', 'italia'] },
  SE: { name: 'Sweden', callingCode: '46', aliases: ['se', 'sweden', 'sverige'] },
  AU: { name: 'Australia', callingCode: '61', aliases: ['au', 'australia'] },
  NZ: { name: 'New Zealand', callingCode: '64', aliases: ['nz', 'new zealand'] },
  SG: { name: 'Singapore', callingCode: '65', aliases: ['sg', 'singapore'] },
  AE: { name: 'United Arab Emirates', callingCode: '971', aliases: ['ae', 'uae', 'united arab emirates'] },
  ZA: { name: 'South Africa', callingCode: '27', aliases: ['za', 'south africa'] },
};

const COUNTRY_LOOKUP = (() => {
  const map = new Map();
  for (const [code, c] of Object.entries(COUNTRIES)) for (const a of c.aliases) map.set(a, code);
  return map;
})();

/** Returns the ISO alpha-2 code for a country name/alias, '' for blank, or null when unknown. */
export function normaliseCountry(value) {
  const s = cleanText(value);
  if (!s) return '';
  const key = s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  return COUNTRY_LOOKUP.get(key) ?? null;
}

/**
 * Normalise a phone number to digits with a leading + and country calling code where possible.
 * Returns { phone, status } where status is 'empty' | 'ok' | 'no_country' | 'invalid'.
 */
export function normalisePhone(value, countryCode) {
  const s = cleanText(value);
  if (!s) return { phone: '', status: 'empty' };
  if (/[a-z]/i.test(s)) return { phone: '', status: 'invalid', reason: 'contains letters' };
  let international = s.startsWith('+');
  let digits = s.replace(/\D/g, '');
  if (!international && digits.startsWith('00')) {
    international = true;
    digits = digits.slice(2);
  }
  let status = 'ok';
  if (!international) {
    const cc = countryCode && COUNTRIES[countryCode] ? COUNTRIES[countryCode].callingCode : null;
    if (!cc) {
      status = 'no_country';
    } else if (cc === '1') {
      if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
      digits = '1' + digits;
      international = true;
    } else {
      digits = cc + digits.replace(/^0/, '');
      international = true;
    }
  }
  if (digits.length < 7 || digits.length > 15) return { phone: '', status: 'invalid', reason: `${digits.length} digits (expected 7-15)` };
  return { phone: international ? '+' + digits : digits, status };
}

export const SOURCES = {
  Website: ['website', 'web', 'web form', 'webform', 'website form', 'contact form', 'inbound form', 'site', 'organic'],
  Webinar: ['webinar', 'web seminar', 'online event', 'webinar registration'],
  LinkedIn: ['linkedin', 'linked in', 'li', 'linkedin ads', 'linkedin ad', 'linkedin form', 'linkedin lead gen'],
  Referral: ['referral', 'referred', 'customer referral', 'word of mouth'],
  Event: ['event', 'events', 'trade show', 'tradeshow', 'conference', 'expo', 'meetup'],
  'Paid search': ['paid search', 'ppc', 'google ads', 'sem', 'search ads'],
  'Content download': ['content download', 'ebook', 'e-book', 'whitepaper', 'white paper', 'guide download', 'report download'],
  Partner: ['partner', 'partner referral', 'reseller', 'channel partner'],
};

const SOURCE_LOOKUP = (() => {
  const map = new Map();
  for (const [canonical, aliases] of Object.entries(SOURCES)) {
    map.set(canonical.toLowerCase(), canonical);
    for (const a of aliases) map.set(a, canonical);
  }
  return map;
})();

/** Returns { source, known }. Blank -> 'Unknown' (known), unrecognised -> 'Other' (known=false). */
export function normaliseSource(value) {
  const s = cleanText(value);
  if (!s) return { source: 'Unknown', known: true, blank: true };
  const key = s.toLowerCase().replace(/[_]/g, ' ').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, ' ').trim();
  const hit = SOURCE_LOOKUP.get(key);
  return hit ? { source: hit, known: true } : { source: 'Other', known: false };
}

/** Returns { value: 'yes'|'no'|'unknown', valid } */
export function normaliseOptIn(value) {
  const s = cleanText(value).toLowerCase();
  if (!s) return { value: 'unknown', valid: true, blank: true };
  if (['yes', 'y', 'true', '1', 'opt-in', 'opted in', 'subscribed'].includes(s)) return { value: 'yes', valid: true };
  if (['no', 'n', 'false', '0', 'opt-out', 'opted out', 'unsubscribed'].includes(s)) return { value: 'no', valid: true };
  return { value: 'unknown', valid: false };
}

/** Company size: integer with optional thousands separators, or "N+" (lower bound). Returns { value, valid }. */
export function parseCompanySize(value) {
  const s = cleanText(value).replace(/[,\s_]/g, '');
  if (!s) return { value: null, valid: true, blank: true };
  const m = s.match(/^(\d{1,7})\+?$/);
  if (!m) return { value: null, valid: false };
  return { value: Number(m[1]), valid: true };
}

const LEGAL_SUFFIXES = new Set(['ltd', 'limited', 'inc', 'incorporated', 'llc', 'llp', 'plc', 'gmbh', 'ag', 'bv', 'sa', 'co', 'corp', 'corporation', 'company', 'pvt', 'private', 'pty']);

/** Comparison key for a company: parenthetical text removed (e.g. "(synthetic)"), lower case, & -> and,
 *  punctuation removed, trailing legal suffixes (Ltd, Inc, LLC, GmbH...) dropped. */
export function companyKey(company) {
  const words = cleanText(company)
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

export function nameCompanyKey(first, last, company) {
  const f = cleanText(first).toLowerCase();
  const l = cleanText(last).toLowerCase();
  const c = companyKey(company);
  if (!f || !l || !c) return '';
  return `${f} ${l}|${c}`;
}

/** Deterministic record ID: hash of normalised email, else of name+company. */
export function recordIdFor(rec) {
  if (rec.email) return shortId('L', `email:${rec.email}`);
  return shortId('L', `nc:${nameCompanyKey(rec.first_name, rec.last_name, rec.company) || cleanText(rec.company).toLowerCase()}`);
}

/** Recompute derived fields after normalisation or a dedupe merge. */
export function deriveFields(rec, today) {
  rec.full_name = [rec.first_name, rec.last_name].filter(Boolean).join(' ');
  rec.email_domain = rec.email ? rec.email.split('@')[1] || '' : '';
  rec.has_email = Boolean(rec.email);
  rec.has_phone = Boolean(rec.phone);
  rec.lead_age_days = rec.created_at && today ? daysBetween(rec.created_at, today) : null;
  return rec;
}

/**
 * Build a normalised record from a raw row object. Assumes validation already ran; invalid optional values are cleared.
 * Returns { record, changes } where changes lists human-readable before -> after notes.
 */
export function normaliseRecord(raw, { today, row }) {
  const changes = [];
  const note = (field, before, after) => {
    const b = String(before ?? '');
    const a = String(after ?? '');
    if (b !== a) changes.push(`${field}: "${b}" -> "${a}"`);
  };
  const rec = { row };
  rec.first_name = normaliseName(raw.first_name);
  note('first_name', raw.first_name, rec.first_name);
  rec.last_name = normaliseName(raw.last_name);
  note('last_name', raw.last_name, rec.last_name);
  rec.email = normaliseEmail(raw.email);
  note('email', raw.email, rec.email);
  const cc = normaliseCountry(raw.country);
  rec.country = cc === null ? cleanText(raw.country) : cc;
  note('country', raw.country, rec.country);
  const ph = normalisePhone(raw.phone, cc || '');
  rec.phone = ph.phone;
  note('phone', raw.phone, rec.phone);
  rec.company = cleanText(raw.company);
  note('company', raw.company, rec.company);
  rec.job_title = cleanText(raw.job_title);
  note('job_title', raw.job_title, rec.job_title);
  const size = parseCompanySize(raw.company_size);
  rec.company_size = size.value;
  note('company_size', raw.company_size, rec.company_size ?? '');
  rec.source = normaliseSource(raw.source).source;
  note('source', raw.source, rec.source);
  const d = parseDateInput(raw.created_at);
  rec.created_at = d.ok ? d.iso : '';
  note('created_at', raw.created_at, rec.created_at);
  rec.opt_in = normaliseOptIn(raw.opt_in).value;
  note('opt_in', raw.opt_in, rec.opt_in);
  rec.notes = cleanText(raw.notes);
  deriveFields(rec, today);
  rec.record_id = recordIdFor(rec);
  rec.source_rows = [row];
  return { record: rec, changes };
}
