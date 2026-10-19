#!/usr/bin/env node
// Command-line workflow. Same pure logic as the web app (src/lib). No dependencies.
//
//   node cli/run.js --input sample-data/leads.csv --rules config/rules.json --out out/ [--today 2026-10-20]
//
// Exit codes: 0 success, 1 usage/configuration error (bad flags, unreadable file, invalid rules or run date),
// 2 input error (CSV could not be processed; see out/run-log.json and out/summary.md).

import fs from 'node:fs';
import path from 'node:path';
import { runPipeline } from '../src/lib/pipeline.js';
import { parseCsv } from '../src/lib/csv.js';
import { parseRulesText } from '../src/lib/rules.js';
import { isIsoDate, localIsoDate } from '../src/lib/dates.js';
import { OUTPUT_FILES } from '../src/lib/outputs.js';

const HELP = `Marketing workflow automation (synthetic demo, mock messaging only)

Usage:
  node cli/run.js --input <leads.csv> [--rules config/rules.json] [--out out/] [options]

Options:
  --input <file>            Leads CSV to process (required)
  --rules <file>            Rules JSON (default: config/rules.json)
  --out <dir>               Output directory (default: out/), created if missing
  --today <YYYY-MM-DD>      Run date used for due dates and lead age (default: today, local time)
  --now <ISO timestamp>     Fixed clock for log timestamps, for byte-identical run logs (default: real clock)
  --existing-tasks <file>   tasks.csv from an earlier run; tasks with the same ID are kept as-is (status preserved),
                            not duplicated, and not re-messaged
  --quiet                   Only print errors
  --help                    Show this help

Outputs (in --out): ${OUTPUT_FILES.join(', ')}
Nothing is ever sent: mock-outbox.csv lists messages that WOULD be sent.`;

function parseArgs(argv) {
  const opts = { rules: 'config/rules.json', out: 'out', quiet: false, help: false };
  const valued = { '--input': 'input', '--rules': 'rules', '--out': 'out', '--today': 'today', '--now': 'now', '--existing-tasks': 'existingTasks' };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline = null;
    if (a.startsWith('--') && a.includes('=')) [a, inline] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (valued[a]) {
      const v = inline ?? argv[++i];
      if (v === undefined || (inline === null && v.startsWith('--'))) throw new UsageError(`${a} needs a value.`);
      opts[valued[a]] = v;
    } else throw new UsageError(`Unknown option "${a}". Run with --help to see the options.`);
  }
  return opts;
}

class UsageError extends Error {}

function readText(file, what) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new UsageError(`Cannot read ${what} "${file}": ${e.code === 'ENOENT' ? 'file not found' : e.message}`);
  }
}

function loadExistingTasks(file) {
  const rows = parseCsv(readText(file, 'existing tasks file'));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  if (!header.includes('task_id')) throw new UsageError(`"${file}" has no task_id column; pass a tasks.csv produced by this tool.`);
  return rows.slice(1).filter((r) => r.some((v) => v.trim())).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').replace(/^'(?=[=+\-@])/, '')])));
}

/** Write via a temp file + rename so a crash never leaves a half-written output file. */
function writeAtomic(dir, name, content) {
  const target = path.join(dir, name);
  const tmp = path.join(dir, `.${name}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, target);
  return target;
}

export function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      console.log(HELP);
      return 0;
    }
    if (!opts.input) throw new UsageError('Missing --input <leads.csv>. Run with --help to see the options.');
    const today = opts.today ?? localIsoDate();
    if (!isIsoDate(today)) throw new UsageError(`--today "${today}" must be a valid date in YYYY-MM-DD format.`);
    if (opts.now !== undefined && Number.isNaN(Date.parse(opts.now))) throw new UsageError(`--now "${opts.now}" is not a valid ISO timestamp.`);
    const { rules, errors } = parseRulesText(readText(opts.rules, 'rules file'));
    if (errors.length) {
      throw new UsageError(`Rules file "${opts.rules}" is invalid:\n` + errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n'));
    }
    const csvText = readText(opts.input, 'input CSV');
    const existingTasks = opts.existingTasks ? loadExistingTasks(opts.existingTasks) : null;
    const fixedNow = opts.now !== undefined ? new Date(opts.now).toISOString() : null;
    const result = runPipeline({
      csvText, rules, today, existingTasks,
      inputName: path.basename(opts.input),
      now: fixedNow ? () => fixedNow : () => new Date().toISOString(),
    });

    fs.mkdirSync(opts.out, { recursive: true });
    if (result.fatal) {
      // Never leave CSVs from an earlier run next to a failed run log.
      for (const f of OUTPUT_FILES) if (f.endsWith('.csv')) fs.rmSync(path.join(opts.out, f), { force: true });
    }
    // Data files first, run-log.json last: its presence and runId mark a complete, consistent output set.
    const order = Object.keys(result.outputs).filter((f) => f !== 'run-log.json').concat('run-log.json');
    const written = order.map((f) => writeAtomic(opts.out, f, result.outputs[f]));

    if (result.fatal) {
      console.error(`Run stopped (${result.fatal.code}): ${result.fatal.message}`);
      console.error(`Details: ${path.join(opts.out, 'summary.md')}`);
      return 2;
    }
    if (!opts.quiet) {
      const c = result.counts;
      console.log(`Run ${result.runId} | run date ${today} | input ${path.basename(opts.input)}`);
      console.log(`  rows read ${c.rowsRead}, rejected ${c.rejectedValidation}, with warnings ${c.rowsWithWarnings}, duplicates merged ${c.duplicates}, clean leads ${c.uniqueLeads}`);
      console.log(`  tasks created ${c.tasksCreated}, already existed ${c.tasksAlreadyExisted}; mock messages logged ${c.messagesMocked} (NOT sent), skipped ${c.messagesSkipped}`);
      const shown = (w) => {
        const rel = path.relative(process.cwd(), w);
        return rel && !rel.startsWith('..') ? rel : w;
      };
      console.log('  wrote: ' + written.map(shown).join(', '));
    }
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`Error: ${e.message}`);
      return 1;
    }
    console.error(`Unexpected error: ${e && e.stack ? e.stack : e}`);
    console.error('No partial files were left behind; it is safe to fix the problem and run the same command again.');
    return 1;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) process.exitCode = main();
