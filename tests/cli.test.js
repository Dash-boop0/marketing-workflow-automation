import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.js';

const cli = (args) => spawnSync(process.execPath, [path.join(ROOT, 'cli/run.js'), ...args], { cwd: ROOT, encoding: 'utf8' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mwa-'));
const base = ['--input', 'sample-data/leads.csv', '--rules', 'config/rules.json', '--today', '2026-10-20'];

test('CLI writes all outputs and is byte-identical across runs with a fixed clock', () => {
  const a = tmp();
  const b = tmp();
  const r1 = cli([...base, '--out', a, '--now', '2026-10-20T09:00:00Z']);
  const r2 = cli([...base, '--out', b, '--now', '2026-10-20T09:00:00Z']);
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r1.stdout, /clean leads 47/);
  const files = fs.readdirSync(a).sort();
  assert.deepEqual(files, ['leads.csv', 'mock-outbox.csv', 'rejected.csv', 'run-log.json', 'summary.md', 'tasks.csv']);
  for (const f of files) assert.equal(fs.readFileSync(path.join(a, f), 'utf8'), fs.readFileSync(path.join(b, f), 'utf8'), f);
});

test('committed sample-output matches a fresh run (regenerate with npm run sample-output)', () => {
  const a = tmp();
  cli([...base, '--out', a, '--now', '2026-10-20T09:00:00.000Z']);
  for (const f of fs.readdirSync(path.join(ROOT, 'sample-output')).filter((x) => !x.startsWith('README'))) {
    assert.equal(fs.readFileSync(path.join(a, f), 'utf8'), fs.readFileSync(path.join(ROOT, 'sample-output', f), 'utf8'), f);
  }
});

test('--existing-tasks prevents duplicate tasks on re-run', () => {
  const a = tmp();
  cli([...base, '--out', a]);
  const r = cli([...base, '--out', a, '--existing-tasks', path.join(a, 'tasks.csv')]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /tasks created 0, already existed 47/);
  const lines = fs.readFileSync(path.join(a, 'tasks.csv'), 'utf8').trim().split('\r\n');
  assert.equal(lines.length, 48);
});

test('usage errors exit 1 with a helpful message', () => {
  assert.equal(cli([]).status, 1);
  assert.match(cli(['--input', 'missing.csv']).stderr, /file not found/);
  assert.match(cli([...base, '--out', tmp(), '--today', '2026-02-30']).stderr, /YYYY-MM-DD/);
  assert.match(cli(['--frobnicate']).stderr, /Unknown option/);
  assert.equal(cli(['--help']).status, 0);
});

test('invalid rules file exits 1 and lists problems', () => {
  const dir = tmp();
  const rulesPath = path.join(dir, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify({ version: '1' }));
  const r = cli(['--input', 'sample-data/leads.csv', '--rules', rulesPath, '--out', dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\$\.tasks/);
});

test('input error exits 2, writes run log + summary, removes stale CSVs', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'bad.csv'), 'name,notes\nx,y\n');
  fs.writeFileSync(path.join(dir, 'leads.csv'), 'stale');
  const r = cli(['--input', path.join(dir, 'bad.csv'), '--out', dir, '--today', '2026-10-20']);
  assert.equal(r.status, 2);
  assert.ok(fs.existsSync(path.join(dir, 'run-log.json')));
  assert.equal(fs.existsSync(path.join(dir, 'leads.csv')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'run-log.json'), 'utf8')).fatal.code, 'missing_columns');
});
