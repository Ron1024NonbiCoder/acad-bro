/* The app's view of cloud sync, free of Firebase and (apart from showToast in
   main.js's caller) of the DOM, so every page can import it safely.

   - `sync` is the live status object the UI reads (account row, header dot).
   - auth.js (Firebase) is imported lazily, and its SDK is fetched from a CDN
     only when it is needed: when this browser has signed in before, or the user
     taps Log in. A never-signed-in user, or one who is offline, runs the app
     with no network access at all -- local-first, Auth is optional.
   - If auth.js or the SDK cannot load, phase becomes 'unavailable' and the UI
     says so; nothing throws. It is retried on the `online` event, on demand,
     and (with backoff) while edits are waiting to be sent. */

import { isDirty, onDirtyChange, pausedInfo, readAuthHint, retryDelay, syncInfo } from './sync-core.js';

/* Where the Firebase SDK comes from (auth.js imports it from the same place). */
export var SDK_BASE = 'https://www.gstatic.com/firebasejs/12.16.0/';

export var sync = {
  phase: 'idle',   /* 'idle' (SDK not requested) | 'loading' | 'ready' | 'unavailable' */
  user: null,      /* signed-in email, or null */
  uid: null,       /* signed-in account id, or null */
  loaded: false,   /* the cloud doc has been checked, so uploads are allowed */
  saving: false,   /* a cloud write is in flight */
  offline: false,  /* the browser reports no connection while signed in */
  error: null,     /* null | { kind, message } -- the reason sync is not working */
  conflict: null,  /* null | { cloudCounts, localCounts, cloudMs, localMs, choose(which) } */
  replaceAsk: null,/* null | { reason, promise, resolve }: asks before an occupied recovery slot is replaced */
  reloadAdvised: false /* the SDK host answers again but this page cannot retry the import: a reload can */
};

/* Handlers the UI layer registers so auth.js can offer next steps without
   importing the pages (set in main.js / page-account.js). */
export var actions = { relogin: null, exportData: null };

var listeners = [];
export function onSyncChange(fn) { listeners.push(fn); }
export function setSync(patch) {
  Object.assign(sync, patch);
  notifySync();
}
export function notifySync() {
  listeners.slice().forEach(function (fn) { try { fn(); } catch (err) { /* a UI listener must not break sync */ } });
}

/* One word for the header dot, plus the sentence for the Account row.
   kind: 'off' | 'attention' | 'error' | 'offline' | 'loading' | 'syncing' | 'pending' | 'synced' */
export function syncSummary(now) {
  if (!sync.user) {
    /* signed in before, but the sign-in service did not load: sync is paused */
    var paused = pausedInfo({ hint: readAuthHint(), phase: sync.phase, dirty: isDirty() });
    return paused ? { kind: 'paused', text: paused.text } : { kind: 'off', text: '' };
  }
  if (sync.conflict) return { kind: 'attention', text: 'Two versions found. Choose which one to keep.' };
  if (sync.error) return { kind: 'error', text: sync.error.message };
  if (sync.offline) return { kind: 'offline', text: 'Offline. Changes stay on this device and sync when you are back online.' };
  if (!sync.loaded) return { kind: 'loading', text: 'Checking your cloud data...' };
  if (sync.saving) return { kind: 'syncing', text: 'Syncing...' };
  var info = syncInfo(now);
  return { kind: info.pending ? 'pending' : 'synced', text: info.text };
}

/* ================= lazy backend ================= */
var backend = null;      /* the object auth.js init() returns */
var loadPromise = null;
var authMod = null;      /* auth.js once it has been imported */
var failures = 0;        /* consecutive failed loads: drives the backoff and the cache-busting retry */
var autoTimer = null;

/* Resolves true when the sign-in service is ready, false when it could not be
   loaded (phase 'unavailable'). Safe to call repeatedly. A retry after a failure
   imports auth.js with a cache-busting query: a browser may remember a failed
   module import for the life of the page. */
export function ensureBackend() {
  if (backend) return Promise.resolve(true);
  if (loadPromise) return loadPromise;
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  setSync({ phase: 'loading' });
  var spec = failures > 0 && !authMod ? './auth.js?r=' + Date.now() : './auth.js';
  loadPromise = (authMod ? Promise.resolve(authMod) : import(spec).then(function (m) { authMod = m; return m; }))
    .then(function (mod) { return mod.init(); })
    .then(function (api) {
      backend = api;
      loadPromise = null;
      failures = 0;
      setSync({ phase: 'ready', reloadAdvised: false });
      return true;
    })
    .catch(function () {
      loadPromise = null;
      failures++;
      setSync({ phase: 'unavailable' });
      scheduleBackendRetry();
      adviseReloadIfReachable();
      return false;
    });
  return loadPromise;
}

/* A browser may remember a failed module import for the life of the page (Chrome
   does), so a retry in this page can keep failing after the network is back.
   When the SDK host answers a plain request but the import still fails, say so:
   a reload is the fix, and edits are already safe on this device. */
function adviseReloadIfReachable() {
  if (sync.reloadAdvised || typeof fetch !== 'function') return;
  fetch(SDK_BASE + 'firebase-app.js', { mode: 'no-cors', cache: 'no-store' }).then(function () {
    if (!backend && sync.phase === 'unavailable') setSync({ reloadAdvised: true });
  }).catch(function () { /* still unreachable: the backoff keeps trying */ });
}

/* While edits are waiting and the service is not loaded, keep trying on a
   backoff (2/5/15/30/60 s); the `online` event and a return to the foreground
   also try. Offline, the timer waits for the `online` event instead. */
function scheduleBackendRetry() {
  if (autoTimer || backend || loadPromise || sync.phase !== 'unavailable' || sync.reloadAdvised) return;
  if (!readAuthHint() || !isDirty()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  autoTimer = setTimeout(function () {
    autoTimer = null;
    if (!backend && sync.phase === 'unavailable') ensureBackend();
  }, retryDelay(Math.max(0, failures - 1)));
}
onDirtyChange(function () {
  if (sync.phase === 'unavailable') { notifySync(); scheduleBackendRetry(); }
});

/* A fresh copy of the app (and of its service worker) */
export function reloadApp() {
  var go = function () { location.reload(); };
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (r) { return r && r.update(); }).then(go, go);
      return;
    }
  } catch (err) { /* fall through */ }
  go();
}

/* ================= ask before replacing an occupied recovery slot ================= */
/* Resolves true = replace it, false = cancel. One question at a time. */
export function askReplaceRecovery(reason) {
  if (sync.replaceAsk) return sync.replaceAsk.promise;
  var ask = { reason: reason };
  ask.promise = new Promise(function (resolve) { ask.resolve = resolve; });
  setSync({ replaceAsk: ask });
  return ask.promise;
}
export function answerReplaceRecovery(replace) {
  var ask = sync.replaceAsk;
  if (!ask) return;
  setSync({ replaceAsk: null });
  ask.resolve(!!replace);
}

/* Launch: load the SDK only if this browser has signed in before. Resolves
   true | false, or null when nothing needed loading. */
export function initCloud() {
  if (!readAuthHint()) return Promise.resolve(null);
  return ensureBackend();
}

/* When the connection returns, a service that failed to load gets another go. */
if (typeof window !== 'undefined') {
  window.addEventListener('online', function () {
    if (sync.phase === 'unavailable' && readAuthHint()) ensureBackend();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && sync.phase === 'unavailable' && readAuthHint()) ensureBackend();
  });
}

/* ================= actions the UI calls ================= */
/* { ok:true } | { ok:false, error } */
export function cloudLogin(email, password) {
  return ensureBackend().then(function (ok) {
    if (!ok) return { ok: false, error: 'Could not load the sign-in service. Please check your connection, then try again.' };
    return backend.login(email, password);
  });
}
/* { ok:true, unsynced } | { ok:false, error } */
export function cloudLogout() {
  if (!backend) return Promise.resolve({ ok: false, error: 'Sign-in service is not loaded yet. Please try again in a moment.' });
  return backend.logout();
}
export function cloudSyncNow() { if (backend) backend.syncNow(); }
export function cloudChoose(which) { return backend && sync.conflict ? backend.choose(which) : { ok: false, error: 'Nothing to choose right now.' }; }
