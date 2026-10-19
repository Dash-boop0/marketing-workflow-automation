# Validation and normalisation rules

Every rule below is implemented in `src/lib/validate.js`, `src/lib/normalise.js`, `src/lib/dedupe.js` or
`src/lib/rules.js` and covered by tests in `tests/`. The codes appear in `rejected.csv` (`_codes`), in the
`warnings` column of `leads.csv`, in the run log and in the app's **How it works** tab.

Severity:

- **fatal** – the whole run stops before processing; only `run-log.json` and `summary.md` are written.
- **reject** – the row is removed from the clean output and written to `rejected.csv` with the reason.
- **warn** – the row is kept; the problem is recorded and the bad value is cleared or mapped as described.
- **merged** – the row is a duplicate; it is merged into an earlier row and listed in `rejected.csv` (stage `dedupe`).

Row numbers count the header as row 1, like a spreadsheet.

## 1. File-level (fatal)

| Code | Rule |
|---|---|
| `invalid_run_date` | The run date (`--today` / UI date) must be a real date in `YYYY-MM-DD` format. |
| `invalid_rules` | The rules file must pass the checks in section 6. (The CLI reports these before reading the CSV and exits 1.) |
| `csv_parse_error` | A quoted field is never closed (e.g. `"Acme, Inc` with no closing quote). |
| `empty_input` | The file is empty, or has a header but no non-blank data rows. |
| `missing_columns` | The header must contain `company`, at least one of `email`/`phone`, and at least one of `first_name`/`last_name` (after alias mapping). |

### Header mapping

Headers are trimmed, lower-cased and non-alphanumerics become `_`, then matched against aliases:

| Column | Accepted header names |
|---|---|
| `first_name` | first_name, firstname, first, given_name, forename |
| `last_name` | last_name, lastname, last, surname, family_name |
| `email` | email, e_mail, email_address, e_mail_address, work_email, mail |
| `phone` | phone, phone_number, telephone, tel, mobile, work_phone |
| `company` | company, company_name, organisation, organization, org, account, account_name |
| `job_title` | job_title, title, jobtitle, role, position |
| `company_size` | company_size, employees, employee_count, headcount, size |
| `country` | country, country_name, country_code |
| `source` | source, lead_source, channel, utm_source |
| `created_at` | created_at, created, created_date, date, date_created, signup_date |
| `opt_in` | opt_in, optin, consent, marketing_opt_in, marketing_consent, email_opt_in |
| `notes` | notes, note, comments, comment |

Unrecognised columns are ignored and listed in the ingest log entry. If two headers map to the same column, the
first wins. Blank rows (every field empty) are skipped and counted.

## 2. Row-level: reject

| Code | Rule |
|---|---|
| `malformed_row` | The row has more fields than the header **and** at least one extra field is non-empty. |
| `missing_name` | `first_name` and `last_name` are both empty. |
| `missing_company` | `company` is empty. |
| `missing_contact` | No email, and the phone is empty or invalid (so there is no usable contact). |
| `invalid_email` | An email is present but fails the syntax check below. |

### Email syntax check

A pragmatic check, not full RFC 5322:

- exactly one `@`, no spaces, at most 254 characters, local part at most 64 characters;
- local part: letters, digits and ``! # $ % & ' * + / = ? ^ _ ` { | } ~ -``, with dots only between characters
  (no leading, trailing or double dots);
- domain: at least two dot-separated labels of letters, digits and hyphens (no leading/trailing hyphen,
  max 63 characters each); the last label is alphabetic and at least 2 letters.

It does **not** check that the domain or mailbox exists (no network calls).

## 3. Row-level: warn (row kept)

| Code | Rule | What happens to the value |
|---|---|---|
| `short_row` | Fewer fields than the header. | Missing trailing fields are treated as empty. |
| `missing_first_name` | `first_name` empty (last name present). | Kept empty; templates use the fallback (e.g. "there"). |
| `missing_last_name` | `last_name` empty (first name present). | Kept empty; name+company duplicate check is not possible for this row. |
| `missing_email` | No email but a valid phone. | Task is created; no mock email. |
| `role_email` | Local part is a role mailbox: info, sales, admin, support, contact, hello, marketing, office, team, noreply, no-reply, enquiries, inquiries. | Kept. |
| `invalid_phone` | Phone contains letters, or has fewer than 7 or more than 15 digits after cleaning (E.164 maximum is 15). | Cleared. |
| `phone_without_country` | Phone has no `+`/`00` prefix and the country is blank or unknown. | Stored as digits only. |
| `invalid_date` | `created_at` is not in an accepted format or is not a real calendar date. | Cleared. |
| `future_date` | `created_at` is after the run date. | Kept (lead age becomes negative). |
| `invalid_company_size` | Not a whole number (thousands separators and a trailing `+` are allowed). | Cleared. |
| `unknown_country` | Country not in the lookup list (section 4). | Kept as written; no calling code applied to the phone. |
| `unknown_source` | Source not in the alias list (section 4). | Mapped to `Other`. |
| `invalid_opt_in` | opt_in not one of the accepted values. | Treated as `unknown` (no mock email when opt-in is required). |

### Accepted date formats

| Format | Example | Note |
|---|---|---|
| `YYYY-MM-DD` | 2026-10-05 | single-digit month/day accepted |
| `YYYY/MM/DD` | 2026/10/04 | |
| ISO 8601 date-time | 2026-10-07T14:30:00Z | date part kept **as written**; no timezone conversion |
| `DD/MM/YYYY`, `DD.MM.YYYY`, `DD-MM-YYYY` | 05/10/2026 → 2026-10-05 | **day first**; US month-first dates are not accepted |

Years must be 1900–2100. Invalid calendar dates (e.g. 31/02, 2025-02-29) are rejected; leap years are handled.

## 4. Normalisation

| Field | Rule |
|---|---|
| all text | Trim; collapse runs of whitespace, tabs, line breaks and non-breaking spaces to a single space. |
| `first_name`, `last_name` | If typed all lower-case or all upper-case, title-case (also after `-` and `'`: `o'connor` → `O'Connor`). Mixed case is kept (`McKenzie`, `van Dijk`). |
| `email` | Lower-case. |
| `country` | Alias → ISO 3166-1 alpha-2 (dots ignored): US, CA, GB (incl. UK, England, Scotland, Wales, Northern Ireland), IE, IN, DE (Deutschland), FR, NL (Holland), ES, IT, SE, AU, NZ, SG, AE (UAE), ZA. |
| `phone` | Digits only. `+` kept; leading `00` → `+`. Otherwise the country's calling code is added (one leading trunk `0` removed; for US/CA a leading `1` is not duplicated). |
| `source` | Website (web form, contact form, organic…), Webinar, LinkedIn (LinkedIn Ads, li…), Referral, Event (trade show, conference, expo…), Paid search (PPC, Google Ads), Content download (whitepaper, ebook…), Partner (reseller). Blank → `Unknown`; anything else → `Other` (with warning). |
| `opt_in` | yes / y / true / 1 / opt-in / opted in / subscribed → `yes`; no / n / false / 0 / opt-out / opted out / unsubscribed → `no`; blank → `unknown`. |
| `company_size` | Integer; `1,200` → 1200; `500+` → 500. |
| `created_at` | → `YYYY-MM-DD`. |
| derived | `full_name`, `email_domain`, `has_email`, `has_phone`, `lead_age_days` (run date − created_at). |

## 5. Duplicates (merged)

Checked in file order, after normalisation:

1. `duplicate_email` – same normalised email as an earlier record.
2. `duplicate_name_company` – same first name + last name (case-insensitive) and same **company key**.
   Company key: parenthetical text removed (e.g. "(synthetic)"), lower-case, `&` → `and`, punctuation removed,
   trailing legal suffixes removed (Ltd, Limited, Inc, LLC, LLP, PLC, GmbH, AG, BV, SA, Co, Corp, Corporation,
   Company, Pvt, Private, Pty). Requires both names and a company.

The **first** record survives. Its empty fields (and a source of `Unknown`) are filled from later duplicates. Consent is conservative: if any
duplicate says `no`, the merged record is `no`; `unknown` + `yes` becomes `yes`. Duplicates found via a
duplicate's email or name chain to the same survivor.

## 6. Rules file checks (`config/rules.json`)

`validateRules()` returns every problem with a JSON path, e.g. `$.categorisation.rules[2].then.priority`.

- `version`: non-empty string.
- `tasks.skipWeekends`: boolean. `tasks.priorities`: at least one entry; each has `dueInDays` (integer 0–365),
  `taskType` and `owner` (non-empty strings). Key order defines priority rank (first = highest).
- `categorisation.defaultCategory`: non-empty; `defaultPriority`: one of the priorities.
- each rule: unique lowercase `id` (letters, digits, hyphens; `default` is reserved), optional boolean `enabled`,
  `when` (condition tree), `then.category` (non-empty) and `then.priority` (one of the priorities).
- condition tree: `{ "all": [...] }`, `{ "any": [...] }` (non-empty), `{ "not": {...} }` or a condition
  `{ "field", "op", "value" }`, nested at most 6 levels.
- `field` must be one of: first_name, last_name, full_name, email, email_domain, phone, company, job_title,
  company_size, country, source, created_at, opt_in, notes, has_email, has_phone, lead_age_days.
- `op` and value types: `equals`/`not_equals` (string, number or boolean); `in`/`not_in`/`contains_any`/`has_any_word`
  (non-empty array); `contains`/`starts_with`/`ends_with` (non-empty string); `gt`/`gte`/`lt`/`lte` (number);
  `exists`/`not_exists` (no value).
- `messaging.mode` must be `"mock"` – any other value is refused; `requireOptIn` boolean; `from` must be an
  `example.com/.org/.net` address; `templates.default` is required; every template needs `subject` and `body`;
  placeholders `{{field}}` or `{{field|fallback}}` must use a rule field or category, priority, owner, task_type, due_date.

### Operator semantics

String comparisons are case-insensitive and trimmed. `contains_any` matches substrings (`cto` matches "dire**cto**r");
`has_any_word` matches whole words or phrases (`head` matches "Head of Brand" but not "Headteacher"). Numeric
operators are never true for a missing value. Categorisation is **first match wins** in file order; disabled rules
are skipped; if nothing matches, the default category and priority apply.
