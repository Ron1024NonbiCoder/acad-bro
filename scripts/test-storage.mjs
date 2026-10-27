/* Storage tests: load / save / dirty marker / schema defaults / import-export,
   against a localStorage shim. Plain node asserts; exits non-zero on failure.
   Run: node scripts/test-storage.mjs */

import assert from 'node:assert/strict';

/* ---- localStorage shim, installed BEFORE the modules load ---- */
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

var S = await import('../web/js/storage.js');
var C = await import('../web/js/sync-core.js');

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

test('empty storage loads schema-1 defaults and writes nothing', function () {
  var d = S.loadData();
  assert.equal(S.loadStatus.kind, 'new');
  assert.equal(d.schema, 1);
  assert.deepEqual(d.areaLabels, { living: 'Living', prod: 'Prod', hobby: 'Hobby' });
  assert.deepEqual(d.projects, []);
  assert.deepEqual(d.tasks, []);
  assert.deepEqual(d.completions, []);
  assert.equal(d.updatedAt, null);
  assert.equal(mem.size, 0, 'a fresh load must not write or mark dirty');
  assert.equal(C.isDirty(), false);
});

test('save then load round-trips and stamps updatedAt', function () {
  S.replaceData(S.defaultData());
  S.DB.projects.push({ id: 'p1', area: 'prod', name: 'Thesis', note: '', archived: false, order: 0, createdAt: 'x', updatedAt: 'x' });
  S.DB.tasks.push({
    id: 't1', area: 'prod', projectId: 'p1', title: 'Read', note: '', priority: 2, due: '2026-10-30',
    recur: { kind: 'weekdays', days: [1, 3] }, subtasks: [{ id: 's1', title: 'Ch 1' }], order: 0, createdAt: 'x', updatedAt: 'x'
  });
  S.DB.completions.push({ id: 'c1', taskId: 't1', subtaskId: 's1', date: '2026-10-26', at: '2026-10-26T10:00:00.000Z' });
  assert.equal(S.saveData(), true);
  assert.ok(mem.has(S.STORAGE_KEY));
  assert.equal(S.STORAGE_KEY, 'acadbro-data-v1');
  var back = S.loadData();
  assert.equal(S.loadStatus.kind, 'ok');
  assert.deepEqual(back.projects, S.DB.projects);
  assert.deepEqual(back.tasks, S.DB.tasks);
  assert.deepEqual(back.completions, S.DB.completions);
  assert.match(back.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(back.tasks[0].recur.kind, 'weekdays');
  assert.deepEqual(back.tasks[0].subtasks[0], { id: 's1', title: 'Ch 1' });
});

test('DIRTY marker: set by save, token-guarded clear', function () {
  assert.equal(C.isDirty(), false);
  S.saveData();
  assert.equal(C.isDirty(), true);
  var first = C.readDirty();
  S.saveData(); /* a newer edit mid-flight gets a different token */
  var second = C.readDirty();
  assert.notEqual(first, second);
  assert.equal(C.clearDirtyIf(first), false, 'an older save must not mark a newer edit synced');
  assert.equal(C.isDirty(), true);
  assert.equal(C.clearDirtyIf(second), true);
  assert.equal(C.isDirty(), false);
  assert.equal(C.DIRTY_KEY, 'acadbro-dirty');
});

test('cloud seam: onLocalChange called after a successful save only', function () {
  var calls = 0;
  S.cloud.onLocalChange = function () { calls++; };
  S.saveData();
  assert.equal(calls, 1);
  failWrites = true;
  S.saveData();
  assert.equal(calls, 1);
});

test('normalizeData fills defaults, keeps unknown fields, defaults completion subtaskId to null', function () {
  var d = S.normalizeData({
    schema: 1,
    futureField: 7,
    areaLabels: { prod: 'Work' },
    tasks: [{ id: 't', title: 'x' }, 'junk', null],
    completions: [{ id: 'c1', taskId: 't', date: '2026-10-26', at: 'z' }, { id: 'c2', taskId: 't', subtaskId: 's', date: '2026-10-26', at: 'z' }]
  });
  assert.equal(d.futureField, 7);
  assert.deepEqual(d.areaLabels, { living: 'Living', prod: 'Prod', hobby: 'Hobby' }, 'labels are fixed: input is ignored');
  assert.deepEqual(d.projects, []);
  assert.equal(d.tasks.length, 1);
  assert.equal(d.completions[0].subtaskId, null);
  assert.equal(d.completions[1].subtaskId, 's');
  assert.equal(d.updatedAt, null);
});

test('normalizeData rejects non-docs and other schemas', function () {
  assert.equal(S.normalizeData(null), null);
  assert.equal(S.normalizeData([]), null);
  assert.equal(S.normalizeData('x'), null);
  assert.equal(S.normalizeData({}), null);
  assert.equal(S.normalizeData({ schema: 2 }), null);
  assert.equal(S.normalizeData({ schema: '1' }), null);
});

test('corrupt JSON: defaults used, original copied aside, never silently dropped', function () {
  mem.set(S.STORAGE_KEY, '{not json');
  var d = S.loadData();
  assert.equal(S.loadStatus.kind, 'recovered');
  assert.equal(S.loadStatus.corruptSaved, true);
  assert.equal(S.loadStatus.newerSchema, false);
  assert.equal(mem.get(S.CORRUPT_KEY), '{not json');
  assert.equal(d.schema, 1);
  assert.deepEqual(d.tasks, []);
});

test('newer schema in storage is flagged and kept aside', function () {
  var raw = JSON.stringify({ schema: 2, tasks: [{ id: 'x' }] });
  mem.set(S.STORAGE_KEY, raw);
  S.loadData();
  assert.equal(S.loadStatus.kind, 'recovered');
  assert.equal(S.loadStatus.newerSchema, true);
  assert.equal(mem.get(S.CORRUPT_KEY), raw);
});

test('failed write: returns false, calls onSaveError, does not mark dirty', function () {
  var errs = 0;
  S.hooks.onSaveError = function () { errs++; };
  failWrites = true;
  assert.equal(S.saveData(), false);
  assert.equal(errs, 1);
  assert.equal(C.isDirty(), false);
  failWrites = false;
  assert.equal(S.saveData(), true);
  assert.equal(C.isDirty(), true);
});

test('size guard warns once at 800 KB, re-arms below it', function () {
  var warns = [];
  S.hooks.onSizeWarn = function (b) { warns.push(b); };
  S.replaceData(S.defaultData());
  S.DB.tasks.push({ id: 'big', title: 'x', note: 'n'.repeat(S.SIZE_WARN_BYTES + 10) });
  assert.equal(S.saveData(), true);
  assert.equal(S.saveData(), true);
  assert.equal(warns.length, 1);
  assert.ok(warns[0] >= S.SIZE_WARN_BYTES);
  S.DB.tasks.length = 0;
  S.saveData();
  S.DB.tasks.push({ id: 'big', title: 'x', note: 'n'.repeat(S.SIZE_WARN_BYTES + 10) });
  S.saveData();
  assert.equal(warns.length, 2);
});

test('export then import round-trips; bad files give helpful errors', function () {
  S.replaceData(S.defaultData());
  S.DB.projects.push({ id: 'p1', area: 'hobby', name: 'Guitar' });
  var out = S.buildExport();
  assert.match(out.filename, /^acadbro-\d{4}-\d{2}-\d{2}\.json$/);
  assert.deepEqual(out.counts, { projects: 1, tasks: 0, completions: 0 });
  var res = S.parseImport(out.json);
  assert.equal(res.ok, true);
  assert.equal(res.data.projects[0].name, 'Guitar');
  assert.deepEqual(res.counts, { projects: 1, tasks: 0, completions: 0 });

  var bad = S.parseImport('not json at all');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /JSON file exported from AcadBro/);
  assert.equal(S.parseImport('{"hello":1}').ok, false);
  var newer = S.parseImport('{"schema":9}');
  assert.equal(newer.ok, false);
  assert.match(newer.error, /newer AcadBro/);
});

test('replaceData swaps a valid doc and refuses an invalid one without touching DB', function () {
  S.replaceData(S.defaultData());
  S.DB.projects.push({ id: 'keep' });
  var rev = S.dataRev;
  assert.equal(S.replaceData({ nope: true }), false);
  assert.equal(S.DB.projects[0].id, 'keep');
  assert.equal(S.dataRev, rev);
  assert.equal(S.replaceData({ schema: 1, projects: [{ id: 'new' }] }), true);
  assert.equal(S.DB.projects[0].id, 'new');
  assert.ok(S.dataRev > rev);
});

test('sync-core decisions', function () {
  assert.equal(C.decideOnLoad({ dirty: false, ownerMatches: true, base: 5, cloudMs: 9 }), 'apply-cloud');
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: true, base: 5, cloudMs: 5 }), 'push-local');
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: true, base: 5, cloudMs: 9 }), 'conflict');
  assert.equal(C.decideOnLoad({ dirty: true, ownerMatches: false, base: 5, cloudMs: 9 }), 'apply-cloud');
  assert.equal(C.retryDelay(0), 2000);
  assert.equal(C.retryDelay(99), 60000);
});

if (!process.exitCode) test('isStaleWrite: only data stored by someone else, newer than what this tab knew', function () {
  assert.equal(S.isStaleWrite('2026-10-27T10:00:00.000Z', '2026-10-27T10:00:00.000Z'), false, 'unchanged');
  assert.equal(S.isStaleWrite('2026-10-27T10:00:00.000Z', '2026-10-27T10:00:05.000Z'), true, 'another tab saved');
  assert.equal(S.isStaleWrite(null, '2026-10-27T10:00:05.000Z'), true, 'this tab started empty');
  assert.equal(S.isStaleWrite('2026-10-27T10:00:00.000Z', null), false, 'nothing stored: nothing to protect');
  assert.equal(S.isStaleWrite(null, null), false);
  assert.equal(S.isStaleWrite('2026-10-27T10:00:05.000Z', '2026-10-27T10:00:00.000Z'), false, 'older is never newer');
});

test('two tabs: a stale tab does not overwrite the other tab, it loads its data and says so', function () {
  S.replaceData(S.defaultData());
  assert.equal(S.saveData(), true); /* this tab saved: it knows the stamp */
  var infos = [];
  S.hooks.onExternalChange = function (i) { infos.push(i); };
  /* another tab saves newer data */
  var other = S.defaultData();
  other.tasks = [{ id: 'from-tab-2' }];
  other.updatedAt = '2999-01-01T00:00:00.000Z';
  mem.set(S.STORAGE_KEY, JSON.stringify(other));
  S.DB.tasks.push({ id: 'my-edit' });
  assert.equal(S.saveData(), false, 'the stale write is refused');
  assert.equal(S.saveInfo.reloaded, true);
  assert.deepEqual(S.DB.tasks.map(function (t) { return t.id; }), ['from-tab-2'], 'memory now shows the other tab');
  assert.equal(JSON.parse(mem.get(S.STORAGE_KEY)).tasks[0].id, 'from-tab-2', 'storage untouched');
  assert.deepEqual(infos, [{ lostEdit: true }], 'the user is told the edit was not applied');
  /* after loading, this tab is current again and saves normally */
  S.DB.tasks.push({ id: 'second-try' });
  assert.equal(S.saveData(), true);
  assert.equal(S.saveInfo.reloaded, false);
  assert.equal(JSON.parse(mem.get(S.STORAGE_KEY)).tasks.length, 2);
  S.hooks.onExternalChange = null;
});

test('storage event: the other tab data is loaded; unrelated keys and own writes are ignored', function () {
  S.replaceData(S.defaultData());
  S.saveData();
  var infos = [];
  S.hooks.onExternalChange = function (i) { infos.push(i); };
  assert.equal(S.onStorageEvent({ key: 'acadbro-dirty' }), false, 'another key');
  assert.equal(S.onStorageEvent({ key: S.STORAGE_KEY }), false, 'nothing newer stored (our own write echoing)');
  var other = S.defaultData();
  other.projects = [{ id: 'p-other' }];
  other.updatedAt = '2999-01-01T00:00:00.000Z';
  mem.set(S.STORAGE_KEY, JSON.stringify(other));
  assert.equal(S.onStorageEvent({ key: S.STORAGE_KEY }), true);
  assert.equal(S.DB.projects[0].id, 'p-other');
  assert.deepEqual(infos, [{ lostEdit: false }]);
  assert.equal(S.onStorageEvent({ key: S.STORAGE_KEY }), false, 'now current: a repeat does nothing');
  S.hooks.onExternalChange = null;
});

test('syncDBFromStorage pulls newer data from another tab before sync reads the DB', function () {
  S.replaceData(S.defaultData());
  S.saveData();
  assert.equal(S.syncDBFromStorage(), false);
  var other = S.defaultData();
  other.tasks = [{ id: 'newer' }];
  other.updatedAt = '2999-01-01T00:00:00.000Z';
  mem.set(S.STORAGE_KEY, JSON.stringify(other));
  assert.equal(S.syncDBFromStorage(), true);
  assert.equal(S.DB.tasks[0].id, 'newer');
});

test('a tab that never read the stored data does not overwrite what another tab created', function () {
  S.replaceData(S.defaultData());
  S.saveData();
  mem.clear();
  var other = S.defaultData();
  other.tasks = [{ id: 'tab2' }];
  other.updatedAt = '2999-01-01T00:00:00.000Z';
  mem.set(S.STORAGE_KEY, JSON.stringify(other));
  S.DB.tasks.push({ id: 'mine' });
  S.saveData();
  assert.ok(JSON.parse(mem.get(S.STORAGE_KEY)).tasks.some(function (t) { return t.id === 'tab2'; }), 'the other tab task survives');
});

function importOf(patch) { return S.parseImport(JSON.stringify(Object.assign({ schema: 1 }, patch))); }
function rep(n, make) { var a = []; for (var i = 0; i < n; i++) a.push(make(i)); return a; }

test('import within the limits has no problems', function () {
  var res = importOf({
    projects: [{ id: 'p', name: 'x'.repeat(80), note: 'n'.repeat(2000) }],
    tasks: [{ id: 't', title: 'y'.repeat(80), note: '', subtasks: rep(30, function (i) { return { id: 's' + i, title: 'z'.repeat(80) }; }) }]
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.problems, []);
});

test('import over the limits is flagged with a precise positive message, nothing trimmed', function () {
  var t = importOf({ tasks: rep(5200, function (i) { return { id: 't' + i, title: 'a' }; }) });
  assert.equal(t.ok, true);
  assert.equal(t.problems.length, 1);
  assert.equal(t.problems[0], 'This file has 5200 tasks. AcadBro holds up to 5000; please trim the file and import again.');
  assert.equal(t.data.tasks.length, 5200, 'data is untouched (the caller refuses it)');

  var p = importOf({ projects: rep(201, function (i) { return { id: 'p' + i, name: 'a' }; }) });
  assert.match(p.problems[0], /^This file has 201 projects\. AcadBro holds up to 200; please trim/);

  var nm = importOf({ tasks: [{ id: 't', title: 'x'.repeat(81), subtasks: [{ id: 's', title: 'y'.repeat(90) }] }], projects: [{ id: 'p', name: 'z'.repeat(81) }] });
  assert.equal(nm.problems.length, 1);
  assert.match(nm.problems[0], /^3 names in this file are over 80 characters \(the longest has 90\)\. Please shorten them/);
  assert.equal(nm.data.tasks[0].title.length, 81);

  var nt = importOf({ tasks: [{ id: 't', title: 'a', note: 'n'.repeat(2001) }] });
  assert.match(nt.problems[0], /^1 note in this file is over 2000 characters \(the longest has 2001\)\. Please shorten it/);

  var sub = importOf({ tasks: [{ id: 't', title: 'a', subtasks: rep(31, function (i) { return { id: 's' + i, title: 'a' }; }) }] });
  assert.match(sub.problems[0], /^1 task in this file has more than 30 subtasks \(the most is 31\)\. AcadBro holds up to 30 per task/);

  var all = importOf({ tasks: [{ id: 't', title: 'x'.repeat(81), note: 'n'.repeat(2001), subtasks: rep(31, function (i) { return { id: 's' + i, title: 'a' }; }) }] });
  assert.equal(all.problems.length, 3, 'every kind that is over is listed');
});

test('import files over 2 MB are refused before parsing, with the reason', function () {
  assert.equal(S.MAX_IMPORT_BYTES, 2 * 1024 * 1024);
  assert.equal(S.importSizeError(2 * 1024 * 1024), null);
  assert.equal(S.importSizeError(100), null);
  assert.equal(S.importSizeError(3 * 1024 * 1024), 'This file is 3.0 MB. AcadBro imports files up to 2 MB; please choose an AcadBro export.');
});

test('area labels are fixed: custom labels in input (import, storage, cloud doc) become the defaults', function () {
  var def = { living: 'Living', prod: 'Prod', hobby: 'Hobby' };
  assert.deepEqual(importOf({ areaLabels: { living: 'Home', prod: 'Work', hobby: 'Fun', extra: 'x' } }).data.areaLabels, def);
  assert.deepEqual(importOf({ areaLabels: 'junk' }).data.areaLabels, def);
  assert.deepEqual(importOf({}).data.areaLabels, def);
  mem.set(S.STORAGE_KEY, JSON.stringify({ schema: 1, areaLabels: { prod: 'Work' } }));
  assert.deepEqual(S.loadData().areaLabels, def);
  assert.equal(S.replaceData({ schema: 1, areaLabels: { prod: 'Work' } }), true);
  assert.deepEqual(S.DB.areaLabels, def, 'the field stays in the doc (firestore.rules require it)');
});

console.log('test-storage: ' + n + ' tests passed');
