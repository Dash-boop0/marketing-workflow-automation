// Row- and file-level validation. Every rule has a stable code documented in docs/VALIDATION.md.
// Severity "reject" removes the row from the clean output (it goes to rejected.csv with reasons);
// severity "warn" keeps the row and records the warning against the lead.

import { cleanText, normaliseCountry, normalisePhone, normaliseSource, normaliseOptIn, parseCompanySize } from './normalise.js';
import { parseDateInput } from './dates.js';

export const LEAD_COLUMNS = [
  'first_name', 'last_name', 'email', 'phone', 'company', 'job_title',
  'company_size', 'country', 'source', 'created_at', 'opt_in', 'notes',
];

const HEADER_ALIASES = {
  first_name: ['first_name', 'firstname', 'first', 'given_name', 'forename'],
  last_name: ['last_name', 'lastname', 'last', 'surname', 'family_name'],
  email: ['email', 'e_mail', 'email_address', 'e_mail_address', 'work_email', 'mail'],
  phone: ['phone', 'phone_number', 'telephone', 'tel', 'mobile', 'work_phone'],
  company: ['company', 'company_name', 'organisation', 'organization', 'org', 'account', 'account_name'],
  job_title: ['job_title', 'title', 'jobtitle', 'role', 'position'],
  company_size: ['company_size', 'employees', 'employee_count', 'headcount', 'size'],
  country: ['country', 'country_name', 'country_code'],
  source: ['source', 'lead_source', 'channel', 'utm_source'],
  created_at: ['created_at', 'created', 'created_date', 'date', 'date_created', 'signup_date'],
  opt_in: ['opt_in', 'optin', 'consent', 'marketing_opt_in', 'marketing_consent', 'email_opt_in'],
  notes: ['notes', 'note', 'comments', 'comment'],
};

const ALIAS_LOOKUP = (() => {
  const m = new Map();
  for (const [col, aliases] of Object.entries(HEADER_ALIASES)) for (const a of aliases) m.set(a, col);
  return m;
})();

export function canonicalHeader(h) {
  const key = cleanText(h).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return ALIAS_LOOKUP.get(key) ?? null;
}

/**
 * Map a header row to canonical columns. Returns { mapping: [colOrNull...], missing: [...], ignored: [...], fatal }.
 * Fatal when: no company column, neither email nor phone column, or neither first_name nor last_name column.
 */
export function mapHeader(headerRow) {
  const mapping = [];
  const seen = new Set();
  const ignored = [];
  headerRow.forEach((h) => {
    const col = canonicalHeader(h);
    if (col && !seen.has(col)) {
      mapping.push(col);
      seen.add(col);
    } else {
      mapping.push(null);
      if (cleanText(h)) ignored.push(cleanText(h));
    }
  });
  const problems = [];
  if (!seen.has('company')) problems.push('a "company" column');
  if (!seen.has('email') && !seen.has('phone')) problems.push('an "email" or "phone" column');
  if (!seen.has('first_name') && !seen.has('last_name')) problems.push('a "first_name" or "last_name" column');
  return { mapping, ignored, columns: [...seen], fatal: problems.length ? `Header is missing ${problems.join(', ')}.` : null };
}

// Pragmatic email syntax check (not full RFC 5322): one @, local part of allowed characters without leading,
// trailing or consecutive dots, domain of dot-separated labels (letters, digits, hyphens; no leading/trailing
// hyphen) ending in an alphabetic TLD of 2+ letters. Max 64 chars local part, 254 total.
const EMAIL_LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const EMAIL_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function checkEmail(value) {
  const s = cleanText(value);
  if (!s) return { ok: false, reason: 'empty' };
  if (s.length > 254) return { ok: false, reason: 'longer than 254 characters' };
  if (/\s/.test(s)) return { ok: false, reason: 'contains a space' };
  const parts = s.split('@');
  if (parts.length !== 2) return { ok: false, reason: parts.length < 2 ? 'missing @' : 'more than one @' };
  const [local, domain] = parts;
  if (!local) return { ok: false, reason: 'nothing before @' };
  if (local.length > 64) return { ok: false, reason: 'part before @ is longer than 64 characters' };
  if (!EMAIL_LOCAL.test(local)) return { ok: false, reason: 'invalid characters or dots before @' };
  const labels = domain.split('.');
  if (labels.length < 2) return { ok: false, reason: 'domain has no dot (e.g. example.com)' };
  if (!labels.every((l) => EMAIL_LABEL.test(l))) return { ok: false, reason: 'invalid domain' };
  if (!/^[A-Za-z]{2,}$/.test(labels[labels.length - 1])) return { ok: false, reason: 'invalid top-level domain' };
  return { ok: true };
}

export const ROLE_MAILBOXES = ['info', 'sales', 'admin', 'support', 'contact', 'hello', 'marketing', 'office', 'team', 'noreply', 'no-reply', 'enquiries', 'inquiries'];

/** Codes, severities and human messages. Kept in one table so docs and UI stay in sync. */
export const VALIDATION_RULES = {
  malformed_row: { severity: 'reject', label: 'Row has more non-empty fields than the header' },
  missing_name: { severity: 'reject', label: 'Both first_name and last_name are empty' },
  missing_company: { severity: 'reject', label: 'company is empty' },
  missing_contact: { severity: 'reject', label: 'No usable email or phone' },
  invalid_email: { severity: 'reject', label: 'Email syntax is invalid' },
  short_row: { severity: 'warn', label: 'Row has fewer fields than the header (missing trailing fields treated as empty)' },
  missing_first_name: { severity: 'warn', label: 'first_name is empty' },
  missing_last_name: { severity: 'warn', label: 'last_name is empty (name+company duplicate check not possible)' },
  missing_email: { severity: 'warn', label: 'No email; phone-only lead (no mock email will be generated)' },
  role_email: { severity: 'warn', label: 'Role-based mailbox (e.g. info@, sales@)' },
  invalid_phone: { severity: 'warn', label: 'Phone is not a valid number (cleared)' },
  phone_without_country: { severity: 'warn', label: 'Phone has no + prefix and country is unknown; stored as digits only' },
  invalid_date: { severity: 'warn', label: 'created_at is not a valid date in an accepted format (cleared)' },
  future_date: { severity: 'warn', label: 'created_at is after the run date' },
  invalid_company_size: { severity: 'warn', label: 'company_size is not a whole number (cleared)' },
  unknown_country: { severity: 'warn', label: 'Country not recognised (kept as written, no calling code applied)' },
  unknown_source: { severity: 'warn', label: 'Source not recognised (mapped to "Other")' },
  invalid_opt_in: { severity: 'warn', label: 'opt_in value not recognised (treated as "unknown"; no mock email)' },
};

/**
 * Validate one raw row object (keys = canonical columns). ctx: { today, shortRow, extraFields }.
 * Returns { errors: [{code, field, message}], warnings: [...] }.
 */
export function validateRow(raw, ctx = {}) {
  const errors = [];
  const warnings = [];
  const add = (code, field, detail) => {
    const rule = VALIDATION_RULES[code];
    const item = { code, field, message: detail ? `${rule.label}: ${detail}` : rule.label };
    (rule.severity === 'reject' ? errors : warnings).push(item);
  };
  if (ctx.extraFields) add('malformed_row', '', `${ctx.extraFields} extra non-empty field(s)`);
  if (ctx.shortRow) add('short_row', '', `${ctx.shortRow} field(s) missing`);

  const first = cleanText(raw.first_name);
  const last = cleanText(raw.last_name);
  if (!first && !last) add('missing_name', 'first_name');
  else if (!first) add('missing_first_name', 'first_name');
  else if (!last) add('missing_last_name', 'last_name');

  if (!cleanText(raw.company)) add('missing_company', 'company');

  const email = cleanText(raw.email);
  let emailOk = false;
  if (email) {
    const r = checkEmail(email);
    if (!r.ok) add('invalid_email', 'email', `"${email}" (${r.reason})`);
    else {
      emailOk = true;
      const local = email.split('@')[0].toLowerCase();
      if (ROLE_MAILBOXES.includes(local)) add('role_email', 'email', email);
    }
  }

  const countryCode = normaliseCountry(raw.country);
  if (countryCode === null) add('unknown_country', 'country', `"${cleanText(raw.country)}"`);

  const phone = normalisePhone(raw.phone, countryCode || '');
  const phoneOk = phone.status === 'ok' || phone.status === 'no_country';
  if (phone.status === 'invalid') add('invalid_phone', 'phone', `"${cleanText(raw.phone)}" (${phone.reason})`);
  if (phone.status === 'no_country') add('phone_without_country', 'phone', `"${cleanText(raw.phone)}"`);

  if (!email && !phoneOk) add('missing_contact', 'email');
  else if (!email && phoneOk) add('missing_email', 'email');

  const d = parseDateInput(raw.created_at);
  if (!d.ok && !d.empty) add('invalid_date', 'created_at', d.error);
  if (d.ok && ctx.today && d.iso > ctx.today) add('future_date', 'created_at', `${d.iso} is after ${ctx.today}`);

  const size = parseCompanySize(raw.company_size);
  if (!size.valid) add('invalid_company_size', 'company_size', `"${cleanText(raw.company_size)}"`);

  const src = normaliseSource(raw.source);
  if (!src.known) add('unknown_source', 'source', `"${cleanText(raw.source)}"`);

  const opt = normaliseOptIn(raw.opt_in);
  if (!opt.valid) add('invalid_opt_in', 'opt_in', `"${cleanText(raw.opt_in)}"`);

  return { errors, warnings, emailOk };
}
