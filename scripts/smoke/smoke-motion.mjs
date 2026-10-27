/* M6 step 4 headless smoke (layout shift / reduced motion). Chrome over CDP, local static server only (no network to Firebase).
   usage: node scripts/smoke/smoke-motion.mjs [webRoot] [label]   (webRoot defaults to <repo>/web)
   Prints PASS/FAIL lines; exit 1 on any FAIL. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web'));
const LABEL = process.argv[3] || 'run';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

let fails = 0;
function check(name, ok, extra) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!ok) fails++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- static server on the OS-picked port ---- */
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = 'http://127.0.0.1:' + PORT;

/* ---- chrome ---- */
const dbgPort = 9400 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'acadbro-smoke-'));
const chrome = spawn(CHROME, ['--headless=new', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1' /* offline guard: only the local server resolves */, '--remote-debugging-port=' + dbgPort, '--remote-allow-origins=*', '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
async function waitJson(url) {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) { /* not up yet */ } await sleep(250); }
  throw new Error('chrome did not start');
}
const list = await waitJson('http://127.0.0.1:' + dbgPort + '/json/list');
const pageInfo = list.find((t) => t.type === 'page');
const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
function send(method, params) { return new Promise((res, rej) => { const i = ++id; pending.set(i, (d) => d.error ? rej(new Error(method + ': ' + JSON.stringify(d.error))) : res(d.result)); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }); }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails));
  return r.result.value;
}
async function until(expr, ms) { const t = Date.now(); while (Date.now() - t < (ms || 2500)) { if (await ev(expr)) return true; await sleep(60); } return false; }

async function setViewport(w, h) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
async function tapAt(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(40);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function mouseDrag(x, y, dy) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i++) { await sleep(16); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y + (dy * i) / 8, button: 'left', buttons: 1 }); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: y + dy, button: 'left', clickCount: 1 });
}
async function dragFrom(x, y, dy) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) { await sleep(16); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 8 }] }); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const centre = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center'});var r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
async function tap(sel) { const c = await centre(sel); if (!c) throw new Error('no element ' + sel); await tapAt(c.x, c.y); }
/* make a task's tray tappable without a swipe (class only; no app state), then tap its button */
async function tapTray(taskId, name) {
  await ev(`document.querySelector('[data-task-card="${taskId}"]').classList.add('is-tray-open')`);
  await sleep(350); /* tray slide transition */
  await tap(`[data-task-card="${taskId}"] [data-tray="${name}"]`);
}
const stored = () => ev(`JSON.parse(localStorage.getItem('acadbro-data-v1'))`);
const toastTexts = () => ev(`Array.from(document.querySelectorAll('.toast-msg')).map(function(e){return e.textContent;})`);

function seed() {
  const t = (i, title) => ({ id: 't' + i, area: 'prod', projectId: null, title, note: '', priority: 0, due: null, recur: null, subtasks: [], order: i, createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z' });
  const projects = Array.from({ length: 30 }, (_, i) => ({ id: 'p' + i, area: 'prod', name: 'Project ' + i, note: '', archived: false, order: i, createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z' }));
  return JSON.stringify({ schema: 1, areaLabels: { living: 'Living', prod: 'Prod', hobby: 'Hobby' }, projects, tasks: [t(1, 'Alpha'), t(2, 'Beta'), t(3, 'Gamma')], completions: [], updatedAt: '2026-10-27T00:00:00.000Z' });
}
async function load(w) {
  await setViewport(w, 844);
  await send('Page.navigate', { url: BASE + '/index.html' });
  await sleep(500);
  await ev(`localStorage.clear(); localStorage.setItem('acadbro-data-v1', ${JSON.stringify(seed())}); true`);
  await send('Page.navigate', { url: BASE + '/index.html?page=prod' });
  await until(`!!document.querySelector('[data-task-card="t1"]')`, 6000);
  await sleep(300);
}


/* ===================== M6 step 4: transitions / layout jumps =====================
   screenshots -> $SMOKE_OUT/motion-shots/<label>-*.png (default <os tmp>/acadbro-smoke) */
const SHOTS = path.join(process.env.SMOKE_OUT || path.join(os.tmpdir(), 'acadbro-smoke'), 'motion-shots');
fs.mkdirSync(SHOTS, { recursive: true });
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(SHOTS, LABEL + '-' + name + '.png');
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  return f;
}
const OBS = `(function(){ if (window.__lsObs) return true; window.__ls = [];
  window.__lsObs = new PerformanceObserver(function(l){ l.getEntries().forEach(function(e){ window.__ls.push({ v: +e.value.toFixed(4), recent: e.hadRecentInput, t: Math.round(e.startTime) }); }); });
  window.__lsObs.observe({ type: 'layout-shift', buffered: false }); return true; })()`;
const resetLs = () => ev(`(window.__ls = [], true)`);
const lsNow = () => ev(`window.__ls.slice()`);
/* sample an element's top on each frame for ms: how many distinct positions it passes through */
const trackTop = (sel, ms) => `window.__track = new Promise(function(res){ var out=[]; var t0=performance.now();
  (function f(){ var e=document.querySelector(${JSON.stringify(sel)}); out.push(e ? Math.round(e.getBoundingClientRect().top) : null);
  if (performance.now()-t0 < ${ms}) requestAnimationFrame(f); else res(out); })(); }); true`;
const distinct = (a) => Array.from(new Set(a.filter((x) => x !== null)));
const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
};
const allShots = [];

async function flows(mode) {
  const reduce = mode === 'reduce';
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
  await load(390);
  await ev(OBS);
  await sleep(400);
  await resetLs();
  const tag = mode + '-';

  /* ---- flow a: open the Add editor ---- */
  await ev(trackTop('[data-task-card="t1"]', 450));
  await tap('[data-action="start-add-task"]');
  await sleep(50);
  const aMid = await ev(`(function(){var w=document.querySelector('.ed-enter');return w?{h:w.getBoundingClientRect().height,op:getComputedStyle(w).opacity,anim:getComputedStyle(w).animationName}:null;})()`);
  allShots.push(await shot(tag + 'a-editor-mid'));
  const aTrack = await ev(`window.__track`);
  await sleep(200);
  const aEnd = await ev(`(function(){var w=document.querySelector('.ed-enter');var a=document.activeElement;var f=document.querySelector('.add-form');return {wrap:!!w, h:f&&f.parentNode&&f.parentNode.parentNode.getBoundingClientRect().height, op:w&&getComputedStyle(w).opacity, focused:!!(a&&a.dataset&&a.dataset.editInput==='add-task')};})()`);
  allShots.push(await shot(tag + 'a-editor-end'));
  check(`[${mode}] a: Add editor open and focused`, aEnd.focused, JSON.stringify(aEnd));
  if (reduce) check(`[${mode}] a: no expand animation`, !aMid || aMid.anim === 'none', JSON.stringify(aMid));
  else {
    check(`[${mode}] a: editor expands (mid height < end height, fading)`, aMid && aMid.h < aEnd.h && Number(aMid.op) < 1, JSON.stringify(aMid) + ' end ' + JSON.stringify(aEnd));
    check(`[${mode}] a: row below moves in steps, not one jump`, distinct(aTrack).length >= 3, JSON.stringify(distinct(aTrack)));
  }
  /* a later re-render (Enter adds, form stays open) must not replay the expand */
  await send('Input.insertText', { text: 'Zeta' });
  await key('Enter', 'Enter', 13);
  await sleep(300);
  check(`[${mode}] a: Enter adds; form stays open without replaying the expand`, (await stored()).tasks.some((t) => t.title === 'Zeta') && await ev(`!!document.querySelector('[data-edit-input="add-task"]') && !document.querySelector('.ed-enter')`));
  await key('Escape', 'Escape', 27);
  await sleep(300);
  /* note editor through the tray */
  await tapTray('t2', 'task-note');
  await sleep(40);
  const noteWrap = await ev(`!!document.querySelector('.ed-enter .task-note-edit')`);
  await sleep(300);
  check(`[${mode}] a: note editor opens (wrapped on open, focused)`, noteWrap && await ev(`!!document.activeElement && document.activeElement.dataset.editInput === 'task-note'`), 'wrapped=' + noteWrap);
  await key('Escape', 'Escape', 27);
  await sleep(400);
  let ls = await lsNow();
  check(`[${mode}] a: no layout shift without recent input`, ls.every((e) => e.recent), JSON.stringify(ls));

  /* ---- flow b: fold the review board ---- */
  await ev(`window.scrollTo(0,0); true`);
  await sleep(200);
  await resetLs();
  const bodyH = await ev(`(function(){var b=document.querySelector('.rb-body');return b?b.getBoundingClientRect().height:0;})()`);
  await ev(trackTop('.section-header', 600));
  const top = await ev(`(function(){var r=document.querySelector('.rb-top').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await tapAt(top.x, top.y);
  await sleep(70);
  const bMid = await ev(`(function(){var b=document.querySelector('.rb-body');return b?{closing:b.classList.contains('rb-closing'),h:b.getBoundingClientRect().height}:null;})()`);
  allShots.push(await shot(tag + 'b-fold-mid'));
  const bTrack = await ev(`window.__track`);
  await sleep(200);
  check(`[${mode}] b: board folded (body removed after the collapse)`, await ev(`!document.querySelector('.rb-body') && document.querySelector('.rb-top').getAttribute('aria-expanded') === 'false'`), 'bodyH ' + bodyH);
  allShots.push(await shot(tag + 'b-fold-end'));
  if (reduce) check(`[${mode}] b: folds at once (no collapse step)`, !bMid, JSON.stringify(bMid));
  else {
    check(`[${mode}] b: collapse animates (mid height between 0 and full)`, bMid && bMid.closing && bMid.h > 0 && bMid.h < bodyH, JSON.stringify(bMid) + ' full ' + bodyH);
    check(`[${mode}] b: section header slides up in steps, not one jump`, distinct(bTrack).length >= 3, JSON.stringify(distinct(bTrack)));
  }
  await tapAt(top.x, top.y);
  await sleep(400);
  check(`[${mode}] b: board reopens`, await ev(`!!document.querySelector('.rb-body')`));
  ls = await lsNow();
  check(`[${mode}] b: no layout shift without recent input`, ls.every((e) => e.recent), JSON.stringify(ls));

  /* ---- flow c: page changes (tab, Settings in/out) ---- */
  await resetLs();
  /* toasts from flow a sit top-right over the header gear; clear them so the taps below land */
  await ev(`import('/js/toast.js').then(function(m){ m.dismissAllToasts(); return true; })`);
  await sleep(300);
  await ev(`window.__op = []; (function f(){ window.__op.push({ op: +Number(getComputedStyle(document.getElementById('app-root')).opacity).toFixed(2), living: document.body.classList.contains('page-living') }); if (window.__op.length < 45) requestAnimationFrame(f); })();
    window.__swapOp = null; var mo = new MutationObserver(function(){ if (window.__swapOp === null && document.body.classList.contains('page-living')) { window.__swapOp = +Number(getComputedStyle(document.getElementById('app-root')).opacity).toFixed(2); mo.disconnect(); } });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] }); true`);
  await tap('.bottom-nav-item[data-page="living"]');
  await sleep(60);
  allShots.push(await shot(tag + 'c-swap-mid'));
  await sleep(450);
  const frames = await ev('window.__op');
  const cMid = { out: frames.some((x) => !x.living && x.op < 1), inn: frames.some((x) => x.living && x.op < 1), opacityAtSwap: await ev('window.__swapOp') };
  const cEnd = await ev(`(function(){var r=document.getElementById('app-root');return{out:r.classList.contains('swap-out'),op:Number(getComputedStyle(r).opacity),page:document.body.className};})()`);
  allShots.push(await shot(tag + 'c-swap-end'));
  check(`[${mode}] c: tab switch lands on Living, fully visible`, /page-living/.test(cEnd.page) && !cEnd.out && cEnd.op === 1, JSON.stringify(cEnd));
  if (reduce) check(`[${mode}] c: no fade (switched at once)`, !cMid.out && !cMid.inn, JSON.stringify(cMid));
  else check(`[${mode}] c: old view fades out, swap happens hidden, new view fades in`, cMid.out && cMid.inn && cMid.opacityAtSwap === 0, JSON.stringify(cMid));
  await tap('.app-header [data-action="open-settings"]:not(.hidden)');
  await sleep(reduce ? 150 : 500);
  check(`[${mode}] c: Settings opens`, await ev(`document.body.classList.contains('view-settings') && !!document.querySelector('[data-action="close-settings"]') && Number(getComputedStyle(document.getElementById('app-root')).opacity) === 1`));
  await tap('[data-action="close-settings"]');
  await sleep(reduce ? 150 : 500);
  check(`[${mode}] c: Settings closes back to Living`, await ev(`!document.body.classList.contains('view-settings') && document.body.classList.contains('page-living') && Number(getComputedStyle(document.getElementById('app-root')).opacity) === 1`));
  /* rapid double switch: nothing dropped, ends on the last one */
  await tap('.bottom-nav-item[data-page="prod"]');
  await sleep(30);
  await tap('.bottom-nav-item[data-page="all"]');
  await sleep(500);
  check(`[${mode}] c: rapid taps end on the last page`, await ev(`document.body.classList.contains('page-all') && !document.getElementById('app-root').classList.contains('swap-out')`));
  ls = await lsNow();
  check(`[${mode}] c: no layout shift without recent input`, ls.every((e) => e.recent), JSON.stringify(ls));
  console.log('  [' + mode + '] input-driven shifts in flow c (excluded, informational): ' + ls.length);
}

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  console.log('--- ' + LABEL + ' (' + ROOT + ')');
  await flows('motion');
  await flows('reduce');
} catch (e) {
  console.log('ERROR ' + e.stack);
  fails++;
} finally {
  try { ws.close(); } catch (e) { /* ignore */ }
  chrome.kill();
  server.close();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* locked */ }
}
console.log('  shots:\n    ' + allShots.join('\n    '));
console.log(fails ? 'RESULT: ' + fails + ' FAIL' : 'RESULT: all passed');
process.exit(fails ? 1 : 0);
