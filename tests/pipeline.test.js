import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, PIPELINE_STEPS } from '../src/lib/pipeline.js';
import { parseCsv } from '../src/lib/csv.js';
import { formatPct } from '../src/lib/outputs.js';
import { loadRules, sampleCsv, FIXED_NOW, HEADER } from './helpers.js';

const rules = loadRules();
const run = (csvText, extra = {}) => runPipeline({ csvText, rules, today: '2026-10-20', now: FIXED_NOW, inputName: 'leads.csv', ...extra });

test('sample data: hand-verified counts', () => {
  // 62 data lines incl. 1 blank row. 7 rows rejected (rows 7, 11, 20, 21, 22, 59, 62), 7 duplicates
  // (rows 13, 19, 31, 38, 56, 58, 63) -> 61 - 7 - 7 = 47 unique leads, one task each. 7 leads get no mock
  // message (3 opt_in "no" incl. merged Ava Patel, 3 opt_in unknown, 1 phone-only) -> 40 mock messages.
  const r = run(sampleCsv());
  assert.equal(r.fatal, null);
  const c = r.counts;
  assert.equal(c.rowsRead, 61);
  assert.equal(c.blankRows, 1);
  assert.equal(c.rejectedValidation, 7);
  assert.equal(c.duplicates, 7);
  assert.equal(c.uniqueLeads, 47);
  assert.equal(c.tasksCreated, 47);
  assert.equal(c.messagesMocked, 40);
  assert.equal(c.messagesSkipped, 7);
  assert.deepEqual(c.rejectionsByCode, { invalid_email: 3, missing_contact: 1, missing_name: 1, missing_company: 1, malformed_row: 1, duplicate_email: 5, duplicate_name_company: 2 });
  assert.deepEqual(c.byPriority, { high: 13, medium: 25, low: 9 });
  assert.deepEqual(c.tasksByDueDate, { '2026-10-21': 13, '2026-10-23': 25, '2026-10-29': 9 });
  assert.equal(Object.values(c.byCategory).reduce((a, b) => a + b, 0), 47);
  assert.equal(r.rejected.length, 14);
});

test('specific sample records are processed as designed', () => {
  const r = run(sampleCsv());
  const ava = r.leads.find((l) => l.email === 'ava.patel@example.com');
  assert.deepEqual(ava.source_rows, [2, 13, 31]);
  assert.equal(ava.opt_in, 'no'); // row 31 opted out
  assert.equal(ava.category, 'Enterprise decision maker');
  assert.ok(!r.messages.some((m) => m.to === 'ava.patel@example.com'));
  const liam = r.leads.find((l) => l.last_name === "O'Connor");
  assert.equal(liam.phone, '+441632960011');
  assert.equal(liam.created_at, '2026-10-05');
  const jack = r.leads.find((l) => l.full_name === 'Jack Turner');
  assert.equal(jack.email, '');
  assert.ok(jack.record_id.startsWith('L-'));
});

test('every log entry has step, record id, result, message and timestamp', () => {
  const r = run(sampleCsv());
  for (const e of r.entries) {
    assert.ok(PIPELINE_STEPS.includes(e.step), e.step);
    assert.ok(['ok', 'warn', 'reject', 'skip', 'error'].includes(e.result));
    assert.equal(typeof e.message, 'string');
    assert.equal(e.timestamp, '2026-10-20T09:00:00.000Z');
    assert.ok('record_id' in e);
  }
  for (const s of PIPELINE_STEPS) assert.ok(r.entries.some((e) => e.step === s), `missing step ${s}`);
});

test('idempotent: same input, rules, run date and clock give byte-identical outputs', () => {
  const a = run(sampleCsv()).outputs;
  const b = run(sampleCsv()).outputs;
  assert.deepEqual(Object.keys(a), ['leads.csv', 'rejected.csv', 'tasks.csv', 'mock-outbox.csv', 'run-log.json', 'summary.md']);
  for (const f of Object.keys(a)) assert.equal(a[f], b[f], f);
});

test('with a real clock, only timestamps differ; data files are identical', () => {
  let t = 0;
  const a = run(sampleCsv(), { now: () => new Date(Date.UTC(2026, 9, 20, 9, 0, 0, t++)).toISOString() }).outputs;
  const b = run(sampleCsv(), { now: () => new Date(Date.UTC(2026, 9, 21, 9, 0, 0, t++)).toISOString() }).outputs;
  for (const f of ['leads.csv', 'rejected.csv', 'tasks.csv', 'mock-outbox.csv']) assert.equal(a[f], b[f], f);
  const strip = (s) => s.replace(/"(timestamp|generatedAt)": "[^"]+"/g, '');
  assert.equal(strip(a['run-log.json']), strip(b['run-log.json']));
});

test('re-running with previous tasks creates no duplicate tasks and no repeat messages', () => {
  const first = run(sampleCsv());
  const prev = first.tasks.map((t, i) => (i === 0 ? { ...t, status: 'done' } : t));
  const second = run(sampleCsv(), { existingTasks: prev });
  assert.equal(second.counts.tasksCreated, 0);
  assert.equal(second.counts.tasksAlreadyExisted, 47);
  assert.equal(second.tasks.length, 47);
  assert.equal(new Set(second.tasks.map((t) => t.task_id)).size, 47);
  assert.equal(second.counts.messagesMocked, 0);
  assert.equal(second.tasks.find((t) => t.task_id === prev[0].task_id).status, 'done'); // status preserved
});

test('a new lead added to the file creates exactly one new task on re-run', () => {
  const first = run(sampleCsv());
  const csv2 = sampleCsv() + 'New,Lead,new.lead@example.com,,Fernvale Foods (synthetic),Analyst,450,UK,Website,2026-10-19,yes,\n';
  const second = run(csv2, { existingTasks: first.tasks });
  assert.equal(second.counts.tasksCreated, 1);
  assert.equal(second.counts.messagesMocked, 1);
  assert.equal(second.tasks.length, 48);
});

test('record and task IDs do not depend on row order', () => {
  const lines = sampleCsv().trimEnd().split('\n');
  const ids = (csv) => new Set(run(csv).leads.filter((l) => l.source_rows.length === 1).map((l) => l.record_id));
  const reversedUnique = [lines[0], ...lines.slice(1).reverse()].join('\n');
  // Reversing breaks the multi-line quoted note, so compare on a simple file instead.
  const simple = `${HEADER}\nA,One,a1@example.com,,Co A,,,,,,,\nB,Two,b2@example.com,,Co B,,,,,,,\nC,Three,,202-555-0101,Co C,,,US,,,,\n`;
  const rev = `${HEADER}\nC,Three,,202-555-0101,Co C,,,US,,,,\nB,Two,b2@example.com,,Co B,,,,,,,\nA,One,a1@example.com,,Co A,,,,,,,\n`;
  assert.deepEqual([...ids(simple)].sort(), [...ids(rev)].sort());
  assert.ok(reversedUnique.length > 0);
});

test('CSV outputs are parseable and consistent with counts', () => {
  const r = run(sampleCsv());
  const leads = parseCsv(r.outputs['leads.csv']);
  assert.equal(leads.length - 1, 47);
  const tasks = parseCsv(r.outputs['tasks.csv']);
  assert.equal(tasks.length - 1, 47);
  const rejected = parseCsv(r.outputs['rejected.csv']);
  assert.equal(rejected.length - 1, 14);
  assert.equal(rejected[0][0], '_row');
  const outbox = parseCsv(r.outputs['mock-outbox.csv']);
  assert.equal(outbox.length - 1, 40);
  assert.ok(outbox.slice(1).every((row) => row[8] === 'NOT SENT (mock)'));
  // formula in notes is neutralised in the export
  const notesIdx = leads[0].indexOf('notes');
  assert.ok(leads.some((row) => row[notesIdx].startsWith("'=HYPERLINK")));
  const log = JSON.parse(r.outputs['run-log.json']);
  assert.equal(log.runId, r.runId);
  assert.equal(log.mockMessages.length, 40);
  assert.match(r.outputs['summary.md'], /logged, not sent/);
});

test('rejected rows can be fixed and re-imported (meta columns are ignored)', () => {
  const r = run(sampleCsv());
  const rej = r.outputs['rejected.csv'];
  const again = run(rej);
  assert.equal(again.fatal, null);
  assert.equal(again.counts.rowsRead, 14);
});

test('fatal input problems stop the run with a clear message', () => {
  assert.equal(run('').fatal.code, 'empty_input');
  assert.equal(run(`${HEADER}\n`).fatal.code, 'empty_input');
  assert.equal(run('name,email\nA,a@example.com\n').fatal.code, 'missing_columns');
  assert.equal(run(`${HEADER}\n"unterminated,x\n`).fatal.code, 'csv_parse_error');
  assert.equal(run(sampleCsv(), { today: '20/10/2026' }).fatal.code, 'invalid_run_date');
  const badRules = structuredClone(rules);
  badRules.messaging.mode = 'smtp';
  const r = runPipeline({ csvText: sampleCsv(), rules: badRules, today: '2026-10-20', now: FIXED_NOW });
  assert.equal(r.fatal.code, 'invalid_rules');
  assert.deepEqual(Object.keys(r.outputs), ['run-log.json', 'summary.md']);
  assert.match(r.outputs['summary.md'], /Run stopped/);
});

test('all rows rejected still produces valid, empty outputs', () => {
  const r = run(`${HEADER}\n,,bad,,,,,,,,,\n`);
  assert.equal(r.fatal, null);
  assert.equal(r.counts.uniqueLeads, 0);
  assert.equal(r.outputs['tasks.csv'], 'task_id,record_id,lead_name,company,email,phone,category,priority,task_type,due_date,owner,status,rule_id,created_in_run\r\n');
});

test('percentages divide safely', () => {
  assert.equal(formatPct(1, 4), '25.0%');
  assert.equal(formatPct(0, 0), 'n/a');
});
