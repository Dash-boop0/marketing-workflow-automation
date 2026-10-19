// Duplicate detection: first by normalised email, then by first+last name + company key.
// The first occurrence in file order survives; blank fields on the survivor are filled from duplicates;
// consent is conservative (any "no" wins over "yes"/"unknown").

import { nameCompanyKey, deriveFields } from './normalise.js';

export const MERGE_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'company', 'job_title', 'company_size', 'country', 'source', 'created_at', 'notes'];

function isBlank(v) {
  return v === null || v === undefined || v === '' || v === 'Unknown';
}

/** Merge dup into survivor in place. Returns list of filled field names. */
export function mergeInto(survivor, dup, today) {
  const filled = [];
  for (const f of MERGE_FIELDS) {
    if (isBlank(survivor[f]) && !isBlank(dup[f])) {
      survivor[f] = dup[f];
      filled.push(f);
    }
  }
  if (dup.opt_in === 'no' && survivor.opt_in !== 'no') {
    survivor.opt_in = 'no';
    filled.push('opt_in (opt-out wins)');
  } else if (survivor.opt_in === 'unknown' && dup.opt_in === 'yes') {
    survivor.opt_in = 'yes';
    filled.push('opt_in');
  }
  survivor.warnings = [...new Set([...(survivor.warnings || []), ...(dup.warnings || [])])];
  survivor.source_rows = [...survivor.source_rows, ...dup.source_rows];
  deriveFields(survivor, today);
  return filled;
}

/**
 * Deduplicate normalised records (in input order). Returns { survivors, duplicates } where each duplicate is
 * { record, duplicateOf, code: 'duplicate_email'|'duplicate_name_company', filled }.
 */
export function dedupeRecords(records, { today } = {}) {
  const byEmail = new Map();
  const byNameCompany = new Map();
  const survivors = [];
  const duplicates = [];
  const register = (rec, target) => {
    if (rec.email && !byEmail.has(rec.email)) byEmail.set(rec.email, target);
    const nc = nameCompanyKey(rec.first_name, rec.last_name, rec.company);
    if (nc && !byNameCompany.has(nc)) byNameCompany.set(nc, target);
  };
  for (const rec of records) {
    let match = null;
    let code = null;
    if (rec.email && byEmail.has(rec.email)) {
      match = byEmail.get(rec.email);
      code = 'duplicate_email';
    } else {
      const nc = nameCompanyKey(rec.first_name, rec.last_name, rec.company);
      if (nc && byNameCompany.has(nc)) {
        match = byNameCompany.get(nc);
        code = 'duplicate_name_company';
      }
    }
    if (match) {
      const filled = mergeInto(match, rec, today);
      duplicates.push({ record: rec, duplicateOf: match.record_id, survivorRow: match.row, code, filled });
      register(rec, match);
      register(match, match);
    } else {
      survivors.push(rec);
      register(rec, rec);
    }
  }
  return { survivors, duplicates };
}
