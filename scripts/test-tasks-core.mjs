/* Pure task logic tests (web/js/tasks-core.js). Plain node asserts; exits
   non-zero on failure. Run: node scripts/test-tasks-core.mjs */

import assert from 'node:assert/strict';
import {
  LIMITS, activeDays, applyDiff, canAdd, describeRecur, diffCollections, doneCompletion,
  indexCompletions, isDone, isDue, isEmptyDiff, isOverdue, isRelevant, isSubtaskDone,
  matchesRecur, normalizeRecur, snapshotCollections, sortFlat, subtaskProgress,
  validateName, validateNote
} from '../web/js/tasks-core.js';

var n = 0;
function test(name, fn) {
  try { fn(); n++; } catch (err) {
    console.error('FAIL ' + name + '\n  ' + (err && err.message));
    process.exitCode = 1;
  }
}

function task(o) {
  return Object.assign({ id: 't1', area: 'prod', projectId: null, title: 'T', note: '', priority: 0, due: null, recur: null, subtasks: [], order: 1, createdAt: '2026-10-01T00:00:00Z' }, o);
}
function comp(o) {
  return Object.assign({ id: 'c' + Math.random(), taskId: 't1', subtaskId: null, date: '2026-10-26', at: '2026-10-26T10:00:00Z' }, o);
}

/* ---------- recurrence ---------- */
test('weekdays recurrence matches only the chosen days (2026-10-26 is a Monday)', function () {
  var r = { kind: 'weekdays', days: [1, 3, 5] }; /* Mon Wed Fri */
  assert.equal(matchesRecur(r, '2026-10-26'), true);  /* Mon */
  assert.equal(matchesRecur(r, '2026-10-27'), false); /* Tue */
  assert.equal(matchesRecur(r, '2026-10-28'), true);  /* Wed */
  assert.equal(matchesRecur(r, '2026-10-31'), false); /* Sat */
  assert.equal(matchesRecur(r, '2026-11-01'), false); /* Sun */
  var all = { kind: 'weekdays', days: [0, 1, 2, 3, 4, 5, 6] };
  for (var d = 26; d <= 31; d++) assert.equal(matchesRecur(all, '2026-10-' + d), true);
  assert.equal(matchesRecur(null, '2026-10-26'), false);
});

test('monthly recurrence: day D, clamped to the last day of short months', function () {
  var r15 = { kind: 'monthly', day: 15 };
  assert.equal(matchesRecur(r15, '2026-10-15'), true);
  assert.equal(matchesRecur(r15, '2026-10-16'), false);
  var r31 = { kind: 'monthly', day: 31 };
  assert.equal(matchesRecur(r31, '2026-10-31'), true);
  assert.equal(matchesRecur(r31, '2026-10-30'), false);
  assert.equal(matchesRecur(r31, '2026-11-30'), true);  /* 30-day month */
  assert.equal(matchesRecur(r31, '2026-11-29'), false);
  assert.equal(matchesRecur(r31, '2026-02-28'), true);  /* Feb clamp, common year */
  assert.equal(matchesRecur(r31, '2026-02-27'), false);
  assert.equal(matchesRecur(r31, '2028-02-29'), true);  /* Feb clamp, leap year */
  assert.equal(matchesRecur(r31, '2028-02-28'), false);
  assert.equal(matchesRecur({ kind: 'monthly', day: 30 }, '2026-02-28'), true);
  assert.equal(matchesRecur({ kind: 'monthly', day: 29 }, '2026-02-28'), true);
  assert.equal(matchesRecur({ kind: 'monthly', day: 29 }, '2028-02-28'), false); /* leap year has a 29th */
  assert.equal(matchesRecur({ kind: 'monthly', day: 29 }, '2028-02-29'), true);
});

test('normalizeRecur cleans or rejects rules; describeRecur reads naturally', function () {
  assert.deepEqual(normalizeRecur({ kind: 'weekdays', days: [5, 1, 1, '3', 9, -1] }), { kind: 'weekdays', days: [1, 3, 5] });
  assert.equal(normalizeRecur({ kind: 'weekdays', days: [] }), null);
  assert.equal(normalizeRecur({ kind: 'monthly', day: 0 }), null);
  assert.equal(normalizeRecur({ kind: 'monthly', day: 32 }), null);
  assert.equal(normalizeRecur({ kind: 'yearly' }), null);
  assert.equal(normalizeRecur(null), null);
  assert.deepEqual(normalizeRecur({ kind: 'monthly', day: 31 }), { kind: 'monthly', day: 31 });
  assert.equal(describeRecur({ kind: 'weekdays', days: [0, 1, 2, 3, 4, 5, 6] }), 'Daily');
  assert.equal(describeRecur({ kind: 'weekdays', days: [5, 1, 3] }), 'Mon Wed Fri');
  assert.equal(describeRecur({ kind: 'monthly', day: 1 }), 'Monthly on the 1st');
  assert.equal(describeRecur({ kind: 'monthly', day: 22 }), 'Monthly on the 22nd');
  assert.equal(describeRecur({ kind: 'monthly', day: 11 }), 'Monthly on the 11th');
});

test('a recurring task is done only for the date it was completed; a missed day just passes', function () {
  var t = task({ recur: { kind: 'weekdays', days: [1, 3] } });
  var comps = [comp({ date: '2026-10-26' })];
  assert.equal(isDone(t, '2026-10-26', comps), true);
  assert.equal(isDone(t, '2026-10-28', comps), false);
  assert.equal(isOverdue(t, '2026-10-30', comps), false);
  assert.equal(isDue(t, '2026-10-28'), true);
  assert.equal(isDue(t, '2026-10-27'), false);
});

/* ---------- one-off visibility ---------- */
test('one-off visibility: open tasks always show, done ones only on their day', function () {
  var open = task({ id: 'a' });
  var done = task({ id: 'b' });
  var comps = [comp({ taskId: 'b', date: '2026-10-24' })];
  assert.equal(isRelevant(open, '2026-10-26', comps, false), true);
  assert.equal(isRelevant(done, '2026-10-24', comps, false), true);  /* done on that day */
  assert.equal(isRelevant(done, '2026-10-26', comps, false), false); /* completed earlier: hidden */
  assert.equal(isRelevant(done, '2026-10-26', comps, true), true);   /* Show completed */
  assert.equal(isDone(done, '2026-10-26', comps), true);
  assert.equal(isDone(open, '2026-10-26', comps), false);
});

test('recurring tasks show only on matching days, regardless of Show completed', function () {
  var t = task({ recur: { kind: 'monthly', day: 31 } });
  assert.equal(isRelevant(t, '2026-02-28', [], false), true);
  assert.equal(isRelevant(t, '2026-02-27', [], true), false);
});

test('overdue: one-off, not done, due before the viewed day', function () {
  var t = task({ due: '2026-10-20' });
  assert.equal(isOverdue(t, '2026-10-26', []), true);
  assert.equal(isOverdue(t, '2026-10-20', []), false);  /* due that day is not overdue yet */
  assert.equal(isOverdue(t, '2026-10-19', []), false);
  assert.equal(isOverdue(t, '2026-10-26', [comp({ date: '2026-10-21' })]), false); /* done */
  assert.equal(isDue(t, '2026-10-26'), true);
  assert.equal(isDue(task({ due: '2026-10-28' }), '2026-10-26'), false);
  assert.equal(isDue(task(), '2026-10-26'), false);
});

test('doneCompletion ignores subtask completions; Map index works like the array', function () {
  var t = task({ subtasks: [{ id: 's1', title: 'x' }] });
  var comps = [comp({ subtaskId: 's1' })];
  assert.equal(isDone(t, '2026-10-26', comps), false);
  var idx = indexCompletions(comps);
  assert.equal(isDone(t, '2026-10-26', idx), false);
  var c2 = comp({ date: '2026-10-26' });
  assert.equal(doneCompletion(t, '2026-10-26', indexCompletions(comps.concat([c2]))), c2);
});

test('subtask progress is per occurrence for recurring tasks, global for one-offs', function () {
  var subs = [{ id: 's1', title: 'a' }, { id: 's2', title: 'b' }];
  var rec = task({ recur: { kind: 'weekdays', days: [0, 1, 2, 3, 4, 5, 6] }, subtasks: subs });
  var comps = [comp({ subtaskId: 's1', date: '2026-10-26' })];
  assert.deepEqual(subtaskProgress(rec, '2026-10-26', comps), { done: 1, total: 2 });
  assert.deepEqual(subtaskProgress(rec, '2026-10-27', comps), { done: 0, total: 2 });
  assert.equal(isSubtaskDone(rec, 's1', '2026-10-27', comps), false);
  var one = task({ subtasks: subs });
  assert.deepEqual(subtaskProgress(one, '2026-10-30', comps), { done: 1, total: 2 });
});

/* ---------- activity ---------- */
test('activeDays: 7 days ending at the given day, oldest first', function () {
  var tasks = [task({ id: 'a', projectId: 'p1' }), task({ id: 'b', projectId: 'p1' }), task({ id: 'c', projectId: 'p2' })];
  var comps = [
    comp({ taskId: 'a', date: '2026-10-26' }),
    comp({ taskId: 'b', date: '2026-10-26' }),
    comp({ taskId: 'a', date: '2026-10-22' }),
    comp({ taskId: 'c', date: '2026-10-25' }),   /* other project */
    comp({ taskId: 'a', date: '2026-10-19' })    /* outside the window */
  ];
  var days = activeDays('p1', tasks, comps, '2026-10-26', 7);
  assert.equal(days.length, 7);
  assert.equal(days[0].date, '2026-10-20');
  assert.equal(days[6].date, '2026-10-26');
  assert.deepEqual(days.map(function (d) { return d.count; }), [0, 0, 1, 0, 0, 0, 2]);
  assert.deepEqual(days.map(function (d) { return d.active; }), [false, false, true, false, false, false, true]);
});

test('subtask completions count toward activeDays (once per task per day)', function () {
  var tasks = [task({ id: 'a', projectId: 'p1', subtasks: [{ id: 's1', title: '' }, { id: 's2', title: '' }] })];
  var comps = [
    comp({ taskId: 'a', subtaskId: 's1', date: '2026-10-25' }),
    comp({ taskId: 'a', subtaskId: 's2', date: '2026-10-25' }),
    comp({ taskId: 'a', subtaskId: null, date: '2026-10-25' })
  ];
  var days = activeDays('p1', tasks, comps, '2026-10-26', 7);
  assert.equal(days[5].date, '2026-10-25');
  assert.equal(days[5].count, 1);
  assert.equal(days[5].active, true);
  assert.equal(days[6].active, false);
});

test('activeDays for loose tasks can be limited to one area', function () {
  var tasks = [task({ id: 'a', area: 'prod' }), task({ id: 'b', area: 'hobby' }), task({ id: 'c', area: 'prod', projectId: 'p1' })];
  var comps = [comp({ taskId: 'a' }), comp({ taskId: 'b' }), comp({ taskId: 'c' })];
  assert.equal(activeDays(null, tasks, comps, '2026-10-26', 1, 'prod')[0].count, 1);
  assert.equal(activeDays(null, tasks, comps, '2026-10-26', 1)[0].count, 2);
});

/* ---------- flat sort ---------- */
test('sortFlat: overdue first, then due ascending, then priority descending', function () {
  var tasks = [
    task({ id: 'noDueHigh', priority: 3, order: 1 }),
    task({ id: 'dueLaterLow', due: '2026-11-05', priority: 1, order: 2 }),
    task({ id: 'dueSoonLow', due: '2026-10-28', priority: 1, order: 3 }),
    task({ id: 'dueSoonHigh', due: '2026-10-28', priority: 3, order: 4 }),
    task({ id: 'overdueNew', due: '2026-10-25', priority: 0, order: 5 }),
    task({ id: 'overdueOld', due: '2026-10-20', priority: 0, order: 6 }),
    task({ id: 'noDueLow', priority: 1, order: 7 }),
    task({ id: 'doneOverdue', due: '2026-10-10', order: 8 })
  ];
  var comps = [comp({ taskId: 'doneOverdue', date: '2026-10-26' })];
  var ids = sortFlat(tasks, '2026-10-26', comps).map(function (t) { return t.id; });
  assert.deepEqual(ids, ['overdueOld', 'overdueNew', 'dueSoonHigh', 'dueSoonLow', 'dueLaterLow', 'noDueHigh', 'noDueLow', 'doneOverdue']);
});

test('sortFlat does not mutate its input and breaks ties by order', function () {
  var tasks = [task({ id: 'b', order: 2 }), task({ id: 'a', order: 1 })];
  var out = sortFlat(tasks, '2026-10-26', []);
  assert.deepEqual(out.map(function (t) { return t.id; }), ['a', 'b']);
  assert.equal(tasks[0].id, 'b');
});

/* ---------- limits ---------- */
test('limits are the accepted values', function () {
  assert.deepEqual(LIMITS, { name: 80, note: 2000, subtasks: 30, projects: 200, tasks: 5000 });
});

test('validateName: trims, rejects empty and over-long with a way forward', function () {
  assert.deepEqual(validateName('  Buy milk  '), { ok: true, value: 'Buy milk' });
  var empty = validateName('   ');
  assert.equal(empty.ok, false);
  assert.ok(empty.error.length > 0);
  assert.equal(validateName('x'.repeat(80)).ok, true);
  var long = validateName('x'.repeat(81));
  assert.equal(long.ok, false);
  assert.match(long.error, /80/);
});

test('validateNote: empty is fine (clears), 2000 ok, 2001 rejected', function () {
  assert.deepEqual(validateNote(''), { ok: true, value: '' });
  assert.equal(validateNote('n'.repeat(2000)).ok, true);
  var bad = validateNote('n'.repeat(2001));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /2000/);
});

test('canAdd enforces 30 subtasks, 200 projects, 5000 tasks', function () {
  assert.equal(canAdd('subtasks', 29).ok, true);
  var s = canAdd('subtasks', 30);
  assert.equal(s.ok, false);
  assert.match(s.error, /30/);
  assert.equal(canAdd('projects', 199).ok, true);
  assert.equal(canAdd('projects', 200).ok, false);
  assert.equal(canAdd('tasks', 4999).ok, true);
  assert.equal(canAdd('tasks', 5000).ok, false);
});

/* ---------- diff / undo ---------- */
function db() {
  return {
    projects: [{ id: 'p1', name: 'P' }],
    tasks: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }],
    completions: [{ id: 'k1', taskId: 'a' }]
  };
}
test('diff captures add / remove / change; undo and redo restore exactly', function () {
  var data = db();
  var snap = snapshotCollections(data);
  data.tasks[0].title = 'A2';                               /* change */
  data.tasks = data.tasks.filter(function (t) { return t.id !== 'b'; }); /* remove (index 1) */
  data.tasks.push({ id: 'd', title: 'D' });                 /* add */
  data.completions = [];                                    /* remove completion */
  var diff = diffCollections(snap, data);
  assert.equal(isEmptyDiff(diff), false);
  var after = JSON.stringify(data);
  applyDiff(data, diff, false);
  assert.deepEqual(data, db());
  applyDiff(data, diff, true);
  assert.equal(JSON.stringify(data), after);
});

test('undo leaves unrelated later edits alone', function () {
  var data = db();
  var snap = snapshotCollections(data);
  data.tasks[2].title = 'C2';
  var diff = diffCollections(snap, data);
  data.tasks[0].title = 'A-later'; /* a different item edited afterwards */
  applyDiff(data, diff, false);
  assert.equal(data.tasks[2].title, 'C');
  assert.equal(data.tasks[0].title, 'A-later');
});

test('no-op mutation gives an empty diff', function () {
  var data = db();
  var snap = snapshotCollections(data);
  assert.equal(isEmptyDiff(diffCollections(snap, data)), true);
});

if (!process.exitCode) console.log('test-tasks-core: ' + n + ' tests passed');
