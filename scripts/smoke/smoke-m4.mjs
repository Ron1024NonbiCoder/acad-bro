/* Headless smoke for M4 via raw CDP (no deps). Usage: node scripts/smoke/smoke-m4.mjs <port> */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* Needs the dev server running: node scripts/serve.mjs  (pass the port it logs).
   Output (screenshots, throwaway Chrome profile) goes to $SMOKE_OUT or <os tmp>/acadbro-smoke. */
var PORT = process.argv[2] || process.env.SMOKE_PORT;
if (!PORT) { console.error('usage: node scripts/smoke/smoke-m4.mjs <port>'); process.exit(2); }
var SCR = process.env.SMOKE_OUT || path.join(os.tmpdir(), 'acadbro-smoke');

var SHOTS = path.join(SCR, 'm4-shots');
fs.mkdirSync(SHOTS, { recursive: true });
var CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var DBG = 9351;
var prof = path.join(SCR, 'prof-m4-' + Date.now());

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

/* ---- seed ---- */
var seed = function () {
  if (localStorage.getItem('seeded-m4')) return;
  function iso(off) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var ts = '2026-10-01T00:00:00.000Z';
  function P(id, area, name, o) { return Object.assign({ id: id, area: area, name: name, note: '', archived: false, order: 1, createdAt: ts, updatedAt: ts }, o || {}); }
  function T(id, area, pid, title, o) { return Object.assign({ id: id, area: area, projectId: pid, title: title, note: '', priority: 0, due: null, recur: null, subtasks: [], order: 1, createdAt: ts, updatedAt: ts }, o || {}); }
  var c = 0;
  function C(taskId, off, sub) { return { id: 'c' + (c++), taskId: taskId, subtaskId: sub || null, date: iso(off), at: ts }; }
  var comps = [C('t2', -1, 's1'), C('t2', -3, 's1'), C('t6', -2), C('t8', 0), C('t9', -4)];
  for (var i = 0; i < 80; i += 2) { comps.push(C('t3', -i)); if (i % 6 === 0) comps.push(C('t4', -i)); if (i % 10 === 0) { comps.push(C('t10', -i)); comps.push(C('t11', -i)); comps.push(C('t12', -i)); } }
  var data = {
    schema: 1,
    areaLabels: { living: 'Living', prod: 'Prod', hobby: 'Hobby' },
    projects: [P('p1', 'prod', 'Thesis', { order: 1 }), P('p2', 'prod', 'A very long project name that has to be cut off with an ellipsis on a phone', { order: 2 }), P('p3', 'prod', 'Old stuff', { order: 3, archived: true }), P('p4', 'living', 'Home', { order: 1 }), P('p5', 'hobby', 'Guitar', { order: 1 })],
    tasks: [
      T('t2', 'prod', 'p1', 'Read paper', { subtasks: [{ id: 's1', title: 'Abstract' }] }),
      T('t3', 'prod', 'p1', 'Daily', { recur: { kind: 'weekdays', days: [0, 1, 2, 3, 4, 5, 6] } }),
      T('t4', 'prod', 'p2', 'Submit form'),
      T('t6', 'prod', null, 'Loose chore'),
      T('t7', 'prod', 'p3', 'Archived task'),
      T('t8', 'living', 'p4', 'Groceries'),
      T('t9', 'hobby', 'p5', 'Scales'),
      T('t10', 'prod', 'p1', 'Many a'), T('t11', 'prod', 'p1', 'Many b'), T('t12', 'prod', 'p1', 'Many c')
    ],
    completions: comps.concat([C('t7', -1)]),
    updatedAt: ts
  };
  localStorage.setItem('acadbro-data-v1', JSON.stringify(data));
  localStorage.setItem('seeded-m4', '1');
};
await send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + seed.toString() + ')()' });
async function load(url) { await send('Page.navigate', { url: url }); await sleep(1200); }
var noHScroll = async function () { var r = await ev('(function(){var w=innerWidth;var bad=[];document.querySelectorAll(".review-board, .review-board *").forEach(function(e){var b=e.getBoundingClientRect();if(b.width&&b.right>w+0.5&&!e.closest(".strip-grid"))bad.push(e.className+":"+Math.round(b.right))});return {de:document.documentElement.scrollWidth,bw:document.body.scrollWidth,w:w,bad:bad.slice(0,6)}})()'); if (r.de > r.w || r.bad.length) console.log('   hscroll detail', JSON.stringify(r)); return r.de <= r.w && r.bad.length === 0; };

await load('http://localhost:' + PORT + '/?page=prod');
check('title is AcadBro', (await ev('document.title')) === 'AcadBro');
check('placeholder note gone', (await ev('document.body.innerText.indexOf("Completed tasks show up here")')) === -1);
check('prod rows: loose + 2 non-archived projects', (await ev('document.querySelectorAll(".rb-item").length')) === 3, await ev('document.querySelectorAll(".rb-item").length'));
check('archived project hidden', (await ev('document.querySelector(".review-board").innerText.indexOf("Old stuff")')) === -1);
check('7 dots per row', (await ev('Array.from(document.querySelectorAll(".rb-item")).every(function(r){return r.querySelectorAll(".rb-dot-btn").length===7})')));
check('Thesis row has filled dots', (await ev('document.querySelectorAll("[data-review-row=\\"p:p1\\"] .rb-dot.on").length')) >= 3);
check('Loose row dot filled for -2 only', (await ev('document.querySelectorAll("[data-review-row=\\"loose:prod\\"] .rb-dot.on").length')) === 1);
check('no streak wording', (await ev('/streak/i.test(document.body.innerText)')) === false);
check('no horizontal scroll 390', await noHScroll());
await shot('m4-01-prod-board');

await click('[data-action="review-row"][data-key="p:p1"]');
check('heatmap opens in place', (await ev('document.querySelectorAll(".hm").length')) === 1);
check('12 week columns', (await ev('document.querySelectorAll(".hm-months span").length')) === 12);
check('84 cells', (await ev('document.querySelectorAll(".hm-grid .hm-c").length')) === 84);
check('some intensity-4 cell', (await ev('document.querySelectorAll(".hm-grid .hm-c.l4").length')) >= 1);
check('Mon-first grid: first cell is a Monday', (await ev('(function(){var b=document.querySelector(".hm-grid button.hm-c");var d=new Date(b.dataset.date+"T00:00:00");return d.getDay()})()')) === 1);
check('no horizontal scroll with heatmap', await noHScroll());
var hmBox = await ev('(function(){var r=document.querySelector(".hm").getBoundingClientRect();return {l:r.left,r:r.right,w:innerWidth}})()');
check('heatmap inside viewport', hmBox.l >= 0 && hmBox.r <= hmBox.w, hmBox);
var cellW = await ev('document.querySelector(".hm-grid button.hm-c").getBoundingClientRect().width');
check('heatmap cells >= 14px', cellW >= 14, cellW);
await shot('m4-02-heatmap-open');

await click('.hm-grid button.hm-c.l4');
var lbl = await ev('document.querySelector(".hm-label").textContent');
check('cell tap shows date + count in label', /\d+ tasks? done/.test(lbl) && /,/.test(lbl), lbl);
check('no modal opened', (await ev('document.getElementById("sheet-host").hidden')) === true);
check('picked cell ringed', (await ev('document.querySelectorAll(".hm-c.is-picked").length')) === 1);
await shot('m4-03-cell-label');

await click('[data-action="review-row"][data-key="p:p2"]');
check('only one heatmap at a time', (await ev('document.querySelectorAll(".hm").length')) === 1 && (await ev('!!document.querySelector("[data-review-row=\\"p:p2\\"] .hm")')));
check('empty-ish project shows friendly hint', /Tap a square|Complete a task/.test(await ev('document.querySelector(".hm-label").textContent')));

await click('[data-action="review-row"][data-key="p:p2"]');
check('tap again closes', (await ev('document.querySelectorAll(".hm").length')) === 0);

/* dot -> jumps the day strip */
var todayHeading = await ev('document.querySelector(".section-header h2").textContent');
await click('[data-review-row="p:p1"] .rb-dot-btn:nth-of-type(3)');
var h2 = await ev('document.querySelector(".section-header h2").textContent');
check('dot tap jumps the day', h2 !== todayHeading && /Yesterday|,/.test(h2), [todayHeading, h2]);
check('board now ends on the selected day (one is-sel head)', (await ev('document.querySelectorAll(".rb-day.is-sel").length')) === 1);
await shot('m4-04-after-dot-jump');
await click('[data-action="nav-today"]');

/* fold */
await click('[data-action="review-fold"]');
check('fold hides rows', (await ev('document.querySelectorAll(".rb-item").length')) === 0);
check('fold remembered', (await ev('JSON.parse(localStorage.getItem("acadbro-settings-v1")).reviewShown')) === false);
await click('[data-action="review-fold"]');
check('unfold shows rows', (await ev('document.querySelectorAll(".rb-item").length')) === 3);

/* All page: grouped by area */
await click('.bottom-nav-item[data-page=all]');
check('All: area group labels', (await ev('document.querySelectorAll(".rb-group").length')) === 3);
check('All: rows = prod 3 + living 1 + hobby 1', (await ev('document.querySelectorAll(".rb-item").length')) === 5, await ev('document.querySelectorAll(".rb-item").length'));
await click('[data-action="review-row"][data-key="p:p4"]');
await shot('m4-05-all');
await click('.bottom-nav-item[data-page=hobby]');
check('hobby page renders board', (await ev('document.querySelectorAll(".rb-item").length')) === 1);
await click('.bottom-nav-item[data-page=living]');
check('living page renders board', (await ev('document.querySelectorAll(".rb-item").length')) === 1);

/* week start Sunday */
await ev('(function(){var s=JSON.parse(localStorage.getItem("acadbro-settings-v1")||"{}");s.weekStart="sun";localStorage.setItem("acadbro-settings-v1",JSON.stringify(s));})()');
await load('http://localhost:' + PORT + '/?page=prod');
await click('[data-action="review-row"][data-key="p:p1"]');
check('Sunday-first grid: first cell is a Sunday', (await ev('(function(){var b=document.querySelector(".hm-grid button.hm-c");return new Date(b.dataset.date+"T00:00:00").getDay()})()')) === 0);

/* 360px */
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
await load('http://localhost:' + PORT + '/?page=prod');
await click('[data-action="review-row"][data-key="p:p1"]');
check('no horizontal scroll 360 (heatmap open)', await noHScroll());
var nm = await ev('(function(){var n=document.querySelector("[data-review-row=\\"p:p2\\"] .rb-name");return {sw:n.scrollWidth,cw:n.clientWidth,w:n.getBoundingClientRect().width}})()');
check('long project name is clipped, not overflowing', nm.w <= 90, nm);
var dotW = await ev('document.querySelector(".rb-dot-btn").getBoundingClientRect().width');
check('dot hit target >= 24px wide at 360', dotW >= 24, dotW);
await shot('m4-06-360');

check('no console errors / exceptions', errors.length === 0, errors);
console.log(failures.length ? 'FAILED: ' + failures.length : 'ALL SMOKE CHECKS PASSED');
chrome.kill();
await sleep(300);
try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* locked */ }
process.exit(failures.length ? 1 : 0);
