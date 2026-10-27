/* The decisions behind cloud sync, kept free of Firebase/DOM so they can be
   tested in node. Same model as GymBro (docs/offline-sync.md there):

   - Every local write (storage.js saveData) stamps a DIRTY marker in
     localStorage. It is cleared only when a cloud write that covered it has
     been acknowledged, so "did my last edit reach the cloud?" survives a
     closed tab, a dead connection or a crashed phone.
   - BASE is the cloud doc's `rev` this device last saw. Every cloud write
     carries a fresh client-made rev, so "is the cloud still what I last saw?" is
     an exact string comparison (a timestamp could be adopted from someone
     else's write). On the next launch, dirty + cloud still at BASE = this
     device wins and uploads; dirty + cloud moved on = a real conflict and the
     user chooses. Not dirty = cloud wins. The same comparison guards every
     write (auth.js runs it inside a Firestore transaction).

   Plain functions over localStorage (injectable via useStorage for tests);
   nothing here touches the DOM or the network. auth.js is the Firebase side. */

export var DIRTY_KEY = 'acadbro-dirty';
export var BASE_KEY = 'acadbro-sync-base';        /* legacy numeric updatedAt; no longer read by auth.js */
export var REV_KEY = 'acadbro-sync-rev';          /* BASE: the cloud doc's rev this device last saw */
export var PENDING_REVS_KEY = 'acadbro-sync-pending-revs'; /* revs we sent but have no ack for yet */
export var LAST_KEY = 'acadbro-last-sync';
export var CONFLICT_BACKUP_KEY = 'acadbro-conflict-backup';
/* which account the data in this browser belongs to (see auth.js) */
export var OWNER_KEY = 'acadbro-owner-uid';
/* "this browser has signed in before": decides whether the Firebase SDK is
   loaded at launch (a never-signed-in user pays no network cost) */
export var AUTH_HINT_KEY = 'acadbro-auth-hint';

/* after a failure: wait this long, then try again; the last step repeats */
export var RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000];
export function retryDelay(attempt) {
  return RETRY_DELAYS_MS[Math.max(0, Math.min(attempt, RETRY_DELAYS_MS.length - 1))];
}

var store = null; /* tests swap this; null = the real localStorage */
export function useStorage(s) { store = s; }
function ls() { return store || (typeof localStorage !== 'undefined' ? localStorage : null); }
function get(k) { try { var s = ls(); return s ? s.getItem(k) : null; } catch (err) { return null; } }
function set(k, v) { try { var s = ls(); if (s) s.setItem(k, v); } catch (err) { /* quota / unavailable */ } }
function del(k) { try { var s = ls(); if (s) s.removeItem(k); } catch (err) { /* unavailable */ } }

/* cloud.js listens so the "Sync paused" state can show that edits are waiting */
var dirtyCb = null;
export function onDirtyChange(fn) { dirtyCb = fn; }
function dirtyChanged() { if (dirtyCb) { try { dirtyCb(); } catch (err) { /* a UI listener must not break saving */ } } }

var seq = 0;
/* A token that differs on every call, so a save that was already in flight
   when a newer edit landed cannot mark that newer edit as synced. */
export function markDirty() {
  seq++;
  set(DIRTY_KEY, Date.now() + '.' + seq);
  dirtyChanged();
}
export function readDirty() { return get(DIRTY_KEY); }
export function isDirty() { return get(DIRTY_KEY) !== null; }
/* Clear the marker only if it is still the one the finished save started with. */
export function clearDirtyIf(token) {
  if (get(DIRTY_KEY) === token) { del(DIRTY_KEY); dirtyChanged(); return true; }
  return false;
}
export function clearDirty() { del(DIRTY_KEY); dirtyChanged(); }
/* when the oldest-still-unsynced edit was made, for the conflict sheet */
export function dirtySinceMs() {
  var d = get(DIRTY_KEY);
  var n = d ? parseInt(String(d).split('.')[0], 10) : NaN;
  return isFinite(n) ? n : null;
}

function readMs(k) {
  var v = get(k);
  var n = v === null ? NaN : Number(v);
  return isFinite(n) ? n : null;
}
export function readBase() { return readMs(BASE_KEY); }
export function writeBase(ms) { if (typeof ms === 'number' && isFinite(ms)) set(BASE_KEY, String(ms)); }
/* ---- rev: BASE as an exact string ---- */
var REV_MAX = 64;
export function readRev() { var v = get(REV_KEY); return v ? v : null; }
export function writeRev(rev) { if (typeof rev === 'string' && rev && rev.length <= REV_MAX) set(REV_KEY, rev); }
/* A fresh rev for one cloud write: time + randomness, well under the 64 chars the rules allow. */
export function newRev(rand) {
  var r = typeof rand === 'function' ? rand : Math.random;
  var part = '';
  for (var i = 0; i < 3; i++) part += Math.floor(r() * 36 * 36 * 36 * 36).toString(36).padStart(4, '0');
  return Date.now().toString(36) + '-' + part;
}
/* Revs we wrote whose acknowledgement may never have arrived (dead connection,
   closed tab). If the cloud shows one of them it is OUR write, not another
   device's, so a retry or the next launch must not report a false conflict. */
export function readPendingRevs() {
  try {
    var a = JSON.parse(get(PENDING_REVS_KEY) || '[]');
    return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }) : [];
  } catch (err) { return []; }
}
export function addPendingRev(rev) {
  var a = readPendingRevs().filter(function (x) { return x !== rev; });
  a.push(rev);
  set(PENDING_REVS_KEY, JSON.stringify(a.slice(-5)));
}
export function clearPendingRevs() { del(PENDING_REVS_KEY); }
/* Is the cloud doc's rev the one this device knows (BASE) or one it wrote itself? */
export function cloudIsKnown(cloudRev, base, pending) {
  if (typeof cloudRev !== 'string' || !cloudRev) return false;
  return cloudRev === base || (Array.isArray(pending) && pending.indexOf(cloudRev) !== -1);
}
/* Inside the write transaction: may this device overwrite what it just read?
     'write'    the doc is absent (first save) or still what this device knows
     'foreign'  another device wrote since: do NOT write, ask instead */
export function transactionVerdict(t) {
  if (!t.exists) return 'write';
  return cloudIsKnown(t.cloudRev, t.base, t.pending) ? 'write' : 'foreign';
}

export function readLastSync() { return readMs(LAST_KEY); }
export function writeLastSync(ms) { set(LAST_KEY, String(ms)); }

export function readOwner() { return get(OWNER_KEY); }
export function writeOwner(uid) { if (uid) set(OWNER_KEY, String(uid)); }
export function readAuthHint() { return get(AUTH_HINT_KEY) === '1'; }
export function writeAuthHint(on) { if (on) set(AUTH_HINT_KEY, '1'); else del(AUTH_HINT_KEY); }

/* What to do with a cloud document that has just been fetched.
     'apply-cloud'  replace local state with it (the normal case)
     'push-local'   unsynced edits here and the cloud is exactly what this
                    device last saw: keep local, upload it
     'conflict'     unsynced edits here AND the cloud has changed: ask
   Unsynced edits only count when the data on this device belongs to the
   signed-in account; another account's leftovers never beat the cloud. */
export function decideOnLoad(s) {
  if (!s.dirty || !s.ownerMatches) return 'apply-cloud';
  /* cloudRev/base are rev strings; cloudMs/base numbers still work (older callers) */
  var cloud = s.cloudRev !== undefined ? s.cloudRev : s.cloudMs;
  if (s.base !== null && s.base !== undefined && cloud !== null && cloud !== undefined
      && (cloud === s.base || (Array.isArray(s.pending) && s.pending.indexOf(cloud) !== -1))) return 'push-local';
  return 'conflict';
}

/* ---- at most one write in flight, one coalesced follow-up ----
   A write on a dead connection can hang. Edits made meanwhile must not start
   more writes (they would pile up); they are folded into ONE follow-up that
   runs when the in-flight write settles. A write that has hung for HARD_SAVE_MS
   is abandoned (its late result is ignored as stale) so sync cannot stay stuck. */
export var HARD_SAVE_MS = 60000;
export function createWriteGate() { return { epoch: 0, busy: false, since: 0, followUp: false }; }
/* -> { action:'run', epoch } | { action:'queued' } */
export function gateRequest(g, nowMs) {
  if (!g.busy) { g.busy = true; g.since = nowMs; g.epoch++; return { action: 'run', epoch: g.epoch }; }
  if (nowMs - g.since >= HARD_SAVE_MS) { g.since = nowMs; g.followUp = false; g.epoch++; return { action: 'run', epoch: g.epoch }; }
  g.followUp = true;
  return { action: 'queued' };
}
/* -> { stale, runFollowUp } */
export function gateSettle(g, epoch) {
  if (epoch !== g.epoch) return { stale: true, runFollowUp: false };
  g.busy = false;
  var fu = g.followUp;
  g.followUp = false;
  return { stale: false, runFollowUp: fu };
}

/* Sync paused because the sign-in service could not load: only meaningful when
   this browser has signed in before (readAuthHint). -> null | { text } */
export function pausedInfo(s) {
  if (!s.hint || s.phase !== 'unavailable') return null;
  return { text: s.dirty ? 'Sync paused · changes waiting' : 'Sync paused' };
}

/* "just now", "3 min ago", "2 h ago", or the date */
export function formatSyncAge(ms, now) {
  if (ms === null || ms === undefined) return 'not yet';
  var diff = Math.max(0, now - ms);
  var min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  var h = Math.floor(min / 60);
  if (h < 24) return h + ' h ago';
  var d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* What the Settings > Account line shows */
export function syncInfo(now) {
  var last = readLastSync();
  var pending = isDirty();
  return {
    pending: pending,
    lastSyncMs: last,
    text: pending
      ? 'Waiting to sync' + (last !== null ? ' · last synced ' + formatSyncAge(last, now) : '')
      : (last !== null ? 'Synced ' + formatSyncAge(last, now) : 'Not synced yet')
  };
}

/* The version that lost a conflict, kept so a wrong choice can be undone.
   kept = which side won ('local' | 'cloud'); discardedData = the other side.
   One slot: a newer conflict replaces an older backup (the caller says so).
   Returns false when it could not be stored (quota), so the caller can tell
   the user instead of pretending a copy exists. */
export function saveConflictBackup(kept, discardedData, ownerUid) {
  try {
    var s = ls();
    if (!s) return false;
    s.setItem(CONFLICT_BACKUP_KEY, JSON.stringify({ at: Date.now(), kept: kept, ownerUid: ownerUid || null, data: discardedData }));
    return true;
  } catch (err) { return false; }
}
export function readConflictBackup() {
  try {
    var raw = get(CONFLICT_BACKUP_KEY);
    var b = raw ? JSON.parse(raw) : null;
    return b && typeof b === 'object' && b.data ? b : null;
  } catch (err) { return null; }
}
export function clearConflictBackup() { del(CONFLICT_BACKUP_KEY); }

/* Whose is the recovery copy, and may the signed-in user restore it? A copy
   made from data that belonged to an account stays that account's: another
   account (or nobody logged in) can still export it but never restore it.
   A copy that belonged to no account (data made before any login) is open.
   -> { canRestore, label } (label is '' when nothing needs saying) */
export var OTHER_ACCOUNT_LABEL = 'Belongs to another account';
export function backupAccess(backup, signedInUid) {
  var owner = backup && backup.ownerUid ? backup.ownerUid : null;
  if (!owner) return { canRestore: true, label: '' };
  if (signedInUid && owner === signedInUid) return { canRestore: true, label: '' };
  return { canRestore: false, label: OTHER_ACCOUNT_LABEL };
}
