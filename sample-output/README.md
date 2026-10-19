# Sample output (synthetic, from a real run)

These files were produced by the CLI from `sample-data/leads.csv` (synthetic data):

```bash
npm run sample-output
# = node cli/run.js --input sample-data/leads.csv --rules config/rules.json --out sample-output/ \
#     --today 2026-10-20 --now 2026-10-20T09:00:00.000Z
```

`--now` fixes the log timestamps so the files are byte-for-byte reproducible; `tests/cli.test.js` re-runs the
command and fails if any file here differs from a fresh run.

| File | Contents |
|---|---|
| `leads.csv` | 47 clean, normalised, deduplicated leads with category, priority, rule and task ID |
| `rejected.csv` | 14 rows: 7 rejected at validation + 7 duplicates, with codes, reasons and the original values |
| `tasks.csv` | 47 follow-up tasks with due dates and owners |
| `mock-outbox.csv` | 40 messages that **would** be sent. Status `NOT SENT (mock)`. Nothing was sent. |
| `run-log.json` | Every step for every record (step, record ID, result, message, timestamp), counts and hashes |
| `summary.md` | Human-readable summary of the run |

Owners such as "SDR queue (synthetic)" are example queue names, not real teams.
