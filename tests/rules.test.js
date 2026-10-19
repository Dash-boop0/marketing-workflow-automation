import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCondition, evaluateWhen, categorise, validateRules, parseRulesText, renderTemplate, describeWhen } from '../src/lib/rules.js';
import { loadRules } from './helpers.js';

const lead = { job_title: 'Director of Digital', company_size: 3500, source: 'LinkedIn', lead_age_days: 20, has_phone: false, email: 'x@example.com', country: 'GB' };

test('operators', () => {
  assert.equal(evaluateCondition(lead, { field: 'source', op: 'equals', value: 'linkedin' }), true); // case-insensitive
  assert.equal(evaluateCondition(lead, { field: 'source', op: 'not_equals', value: 'Website' }), true);
  assert.equal(evaluateCondition(lead, { field: 'country', op: 'in', value: ['US', 'GB'] }), true);
  assert.equal(evaluateCondition(lead, { field: 'country', op: 'not_in', value: ['US'] }), true);
  assert.equal(evaluateCondition(lead, { field: 'job_title', op: 'contains', value: 'digital' }), true);
  assert.equal(evaluateCondition(lead, { field: 'company_size', op: 'gte', value: 3500 }), true);
  assert.equal(evaluateCondition(lead, { field: 'company_size', op: 'gt', value: 3500 }), false);
  assert.equal(evaluateCondition(lead, { field: 'lead_age_days', op: 'lte', value: 30 }), true);
  assert.equal(evaluateCondition(lead, { field: 'lead_age_days', op: 'lt', value: 20 }), false);
  assert.equal(evaluateCondition(lead, { field: 'email', op: 'ends_with', value: '@example.com' }), true);
  assert.equal(evaluateCondition(lead, { field: 'job_title', op: 'starts_with', value: 'dir' }), true);
  assert.equal(evaluateCondition(lead, { field: 'has_phone', op: 'exists' }), false);
  assert.equal(evaluateCondition(lead, { field: 'has_phone', op: 'equals', value: false }), true);
  assert.equal(evaluateCondition(lead, { field: 'notes', op: 'not_exists' }), true);
});

test('missing values never satisfy numeric comparisons', () => {
  assert.equal(evaluateCondition({ company_size: null }, { field: 'company_size', op: 'lt', value: 50 }), false);
  assert.equal(evaluateCondition({ company_size: null }, { field: 'company_size', op: 'gte', value: 0 }), false);
});

test('has_any_word matches whole words/phrases; contains_any matches substrings', () => {
  assert.equal(evaluateCondition({ job_title: 'Director of Digital' }, { field: 'job_title', op: 'has_any_word', value: ['cto'] }), false);
  assert.equal(evaluateCondition({ job_title: 'Director of Digital' }, { field: 'job_title', op: 'contains_any', value: ['cto'] }), true);
  assert.equal(evaluateCondition({ job_title: 'Vice President, Operations' }, { field: 'job_title', op: 'has_any_word', value: ['vice president'] }), true);
  assert.equal(evaluateCondition({ job_title: 'Head of Brand' }, { field: 'job_title', op: 'has_any_word', value: ['head'] }), true);
  assert.equal(evaluateCondition({ job_title: 'Headteacher' }, { field: 'job_title', op: 'has_any_word', value: ['head'] }), false);
});

test('all / any / not groups', () => {
  assert.equal(evaluateWhen(lead, { all: [{ field: 'source', op: 'equals', value: 'LinkedIn' }, { field: 'company_size', op: 'gte', value: 1000 }] }), true);
  assert.equal(evaluateWhen(lead, { any: [{ field: 'source', op: 'equals', value: 'Event' }, { field: 'country', op: 'equals', value: 'GB' }] }), true);
  assert.equal(evaluateWhen(lead, { not: { field: 'country', op: 'equals', value: 'GB' } }), false);
});

test('first matching rule wins, in file order; otherwise default', () => {
  const rules = loadRules();
  assert.deepEqual(categorise({ job_title: 'Marketing Intern', company_size: 5000, source: 'Referral' }, rules), { category: 'Low fit', priority: 'low', ruleId: 'low-fit-student' });
  assert.equal(categorise({ job_title: 'CFO', company_size: 5000, source: 'Referral' }, rules).ruleId, 'referral');
  assert.equal(categorise({ job_title: 'VP Marketing', company_size: 2400, source: 'Website', lead_age_days: 8 }, rules).ruleId, 'enterprise-decision-maker');
  assert.equal(categorise({ job_title: 'Analyst', company_size: 20, source: 'Webinar', lead_age_days: 30 }, rules).ruleId, 'warm-inbound');
  assert.equal(categorise({ job_title: 'Analyst', company_size: 20, source: 'Webinar', lead_age_days: 31 }, rules).ruleId, 'default');
  assert.equal(categorise({ job_title: 'Analyst', company_size: 999, source: 'Paid search' }, rules).ruleId, 'mid-market');
  assert.equal(categorise({ job_title: 'Analyst', company_size: 1000, source: 'Paid search' }, rules).ruleId, 'default');
  const off = structuredClone(rules);
  off.categorisation.rules[0].enabled = false;
  assert.equal(categorise({ job_title: 'Marketing Intern', company_size: 5000, source: 'Referral' }, off).ruleId, 'referral');
});

test('shipped rules file is valid', () => {
  assert.deepEqual(validateRules(loadRules()), []);
});

test('validation reports precise paths', () => {
  const r = loadRules();
  r.categorisation.rules[1].when.any[0].op = 'resembles';
  r.categorisation.rules[2].then.priority = 'urgent';
  r.categorisation.rules[3].id = r.categorisation.rules[0].id;
  r.tasks.priorities.high.dueInDays = -1;
  r.messaging.mode = 'smtp';
  r.messaging.from = 'someone@not-example.test';
  r.messaging.templates.default.subject = 'Hi {{nickname}}';
  const paths = validateRules(r).map((e) => e.path);
  assert.ok(paths.includes('$.categorisation.rules[1].when.any[0].op'));
  assert.ok(paths.includes('$.categorisation.rules[2].then.priority'));
  assert.ok(paths.includes('$.categorisation.rules[3].id'));
  assert.ok(paths.includes('$.tasks.priorities.high.dueInDays'));
  assert.ok(paths.includes('$.messaging.mode'));
  assert.ok(paths.includes('$.messaging.from'));
  assert.ok(paths.includes('$.messaging.templates.default.subject'));
});

test('value types are checked per operator', () => {
  const r = loadRules();
  r.categorisation.rules = [{ id: 'x', when: { all: [{ field: 'company_size', op: 'gte', value: '1000' }, { field: 'source', op: 'in', value: 'Website' }, { field: 'nope', op: 'exists' }] }, then: { category: 'X', priority: 'low' } }];
  const msgs = validateRules(r).map((e) => e.path);
  assert.deepEqual(msgs, ['$.categorisation.rules[0].when.all[0].value', '$.categorisation.rules[0].when.all[1].value', '$.categorisation.rules[0].when.all[2].field']);
});

test('parseRulesText reports JSON syntax errors', () => {
  const { rules, errors } = parseRulesText('{ "version": ');
  assert.equal(rules, null);
  assert.match(errors[0].message, /Invalid JSON/);
});

test('template rendering with fallbacks', () => {
  assert.equal(renderTemplate('Hi {{first_name|there}} at {{company}}', { first_name: '', company: 'Acme' }), 'Hi there at Acme');
  assert.equal(renderTemplate('Hi {{ first_name }}', { first_name: 'Ava' }), 'Hi Ava');
});

test('describeWhen renders plain English', () => {
  assert.equal(describeWhen({ all: [{ field: 'company_size', op: 'gte', value: 1000 }, { any: [{ field: 'source', op: 'equals', value: 'Event' }, { field: 'notes', op: 'exists' }] }] }),
    'company_size ≥ 1000 AND (source equals Event OR notes is present)');
});
