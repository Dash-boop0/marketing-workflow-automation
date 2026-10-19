// Configurable categorisation rules (config/rules.json): ordered conditions -> category + priority, first match wins.
// Also validates the whole rules file (categorisation, task settings, mock messaging) with path-specific errors.

export const RULE_FIELDS = [
  'first_name', 'last_name', 'full_name', 'email', 'email_domain', 'phone', 'company', 'job_title',
  'company_size', 'country', 'source', 'created_at', 'opt_in', 'notes', 'has_email', 'has_phone', 'lead_age_days',
];

export const OPERATORS = {
  equals: { value: 'scalar', text: 'equals' },
  not_equals: { value: 'scalar', text: 'does not equal' },
  in: { value: 'array', text: 'is one of' },
  not_in: { value: 'array', text: 'is not one of' },
  contains: { value: 'string', text: 'contains' },
  contains_any: { value: 'array', text: 'contains any of' },
  has_any_word: { value: 'array', text: 'has any of the words' },
  starts_with: { value: 'string', text: 'starts with' },
  ends_with: { value: 'string', text: 'ends with' },
  gt: { value: 'number', text: '>' },
  gte: { value: 'number', text: '≥' },
  lt: { value: 'number', text: '<' },
  lte: { value: 'number', text: '≤' },
  exists: { value: 'none', text: 'is present' },
  not_exists: { value: 'none', text: 'is empty' },
};

function present(v) {
  return !(v === null || v === undefined || v === '' || v === false);
}

function str(v) {
  return v === null || v === undefined ? '' : String(v).toLowerCase().trim();
}

function words(v) {
  return str(v).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function hasPhrase(tokens, phrase) {
  const p = words(phrase);
  if (!p.length) return false;
  for (let i = 0; i + p.length <= tokens.length; i++) {
    if (p.every((w, j) => tokens[i + j] === w)) return true;
  }
  return false;
}

function num(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Evaluate a single condition { field, op, value } against a record. Missing values never satisfy numeric ops. */
export function evaluateCondition(record, cond) {
  const v = record[cond.field];
  switch (cond.op) {
    case 'equals': return str(v) === str(cond.value);
    case 'not_equals': return str(v) !== str(cond.value);
    case 'in': return cond.value.some((x) => str(x) === str(v));
    case 'not_in': return !cond.value.some((x) => str(x) === str(v));
    case 'contains': return present(v) && str(v).includes(str(cond.value));
    case 'contains_any': return present(v) && cond.value.some((x) => str(x) && str(v).includes(str(x)));
    case 'has_any_word': { const t = words(v); return cond.value.some((x) => hasPhrase(t, x)); }
    case 'starts_with': return present(v) && str(v).startsWith(str(cond.value));
    case 'ends_with': return present(v) && str(v).endsWith(str(cond.value));
    case 'gt': case 'gte': case 'lt': case 'lte': {
      const a = num(v);
      const b = num(cond.value);
      if (a === null || b === null) return false;
      return cond.op === 'gt' ? a > b : cond.op === 'gte' ? a >= b : cond.op === 'lt' ? a < b : a <= b;
    }
    case 'exists': return present(v);
    case 'not_exists': return !present(v);
    default: throw new Error(`Unknown operator "${cond.op}"`);
  }
}

/** Evaluate a condition tree: { all: [...] } | { any: [...] } | { not: node } | condition. */
export function evaluateWhen(record, node) {
  if (node.all) return node.all.every((n) => evaluateWhen(record, n));
  if (node.any) return node.any.some((n) => evaluateWhen(record, n));
  if (node.not) return !evaluateWhen(record, node.not);
  return evaluateCondition(record, node);
}

/** First matching rule wins; otherwise the default category/priority. */
export function categorise(record, rules) {
  const cat = rules.categorisation;
  for (const rule of cat.rules) {
    if (rule.enabled === false) continue;
    if (evaluateWhen(record, rule.when)) {
      return { category: rule.then.category, priority: rule.then.priority, ruleId: rule.id };
    }
  }
  return { category: cat.defaultCategory, priority: cat.defaultPriority, ruleId: 'default' };
}

export function describeWhen(node) {
  if (node.all) return node.all.map(describeWhen).join(' AND ');
  if (node.any) return '(' + node.any.map(describeWhen).join(' OR ') + ')';
  if (node.not) return 'NOT (' + describeWhen(node.not) + ')';
  const op = OPERATORS[node.op];
  if (!op) return `${node.field} ${node.op} ?`;
  if (op.value === 'none') return `${node.field} ${op.text}`;
  const val = Array.isArray(node.value) ? node.value.join(', ') : String(node.value);
  return `${node.field} ${op.text} ${val}`;
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g;
const TEMPLATE_FIELDS = [...RULE_FIELDS, 'category', 'priority', 'owner', 'task_type', 'due_date'];

function isObj(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function validateNode(node, path, errors, depth) {
  if (depth > 6) { errors.push({ path, message: 'Conditions are nested too deeply (max 6 levels).' }); return; }
  if (!isObj(node)) { errors.push({ path, message: 'Must be an object: a condition {field, op, value} or a group {all|any|not}.' }); return; }
  const groupKeys = ['all', 'any', 'not'].filter((k) => k in node);
  if (groupKeys.length > 1) { errors.push({ path, message: 'Use only one of "all", "any" or "not" per group.' }); return; }
  if (groupKeys.length === 1) {
    const k = groupKeys[0];
    if (k === 'not') return validateNode(node.not, `${path}.not`, errors, depth + 1);
    if (!Array.isArray(node[k]) || node[k].length === 0) { errors.push({ path: `${path}.${k}`, message: 'Must be a non-empty array of conditions.' }); return; }
    node[k].forEach((n, i) => validateNode(n, `${path}.${k}[${i}]`, errors, depth + 1));
    return;
  }
  if (!RULE_FIELDS.includes(node.field)) errors.push({ path: `${path}.field`, message: `Unknown field "${node.field}". Allowed: ${RULE_FIELDS.join(', ')}.` });
  const op = OPERATORS[node.op];
  if (!op) { errors.push({ path: `${path}.op`, message: `Unknown operator "${node.op}". Allowed: ${Object.keys(OPERATORS).join(', ')}.` }); return; }
  const v = node.value;
  if (op.value === 'array' && (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean'))) {
    errors.push({ path: `${path}.value`, message: `Operator "${node.op}" needs a non-empty array of values.` });
  }
  if (op.value === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) errors.push({ path: `${path}.value`, message: `Operator "${node.op}" needs a number.` });
  if (op.value === 'string' && (typeof v !== 'string' || !v.trim())) errors.push({ path: `${path}.value`, message: `Operator "${node.op}" needs a non-empty string.` });
  if (op.value === 'scalar' && !['string', 'number', 'boolean'].includes(typeof v)) errors.push({ path: `${path}.value`, message: `Operator "${node.op}" needs a string, number or boolean.` });
}

function validateTemplate(t, path, errors) {
  if (!isObj(t)) { errors.push({ path, message: 'Template must be an object with "subject" and "body".' }); return; }
  for (const k of ['subject', 'body']) {
    if (typeof t[k] !== 'string' || !t[k].trim()) { errors.push({ path: `${path}.${k}`, message: 'Must be a non-empty string.' }); continue; }
    for (const m of t[k].matchAll(PLACEHOLDER)) {
      if (!TEMPLATE_FIELDS.includes(m[1])) errors.push({ path: `${path}.${k}`, message: `Unknown placeholder {{${m[1]}}}.` });
    }
  }
}

/** Validate a parsed rules object. Returns [] when valid, otherwise [{ path, message }]. */
export function validateRules(rules) {
  const errors = [];
  if (!isObj(rules)) return [{ path: '$', message: 'Rules must be a JSON object.' }];
  if (typeof rules.version !== 'string' || !rules.version.trim()) errors.push({ path: '$.version', message: 'Required: a version string (e.g. "1.0").' });

  const tasks = rules.tasks;
  let priorityNames = [];
  if (!isObj(tasks)) errors.push({ path: '$.tasks', message: 'Required: an object with "skipWeekends" and "priorities".' });
  else {
    if (typeof tasks.skipWeekends !== 'boolean') errors.push({ path: '$.tasks.skipWeekends', message: 'Must be true or false.' });
    if (!isObj(tasks.priorities) || !Object.keys(tasks.priorities).length) errors.push({ path: '$.tasks.priorities', message: 'Required: at least one priority, e.g. {"high": {...}}.' });
    else {
      priorityNames = Object.keys(tasks.priorities);
      for (const [name, p] of Object.entries(tasks.priorities)) {
        const base = `$.tasks.priorities.${name}`;
        if (!isObj(p)) { errors.push({ path: base, message: 'Must be an object.' }); continue; }
        if (!Number.isInteger(p.dueInDays) || p.dueInDays < 0 || p.dueInDays > 365) errors.push({ path: `${base}.dueInDays`, message: 'Must be a whole number from 0 to 365.' });
        if (typeof p.taskType !== 'string' || !p.taskType.trim()) errors.push({ path: `${base}.taskType`, message: 'Must be a non-empty string.' });
        if (typeof p.owner !== 'string' || !p.owner.trim()) errors.push({ path: `${base}.owner`, message: 'Must be a non-empty string.' });
      }
    }
  }

  const cat = rules.categorisation;
  if (!isObj(cat)) errors.push({ path: '$.categorisation', message: 'Required: an object with defaultCategory, defaultPriority and rules.' });
  else {
    if (typeof cat.defaultCategory !== 'string' || !cat.defaultCategory.trim()) errors.push({ path: '$.categorisation.defaultCategory', message: 'Must be a non-empty string.' });
    if (priorityNames.length && !priorityNames.includes(cat.defaultPriority)) errors.push({ path: '$.categorisation.defaultPriority', message: `Must be one of: ${priorityNames.join(', ')}.` });
    if (!Array.isArray(cat.rules)) errors.push({ path: '$.categorisation.rules', message: 'Must be an array (it may be empty).' });
    else {
      const ids = new Set();
      cat.rules.forEach((r, i) => {
        const base = `$.categorisation.rules[${i}]`;
        if (!isObj(r)) { errors.push({ path: base, message: 'Must be an object.' }); return; }
        if (typeof r.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(r.id)) errors.push({ path: `${base}.id`, message: 'Required: lowercase id using letters, digits and hyphens.' });
        else if (ids.has(r.id)) errors.push({ path: `${base}.id`, message: `Duplicate rule id "${r.id}".` });
        else if (r.id === 'default') errors.push({ path: `${base}.id`, message: '"default" is reserved.' });
        ids.add(r.id);
        if ('enabled' in r && typeof r.enabled !== 'boolean') errors.push({ path: `${base}.enabled`, message: 'Must be true or false.' });
        validateNode(r.when, `${base}.when`, errors, 0);
        if (!isObj(r.then)) errors.push({ path: `${base}.then`, message: 'Required: {"category": "...", "priority": "..."}.' });
        else {
          if (typeof r.then.category !== 'string' || !r.then.category.trim()) errors.push({ path: `${base}.then.category`, message: 'Must be a non-empty string.' });
          if (priorityNames.length && !priorityNames.includes(r.then.priority)) errors.push({ path: `${base}.then.priority`, message: `Must be one of: ${priorityNames.join(', ')}.` });
        }
      });
    }
  }

  const msg = rules.messaging;
  if (!isObj(msg)) errors.push({ path: '$.messaging', message: 'Required: an object with mode "mock", requireOptIn, from and templates.' });
  else {
    if (msg.mode !== 'mock') errors.push({ path: '$.messaging.mode', message: 'Must be "mock". This tool never sends messages; it only logs what would be sent.' });
    if (typeof msg.requireOptIn !== 'boolean') errors.push({ path: '$.messaging.requireOptIn', message: 'Must be true or false.' });
    if (typeof msg.from !== 'string' || !/^[^@\s]+@example\.(com|org|net)$/.test(msg.from)) errors.push({ path: '$.messaging.from', message: 'Must be an address on example.com, example.org or example.net (mock only).' });
    if (!isObj(msg.templates) || !isObj(msg.templates.default)) errors.push({ path: '$.messaging.templates.default', message: 'Required: a default template {subject, body}.' });
    else for (const [k, t] of Object.entries(msg.templates)) validateTemplate(t, `$.messaging.templates.${k}`, errors);
  }
  return errors;
}

/** Parse JSON text and validate. Returns { rules, errors }. */
export function parseRulesText(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { rules: null, errors: [{ path: '$', message: `Invalid JSON: ${e.message}` }] };
  }
  const errors = validateRules(obj);
  return { rules: errors.length ? null : obj, errors };
}

/** Render {{field}} / {{field|fallback}} placeholders. */
export function renderTemplate(text, data) {
  return text.replace(PLACEHOLDER, (m, field, fallback) => {
    const v = data[field];
    return v === null || v === undefined || v === '' ? (fallback ?? '').trim() : String(v);
  });
}
