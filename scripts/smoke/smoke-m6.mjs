/* M6 steps 1-2 headless smoke. Chrome over CDP, local static server only (no network to Firebase).
   usage: node scripts/smoke/smoke-m6.mjs [webRoot] [label]   (webRoot defaults to <repo>/web)
   Prints PASS/FAIL lines; exit 1 on any FAIL. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web'));
const LABEL = process.argv[3] || 'run';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
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

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); /* deterministic timing */
  console.log('--- ' + LABEL + ' (' + BASE + ', ' + ROOT + ')');

  /* ===== Step 1a at 390px ===== */
  await load(390);
  check('app loaded with 3 tasks', await ev(`document.querySelectorAll('[data-task-card]').length`) === 3);

  /* rename -> tap another task's tray button (note editor opens on t2) */
  await tapTray('t1', 'task-rename');
  check('rename editor open', await until(`document.activeElement && document.activeElement.dataset && document.activeElement.dataset.editInput === 'task-rename'`));
  await send('Input.insertText', { text: ' Edited' });
  await tapTray('t2', 'task-note');
  let ok = await until(`!!document.querySelector('[data-edit-input="task-note"]')`, 2000);
  let d = await stored();
  check('rename: tapped action ran (note editor opened on Beta)', ok);
  check('rename: edit saved', d.tasks.find((t) => t.id === 't1').title.indexOf('Edited') !== -1, JSON.stringify(d.tasks[0].title));
  check('rename: "Renamed to" toast shown', (await toastTexts()).some((s) => /Renamed to/.test(s)), JSON.stringify(await toastTexts()));

  /* note editor (t2 is open now) -> tap t3 tray rename */
  await send('Input.insertText', { text: 'my note' });
  await tapTray('t3', 'task-rename');
  ok = await until(`document.activeElement && document.activeElement.dataset && document.activeElement.dataset.editInput === 'task-rename'`, 2000);
  d = await stored();
  check('note: tapped action ran (rename editor opened on Gamma)', ok);
  check('note: note saved', d.tasks.find((t) => t.id === 't2').note === 'my note', JSON.stringify(d.tasks[1].note));

  /* Esc cancels the open rename */
  await send('Input.insertText', { text: ' ZZZ' });
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(500);
  d = await stored();
  check('Esc: editor closed', await ev(`!document.querySelector('[data-edit-input]:not([data-edit-input="add-subtask"])')`));
  check('Esc: nothing saved', d.tasks.find((t) => t.id === 't3').title === 'Gamma', d.tasks[2].title);

  /* add editor -> tap tray button on t1 */
  await tap('[data-action="start-add-task"]');
  check('add editor open', await until(`document.activeElement && document.activeElement.dataset && document.activeElement.dataset.editInput === 'add-task'`));
  await send('Input.insertText', { text: 'Delta' });
  await tapTray('t2', 'task-rename');
  ok = await until(`document.activeElement && document.activeElement.dataset && document.activeElement.dataset.editInput === 'task-rename'`, 2000);
  d = await stored();
  check('add: tapped action ran (rename editor opened on Beta)', ok);
  check('add: task added', d.tasks.some((t) => t.title === 'Delta'), JSON.stringify(d.tasks.map((t) => t.title)));
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(300);

  /* a scroll/drag gesture starting on a row still commits (after the wait) */
  await tapTray('t3', 'task-rename');
  await until(`document.activeElement && document.activeElement.dataset && document.activeElement.dataset.editInput === 'task-rename'`, 2000);
  await send('Input.insertText', { text: ' Dragged' });
  const c = await centre('[data-task-card="t1"] .entry-main');
  await mouseDrag(c.x, c.y, 120);
  ok = await until(`JSON.parse(localStorage.getItem('acadbro-data-v1')).tasks.some(function(t){return /Dragged/.test(t.title);})`, 3000);
  check('mouse drag: edit still commits', ok);
  check('mouse drag: no tapped action ran (Alpha not expanded)', await ev(`!document.querySelector('[data-task-card="t1"].is-expanded')`));

  /* plain blur (tap empty area) still commits */
  await tapTray('t1', 'task-rename');
  await until(`document.activeElement && document.activeElement.dataset && document.activeElement.dataset.editInput === 'task-rename'`, 2000);
  await send('Input.insertText', { text: '!' });
  const blank = await ev(`(function(){var r=document.querySelector('.app-header, header, .topbar')||document.body;var b=r.getBoundingClientRect();return{x:b.left+4,y:b.top+4};})()`);
  await tapAt(blank.x, blank.y);
  ok = await until(`JSON.parse(localStorage.getItem('acadbro-data-v1')).tasks.find(function(t){return t.id==='t1';}).title.slice(-1)==='!'`, 2000);
  check('plain blur: edit commits', ok);

  /* ===== Step 1b at 360 and 390 ===== */
  for (const w of [360, 390]) {
    await load(w);
    await ev(`import('/js/toast.js').then(function(m){ ['One','Two','Three'].forEach(function(s,i){ m.showToast({message:'Toast '+s+' with a longer message to take space', actions:[{label:'Undo',primary:true,onClick:function(){}}]}); }); return 1; })`);
    await tap('[data-action="open-manage"]');
    await until(`document.body.classList.contains('sheet-open')`, 2000);
    await sleep(700); /* sheet + toast slide transitions */
    const info = await ev(`(function(){var b=document.querySelector('.sheet-close');var r=b.getBoundingClientRect();var cx=r.left+r.width/2,cy=r.top+r.height/2;var el=document.elementFromPoint(cx,cy);
      var corners=[[cx-8,cy],[cx+8,cy],[cx,cy-8],[cx,cy+8]].map(function(p){var e=document.elementFromPoint(p[0],p[1]);return !!(e&&e.closest('.sheet-close'));});
      return {toasts:document.querySelectorAll('.toast').length,hit:!!(el&&el.closest('.sheet-close')),hitTag:el&&(el.className||el.tagName),corners:corners,
      sheetTop:document.querySelector('.sheet').getBoundingClientRect().top, closeTop:r.top, hostRight:getComputedStyle(document.getElementById('toast-host')).right, hostLeft:document.getElementById('toast-host').getBoundingClientRect().left, vw:innerWidth};})()`);
    check(`${w}px: 3 toasts shown`, info.toasts === 3, JSON.stringify(info));
    check(`${w}px: elementFromPoint at close-button centre is the close button`, info.hit, 'got ' + info.hitTag);
    check(`${w}px: close button reachable 8px around the centre`, info.corners.every(Boolean), JSON.stringify(info.corners));
    check(`${w}px: toast stack stays on screen`, info.hostLeft >= 0, 'left=' + info.hostLeft);
    /* negative control: with the old position the toasts should cover it, proving the probe can see it */
    await ev(`var s=document.createElement('style');s.id='neg';s.textContent='body.sheet-open .toast-host{right:10px !important;max-width:min(360px,calc(100vw - 20px)) !important;transition:none !important}';document.head.appendChild(s);true`);
    await sleep(100);
    const neg = await ev(`(function(){var r=document.querySelector('.sheet-close').getBoundingClientRect();var el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!(el&&el.closest('.sheet-close'));})()`);
    console.log('  (negative control, old toast position: close button ' + (neg ? 'still reachable' : 'COVERED - probe is sensitive') + ')');
    await ev(`document.getElementById('neg').remove();true`);
  }

  /* ===== Step 2 UI: import sheet with over-limit data ===== */
  await load(390);
  const big = JSON.stringify({ schema: 1, tasks: Array.from({ length: 5200 }, (_, i) => ({ id: 'x' + i, title: 'a' })) });
  const before = await ev(`localStorage.getItem('acadbro-data-v1')`);
  await ev(`(function(){var dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(big)}],'big.json',{type:'application/json'}));
    window.__go=function(){ };
    return import('/js/page-settings.js').then(function(m){ return m.onImportFile(dt.files[0]); }); })()`);
  await until(`document.body.classList.contains('sheet-open')`, 2000);
  const sheetText = await ev(`document.querySelector('.sheet-body').textContent`);
  check('import over limit: sheet states the count precisely', /This file has 5200 tasks\. AcadBro holds up to 5000; please trim the file and import again\./.test(sheetText), sheetText.slice(0, 160));
  check('import over limit: no Replace button', await ev(`!document.querySelector('[data-action="confirm-import"]')`));
  check('import over limit: data unchanged', (await ev(`localStorage.getItem('acadbro-data-v1')`)) === before);
  const bigFile = await ev(`import('/js/page-settings.js').then(function(m){ return m.onImportFile({ name:'huge.json', size: 3*1024*1024, text:function(){ throw new Error('must not be read'); } }); }).then(function(){ return Array.from(document.querySelectorAll('.toast-msg')).map(function(e){return e.textContent;}); })`);
  check('import > 2 MB: refused before reading, reason toasted', bigFile.some((s) => /3\.0 MB.*up to 2 MB/.test(s)), JSON.stringify(bigFile));
  const loginHtml = await ev(`import('/js/page-account.js').then(function(){ return 1; })`);
  /* login field limits */
  await ev(`import('/js/state.js').then(function(){return 1;})`);
} catch (e) {
  console.log('ERROR ' + e.stack);
  fails++;
} finally {
  try { ws.close(); } catch (e) { /* ignore */ }
  chrome.kill();
  server.close();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* locked profile is fine */ }
}
console.log(fails ? 'RESULT: ' + fails + ' FAIL' : 'RESULT: all passed');
process.exit(fails ? 1 : 0);
