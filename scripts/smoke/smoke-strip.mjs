/* M7 headless smoke: expandable day strip (month grid) + done circles. Chrome over CDP, local static server only.
   usage: node scripts/smoke/smoke-strip.mjs [webRoot] [label]   (webRoot defaults to <repo>/web)
   Prints PASS/FAIL lines; exit 1 on any FAIL. Runs at 390 and 360px; the circle checks also run with reduced motion. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[2] || path.join(HERE, '..', '..', 'web'));
const LABEL = process.argv[3] || 'run';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const core = await import(new URL('file:///' + path.join(ROOT, 'js', 'tasks-core.js').replace(/\\/g, '/')));
const utils = await import(new URL('file:///' + path.join(ROOT, 'js', 'utils.js').replace(/\\/g, '/')));

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
const BASE = 'http://127.0.0.1:' + server.address().port;

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
const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'assert')) errors.push('console.' + d.params.type + ': ' + d.params.args.map((a) => a.value || a.description).join(' '));
  if (d.method === 'Runtime.exceptionThrown') { const x = d.params.exceptionDetails; errors.push('exception: ' + (x.exception && x.exception.description || x.text)); }
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push('log: ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
};
function send(method, params) { return new Promise((res, rej) => { const i = ++id; pending.set(i, (d) => d.error ? rej(new Error(method + ': ' + JSON.stringify(d.error))) : res(d.result)); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }); }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails));
  return r.result.value;
}
async function until(expr, ms) { const t = Date.now(); while (Date.now() - t < (ms || 2500)) { if (await ev(expr)) return true; await sleep(40); } return false; }

async function setViewport(w, h) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
async function tapAt(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(40);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function swipe(x, y, dx, dy) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) { await sleep(16); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }] }); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const centre = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
async function tap(sel) { const c = await centre(sel); if (!c) throw new Error('no element ' + sel); await tapAt(c.x, c.y); }
const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
};

/* ---- seed: three areas, completions on known days relative to today ---- */
const today = utils.todayISO();
const off = (n) => utils.fmtISO(utils.addDays(utils.parseISO(today), n));
const grid0 = core.monthGrid(today, 1);
const lastCell = grid0.weeks[5][6].date; /* a neighbour-month day (Mon start) */
const ts = '2026-10-01T00:00:00.000Z';
const T = (id, area, title) => ({ id, area, projectId: null, title, note: '', priority: 0, due: null, recur: null, subtasks: [], order: 1, createdAt: ts, updatedAt: ts });
let cn = 0;
const C = (taskId, date) => ({ id: 'c' + (cn++), taskId, subtaskId: null, date, at: ts });
const SOLO = off(-1), PAIR = off(-2), TRIO = off(-3);
const seedJson = JSON.stringify({
  schema: 1, areaLabels: { living: 'Living', prod: 'Prod', hobby: 'Hobby' }, projects: [],
  tasks: [T('tl', 'living', 'Live'), T('tp', 'prod', 'Prod'), T('th', 'hobby', 'Hob')],
  completions: [C('th', SOLO), C('tp', PAIR), C('tl', PAIR), C('th', TRIO), C('tp', TRIO), C('tl', TRIO), C('th', lastCell)],
  updatedAt: ts
});
async function load(w, page, weekStart) {
  await setViewport(w, 844);
  await send('Page.navigate', { url: BASE + '/index.html' });
  await sleep(400);
  await ev(`localStorage.clear(); localStorage.setItem('acadbro-data-v1', ${JSON.stringify(seedJson)});` + (weekStart ? `localStorage.setItem('acadbro-settings-v1', JSON.stringify({weekStart:'${weekStart}'}));` : '') + ' true');
  await send('Page.navigate', { url: BASE + '/index.html?page=' + page });
  await until(`!!document.querySelector('.strip-cell')`, 6000);
  await sleep(300);
}

/* ---- in-page helpers ---- */
const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const contrast = (a, b) => { const la = lum(rgb(a)), lb = lum(rgb(b)); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
/* per-cell facts for .strip-cell or .month-cell */
const cellsJs = (sel) => `Array.from(document.querySelectorAll(${JSON.stringify(sel)})).map(function(c){
  var circ=c.querySelector('.done-circle'), num=c.querySelector('.day-num'), wrap=c.querySelector('.day-num-wrap');
  var cb=circ&&circ.getBoundingClientRect(), nb=num.getBoundingClientRect();
  return { date:c.dataset.date, done:c.classList.contains('has-done'), out:c.classList.contains('is-out'), sel:c.classList.contains('selected'),
    circle:!!circ, bg:circ?getComputedStyle(circ).backgroundColor:null, anim:circ?getComputedStyle(circ).animationName:null, nAnim:circ?circ.getAnimations().length:0,
    inside: circ ? Math.abs((cb.left+cb.width/2)-(nb.left+nb.width/2))<=1.5 && Math.abs((cb.top+cb.height/2)-(nb.top+nb.height/2))<=1.5 && cb.width>=nb.width : null,
    numColor:getComputedStyle(num).color, wrapKids:Array.from(wrap.children).map(function(k){return k.className;}).join('|') }; })`;
const token = (name) => ev(`(function(){var e=document.createElement('i');e.style.color='var(${name})';document.body.appendChild(e);var c=getComputedStyle(e).color;e.remove();return c;})()`);
const cardH = () => ev(`document.querySelector('.day-strip-card').getBoundingClientRect().height`);
const selectedDate = () => ev(`(document.querySelector('.strip-cell.selected, .month-cell.selected')||{dataset:{}}).dataset.date`);
const noHScroll = (w) => ev(`(function(){var d=document.documentElement,r=document.querySelector('.day-strip-card').getBoundingClientRect();return JSON.stringify({sw:d.scrollWidth,bw:document.body.scrollWidth,iw:innerWidth,l:r.left,r:r.right});})()`).then(function(j){var o=JSON.parse(j);return o.sw<=w && o.l>=0 && o.r<=w ? true : j;});

/* screenshots -> $SMOKE_OUT/strip-shots/<label>-<w>-<name>.png (default <os tmp>/acadbro-smoke) */
const SHOTS = path.join(process.env.SMOKE_OUT || path.join(os.tmpdir(), 'acadbro-smoke'), 'strip-shots');
fs.mkdirSync(SHOTS, { recursive: true });
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, LABEL + '-' + name + '.png'), Buffer.from(r.data, 'base64'));
}
const OBS = `(function(){ if (window.__lsObs) return true; window.__ls = [];
  window.__lsObs = new PerformanceObserver(function(l){ l.getEntries().forEach(function(e){ window.__ls.push({ v: +e.value.toFixed(4), recent: e.hadRecentInput, t: Math.round(e.startTime) }); }); });
  window.__lsObs.observe({ type: 'layout-shift', buffered: false }); return true; })()`;

async function circleChecks(tag, reduce, w) {
  const strip = await ev(cellsJs('.strip-cell'));
  const byDate = Object.fromEntries(strip.map((c) => [c.date, c]));
  const teal = await token('--teal'), sky = await token('--sky'), orange = await token('--orange');
  const bg = await token('--bg');
  /* the old small dot is gone: markup and CSS */
  check(`${tag} no dot element under day numbers (markup)`, await ev(`!document.querySelector('.day-strip-card [class*="dot"]') && Array.from(document.querySelectorAll('.strip-cell')).every(function(c){return Array.from(c.children).every(function(k){return /strip-weekday|day-num-wrap|strip-today-mark/.test(k.className);});})`));
  check(`${tag} no dot rule left in the stylesheet`, await ev(`!Array.from(document.styleSheets).some(function(s){return Array.from(s.cssRules).some(function(r){return /strip-done-dot/.test(r.cssText);});})`));
  /* .has-done == a circle behind the number, centred on it */
  const doneCells = strip.filter((c) => c.done);
  check(`${tag} strip: every .has-done day has a circle, and only those`, strip.every((c) => c.done === c.circle) && doneCells.length >= 1, 'done=' + doneCells.map((c) => c.date).join(','));
  check(`${tag} strip: circle sits behind the number and centres on it`, doneCells.every((c) => c.inside === true), JSON.stringify(doneCells.map((c) => c.inside)));
  if (byDate[SOLO]) {
    check(`${tag} solo hobby day: solid orange, no animation`, byDate[SOLO].bg === orange && byDate[SOLO].nAnim === 0 && byDate[SOLO].anim === 'none', JSON.stringify([byDate[SOLO].bg, orange, byDate[SOLO].anim]));
    check(`${tag} number readable on orange/teal/sky (>= 4.5:1)`, [orange, teal, sky].every((c) => contrast(byDate[SOLO].numColor, c) >= 4.5), byDate[SOLO].numColor + ' vs bg ' + bg);
  }
  if (byDate[PAIR]) {
    if (reduce) check(`${tag} 2-colour day: no animation, first area (living) colour`, byDate[PAIR].nAnim === 0 && byDate[PAIR].anim === 'none' && byDate[PAIR].bg === teal, JSON.stringify([byDate[PAIR].bg, byDate[PAIR].anim, byDate[PAIR].nAnim]));
    else check(`${tag} 2-colour day: animation attached`, byDate[PAIR].nAnim >= 1 && /dc-fade-2/.test(byDate[PAIR].anim), JSON.stringify([byDate[PAIR].anim, byDate[PAIR].nAnim]));
  }
  if (byDate[TRIO]) {
    if (reduce) check(`${tag} 3-colour day: no animation, first area colour`, byDate[TRIO].nAnim === 0 && byDate[TRIO].bg === teal, JSON.stringify([byDate[TRIO].bg, byDate[TRIO].nAnim]));
    else check(`${tag} 3-colour day: animation attached`, byDate[TRIO].nAnim >= 1 && /dc-fade-3/.test(byDate[TRIO].anim), JSON.stringify([byDate[TRIO].anim, byDate[TRIO].nAnim]));
  }
  /* sample the colours of the multi-colour days for 3.4 s */
  const seen = new Set(); const seen3 = new Set();
  for (let i = 0; i < 14; i++) {
    const s = await ev(cellsJs('.strip-cell'));
    const b = Object.fromEntries(s.map((c) => [c.date, c.bg]));
    seen.add(b[PAIR]); seen3.add(b[TRIO]);
    await sleep(250);
  }
  if (reduce) check(`${tag} multi-colour days stay on one colour over 3.4 s`, seen.size === 1 && seen3.size === 1, JSON.stringify([...seen, ...seen3]));
  else check(`${tag} multi-colour days change colour over 3.4 s (cross-fade loop)`, seen.size >= 2 && seen3.size >= 2, JSON.stringify([[...seen], [...seen3]]));
  /* page scope: Hobby shows only Hobby's colour */
  await tap('.bottom-nav-item[data-page="hobby"]');
  await sleep(reduce ? 200 : 600);
  const hob = Object.fromEntries((await ev(cellsJs('.strip-cell'))).map((c) => [c.date, c]));
  if (hob[PAIR] && hob[TRIO] && hob[SOLO]) {
    check(`${tag} Hobby page: living/prod-only day has no circle; others are solid orange`, !hob[PAIR].circle && hob[TRIO].bg === orange && hob[TRIO].nAnim === 0 && hob[SOLO].bg === orange, JSON.stringify([hob[PAIR].circle, hob[TRIO].bg, hob[SOLO].bg]));
  }
  await tap('.bottom-nav-item[data-page="all"]');
  await sleep(reduce ? 200 : 600);
}

async function flows(w, mode) {
  const reduce = mode === 'reduce';
  const tag = `[${w} ${mode}]`;
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
  await load(w, 'all');
  await ev(OBS);
  await circleChecks(tag, reduce, w);
  if (reduce) return;

  await shot(w + '-closed');
  const h0 = await cardH();
  check(`${tag} closed: chevron row is bottom-right of the card`, await ev(`(function(){var c=document.querySelector('.day-strip-card').getBoundingClientRect(),b=document.querySelector('.strip-toggle').getBoundingClientRect();return c.right-b.right<=12 && c.bottom-b.bottom<=8 && b.left>c.left+c.width/2 && b.top>document.querySelector('.strip-cell').getBoundingClientRect().bottom-2 && document.querySelector('.strip-toggle').getAttribute('aria-expanded')==='false';})()`));
  { const hs = await noHScroll(w); check(`${tag} closed: no horizontal scroll`, hs === true, String(hs)); }

  /* ---- open via chevron ---- */
  const stripFacts = await ev(cellsJs('.strip-cell'));
  const sel0 = await selectedDate();
  await tap('.strip-toggle');
  await sleep(60);
  const mid = await ev(`(function(){var b=document.querySelector('.strip-body');return b?{fading:b.classList.contains('is-fading'),entering:b.classList.contains('is-entering'),h:b.getBoundingClientRect().height}:null;})()`);
  check(`${tag} open via chevron: animates (body fading/entering, not a cut)`, !!mid && (mid.fading || mid.entering), JSON.stringify(mid));
  await sleep(600);
  check(`${tag} open via chevron: grid shown, aria-expanded true`, await ev(`!!document.querySelector('.month-grid') && !document.querySelector('.day-strip') && document.querySelector('.strip-toggle').getAttribute('aria-expanded')==='true'`));
  await shot(w + '-open');
  const gridCells = await ev(cellsJs('.month-cell'));
  check(`${tag} grid: 42 cells (6 rows x 7), title is the month`, gridCells.length === 42 && (await ev(`document.querySelector('.month-title').textContent`)) === core.monthGrid(sel0, 1).title);
  check(`${tag} grid: no dot element, circles centre on the number`, gridCells.filter((c) => c.done).every((c) => c.inside === true) && await ev(`!document.querySelector('.month-grid [class*="dot"]')`));
  /* circles match the strip's .has-done for the same days (and colour) */
  const gByDate = Object.fromEntries(gridCells.map((c) => [c.date, c]));
  const common = stripFacts.filter((c) => gByDate[c.date]);
  check(`${tag} grid circles match strip .has-done for the same days`, common.length >= 3 && common.every((c) => gByDate[c.date].done === c.done && gByDate[c.date].circle === c.circle && (!c.done || gByDate[c.date].anim === c.anim)), 'compared ' + common.length);
  check(`${tag} grid: neighbour-month day is dimmed, tappable and shows its done circle`, gByDate[lastCell] && gByDate[lastCell].out && gByDate[lastCell].done && gByDate[lastCell].circle);
  check(`${tag} grid: selected day kept (selection unchanged by opening)`, (await selectedDate()) === sel0);
  check(`${tag} open: chevron row still bottom-right`, await ev(`(function(){var c=document.querySelector('.day-strip-card').getBoundingClientRect(),b=document.querySelector('.strip-toggle').getBoundingClientRect();return c.right-b.right<=12 && c.bottom-b.bottom<=8;})()`));
  { const hs = await noHScroll(w); check(`${tag} open: no horizontal scroll`, hs === true, String(hs)); }
  const hOpen = await cardH();
  check(`${tag} open: card grew`, hOpen > h0 + 100, h0 + ' -> ' + hOpen);

  /* ---- paging: selected day and card height stay put ---- */
  const t0 = await ev(`document.querySelector('.month-title').textContent`);
  const hs = [];
  for (const sel of ['[data-action="month-next"]', '[data-action="month-next"]', '[data-action="month-prev"]']) { await tap(sel); await sleep(120); hs.push(await cardH()); }
  const t1 = await ev(`document.querySelector('.month-title').textContent`);
  check(`${tag} paging: month changed, selected day unchanged, height unchanged`, t1 !== t0 && (await ev(`document.querySelector('.month-cell.selected') ? document.querySelector('.month-cell.selected').dataset.date : null`)) === sel0 && hs.every((x) => Math.abs(x - hOpen) < 0.6), JSON.stringify([t0, t1, hs, hOpen]));
  check(`${tag} paging: Today button visible off the current month`, await ev(`!document.querySelector('.month-today').classList.contains('is-off')`));
  check(`${tag} paging: heading still the selected day`, (await ev(`document.querySelector('.section-header h2').textContent`)) === 'Today');
  await tap('.month-today');
  await sleep(150);
  check(`${tag} Today button returns to this month and hides again`, (await ev(`document.querySelector('.month-title').textContent`)) === t0 && await ev(`document.querySelector('.month-today').classList.contains('is-off')`));
  /* horizontal swipe on the grid pages a month too */
  const gc = await centre('.month-cells');
  await swipe(gc.x + 60, gc.y, -120, 4);
  await sleep(200);
  const tSwipe = await ev(`document.querySelector('.month-title').textContent`);
  check(`${tag} horizontal swipe left on the grid = next month (no day selected by it)`, tSwipe === core.monthGrid(core.shiftMonthISO(today, 1), 1).title && (await selectedDate()) === sel0 && Math.abs((await cardH()) - hOpen) < 0.6, tSwipe);
  await swipe(gc.x - 60, gc.y, 120, -4);
  await sleep(200);
  check(`${tag} horizontal swipe right on the grid = previous month`, (await ev(`document.querySelector('.month-title').textContent`)) === t0);

  /* ---- tap a day: selected at once, grid folds after ~300 ms ---- */
  const pick = await ev(`(function(){var c=Array.from(document.querySelectorAll('.month-cell:not(.is-out):not(.selected)')).filter(function(e){return Number(e.dataset.date.slice(8))===12;})[0]; return c?c.dataset.date:null;})()`);
  const tStart = Date.now();
  await ev('window.__pickAt = performance.now(); true');
  await tap(`.month-cell[data-date="${pick}"]`);
  await sleep(60);
  check(`${tag} tap a day: selectedDate moves at once and the grid is still up`, (await selectedDate()) === pick && await ev(`!!document.querySelector('.month-grid')`), pick);
  const gone = await until(`!document.querySelector('.month-grid') && !!document.querySelector('.day-strip')`, 2500);
  const elapsed = Date.now() - tStart;
  check(`${tag} tap a day: grid collapses after about 300 ms (not instantly)`, gone && elapsed >= 280 && elapsed < 1800, elapsed + ' ms');
  await sleep(500);
  check(`${tag} collapsed on that day's week with the day selected, card back to the closed height`, (await selectedDate()) === pick && Math.abs((await cardH()) - h0) < 0.6, (await cardH()) + ' vs ' + h0);
  check(`${tag} heading follows the picked day`, (await ev(`document.querySelector('.section-header h2').textContent`)) !== 'Today');
  await tap('[data-action="nav-today"]');
  await sleep(300);

  /* ---- open / close via vertical swipe ---- */
  const sc = await centre('.strip-week:nth-child(2) .strip-cell:nth-child(4)');
  await swipe(sc.x, sc.y - 10, 0, 70);
  await sleep(700);
  check(`${tag} swipe down on the strip opens the grid`, await ev(`!!document.querySelector('.month-grid')`));
  const sel1 = await selectedDate();
  const gc2 = await centre('.month-cells');
  await swipe(gc2.x, gc2.y + 40, 0, -80);
  await sleep(700);
  check(`${tag} swipe up on the grid closes it; no day was selected by the swipe`, await ev(`!document.querySelector('.month-grid') && !!document.querySelector('.day-strip')`) && (await selectedDate()) === sel1);
  /* a horizontal swipe on the closed strip still pages weeks and keeps the grid closed */
  await ev(`document.querySelector('.day-strip').scrollTo({left:0, behavior:'instant'}); true`);
  await sleep(600);
  check(`${tag} week paging still works on the closed strip (selected day moved a week)`, (await selectedDate()) === off(-7) && await ev(`!document.querySelector('.month-grid')`), await selectedDate());
  await tap('[data-action="nav-today"]');
  await sleep(300);

  /* ---- Escape closes; double toggle is safe ---- */
  await tap('.strip-toggle');
  await sleep(600);
  await key('Escape', 'Escape', 27);
  await sleep(600);
  check(`${tag} Escape closes the grid`, await ev(`!document.querySelector('.month-grid') && document.querySelector('.strip-toggle').getAttribute('aria-expanded')==='false'`));
  await tap('.strip-toggle'); await sleep(30); await tap('.strip-toggle');
  await sleep(800);
  check(`${tag} rapid double tap on the chevron ends in a consistent state`, await ev(`!!document.querySelector('.month-grid') === (document.querySelector('.strip-toggle').getAttribute('aria-expanded')==='true')`));
  if (await ev(`!!document.querySelector('.month-grid')`)) { await tap('.strip-toggle'); await sleep(700); }

  const ls = await ev(`window.__ls.slice()`);
  /* the delayed fold after a day tap (300 ms timer + fade + height ease) outlives the 500 ms input window by design: allow it, within 1.5 s of that tap */
  const pickAt = await ev('window.__pickAt');
  const stray = ls.filter((e) => !e.recent && !(e.t >= pickAt && e.t <= pickAt + 1500));
  check(`${tag} no layout shift outside input windows (the day-tap fold excepted)`, stray.length === 0, JSON.stringify(stray) + ' excepted=' + (ls.length - stray.length - ls.filter((e) => e.recent).length));
}

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  console.log('--- ' + LABEL + ' (' + ROOT + ')  today=' + today + ' solo=' + SOLO + ' pair=' + PAIR + ' trio=' + TRIO + ' outMonth=' + lastCell);
  await flows(390, 'motion');
  await flows(390, 'reduce');
  await flows(360, 'motion');
  /* Sunday week start: grid and strip begin on Sunday */
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await load(390, 'all', 'sun');
  await tap('.strip-toggle');
  await sleep(300);
  check('[sun start] first grid column is a Sunday, header letter S', await ev(`new Date(document.querySelector('.month-cell').dataset.date + 'T00:00:00').getDay() === 0 && document.querySelector('.month-weekdays span').textContent === 'S'`));
  /* reduced motion: toggle swaps at once (no fading/entering step) */
  await tap('.strip-toggle');
  await sleep(50);
  check('[reduce] closing swaps at once', await ev(`!document.querySelector('.month-grid') && !document.querySelector('.is-fading, .is-entering')`));
  check('no console errors / exceptions', errors.length === 0, errors.join(' | '));
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
console.log(fails ? 'RESULT: ' + fails + ' FAIL' : 'RESULT: all passed');
process.exit(fails ? 1 : 0);
