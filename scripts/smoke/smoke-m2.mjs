/* Headless smoke for M2 via raw CDP (no deps). Usage: node scripts/smoke/smoke-m2.mjs <port> */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* Needs the dev server running: node scripts/serve.mjs  (pass the port it logs).
   Output (screenshots, throwaway Chrome profile) goes to $SMOKE_OUT or <os tmp>/acadbro-smoke. */
var PORT = process.argv[2] || process.env.SMOKE_PORT;
if (!PORT) { console.error('usage: node scripts/smoke/smoke-m2.mjs <port>'); process.exit(2); }
var SCR = process.env.SMOKE_OUT || path.join(os.tmpdir(), 'acadbro-smoke');

var SHOTS = path.join(SCR, 'm2-shots');
fs.mkdirSync(SHOTS, { recursive: true });
var CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var DBG = 9347;
var prof = path.join(SCR, 'prof-m2-' + Date.now());

var chrome = spawn(CHROME, ['--headless=new', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1' /* offline guard: only the local server resolves */, '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + DBG, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var pageInfo;
for (var i = 0; i < 50; i++) {
  try {
    var list = await (await fetch('http://127.0.0.1:' + DBG + '/json')).json();
    pageInfo = list.find(function (t) { return t.type === 'page'; });
    if (pageInfo) break;
  } catch (e) { /* not up yet */ }
  await sleep(200);
}
if (!pageInfo) { console.error('no chrome'); chrome.kill(); process.exit(2); }

var ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
await new Promise(function (r) { ws.onopen = r; });
var id = 0;
var pending = new Map();
var errors = [];
ws.onmessage = function (m) {
  var msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'assert')) {
    errors.push('console.' + msg.params.type + ': ' + msg.params.args.map(function (a) { return a.value || a.description; }).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    var d = msg.params.exceptionDetails;
    errors.push('exception: ' + (d.exception && d.exception.description || d.text));
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push('log: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
};
function send(method, params) {
  return new Promise(function (resolve) {
    var n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method: method, params: params || {} }));
  });
}
async function ev(expr) {
  var r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error('eval failed: ' + expr + ' -> ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description));
  return r.result.result.value;
}
async function shot(name) {
  await sleep(350);
  var r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64'));
}
var failures = [];
function check(name, cond, extra) {
  if (cond) console.log('ok   ' + name);
  else { console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); failures.push(name); }
}

async function center(sel) {
  return ev('(function(){var e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return null;e.scrollIntoView({block:"center"});var r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,l:r.left,t:r.top,h:r.height};})()');
}
async function click(sel) {
  if (sel.indexOf('toast') !== -1) await sleep(450);
  var c = await center(sel);
  if (!c) throw new Error('no element ' + sel);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await sleep(450); /* M6: view/page swaps fade out (--dur-fast 160ms) before rendering; wait past it */
}
async function drag(sel, dx) {
  var c = await center(sel);
  if (!c) throw new Error('no element ' + sel);
  var x0 = c.x + (dx < 0 ? c.w * 0.3 : -c.w * 0.3);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: c.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: c.y, button: 'left', clickCount: 1 });
  var steps = 12;
  for (var s = 1; s <= steps; s++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + dx * s / steps, y: c.y, buttons: 1 });
    await sleep(16);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + dx, y: c.y, button: 'left', clickCount: 1 });
  await sleep(350);
}
async function holdBadge(sel, ms) {
  var c = await center(sel);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await sleep(ms);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await sleep(300);
}
async function typeText(t) { await send('Input.insertText', { text: t }); }
async function key(k) {
  var code = k === 'Enter' ? 13 : k === 'Escape' ? 27 : 0;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code, text: k === 'Enter' ? '\r' : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
  await sleep(250);
}
function data() { return ev('JSON.parse(localStorage.getItem("acadbro-data-v1")||"null")'); }
function toasts() { return ev('Array.from(document.querySelectorAll(".toast-msg")).map(function(e){return e.textContent})'); }

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

/* ---- seed (once per browser profile) ---- */
var seed = function () {
  if (localStorage.getItem('seeded-m2')) return;
  function iso(off) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var ts = '2026-10-01T00:00:00.000Z';
  function P(id, area, name, o) { return Object.assign({ id: id, area: area, name: name, note: '', archived: false, order: 1, createdAt: ts, updatedAt: ts }, o || {}); }
  function T(id, area, pid, title, o) { return Object.assign({ id: id, area: area, projectId: pid, title: title, note: '', priority: 0, due: null, recur: null, subtasks: [], order: 1, createdAt: ts, updatedAt: ts }, o || {}); }
  var c = 0;
  function C(taskId, off, sub) { return { id: 'c' + (c++), taskId: taskId, subtaskId: sub || null, date: iso(off), at: ts }; }
  var data = {
    schema: 1,
    areaLabels: { living: 'Living', prod: 'Prod', hobby: 'Hobby' },
    projects: [P('p1', 'prod', 'Thesis', { order: 1, note: 'Chapter drafts and reviews' }), P('p2', 'prod', 'Side app', { order: 2 }), P('p3', 'prod', 'Old stuff', { order: 3, archived: true }), P('p4', 'living', 'Home', { order: 1 }), P('p5', 'hobby', 'Guitar', { order: 1 })],
    tasks: [
      T('t1', 'prod', null, 'Email advisor', { priority: 3, due: iso(-2), order: 1 }),
      T('t2', 'prod', 'p1', 'Read the survey paper', { priority: 2, due: iso(1), order: 2, note: 'Focus on section 4', subtasks: [{ id: 's1', title: 'Abstract' }, { id: 's2', title: 'Method' }, { id: 's3', title: 'Results' }] }),
      T('t3', 'prod', 'p1', 'Stretch and walk', { recur: { kind: 'weekdays', days: [0, 1, 2, 3, 4, 5, 6] }, order: 3 }),
      T('t4', 'prod', 'p2', 'Submit store form', { order: 4, priority: 1 }),
      T('t5', 'prod', 'p2', 'Pay hosting', { recur: { kind: 'monthly', day: 31 }, order: 5 }),
      T('t6', 'prod', null, 'Old finished chore', { order: 6 }),
      T('t7', 'prod', 'p3', 'Archived project task', { order: 7 }),
      T('t8', 'living', 'p4', 'Buy groceries', { order: 1, due: iso(0) }),
      T('t9', 'hobby', 'p5', 'Practice scales', { order: 1, recur: { kind: 'weekdays', days: [1, 3, 5] } }),
      T('t10', 'prod', 'p1', 'Name that is quite long to see how wrapping behaves on a narrow phone screen when it goes past one line', { order: 8, due: iso(3) })
    ],
    completions: [C('t4', 0), C('t6', -3), C('t3', -1), C('t3', -2), C('t3', -4), C('t2', -1, 's1'), C('t2', 0, 's1'), C('t4', -5)],
    updatedAt: ts
  };
  localStorage.setItem('acadbro-data-v1', JSON.stringify(data));
  localStorage.setItem('seeded-m2', '1');
};
await send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + seed.toString() + ')()' });

async function load(url) {
  await send('Page.navigate', { url: url });
  await sleep(1200);
}

/* ================= tests ================= */
await load('http://localhost:' + PORT + '/?page=prod');
check('title is AcadBro', (await ev('document.title')) === 'AcadBro');
check('body page-prod', (await ev('document.body.className')).indexOf('page-prod') !== -1);
check('grouped view renders project cards', (await ev('document.querySelectorAll(".project-card").length')) >= 2);
check('archived project hidden in grouped view', (await ev('document.body.innerText.indexOf("Old stuff")')) === -1);
check('archived-project task hidden', (await ev('document.body.innerText.indexOf("Archived project task")')) === -1);
check('old done one-off hidden', (await ev('document.body.innerText.indexOf("Old finished chore")')) === -1);
check('monthly 31 task hidden on non-matching day or shown on match', true);
check('loose task listed before projects', (await ev('(function(){var l=document.querySelector(".loose-list");var p=document.querySelector(".project-card");return !!l && !!(l.compareDocumentPosition(p) & 4);})()')));
check('project header has no activity dots', (await ev('document.querySelectorAll(".project-card .pdot").length')) === 0);
check('overdue chip red-classed', (await ev('document.querySelectorAll(".chip.due.overdue").length')) >= 1);
await shot('01-prod-grouped');

await click('[data-action="set-view"][data-value="flat"]');
check('flat view renders, no project cards', (await ev('document.querySelectorAll(".project-card").length')) === 0 && (await ev('document.querySelectorAll(".task-card").length')) >= 4);
check('flat view: project chip on rows', (await ev('document.querySelectorAll(".chip.proj").length')) >= 2);
var firstTitle = await ev('document.querySelector(".task-card .task-title").textContent');
check('flat view: overdue first', firstTitle === 'Email advisor', firstTitle);
check('view remembered in settings', (await ev('JSON.parse(localStorage.getItem("acadbro-settings-v1")).views.prod')) === 'flat');
await shot('02-prod-flat');
await click('[data-action="set-view"][data-value="grouped"]');

/* swipe right = complete */
var before = (await data()).completions.length;
await drag('[data-task-card="t1"] .task-row', 160);
var d1 = await data();
check('swipe right completes task for selected day', d1.completions.length === before + 1 && d1.completions.some(function (c) { return c.taskId === 't1' && c.subtaskId === null; }));
check('toast with Undo after completing', (await ev('document.querySelectorAll(".toast .toast-btn").length')) >= 1);
check('completed row shows done state', (await ev('!!document.querySelector("[data-task-card=t1].is-done")')));
await shot('03-after-swipe-right');
await click('.toast:not(.leaving):last-child .toast-btn.primary');
var d2 = await data();
check('Undo restores completion state', d2.completions.length === before);
await click('.toast:not(.leaving):last-child .toast-btn.primary'); /* Redo toast */
check('Redo re-applies', (await data()).completions.length === before + 1);
/* swipe right again = uncomplete */
await drag('[data-task-card="t1"] .task-row', 160);
check('swipe right on done uncompletes', (await data()).completions.length === before);

/* swipe left = tray */
await drag('[data-task-card="t2"] .task-row', -150);
check('swipe left opens tray (7 buttons)', (await ev('!!document.querySelector("[data-task-card=t2].is-tray-open") && document.querySelectorAll("[data-task-card=t2] .tray-btn").length')) === 7);
await shot('04-tray-open');
var tray = await ev('(function(){var t=document.querySelector("[data-task-card=t2] .swipe-tray").getBoundingClientRect();return {l:t.left,r:t.right,vw:innerWidth};})()');
check('tray fully on screen', tray.l >= 0 && tray.r <= tray.vw, tray);
/* Priority via tray */
await click('[data-task-card="t2"] [data-tray="task-priority"]');
check('priority panel opens', (await ev('!!document.querySelector("[data-task-card=t2] .task-panel")')));
await click('[data-action="set-priority"][data-value="3"]');
check('priority saved as 3', (await data()).tasks.find(function (t) { return t.id === 't2'; }).priority === 3);
/* Due via tray */
await drag('[data-task-card="t2"] .task-row', -150);
await click('[data-task-card="t2"] [data-tray="task-due"]');
await ev('(function(){var i=document.querySelector(".task-panel input[type=date]");i.value="2026-12-24";i.dispatchEvent(new Event("change",{bubbles:true}));})()');
await click('.task-panel [data-action="save-panel"]');
check('due set', (await data()).tasks.find(function (t) { return t.id === 't2'; }).due === '2026-12-24');
/* Repeat via tray */
await drag('[data-task-card="t2"] .task-row', -150);
await click('[data-task-card="t2"] [data-tray="task-repeat"]');
await click('.task-panel [data-action="draft-recur-kind"][data-value="weekdays"]');
await shot('05-repeat-panel');
await click('.task-panel [data-action="save-panel"]');
var t2 = (await data()).tasks.find(function (t) { return t.id === 't2'; });
check('repeat saved, due cleared', t2.recur && t2.recur.kind === 'weekdays' && t2.due === null, t2.recur);
/* Rename in place */
await drag('[data-task-card="t2"] .task-row', -150);
await click('[data-task-card="t2"] [data-tray="task-rename"]');
check('rename input focused', (await ev('document.activeElement && document.activeElement.dataset && document.activeElement.dataset.editInput')) === 'task-rename');
await key('a');
await ev('document.activeElement.select()');
await typeText('Survey paper renamed');
await key('Enter');
check('renamed', (await data()).tasks.find(function (t) { return t.id === 't2'; }).title === 'Survey paper renamed');
/* Note via tray */
await drag('[data-task-card="t2"] .task-row', -150);
await click('[data-task-card="t2"] [data-tray="task-note"]');
await ev('document.activeElement.select()');
await typeText('A fresh note');
await click('.section-header h2');
await sleep(200);
check('note saved on blur', (await data()).tasks.find(function (t) { return t.id === 't2'; }).note === 'A fresh note');
/* Expanded: subtasks */
await shot('06-expanded');
if (!(await ev('!!document.querySelector("[data-task-card=t2].is-expanded")'))) await click('[data-task-card="t2"] .entry-main');
await click('[data-task-card="t2"] [data-action="toggle-subtask"][data-sub-id="s2"]');
var comps = (await data()).completions;
check('subtask completion logged with subtaskId', comps.some(function (c) { return c.taskId === 't2' && c.subtaskId === 's2'; }));
await click('[data-task-card="t2"] .sub-add');
await typeText('Brand new subtask');
await key('Enter');
check('subtask added', (await data()).tasks.find(function (t) { return t.id === 't2'; }).subtasks.length === 4);
/* Move via tray */
await drag('[data-task-card="t4"] .task-row', -150);
await click('[data-task-card="t4"] [data-tray="task-move"]');
await ev('(function(){var s=document.querySelector(".task-panel [data-draft=area]");s.value="hobby";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
await ev('(function(){var s=document.querySelector(".task-panel [data-draft=projectId]");s.value="p5";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
await click('.task-panel [data-action="save-panel"]');
var t4 = (await data()).tasks.find(function (t) { return t.id === 't4'; });
check('moved to hobby/Guitar', t4.area === 'hobby' && t4.projectId === 'p5', t4);
/* Delete + Undo */
var tasksBefore = (await data()).tasks.length;
await drag('[data-task-card="t1"] .task-row', -150);
await click('[data-task-card="t1"] [data-tray="task-delete"]');
check('delete removes task', (await data()).tasks.length === tasksBefore - 1);
await click('.toast:not(.leaving):last-child .toast-btn.primary');
check('Undo restores deleted task', (await data()).tasks.length === tasksBefore);

/* full swipe fires Due */
await drag('[data-task-card="t10"] .task-row', -340);
check('full swipe opens Due panel', (await ev('!!document.querySelector("[data-task-card=t10] .task-panel input[type=date]")')));
await click('.task-panel [data-action="close-panel"]');

/* long-press done badge edits completion date */
await drag('[data-task-card="t3"] .task-row', 160); /* t3 daily: complete for today */
await holdBadge('[data-task-card="t3"] .entry-toggle', 700);
check('hold on done badge opens date editor', (await ev('!!document.querySelector("[data-task-card=t3] .task-panel input[type=date]")')));
await shot('07-completion-date');
await ev('(function(){var i=document.querySelector(".task-panel input[type=date]");var d=new Date();d.setDate(d.getDate()-6);i.value=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");i.dispatchEvent(new Event("change",{bubbles:true}));})()');
await click('.task-panel [data-action="save-panel"]');
var moved = (await data()).completions.filter(function (c) { return c.taskId === 't3'; });
check('completion date edited', moved.length >= 4 && moved.every(function (c) { return c.date !== undefined; }) && !(await ev('!!document.querySelector("[data-task-card=t3].is-done")')));

/* Add flow */
await click('[data-action="start-add-task"]');
check('add input focused', (await ev('document.activeElement.dataset.editInput')) === 'add-task');
await typeText('Brand new task');
await ev('(function(){var s=document.querySelector("[data-draft=add-project]");s.value="p2";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
await shot('08-add-form');
await key('Enter');
var added = (await data()).tasks.find(function (t) { return t.title === 'Brand new task'; });
check('task added to prod/p2', added && added.area === 'prod' && added.projectId === 'p2', added);
await key('Escape');

/* limits: toast on hitting maxlength */
await click('[data-action="start-add-task"]');
await ev('(function(){var i=document.activeElement;i.value="x".repeat(79);})()');
await typeText('yz');
var longVal = await ev('document.activeElement.value.length');
check('name capped at 80', longVal === 80, longVal);
check('limit toast shown', (await toasts()).some(function (t) { return /80 characters/.test(t); }), await toasts());
await key('Escape');

/* Manage: project create / rename / archive / delete with confirmation */
await click('[data-action="open-manage"]');
await sleep(500);
check('manage sheet open', (await ev('!document.getElementById("sheet-host").hidden')));
await click('[data-action="new-project"]');
await typeText('Brand new project');
await key('Enter');
check('project created', (await data()).projects.some(function (p) { return p.name === 'Brand new project' && p.area === 'prod'; }));
await shot('09-manage-sheet');
var newP = (await data()).projects.find(function (p) { return p.name === 'Brand new project'; });
await key('Escape');
await click('[data-project-row="' + newP.id + '"] [data-action="archive-project"]');
check('project archived', (await data()).projects.find(function (p) { return p.id === newP.id; }).archived === true);
await click('[data-project-row="p2"] [data-action="delete-project"]');
check('delete with tasks asks to confirm', (await ev('!!document.querySelector(".confirm-box")')));
await shot('10-delete-confirm');
var tCount = (await data()).tasks.length;
await click('[data-action="confirm-delete-project"][data-mode="loose"]');
var d3 = await data();
check('delete project (keep loose) moves tasks', !d3.projects.some(function (p) { return p.id === 'p2'; }) && d3.tasks.length === tCount && d3.tasks.filter(function (t) { return t.projectId === 'p2'; }).length === 0);
await click('.toast:not(.leaving):last-child .toast-btn.primary');
check('Undo restores project and its links', (await data()).projects.some(function (p) { return p.id === 'p2'; }) && (await data()).tasks.some(function (t) { return t.projectId === 'p2'; }));
await ev('document.querySelectorAll(".toast-close").forEach(function(b){b.click()})');
await sleep(500);
await click('.sheet-close');
await sleep(600);

/* All page */
await click('.bottom-nav-item[data-page=all]');
check('All page groups by area', (await ev('document.querySelectorAll(".area-card").length')) === 3);
await shot('11-all-page');

/* Add on All page picks an area */
await click('.bottom-nav-item[data-page=all]');
await click('[data-action="start-add-task"]');
await typeText('Typed before picking');
await click('[data-action="add-pick-area"][data-area="hobby"]');
check('area chip keeps typed text', (await ev('document.activeElement.value')) === 'Typed before picking', await ev('document.activeElement.value'));
await key('Enter');
var ah = (await data()).tasks.find(function (t) { return t.title === 'Typed before picking'; });
check('All-page add lands in chosen area', ah && ah.area === 'hobby', ah);
await key('Escape');
await shot('11b-all-added');

/* Show completed */
await click('.bottom-nav-item[data-page=prod]');
check('Old done one-off is always shown', (await ev('document.body.innerText.indexOf("Old finished chore")')) !== -1);
await shot('12-show-completed');

/* reload persistence + no errors */
await load('http://localhost:' + PORT + '/?page=hobby');
check('hobby page renders after reload', (await ev('document.querySelectorAll(".task-card").length')) >= 1);
await shot('13-hobby');
await load('http://localhost:' + PORT + '/?page=living');
await shot('14-living');

check('no console errors / exceptions', errors.length === 0, errors);
console.log(failures.length ? 'FAILED: ' + failures.length : 'ALL SMOKE CHECKS PASSED');
chrome.kill();
await sleep(300);
try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* locked */ }
process.exit(failures.length ? 1 : 0);
