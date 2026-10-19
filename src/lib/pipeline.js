// The workflow: ingest -> validate -> normalise -> dedupe -> categorise -> tasks -> mock messaging -> outputs.
// Pure and deterministic: the same CSV text + rules + run date (+ clock) always produce identical results.
// Every step writes log entries { seq, step, record_id, result, message, timestamp }.

import { parseCsv } from './csv.js';
import { sha256Hex, shortId } from './hash.js';
import { isIsoDate } from './dates.js';
import { mapHeader, validateRow } from './validate.js';
import { cleanText, normaliseRecord } from './normalise.js';
import { dedupeRecords } from './dedupe.js';
import { validateRules, categorise } from './rules.js';
import { buildTask, mergeTasks, sortTasks, buildMockMessage } from './tasks.js';
import { buildOutputs } from './outputs.js';

export const PIPELINE_STEPS = ['ingest', 'validate', 'normalise', 'dedupe', 'categorise', 'tasks', 'message', 'output'];

function bump(obj, key, by = 1) {
  obj[key] = (obj[key] || 0) + by;
}

/**
 * Run the full workflow.
 * @param {object} p
 * @param {string} p.csvText        raw CSV text
 * @param {object} p.rules          parsed rules (config/rules.json)
 * @param {string} p.today          run date YYYY-MM-DD (due dates and lead age are computed from it)
 * @param {function} [p.now]        clock returning an ISO timestamp (inject a fixed clock for byte-identical logs)
 * @param {string} [p.inputName]    file name for the log
 * @param {Array}  [p.existingTasks] previously created tasks; matching task IDs are not duplicated or re-messaged
 */
export function runPipeline({ csvText, rules, today, now = () => new Date().toISOString(), inputName = 'input.csv', existingTasks = null }) {
  const entries = [];
  let seq = 0;
  const log = (step, recordId, result, message) => {
    entries.push({ seq: ++seq, step, record_id: recordId || '', result, message, timestamp: now() });
  };
  const text = String(csvText ?? '');
  const inputSha = sha256Hex(text);
  const rulesSha = sha256Hex(JSON.stringify(rules ?? null));
  const result = {
    runId: shortId('R', `${inputSha}|${rulesSha}|${today}`),
    generatedAt: now(),
    today,
    inputName,
    inputSha,
    rulesSha,
    rulesVersion: rules && rules.version ? rules.version : '',
    skipWeekends: rules && rules.tasks ? rules.tasks.skipWeekends : null,
    fatal: null,
    header: [],
    entries,
    leads: [],
    rejected: [],
    warnings: [],
    tasks: [],
    messages: [],
    skippedMessages: [],
    counts: {
      rowsRead: 0, blankRows: 0, rejectedValidation: 0, rowsWithWarnings: 0, warningsTotal: 0, duplicates: 0,
      uniqueLeads: 0, tasksGenerated: 0, tasksCreated: 0, tasksAlreadyExisted: 0, messagesMocked: 0, messagesSkipped: 0,
      byCategory: {}, byPriority: {}, rejectionsByCode: {}, warningsByCode: {}, tasksByDueDate: {},
    },
    outputs: {},
  };
  const c = result.counts;
  const fail = (step, code, message) => {
    result.fatal = { step, code, message };
    log(step, '', 'error', message);
    result.outputs = buildOutputs(result, rules, log);
    return result;
  };

  // ---- configuration checks
  if (!isIsoDate(today)) return fail('ingest', 'invalid_run_date', `Run date "${today}" must be a valid YYYY-MM-DD date.`);
  const ruleErrors = validateRules(rules);
  if (ruleErrors.length) {
    return fail('ingest', 'invalid_rules', `Rules file is invalid (${ruleErrors.length} problem(s)): ${ruleErrors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
  }

  // ---- ingest
  let rows;
  try {
    rows = parseCsv(text);
  } catch (e) {
    return fail('ingest', 'csv_parse_error', e.message);
  }
  if (!rows.length || rows[0].every((h) => !cleanText(h))) return fail('ingest', 'empty_input', 'The CSV is empty. Provide a header row and at least one data row.');
  const header = rows[0];
  result.header = header;
  const hm = mapHeader(header);
  if (hm.fatal) return fail('ingest', 'missing_columns', `${hm.fatal} Found columns: ${header.map(cleanText).join(', ') || '(none)'}.`);
  const dataRows = [];
  rows.slice(1).forEach((cells, i) => {
    const rowNo = i + 2; // header is row 1, as in a spreadsheet
    if (cells.every((v) => !cleanText(v))) {
      c.blankRows++;
      return;
    }
    dataRows.push({ rowNo, cells });
  });
  c.rowsRead = dataRows.length;
  if (!dataRows.length) return fail('ingest', 'empty_input', 'The CSV has a header but no data rows.');
  log('ingest', '', 'ok', `Read ${dataRows.length} data row(s) from ${inputName} (${header.length} columns; mapped: ${hm.columns.join(', ')})` +
    (hm.ignored.length ? `; ignored columns: ${hm.ignored.join(', ')}` : '') + (c.blankRows ? `; skipped ${c.blankRows} blank row(s)` : '') + '.');

  // ---- validate
  const valid = [];
  for (const { rowNo, cells } of dataRows) {
    const raw = {};
    hm.mapping.forEach((col, idx) => {
      if (col) raw[col] = cells[idx] ?? '';
    });
    const extras = cells.slice(header.length).filter((v) => cleanText(v)).length;
    const shortBy = cells.length < header.length ? header.length - cells.length : 0;
    const v = validateRow(raw, { today, shortRow: shortBy, extraFields: extras });
    const ref = `row-${rowNo}`;
    if (v.errors.length) {
      c.rejectedValidation++;
      for (const e of v.errors) bump(c.rejectionsByCode, e.code);
      result.rejected.push({
        _row: rowNo, _stage: 'validate', _record_id: '', _codes: v.errors.map((e) => e.code).join(';'),
        _reasons: v.errors.map((e) => e.message).join(' | '), _duplicate_of: '', cells,
      });
      log('validate', ref, 'reject', `Row ${rowNo} rejected: ${v.errors.map((e) => e.message).join(' | ')}`);
      continue;
    }
    if (v.warnings.length) {
      c.rowsWithWarnings++;
      c.warningsTotal += v.warnings.length;
      for (const w of v.warnings) bump(c.warningsByCode, w.code);
      log('validate', ref, 'warn', `Row ${rowNo} accepted with warning(s): ${v.warnings.map((w) => w.message).join(' | ')}`);
    } else log('validate', ref, 'ok', `Row ${rowNo} passed all checks.`);
    valid.push({ rowNo, raw, warnings: v.warnings, cells });
  }

  // ---- normalise
  const records = [];
  for (const { rowNo, raw, warnings, cells } of valid) {
    const { record, changes } = normaliseRecord(raw, { today, row: rowNo });
    record.warnings = warnings.map((w) => w.code);
    record.cells = cells;
    for (const w of warnings) result.warnings.push({ row: rowNo, record_id: record.record_id, code: w.code, field: w.field, message: w.message });
    records.push(record);
    log('normalise', record.record_id, 'ok', `Row ${rowNo} -> ${record.record_id}: ` + (changes.length ? `${changes.length} change(s): ${changes.join('; ')}` : 'no changes needed'));
  }

  // ---- dedupe
  const { survivors, duplicates } = dedupeRecords(records, { today });
  const dupCountFor = new Map();
  for (const d of duplicates) {
    c.duplicates++;
    bump(c.rejectionsByCode, d.code);
    dupCountFor.set(d.duplicateOf, (dupCountFor.get(d.duplicateOf) || 0) + 1);
    const how = d.code === 'duplicate_email' ? 'same email' : 'same first name, last name and company';
    const reason = `Duplicate of ${d.duplicateOf} (row ${d.survivorRow}, ${how}); merged into that record` + (d.filled.length ? `, filled: ${d.filled.join(', ')}` : '');
    result.rejected.push({ _row: d.record.row, _stage: 'dedupe', _record_id: d.record.record_id, _codes: d.code, _reasons: reason, _duplicate_of: d.duplicateOf, cells: d.record.cells });
    log('dedupe', d.record.record_id, 'skip', `Row ${d.record.row}: ${reason}.`);
  }
  for (const s of survivors) {
    const n = dupCountFor.get(s.record_id) || 0;
    log('dedupe', s.record_id, 'ok', n ? `Kept (row ${s.row}); absorbed ${n} duplicate(s) from row(s) ${s.source_rows.slice(1).join(', ')}.` : `Unique (row ${s.row}).`);
  }
  c.uniqueLeads = survivors.length;

  // ---- categorise
  for (const lead of survivors) {
    const r = categorise(lead, rules);
    lead.category = r.category;
    lead.priority = r.priority;
    lead.rule_id = r.ruleId;
    bump(c.byCategory, r.category);
    bump(c.byPriority, r.priority);
    log('categorise', lead.record_id, 'ok', r.ruleId === 'default'
      ? `No rule matched -> default "${r.category}" (${r.priority}).`
      : `Rule "${r.ruleId}" matched -> "${r.category}" (${r.priority}).`);
  }

  // ---- tasks
  const generated = survivors.map((lead) => buildTask(lead, rules, { today, runId: result.runId }));
  c.tasksGenerated = generated.length;
  const merged = mergeTasks(existingTasks || [], generated);
  const createdSet = new Set(merged.created);
  const existingById = new Map((existingTasks || []).map((t) => [t.task_id, t]));
  survivors.forEach((lead, i) => {
    const t = generated[i];
    lead.task_id = t.task_id;
    if (createdSet.has(t.task_id)) {
      c.tasksCreated++;
      log('tasks', lead.record_id, 'ok', `Created ${t.task_id}: ${t.task_type} by ${t.owner}, priority ${t.priority}, due ${t.due_date}.`);
    } else {
      c.tasksAlreadyExisted++;
      const old = existingById.get(t.task_id);
      log('tasks', lead.record_id, 'skip', `${t.task_id} already exists (status "${old.status}", due ${old.due_date}); not duplicated or changed.`);
    }
  });
  result.tasks = sortTasks(merged.tasks, rules);
  for (const t of result.tasks) bump(c.tasksByDueDate, t.due_date);

  // ---- mock messaging (never sends)
  survivors.forEach((lead, i) => {
    const t = generated[i];
    if (!createdSet.has(t.task_id)) {
      c.messagesSkipped++;
      result.skippedMessages.push({ task_id: t.task_id, record_id: lead.record_id, reason: 'task already existed, message handled in an earlier run' });
      log('message', lead.record_id, 'skip', 'No mock message: task already existed (prevents duplicate sends on re-run).');
      return;
    }
    const m = buildMockMessage(t, lead, rules);
    if (m.skip) {
      c.messagesSkipped++;
      result.skippedMessages.push({ task_id: t.task_id, record_id: lead.record_id, reason: m.skip });
      log('message', lead.record_id, 'skip', `No mock message: ${m.skip}.`);
      return;
    }
    c.messagesMocked++;
    result.messages.push(m.message);
    log('message', lead.record_id, 'ok', `WOULD SEND (mock, not sent) ${m.message.message_id} to ${m.message.to}: "${m.message.subject}".`);
  });

  for (const lead of survivors) delete lead.cells;
  result.leads = survivors;
  result.outputs = buildOutputs(result, rules, log);
  return result;
}
