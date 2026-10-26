/* The decisions behind cloud sync, kept free of Firebase/DOM so they can be
   tested in node. Same model as GymBro (docs/offline-sync.md there):

   - Every local write (storage.js saveData) stamps a DIRTY marker in
     localStorage. It is cleared only when a cloud write that covered it has
     been acknowledged, so "did my last edit reach the cloud?" survives a
     closed tab, a dead connection or a crashed phone.
   - BASE is the cloud doc's updatedAt this device last saw. On the next launch,
     dirty + cloud still at BASE = this device wins and uploads; dirty + cloud
     moved on = a real conflict and the user chooses. Not dirty = cloud wins.

   M1 has no cloud: only the marker helpers are exercised (a local save marks
   dirty and nothing clears it until M5). Plain functions over localStorage
   (injectable via useStorage for tests). */

export var DIRTY_KEY = 'acadbro-dirty';
export var BASE_KEY = 'acadbro-sync-base';
export var LAST_KEY = 'acadbro-last-sync';
export var CONFLICT_BACKUP_KEY = 'acadbro-conflict-backup';

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

var seq = 0;
/* A token that differs on every call, so a save that was already in flight
   when a newer edit landed cannot mark that newer edit as synced. */
export function markDirty() {
  seq++;
  set(DIRTY_KEY, Date.now() + '.' + seq);
}
export function readDirty() { return get(DIRTY_KEY); }
export function isDirty() { return get(DIRTY_KEY) !== null; }
/* Clear the marker only if it is still the one the finished save started with. */
export function clearDirtyIf(token) {
  if (get(DIRTY_KEY) === token) { del(DIRTY_KEY); return true; }
  return false;
}
export function clearDirty() { del(DIRTY_KEY); }

function readMs(k) {
  var v = get(k);
  var n = v === null ? NaN : Number(v);
  return isFinite(n) ? n : null;
}
export function readBase() { return readMs(BASE_KEY); }
export function writeBase(ms) { if (typeof ms === 'number' && isFinite(ms)) set(BASE_KEY, String(ms)); }
export function readLastSync() { return readMs(LAST_KEY); }
export function writeLastSync(ms) { set(LAST_KEY, String(ms)); }

/* What to do with a cloud document that has just been fetched.
     'apply-cloud'  replace local state with it (the normal case)
     'push-local'   unsynced edits here and the cloud is exactly what this
                    device last saw: keep local, upload it
     'conflict'     unsynced edits here AND the cloud has changed: ask */
export function decideOnLoad(s) {
  if (!s.dirty || !s.ownerMatches) return 'apply-cloud';
  if (s.base !== null && s.cloudMs !== null && s.cloudMs === s.base) return 'push-local';
  return 'conflict';
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
