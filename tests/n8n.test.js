import test from 'node:test';
import assert from 'node:assert/strict';
import { read, loadRules, sampleCsv } from './helpers.js';
import { buildWorkflow } from '../scripts/build-n8n.js';
import { runPipeline } from '../src/lib/pipeline.js';

// These tests check the workflow JSON structure and execute the Code node's JavaScript in Node with a mocked
// $input / $() API. They do NOT run n8n itself; see n8n/README.md.

const wf = JSON.parse(read('n8n/marketing-workflow.json'));
const ALLOWED_TYPES = new Set([
  'n8n-nodes-base.manualTrigger', 'n8n-nodes-base.set', 'n8n-nodes-base.readWriteFile', 'n8n-nodes-base.extractFromFile',
  'n8n-nodes-base.code', 'n8n-nodes-base.switch', 'n8n-nodes-base.if', 'n8n-nodes-base.convertToFile',
  'n8n-nodes-base.stopAndError', 'n8n-nodes-base.noOp',
]);

test('committed workflow JSON is up to date with src/lib and config/rules.json', () => {
  assert.deepEqual(wf, JSON.parse(JSON.stringify(buildWorkflow())), 'run: npm run build:n8n');
});

test('workflow has the n8n import structure', () => {
  assert.equal(typeof wf.name, 'string');
  assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > 0);
  assert.equal(typeof wf.connections, 'object');
  const names = new Set();
  const ids = new Set();
  for (const n of wf.nodes) {
    assert.equal(typeof n.id, 'string');
    assert.ok(!ids.has(n.id), `duplicate id ${n.id}`);
    ids.add(n.id);
    assert.ok(!names.has(n.name), `duplicate name ${n.name}`);
    names.add(n.name);
    assert.ok(ALLOWED_TYPES.has(n.type), `non-core or unexpected node type ${n.type}`);
    assert.equal(typeof n.typeVersion, 'number');
    assert.ok(Array.isArray(n.position) && n.position.length === 2 && n.position.every(Number.isFinite));
    assert.equal(typeof n.parameters, 'object');
    assert.equal('credentials' in n, false, `${n.name} must not use credentials`);
  }
  for (const [from, conn] of Object.entries(wf.connections)) {
    assert.ok(names.has(from), `connection from unknown node ${from}`);
    for (const outputs of conn.main) for (const c of outputs) {
      assert.ok(names.has(c.node), `connection to unknown node ${c.node}`);
      assert.equal(c.type, 'main');
    }
  }
});

test('every node is reachable from the Manual Trigger; no network or email nodes', () => {
  const seen = new Set(['Manual Trigger']);
  const queue = ['Manual Trigger'];
  while (queue.length) {
    const n = queue.shift();
    for (const outs of wf.connections[n]?.main ?? []) for (const c of outs) if (!seen.has(c.node)) { seen.add(c.node); queue.push(c.node); }
  }
  assert.equal(seen.size, wf.nodes.length);
  const text = JSON.stringify(wf);
  assert.doesNotMatch(text, /httpRequest|emailSend|gmail|smtp|webhook/i);
  const sw = wf.nodes.find((n) => n.type === 'n8n-nodes-base.switch');
  assert.equal(sw.parameters.rules.values.length, wf.connections[sw.name].main.length);
});

test('Code node JavaScript runs (mocked n8n API) and matches the library output', async () => {
  const code = wf.nodes.find((n) => n.type === 'n8n-nodes-base.code').parameters.jsCode;
  const cfgNode = wf.nodes.find((n) => n.name === 'Config');
  const rulesJson = cfgNode.parameters.assignments.assignments.find((a) => a.name === 'rulesJson').value;
  const cfg = { inputPath: '/home/node/mwa/leads.csv', outputDir: '/tmp', runDate: '2026-10-20', rulesJson };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const fn = new AsyncFunction('$input', '$', code);
  const items = await fn({ first: () => ({ json: { data: sampleCsv() } }) }, (name) => {
    assert.equal(name, 'Config');
    return { first: () => ({ json: cfg }) };
  });
  const files = Object.fromEntries(items.filter((i) => i.json._kind === 'file').map((i) => [i.json.fileName, i.json.content]));
  const expected = runPipeline({ csvText: sampleCsv(), rules: loadRules(), today: '2026-10-20', inputName: 'leads.csv' }).outputs;
  for (const f of ['leads.csv', 'rejected.csv', 'tasks.csv', 'mock-outbox.csv']) assert.equal(files[f], expected[f], f);
  assert.ok(files['run-log.json'] && files['summary.md']);
  assert.equal(items.filter((i) => i.json._kind === 'mock_message').length, 40);
  assert.ok(items.filter((i) => i.json._kind === 'mock_message').every((i) => i.json.status === 'NOT SENT (mock)'));
});

test('Code node reports a stopped run for bad input', async () => {
  const code = wf.nodes.find((n) => n.type === 'n8n-nodes-base.code').parameters.jsCode;
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const items = await new AsyncFunction('$input', '$', code)(
    { first: () => ({ json: { data: 'name\nx\n' } }) },
    () => ({ first: () => ({ json: { inputPath: 'x.csv', runDate: '2026-10-20', rulesJson: read('config/rules.json') } }) }),
  );
  assert.ok(items.some((i) => i.json._kind === 'run_stopped' && /missing_columns/.test(i.json.message)));
});
