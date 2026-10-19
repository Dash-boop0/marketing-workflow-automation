# n8n workflow (optional)

`marketing-workflow.json` is an importable n8n workflow that runs the **same** lead-processing code as the web app
and CLI. It uses only core nodes, needs **no credentials**, and contains **no sending nodes** (no email, HTTP or
webhook nodes). Messaging is mock-only.

> **Verification status – please read.** This workflow was **structure-checked, not executed in n8n.** n8n was not
> available on the build machine. What *was* verified (`tests/n8n.test.js`):
> - the file is valid JSON with n8n's `nodes` / `connections` structure, unique node IDs and names, numeric
>   `typeVersion`s, positions, and connections that reference existing nodes;
> - every node is reachable from the Manual Trigger and is one of the core types listed below; no node declares credentials;
> - the Code node's JavaScript was executed in Node.js with a mocked `$input` / `$()` API on the sample CSV and
>   produced output files identical to the CLI.
>
> Node parameter names were written for the node versions listed below; if your n8n version differs, a node may need
> its fields re-selected after import. Please report anything that does not import cleanly.

## Nodes

| Node | Type (version) | Purpose |
|---|---|---|
| Manual Trigger | `manualTrigger` (1) | Start the run by hand |
| Config | `set` (3.4) | `inputPath`, `outputDir`, `runDate` (defaults to today) and `rulesJson` (a copy of `config/rules.json`) |
| Read leads CSV | `readWriteFile` (1) | Reads the CSV from disk |
| Extract CSV text | `extractFromFile` (1, operation *text*) | Puts the file contents into `json.data` |
| Run lead pipeline | `code` (2) | Validate → normalise → dedupe → categorise → tasks → mock messages → outputs. Generated from `src/lib/*.js` |
| Route by kind | `switch` (3) | Routes items: output files / mock messages / run stopped |
| Convert to text file | `convertToFile` (1.1, *toText*) | Turns each output's text into a binary file |
| Write output file | `readWriteFile` (1, *write*) | Writes `leads.csv`, `rejected.csv`, `tasks.csv`, `mock-outbox.csv`, `run-log.json`, `summary.md` into `outputDir` |
| Mock send (log only, never sent) | `set` (3.4) | Adds `delivery = "NOT SENT (mock)"` and `loggedAt` to each would-be message, visible in the execution log |
| Stop: input problem | `stopAndError` (1) | Fails the execution with a clear message if the CSV cannot be processed (e.g. missing columns) |

## Import and configure

1. In n8n: **Workflows → Import from File** and choose `n8n/marketing-workflow.json`.
2. Copy `sample-data/leads.csv` to a folder your n8n instance can read and write. Recent n8n versions restrict file
   access (see the `N8N_RESTRICT_FILE_ACCESS_TO` environment variable); with Docker, mount a volume, e.g.
   `-v "$PWD/sample-data:/home/node/mwa"`.
3. Open the **Config** node and set:
   - `inputPath` – full path to the leads CSV (default `/home/node/mwa/leads.csv`);
   - `outputDir` – folder for the outputs (default `/home/node/mwa/out`; create it first);
   - `runDate` – leave as `{{ $today.toFormat('yyyy-MM-dd') }}` or type a fixed date such as `2026-10-20` for reproducible results;
   - `rulesJson` – the rules; paste a new version of `config/rules.json` here to change categorisation.
4. Click **Execute workflow**. Inspect the *Mock send* node output to see each message that would be sent.

No credentials are needed and none should be added.

## Rebuilding after code changes

The Code node is generated. After editing anything in `src/lib/` or `config/rules.json`:

```bash
npm run build:n8n   # rewrites n8n/marketing-workflow.json
npm test            # fails if the committed JSON is out of date
```

## Idempotency in n8n

Outputs are overwritten on each run, and the same input + rules + run date produce the same files (log
timestamps aside). The n8n flow does not keep a task board between executions; for insert-if-absent task merging
use the CLI's `--existing-tasks` option or the web app. See [docs/IDEMPOTENCY.md](../docs/IDEMPOTENCY.md).
