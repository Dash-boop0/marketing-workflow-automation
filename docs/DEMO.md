# 2-minute demo script

Setup: `python3 -m http.server 8000` in the repo folder, open http://localhost:8000 (or the live demo). Use a
private window or press **Reset everything** first so the task board is empty.

**0:00 – Context (15 s).** "Marketing ops gets lead lists from forms, events and LinkedIn. They are messy. This
workflow cleans them, removes duplicates, categorises them with editable rules and creates follow-up tasks. All
data here is synthetic and messaging is mocked – nothing is ever sent." Point at the banner.

**0:15 – Input (20 s).** Click **Load sample leads**. The preview shows the raw rows: lower-case names, mixed date
formats, local phone numbers. Set **Run date** to 2026-10-20 so the numbers match the sample output. Click
**Run workflow**.

**0:35 – Overview (20 s).** KPIs: 61 rows read, 7 rejected, 7 duplicates merged, 47 clean leads, 47 tasks,
40 mock messages. Charts: rows through each step, leads by category and priority, tasks by due date (Wed/Fri/next
Thu – weekends skipped), and rejections by reason.

**0:55 – Errors & warnings (15 s).** Open the tab. Row 7 `ethan.brooks@example` → invalid email; row 31 is the
same person as row 2 with an opt-out, so the merged record is opt-out. Mention `rejected.csv` keeps original values
for fixing and re-import.

**1:10 – Step log (10 s).** Filter **Result = reject**, then search `WOULD SEND`. Every step for every record has a
step, record ID, result, message and timestamp.

**1:20 – Tasks + idempotency (20 s).** In **Tasks**, tick one task as done. Go back to Input and **Run workflow**
again: "0 new tasks, 47 already existed", no repeat messages, and the done task is still done. Record and task IDs
are hashes, so re-running never duplicates.

**1:40 – Rules (15 s).** Open **Rules**, change `"mode": "mock"` to `"smtp"` – the validator refuses it with the
exact JSON path. Undo. Show the plain-English rule table (first match wins).

**1:55 – CLI + n8n (5 s).** "Same logic on the command line:
`node cli/run.js --input sample-data/leads.csv --rules config/rules.json --out out/ --today 2026-10-20`,
and an importable n8n workflow generated from the same code."
