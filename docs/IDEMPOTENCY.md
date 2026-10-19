# Idempotency and retries

Goal: running the workflow again on the same input never creates duplicate tasks or duplicate messages, and any
failed run can simply be run again.

## Deterministic identifiers

All IDs are the first 12 hex characters of a SHA-256 hash (pure-JS implementation in `src/lib/hash.js`, verified
against `node:crypto` in the tests, so the browser, Node and n8n produce the same values).

| ID | Hash input | Consequence |
|---|---|---|
| Record `L-…` | `email:<normalised email>`; if no email: `nc:<first last>|<company key>` | Same lead → same ID regardless of row order, spacing or letter case. |
| Task `T-…` | `<record ID>|first-follow-up` | One follow-up task per lead. Does **not** include the run date, priority or rules, so re-running on another day or after a rule change produces the same task ID. |
| Message `M-…` | `<task ID>|intro-email` | Usable as an idempotency key by a real sender (this project never sends). |
| Run `R-…` | `<input sha256>|<rules sha256>|<run date>` | Same inputs → same run ID. |

## What "identical outputs" means

Given the same CSV bytes, the same rules file and the same run date:

- `leads.csv`, `rejected.csv`, `tasks.csv` and `mock-outbox.csv` are byte-for-byte identical.
- `run-log.json` and `summary.md` contain timestamps from the clock. With `--now <ISO timestamp>` the clock is
  fixed and these two files are identical too; without it, only `timestamp`/`generatedAt` values differ.

Ordering is deterministic: leads keep input order (first occurrence), tasks are sorted by due date, priority rank,
lead name and task ID, rejected rows by row number.

Verified by:

- `tests/pipeline.test.js` – two runs with a fixed clock are byte-identical; with different clocks only timestamps differ.
- `tests/cli.test.js` – two CLI runs into different folders are byte-identical; the committed `sample-output/` equals a fresh run.
- Manual check (run during development):

```bash
node cli/run.js --input sample-data/leads.csv --rules config/rules.json --out /tmp/run1 --today 2026-10-20 --now 2026-10-20T09:00:00Z
node cli/run.js --input sample-data/leads.csv --rules config/rules.json --out /tmp/run2 --today 2026-10-20 --now 2026-10-20T09:00:00Z
diff -r /tmp/run1 /tmp/run2 && echo identical
```

## No duplicate tasks across runs (task board)

Tasks are merged **insert-if-absent** by task ID (`mergeTasks` in `src/lib/tasks.js`):

- a task ID that already exists is left exactly as it is (status, due date, owner) – it is never duplicated, reset or moved;
- only new task IDs are inserted;
- mock messages are generated only for newly inserted tasks, so a re-run does not "re-send".

Where the existing tasks come from:

- **Web app**: the saved task board in localStorage (option "Use saved task board", on by default). Run twice and
  the second run reports `0 new task(s), 47 already existed`; tasks you ticked as done stay done.
- **CLI**: `--existing-tasks <tasks.csv from an earlier run>`:

```bash
npm run demo                                   # first run: 47 tasks created, 40 mock messages
node cli/run.js --input sample-data/leads.csv --out out/ --today 2026-10-20 --existing-tasks out/tasks.csv
# -> tasks created 0, already existed 47; mock messages 0; out/tasks.csv still has 47 rows
```

Adding one new lead to the CSV and re-running with `--existing-tasks` creates exactly one task and one mock message
(tested in `tests/pipeline.test.js`).

Consequence of insert-if-absent: if you change the rules, existing tasks keep their old priority and due date. To
re-plan them, run without `--existing-tasks` (CLI) or clear the task board (web app).

## Retry guidance

| Situation | Safe to retry? | What to do |
|---|---|---|
| Fatal input or rules error (exit code 1 or 2) | Yes | Fix the file named in the message and run the same command again. Nothing was processed. |
| Process killed or crashed mid-write | Yes | Run the same command again. Each output file is written to a temporary file and renamed, so no file is ever half-written. `run-log.json` is written **last**: if it is missing, or its `runId` differs from what you expect, the folder is not a complete set – re-run. |
| Network or provider outage | n/a | The workflow makes no network calls; mock messaging cannot fail. |
| Same file processed twice by mistake | Yes | Without `--existing-tasks` the outputs are overwritten with identical content. With it, no tasks or messages are duplicated. |
| Rejected rows fixed | Yes | Edit `rejected.csv` (it keeps the original columns; `_`-prefixed columns are ignored on import), **delete the `_stage = dedupe` rows** (they were merged, not lost), and run it as a new input with `--existing-tasks`; only the fixed leads get new tasks. |

### How to resume

The workflow is a single, stateless pass (about 0.3 s for 5,000 rows on a laptop, including Node start-up), so "resume" means
**re-run from the start** – there is no partial state to recover. To continue an existing task list, pass it in
with `--existing-tasks` (CLI) or keep the task board on (web app).

On a CLI fatal error, stale `leads.csv`, `rejected.csv`, `tasks.csv` and `mock-outbox.csv` from an earlier run are
removed from the output folder, so a failed run log is never sitting next to older data files.

## Known limits

- A lead that first appears without an email (ID from name + company) and later appears with an email gets a
  different record ID and task ID. Within one file, dedupe merges them; across files it does not.
- If an email address changes, the lead is treated as new.
- Task status lives in the task board / tasks CSV you pass back in; there is no central database.
