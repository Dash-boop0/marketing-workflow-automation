# Sample data (synthetic)

**Everything in this folder is synthetic.** The people, companies and contact details are invented for demonstration.

- Emails use only the reserved domains `example.com`, `example.org` and `example.net` (RFC 2606).
- Phone numbers use ranges reserved for fiction: US/Canada `555-01xx`, UK `01632 960xxx` and `07700 900xxx`,
  Australia `0491 570 156`. Leads in other countries have no phone number.
- Every company name ends in `(synthetic)` (a few duplicate rows omit it on purpose to test company matching).

## Files

| File | Purpose |
|---|---|
| `leads.csv` | 62 data records (61 leads + 1 blank row) with deliberate problems, used by the demo, CLI and tests |
| `leads-template.csv` | Header-only template with the expected columns |

## Columns

`first_name, last_name, email, phone, company, job_title, company_size, country, source, created_at, opt_in, notes`

Header aliases are accepted (e.g. `E-mail Address`, `Company Name`, `Lead Source`, `Surname`); see
[docs/VALIDATION.md](../docs/VALIDATION.md#header-mapping).

## Deliberate edge cases in `leads.csv`

Row numbers count the header as row 1 (as in a spreadsheet). Run date used throughout: **2026-10-20**.

| Row(s) | Case | Expected result |
|---|---|---|
| 3 | lower-case name `liam o'connor`, UK local phone, `web form`, `05/10/2026`, `Y` | normalised to `Liam O'Connor`, `+441632960011`, `Website`, `2026-10-05`, `yes` |
| 5 | `NOAH KIM`, `CTO`, Referral | `Noah Kim`, Referral / partner (high) |
| 7 | `ethan.brooks@example` | rejected `invalid_email` (no dot in domain) |
| 10 | opt_in `maybe` | warning `invalid_opt_in`, no mock email |
| 11 | no email and no phone | rejected `missing_contact` |
| 13 | ` AVA.PATEL@EXAMPLE.COM ` with spaces | duplicate of row 2 by email |
| 15 | country `Nigeria` (not in the lookup list) | warning `unknown_country` |
| 18 | completely blank row | skipped (counted as blank) |
| 19 | same person as row 3, different email, `Harbor and Finch` vs `Harbor & Finch Ltd` | duplicate by name + company |
| 20 | `zara@@example.com` | rejected `invalid_email` |
| 21 | no first or last name | rejected `missing_name` |
| 22 | empty company | rejected `missing_company` |
| 23, 24 | `2026-13-05`, `31/02/2026` | warning `invalid_date`, date cleared |
| 25 | `info@example.com` | warning `role_email` |
| 26 | phone only | warning `missing_email`; task created, no mock email |
| 28 | phone `555-01`, source `Podcast` | warnings `invalid_phone`, `unknown_source` |
| 30 | ISO date-time `2026-10-07T14:30:00Z` | date `2026-10-07` |
| 31 | same name + company as row 2, opt_in `no` | duplicate; merged record becomes opt-out (any "no" wins) |
| 37 | company with a comma (quoted) and `2026/10/04` | parsed correctly |
| 42 | created `2026-11-15` | warning `future_date` |
| 46 | company size `about 200` | warning `invalid_company_size` |
| 48 | notes start with `=HYPERLINK(...)` | kept, but neutralised with a leading `'` in CSV exports |
| 49 | `15.09.2026` | date `2026-09-15` |
| 51 | phone `0044 1632 960055` | `+441632960055` |
| 53 | opt_in blank | `unknown`, no mock email |
| 55 | note with a line break inside quotes | parsed as one field (whitespace collapsed in output) |
| 56 | upper-case duplicate of row 4's email | duplicate; fills row 4's empty `created_at` |
| 58 | upper-case duplicate of row 27's email | duplicate |
| 59 | one extra non-empty field | rejected `malformed_row` |
| 60 | phone `2025550112` and no country | warning `phone_without_country`, stored as digits |
| 61 | only 6 of 12 fields | warning `short_row`, missing fields treated as empty |
| 62 | `olivia hart@example.com` | rejected `invalid_email` (space) |
| 63 | duplicate of row 32 by email, with a phone | duplicate; fills row 32's empty phone |

Expected totals (verified in `tests/pipeline.test.js`): 61 rows read, 7 rejected, 7 duplicates merged,
47 clean leads, 47 tasks, 40 mock messages (not sent), 7 messages skipped.
