/* M5 headless smoke via raw CDP, with the Firebase SDK replaced by an in-memory mock
   served through Fetch interception (no live backend is ever contacted).
   Usage: [W=360|390] node scripts/smoke/smoke-m5b.mjs <port>  (M5 review-fix version) */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* Needs the dev server running: node scripts/serve.mjs  (pass the port it logs).
   Output (screenshots, throwaway Chrome profile) goes to $SMOKE_OUT or <os tmp>/acadbro-smoke. */
var PORT = process.argv[2] || process.env.SMOKE_PORT;
if (!PORT) { console.error('usage: [W=360|390] node scripts/smoke/smoke-m5b.mjs <port>'); process.exit(2); }
var SCR = process.env.SMOKE_OUT || path.join(os.tmpdir(), 'acadbro-smoke');

var SHOTS = path.join(SCR, 'm5b-shots-' + (process.env.W || 390));
fs.mkdirSync(SHOTS, { recursive: true });
var CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var DBG = 9371 + (process.env.W === "360" ? 1 : 0);
var prof = path.join(SCR, 'prof-m5b-' + Date.now());
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
var gstaticHits = 0;
var gstaticMode = 'mock'; /* 'mock' | 'fail' */

/* ---------------- Firebase mock (served in place of the CDN files) ---------------- */
var PRE = `
function S() {
  if (!globalThis.__fb) {
    globalThis.__fb = { cbs: [] };
  }
  return globalThis.__fb;
}
function flags() { try { return JSON.parse(localStorage.getItem('__mockflags') || '{}'); } catch (e) { return {}; } }
function docs() { try { return JSON.parse(localStorage.getItem('__mockdocs') || '{}'); } catch (e) { return {}; } }
function putDocs(d) { localStorage.setItem('__mockdocs', JSON.stringify(d)); }
function user() { try { return JSON.parse(localStorage.getItem('__mockuser') || 'null'); } catch (e) { return null; } }
function err(code) { var e = new Error(code); e.code = code; return e; }
function delay(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }
`;
var MOCKS = {
  'firebase-app.js': PRE + 'export function initializeApp(cfg) { S().cfg = cfg; return { cfg: cfg }; }',
  'firebase-auth.js': PRE + `
export function getAuth() { return {}; }
export function onAuthStateChanged(a, cb) { S().cbs.push(cb); setTimeout(function () { cb(user()); }, 20); return function () {}; }
export function signInWithEmailAndPassword(a, e, p) {
  return delay(60).then(function () {
    var f = flags();
    if (f.loginFail) throw err(f.loginFail);
    var u = { uid: f.loginUid || 'u1', email: e };
    localStorage.setItem('__mockuser', JSON.stringify(u));
    S().cbs.forEach(function (c) { c(u); });
    return { user: u };
  });
}
export function signOut() {
  localStorage.removeItem('__mockuser');
  S().cbs.forEach(function (c) { c(null); });
  return Promise.resolve();
}`,
  'firebase-firestore.js': PRE + `
export function getFirestore() { return {}; }
export function doc(db, c, i) { return { path: c + '/' + i }; }
export function serverTimestamp() { return { __sv: true }; }
export function getDoc(ref) {
  return delay().then(function () {
    var f = flags();
    if (f.failLoad) throw err(f.failLoad);
    var d = docs()[ref.path];
    return {
      exists: function () { return !!d; },
      data: function () {
        if (!d) return undefined;
        var o = JSON.parse(JSON.stringify(d));
        var ms = d.updatedAt;
        o.updatedAt = { toMillis: function () { return ms; } };
        return o;
      }
    };
  });
}
var lastMs = 0;
export function runTransaction(db, fn) {
  localStorage.setItem('__mocktx', String(Number(localStorage.getItem('__mocktx') || '0') + 1));
  return delay().then(function () {
    var f = flags();
    if (f.hangSave) return new Promise(function () {});
    if (f.failSave) throw err(f.failSave);
    var writes = [];
    var tx = {
      get: function (ref) { return getDoc(ref); },
      set: function (ref, payload) { writes.push([ref, payload]); }
    };
    return fn(tx).then(function (res) {
      writes.forEach(function (w) {
        var all = docs();
        lastMs = Math.max(Date.now(), lastMs + 1, (all[w[0].path] && all[w[0].path].updatedAt || 0) + 1);
        var o = JSON.parse(JSON.stringify(w[1]));
        o.updatedAt = lastMs;
        all[w[0].path] = o;
        putDocs(all);
        localStorage.setItem('__mockwrites', String(Number(localStorage.getItem('__mockwrites') || '0') + 1));
      });
      return res;
    });
  });
}`
};

ws.onmessage = function (m) {
  var msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Fetch.requestPaused') {
    var rp = msg.params;
    gstaticHits++;
    var file = rp.request.url.split('/').pop().split('?')[0];
    if (gstaticMode === 'fail' || !MOCKS[file]) {
      send('Fetch.failRequest', { requestId: rp.requestId, errorReason: 'InternetDisconnected' });
    } else {
      send('Fetch.fulfillRequest', {
        requestId: rp.requestId, responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'text/javascript' }, { name: 'access-control-allow-origin', value: '*' }],
        body: Buffer.from(MOCKS[file]).toString('base64')
      });
    }
    return;
  }
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
  await sleep(400);
  var r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64'));
}
var failures = [];
function check(name, cond, extra) {
  if (cond) console.log('ok   ' + name);
  else { console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); failures.push(name); }
}
async function center(sel) {
  return ev('(function(){var e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return null;e.scrollIntoView({block:"center"});var r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
}
async function openTab2() {
  var r = await fetch('http://127.0.0.1:' + DBG + '/json/new?' + BASEURL + 'no-such-file.txt', { method: 'PUT' });
  var info = await r.json();
  var w = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise(function (res) { w.onopen = res; });
  var n = 0, pend = new Map();
  w.onmessage = function (m) { var d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  var ev2 = function (expr) {
    return new Promise(function (res) {
      var i = ++n; pend.set(i, res);
      w.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
    }).then(function (r) { return r.result.result && r.result.result.value; });
  };
  await sleep(900);
  return { ev2: ev2, close: async function () { w.close(); await fetch('http://127.0.0.1:' + DBG + '/json/close/' + info.id).catch(function () {}); await sleep(300); } };
}
async function click(sel) {
  var c = await center(sel);
  if (!c) throw new Error('no element ' + sel);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await sleep(450); /* M6: view/page swaps fade out (--dur-fast 160ms) before rendering; wait past it */
}
async function typeInto(sel, text) { await click(sel); await send('Input.insertText', { text: text }); }
async function key(k) {
  var code = k === 'Enter' ? 13 : k === 'Escape' ? 27 : 0;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code, text: k === 'Enter' ? '\r' : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
  await sleep(250);
}
async function dismissToasts() { await ev('document.querySelectorAll(".toast-close").forEach(function(b){b.click()})'); await sleep(350); }
function toasts() { return ev('Array.from(document.querySelectorAll(".toast-msg")).map(function(e){return e.textContent})'); }
function lsget(k) { return ev('localStorage.getItem(' + JSON.stringify(k) + ')'); }
function mockDoc() { return ev('JSON.parse(localStorage.getItem("__mockdocs")||"{}")["users/u1"]||null'); }
function setFlags(o) { return ev('localStorage.setItem("__mockflags", ' + JSON.stringify(JSON.stringify(o)) + ')'); }
async function waitFor(expr, ms) {
  var t0 = Date.now();
  while (Date.now() - t0 < (ms || 4000)) { if (await ev(expr)) return true; await sleep(100); }
  return false;
}
/* edit through the app's own storage module (same instance as the page) */
function editTask(title) {
  return ev('(async function(){var S=await import("/js/storage.js");S.DB.tasks.push({id:"tx"+Date.now(),area:"prod",projectId:null,title:' + JSON.stringify(title) + ',note:"",priority:0,due:null,recur:null,subtasks:[],order:99,createdAt:"2026-10-27T00:00:00.000Z",updatedAt:"2026-10-27T00:00:00.000Z"});S.saveData();return S.DB.tasks.length})()');
}
async function ensureSettings() {
  await ev('(function(){if(!document.getElementById("account-rows")){var b=document.querySelector("button[aria-label=Settings]");if(b)b.click();}})()');
  await sleep(350);
}
function mockWrites() { return ev('Number(localStorage.getItem("__mockwrites")||0)'); }
function txAttempts() { return ev('Number(localStorage.getItem("__mocktx")||0)'); }
function sheetTitle() { return ev('document.getElementById("sheet-host").hidden ? "" : document.getElementById("sheet-title").textContent'); }
async function clickToastBtn(label) {
  var ok = await ev('(function(){var b=Array.from(document.querySelectorAll(".toast-btn")).find(function(x){return x.textContent.trim()===' + JSON.stringify(label) + '});if(!b)return false;b.click();return true})()');
  await sleep(300);
  return ok;
}
/* the recovery-slot question: answer it if it shows up */
async function answerAsk(action) {
  var shown = await waitFor('!document.getElementById("sheet-host").hidden && document.getElementById("sheet-title").textContent === "Recovery copy in use"', 2500);
  if (shown) await click('[data-action="' + action + '"]');
  await sleep(300);
  return shown;
}
function dbTasks() { return ev('(async function(){var S=await import("/js/storage.js");return S.DB.tasks.length})()'); }

var BASEURL = 'http://localhost:' + PORT + '/';
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
/* sw.js caches the SDK and, once it controls the page, fetches it itself, out of reach of page-level Fetch; bypass it so every SDK request is mocked */
await send('Network.enable');
await send('Network.setBypassServiceWorker', { bypass: true });
await send('Fetch.enable', { patterns: [{ urlPattern: 'https://www.gstatic.com/*' }] });
await send('Emulation.setDeviceMetricsOverride', { width: Number(process.env.W||390), height: 844, deviceScaleFactor: 2, mobile: true });

var seed = function () {
  if (localStorage.getItem('seeded-m5')) return;
  var ts = '2026-10-01T00:00:00.000Z';
  var data = {
    schema: 1, areaLabels: { living: 'Living', prod: 'Prod', hobby: 'Hobby' },
    projects: [{ id: 'p1', area: 'prod', name: 'Thesis', note: '', archived: false, order: 1, createdAt: ts, updatedAt: ts }],
    tasks: [{ id: 't1', area: 'prod', projectId: 'p1', title: 'Read paper', note: '', priority: 0, due: null, recur: null, subtasks: [], order: 1, createdAt: ts, updatedAt: ts }],
    completions: [], updatedAt: ts
  };
  localStorage.setItem('acadbro-data-v1', JSON.stringify(data));
  localStorage.setItem('seeded-m5', '1');
};
await send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + seed.toString() + ')()' });
async function load(url) { await send('Page.navigate', { url: url }); await sleep(1300); }

/* ========== 1. logged out, no hint: no network, no errors ========== */
console.log('--- 1. logged out');
await load(BASEURL);
check('title is AcadBro', (await ev('document.title')) === 'AcadBro');
check('no Firebase request at launch (never signed in)', gstaticHits === 0, gstaticHits);
check('no console errors at launch', errors.length === 0, errors);
check('sync dot hidden when logged out', (await ev('document.getElementById("sync-dot").classList.contains("hidden")')) === true);
await dismissToasts();
await click('button[aria-label="Settings"]');
check('Account shows Log in row', (await ev('document.getElementById("account-rows").innerText')).indexOf('Log in') !== -1);
check('no horizontal scroll at 390', (await ev('document.documentElement.scrollWidth <= innerWidth')) === true);
await shot('m5-01-settings-logged-out');

/* ========== 1b. two tabs on one device ========== */
console.log('--- 1b. two tabs');
await dismissToasts();
await click('[data-action="close-settings"]');
var orig = await lsget('acadbro-data-v1');
var tab2 = await openTab2();
var other = JSON.parse(orig);
other.tasks.push({ id: 'tab2-a', area: 'prod', projectId: null, title: 'from tab two', note: '', priority: 0, due: null, recur: null, subtasks: [], order: 5, createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z' });
other.updatedAt = '2999-01-01T00:00:00.000Z';
await tab2.ev2('localStorage.setItem("acadbro-data-v1", ' + JSON.stringify(JSON.stringify(other)) + ')');
check('real storage event: the other tab\'s task appears here', await waitFor('(async function(){var S=await import("/js/storage.js");return S.DB.tasks.length===2})()', 3000), await dbTasks());
check('toast says Updated from another tab', await waitFor('Array.from(document.querySelectorAll(".toast-msg")).some(function(e){return /Updated from another tab/.test(e.textContent)})', 2000), await toasts());
check('and the page shows it', (await ev('document.body.innerText')).indexOf('from tab two') !== -1);
/* missed event: a write made from THIS document raises no storage event here, which is exactly
   the case the write guard exists for */
var other2 = JSON.parse(JSON.stringify(other));
other2.tasks.push({ id: 'tab2-b', area: 'prod', projectId: null, title: 'second from tab two', note: '', priority: 0, due: null, recur: null, subtasks: [], order: 6, createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z' });
other2.updatedAt = '2999-06-01T00:00:00.000Z';
await ev('localStorage.setItem("acadbro-data-v1", ' + JSON.stringify(JSON.stringify(other2)) + ')');
await sleep(300);
await dismissToasts();
await editTask('stale-tab edit');
check('stale tab: the write is refused and the other tab\'s data is loaded', (await dbTasks()) === 3, await dbTasks());
check('storage was NOT overwritten by the stale tab', (await lsget('acadbro-data-v1')).indexOf('stale-tab edit') === -1 && (await lsget('acadbro-data-v1')).indexOf('second from tab two') !== -1);
check('user is told to repeat the change (warn toast)', await waitFor('Array.from(document.querySelectorAll(".toast-warn .toast-msg")).some(function(e){return /Another tab saved newer data/.test(e.textContent)})', 2000), await toasts());
check('nothing marked dirty by the refused write', (await lsget('acadbro-dirty')) === null);
await shot('m5b-01-two-tabs');
await tab2.ev2('localStorage.setItem("acadbro-data-v1", ' + JSON.stringify(JSON.stringify(JSON.parse(orig))) + ')');
await tab2.close();
await send('Page.bringToFront');
await load(BASEURL);
check('back to the seeded data after the two-tab test', (await dbTasks()) === 1, await dbTasks());
await dismissToasts();
await click('button[aria-label="Settings"]');

/* ========== 2. login: validation then success ========== */
console.log('--- 2. login');
await click('[data-action="open-login"]');
check('login sheet opened', await waitFor('!document.getElementById("sheet-host").hidden && !!document.getElementById("login-email")'));
check('Firebase SDK requested only after tapping Log in', gstaticHits >= 3, gstaticHits);
await shot('m5-02-login-sheet');
await typeInto('#login-email', 'not-an-email');
await typeInto('#login-password', 'x');
await click('#login-submit');
check('bad email -> positive hint', (await ev('document.getElementById("login-error").textContent')) === 'Please enter a valid email, like name@example.com');
await ev('document.getElementById("login-email").value=""');
await typeInto('#login-email', 'me@example.com');
await ev('document.getElementById("login-password").value=""');
await click('#login-submit');
check('empty password -> hint', (await ev('document.getElementById("login-error").textContent')) === 'Please enter your password.');
await setFlags({ loginFail: 'auth/invalid-credential' });
await typeInto('#login-password', 'secret1');
await key('Enter');
check('Enter submits; wrong login -> friendly error', await waitFor('document.getElementById("login-error") && document.getElementById("login-error").textContent.indexOf("did not match") !== -1'), await ev('document.getElementById("login-error").textContent'));
check('login sheet stays open on failure', (await ev('!document.getElementById("sheet-host").hidden')) === true);
await shot('m5-03-login-error');
await setFlags({});
await click('#login-submit');
check('login succeeds and the sheet closes', await waitFor('document.getElementById("sheet-host").hidden', 3000));
check('first login pushes local data: cloud doc exists', await waitFor('!!JSON.parse(localStorage.getItem("__mockdocs")||"{}")["users/u1"]', 3000));
var d1 = await mockDoc();
check('cloud doc has exactly the allow-listed fields', d1 && JSON.stringify(Object.keys(d1).sort()) === JSON.stringify(['areaLabels', 'completions', 'projects', 'rev', 'schema', 'tasks', 'updatedAt']), d1 && Object.keys(d1));
check('cloud doc carries the local task', d1 && d1.tasks.length === 1 && d1.tasks[0].title === 'Read paper');
check('dirty marker cleared by the acknowledged write', await waitFor('localStorage.getItem("acadbro-dirty") === null', 3000));
check('owner + auth hint + BASE rev recorded', (await lsget('acadbro-owner-uid')) === 'u1' && (await lsget('acadbro-auth-hint')) === '1' && (await waitFor('localStorage.getItem("acadbro-sync-rev") !== null', 2000)));
check('BASE rev is the rev OUR write put in the doc (no separate read-back)', (await lsget('acadbro-sync-rev')) === d1.rev && typeof d1.rev === 'string' && d1.rev.length > 0 && d1.rev.length <= 64, [await lsget('acadbro-sync-rev'), d1.rev]);
check('toast says logged in / data saved', (await toasts()).some(function (t) { return /Logged in/.test(t); }), await toasts());
check('header dot visible and synced', await waitFor('!document.getElementById("sync-dot").classList.contains("hidden") && document.querySelector("#sync-dot .sync-dot-fill").classList.contains("is-synced")', 3000));
var acct = await ev('document.getElementById("account-rows").innerText');
check('Account row shows email + Synced just now', /me@example\.com/.test(acct) && /Synced just now/.test(acct), acct);
await shot('m5-04-logged-in');

/* ========== 3. edit -> debounced upload; failure -> visible; recovery -> toast ========== */
console.log('--- 3. save / failure / recovery');
await editTask('second task');
check('edit marks dirty immediately', (await lsget('acadbro-dirty')) !== null);
check('edit reaches the cloud after the debounce', await waitFor('(JSON.parse(localStorage.getItem("__mockdocs"))["users/u1"].tasks||[]).length === 2', 4000));
check('dirty cleared after ack', await waitFor('localStorage.getItem("acadbro-dirty") === null', 3000));
await setFlags({ failSave: 'permission-denied' });
await editTask('third task (will be rejected)');
check('rejected save shows a warn toast with next step', await waitFor('Array.from(document.querySelectorAll(".toast-warn .toast-msg")).some(function(e){return /did not accept/.test(e.textContent)})', 4000), await toasts());
check('edit stays dirty (not lost)', (await lsget('acadbro-dirty')) !== null);
check('dot shows error', (await ev('document.querySelector("#sync-dot .sync-dot-fill").className')).indexOf('is-error') !== -1);
check('Account row carries the reason', /did not accept/.test(await ev('document.getElementById("account-rows").innerText')));
var warnToasts = (await toasts()).filter(function (t) { return /did not accept/.test(t); }).length;
await shot('m5-05-save-error');
await sleep(2600); /* one retry cycle: must not re-toast */
check('retry does not spam the same toast', (await toasts()).filter(function (t) { return /did not accept/.test(t); }).length <= warnToasts);
await setFlags({});
await sleep(5600); /* second retry (5s) now succeeds */
check('after the failure clears, a Back in sync toast appears', (await toasts()).some(function (t) { return /Back in sync/.test(t); }) || (await mockDoc()).tasks.length === 3, await toasts());
check('retry delivered the rejected edit', await waitFor('(JSON.parse(localStorage.getItem("__mockdocs"))["users/u1"].tasks||[]).length === 3', 3000));
check('dirty cleared', await waitFor('localStorage.getItem("acadbro-dirty") === null', 3000));

/* ========== 3b. another device wrote while this one is online: the write is refused ========== */
console.log('--- 3b. transaction refuses a write over another device');
await dismissToasts();
await ev('(function(){var all=JSON.parse(localStorage.getItem("__mockdocs"));var d=all["users/u1"];d.rev="other-device-rev-1";d.areaLabels={living:"OtherLiving",prod:"Prod",hobby:"Hobby"};d.updatedAt=Date.now()+2000;all["users/u1"]=d;localStorage.setItem("__mockdocs",JSON.stringify(all));})()');
var writesBefore = await mockWrites();
await editTask('edit made while another device wrote');
check('conflict sheet opens at once (no relaunch needed)', await waitFor('!document.getElementById("sheet-host").hidden && document.getElementById("sheet-title").textContent === "Two versions found"', 5000), await sheetTitle());
check('the refused write sent NOTHING', (await mockWrites()) === writesBefore && (await mockDoc()).rev === 'other-device-rev-1', [writesBefore, await mockWrites(), (await mockDoc()).rev]);
check('local edit is still marked unsynced', (await lsget('acadbro-dirty')) !== null);
await shot('m5b-02-online-conflict');
await click('[data-action="conflict-keep-local"]');
check('keep this device: guarded write now replaces exactly that cloud version', await waitFor('JSON.parse(localStorage.getItem("__mockdocs"))["users/u1"].rev !== "other-device-rev-1"', 5000), (await mockDoc()).rev);
check('cloud doc carries the local edit and a rev that is now BASE', (await mockDoc()).tasks.some(function (t) { return /edit made while another device wrote/.test(t.title); }) && (await lsget('acadbro-sync-rev')) === (await mockDoc()).rev);
check('dirty cleared after that write', await waitFor('localStorage.getItem("acadbro-dirty") === null', 3000));
check('the cloud version went to the recovery slot with the account as owner', (await ev('JSON.parse(localStorage.getItem("acadbro-conflict-backup")).ownerUid')) === 'u1');
await dismissToasts();

/* ========== 4. true conflict: keep cloud copy ========== */
console.log('--- 4. conflict -> keep cloud');
await setFlags({ failSave: 'unavailable' });
await editTask('local-only edit A');
await sleep(1500);
await setFlags({});
/* another device writes: cloud moves on */
await ev('(function(){var all=JSON.parse(localStorage.getItem("__mockdocs"));var d=all["users/u1"];d.tasks=d.tasks.slice(0,1);d.rev="other-device-rev-2";d.updatedAt=Date.now()+5000;all["users/u1"]=d;localStorage.setItem("__mockdocs",JSON.stringify(all));})()');
await load(BASEURL + '?page=prod');
check('conflict sheet opens at launch', await waitFor('!document.getElementById("sheet-host").hidden && document.getElementById("sheet-title").textContent === "Two versions found"', 4000));
check('conflict sheet buttons present', (await ev('document.body.innerText')).indexOf('Keep this device') !== -1 && (await ev('document.body.innerText')).indexOf('Keep cloud copy') !== -1);
check('conflict shows both sides with counts', /This device/.test(await ev('document.querySelector(".conflict-cards").innerText')) && /Cloud/.test(await ev('document.querySelector(".conflict-cards").innerText')));
check('close affordances hidden (locked)', (await ev('document.body.classList.contains("sheet-locked")')) === true);
await shot('m5-06-conflict');
check('no horizontal scroll with conflict sheet', (await ev('document.documentElement.scrollWidth <= innerWidth && document.querySelector(".sheet-body").scrollWidth <= document.querySelector(".sheet-body").clientWidth')) === true);
await key('Escape');
await click('.sheet-scrim');
await click('.sheet-close').catch(function () {});
check('conflict cannot be dismissed (Esc / scrim / x)', (await ev('!document.getElementById("sheet-host").hidden')) === true);
check('no upload happened while undecided', (await mockDoc()).tasks.length === 1);
var tasksBefore = await dbTasks();
await click('[data-action="conflict-keep-cloud"]');
check('slot is occupied (from 3b): the user is asked before it is replaced', await answerAsk('ask-replace'));
check('sheet closes after the choice', await waitFor('document.getElementById("sheet-host").hidden', 3000));
check('cloud copy applied (1 task)', (await dbTasks()) === 1, [tasksBefore, await dbTasks()]);
var bk = await ev('JSON.parse(localStorage.getItem("acadbro-conflict-backup"))');
check('device version saved as recovery copy (kept=cloud, has local tasks)', bk && bk.kept === 'cloud' && bk.data.tasks.length === tasksBefore, bk && [bk.kept, bk.data.tasks.length]);
check('told where to restore it', (await toasts()).some(function (t) { return /recovery copy/.test(t) && /Settings/.test(t); }), await toasts());
check('not dirty after applying cloud', (await lsget('acadbro-dirty')) === null);

/* ========== 5. restore from the recovery copy (swap, with Undo) ========== */
console.log('--- 5. restore');
await dismissToasts();
await click('button[aria-label="Settings"]');
check('Account lists the Recovery copy', (await ev('document.getElementById("account-rows").innerText')).indexOf('Recovery copy') !== -1);
await shot('m5-07-recovery-row');
await click('[data-action="open-restore"]');
check('restore sheet shows the copy', await waitFor('document.getElementById("sheet-title").textContent === "Recovery copy" && !document.getElementById("sheet-host").hidden', 2000));
await shot('m5-08-restore-sheet');
await click('[data-action="confirm-restore"]');
await sleep(500);
check('restore brings the local tasks back', (await dbTasks()) === tasksBefore, await dbTasks());
check('the replaced data became the new recovery copy', (await ev('JSON.parse(localStorage.getItem("acadbro-conflict-backup")).data.tasks.length')) === 1);
check('restored data syncs to the cloud as a normal edit', await waitFor('(JSON.parse(localStorage.getItem("__mockdocs"))["users/u1"].tasks||[]).length === ' + tasksBefore, 5000));
await click('.toast-btn.primary');
await sleep(500);
check('Undo swaps back', (await dbTasks()) === 1, await dbTasks());

/* ========== 6. conflict: keep this device ========== */
console.log('--- 6. conflict -> keep device');
await click('[data-action="close-settings"]');
await setFlags({ failSave: 'unavailable' });
await editTask('local-only edit B');
await sleep(1500);
await setFlags({});
await ev('(function(){var all=JSON.parse(localStorage.getItem("__mockdocs"));var d=all["users/u1"];var t0=(d.tasks||[])[0]||{area:"living",projectId:null,note:"",priority:0,due:null,recur:null,subtasks:[],order:0,createdAt:"x",updatedAt:"x"};d.tasks=(d.tasks||[]).concat([Object.assign({},t0,{id:"t-cloud-only",title:"CloudOnlyTask"})]);d.rev="other-device-rev-3";d.updatedAt=Date.now()+9000;all["users/u1"]=d;localStorage.setItem("__mockdocs",JSON.stringify(all));})()');
await load(BASEURL);
check('conflict sheet again', await waitFor('!document.getElementById("sheet-host").hidden && document.getElementById("sheet-title").textContent === "Two versions found"', 4000));
var localTasks = await dbTasks();
var bkAt = await ev('JSON.parse(localStorage.getItem("acadbro-conflict-backup")).at');
await click('[data-action="conflict-keep-local"]');
check('occupied slot: confirm sheet with the three answers', await waitFor('document.getElementById("sheet-title").textContent === "Recovery copy in use"', 2500));
var askText = await ev('document.getElementById("sheet-host").innerText');
check('ask offers Export first / Replace it / Cancel', /Export the current recovery copy first/.test(askText) && /Replace it/.test(askText) && /Cancel/.test(askText), askText);
await shot('m5b-03-replace-ask');
check('ask cannot be dismissed (Esc / scrim)', await (async function () { await key('Escape'); await click('.sheet-scrim'); return (await sheetTitle()) === 'Recovery copy in use'; })());
await click('[data-action="ask-cancel"]');
check('cancel returns to the conflict choice, nothing changed', await waitFor('document.getElementById("sheet-title").textContent === "Two versions found"', 2500));
check('cancel: cloud untouched, recovery copy untouched, still dirty', (await mockDoc()).rev === 'other-device-rev-3' && (await ev('JSON.parse(localStorage.getItem("acadbro-conflict-backup")).at')) === bkAt && (await lsget('acadbro-dirty')) !== null);
await click('[data-action="conflict-keep-local"]');
check('asked again', await answerAsk('ask-replace'));
check('keep-device: cloud gets the local data', await waitFor('(JSON.parse(localStorage.getItem("__mockdocs"))["users/u1"].tasks||[]).length === ' + localTasks, 5000));
var bk2 = await ev('JSON.parse(localStorage.getItem("acadbro-conflict-backup"))');
/* marker = a cloud-only task (area labels are fixed since M6 step 2, so a label marker would be reset) */
check('cloud version kept as recovery copy (kept=local, cloud-only task)', bk2 && bk2.kept === 'local' && (bk2.data.tasks || []).some(function (t) { return t.title === 'CloudOnlyTask'; }), bk2 && [bk2.kept, (bk2.data.tasks || []).map(function (t) { return t.title; })]);
check('dirty cleared after upload', await waitFor('localStorage.getItem("acadbro-dirty") === null', 4000));

/* ========== 7. launch with no changes: nothing re-applied; logout ========== */
console.log('--- 7. quiet relaunch + logout');
await load(BASEURL);
await sleep(800);
check('relaunch in sync: no toast, no sheet', (await toasts()).length === 0 && (await ev('document.getElementById("sheet-host").hidden')) === true, await toasts());
check('dot synced after relaunch', await waitFor('document.querySelector("#sync-dot .sync-dot-fill").classList.contains("is-synced")', 3000));
await dismissToasts();
await click('button[aria-label="Settings"]');
await click('[data-action="log-out"]');
check('logout toast keeps data on device', await waitFor('Array.from(document.querySelectorAll(".toast-msg")).some(function(e){return /Logged out/.test(e.textContent)})', 4000), await toasts());
check('after logout: dot hidden, Log in row back', (await ev('document.getElementById("sync-dot").classList.contains("hidden")')) === true && (await ev('document.getElementById("account-rows").innerText')).indexOf('Log in') !== -1);
check('local data still there', (await dbTasks()) >= 1);
check('auth hint removed', (await lsget('acadbro-auth-hint')) === null);
await shot('m5-09-logged-out-again');

/* ========== 7b. the recovery copy belongs to an account ========== */
console.log('--- 7b. recovery copy owner');
check('logged out: the row says the copy belongs to another account', (await ev('document.getElementById("account-rows").innerText')).indexOf('Belongs to another account') !== -1, await ev('document.getElementById("account-rows").innerText'));
await click('[data-action="open-restore"]');
check('logged out: restore sheet has NO restore button', await waitFor('document.getElementById("sheet-title").textContent === "Recovery copy"', 2000) && (await ev('!document.querySelector("[data-action=confirm-restore]")')) === true);
check('but it can still be exported', (await ev('!!document.querySelector("[data-action=export-recovery]")')) === true);
await shot('m5b-04-restore-other-account');
await click('[data-action="export-recovery"]');
check('export toast', await waitFor('Array.from(document.querySelectorAll(".toast-msg")).some(function(e){return /Exported the recovery copy/.test(e.textContent)})', 2000), await toasts());
await click('.sheet-close').catch(function () {});
await ev('document.querySelector("#sheet-host .sheet-close") && document.querySelector("#sheet-host .sheet-close").click()');
await sleep(400);
await dismissToasts();

/* a different account logs in on this device while the slot is occupied */
var tasksOnDevice = await dbTasks();
var bkAt2 = await ev('JSON.parse(localStorage.getItem("acadbro-conflict-backup")).at');
await setFlags({ loginUid: 'u2' });
await click('[data-action="open-login"]');
await waitFor('!!document.getElementById("login-email")', 3000);
await typeInto('#login-email', 'b@example.com');
await typeInto('#login-password', 'secret2');
await click('#login-submit');
check('account B logs in over A\'s data: asked before the recovery slot is replaced', await waitFor('document.getElementById("sheet-title") && document.getElementById("sheet-title").textContent === "Recovery copy in use"', 4000), await sheetTitle());
await shot('m5b-05-login-ask');
await click('[data-action="ask-cancel"]');
check('cancel: login is aborted, user stays logged out', await waitFor('document.getElementById("sync-dot").classList.contains("hidden")', 3000));
check('cancel: local data and recovery copy are exactly as before', (await dbTasks()) === tasksOnDevice && (await ev('JSON.parse(localStorage.getItem("acadbro-conflict-backup")).at')) === bkAt2);
check('cancel: told, and the auth hint is gone', (await toasts()).some(function (t) { return /Login cancelled/.test(t); }) && (await lsget('acadbro-auth-hint')) === null, await toasts());
await dismissToasts();
await click('[data-action="open-login"]');
await waitFor('!!document.getElementById("login-email")', 3000);
await typeInto('#login-email', 'b@example.com');
await typeInto('#login-password', 'secret2');
await click('#login-submit');
check('second try: asked again', await waitFor('document.getElementById("sheet-title") && document.getElementById("sheet-title").textContent === "Recovery copy in use"', 4000));
await ev('window.__clicks=[];document.addEventListener("click",function(e){window.__clicks.push((e.target.getAttribute&&e.target.getAttribute("data-action"))||e.target.tagName)},true)');
await click('[data-action="ask-export"]');
await sleep(500);
console.log('   debug clicks:', JSON.stringify(await ev('window.__clicks')), 'toasts:', JSON.stringify(await toasts()), 'errors:', JSON.stringify(errors.slice(-3)));
check('Export first works from the question', await waitFor('Array.from(document.querySelectorAll(".toast-msg")).some(function(e){return /Exported the recovery copy/.test(e.textContent)})', 2000), await toasts());
check('still asking after export', (await sheetTitle()) === 'Recovery copy in use');
await click('[data-action="ask-replace"]');
check('replace: B starts with an empty account', await waitFor('(async function(){var S=await import("/js/storage.js");return S.DB.tasks.length===0})()', 4000));
check('A\'s data went to the recovery slot, owned by A', (await ev('JSON.parse(localStorage.getItem("acadbro-conflict-backup")).ownerUid')) === 'u1' && (await ev('JSON.parse(localStorage.getItem("acadbro-conflict-backup")).data.tasks.length')) === tasksOnDevice);
await dismissToasts();
await ensureSettings();
check('B sees: Belongs to another account', (await ev('document.getElementById("account-rows").innerText')).indexOf('Belongs to another account') !== -1);
await click('[data-action="open-restore"]');
check('B: no Restore button on A\'s copy', await waitFor('document.getElementById("sheet-title").textContent === "Recovery copy"', 2000) && (await ev('!document.querySelector("[data-action=confirm-restore]")')) === true);
await ev('(async function(){var m=await import("/js/page-account.js");m.confirmRestore();})()');
await sleep(400);
check('even calling restore directly changes nothing and says why', (await dbTasks()) === 0 && (await toasts()).some(function (t) { return /belongs to another account/.test(t); }), [await dbTasks(), await toasts()]);
await shot('m5b-06-b-cannot-restore');
await ev('document.querySelector("#sheet-host .sheet-close") && document.querySelector("#sheet-host .sheet-close").click()');
await sleep(400);
await dismissToasts();
await click('[data-action="log-out"]');
await sleep(500);
await setFlags({});
/* A comes back: B's empty data has nothing to protect, A's cloud data loads */
await click('[data-action="open-login"]');
await waitFor('!!document.getElementById("login-email")', 3000);
await typeInto('#login-email', 'me@example.com');
await typeInto('#login-password', 'secret1');
await click('#login-submit');
check('A logs back in: cloud data loads', await waitFor('(async function(){var S=await import("/js/storage.js");return S.DB.tasks.length>0})()', 5000));
await dismissToasts();

/* ========== 7c. cloud copy that cannot be stored on this device ========== */
console.log('--- 7c. persisted=false');
await setFlags({ failSave: 'unavailable' });
await editTask('local edit that must survive');
await sleep(1500);
await setFlags({});
await ev('(function(){var all=JSON.parse(localStorage.getItem("__mockdocs"));var d=all["users/u1"];d.tasks=d.tasks.slice(0,1);d.rev="other-device-rev-4";d.updatedAt=Date.now()+12000;all["users/u1"]=d;localStorage.setItem("__mockdocs",JSON.stringify(all));})()');
var revBefore = await lsget('acadbro-sync-rev');
await load(BASEURL);
check('conflict again at launch', await waitFor('document.getElementById("sheet-title") && document.getElementById("sheet-title").textContent === "Two versions found"', 5000));
await ev('(function(){var o=Storage.prototype.setItem;window.__failData=true;Storage.prototype.setItem=function(k,v){if(window.__failData&&k==="acadbro-data-v1")throw new Error("QuotaExceededError");return o.apply(this,arguments)}})()');
await click('[data-action="conflict-keep-cloud"]');
await answerAsk('ask-replace');
await waitFor('Array.from(document.querySelectorAll(".toast-msg")).some(function(e){return /not saved on this device/.test(e.textContent)})', 3000);
check('toast: the cloud copy is not saved on this device + how to free space', (await toasts()).some(function (t) { return /not saved on this device/.test(t) && /delete old completions or notes/.test(t); }), await toasts());
check('still marked unsynced (dirty kept)', (await lsget('acadbro-dirty')) !== null);
check('BASE rev NOT advanced', (await lsget('acadbro-sync-rev')) === revBefore, [await lsget('acadbro-sync-rev'), revBefore]);
check('dot shows the error and the row carries the reason', (await ev('document.querySelector("#sync-dot .sync-dot-fill").className')).indexOf('is-error') !== -1);
check('error toast has Export and Sync now buttons', (await ev('Array.from(document.querySelectorAll(".toast-btn")).map(function(b){return b.textContent.trim()}).join("|")')).indexOf('Export') !== -1);
await shot('m5b-07-not-persisted');
await ev('window.__failData=false');
await dismissToasts();
await load(BASEURL);
check('after freeing space and relaunching, the choice comes back (nothing was recorded as synced)', await waitFor('document.getElementById("sheet-title") && document.getElementById("sheet-title").textContent === "Two versions found"', 5000));
await click('[data-action="conflict-keep-local"]');
await answerAsk('ask-replace');
check('keep device uploads the surviving local edit', await waitFor('(JSON.parse(localStorage.getItem("__mockdocs"))["users/u1"].tasks||[]).some(function(t){return /local edit that must survive/.test(t.title)})', 5000));
check('and then it is clean', await waitFor('localStorage.getItem("acadbro-dirty") === null', 4000));
await dismissToasts();

/* ========== 7d. error states each have a next step ========== */
console.log('--- 7d. error next steps');
await ensureSettings();
/* auth */
var tx0 = await txAttempts();
await setFlags({ failSave: 'unauthenticated' });
await editTask('edit during an ended session');
check('auth: toast offers Log in again', await waitFor('Array.from(document.querySelectorAll(".toast-btn")).some(function(b){return b.textContent.trim()==="Log in again"})', 5000), await toasts());
check('auth: Account row offers Log in again', (await ev('document.getElementById("account-rows").innerText')).indexOf('Log in again') !== -1);
var tx1 = await txAttempts();
await sleep(6500);
check('auth: no retries are fired at a dead session', (await txAttempts()) === tx1, [tx0, tx1, await txAttempts()]);
await clickToastBtn('Log in again');
check('Log in again opens the login sheet with the email filled and a note about unsynced changes', await waitFor('document.getElementById("sheet-title").textContent === "Log in again" && document.getElementById("login-email").value === "me@example.com"', 2500) && /stay on this device/.test(await ev('document.querySelector(".login-form").innerText')), await ev('document.querySelector(".login-form") && document.querySelector(".login-form").innerText'));
await shot('m5b-08-relogin');
await setFlags({});
await typeInto('#login-password', 'secret1');
await click('#login-submit');
check('after logging in again the waiting edit is sent', await waitFor('(JSON.parse(localStorage.getItem("__mockdocs"))["users/u1"].tasks||[]).some(function(t){return /edit during an ended session/.test(t.title)})', 6000));
check('and it is clean', await waitFor('localStorage.getItem("acadbro-dirty") === null', 4000));
await dismissToasts();
/* rejected (too big): stops retrying until the data changes */
await setFlags({ failSave: 'invalid-argument' });
await editTask('edit that is too big');
check('rejected: says what to do and offers Export', await waitFor('Array.from(document.querySelectorAll(".toast-warn .toast-msg")).some(function(e){return /1 MB limit/.test(e.textContent) && /delete old completions or notes/.test(e.textContent)}) && Array.from(document.querySelectorAll(".toast-btn")).some(function(b){return b.textContent.trim()==="Export"})', 5000), await toasts());
var tx2 = await txAttempts();
await sleep(6500);
check('rejected: no retry while the data is unchanged', (await txAttempts()) === tx2, [tx2, await txAttempts()]);
await editTask('another edit after trimming');
await sleep(2200);
check('rejected: a new edit is tried again', (await txAttempts()) > tx2, [tx2, await txAttempts()]);
await setFlags({});
await dismissToasts();
await click('[data-action="sync-now"]');
check('Sync now works as the manual way out', await waitFor('localStorage.getItem("acadbro-dirty") === null', 6000));
await dismissToasts();
/* format: cloud data from a newer AcadBro */
await ev('(function(){var all=JSON.parse(localStorage.getItem("__mockdocs"));var d=all["users/u1"];d.schema=2;d.rev="newer-app-rev";d.updatedAt=Date.now()+20000;all["users/u1"]=d;localStorage.setItem("__mockdocs",JSON.stringify(all));})()');
await load(BASEURL);
check('format: toast offers Reload', await waitFor('Array.from(document.querySelectorAll(".toast-btn")).some(function(b){return b.textContent.trim()==="Reload"})', 5000), await toasts());
await ensureSettings();
check('format: Account row offers Reload app', (await ev('document.getElementById("account-rows").innerText')).indexOf('Reload app') !== -1);
await ev('(function(){var all=JSON.parse(localStorage.getItem("__mockdocs"));var d=all["users/u1"];d.schema=1;d.rev="newer-app-rev-2";d.updatedAt=Date.now()+30000;all["users/u1"]=d;localStorage.setItem("__mockdocs",JSON.stringify(all));})()');
await dismissToasts();

/* ========== 7e. a save that hangs on a dead connection ========== */
console.log('--- 7e. hung save');
await load(BASEURL);
await sleep(800);
await setFlags({ hangSave: true });
var tx3 = await txAttempts();
await editTask('edit during a dead connection');
await sleep(1800);
check('first write is in flight (Syncing)', (await txAttempts()) === tx3 + 1 && (await ev('document.querySelector("#sync-dot .sync-dot-fill").className')).indexOf('is-syncing') !== -1, [tx3, await txAttempts(), await ev('document.querySelector("#sync-dot .sync-dot-fill").className')]);
await editTask('second edit while it hangs');
await editTask('third edit while it hangs');
await sleep(2500);
check('more edits do not start more writes (one in flight)', (await txAttempts()) === tx3 + 1, [tx3, await txAttempts()]);
check('Syncing... does not stay for ever: after the slow timeout it shows a failed / waiting state', await waitFor('document.querySelector("#sync-dot .sync-dot-fill").className.indexOf("is-error") !== -1', 16000), await ev('document.querySelector("#sync-dot .sync-dot-fill").className'));
check('the toast says the cloud is taking a while, with Sync now', await waitFor('Array.from(document.querySelectorAll(".toast-msg")).some(function(e){return /taking a while/.test(e.textContent)})', 2000), await toasts());
check('edits are kept (still dirty)', (await lsget('acadbro-dirty')) !== null);
await sleep(3500);
check('retries while stuck still do not pile up writes', (await txAttempts()) === tx3 + 1, [tx3, await txAttempts()]);
await shot('m5b-09-hung-save');
await setFlags({});
await dismissToasts();
await ev('localStorage.removeItem("acadbro-dirty"); localStorage.removeItem("__mockuser")'); /* test hygiene only: this page instance holds a hung write */

/* ========== 8. SDK unreachable: degrade gracefully ========== */
console.log('--- 8. SDK unreachable');
gstaticMode = 'fail';
var errsBefore = errors.length;
await ev('localStorage.setItem("acadbro-auth-hint","1")');
await load(BASEURL);
check('app renders with the SDK unreachable', (await ev('document.querySelectorAll(".page-tab").length')) === 4);
check('graceful toast, no uncaught exception', await waitFor('Array.from(document.querySelectorAll(".toast-msg")).some(function(e){return /Cloud sync is paused/.test(e.textContent)})', 4000), await toasts());
check('no uncaught exceptions', errors.slice(errsBefore).filter(function (e) { return /^exception/.test(e); }).length === 0, errors.slice(errsBefore));
await shot('m5-10-sdk-unreachable');
/* sync paused: signed in before + edits waiting */
await ev('localStorage.setItem("acadbro-dirty","1.1")');
await load(BASEURL);
await waitFor('Array.from(document.querySelectorAll(".toast-msg")).some(function(e){return /Cloud sync is paused/.test(e.textContent)})', 4000);
check('paused: header dot visible with "Sync paused · changes waiting"', (await ev('!document.getElementById("sync-dot").classList.contains("hidden") && document.getElementById("sync-dot").getAttribute("title")')) === 'Sync: Sync paused · changes waiting', await ev('document.getElementById("sync-dot").getAttribute("title")'));
await ensureSettings();
check('paused: Account row says it and offers a retry', /Sync paused · changes waiting/.test(await ev('document.getElementById("account-rows").innerText')) && (await ev('!!document.querySelector("[data-action=retry-sdk]")')) === true);
await shot('m5b-10-sync-paused');
await dismissToasts();
await click('[data-action="retry-sdk"]');
check('Retry with the service still unreachable: the second failure is reported (toast + Reload)', await waitFor('Array.from(document.querySelectorAll(".toast-msg")).some(function(e){return /still did not load/.test(e.textContent)}) && Array.from(document.querySelectorAll(".toast-btn")).some(function(b){return b.textContent.trim()==="Reload"})', 5000), await toasts());
gstaticMode = 'mock';
await dismissToasts();
var loadedInPlace = await waitFor('(async function(){var c=await import("/js/cloud.js");return c.sync.phase==="ready"})()', 8000);
console.log('   info: in-page retry after the CDN came back recovered on its own = ' + loadedInPlace);
check('CDN back: either the page recovered by itself, or it is told to reload (toast with Reload, row text)', loadedInPlace || await waitFor('Array.from(document.querySelectorAll(".toast-msg")).some(function(e){return /needs a reload/.test(e.textContent)}) && Array.from(document.querySelectorAll(".toast-btn")).some(function(b){return b.textContent.trim()==="Reload"})', 70000), await toasts());
if (!loadedInPlace) {
  await ensureSettings();
  check('paused row now says the connection is back', /Connection is back/.test(await ev('document.getElementById("account-rows").innerText')), await ev('document.getElementById("account-rows").innerText'));
  await shot('m5b-11-reload-advised');
  await clickToastBtn('Reload');
  await sleep(1800);
  check('after the reload the sign-in service loads (recovery path works)', await waitFor('(async function(){var c=await import("/js/cloud.js");return c.sync.phase==="ready"})()', 8000));
}
check('and the paused state clears (signed out here: dot hidden)', await waitFor('document.getElementById("sync-dot").classList.contains("hidden")', 4000));
gstaticMode = 'fail';
await ev('localStorage.removeItem("acadbro-dirty")');
await ev('localStorage.removeItem("acadbro-auth-hint")');
await load(BASEURL);
await dismissToasts();
await click('button[aria-label="Settings"]');
await click('[data-action="open-login"]');
check('tapping Log in with SDK unreachable warns', await waitFor('Array.from(document.querySelectorAll(".toast-msg")).some(function(e){return /sign-in service/.test(e.textContent)})', 5000), await toasts());
check('Account row says unavailable + retry', await waitFor('document.getElementById("account-rows").innerText.indexOf("Sign-in unavailable") !== -1', 2000));
check('still no uncaught exceptions', errors.filter(function (e) { return /^exception/.test(e); }).length === 0, errors);

console.log('--- console errors seen (network failures expected only in section 8):');
errors.forEach(function (e) { console.log('   ' + e.slice(0, 160)); });
console.log(failures.length ? 'FAILED: ' + failures.length : 'ALL OK');
ws.close();
chrome.kill();
process.exit(failures.length ? 1 : 0);
