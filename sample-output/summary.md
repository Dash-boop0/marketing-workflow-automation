# Workflow run summary — R-b84402092617

> Synthetic demo data. Messaging is mocked: messages below were **logged, not sent**.

- Run date: 2026-10-20
- Generated at: 2026-10-20T09:00:00.000Z
- Input: leads.csv (sha256 1c63d9805394da99…)
- Rules: version 1.0 (sha256 55df701cbb7e394d…), skip weekends: true

## Pipeline

| Step | Count | Share of rows read |
|---|---:|---:|
| Rows read | 61 | 100.0% |
| Rejected at validation | 7 | 11.5% |
| Accepted with warnings | 12 | 19.7% |
| Duplicates merged | 7 | 11.5% |
| Unique clean leads | 47 | 77.0% |
| Tasks created this run | 47 | — |
| Tasks that already existed | 0 | — |
| Mock messages (not sent) | 40 | — |
| Messages skipped | 7 | — |

## Leads by category

| Category | Leads |
|---|---:|
| Warm inbound | 12 |
| Event follow-up | 7 |
| Referral / partner | 7 |
| Enterprise decision maker | 6 |
| General nurture | 6 |
| Mid-market prospect | 6 |
| Low fit | 3 |

## Leads by priority

| Priority | Leads |
|---|---:|
| medium | 25 |
| high | 13 |
| low | 9 |

## Tasks by due date

| Due date | Tasks |
|---|---:|
| 2026-10-21 | 13 |
| 2026-10-23 | 25 |
| 2026-10-29 | 9 |

## Rejections and duplicates by code

| Code | Rows |
|---|---:|
| duplicate_email | 5 |
| invalid_email | 3 |
| duplicate_name_company | 2 |
| malformed_row | 1 |
| missing_company | 1 |
| missing_contact | 1 |
| missing_name | 1 |

## Warnings by code

| Code | Warnings |
|---|---:|
| invalid_date | 2 |
| unknown_source | 2 |
| future_date | 1 |
| invalid_company_size | 1 |
| invalid_opt_in | 1 |
| invalid_phone | 1 |
| missing_email | 1 |
| phone_without_country | 1 |
| role_email | 1 |
| short_row | 1 |
| unknown_country | 1 |

## Output files

- `leads.csv`: 47 row(s)
- `rejected.csv`: 14 row(s)
- `tasks.csv`: 47 row(s)
- `mock-outbox.csv`: 40 row(s)

Codes are defined in docs/VALIDATION.md. Re-running with the same input, rules and run date produces identical files (see docs/IDEMPOTENCY.md).
