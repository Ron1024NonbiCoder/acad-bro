/* Firebase glue: login, the cloud document, and the sync loop. Ported from
   GymBro's web/auth.js (same model: dirty marker + BASE + token-matched ack);
   the decisions themselves live in sync-core.js where node tests cover them.

   Loaded lazily by cloud.js. The SDK comes from the CDN with dynamic import()
   inside init(), so a missing network rejects init() (cloud.js turns that into
   phase 'unavailable') instead of breaking the app. The web config below is
   public by design; access is controlled by firestore.rules.

   Rules for what this file must never do (CLAUDE.md: no silent data loss):
   - never upload before the account's cloud doc has been fetched (cloudReady);
   - never replace local data without first keeping a recovery copy of it,
     and never replace it at all if that copy cannot be stored;
   - never fail quietly: every error, recovery and conflict reaches the user
     through setSync() (status row / header dot) and a toast, with a next step;
   - never overwrite a cloud doc another device has changed: every write is a
     Firestore transaction that only commits while the doc still carries the
     `rev` this device last saw (BASE) or one it wrote itself; otherwise the
     conflict sheet opens and nothing is sent;
   - never replace an occupied recovery slot without asking first. */

import {
  applyCloudData, cloud, countsOf, DB, defaultData, normalizeData, syncDBFromStorage
} from './storage.js';
import {
  addPendingRev, clearDirty, clearDirtyIf, cloudIsKnown, createWriteGate, decideOnLoad, dirtySinceMs,
  gateRequest, gateSettle, isDirty, markDirty, newRev, readConflictBackup, readDirty, readOwner,
  readPendingRevs, readRev, retryDelay, saveConflictBackup, transactionVerdict, writeAuthHint,
  writeLastSync, writeOwner, writeRev
} from './sync-core.js';
import { actions, answerReplaceRecovery, askReplaceRecovery, reloadApp, SDK_BASE, sync, setSync } from './cloud.js';
import { showToast } from './toast.js';
import { render, openSettings } from './shell.js';
import { clearActive } from './state.js';

var SDK = SDK_BASE;
var firebaseConfig = {
  apiKey: 'AIzaSyAOnVdEmjwtjMibeOfLVnbu2sjWvU3p91c',
  authDomain: 'acadbro-166c4.firebaseapp.com',
  projectId: 'acadbro-166c4',
  storageBucket: 'acadbro-166c4.firebasestorage.app',
  messagingSenderId: '395278719258',
  appId: '1:395278719258:web:52c74d6abe52f6acf174a3'
};

var fb = null;   /* { auth, db, signIn, signOut, doc, getDoc, runTransaction, serverTimestamp } */
var started = false;

var SAVE_DEBOUNCE_MS = 1000;
var SLOW_SAVE_MS = 15000;     /* a write unacknowledged this long is reported, not waited on silently */
var REFRESH_MIN_MS = 20000;   /* foreground re-check of the cloud doc, at most this often */

var currentUid = null;
var cloudReady = false;       /* uploads stay off until the signed-in account's doc is known */
var saveTimer = null;
var savingCount = 0;
var gate = createWriteGate(); /* at most one write in flight + one coalesced follow-up */
var lastAckEpoch = 0;         /* a late ack of an older write never rewinds BASE */
var rejectedToken = null;     /* dirty token the cloud refused as too big: no retry until an edit changes it */
var authBlocked = false;      /* the session is gone: no retry until the user logs in again */
var choosing = false;         /* a conflict choice is waiting on the recovery-slot question */
var announceNext = false;     /* the user just logged in: say what happened */
var announceOnSync = null;    /* a message to show once the next write is acknowledged */
var recoveryPending = false;  /* the user was told about a problem: tell them when it is over */
var lastRefresh = 0;
var conflictCtx = null;      /* { uid, cloudData, cloudMs } while the conflict sheet is open */

/* ================= messages (positive phrasing, each with a next step) ================= */
var ERRORS = {
  network: 'Could not reach the cloud. Changes stay on this device and will sync automatically.',
  offline: 'You are offline. Changes stay on this device and sync when you are back online.',
  slow: 'The cloud is taking a while to answer. Changes stay on this device and keep retrying.',
  denied: 'The cloud did not accept this save. Changes stay on this device. Please update AcadBro, then tap Sync now.',
  rejected: 'The cloud could not store this data (1 MB limit). Please export a backup, then delete old completions or notes. Syncing resumes after your next change.',
  auth: 'Please log in again to resume syncing. Changes not yet synced stay on this device.',
  format: 'Your cloud data is from a newer AcadBro. Please reload the app to update, then sync.',
  storage: 'The cloud copy is not saved on this device (storage is full). Please export your data and delete old completions or notes to free space, then tap Sync now.'
};
var LOGIN_ERRORS = {
  'auth/invalid-email': 'Please enter a valid email, like name@example.com',
  'auth/missing-password': 'Please enter your password.',
  'auth/user-disabled': 'This account is turned off. Please contact the app owner.',
  'auth/user-not-found': 'Email or password did not match. Please check them and try again.',
  'auth/wrong-password': 'Email or password did not match. Please check them and try again.',
  'auth/invalid-credential': 'Email or password did not match. Please check them and try again.',
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes, then try again.',
  'auth/network-request-failed': 'Could not reach the sign-in service. Please check your connection and try again.'
};

function classify(err) {
  var c = err && err.code ? String(err.code).replace(/^firestore\//, '') : '';
  if (c === 'permission-denied') return 'denied';
  if (c === 'unauthenticated') return 'auth';
  if (c === 'invalid-argument' || c === 'resource-exhausted' || c === 'out-of-range') return 'rejected';
  return isOffline() ? 'offline' : 'network';
}
function isOffline() { return typeof navigator !== 'undefined' && navigator.onLine === false; }

/* Tell the user once per kind of problem (retries do not re-toast), keep the
   reason on the status row until it is gone. */
function setError(kind) {
  var changed = !sync.error || sync.error.kind !== kind;
  setSync({ error: { kind: kind, message: ERRORS[kind] } });
  recoveryPending = true;
  if (!changed) return;
  showToast({ message: ERRORS[kind], tone: 'warn', actions: errorActions(kind) });
}
/* every error toast carries a button that does something about it */
function errorActions(kind) {
  var syncBtn = { label: 'Sync now', primary: true, onClick: function () { retryEverythingNow(true); } };
  var exportBtn = { label: 'Export', primary: true, onClick: function () { if (actions.exportData) actions.exportData(); } };
  if (kind === 'auth') return [{ label: 'Log in again', primary: true, onClick: function () { if (actions.relogin) actions.relogin(); } }];
  if (kind === 'format') return [{ label: 'Reload', primary: true, onClick: reloadApp }];
  if (kind === 'rejected') return [exportBtn];
  if (kind === 'storage') return [exportBtn, { label: 'Sync now', onClick: function () { retryEverythingNow(true); } }];
  return [syncBtn];
}
function clearError() {
  if (sync.error) setSync({ error: null });
  if (recoveryPending) {
    recoveryPending = false;
    showToast({ message: 'Back in sync. Your changes are saved to the cloud.', tone: 'good' });
  }
}

function localHasContent() {
  return DB.projects.length > 0 || DB.tasks.length > 0 || DB.completions.length > 0;
}
function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
function countsText(c) { return plural(c.projects, 'project') + ', ' + plural(c.tasks, 'task'); }

/* The cloud doc's updatedAt as milliseconds, or null when it has none. */
function updatedMs(data) {
  var t = data && data.updatedAt;
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null;
}

/* ================= writing ================= */
function buildPayload(rev) {
  /* the explicit field list is the firestore.rules allow-list; the JSON round
     trip drops `undefined`, which the Firestore SDK refuses */
  var p = JSON.parse(JSON.stringify({
    schema: DB.schema,
    areaLabels: DB.areaLabels,
    projects: DB.projects,
    tasks: DB.tasks,
    completions: DB.completions
  }));
  p.rev = rev;
  p.updatedAt = fb.serverTimestamp();
  return p;
}

/* Should automatic retries wait? A refused-as-too-big save stays refused until
   the data changes; a dead session stays dead until the user logs in again. */
function syncBlocked() {
  return authBlocked || (rejectedToken !== null && rejectedToken === readDirty());
}

/* Resolves true when the cloud acknowledged this write.
   The write is a transaction: read the doc, and only if it still carries the
   rev this device knows (BASE, or a rev this device sent itself) write ours.
   If another device wrote in between, nothing is sent and the usual
   conflict/apply flow runs on what the transaction just read. One write at a
   time: edits made while it is in flight are folded into one follow-up. */
function cloudSave(uid) {
  if (syncBlocked()) return Promise.resolve(false);
  if (isOffline()) { markOffline(); return Promise.resolve(false); }
  var req = gateRequest(gate, Date.now());
  if (req.action === 'queued') {
    if (sync.error) scheduleRetry(); /* keep trying while the in-flight write is stuck */
    return Promise.resolve(false);
  }
  var epoch = req.epoch;
  syncDBFromStorage(); /* another tab may have saved newer data than this tab holds */
  /* what this write covers: an edit made while it is in flight leaves a newer
     marker behind and stays dirty, to be picked up by the save that edit
     scheduled */
  var token = readDirty();
  var rev = newRev();
  var payload;
  try { payload = buildPayload(rev); } catch (err) {
    gateSettle(gate, epoch);
    rejectedToken = token;
    setError('rejected');
    return Promise.resolve(false);
  }
  /* remembered BEFORE sending: if the ack never arrives, the cloud showing this
     rev later still means "ours", not "another device's" */
  addPendingRev(rev);
  savingCount++;
  setSync({ saving: true });
  var released = false;
  function release() {
    if (released) return;
    released = true;
    savingCount = Math.max(0, savingCount - 1);
    setSync({ saving: savingCount > 0 });
  }
  /* a write unanswered this long is shown as failed / waiting to retry (the
     edit stays dirty); the write itself is not abandoned until gate HARD_SAVE_MS */
  var slow = setTimeout(function () {
    if (released || currentUid !== uid) return;
    release();
    setError('slow');
    scheduleRetry();
  }, SLOW_SAVE_MS);
  var ref = fb.doc(fb.db, 'users', uid);
  return fb.runTransaction(fb.db, function (tx) {
    return tx.get(ref).then(function (snap) {
      var data = snap.exists() ? snap.data() : null;
      var verdict = transactionVerdict({
        exists: snap.exists(),
        cloudRev: data && typeof data.rev === 'string' ? data.rev : null,
        base: readRev(),
        pending: readPendingRevs()
      });
      if (verdict === 'foreign') return { foreign: true, data: data };
      tx.set(ref, payload);
      return { foreign: false };
    });
  }).then(function (res) {
    clearTimeout(slow);
    release();
    var st = gateSettle(gate, epoch);
    if (currentUid !== uid) return false;
    if (res.foreign) {
      if (!st.stale) onForeignCloud(uid, res.data);
      return false;
    }
    /* committed: the doc now carries OUR rev (the transaction saw nobody else's) */
    if (epoch > lastAckEpoch) { lastAckEpoch = epoch; writeRev(rev); }
    clearDirtyIf(token);
    writeLastSync(Date.now());
    retryAttempt = 0;
    rejectedToken = null;
    authBlocked = false;
    clearRetry();
    setSync({ offline: false });
    clearError();
    if (announceOnSync) { showToast({ message: announceOnSync, tone: 'good' }); announceOnSync = null; }
    setSync({});
    if (st.runFollowUp && isDirty()) syncNow(false);
    return true;
  }).catch(function (err) {
    clearTimeout(slow);
    release();
    var st = gateSettle(gate, epoch);
    if (currentUid !== uid || st.stale) return false;
    console.warn('AcadBro cloud save failed:', err && err.code, err);
    var kind = classify(err);
    setError(kind);
    if (kind === 'rejected') rejectedToken = token;
    else if (kind === 'auth') authBlocked = true;
    else scheduleRetry();
    return false;
  });
}

/* The transaction found a doc this device has not seen: another device wrote
   since. Run the same verdict as at launch on what it read. */
function onForeignCloud(uid, rawDoc) {
  if (!rawDoc) { retryEverythingNow(false); return; }
  onCloudDoc(uid, rawDoc, true, true);
}

/* ---- retry: a failed save is not forgotten ----
   The dirty marker says there is something to send; this makes sure it is
   sent again: on a backoff timer (2/5/15/30/60s), the moment the browser
   reports it is online, and when the app comes back to the foreground. */
var retryTimer = null;
var retryAttempt = 0;
function clearRetry() { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } }
function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(function () { retryTimer = null; syncNow(false); }, retryDelay(retryAttempt++));
}
/* send whatever this device holds, if it holds anything unsent. manual = the
   user asked (Sync now / Log in again): that lifts the "wait for a change" blocks. */
function syncNow(manual) {
  if (!currentUid || !cloudReady || !isDirty()) return;
  if (manual) { rejectedToken = null; authBlocked = false; }
  else if (syncBlocked()) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  cloudSave(currentUid);
}
function retryEverythingNow(manual) {
  if (!currentUid || sync.replaceAsk) return;
  if (manual) { rejectedToken = null; authBlocked = false; }
  retryAttempt = 0;
  clearRetry();
  if (!cloudReady) { clearLoadRetry(); loadCloudData(currentUid, false); }
  else if (isDirty()) syncNow(manual);
  else refreshFromCloud(true);
}

function scheduleCloudSave() {
  if (!currentUid || !cloudReady) return;
  var uid = currentUid;
  if (saveTimer) clearTimeout(saveTimer);
  /* the live DB is read when the timer fires (buildPayload), not the object
     this edit saw: applyCloudData() may have swapped it since */
  saveTimer = setTimeout(function () {
    saveTimer = null;
    if (currentUid === uid && cloudReady) cloudSave(uid);
  }, SAVE_DEBOUNCE_MS);
}

/* The 1s debounce means an edit made just before the tab is closed, or the
   PWA is backgrounded on a phone, would never be written. Flush it, and
   anything an earlier failure left waiting for a retry. If the page is frozen
   before this finishes, the dirty marker is what the next launch goes by. */
function flushCloudSave() {
  if (!currentUid || !cloudReady) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (isDirty() && !syncBlocked()) cloudSave(currentUid);
}

function markOffline() {
  if (!currentUid) return;
  var first = !sync.offline;
  setSync({ offline: true });
  recoveryPending = true;
  if (first) showToast({ message: ERRORS.offline });
}

/* ================= applying what the cloud holds ================= */
/* Keep a copy of what is about to be replaced. false = it could not be kept,
   in which case the caller must NOT replace anything. ownerUid = the account the
   kept data belongs to (null = made before any login). */
function keepRecoveryCopy(kept, discarded, ownerUid, quiet) {
  if (saveConflictBackup(kept, discarded, ownerUid)) return true;
  if (!quiet) showToast({
    message: 'A recovery copy could not be stored (device storage is full), so nothing was changed. Please export your data first.',
    tone: 'warn'
  });
  return false;
}

/* The recovery copy has ONE slot. Before an event replaces an occupied slot the
   user decides: export it first, replace it, or cancel. Resolves true to go on. */
function ensureRecoverySlot(reason) {
  if (!readConflictBackup()) return Promise.resolve(true);
  return askReplaceRecovery(reason);
}

/* The user cancelled the question that logging in raised: stay logged out with
   the data on this device exactly as it was. */
function abortLogin() {
  announceNext = false;
  announceOnSync = null;
  writeAuthHint(false);
  showToast({ message: 'Login cancelled. Your data on this device is unchanged.' });
  return fb.signOut(fb.auth).catch(function () { /* the next launch asks again */ });
}

/* The cloud copy becomes this device's data. Returns true only when it was
   also saved on this device: if it could not be written, nothing is recorded as
   synced (BASE, owner, dirty stay as they were) so the next launch decides again
   from what really is on disk, and the user is told how to free space. */
function applyCloud(uid, cloudData, cloudRev) {
  var r = applyCloudData(cloudData);
  if (!r.ok) { setError('format'); return false; }
  clearActive();
  render(); /* memory now shows the cloud copy */
  if (!r.persisted) {
    cloudReady = false;
    setSync({ loaded: false, offline: false });
    setError('storage');
    return false;
  }
  clearDirty(); /* the cloud copy replaced local state: nothing here is waiting any more */
  cloudReady = true;
  writeOwner(uid);
  if (cloudRev) writeRev(cloudRev);
  writeLastSync(Date.now());
  setSync({ loaded: true, offline: false });
  clearError();
  return true;
}

/* An unreadable / newer-schema cloud doc must not license overwriting it. */
function refuseCloudDoc(kind) {
  cloudReady = false;
  setSync({ loaded: false });
  setError(kind || 'format');
}

/* Unsynced edits here AND a cloud doc that moved on: ask. The discarded side is
   kept as a recovery copy when the user chooses. The sheet cannot be dismissed
   (page-account.js): both answers are safe, leaving it open is not an answer. */
function openConflict(uid, cloudData, cloudMs, cloudRev) {
  /* nothing is sent while the user has not chosen */
  cloudReady = false;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  clearRetry();
  setSync({
    loaded: false,
    conflict: {
      cloudCounts: countsOf(cloudData),
      localCounts: countsOf(DB),
      cloudMs: cloudMs,
      localMs: dirtySinceMs()
    }
  });
  conflictCtx = { uid: uid, cloudData: cloudData, cloudMs: cloudMs, cloudRev: cloudRev };
}

/* -> Promise<{ ok, error?, cancelled? }>. If the recovery slot is occupied the
   user is asked first; cancelling changes nothing (both versions stay). */
function choose(which) {
  var ctx = conflictCtx;
  if (!ctx || currentUid !== ctx.uid) return Promise.resolve({ ok: false, error: 'This choice is no longer available.' });
  if (choosing) return Promise.resolve({ ok: false, cancelled: true });
  choosing = true;
  var replacing = !!readConflictBackup();
  return ensureRecoverySlot('conflict').then(function (go) {
    choosing = false;
    if (!go) return { ok: false, cancelled: true };
    if (conflictCtx !== ctx || currentUid !== ctx.uid) return { ok: false, error: 'The cloud changed again. Please choose once more.' };
    var note = replacing ? ' It replaced the earlier recovery copy.' : '';
    var where = 'Restore it from Settings > Account.';
    if (which === 'cloud') {
      if (!keepRecoveryCopy('cloud', DB, readOwner())) return { ok: false, error: 'Recovery copy not stored.' };
      conflictCtx = null;
      setSync({ conflict: null });
      if (applyCloud(ctx.uid, ctx.cloudData, ctx.cloudRev)) {
        showToast({
          message: 'Kept the cloud copy. This device\'s version is saved as a recovery copy. ' + where + note,
          tone: 'good',
          actions: [{ label: 'Settings', primary: true, onClick: openSettings }]
        });
      }
    } else {
      var kept = Object.assign({}, ctx.cloudData);
      delete kept.updatedAt;
      if (!keepRecoveryCopy('local', kept, ctx.uid)) return { ok: false, error: 'Recovery copy not stored.' };
      conflictCtx = null;
      /* the user has now seen the cloud version and chose to overwrite it: it is
         the new BASE, so the guarded write is allowed to replace exactly that */
      if (ctx.cloudRev) writeRev(ctx.cloudRev);
      if (!isDirty()) markDirty();
      cloudReady = true;
      writeOwner(ctx.uid);
      setSync({ conflict: null, loaded: true });
      announceOnSync = null;
      syncNow(true);
      showToast({
        message: 'Kept this device. The cloud copy is saved as a recovery copy. ' + where + note,
        tone: 'good',
        actions: [{ label: 'Settings', primary: true, onClick: openSettings }]
      });
    }
    return { ok: true };
  });
}

/* ================= loading the cloud doc (retried until it works) ================= */
var loadTimer = null;
var loadAttempt = 0;
var loading = false;
function clearLoadRetry() { if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; } }

/* refresh = a re-check while the app is already running: it changes nothing
   unless the cloud moved on. */
function loadCloudData(uid, refresh) {
  if (loading || sync.replaceAsk) return;
  if (isOffline()) { markOffline(); return; }
  loading = true;
  fb.getDoc(fb.doc(fb.db, 'users', uid)).then(function (snap) {
    loading = false;
    if (currentUid !== uid) return; /* signed out or switched mid-flight */
    loadAttempt = 0;
    if (snap.exists()) onCloudDoc(uid, snap.data(), refresh);
    else onNoCloudDoc(uid);
  }).catch(function (err) {
    loading = false;
    if (currentUid !== uid) return;
    console.warn('AcadBro cloud load failed:', err && err.code, err);
    if (refresh && cloudReady) return; /* a failed re-check is not a problem: saves report their own */
    var kind = classify(err);
    setError(kind);
    clearLoadRetry();
    if (kind === 'auth') { authBlocked = true; return; } /* retrying a dead session helps nobody: Log in again */
    loadTimer = setTimeout(function () { loadTimer = null; loadCloudData(uid, false); }, retryDelay(loadAttempt++));
  });
}

/* foreign = this came from a refused write (another device wrote since BASE) */
function onCloudDoc(uid, rawDoc, refresh, foreign) {
  /* Existing account. Drop any save queued from local data before we knew what
     the cloud holds, so it can't clobber the doc. */
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  syncDBFromStorage(); /* what we compare with must be what is really on this device */
  var cloudMs = updatedMs(rawDoc);
  var cloudRev = typeof rawDoc.rev === 'string' && rawDoc.rev ? rawDoc.rev : null;
  var raw = Object.assign({}, rawDoc, { updatedAt: cloudMs !== null ? new Date(cloudMs).toISOString() : null });
  delete raw.rev; /* sync bookkeeping, not part of the user's data */
  var cloudData = normalizeData(raw);
  if (!cloudData) { refuseCloudDoc(); return; }

  var base = readRev();
  var pending = readPendingRevs();
  var ownerMatches = readOwner() === uid;
  /* unseen cloud data meeting local content with no BASE to compare: never guess */
  var dirty = isDirty() || (!!foreign && base === null && localHasContent());
  /* nothing to do: no unsynced edits here and the cloud is exactly what this
     device last saw. Skipping the swap avoids a re-render under the user's finger. */
  if (!dirty && ownerMatches && cloudIsKnown(cloudRev, base, pending)) {
    cloudReady = true;
    writeLastSync(Date.now());
    setSync({ loaded: true, offline: false });
    clearError();
    if (announceNext) { announceNext = false; showToast({ message: 'Logged in. Your data is up to date.', tone: 'good' }); }
    return;
  }

  var verdict = decideOnLoad({ dirty: dirty, ownerMatches: ownerMatches, base: base, cloudRev: cloudRev, pending: pending });
  if (verdict === 'push-local') {
    /* only this device wrote since it last synced: its copy is the newer */
    if (cloudRev && cloudRev !== base) writeRev(cloudRev);
    cloudReady = true;
    setSync({ loaded: true });
    clearError();
    syncNow(true);
  } else if (verdict === 'conflict') {
    openConflict(uid, cloudData, cloudMs, cloudRev);
  } else {
    /* the usual case: the cloud doc wins. Data on this device that belongs to no
       account yet (or to another one) is kept as a recovery copy first. */
    var hadLocal = !ownerMatches && localHasContent();
    var proceed = function () {
      if (currentUid !== uid) return;
      var replacing = hadLocal && !!readConflictBackup();
      if (hadLocal && !keepRecoveryCopy('cloud', DB, readOwner(), true)) { refuseCloudDoc('storage'); return; }
      var before = countsOf(DB);
      if (applyCloud(uid, cloudData, cloudRev)) {
        if (hadLocal) {
          showToast({
            message: 'Cloud data loaded. What was on this device is saved as a recovery copy. Restore it from Settings > Account.' + (replacing ? ' It replaced the earlier recovery copy.' : ''),
            actions: [{ label: 'Settings', primary: true, onClick: openSettings }]
          });
        } else if (announceNext) {
          showToast({ message: 'Logged in. Loaded ' + countsText(countsOf(DB)) + ' from your account.', tone: 'good' });
        } else if (refresh && JSON.stringify(before) !== JSON.stringify(countsOf(DB))) {
          showToast({ message: 'Updated from another device: ' + countsText(countsOf(DB)) + '.' });
        } else if (refresh) {
          showToast({ message: 'Updated from another device.' });
        }
        announceNext = false;
      }
    };
    if (hadLocal) {
      cloudReady = false;
      setSync({ loaded: false });
      ensureRecoverySlot('login').then(function (go) {
        if (currentUid !== uid) return;
        if (!go) { abortLogin(); return; }
        proceed();
      });
    } else {
      proceed();
    }
  }
}

function onNoCloudDoc(uid) {
  /* No doc: this account is brand new. The only path on which local data is
     allowed to reach the cloud. If this browser holds a different account's
     data, start clean (keeping that data as a recovery copy) rather than
     donating it to this one. */
  var prev = readOwner();
  if (prev && prev !== uid && localHasContent()) {
    cloudReady = false;
    setSync({ loaded: false });
    ensureRecoverySlot('login').then(function (go) {
      if (currentUid !== uid) return;
      if (!go) { abortLogin(); return; }
      if (!keepRecoveryCopy('cloud', DB, prev, true)) { refuseCloudDoc('storage'); return; }
      var fresh = defaultData();
      fresh.updatedAt = new Date().toISOString();
      var r = applyCloudData(fresh);
      clearActive();
      render();
      if (!r.ok || !r.persisted) {
        /* the empty start could not be saved here: leave owner / dirty alone */
        refuseCloudDoc('storage');
        return;
      }
      clearDirty();
      showToast({
        message: 'New account started empty. The data that was on this device is saved as a recovery copy. Restore it from Settings > Account.',
        actions: [{ label: 'Settings', primary: true, onClick: openSettings }]
      });
      startNewAccount(uid);
    });
    return;
  }
  if (announceNext) {
    announceOnSync = localHasContent()
      ? 'Logged in. Your data on this device is now saved to your account.'
      : 'Logged in. Your account is ready.';
  }
  startNewAccount(uid);
}
function startNewAccount(uid) {
  announceNext = false;
  cloudReady = true;
  writeOwner(uid);
  setSync({ loaded: true });
  clearError();
  cloudSave(uid);
}

/* Foreground re-check: another device may have written while this one was away.
   Only when idle, so it never races our own write (our write landing would
   look like a foreign change). */
function refreshFromCloud(force) {
  if (!currentUid || !cloudReady || loading || saving() || gate.busy || saveTimer || sync.replaceAsk) return;
  var now = Date.now();
  if (!force && now - lastRefresh < REFRESH_MIN_MS) return;
  lastRefresh = now;
  loadCloudData(currentUid, true);
}
function saving() { return savingCount > 0; }

/* ================= login / logout ================= */
function login(email, password) {
  var before = currentUid; /* set = logging in again to a session that went stale */
  announceNext = !before;
  return fb.signIn(fb.auth, email, password).then(function () {
    if (before && currentUid === before) {
      /* the same account: no auth event follows, so resume syncing here */
      authBlocked = false;
      rejectedToken = null;
      if (sync.error && sync.error.kind === 'auth') setSync({ error: null });
      retryEverythingNow(true);
    }
    return { ok: true };
  }).catch(function (err) {
    announceNext = false;
    return { ok: false, error: LOGIN_ERRORS[err && err.code] || 'Could not log in. Please try again.' };
  });
}

function logout() {
  var uid = currentUid;
  /* one last try to send unsynced edits while the session still exists */
  var flush = uid && cloudReady && isDirty() && !isOffline()
    ? Promise.race([cloudSave(uid), new Promise(function (r) { setTimeout(r, 4000); })])
    : Promise.resolve();
  return flush.then(function () {
    var unsynced = isDirty();
    writeAuthHint(false);
    return fb.signOut(fb.auth).then(function () {
      return { ok: true, unsynced: unsynced };
    });
  }).catch(function () {
    return { ok: false, error: 'Could not log out. Please try again.' };
  });
}

function resetWriteState() {
  /* an old in-flight write must not be mistaken for the current one */
  gate.busy = false; gate.followUp = false; gate.epoch++;
  rejectedToken = null; authBlocked = false; choosing = false;
}

function onAuthChange(user) {
  answerReplaceRecovery(false); /* a question about the previous session is over */
  if (user) {
    currentUid = user.uid;
    cloudReady = false; /* armed by loadCloudData once the doc is known */
    resetWriteState();
    /* a timer left armed from a previous auth pass would upload stale local
       state into the doc we are about to fetch */
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    clearRetry(); clearLoadRetry(); retryAttempt = 0; loadAttempt = 0; loading = false;
    writeAuthHint(true);
    setSync({ user: user.email || 'Account', uid: user.uid, loaded: false, error: null, offline: false, conflict: null });
    cloud.onLocalChange = scheduleCloudSave;
    loadCloudData(user.uid, false);
  } else {
    currentUid = null;
    cloudReady = false;
    conflictCtx = null;
    resetWriteState();
    announceNext = false; announceOnSync = null; recoveryPending = false;
    cloud.onLocalChange = null;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    clearRetry(); clearLoadRetry(); loading = false; savingCount = 0;
    setSync({ user: null, uid: null, loaded: false, saving: false, error: null, offline: false, conflict: null });
  }
}

/* ================= start ================= */
/* Resolves to the API cloud.js drives. Rejects when the SDK cannot be fetched. */
export function init() {
  if (started && fb) return Promise.resolve(api);
  return Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js')
  ]).then(function (m) {
    var app = m[0].initializeApp(firebaseConfig);
    fb = {
      auth: m[1].getAuth(app),
      db: m[2].getFirestore(app),
      signIn: m[1].signInWithEmailAndPassword,
      signOut: m[1].signOut,
      doc: m[2].doc,
      getDoc: m[2].getDoc,
      runTransaction: m[2].runTransaction,
      serverTimestamp: m[2].serverTimestamp
    };
    started = true;
    window.addEventListener('pagehide', flushCloudSave);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { flushCloudSave(); return; }
      if (!currentUid) return;
      if (!cloudReady) { retryAttempt = 0; clearRetry(); clearLoadRetry(); loadCloudData(currentUid, false); }
      else if (isDirty()) { retryAttempt = 0; clearRetry(); syncNow(false); }
      else refreshFromCloud(false);
    });
    window.addEventListener('online', function () {
      if (!currentUid) return;
      setSync({ offline: false });
      retryEverythingNow(false);
    });
    window.addEventListener('offline', function () { markOffline(); });
    m[1].onAuthStateChanged(fb.auth, onAuthChange);
    return api;
  });
}

var api = {
  login: login,
  logout: logout,
  syncNow: function () { retryEverythingNow(true); },
  choose: choose
};
