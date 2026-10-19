// UI layer. All processing lives in src/lib (shared with the CLI and the n8n Code node).
import { runPipeline, PIPELINE_STEPS } from './lib/pipeline.js';
import { parseCsv, serializeCsv } from './lib/csv.js';
import { parseRulesText, describeWhen } from './lib/rules.js';
import { VALIDATION_RULES, LEAD_COLUMNS } from './lib/validate.js';
import { localIsoDate, isIsoDate } from './lib/dates.js';
import { leadsToCsv, rejectedToCsv, tasksToCsv, outboxToCsv, buildRunLog, buildSummary, formatPct } from './lib/outputs.js';

const STORE_KEY = 'mwa:v1';
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
const PRIORITY_COLORS = ['var(--s4)', 'var(--s2)', 'var(--s1)', 'var(--s3)', 'var(--s5)', 'var(--s6)'];

const state = {
  csvText: '',
  inputName: '',
  rulesText: '',
  runDate: localIsoDate(),
  useStore: true,
  taskStore: {}, // task_id -> task (status persisted)
  last: null, // last pipeline result (without file strings)
  tab: 'input',
  sub: 'overview',
  filters: { logStep: '', logResult: '', logQ: '', leadCat: '', leadPri: '', leadQ: '', taskPri: '', taskStatus: '', taskQ: '' },
};

// ---------------------------------------------------------------- persistence
function save() {
  try {
    const { csvText, inputName, rulesText, runDate, useStore, taskStore, last } = state;
    localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, csvText, inputName, rulesText, runDate, useStore, taskStore, last }));
  } catch (e) {
    setStatus('data-status', `Could not save to this browser (${e.name}). Use "Back up data" to keep a copy.`, 'warn');
  }
}

function validBackup(obj) {
  return obj && obj.version === 1 && typeof obj.csvText === 'string' && typeof obj.rulesText === 'string' &&
    (obj.taskStore === undefined || (typeof obj.taskStore === 'object' && !Array.isArray(obj.taskStore)));
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!validBackup(obj)) return false;
    applyBackup(obj);
    return true;
  } catch {
    return false;
  }
}

function applyBackup(obj) {
  state.csvText = obj.csvText;
  state.inputName = obj.inputName || 'restored.csv';
  state.rulesText = obj.rulesText;
  state.runDate = isIsoDate(obj.runDate) ? obj.runDate : localIsoDate();
  state.useStore = obj.useStore !== false;
  state.taskStore = obj.taskStore || {};
  state.last = obj.last && obj.last.counts ? obj.last : null;
}

// ---------------------------------------------------------------- helpers
function setStatus(id, text, kind = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${kind}`;
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function fetchText(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.text();
}

const badge = (text, kind = text) => `<span class="badge ${esc(kind)}">${esc(text)}</span>`;

function currentRules() {
  return parseRulesText(state.rulesText);
}

// ---------------------------------------------------------------- tabs
const TABS = ['input', 'rules', 'results', 'help'];
function showTab(name, focus = false) {
  state.tab = name;
  for (const t of TABS) {
    const btn = $(`tab-${t}`);
    const on = t === name;
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
    if (on && focus) btn.focus();
  }
  if (name === 'results') renderResults();
  if (name === 'rules') renderRules();
}

function initTabs() {
  for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => showTab(t));
  document.querySelector('.tabs').addEventListener('keydown', (e) => {
    const i = TABS.indexOf(state.tab);
    if (e.key === 'ArrowRight') showTab(TABS[(i + 1) % TABS.length], true);
    else if (e.key === 'ArrowLeft') showTab(TABS[(i + TABS.length - 1) % TABS.length], true);
    else return;
    e.preventDefault();
  });
}

// ---------------------------------------------------------------- input
function renderInput() {
  $('csv-text').value = state.csvText;
  $('run-date').value = state.runDate;
  $('use-store').checked = state.useStore;
  const { rules, errors } = currentRules();
  $('skip-weekends').checked = rules ? rules.tasks.skipWeekends : false;
  $('skip-weekends').disabled = !rules;
  $('rules-state').innerHTML = rules
    ? `${badge('valid', 'ok')} Rules version ${esc(rules.version)}: ${rules.categorisation.rules.length} categorisation rule(s). <a href="#" id="go-rules">Edit rules</a>`
    : `${badge('invalid', 'reject')} Rules have ${errors.length} problem(s); fix them in the <a href="#" id="go-rules">Rules tab</a> before running.`;
  $('go-rules').addEventListener('click', (e) => { e.preventDefault(); showTab('rules', true); });
  $('btn-run').disabled = !rules || !state.csvText.trim();
  renderPreview();
}

function renderPreview() {
  const box = $('preview');
  if (!state.csvText.trim()) {
    $('csv-meta').textContent = '';
    box.innerHTML = '<div class="empty"><strong>No leads loaded yet.</strong>Load the sample leads, choose a CSV file or paste CSV text above.</div>';
    return;
  }
  let rows;
  try {
    rows = parseCsv(state.csvText);
  } catch (e) {
    $('csv-meta').textContent = '';
    box.innerHTML = `<div class="error-box"><strong>The CSV cannot be read.</strong> ${esc(e.message)}</div>`;
    return;
  }
  const dataRows = rows.slice(1).filter((r) => r.some((v) => v.trim()));
  $('csv-meta').textContent = `${state.inputName || 'pasted text'} · ${dataRows.length} data row(s) · ${rows[0]?.length ?? 0} column(s)`;
  const head = rows[0] || [];
  const body = rows.slice(1, 9);
  box.innerHTML = `<p class="small muted">First ${body.length} row(s) as read, before any cleaning:</p><div class="table-wrap"><table><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${
    body.map((r) => `<tr>${head.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function setCsv(text, name) {
  state.csvText = text;
  state.inputName = name;
  save();
  renderInput();
}

function initInput() {
  $('btn-sample').addEventListener('click', async () => {
    try {
      setCsv(await fetchText('sample-data/leads.csv'), 'leads.csv (synthetic sample)');
      setStatus('run-status', 'Sample leads loaded (61 data rows incl. deliberate errors and duplicates, plus 1 blank row). Press "Run workflow".', 'ok');
    } catch (e) {
      setStatus('run-status', `Could not load the sample (${e.message}). Serve the folder with a local web server, see README.`, 'err');
    }
  });
  $('file-csv').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setStatus('run-status', `${f.name} is larger than 5 MB; use the command-line workflow for big files.`, 'err');
      return;
    }
    setCsv(await f.text(), f.name);
    setStatus('run-status', `Loaded ${f.name}.`, 'ok');
    e.target.value = '';
  });
  let t;
  $('csv-text').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.csvText = e.target.value;
      state.inputName = 'pasted text';
      save();
      renderPreview();
      $('btn-run').disabled = !currentRules().rules || !state.csvText.trim();
    }, 250);
  });
  $('btn-template').addEventListener('click', () => download('leads-template.csv', serializeCsv([LEAD_COLUMNS]), 'text/csv'));
  $('run-date').addEventListener('change', (e) => {
    if (isIsoDate(e.target.value)) {
      state.runDate = e.target.value;
      save();
    } else setStatus('run-status', 'Run date must be a valid date.', 'err');
  });
  $('use-store').addEventListener('change', (e) => { state.useStore = e.target.checked; save(); });
  $('skip-weekends').addEventListener('change', (e) => {
    const { rules } = currentRules();
    if (!rules) return;
    rules.tasks.skipWeekends = e.target.checked;
    state.rulesText = JSON.stringify(rules, null, 2) + '\n';
    $('rules-text').value = state.rulesText; // keep the editor in sync so a pending debounced edit cannot revert this
    save();
    setStatus('run-status', `Rules updated: skipWeekends = ${e.target.checked}. Run again to apply.`, 'ok');
  });
  $('btn-run').addEventListener('click', runNow);
}

function runNow() {
  const { rules, errors } = currentRules();
  if (!rules) {
    setStatus('run-status', `Rules are invalid (${errors.length} problem(s)). Fix them in the Rules tab.`, 'err');
    return;
  }
  if (!state.csvText.trim()) {
    setStatus('run-status', 'Load or paste a CSV first.', 'err');
    return;
  }
  const existing = state.useStore ? Object.values(state.taskStore) : [];
  const result = runPipeline({ csvText: state.csvText, rules, today: state.runDate, inputName: state.inputName || 'input.csv', existingTasks: existing });
  delete result.outputs;
  state.last = result;
  if (!result.fatal) {
    if (!state.useStore) state.taskStore = {};
    for (const t of result.tasks) if (!state.taskStore[t.task_id]) state.taskStore[t.task_id] = t;
  }
  save();
  if (result.fatal) {
    setStatus('run-status', `Run stopped: ${result.fatal.message}`, 'err');
  } else {
    const c = result.counts;
    setStatus('run-status', `Done: ${c.uniqueLeads} clean leads, ${c.tasksCreated} new task(s), ${c.tasksAlreadyExisted} already existed, ${c.messagesMocked} mock message(s) (not sent).`, 'ok');
  }
  state.sub = 'overview';
  showTab('results', true);
}

// ---------------------------------------------------------------- data backup
function initData() {
  $('btn-backup').addEventListener('click', () => {
    const { csvText, inputName, rulesText, runDate, useStore, taskStore, last } = state;
    download(`mwa-backup-${localIsoDate()}.json`, JSON.stringify({ version: 1, app: 'marketing-workflow-automation', csvText, inputName, rulesText, runDate, useStore, taskStore, last }, null, 2), 'application/json');
    setStatus('data-status', 'Backup downloaded.', 'ok');
  });
  $('file-restore').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (!validBackup(obj)) throw new Error('this is not a backup made by this app (expected version 1 with csvText and rulesText)');
      applyBackup(obj);
      save();
      renderInput();
      setStatus('data-status', `Restored ${f.name}.`, 'ok');
    } catch (err) {
      setStatus('data-status', `Restore failed: ${err.message}. Nothing was changed.`, 'err');
    }
  });
  $('btn-reset').addEventListener('click', async () => {
    if (!confirm('Reset everything? This clears the loaded CSV, your rule edits, the task board and the last run from this browser.')) return;
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    Object.assign(state, { csvText: '', inputName: '', taskStore: {}, last: null, runDate: localIsoDate(), useStore: true });
    await loadDefaultRules();
    save();
    renderInput();
    setStatus('data-status', 'Reset complete. Default rules restored.', 'ok');
  });
}

// ---------------------------------------------------------------- rules editor
async function loadDefaultRules() {
  try {
    state.rulesText = await fetchText('config/rules.json');
  } catch (e) {
    state.rulesText = state.rulesText || '';
    setStatus('run-status', `Could not load config/rules.json (${e.message}). Serve the folder with a local web server, see README.`, 'err');
  }
}

function renderRules() {
  const ta = $('rules-text');
  if (document.activeElement !== ta) ta.value = state.rulesText;
  renderRulesCheck();
}

function renderRulesCheck() {
  const { rules, errors } = currentRules();
  $('rules-errors').innerHTML = rules
    ? '<div class="ok-box">Rules are valid and will be used for the next run.</div>'
    : `<div class="error-box"><strong>${errors.length} problem(s) found.</strong> The workflow will not run until they are fixed.</div><ul class="errlist" style="margin-top:8px">${
      errors.map((e) => `<li><code>${esc(e.path)}</code> ${esc(e.message)}</li>`).join('')}</ul>`;
  const box = $('rules-readable');
  if (!rules) {
    box.innerHTML = '<p class="muted small">Fix the problems to see the rules summarised here.</p>';
    return;
  }
  const pr = Object.entries(rules.tasks.priorities);
  box.innerHTML = `<div class="table-wrap"><table><thead><tr><th scope="col">#</th><th scope="col">Rule</th><th scope="col">When</th><th scope="col">Category</th><th scope="col">Priority</th></tr></thead><tbody>${
    rules.categorisation.rules.map((r, i) => `<tr${r.enabled === false ? ' class="muted"' : ''}><td class="num">${i + 1}</td><td class="nowrap"><code>${esc(r.id)}</code>${r.enabled === false ? ' (disabled)' : ''}</td><td class="wrap">${esc(describeWhen(r.when))}</td><td>${esc(r.then.category)}</td><td>${badge(r.then.priority)}</td></tr>`).join('')
  }<tr><td class="num">–</td><td><code>default</code></td><td>no rule matched</td><td>${esc(rules.categorisation.defaultCategory)}</td><td>${badge(rules.categorisation.defaultPriority)}</td></tr></tbody></table></div>
  <h3 style="margin-top:14px">Follow-up tasks</h3>
  <div class="table-wrap"><table><thead><tr><th scope="col">Priority</th><th scope="col" class="num">Due in</th><th scope="col">Task</th><th scope="col">Owner</th></tr></thead><tbody>${
    pr.map(([k, p]) => `<tr><td>${badge(k)}</td><td class="num">${p.dueInDays} ${rules.tasks.skipWeekends ? 'business' : 'calendar'} day(s)</td><td>${esc(p.taskType)}</td><td>${esc(p.owner)}</td></tr>`).join('')}</tbody></table></div>
  <h3 style="margin-top:14px">Mock messaging</h3>
  <p class="small">Mode <code>${esc(rules.messaging.mode)}</code> (never sends). ${rules.messaging.requireOptIn ? 'Only leads with opt_in = yes get a mock email.' : 'Opt-in is not required (still mock only).'} Templates: ${Object.keys(rules.messaging.templates).map((k) => `<code>${esc(k)}</code>`).join(', ')}.</p>`;
}

function initRules() {
  let t;
  $('rules-text').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.rulesText = e.target.value;
      save();
      renderRulesCheck();
      renderInput();
    }, 300);
  });
  $('btn-format').addEventListener('click', () => {
    try {
      state.rulesText = JSON.stringify(JSON.parse($('rules-text').value), null, 2) + '\n';
      $('rules-text').value = state.rulesText;
      save();
      renderRulesCheck();
    } catch (e) {
      $('rules-errors').innerHTML = `<div class="error-box">Cannot format: ${esc(e.message)}</div>`;
    }
  });
  $('btn-default-rules').addEventListener('click', async () => {
    if (!confirm('Replace your edited rules with the default config/rules.json?')) return;
    await loadDefaultRules();
    $('rules-text').value = state.rulesText;
    save();
    renderRulesCheck();
    renderInput();
  });
  $('btn-dl-rules').addEventListener('click', () => download('rules.json', state.rulesText, 'application/json'));
}

// ---------------------------------------------------------------- charts (inline SVG)
function hbarChart(id, title, rows, { stacked = null, colors = COLORS } = {}) {
  // rows: [{ label, value }] or, when stacked = [series...], [{ label, values: {series: n} }]
  const width = 560;
  const labelW = 190;
  const rowH = 26;
  const height = rows.length * rowH + 24;
  const totals = rows.map((r) => (stacked ? stacked.reduce((s, k) => s + (r.values[k] || 0), 0) : r.value));
  const max = Math.max(1, ...totals);
  const scale = (v) => (v / max) * (width - labelW - 50);
  const bars = rows.map((r, i) => {
    const y = i * rowH + 4;
    let x = labelW;
    const segs = stacked
      ? stacked.map((k, j) => {
        const w = scale(r.values[k] || 0);
        const s = w > 0 ? `<rect x="${x}" y="${y}" width="${w}" height="${rowH - 8}" rx="2" fill="${colors[j % colors.length]}"><title>${esc(r.label)} – ${esc(k)}: ${r.values[k] || 0}</title></rect>` : '';
        x += w;
        return s;
      }).join('')
      : `<rect x="${x}" y="${y}" width="${scale(r.value)}" height="${rowH - 8}" rx="2" fill="${colors[i % colors.length]}"><title>${esc(r.label)}: ${r.value}</title></rect>`;
    const endX = labelW + scale(totals[i]) + 6;
    return `<text x="${labelW - 8}" y="${y + rowH / 2}" text-anchor="end" class="lbl">${esc(r.label.length > 28 ? r.label.slice(0, 27) + '…' : r.label)}</text>${segs}<text x="${endX}" y="${y + rowH / 2}">${totals[i]}</text>`;
  }).join('');
  const legend = stacked ? `<div class="legend">${stacked.map((k, j) => `<span style="--c:${colors[j % colors.length]}">${esc(k)}</span>`).join('')}</div>` : '';
  const tableHead = stacked ? `<th scope="col">${stacked.map(esc).join('</th><th scope="col" class="num">')}</th><th scope="col" class="num">Total</th>` : '<th scope="col" class="num">Count</th>';
  const tableRows = rows.map((r, i) => `<tr><td>${esc(r.label)}</td>${stacked ? stacked.map((k) => `<td class="num">${r.values[k] || 0}</td>`).join('') + `<td class="num">${totals[i]}</td>` : `<td class="num">${r.value}</td>`}</tr>`).join('');
  return `<figure class="chart" style="margin:0"><svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-t ${id}-d"><title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(rows.map((r, i) => `${r.label}: ${totals[i]}`).join('; '))}</desc>${bars}</svg>${legend}
    <details><summary>Show data table</summary><div class="table-wrap"><table><thead><tr><th scope="col">Item</th>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table></div></details></figure>`;
}

function vbarChart(id, title, rows) {
  const width = 560;
  const height = 220;
  const pad = { l: 34, b: 44, t: 12, r: 8 };
  const max = Math.max(1, ...rows.map((r) => r.value));
  const bw = (width - pad.l - pad.r) / Math.max(1, rows.length);
  const ih = height - pad.t - pad.b;
  const ticks = [0, Math.ceil(max / 2), max];
  const grid = ticks.map((t) => { const y = pad.t + ih - (t / max) * ih; return `<line class="axis" x1="${pad.l}" x2="${width - pad.r}" y1="${y}" y2="${y}"/><text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" class="lbl">${t}</text>`; }).join('');
  const bars = rows.map((r, i) => {
    const h = (r.value / max) * ih;
    const x = pad.l + i * bw + bw * 0.15;
    return `<rect x="${x}" y="${pad.t + ih - h}" width="${bw * 0.7}" height="${h}" rx="2" fill="var(--s1)"><title>${esc(r.label)}: ${r.value}</title></rect><text x="${x + bw * 0.35}" y="${pad.t + ih - h - 4}" text-anchor="middle">${r.value}</text><text x="${x + bw * 0.35}" y="${height - pad.b + 16}" text-anchor="middle" class="lbl">${esc(r.short || r.label)}</text>`;
  }).join('');
  return `<figure class="chart" style="margin:0"><svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-t ${id}-d"><title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(rows.map((r) => `${r.label}: ${r.value}`).join('; '))}</desc>${grid}${bars}</svg>
    <details><summary>Show data table</summary><div class="table-wrap"><table><thead><tr><th scope="col">Due date</th><th scope="col" class="num">Tasks</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${r.value}</td></tr>`).join('')}</tbody></table></div></details></figure>`;
}

// ---------------------------------------------------------------- results
const SUBS = [
  ['overview', 'Overview'], ['log', 'Step log'], ['errors', 'Errors & warnings'], ['leads', 'Categorised leads'], ['tasks', 'Tasks'], ['outbox', 'Mock outbox'],
];

function taskStatus(t) {
  return state.taskStore[t.task_id]?.status || t.status;
}

function tasksWithStatus(r) {
  return r.tasks.map((t) => ({ ...t, status: taskStatus(t) }));
}

function renderResults() {
  const box = $('results');
  const r = state.last;
  if (!r) {
    box.innerHTML = '<div class="card empty"><strong>No run yet.</strong>Go to <a href="#" data-go="input">Input</a>, load the sample leads or your own CSV, then press "Run workflow".</div>';
    box.querySelector('[data-go]').addEventListener('click', (e) => { e.preventDefault(); showTab('input', true); });
    return;
  }
  if (r.fatal) {
    box.innerHTML = `<div class="card"><div class="error-box"><strong>Run stopped at "${esc(r.fatal.step)}" (${esc(r.fatal.code)}).</strong><p style="margin-top:6px">${esc(r.fatal.message)}</p><p>Nothing was processed. Fix the input or rules and run again; a failed run changes nothing, so it is always safe to retry.</p></div></div>`;
    return;
  }
  const c = r.counts;
  const head = `<div class="card"><div class="row" style="justify-content:space-between"><div><h2 style="margin:0">Run ${esc(r.runId)}</h2>
    <p class="small muted" style="margin:0">Run date ${esc(r.today)} · ${esc(r.inputName)} · rules v${esc(r.rulesVersion)} · ${new Date(r.generatedAt).toLocaleString()}</p></div>
    <div class="dl-group" role="group" aria-label="Download outputs">
      <button class="btn small" data-dl="leads.csv">leads.csv</button><button class="btn small" data-dl="rejected.csv">rejected.csv</button>
      <button class="btn small" data-dl="tasks.csv">tasks.csv</button><button class="btn small" data-dl="mock-outbox.csv">mock-outbox.csv</button>
      <button class="btn small" data-dl="run-log.json">run-log.json</button><button class="btn small" data-dl="summary.md">summary.md</button></div></div></div>`;
  const kpis = `<div class="kpis">
    ${kpi('Rows read', c.rowsRead, c.blankRows ? `${c.blankRows} blank row(s) skipped` : 'non-blank data rows')}
    ${kpi('Rejected', c.rejectedValidation, `${formatPct(c.rejectedValidation, c.rowsRead)} of rows read`)}
    ${kpi('Rows with warnings', c.rowsWithWarnings, `${c.warningsTotal} warning(s) in total`)}
    ${kpi('Duplicates merged', c.duplicates, `${formatPct(c.duplicates, c.rowsRead)} of rows read`)}
    ${kpi('Clean leads', c.uniqueLeads, `${formatPct(c.uniqueLeads, c.rowsRead)} of rows read`)}
    ${kpi('Tasks created', c.tasksCreated, `${c.tasksAlreadyExisted} already existed (not duplicated)`)}
    ${kpi('Mock messages', c.messagesMocked, `not sent · ${c.messagesSkipped} skipped`)}
  </div>`;
  const tabs = `<div class="subtabs" role="tablist" aria-label="Result views">${SUBS.map(([k, label]) => `<button class="subtab" role="tab" aria-selected="${state.sub === k}" data-sub="${k}">${esc(label)}</button>`).join('')}</div>`;
  box.innerHTML = head + kpis + tabs + '<div id="sub-view"></div>';
  box.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => { state.sub = b.dataset.sub; renderResults(); box.querySelector(`[data-sub="${state.sub}"]`).focus(); }));
  box.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => downloadOutput(b.dataset.dl)));
  renderSub();
}

function kpi(label, value, sub) {
  return `<div class="kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
}

function downloadOutput(name) {
  const r = state.last;
  const map = {
    'leads.csv': () => [leadsToCsv(r.leads), 'text/csv'],
    'rejected.csv': () => [rejectedToCsv(r.rejected, r.header), 'text/csv'],
    'tasks.csv': () => [tasksToCsv(tasksWithStatus(r)), 'text/csv'],
    'mock-outbox.csv': () => [outboxToCsv(r.messages), 'text/csv'],
    'run-log.json': () => [JSON.stringify(buildRunLog(r), null, 2) + '\n', 'application/json'],
    'summary.md': () => [buildSummary(r), 'text/markdown'],
  };
  const [content, type] = map[name]();
  download(name, content, type);
}

function renderSub() {
  const v = $('sub-view');
  const r = state.last;
  const views = { overview: viewOverview, log: viewLog, errors: viewErrors, leads: viewLeads, tasks: viewTasks, outbox: viewOutbox };
  v.innerHTML = views[state.sub](r);
  bindFilters(v);
}

function viewOverview(r) {
  const c = r.counts;
  const { rules } = currentRules();
  const priorities = rules ? Object.keys(rules.tasks.priorities) : Object.keys(c.byPriority);
  const funnel = [
    { label: 'Rows read', value: c.rowsRead },
    { label: 'Passed validation', value: c.rowsRead - c.rejectedValidation },
    { label: 'Unique after dedupe', value: c.uniqueLeads },
    { label: 'Tasks created this run', value: c.tasksCreated },
    { label: 'Mock messages (not sent)', value: c.messagesMocked },
  ];
  const catRows = {};
  for (const l of r.leads) {
    catRows[l.category] = catRows[l.category] || { label: l.category, values: {} };
    catRows[l.category].values[l.priority] = (catRows[l.category].values[l.priority] || 0) + 1;
  }
  const cats = Object.values(catRows).sort((a, b) => Object.values(b.values).reduce((s, x) => s + x, 0) - Object.values(a.values).reduce((s, x) => s + x, 0) || a.label.localeCompare(b.label));
  const due = Object.entries(c.tasksByDueDate).sort((a, b) => a[0].localeCompare(b[0])).map(([d, n]) => ({ label: d, short: d.slice(5), value: n }));
  const codes = Object.entries(c.rejectionsByCode).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: k, value: n }));
  return `<div class="grid-2">
    <div class="card"><h3>Pipeline: rows through each step</h3>${hbarChart('ch-funnel', 'Rows through each pipeline step', funnel)}</div>
    <div class="card"><h3>Leads by category and priority</h3>${cats.length ? hbarChart('ch-cat', 'Clean leads by category, stacked by priority', cats, { stacked: priorities, colors: PRIORITY_COLORS }) : '<p class="empty">No clean leads.</p>'}</div>
    <div class="card"><h3>Tasks by due date</h3>${due.length ? vbarChart('ch-due', 'Follow-up tasks by due date', due) : '<p class="empty">No tasks.</p>'}</div>
    <div class="card"><h3>Rejections and duplicates by code</h3>${codes.length ? hbarChart('ch-codes', 'Rows removed by reason code', codes, { colors: ['var(--s4)'] }) : '<p class="empty">Nothing was rejected.</p>'}</div>
  </div>`;
}

function opts(values, selected, allLabel) {
  return `<option value="">${esc(allLabel)}</option>` + values.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

function match(q, ...fields) {
  if (!q) return true;
  const s = q.toLowerCase();
  return fields.some((f) => String(f ?? '').toLowerCase().includes(s));
}

function viewLog(r) {
  const f = state.filters;
  const rows = r.entries.filter((e) => (!f.logStep || e.step === f.logStep) && (!f.logResult || e.result === f.logResult) && match(f.logQ, e.record_id, e.message));
  return `<div class="card"><div class="filters">
      <div><label for="f-logStep">Step</label><select id="f-logStep" data-f="logStep">${opts(PIPELINE_STEPS, f.logStep, 'All steps')}</select></div>
      <div><label for="f-logResult">Result</label><select id="f-logResult" data-f="logResult">${opts(['ok', 'warn', 'reject', 'skip', 'error'], f.logResult, 'All results')}</select></div>
      <div><label for="f-logQ">Search record or message</label><input type="search" id="f-logQ" data-f="logQ" value="${esc(f.logQ)}"></div>
    </div>
    <p class="small muted" aria-live="polite">${rows.length} of ${r.entries.length} log entries</p>
    ${rows.length ? `<div class="table-wrap tall"><table><thead><tr><th scope="col" class="num">#</th><th scope="col">Timestamp</th><th scope="col">Step</th><th scope="col">Record</th><th scope="col">Result</th><th scope="col">Message</th></tr></thead><tbody>${
      rows.map((e) => `<tr><td class="num">${e.seq}</td><td class="nowrap mono">${esc(e.timestamp.slice(11, 23))}</td><td>${esc(e.step)}</td><td class="nowrap mono">${esc(e.record_id)}</td><td>${badge(e.result)}</td><td class="wrap">${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><strong>No entries match.</strong>Clear the filters to see the full log.</div>'}</div>`;
}

function viewErrors(r) {
  const rej = [...r.rejected].sort((a, b) => a._row - b._row);
  const hidx = (name) => r.header.findIndex((h) => h.trim().toLowerCase() === name);
  const ei = hidx('email');
  const ci = hidx('company');
  return `<div class="card"><h3>Rejected rows (${rej.length})</h3><p class="small muted">Rows removed at validation, and duplicates merged into another record. Download <code>rejected.csv</code> to fix and re-import them; it keeps the original columns.</p>
    ${rej.length ? `<div class="table-wrap"><table><thead><tr><th scope="col" class="num">Row</th><th scope="col">Stage</th><th scope="col">Code</th><th scope="col">Reason</th><th scope="col">Email (as given)</th><th scope="col">Company (as given)</th></tr></thead><tbody>${
      rej.map((x) => `<tr><td class="num">${x._row}</td><td>${badge(x._stage, x._stage === 'dedupe' ? 'skip' : 'reject')}</td><td class="mono">${esc(x._codes)}</td><td class="wrap">${esc(x._reasons)}</td><td>${esc(ei >= 0 ? x.cells[ei] : '')}</td><td>${esc(ci >= 0 ? x.cells[ci] : '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No rows were rejected.</div>'}
  </div>
  <div class="card"><h3>Warnings on accepted rows (${r.warnings.length})</h3>
    ${r.warnings.length ? `<div class="table-wrap"><table><thead><tr><th scope="col" class="num">Row</th><th scope="col">Record</th><th scope="col">Code</th><th scope="col">Detail</th></tr></thead><tbody>${
      r.warnings.map((w) => `<tr><td class="num">${w.row}</td><td class="mono nowrap">${esc(w.record_id)}</td><td class="mono">${esc(w.code)}</td><td class="wrap">${esc(w.message)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No warnings.</div>'}
  </div>`;
}

function viewLeads(r) {
  const f = state.filters;
  const cats = [...new Set(r.leads.map((l) => l.category))].sort();
  const pris = [...new Set(r.leads.map((l) => l.priority))];
  const rows = r.leads.filter((l) => (!f.leadCat || l.category === f.leadCat) && (!f.leadPri || l.priority === f.leadPri) && match(f.leadQ, l.full_name, l.company, l.email, l.record_id));
  return `<div class="card"><div class="filters">
      <div><label for="f-leadCat">Category</label><select id="f-leadCat" data-f="leadCat">${opts(cats, f.leadCat, 'All categories')}</select></div>
      <div><label for="f-leadPri">Priority</label><select id="f-leadPri" data-f="leadPri">${opts(pris, f.leadPri, 'All priorities')}</select></div>
      <div><label for="f-leadQ">Search name, company, email</label><input type="search" id="f-leadQ" data-f="leadQ" value="${esc(f.leadQ)}"></div>
    </div>
    <p class="small muted" aria-live="polite">${rows.length} of ${r.leads.length} clean leads</p>
    ${rows.length ? `<div class="table-wrap tall"><table><thead><tr><th scope="col">Record ID</th><th scope="col">Name</th><th scope="col">Company</th><th scope="col">Email</th><th scope="col">Phone</th><th scope="col">Country</th><th scope="col">Source</th><th scope="col">Category</th><th scope="col">Priority</th><th scope="col">Rule</th><th scope="col">Opt-in</th><th scope="col">Rows</th><th scope="col">Warnings</th></tr></thead><tbody>${
      rows.map((l) => `<tr><td class="mono nowrap">${esc(l.record_id)}</td><td class="nowrap">${esc(l.full_name)}</td><td>${esc(l.company)}</td><td>${esc(l.email)}</td><td class="nowrap">${esc(l.phone)}</td><td>${esc(l.country)}</td><td>${esc(l.source)}</td><td>${esc(l.category)}</td><td>${badge(l.priority)}</td><td class="mono">${esc(l.rule_id)}</td><td>${esc(l.opt_in)}</td><td class="num">${esc(l.source_rows.join(', '))}</td><td class="mono small">${esc((l.warnings || []).join(', '))}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><strong>No leads match.</strong>Clear the filters.</div>'}</div>`;
}

function viewTasks(r) {
  const f = state.filters;
  const all = tasksWithStatus(r);
  const pris = [...new Set(all.map((t) => t.priority))];
  const rows = all.filter((t) => (!f.taskPri || t.priority === f.taskPri) && (!f.taskStatus || t.status === f.taskStatus) && match(f.taskQ, t.lead_name, t.company, t.task_id));
  const c = r.counts;
  return `<div class="card">
    <p>${c.tasksCreated} task(s) created this run, ${c.tasksAlreadyExisted} already existed and were left unchanged. Task board total: ${all.length}. Ticking "Done" is saved in this browser and kept across re-runs.</p>
    <div class="filters">
      <div><label for="f-taskPri">Priority</label><select id="f-taskPri" data-f="taskPri">${opts(pris, f.taskPri, 'All priorities')}</select></div>
      <div><label for="f-taskStatus">Status</label><select id="f-taskStatus" data-f="taskStatus">${opts(['open', 'done'], f.taskStatus, 'Any status')}</select></div>
      <div><label for="f-taskQ">Search lead, company, task ID</label><input type="search" id="f-taskQ" data-f="taskQ" value="${esc(f.taskQ)}"></div>
      <div><button class="btn small danger" id="btn-clear-tasks" type="button">Clear task board</button></div>
    </div>
    <p class="small muted" aria-live="polite">${rows.length} of ${all.length} tasks</p>
    ${rows.length ? `<div class="table-wrap tall"><table><thead><tr><th scope="col">Done</th><th scope="col">Due</th><th scope="col">Priority</th><th scope="col">Task</th><th scope="col">Lead</th><th scope="col">Company</th><th scope="col">Category</th><th scope="col">Owner</th><th scope="col">Task ID</th></tr></thead><tbody>${
      rows.map((t) => `<tr><td><input type="checkbox" data-task="${esc(t.task_id)}" ${t.status === 'done' ? 'checked' : ''} aria-label="Mark task for ${esc(t.lead_name)} as done"></td><td class="nowrap">${esc(t.due_date)}</td><td>${badge(t.priority)}</td><td>${esc(t.task_type)}</td><td class="nowrap">${esc(t.lead_name)}</td><td>${esc(t.company)}</td><td>${esc(t.category)}</td><td>${esc(t.owner)}</td><td class="mono nowrap">${esc(t.task_id)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><strong>No tasks match.</strong>Clear the filters.</div>'}</div>`;
}

function viewOutbox(r) {
  return `<div class="card"><p>${badge('NOT SENT (mock)', 'mock')} These are the ${r.messages.length} message(s) that <strong>would</strong> be sent. This app has no sending code and makes no network requests.</p>
    ${r.messages.length ? r.messages.map((m) => `<article class="msg"><div class="meta">${esc(m.message_id)} · to <strong>${esc(m.to)}</strong> · from ${esc(m.from)} · template ${esc(m.template)} · task ${esc(m.task_id)}</div><div class="subject">${esc(m.subject)}</div><div class="body">${esc(m.body)}</div></article>`).join('')
    : '<div class="empty"><strong>No mock messages in this run.</strong>On a re-run with the saved task board, messages for existing tasks are skipped to avoid duplicates.</div>'}
    <h3 style="margin-top:16px">Skipped (${r.skippedMessages.length})</h3>
    ${r.skippedMessages.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Record</th><th scope="col">Task</th><th scope="col">Reason</th></tr></thead><tbody>${r.skippedMessages.map((s) => `<tr><td class="mono">${esc(s.record_id)}</td><td class="mono">${esc(s.task_id)}</td><td>${esc(s.reason)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">None.</p>'}
  </div>`;
}

function bindFilters(root) {
  root.querySelectorAll('[data-f]').forEach((el) => {
    const ev = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      state.filters[el.dataset.f] = el.value;
      const id = el.id;
      const pos = el.selectionStart;
      renderSub();
      const again = $(id);
      if (again) {
        again.focus();
        if (pos !== null && pos !== undefined && again.setSelectionRange && again.type === 'search') again.setSelectionRange(pos, pos);
      }
    });
  });
  root.querySelectorAll('[data-task]').forEach((cb) => cb.addEventListener('change', () => {
    const id = cb.dataset.task;
    const t = state.taskStore[id] || state.last.tasks.find((x) => x.task_id === id);
    state.taskStore[id] = { ...t, status: cb.checked ? 'done' : 'open' };
    save();
  }));
  const clr = root.querySelector('#btn-clear-tasks');
  if (clr) clr.addEventListener('click', () => {
    if (!confirm('Clear the saved task board? The next run will create every task (and mock message) again.')) return;
    state.taskStore = {};
    save();
    renderSub();
  });
}

// ---------------------------------------------------------------- help
function renderValidationTable() {
  const rows = Object.entries(VALIDATION_RULES);
  $('validation-table').innerHTML = `<div class="table-wrap"><table><thead><tr><th scope="col">Code</th><th scope="col">Severity</th><th scope="col">Meaning</th></tr></thead><tbody>${
    rows.map(([code, r]) => `<tr><td class="mono">${esc(code)}</td><td>${badge(r.severity, r.severity === 'warn' ? 'warn' : 'reject')}</td><td>${esc(r.label)}</td></tr>`).join('')
  }<tr><td class="mono">duplicate_email</td><td>${badge('merged', 'skip')}</td><td>Same normalised email as an earlier row; merged into it</td></tr>
  <tr><td class="mono">duplicate_name_company</td><td>${badge('merged', 'skip')}</td><td>Same first name, last name and company as an earlier row; merged into it</td></tr></tbody></table></div>`;
}

// ---------------------------------------------------------------- boot
async function boot() {
  initTabs();
  initInput();
  initData();
  initRules();
  renderValidationTable();
  const restored = load();
  if (!restored || !state.rulesText) await loadDefaultRules();
  renderInput();
  renderRules();
  if (restored && state.last) setStatus('run-status', 'Restored your last session from this browser.', 'ok');
}

boot();
