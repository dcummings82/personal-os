import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { todayStr, fmtDate, dueInfo, rollForward, FREQUENCIES } from './dates.js';

const TYPES = ['Inbox', 'Action', 'Project', 'Idea', 'Responsibility'];
const STAGES = ['New', 'Seed', 'Exploring', 'Planned', 'Ready', 'Active', 'Waiting'];
const PRIORITIES = ['Critical', 'High', 'Normal', 'Low', 'Someday'];
const AREAS = ['Home', 'Health', 'Finance', 'Family', 'Projects'];
const LISTS = ['Actions', 'Focus', 'Waiting', 'Responsibilities', 'Ideas', 'Completed'];
const TEXT_FIELDS = ['title', 'next_action', 'waiting_on', 'desired_outcome', 'plan', 'interval_days'];
const LOCK_AFTER_MS = 10 * 60 * 1000;
const MAX_PIN_TRIES = 5;
const PIN_KEY = 'pos.pin';
const DRAFT_KEY = 'pos.captureDraft';

const ICON = {
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
  lock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  today: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  inbox: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></svg>',
  projects: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  more: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
};

const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const S = {
  screen: 'loading', // loading | config | login | pin | pin-set | main
  session: null,
  items: [],
  view: 'today', // today | inbox | projects | more | list
  listKind: 'Actions',
  capType: 'Inbox',
  sheetId: null,
  pin: '',
  pinFirst: '',
  pinMsg: '',
  captureKey: null,
  saving: 0,
};

const app = document.getElementById('app');

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = (id) => S.items.find((x) => x.id === id);
const isOpen = (it) => it.stage !== 'Complete';
const urgency = (it) => {
  const d = dueInfo(it, todayStr());
  return it.stage === 'Complete' ? 1e6 : d.n === null ? 1e5 : d.n;
};
const byUrgency = (a, b) => urgency(a) - urgency(b);
const $ = (sel) => app.querySelector(sel);

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function setSaving(delta) {
  S.saving += delta;
  const el = $('#saveState');
  if (el) el.textContent = S.saving > 0 ? 'SAVING' : 'SAVED';
}

// ---------- data ----------

async function loadItems() {
  const { data, error } = await sb.from('items').select('*').order('created_at');
  if (error) { toast('Could not load: ' + error.message); return; }
  S.items = data;
  refresh();
}

// Saves run one at a time per item, and each update only lands if the row's
// version is unchanged, so an edit from another device is never silently overwritten.
const chains = {};
function patch(id, changes, { rerender = true } = {}) {
  const it = byId(id);
  if (!it) return Promise.resolve();
  Object.assign(it, changes);
  if (rerender) refresh();
  chains[id] = (chains[id] || Promise.resolve()).then(() => saveRow(id, changes));
  return chains[id];
}

async function saveRow(id, changes) {
  const it = byId(id);
  if (!it || String(id).startsWith('tmp-')) return;
  setSaving(1);
  const v = it.version;
  const { data, error } = await sb.from('items')
    .update({ ...changes, version: v + 1, updated_at: new Date().toISOString() })
    .eq('id', id).eq('version', v).select();
  setSaving(-1);
  if (error) { toast('Could not save: ' + error.message); return; }
  if (!data.length) {
    const { data: fresh } = await sb.from('items').select('*').eq('id', id).maybeSingle();
    S.items = fresh ? S.items.map((x) => (x.id === id ? fresh : x)) : S.items.filter((x) => x.id !== id);
    toast('This item was changed on another device. Showing the latest version.');
    refresh();
    return;
  }
  it.version = data[0].version;
}

async function addItem(fields) {
  const tmp = { id: 'tmp-' + Date.now(), stage: 'New', priority: 'Normal', focus: false, version: 1, ...fields };
  S.items.push(tmp);
  refresh();
  setSaving(1);
  const { data, error } = await sb.from('items').insert(fields).select().single();
  setSaving(-1);
  S.items = S.items.filter((x) => x.id !== tmp.id);
  if (error) { refresh(); throw error; }
  S.items.push(data);
  refresh();
  return data;
}

async function deleteItem(id) {
  const it = byId(id);
  if (!it || !confirm('Delete "' + it.title + '"? This cannot be undone.')) return;
  S.items = S.items.filter((x) => x.id !== id);
  S.sheetId = null;
  refresh();
  const { error } = await sb.from('items').delete().eq('id', id);
  if (error) { toast('Could not delete: ' + error.message); loadItems(); } else toast('Deleted');
}

// ---------- item actions ----------

function toggleDone(id) {
  const it = byId(id);
  const today = todayStr();
  if (it.stage === 'Complete') {
    patch(id, { stage: 'Active', completed_date: null, cleared_at: null });
    toast('Reopened');
    return;
  }
  if (it.type === 'Responsibility' && it.next_due && it.frequency) {
    const next = rollForward(it.next_due, it.frequency, it.interval_days, today);
    patch(id, { next_due: next, completed_date: today, stage: 'Active' });
    toast('Done for this cycle. Next due ' + fmtDate(next));
    return;
  }
  patch(id, { stage: 'Complete', completed_date: today, focus: false });
  if (it.parent_id) {
    sb.from('project_log').insert({ project_id: it.parent_id, day: today, text: 'Completed: ' + it.title })
      .then(({ error }) => { if (error) toast('Could not log to project: ' + error.message); });
  }
  toast('Completed');
}

function setType(id, t) {
  const it = byId(id);
  if (t === 'Inbox') { patch(id, { type: null, stage: 'New' }); return; }
  const ch = { type: t };
  if (it.stage === 'New') ch.stage = 'Ready';
  if (t === 'Project') ch.parent_id = null;
  patch(id, ch);
}

async function capture() {
  const input = $('#capInput');
  const title = input.value.trim();
  if (!title) return;
  const type = S.capType === 'Inbox' ? null : S.capType;
  input.value = '';
  localStorage.removeItem(DRAFT_KEY);
  try {
    await addItem({ title, type, stage: type ? 'Ready' : 'New' });
    toast('Saved to ' + S.capType);
  } catch (e) {
    input.value = title; // never lose typed text
    localStorage.setItem(DRAFT_KEY, title);
    toast('Could not save: ' + e.message);
  }
}

// ---------- PIN lock ----------

async function hashPin(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function storedPin() {
  try { return JSON.parse(localStorage.getItem(PIN_KEY)); } catch { return null; }
}

async function pinDigit(k) {
  if (k === 'del') { S.pin = S.pin.slice(0, -1); render(); return; }
  if (S.pin.length >= 4) return;
  S.pin += k;
  render();
  if (S.pin.length < 4) return;
  const entered = S.pin;
  S.pin = '';
  if (S.screen === 'pin-set') {
    if (!S.pinFirst) { S.pinFirst = entered; S.pinMsg = 'Enter it again to confirm'; render(); return; }
    if (S.pinFirst !== entered) { S.pinFirst = ''; S.pinMsg = 'Those didn\'t match. Choose a PIN'; render(); return; }
    const salt = crypto.getRandomValues(new Uint32Array(2)).join('-');
    localStorage.setItem(PIN_KEY, JSON.stringify({ salt, hash: await hashPin(entered, salt), fails: 0 }));
    S.pinFirst = '';
    enterMain();
    return;
  }
  const p = storedPin();
  if (p && (await hashPin(entered, p.salt)) === p.hash) {
    p.fails = 0;
    localStorage.setItem(PIN_KEY, JSON.stringify(p));
    enterMain();
    return;
  }
  p.fails = (p.fails || 0) + 1;
  localStorage.setItem(PIN_KEY, JSON.stringify(p));
  if (p.fails >= MAX_PIN_TRIES) { await signOut('Too many wrong PINs. Sign in again.'); return; }
  S.pinMsg = 'Wrong PIN. ' + (MAX_PIN_TRIES - p.fails) + ' tries left';
  render();
}

function lock() {
  if (S.screen !== 'main') return;
  S.screen = 'pin';
  S.pin = '';
  S.pinMsg = 'Enter your PIN';
  S.sheetId = null;
  render();
}

async function signOut(msg) {
  localStorage.removeItem(PIN_KEY);
  await sb.auth.signOut();
  S.items = [];
  S.screen = 'login';
  render();
  if (msg) toast(msg);
}

function enterMain() {
  S.screen = 'main';
  render();
  loadItems();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { sessionStorage.setItem('pos.hiddenAt', String(Date.now())); return; }
  const at = Number(sessionStorage.getItem('pos.hiddenAt') || 0);
  if (at && Date.now() - at > LOCK_AFTER_MS) lock();
  else if (S.screen === 'main') loadItems();
});

// ---------- rendering ----------

function chip(cls, text) {
  return `<span class="chip ${cls}">${esc(text)}</span>`;
}

function subLine(it) {
  const parent = it.parent_id ? byId(it.parent_id) : null;
  if (it.stage === 'Waiting' && it.waiting_on) return 'Waiting on ' + it.waiting_on + (parent ? ' · ' + parent.title : '');
  return parent ? parent.title : it.area || '';
}

function row(it, { showStage = false } = {}) {
  const d = dueInfo(it, todayStr());
  const done = it.stage === 'Complete';
  const typeLabel = it.type || 'Inbox';
  return `<div class="row ${d.row}">
    <button class="chk ${done ? 'on' : ''}" data-act="toggle" data-id="${it.id}" aria-label="${done ? 'Reopen' : 'Mark done'}">${done ? ICON.check : ''}</button>
    <button class="rbody" data-act="open" data-id="${it.id}">
      <span class="rt">${esc(it.title)}</span>
      <span class="rmeta">${showStage ? chip('s-' + it.stage, it.stage) : chip(d.cls, d.label)}${showStage ? chip(d.cls, d.label) : chip('t-' + typeLabel, typeLabel)}<span class="rs">${esc(subLine(it))}</span></span>
    </button>
  </div>`;
}

function card(rows, empty, extraCls = '') {
  return `<div class="card ${extraCls}">${rows.length ? rows.join('') : `<div class="empty">${esc(empty)}</div>`}</div>`;
}

function lists() {
  const open = S.items.filter(isOpen);
  return {
    Actions: open.filter((x) => x.type === 'Action' && !x.parent_id).sort(byUrgency),
    Focus: open.filter((x) => x.focus).sort(byUrgency),
    Waiting: open.filter((x) => x.stage === 'Waiting').sort(byUrgency),
    Responsibilities: open.filter((x) => x.type === 'Responsibility').sort(byUrgency),
    Ideas: open.filter((x) => x.type === 'Idea'),
    Completed: S.items.filter((x) => !isOpen(x)).sort((a, b) => (b.completed_date || '').localeCompare(a.completed_date || '')),
  };
}

function attention() {
  const today = todayStr();
  return S.items.filter(isOpen).filter((x) => {
    const d = dueInfo(x, today);
    return (d.n !== null && d.n <= 0) || x.priority === 'Critical';
  }).sort(byUrgency);
}

function inboxItems() {
  return S.items.filter((x) => isOpen(x) && !x.type);
}

function viewToday() {
  const today = todayStr();
  const attn = attention();
  const focus = lists().Focus;
  const coming = S.items.filter(isOpen).filter((x) => { const n = dueInfo(x, today).n; return n !== null && n >= 1 && n <= 14; }).sort(byUrgency);
  const n = attn.length;
  const headline = n === 0 ? 'Nothing needs you right now' : n + (n === 1 ? ' thing needs' : ' things need') + ' your attention';
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  const focusCards = focus.map((it) => {
    const d = dueInfo(it, today);
    const t = it.type || 'Inbox';
    return `<button class="card fcard" data-act="open" data-id="${it.id}">
      <span class="rmeta">${chip('t-' + t, t)}${chip('s-' + it.stage, it.stage)}${chip(d.cls, d.label)}</span>
      <span class="rt big">${esc(it.title)}</span>
      <span class="rs">${esc(it.next_action ? 'Next: ' + it.next_action : subLine(it))}</span>
    </button>`;
  });
  return `<div class="mono date">${esc(dateLine)}</div>
    <h1 class="h1">${esc(headline)}</h1>
    <div class="sec attn">Needs attention<span>${n}</span></div>
    ${card(attn.map((x) => row(x)), 'All clear.', 'attn-card')}
    <div class="sec">In focus<span>${focus.length}</span></div>
    <div class="stack">${focusCards.length ? focusCards.join('') : '<div class="card"><div class="empty">Tap Focus on an item to pin it here.</div></div>'}</div>
    <div class="sec">Coming up, next 14 days<span>${coming.length}</span></div>
    ${card(coming.map((x) => row(x)), 'Nothing due in the next two weeks.')}`;
}

function viewInbox() {
  const items = inboxItems();
  return `<h1 class="h1">Inbox</h1>
    <p class="hint">Tap an item to give it a type, area or date.</p>
    ${card(items.map((x) => row(x)), 'Inbox zero. Nice.')}`;
}

function viewProjects() {
  const projects = S.items.filter((x) => x.type === 'Project' && isOpen(x)).sort(byUrgency);
  const cards = projects.map((p) => {
    const tasks = S.items.filter((x) => x.parent_id === p.id);
    const done = tasks.filter((x) => x.stage === 'Complete').length;
    const pct = tasks.length ? Math.round((done * 100) / tasks.length) : 0;
    const d = dueInfo(p, todayStr());
    return `<button class="card pcard" data-act="open" data-id="${p.id}">
      <span class="rmeta">${chip('s-' + p.stage, p.stage)}${chip(d.cls, d.label)}<span class="rs">${esc(p.area || '')}</span></span>
      <span class="rt big">${esc(p.title)}</span>
      <span class="bar"><span style="width:${pct}%"></span></span>
      <span class="rs">${done} of ${tasks.length} done · Next: ${esc(p.next_action || 'Add a next action')}</span>
    </button>`;
  });
  return `<h1 class="h1">Projects</h1>
    <p class="hint">Full project pages arrive in Phase 3. For now, add a task by capturing it and setting its project.</p>
    <div class="stack">${cards.length ? cards.join('') : '<div class="card"><div class="empty">No projects yet. Capture one with Save as Project.</div></div>'}</div>`;
}

function viewMore() {
  const l = lists();
  const rows = LISTS.map((k) => `<button class="navrow" data-act="list" data-k="${k}"><span>${k}</span><span class="mono count">${l[k].length} ›</span></button>`).join('');
  const key = S.captureKey
    ? `<div class="keybox"><div class="lbl">Your Shortcut key (shown once)</div><code class="mono">${esc(S.captureKey)}</code>
       <button class="btn" data-act="copykey">Copy key</button>
       <p class="hint">Making a new key turns this one off.</p></div>`
    : '';
  return `<h1 class="h1">More</h1>
    <div class="card">${rows}</div>
    <div class="sec">Settings</div>
    <div class="card">
      <button class="navrow" data-act="newkey"><span>iPhone Shortcut key</span><span class="mono count">NEW KEY ›</span></button>
      <button class="navrow" data-act="changepin"><span>Change PIN</span><span class="mono count">›</span></button>
      <button class="navrow" data-act="lock"><span>Lock now</span><span class="mono count">›</span></button>
      <button class="navrow" data-act="signout"><span>Sign out</span><span class="mono count">${esc(S.session?.user?.email || '')}</span></button>
    </div>
    ${key}`;
}

function viewList() {
  const items = lists()[S.listKind] || [];
  return `<button class="link" data-act="go" data-v="more">‹ More</button>
    <h1 class="h1">${esc(S.listKind)}</h1>
    ${card(items.map((x) => row(x, { showStage: true })), 'Nothing here.')}`;
}

function renderView() {
  const el = $('#view');
  if (!el) return;
  const top = el.scrollTop;
  const views = { today: viewToday, inbox: viewInbox, projects: viewProjects, more: viewMore, list: viewList };
  el.innerHTML = (views[S.view] || viewToday)();
  el.scrollTop = top;
}

function renderTabs() {
  const el = $('#tabs');
  if (!el) return;
  const attn = attention().length;
  const inbox = inboxItems().length;
  const tab = (key, label, icon, badge, on) => `<button class="tab ${on ? 'on' : ''}" data-act="go" data-v="${key}">
    ${badge ? `<span class="badge red">${badge}</span>` : ''}${icon}${label}</button>`;
  el.innerHTML = tab('today', 'Today', ICON.today, attn, S.view === 'today')
    + tab('inbox', 'Inbox', ICON.inbox, inbox, S.view === 'inbox')
    + tab('projects', 'Projects', ICON.projects, 0, S.view === 'projects')
    + tab('more', 'More', ICON.more, 0, S.view === 'more' || S.view === 'list');
}

function renderPills() {
  const el = $('#pills');
  if (!el) return;
  el.innerHTML = '<span class="mono saveas">SAVE AS</span>' + TYPES.map((t) =>
    `<button type="button" class="pill sm ${t === S.capType ? 'on' : ''}" data-act="captype" data-v="${t}">${t}</button>`).join('');
}

// options: [{ label, value }]; value '' stands for "none".
function pills(act, field, options, current) {
  return `<div class="hscroll">${options.map((o) =>
    `<button class="pill ${String(current ?? '') === o.value ? 'on' : ''}" data-act="${act}" data-k="${field}" data-v="${esc(o.value)}">${esc(o.label)}</button>`).join('')}</div>`;
}
const opts = (list) => list.map((x) => ({ label: x, value: x }));

function renderSheet() {
  const el = $('#sheet');
  if (!el) return;
  const it = S.sheetId ? byId(S.sheetId) : null;
  if (!it) { el.innerHTML = ''; el.hidden = true; return; }
  const prevBody = el.querySelector('.sbody');
  const top = prevBody ? prevBody.scrollTop : 0;
  const d = dueInfo(it, todayStr());
  const cur = it.type || 'Inbox';
  const projects = S.items.filter((x) => x.type === 'Project' && isOpen(x) && x.id !== it.id);
  const done = it.stage === 'Complete';
  const doneLabel = done ? 'Reopen' : it.type === 'Responsibility' && it.frequency && it.next_due ? 'Done this cycle' : 'Complete';
  const field = (k, label, ph = '') => `<label class="lbl" for="f-${k}">${label}</label>
    <input id="f-${k}" class="input" data-field="${k}" value="${esc(it[k] ?? '')}" placeholder="${esc(ph)}">`;
  el.hidden = false;
  el.innerHTML = `<div class="scrim" data-act="close"></div>
  <div class="panel" role="dialog" aria-label="Item details">
    <div class="shead"><button class="link" data-act="close">Close</button><span id="saveState" class="mono saved">${S.saving > 0 ? 'SAVING' : 'SAVED'}</span></div>
    <div class="sbody">
      <div class="rmeta">${chip('s-' + it.stage, it.stage)}${chip(d.cls, d.label)}${it.frequency ? `<span class="rs">Repeats ${esc(it.frequency.toLowerCase())}</span>` : ''}</div>
      <label class="lbl" for="f-title">Title</label>
      <textarea id="f-title" class="input title" rows="2" data-field="title">${esc(it.title)}</textarea>
      <div class="lbl">Type</div>${pills('settype', 'type', opts(TYPES), cur)}
      <div class="lbl">Stage</div>${pills('set', 'stage', opts(STAGES), it.stage)}
      <div class="grid2">
        <div><label class="lbl" for="f-due">Due</label><input id="f-due" type="date" class="input" data-date="next_due" value="${esc(it.next_due || '')}"></div>
        <div><label class="lbl" for="f-prio">Priority</label><select id="f-prio" class="input" data-select="priority">${PRIORITIES.map((p) => `<option ${p === it.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      </div>
      ${it.type === 'Responsibility' ? `<div class="grid2">
        <div><label class="lbl" for="f-freq">Repeats</label><select id="f-freq" class="input" data-select="frequency"><option value="">Never</option>${FREQUENCIES.map((f) => `<option ${f === it.frequency ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
        ${it.frequency === 'Custom' ? `<div>${field('interval_days', 'Every N days', '7')}</div>` : ''}
      </div>` : ''}
      <div class="lbl">Area</div>${pills('set', 'area', [...opts(AREAS), { label: 'None', value: '' }], it.area || '')}
      ${cur !== 'Project' ? `<div class="lbl">Part of project</div>${pills('set', 'parent_id', [{ label: 'None', value: '' }, ...projects.map((p) => ({ label: p.title, value: p.id }))], it.parent_id || '')}` : ''}
      ${field('next_action', 'Next action', 'What\'s the very next step?')}
      ${it.stage === 'Waiting' ? field('waiting_on', 'Waiting on', 'Who or what?') : ''}
      ${field('desired_outcome', 'Desired outcome', 'What does done look like?')}
      ${cur === 'Project' ? `<label class="lbl" for="f-plan">Plan</label><textarea id="f-plan" class="input plan" rows="5" data-field="plan">${esc(it.plan || '')}</textarea>` : ''}
      <button class="link danger" data-act="delete" data-id="${it.id}">Delete item</button>
    </div>
    <div class="sfoot">
      <button class="btn pri" data-act="toggle" data-id="${it.id}">${doneLabel}</button>
      <button class="btn" data-act="focus" data-id="${it.id}">${it.focus ? 'Unfocus' : 'Focus'}</button>
      <button class="btn" data-act="wait" data-id="${it.id}">${it.stage === 'Waiting' ? 'Resume' : 'Waiting'}</button>
    </div>
  </div>`;
  const body = el.querySelector('.sbody');
  if (body) body.scrollTop = top;
}

function refresh() {
  if (S.screen !== 'main') return;
  renderView();
  renderTabs();
  renderSheet();
}

function renderPin() {
  const dots = [0, 1, 2, 3].map((i) => `<span class="dot ${i < S.pin.length ? 'on' : ''}"></span>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) => {
    if (!k) return '<span></span>';
    if (k === 'del') return '<button class="key txt" data-act="pin" data-v="del" aria-label="Delete digit">Delete</button>';
    return `<button class="key" data-act="pin" data-v="${k}">${k}</button>`;
  }).join('');
  const setting = S.screen === 'pin-set';
  return `<div class="pinscreen">
    <div class="logo big">${ICON.lock}</div>
    <div class="center"><div class="wordmark">Personal OS</div><div class="hint">${esc(S.pinMsg || (setting ? 'Choose a 4-digit PIN for this device' : 'Enter your PIN'))}</div></div>
    <div class="dots">${dots}</div>
    <div class="keypad">${keys}</div>
    ${setting ? '' : '<button class="link" data-act="signout">Forgot PIN? Sign out</button>'}
  </div>`;
}

function render() {
  if (S.screen === 'loading') { app.innerHTML = '<div class="center pad">Loading…</div>'; return; }
  if (S.screen === 'config') {
    app.innerHTML = `<div class="center pad"><div class="wordmark">Personal OS</div>
      <p class="hint">Not connected yet. Add your Supabase Project URL and anon key to <code>js/config.js</code>.</p></div>`;
    return;
  }
  if (S.screen === 'login') {
    app.innerHTML = `<form class="login" id="loginForm">
      <div class="logo big">OS</div><div class="wordmark">Personal OS</div>
      <label class="lbl" for="email">Email</label><input id="email" class="input" type="email" autocomplete="username" required>
      <label class="lbl" for="password">Password</label><input id="password" class="input" type="password" autocomplete="current-password" required>
      <button class="btn pri" type="submit">Sign in</button>
    </form><div id="toast" class="toast" hidden></div>`;
    return;
  }
  if (S.screen === 'pin' || S.screen === 'pin-set') {
    app.innerHTML = renderPin() + '<div id="toast" class="toast" hidden></div>';
    return;
  }
  app.innerHTML = `<div class="shell">
    <header class="top">
      <div class="brand"><div class="logo">OS</div><div class="wordmark">Personal OS</div>
        <button class="xbtn" data-act="lock" aria-label="Lock app">${ICON.lock}</button></div>
      <form id="capForm" class="capture" autocomplete="off">
        <label for="capInput" class="sr">Quick capture</label>
        <input id="capInput" class="input" placeholder="Capture anything..." enterkeyhint="done">
        <button class="btn pri" type="submit">Save</button>
      </form>
      <div id="pills" class="hscroll"></div>
    </header>
    <main id="view"></main>
    <nav id="tabs" class="tabs"></nav>
    <div id="sheet" class="sheet" hidden></div>
    <div id="toast" class="toast" hidden></div>
  </div>`;
  $('#capInput').value = localStorage.getItem(DRAFT_KEY) || '';
  renderPills();
  refresh();
}

// ---------- events ----------

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id, v, k } = el.dataset;
  switch (act) {
    case 'pin': pinDigit(v); break;
    case 'go': S.view = v; S.sheetId = null; refresh(); $('#view').scrollTop = 0; break;
    case 'list': S.view = 'list'; S.listKind = k; refresh(); $('#view').scrollTop = 0; break;
    case 'captype': S.capType = v; renderPills(); $('#capInput').focus(); break;
    case 'open': S.sheetId = id; renderSheet(); break;
    case 'close': flushText(); S.sheetId = null; renderSheet(); break;
    case 'toggle': toggleDone(id); break;
    case 'focus': patch(id, { focus: !byId(id).focus }); break;
    case 'wait': patch(id, { stage: byId(id).stage === 'Waiting' ? 'Active' : 'Waiting' }); break;
    case 'delete': deleteItem(id); break;
    case 'settype': setType(S.sheetId, v); break;
    case 'set': patch(S.sheetId, { [k]: v || null }); break;
    case 'lock': lock(); break;
    case 'signout': signOut(); break;
    case 'changepin': S.screen = 'pin-set'; S.pin = ''; S.pinFirst = ''; S.pinMsg = 'Choose a new 4-digit PIN'; render(); break;
    case 'newkey': {
      if (!confirm('Make a new Shortcut key? Any older key stops working.')) break;
      const { data, error } = await sb.rpc('new_capture_key');
      if (error) { toast('Could not make a key: ' + error.message); break; }
      S.captureKey = data;
      refresh();
      break;
    }
    case 'copykey':
      try { await navigator.clipboard.writeText(S.captureKey); toast('Key copied'); } catch { toast('Select the key and copy it'); }
      break;
  }
});

app.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'capForm') { capture(); return; }
  if (e.target.id === 'loginForm') {
    const email = $('#email').value.trim();
    const password = $('#password').value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) toast(error.message);
  }
});

// Text fields autosave after a short pause, on blur, and before the page closes.
const pendingText = {};
let textTimer;
function flushText() {
  clearTimeout(textTimer);
  for (const key of Object.keys(pendingText)) {
    const [id, field] = key.split('|');
    let value = pendingText[key];
    delete pendingText[key];
    if (field === 'title' && !value.trim()) continue;
    if (field === 'interval_days') value = value ? Number(value) : null;
    else if (field !== 'title') value = value.trim() ? value : null;
    patch(id, { [field]: value }, { rerender: false }).then(() => { renderView(); renderTabs(); });
  }
}

app.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'capInput') { localStorage.setItem(DRAFT_KEY, t.value); return; }
  const field = t.dataset.field;
  if (!field || !TEXT_FIELDS.includes(field) || !S.sheetId) return;
  pendingText[S.sheetId + '|' + field] = t.value;
  const el = $('#saveState');
  if (el) el.textContent = 'EDITING';
  clearTimeout(textTimer);
  textTimer = setTimeout(flushText, 700);
});

app.addEventListener('focusout', (e) => { if (e.target.dataset?.field) flushText(); });
window.addEventListener('pagehide', flushText);

app.addEventListener('change', (e) => {
  const t = e.target;
  if (!S.sheetId) return;
  if (t.dataset.date) patch(S.sheetId, { [t.dataset.date]: t.value || null });
  if (t.dataset.select) patch(S.sheetId, { [t.dataset.select]: t.value || null });
});

document.addEventListener('keydown', (e) => {
  if ((S.screen === 'pin' || S.screen === 'pin-set') && /^[0-9]$/.test(e.key)) pinDigit(e.key);
  else if ((S.screen === 'pin' || S.screen === 'pin-set') && e.key === 'Backspace') pinDigit('del');
  else if (e.key === 'Escape' && S.sheetId) { flushText(); S.sheetId = null; renderSheet(); }
});

// ---------- start ----------

async function onSession(session) {
  S.session = session;
  if (!session) { S.screen = 'login'; render(); return; }
  if (['main', 'pin', 'pin-set'].includes(S.screen)) return;
  if (!storedPin()) { S.screen = 'pin-set'; S.pinMsg = ''; render(); return; }
  S.screen = 'pin';
  S.pinMsg = '';
  render();
}

if (!configured) {
  S.screen = 'config';
  render();
} else {
  render();
  const { data } = await sb.auth.getSession();
  await onSession(data.session);
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') onSession(session);
    else S.session = session;
  });
}
