/* App updates. A deploy reaches the installed app through the service worker
   (sw.js): the new worker installs, takes over (skipWaiting + clients.claim),
   and the open page then still runs the old code until it reloads. This module
   tracks that, so Settings can offer "Reload". It never reloads by itself: the
   user may be mid-edit.

   Status: idle (not checked yet) | checking | uptodate | ready | error.
   A deploy that leaves sw.js byte-identical is invisible here; bump CACHE in
   sw.js on every deploy (docs/DEV.md). */

export var appUpdate = { status: 'idle' };

var listeners = [];
var hadController = false;
var inited = false;
var lastQuiet = 0;
var QUIET_GAP_MS = 10 * 60 * 1000;
var INSTALL_WAIT_MS = 20000;

export function onAppUpdateChange(fn) { listeners.push(fn); }

function setStatus(status) {
  if (appUpdate.status === status) return;
  appUpdate.status = status;
  listeners.forEach(function (fn) { try { fn(); } catch (err) { /* a view failing to refresh must not break updates */ } });
}

export function initAppUpdate() {
  if (inited || !('serviceWorker' in navigator)) return;
  inited = true;
  hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    /* the first install also claims the page: that is not an update */
    if (!hadController) { hadController = true; return; }
    setStatus('ready');
  });
  /* coming back to the app: look for a new version without bothering the user */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || appUpdate.status === 'ready') return;
    if (Date.now() - lastQuiet < QUIET_GAP_MS) return;
    lastQuiet = Date.now();
    navigator.serviceWorker.getRegistration().then(function (r) { return r && r.update(); }).catch(function () {});
  });
}

/* The "Check for updates" tap: shows progress and the result. */
export function checkForUpdate() {
  if (appUpdate.status === 'checking' || appUpdate.status === 'ready') return;
  if (!inited) { setStatus('error'); return; }
  setStatus('checking');
  navigator.serviceWorker.getRegistration().then(function (reg) {
    if (!reg) throw new Error('no registration');
    return reg.update().then(function () { return reg; });
  }).then(function (reg) {
    if (appUpdate.status !== 'checking') return;
    var worker = reg.installing || reg.waiting;
    if (!worker) { setStatus('uptodate'); return; }
    /* a new version is installing: controllerchange flips this to "ready" */
    worker.addEventListener('statechange', function () {
      if (worker.state === 'redundant' && appUpdate.status === 'checking') setStatus('uptodate');
    });
    setTimeout(function () { if (appUpdate.status === 'checking') setStatus('uptodate'); }, INSTALL_WAIT_MS);
  }).catch(function () {
    if (appUpdate.status === 'checking') setStatus('error');
  });
}

export function applyUpdate() { location.reload(); }
