// Follow-up task generation and idempotent merging, plus mock messaging (log-only, never sent).

import { addDays } from './dates.js';
import { shortId } from './hash.js';
import { renderTemplate } from './rules.js';

export const TASK_PURPOSE = 'first-follow-up';

/** Deterministic task ID: one first follow-up task per lead, independent of run date and rules. */
export function taskIdFor(recordId) {
  return shortId('T', `${recordId}|${TASK_PURPOSE}`);
}

export function messageIdFor(taskId) {
  return shortId('M', `${taskId}|intro-email`);
}

export function priorityRank(rules, priority) {
  const idx = Object.keys(rules.tasks.priorities).indexOf(priority);
  return idx === -1 ? 999 : idx;
}

/** Build the follow-up task for a categorised lead. */
export function buildTask(lead, rules, { today, runId }) {
  const p = rules.tasks.priorities[lead.priority];
  return {
    task_id: taskIdFor(lead.record_id),
    record_id: lead.record_id,
    lead_name: lead.full_name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    category: lead.category,
    priority: lead.priority,
    task_type: p.taskType,
    due_date: addDays(today, p.dueInDays, rules.tasks.skipWeekends),
    owner: p.owner,
    status: 'open',
    rule_id: lead.rule_id,
    created_in_run: runId,
  };
}

/** Stable sort: due date, then priority rank, then lead name, then task id. */
export function sortTasks(tasks, rules) {
  return [...tasks].sort((a, b) =>
    a.due_date.localeCompare(b.due_date) ||
    priorityRank(rules, a.priority) - priorityRank(rules, b.priority) ||
    a.lead_name.localeCompare(b.lead_name) ||
    a.task_id.localeCompare(b.task_id));
}

/**
 * Insert-if-absent merge keyed by task_id. Existing tasks are never modified (status, due date and owner are
 * preserved), so re-running never duplicates or resets tasks. Returns { tasks, created, existing }.
 */
export function mergeTasks(existingTasks, incomingTasks) {
  const byId = new Map();
  for (const t of existingTasks || []) if (t && t.task_id) byId.set(t.task_id, t);
  const created = [];
  const existing = [];
  for (const t of incomingTasks) {
    if (byId.has(t.task_id)) existing.push(t.task_id);
    else {
      byId.set(t.task_id, t);
      created.push(t.task_id);
    }
  }
  return { tasks: [...byId.values()], created, existing };
}

/**
 * Mock message for a task. Returns { message } or { skip: reason }. Nothing is ever sent: the message object is
 * only logged and written to mock-outbox.csv with status "NOT SENT (mock)".
 */
export function buildMockMessage(task, lead, rules) {
  const m = rules.messaging;
  if (!lead.email) return { skip: 'no email address (phone-only lead)' };
  if (m.requireOptIn && lead.opt_in !== 'yes') return { skip: `opt_in is "${lead.opt_in}" and requireOptIn is true` };
  const tpl = m.templates[lead.category] || m.templates.default;
  const data = { ...lead, owner: task.owner, task_type: task.task_type, due_date: task.due_date };
  return {
    message: {
      message_id: messageIdFor(task.task_id),
      task_id: task.task_id,
      record_id: lead.record_id,
      to: lead.email,
      from: m.from,
      subject: renderTemplate(tpl.subject, data),
      body: renderTemplate(tpl.body, data),
      template: m.templates[lead.category] ? lead.category : 'default',
      status: 'NOT SENT (mock)',
    },
  };
}
