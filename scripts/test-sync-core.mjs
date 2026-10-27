/* Sync-core tests: the pure decisions behind cloud sync (dirty marker, BASE,
   load verdict, retry backoff, conflict recovery copy, status text) plus the
   storage seam auth.js relies on (applyCloudData must not look like an edit).
   Plain node asserts; exits non-zero on failure.
   Run: node scripts/test-sync-core.mjs */

import assert from 'node:assert/strict';

var mem = new Map();
var failWrites = false;
globalThis.localStorage = {
  getItem: function (k) { return mem.has(k) ? mem.get(k) : null; },
  setItem: function (k, v) {
    if (failWrites) throw new Error('QuotaExceededError');
    mem.set(k, String(v));
  },
  removeItem: function (k) { mem.delete(k); },
  clear: function () { mem.clear(); }
};

var C = await import('../web/js/sync-core.js');
var S = await import('../web/js/storage.js');

var n = 0;
function test(name, fn) {
  try {
    mem.clear(); failWrites = false;
    S.hooks.onSaveError = null; S.hooks.onSizeWarn = null; S.cloud.onLocalChange = null;
    fn(); n++;
  } catch (err) {
    console.error('FAIL ' + name + '\n  ' + (err && err.stack || err));
    process.exitCode = 1;
  }
}

/* ---- decideOnLoad ---- */
test('decideOnLoad: nothing unsynced -> the cloud wins', function () {
  assert.equal(C.decideOnLoad({ dirty: false, ownerMatches: true, base: 5, cloudMs: 9 }), 'apply-cloud');
  assert.equal(C.decideOnLoad({ dirty: false, ownerMatches: true, base: 5, cloudMs: 5 }), 'apply-cloud');
});
test('decideOnLoad: dirty data of another account never beats the cloud', function () {
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: false, base: 5, cloudMs: 5 }), 'apply-cloud');
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: false, base: null, cloudMs: 9 }), 'apply-cloud');
});
test('decideOnLoad: dirty and the cloud is still at BASE -> push local', function () {
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: true, base: 5, cloudMs: 5 }), 'push-local');
});
test('decideOnLoad: dirty and the cloud moved on -> conflict', function () {
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: true, base: 5, cloudMs: 9 }), 'conflict');
});
test('decideOnLoad: dirty with no BASE or no cloud time -> conflict (never guess)', function () {
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: true, base: null, cloudMs: 9 }), 'conflict');
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: true, base: 5, cloudMs: null }), 'conflict');
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: true, base: null, cloudMs: null }), 'conflict');
});

/* ---- retry backoff ---- */
test('retryDelay: 2/5/15/30/60s, then 60s for ever', function () {
  assert.deepEqual([0, 1, 2, 3, 4].map(C.retryDelay), [2000, 5000, 15000, 30000, 60000]);
  assert.equal(C.retryDelay(5), 60000);
  assert.equal(C.retryDelay(99), 60000);
  assert.equal(C.retryDelay(-3), 2000);
});

/* ---- dirty marker, token-matched ack ---- */
test('markDirty stamps a marker; a saved edit is dirty until acknowledged', function () {
  assert.equal(C.isDirty(), false);
  C.markDirty();
  assert.equal(C.isDirty(), true);
  assert.ok(C.dirtySinceMs() > 0);
});
test('token-matched clear: the ack of a finished save clears its own marker', function () {
  C.markDirty();
  var token = C.readDirty();
  assert.equal(C.clearDirtyIf(token), true);
  assert.equal(C.isDirty(), false);
});
test('token-matched clear: an edit made mid-flight stays dirty', function () {
  C.markDirty();
  var token = C.readDirty(); /* the save starts here */
  C.markDirty();             /* a newer edit lands while it is in flight */
  assert.notEqual(C.readDirty(), token);
  assert.equal(C.clearDirtyIf(token), false);
  assert.equal(C.isDirty(), true);
  assert.equal(C.clearDirtyIf(C.readDirty()), true); /* the save that edit scheduled clears it */
  assert.equal(C.isDirty(), false);
});
test('token-matched clear: a save that started clean cannot clear a later edit', function () {
  var token = C.readDirty(); /* null: nothing was dirty */
  C.markDirty();
  assert.equal(C.clearDirtyIf(token), false);
  assert.equal(C.isDirty(), true);
});

/* ---- BASE / last sync / owner / hint ---- */
test('BASE, last-sync and owner round-trip; junk is ignored', function () {
  assert.equal(C.readBase(), null);
  C.writeBase(1700000000000);
  assert.equal(C.readBase(), 1700000000000);
  C.writeBase(NaN); C.writeBase(null); C.writeBase('x');
  assert.equal(C.readBase(), 1700000000000);
  assert.equal(C.readLastSync(), null);
  C.writeLastSync(42);
  assert.equal(C.readLastSync(), 42);
  assert.equal(C.readOwner(), null);
  C.writeOwner('uid-1');
  assert.equal(C.readOwner(), 'uid-1');
  assert.equal(C.readAuthHint(), false);
  C.writeAuthHint(true);
  assert.equal(C.readAuthHint(), true);
  C.writeAuthHint(false);
  assert.equal(C.readAuthHint(), false);
});

/* ---- conflict recovery copy ---- */
test('conflict backup round-trips and is cleared on request', function () {
  assert.equal(C.readConflictBackup(), null);
  var data = { schema: 1, projects: [{ id: 'p1' }], tasks: [], completions: [] };
  assert.equal(C.saveConflictBackup('cloud', data), true);
  var b = C.readConflictBackup();
  assert.equal(b.kept, 'cloud');
  assert.deepEqual(b.data, data);
  assert.ok(b.at > 0);
  C.clearConflictBackup();
  assert.equal(C.readConflictBackup(), null);
});
test('conflict backup: one slot, a newer conflict replaces the older', function () {
  C.saveConflictBackup('cloud', { schema: 1, tag: 'first' });
  C.saveConflictBackup('local', { schema: 1, tag: 'second' });
  var b = C.readConflictBackup();
  assert.equal(b.kept, 'local');
  assert.equal(b.data.tag, 'second');
});
test('conflict backup: a full disk reports false and keeps the old slot', function () {
  C.saveConflictBackup('cloud', { schema: 1, tag: 'old' });
  failWrites = true;
  assert.equal(C.saveConflictBackup('local', { schema: 1, tag: 'new' }), false);
  failWrites = false;
  assert.equal(C.readConflictBackup().data.tag, 'old');
});
test('conflict backup: unreadable stored text reads as no backup', function () {
  mem.set(C.CONFLICT_BACKUP_KEY, '{not json');
  assert.equal(C.readConflictBackup(), null);
  mem.set(C.CONFLICT_BACKUP_KEY, JSON.stringify({ at: 1, kept: 'cloud' }));
  assert.equal(C.readConflictBackup(), null);
});

/* ---- status text ---- */
test('formatSyncAge: just now / min / h / date', function () {
  var now = Date.UTC(2026, 9, 27, 12, 0, 0);
  assert.equal(C.formatSyncAge(null, now), 'not yet');
  assert.equal(C.formatSyncAge(now - 20000, now), 'just now');
  assert.equal(C.formatSyncAge(now - 2 * 60000, now), '2 min ago');
  assert.equal(C.formatSyncAge(now - 3 * 3600000, now), '3 h ago');
  assert.match(C.formatSyncAge(now - 3 * 86400000, now), /^\d{4}-\d{2}-\d{2}$/);
});
test('syncInfo: synced, waiting, and never synced', function () {
  var now = Date.UTC(2026, 9, 27, 12, 0, 0);
  assert.equal(C.syncInfo(now).text, 'Not synced yet');
  C.writeLastSync(now - 2 * 60000);
  assert.deepEqual(C.syncInfo(now), { pending: false, lastSyncMs: now - 120000, text: 'Synced 2 min ago' });
  C.markDirty();
  var w = C.syncInfo(now);
  assert.equal(w.pending, true);
  assert.equal(w.text, 'Waiting to sync · last synced 2 min ago');
});

/* ---- the storage seam ---- */
test('a local save marks dirty and calls the cloud hook; applying cloud data does not', function () {
  var calls = 0;
  S.cloud.onLocalChange = function () { calls++; };
  assert.equal(S.saveData(), true);
  assert.equal(C.isDirty(), true);
  assert.equal(calls, 1);
  C.clearDirty();
  var doc = { schema: 1, areaLabels: { living: 'L' }, projects: [{ id: 'p1' }], tasks: [], completions: [], updatedAt: '2026-10-27T10:00:00.000Z' };
  assert.deepEqual(S.applyCloudData(doc), { ok: true, persisted: true });
  assert.equal(C.isDirty(), false, 'applying the cloud copy is not an unsynced edit');
  assert.equal(calls, 1, 'and it does not echo back to the cloud');
  assert.equal(S.DB.projects.length, 1);
  assert.equal(S.DB.updatedAt, '2026-10-27T10:00:00.000Z', 'updatedAt is the cloud time, not restamped');
  assert.equal(JSON.parse(mem.get(S.STORAGE_KEY)).projects.length, 1, 'and it is persisted locally');
});
test('applyCloudData refuses an unusable doc and leaves local data alone', function () {
  S.replaceData({ schema: 1, projects: [{ id: 'keep' }] });
  assert.equal(S.applyCloudData({ schema: 2, projects: [] }).ok, false, 'newer schema');
  assert.equal(S.applyCloudData(null).ok, false);
  assert.equal(S.DB.projects[0].id, 'keep');
});
test('applyCloudData reports a failed local write (persisted false) but keeps the cloud data live', function () {
  var errs = 0;
  S.hooks.onSaveError = function () { errs++; };
  failWrites = true;
  assert.deepEqual(S.applyCloudData({ schema: 1, projects: [{ id: 'c1' }] }), { ok: true, persisted: false });
  assert.equal(errs, 0, 'the caller reports it, once');
  assert.equal(S.DB.projects[0].id, 'c1');
});

/* ---- M5 review fixes: rev, transaction verdict, write gate, recovery owner ---- */
test('decideOnLoad with revs: own pending rev counts as the BASE', function () {
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: true, base: 'r1', cloudRev: 'r1' }), 'push-local');
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: true, base: 'r1', cloudRev: 'r2' }), 'conflict');
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: true, base: 'r1', cloudRev: 'r2', pending: ['r2'] }), 'push-local', 'ack lost, write landed');
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: true, base: null, cloudRev: 'r2', pending: ['r2'] }), 'conflict', 'no BASE: never guess');
  assert.equal(C.decideOnLoad({ dirty: false, ownerMatches: true, base: 'r1', cloudRev: 'r2' }), 'apply-cloud');
});
test('transactionVerdict: write only when the doc is absent or still known', function () {
  assert.equal(C.transactionVerdict({ exists: false, cloudRev: null, base: null, pending: [] }), 'write', 'first save');
  assert.equal(C.transactionVerdict({ exists: true, cloudRev: 'r1', base: 'r1', pending: [] }), 'write');
  assert.equal(C.transactionVerdict({ exists: true, cloudRev: 'r2', base: 'r1', pending: [] }), 'foreign', 'another device wrote');
  assert.equal(C.transactionVerdict({ exists: true, cloudRev: 'r2', base: 'r1', pending: ['rx', 'r2'] }), 'write', 'our own unacknowledged write');
  assert.equal(C.transactionVerdict({ exists: true, cloudRev: 'r1', base: null, pending: [] }), 'foreign', 'doc we never saw');
  assert.equal(C.transactionVerdict({ exists: true, cloudRev: null, base: null, pending: [] }), 'foreign', 'doc without a rev is never assumed ours');
});
test('rev: round-trips, junk ignored, newRev fits the 64-char rule and differs', function () {
  assert.equal(C.readRev(), null);
  C.writeRev('abc-1');
  assert.equal(C.readRev(), 'abc-1');
  C.writeRev(''); C.writeRev(null); C.writeRev(5); C.writeRev('x'.repeat(65));
  assert.equal(C.readRev(), 'abc-1');
  var a = C.newRev(), b = C.newRev();
  assert.notEqual(a, b);
  assert.ok(a.length > 0 && a.length <= 64, a);
  assert.equal(C.newRev(function () { return 0; }).split('-')[1], '000000000000');
});
test('pending revs: remembered, de-duplicated, capped at 5, junk-proof', function () {
  assert.deepEqual(C.readPendingRevs(), []);
  ['a', 'b', 'c', 'd', 'e', 'f', 'a'].forEach(function (r) { C.addPendingRev(r); });
  assert.deepEqual(C.readPendingRevs(), ['c', 'd', 'e', 'f', 'a']);
  mem.set(C.PENDING_REVS_KEY, '{bad');
  assert.deepEqual(C.readPendingRevs(), []);
  assert.equal(C.cloudIsKnown('r', 'r', []), true);
  assert.equal(C.cloudIsKnown('r', 'q', ['r']), true);
  assert.equal(C.cloudIsKnown('r', 'q', []), false);
  assert.equal(C.cloudIsKnown(null, null, []), false);
});
test('write gate: one in flight, edits fold into ONE follow-up, a hung write is abandoned', function () {
  var g = C.createWriteGate();
  var r1 = C.gateRequest(g, 1000);
  assert.equal(r1.action, 'run');
  assert.equal(C.gateRequest(g, 2000).action, 'queued');
  assert.equal(C.gateRequest(g, 3000).action, 'queued');
  var done = C.gateSettle(g, r1.epoch);
  assert.deepEqual(done, { stale: false, runFollowUp: true }, 'two queued edits = one follow-up');
  var r2 = C.gateRequest(g, 4000);
  assert.equal(r2.action, 'run');
  assert.deepEqual(C.gateSettle(g, r2.epoch), { stale: false, runFollowUp: false });
  /* a write that never answers */
  var r3 = C.gateRequest(g, 10000);
  assert.equal(C.gateRequest(g, 10000 + C.HARD_SAVE_MS - 1).action, 'queued');
  var r4 = C.gateRequest(g, 10000 + C.HARD_SAVE_MS);
  assert.equal(r4.action, 'run', 'after the hard limit a new write may start');
  assert.deepEqual(C.gateSettle(g, r3.epoch), { stale: true, runFollowUp: false }, 'the hung one, when it finally answers');
  assert.deepEqual(C.gateSettle(g, r4.epoch), { stale: false, runFollowUp: false });
});
test('recovery copy remembers its owner; another account (or nobody logged in) cannot restore it', function () {
  assert.equal(C.saveConflictBackup('cloud', { schema: 1 }, 'uidA'), true);
  var b = C.readConflictBackup();
  assert.equal(b.ownerUid, 'uidA');
  assert.deepEqual(C.backupAccess(b, 'uidA'), { canRestore: true, label: '' });
  assert.deepEqual(C.backupAccess(b, 'uidB'), { canRestore: false, label: 'Belongs to another account' });
  assert.deepEqual(C.backupAccess(b, null), { canRestore: false, label: 'Belongs to another account' }, 'logged out');
  C.saveConflictBackup('cloud', { schema: 1 });
  assert.equal(C.readConflictBackup().ownerUid, null);
  assert.deepEqual(C.backupAccess(C.readConflictBackup(), 'uidB'), { canRestore: true, label: '' }, 'data made before any login is open');
  assert.deepEqual(C.backupAccess(C.readConflictBackup(), null), { canRestore: true, label: '' });
});
test('pausedInfo: only for a browser that signed in before, with the service unavailable', function () {
  assert.equal(C.pausedInfo({ hint: false, phase: 'unavailable', dirty: true }), null);
  assert.equal(C.pausedInfo({ hint: true, phase: 'ready', dirty: true }), null);
  assert.deepEqual(C.pausedInfo({ hint: true, phase: 'unavailable', dirty: true }), { text: 'Sync paused · changes waiting' });
  assert.deepEqual(C.pausedInfo({ hint: true, phase: 'unavailable', dirty: false }), { text: 'Sync paused' });
});
test('onDirtyChange fires when the marker is set or cleared', function () {
  var calls = 0;
  C.onDirtyChange(function () { calls++; });
  C.markDirty();
  C.clearDirtyIf(C.readDirty());
  C.markDirty();
  C.clearDirty();
  C.onDirtyChange(null);
  assert.equal(calls, 4);
});
test('applyCloudData that could not be stored leaves the sync bookkeeping to the caller', function () {
  C.markDirty();
  C.writeRev('old');
  failWrites = true;
  var r = S.applyCloudData({ schema: 1, projects: [{ id: 'c1' }] });
  failWrites = false;
  assert.deepEqual(r, { ok: true, persisted: false });
  assert.equal(C.isDirty(), true, 'still dirty');
  assert.equal(C.readRev(), 'old', 'BASE untouched');
});

if (!process.exitCode) console.log('test-sync-core: ' + n + ' tests passed');
