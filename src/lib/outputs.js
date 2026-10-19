// Output builders: clean leads CSV, rejected rows CSV (with reasons), tasks CSV, mock outbox CSV,
// run log JSON and a human-readable Markdown summary. All deterministic for a given pipeline result.

import { objectsToCsv, serializeCsv } from './csv.js';

export const LEAD_OUTPUT_COLUMNS = [
  'record_id', 'first_name', 'last_name', 'email', 'phone', 'company', 'job_title', 'company_size', 'country',
  'source', 'created_at', 'opt_in', 'category', 'priority', 'rule_id', 'task_id', 'source_rows', 'warnings', 'notes',
];
export const TASK_OUTPUT_COLUMNS = [
  'task_id', 'record_id', 'lead_name', 'company', 'email', 'phone', 'category', 'priority', 'task_type',
  'due_date', 'owner', 'status', 'rule_id', 'created_in_run',
];
export const OUTBOX_COLUMNS = ['message_id', 'task_id', 'record_id', 'to', 'from', 'subject', 'body', 'template', 'status'];
export const REJECTED_META_COLUMNS = ['_row', '_stage', '_record_id', '_codes', '_reasons', '_duplicate_of'];

export const OUTPUT_FILES = ['leads.csv', 'rejected.csv', 'tasks.csv', 'mock-outbox.csv', 'run-log.json', 'summary.md'];

export function leadsToCsv(leads) {
  return objectsToCsv(
    leads.map((l) => ({ ...l, company_size: l.company_size ?? '', source_rows: l.source_rows.join(';'), warnings: (l.warnings || []).join(';') })),
    LEAD_OUTPUT_COLUMNS,
  );
}

/** Rejected rows keep the original header and raw values so they can be fixed and re-imported (meta columns start with _ and are ignored on import). */
export function rejectedToCsv(rejected, header) {
  const sorted = [...rejected].sort((a, b) => a._row - b._row);
  const hasExtra = sorted.some((r) => r.cells.length > header.length);
  const cols = [...REJECTED_META_COLUMNS, ...header, ...(hasExtra ? ['_extra_fields'] : [])];
  const rows = [cols];
  for (const r of sorted) {
    const cells = header.map((_, i) => r.cells[i] ?? '');
    const extra = hasExtra ? [r.cells.slice(header.length).join(' | ')] : [];
    rows.push([...REJECTED_META_COLUMNS.map((k) => r[k]), ...cells, ...extra]);
  }
  return serializeCsv(rows);
}

export function tasksToCsv(tasks) {
  return objectsToCsv(tasks, TASK_OUTPUT_COLUMNS);
}

export function outboxToCsv(messages) {
  return objectsToCsv(messages, OUTBOX_COLUMNS);
}

function sortedCounts(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function formatPct(n, d) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a';
}

export function buildRunLog(result) {
  return {
    tool: 'marketing-workflow-automation',
    schemaVersion: 1,
    note: 'Synthetic demo data. Messaging is mocked: no message was sent.',
    runId: result.runId,
    generatedAt: result.generatedAt,
    runDate: result.today,
    input: { name: result.inputName, sha256: result.inputSha, dataRows: result.counts.rowsRead },
    rules: { version: result.rulesVersion, sha256: result.rulesSha, skipWeekends: result.skipWeekends },
    fatal: result.fatal,
    counts: result.counts,
    outputs: result.outputRows || {},
    entries: result.entries,
    mockMessages: result.messages,
    skippedMessages: result.skippedMessages,
  };
}

export function buildSummary(result) {
  const c = result.counts;
  const L = [];
  L.push(`# Workflow run summary — ${result.runId}`, '');
  L.push('> Synthetic demo data. Messaging is mocked: messages below were **logged, not sent**.', '');
  L.push(`- Run date: ${result.today}`);
  L.push(`- Generated at: ${result.generatedAt}`);
  L.push(`- Input: ${result.inputName} (sha256 ${result.inputSha.slice(0, 16)}…)`);
  L.push(`- Rules: version ${result.rulesVersion || 'n/a'} (sha256 ${result.rulesSha.slice(0, 16)}…), skip weekends: ${result.skipWeekends}`);
  L.push('');
  if (result.fatal) {
    L.push('## Run stopped', '', `**${result.fatal.code}** at step \`${result.fatal.step}\`: ${result.fatal.message}`, '');
    L.push('Nothing was processed. Fix the problem above and run again; the run is safe to retry.', '');
    return L.join('\n');
  }
  L.push('## Pipeline', '', '| Step | Count | Share of rows read |', '|---|---:|---:|');
  L.push(`| Rows read | ${c.rowsRead} | ${formatPct(c.rowsRead, c.rowsRead)} |`);
  L.push(`| Rejected at validation | ${c.rejectedValidation} | ${formatPct(c.rejectedValidation, c.rowsRead)} |`);
  L.push(`| Accepted with warnings | ${c.rowsWithWarnings} | ${formatPct(c.rowsWithWarnings, c.rowsRead)} |`);
  L.push(`| Duplicates merged | ${c.duplicates} | ${formatPct(c.duplicates, c.rowsRead)} |`);
  L.push(`| Unique clean leads | ${c.uniqueLeads} | ${formatPct(c.uniqueLeads, c.rowsRead)} |`);
  L.push(`| Tasks created this run | ${c.tasksCreated} | — |`);
  L.push(`| Tasks that already existed | ${c.tasksAlreadyExisted} | — |`);
  L.push(`| Mock messages (not sent) | ${c.messagesMocked} | — |`);
  L.push(`| Messages skipped | ${c.messagesSkipped} | — |`, '');
  L.push('## Leads by category', '', '| Category | Leads |', '|---|---:|');
  for (const [k, v] of sortedCounts(c.byCategory)) L.push(`| ${k} | ${v} |`);
  L.push('', '## Leads by priority', '', '| Priority | Leads |', '|---|---:|');
  for (const [k, v] of sortedCounts(c.byPriority)) L.push(`| ${k} | ${v} |`);
  L.push('', '## Tasks by due date', '', '| Due date | Tasks |', '|---|---:|');
  for (const [k, v] of Object.entries(c.tasksByDueDate).sort((a, b) => a[0].localeCompare(b[0]))) L.push(`| ${k} | ${v} |`);
  L.push('', '## Rejections and duplicates by code', '');
  const rj = sortedCounts(c.rejectionsByCode);
  if (rj.length) {
    L.push('| Code | Rows |', '|---|---:|');
    for (const [k, v] of rj) L.push(`| ${k} | ${v} |`);
  } else L.push('None.');
  L.push('', '## Warnings by code', '');
  const wn = sortedCounts(c.warningsByCode);
  if (wn.length) {
    L.push('| Code | Warnings |', '|---|---:|');
    for (const [k, v] of wn) L.push(`| ${k} | ${v} |`);
  } else L.push('None.');
  L.push('', '## Output files', '');
  for (const [f, n] of Object.entries(result.outputRows || {})) L.push(`- \`${f}\`: ${n} row(s)`);
  L.push('', 'Codes are defined in docs/VALIDATION.md. Re-running with the same input, rules and run date produces identical files (see docs/IDEMPOTENCY.md).', '');
  return L.join('\n');
}

/** Build every output file as a string. Adds "output" log entries before serialising the run log. */
export function buildOutputs(result, rules, log) {
  const files = {};
  const rowsOut = {};
  if (!result.fatal) {
    files['leads.csv'] = leadsToCsv(result.leads);
    rowsOut['leads.csv'] = result.leads.length;
    files['rejected.csv'] = rejectedToCsv(result.rejected, result.header);
    rowsOut['rejected.csv'] = result.rejected.length;
    files['tasks.csv'] = tasksToCsv(result.tasks);
    rowsOut['tasks.csv'] = result.tasks.length;
    files['mock-outbox.csv'] = outboxToCsv(result.messages);
    rowsOut['mock-outbox.csv'] = result.messages.length;
    for (const [f, n] of Object.entries(rowsOut)) log('output', '', 'ok', `Prepared ${f} with ${n} data row(s).`);
  }
  result.outputRows = rowsOut;
  log('output', '', result.fatal ? 'error' : 'ok', result.fatal ? 'Run stopped before processing; only run-log.json and summary.md are produced.' : 'Prepared run-log.json and summary.md.');
  files['run-log.json'] = JSON.stringify(buildRunLog(result), null, 2) + '\n';
  files['summary.md'] = buildSummary(result);
  return files;
}
