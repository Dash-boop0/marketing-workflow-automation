import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTask, mergeTasks, sortTasks, buildMockMessage, taskIdFor, messageIdFor } from '../src/lib/tasks.js';
import { loadRules } from './helpers.js';

const rules = loadRules();
const lead = (p = {}) => ({ record_id: 'L-abc', full_name: 'Ava Patel', first_name: 'Ava', company: 'Northbridge (synthetic)', email: 'ava@example.com', phone: '', category: 'Warm inbound', priority: 'medium', rule_id: 'warm-inbound', opt_in: 'yes', ...p });

test('due dates follow priority offsets and skip weekends (run date Tue 2026-10-20)', () => {
  assert.equal(buildTask(lead({ priority: 'high' }), rules, { today: '2026-10-20', runId: 'R-1' }).due_date, '2026-10-21');
  assert.equal(buildTask(lead({ priority: 'medium' }), rules, { today: '2026-10-20', runId: 'R-1' }).due_date, '2026-10-23');
  assert.equal(buildTask(lead({ priority: 'low' }), rules, { today: '2026-10-20', runId: 'R-1' }).due_date, '2026-10-29');
  assert.equal(buildTask(lead({ priority: 'high' }), rules, { today: '2026-10-23', runId: 'R-1' }).due_date, '2026-10-26');
  const noSkip = structuredClone(rules);
  noSkip.tasks.skipWeekends = false;
  assert.equal(buildTask(lead({ priority: 'high' }), noSkip, { today: '2026-10-23', runId: 'R-1' }).due_date, '2026-10-24');
});

test('task fields come from the priority config', () => {
  const t = buildTask(lead({ priority: 'high' }), rules, { today: '2026-10-20', runId: 'R-1' });
  assert.equal(t.task_type, 'Call');
  assert.equal(t.owner, 'SDR queue (synthetic)');
  assert.equal(t.status, 'open');
  assert.equal(t.task_id, taskIdFor('L-abc'));
});

test('task ID depends only on the lead, not on run date or priority', () => {
  const a = buildTask(lead({ priority: 'high' }), rules, { today: '2026-10-20', runId: 'R-1' });
  const b = buildTask(lead({ priority: 'low' }), rules, { today: '2026-12-01', runId: 'R-2' });
  assert.equal(a.task_id, b.task_id);
  assert.notEqual(taskIdFor('L-abc'), taskIdFor('L-abd'));
});

test('mergeTasks inserts only new IDs and never modifies existing tasks', () => {
  const existing = [{ task_id: 'T-1', status: 'done', due_date: '2026-10-01' }];
  const incoming = [{ task_id: 'T-1', status: 'open', due_date: '2026-10-21' }, { task_id: 'T-2', status: 'open', due_date: '2026-10-21' }];
  const r = mergeTasks(existing, incoming);
  assert.deepEqual(r.created, ['T-2']);
  assert.deepEqual(r.existing, ['T-1']);
  assert.equal(r.tasks.length, 2);
  assert.equal(r.tasks.find((t) => t.task_id === 'T-1').status, 'done');
  const again = mergeTasks(r.tasks, incoming);
  assert.equal(again.tasks.length, 2);
  assert.deepEqual(again.created, []);
});

test('sortTasks orders by due date, priority rank, name, id', () => {
  const ts = [
    { task_id: 'b', due_date: '2026-10-23', priority: 'medium', lead_name: 'B' },
    { task_id: 'a', due_date: '2026-10-21', priority: 'high', lead_name: 'Z' },
    { task_id: 'c', due_date: '2026-10-23', priority: 'high', lead_name: 'C' },
    { task_id: 'd', due_date: '2026-10-23', priority: 'medium', lead_name: 'A' },
  ];
  assert.deepEqual(sortTasks(ts, rules).map((t) => t.task_id), ['a', 'c', 'd', 'b']);
});

test('mock message: uses category template, falls back to default, never "sent"', () => {
  const t = buildTask(lead({ category: 'Event follow-up' }), rules, { today: '2026-10-20', runId: 'R' });
  const m = buildMockMessage(t, lead({ category: 'Event follow-up' }), rules).message;
  assert.equal(m.template, 'Event follow-up');
  assert.equal(m.subject, 'Great to meet you at the event, Ava');
  assert.equal(m.status, 'NOT SENT (mock)');
  assert.equal(m.message_id, messageIdFor(t.task_id));
  const d = buildMockMessage(t, lead({ category: 'Warm inbound', first_name: '' }), rules).message;
  assert.equal(d.template, 'default');
  assert.equal(d.subject, 'Thanks for your interest, there');
});

test('mock message skip reasons', () => {
  const t = buildTask(lead(), rules, { today: '2026-10-20', runId: 'R' });
  assert.match(buildMockMessage(t, lead({ email: '' }), rules).skip, /no email/);
  assert.match(buildMockMessage(t, lead({ opt_in: 'no' }), rules).skip, /opt_in is "no"/);
  assert.match(buildMockMessage(t, lead({ opt_in: 'unknown' }), rules).skip, /unknown/);
  const relaxed = structuredClone(rules);
  relaxed.messaging.requireOptIn = false;
  assert.ok(buildMockMessage(t, lead({ opt_in: 'unknown' }), relaxed).message);
});
