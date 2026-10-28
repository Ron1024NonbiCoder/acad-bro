/* Pure task logic: recurrence, done-state, visibility, activity, sorting,
   limits, and the id-based diff that powers Undo/Redo. No DOM, no storage, no
   imports but utils.js, so node can test all of it (scripts/test-tasks-core.mjs).

   Data shapes are docs/DEV.md section 4. "iso" is a local YYYY-MM-DD string and
   is always the SELECTED day D, never implicitly "today": the app lets you view
   and backfill any day, so every question here is "as of D".

   Completions arguments accept either the raw array or the Map returned by
   indexCompletions(); the UI builds the Map once per render so a long list
   stays O(tasks + completions). */

import { addDays, fmtISO, parseISO, MONTH_SHORT, WEEKDAY_SHORT } from './utils.js';

/* docs/DEV.md section 3: accepted input limits */
export var LIMITS = { name: 80, note: 2000, subtasks: 30, projects: 200, tasks: 5000 };
export var PRIORITY_MARKS = ['', '!', '!!', '!!!'];
export var PRIORITY_NAMES = ['None', 'Low', 'Medium', 'High'];

/* ================= recurrence ================= */
export function daysInMonth(year, month0) { return new Date(year, month0 + 1, 0).getDate(); }

/* Does `recur` fall on the day `iso`? A monthly day past the month's end lands
   on the month's last day (day 31 -> Feb 28/29), per the accepted default. */
export function matchesRecur(recur, iso) {
  if (!recur) return false;
  var d = parseISO(iso);
  if (recur.kind === 'weekdays') return Array.isArray(recur.days) && recur.days.indexOf(d.getDay()) !== -1;
  if (recur.kind === 'monthly') {
    var last = daysInMonth(d.getFullYear(), d.getMonth());
    return d.getDate() === Math.min(Number(recur.day), last);
  }
  return false;
}

/* A clean recur object, or null when `r` is not a usable rule (no days chosen,
   a day outside 1..31, an unknown kind). Days are de-duplicated and sorted. */
export function normalizeRecur(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.kind === 'weekdays') {
    if (!Array.isArray(r.days)) return null;
    var seen = {};
    var days = [];
    r.days.forEach(function (n) {
      n = Number(n);
      if (Number.isInteger(n) && n >= 0 && n <= 6 && !seen[n]) { seen[n] = true; days.push(n); }
    });
    if (!days.length) return null;
    return { kind: 'weekdays', days: days.sort(function (a, b) { return a - b; }) };
  }
  if (r.kind === 'monthly') {
    var day = Number(r.day);
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    return { kind: 'monthly', day: day };
  }
  return null;
}

function ordinal(n) {
  var v = n % 100;
  if (v >= 11 && v <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}
/* "Daily", "Mon Wed Fri", "Monthly on the 31st" */
export function describeRecur(r) {
  if (!r) return '';
  if (r.kind === 'weekdays') {
    if (r.days.length === 7) return 'Daily';
    return r.days.slice().sort(function (a, b) { return a - b; }).map(function (n) { return WEEKDAY_SHORT[n]; }).join(' ');
  }
  if (r.kind === 'monthly') return 'Monthly on the ' + ordinal(r.day);
  return '';
}

/* ================= completions ================= */
export function indexCompletions(completions) {
  var m = new Map();
  completions.forEach(function (c) {
    var list = m.get(c.taskId);
    if (list) list.push(c); else m.set(c.taskId, [c]);
  });
  return m;
}
function compsOf(task, comps) {
  if (comps instanceof Map) return comps.get(task.id) || [];
  return comps.filter(function (c) { return c.taskId === task.id; });
}

/* The completion that makes `task` done as of `iso`, or null.
   One-off: any whole-task completion (it stays done). Recurring: only one dated
   `iso` (each occurrence starts fresh). */
export function doneCompletion(task, iso, comps) {
  var list = compsOf(task, comps);
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (c.subtaskId !== null && c.subtaskId !== undefined) continue;
    if (!task.recur || c.date === iso) return c;
  }
  return null;
}
export function isDone(task, iso, comps) { return doneCompletion(task, iso, comps) !== null; }

export function subtaskCompletion(task, subtaskId, iso, comps) {
  var list = compsOf(task, comps);
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (c.subtaskId !== subtaskId) continue;
    if (!task.recur || c.date === iso) return c;
  }
  return null;
}
export function isSubtaskDone(task, subtaskId, iso, comps) { return subtaskCompletion(task, subtaskId, iso, comps) !== null; }
export function subtaskProgress(task, iso, comps) {
  var subs = task.subtasks || [];
  var done = 0;
  subs.forEach(function (s) { if (isSubtaskDone(task, s.id, iso, comps)) done++; });
  return { done: done, total: subs.length };
}

/* ================= due / visibility ================= */
/* Is the task "due" on `iso`? Recurring: the rule matches. One-off: it has a
   due date that is `iso` or earlier (due today or overdue). */
export function isDue(task, iso) {
  if (task.recur) return matchesRecur(task.recur, iso);
  return !!task.due && task.due <= iso;
}
/* One-off, not done, due before `iso`. A recurring occurrence that was missed
   just passes (docs/DEV.md): never overdue. */
export function isOverdue(task, iso, comps) {
  if (task.recur || !task.due) return false;
  return task.due < iso && !isDone(task, iso, comps);
}
/* Should the task appear in the list for day `iso`?
   - recurring: only on days its rule matches (done or not)
   - one-off: always (completed ones stay visible) */
export function isRelevant(task, iso) {
  if (task.recur) return matchesRecur(task.recur, iso);
  return true;
}

/* ================= sorting ================= */
/* Flat view order: not-done before done, then overdue first, then due date
   ascending (no due date last), then priority high to low, then creation order. */
export function sortFlat(tasks, iso, comps) {
  var info = new Map();
  tasks.forEach(function (t) {
    info.set(t.id, { done: isDone(t, iso, comps), overdue: isOverdue(t, iso, comps) });
  });
  return tasks.slice().sort(function (a, b) {
    var ia = info.get(a.id);
    var ib = info.get(b.id);
    if (ia.done !== ib.done) return ia.done ? 1 : -1;
    if (ia.overdue !== ib.overdue) return ia.overdue ? -1 : 1;
    var da = a.recur ? null : a.due;
    var db = b.recur ? null : b.due;
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? -1 : 1;
    }
    var pa = a.priority || 0;
    var pb = b.priority || 0;
    if (pa !== pb) return pb - pa;
    var oa = a.order || 0;
    var ob = b.order || 0;
    if (oa !== ob) return oa - ob;
    return String(a.createdAt || '') < String(b.createdAt || '') ? -1 : 1;
  });
}
/* Grouped view order inside a list: priority is not used, creation order is */
export function sortByOrder(items) {
  return items.slice().sort(function (a, b) {
    var oa = a.order || 0;
    var ob = b.order || 0;
    if (oa !== ob) return oa - ob;
    return String(a.createdAt || '') < String(b.createdAt || '') ? -1 : 1;
  });
}

/* ================= activity ================= */
/* The `n` days ending at endISO (oldest first), each { date, count, active }.
   count = distinct tasks of the project with a completion (the task itself OR
   one of its subtasks) dated that day, so a subtask tick counts as activity.
   projectId null = loose tasks; pass `area` to limit those to one area. */
export function activeDays(projectId, tasks, completions, endISO, n, area) {
  var ids = new Set();
  tasks.forEach(function (t) {
    var pid = t.projectId === undefined ? null : t.projectId;
    if (pid !== projectId) return;
    if (projectId === null && area && t.area !== area) return;
    ids.add(t.id);
  });
  var per = new Map();
  var days = [];
  var end = parseISO(endISO);
  for (var i = n - 1; i >= 0; i--) days.push(fmtISO(addDays(end, -i)));
  var wanted = new Set(days);
  completions.forEach(function (c) {
    if (!ids.has(c.taskId) || !wanted.has(c.date)) return;
    var s = per.get(c.date);
    if (!s) { s = new Set(); per.set(c.date, s); }
    s.add(c.taskId);
  });
  return days.map(function (date) {
    var count = per.has(date) ? per.get(date).size : 0;
    return { date: date, count: count, active: count > 0 };
  });
}

/* ---- review board & heatmaps (M4) ----
   One pass over tasks + completions builds a per-row, per-day count for a whole
   date range, so the board costs O(tasks + completions) per render instead of
   one scan per project. Counting rule is activeDays' (distinct tasks, subtask
   completions included), so the two always agree. */

/* The board row a task belongs to: its project, or "loose in <area>". */
export function activityKey(task) {
  return task.projectId ? 'p:' + task.projectId : 'loose:' + task.area;
}

/* Map rowKey -> Map(date -> distinct-task count) for dates startISO..endISO
   (inclusive; ISO strings compare chronologically). */
export function activityIndex(tasks, completions, startISO, endISO) {
  var keyOf = new Map();
  tasks.forEach(function (t) { keyOf.set(t.id, activityKey(t)); });
  var seen = new Set();
  var index = new Map();
  completions.forEach(function (c) {
    if (c.date < startISO || c.date > endISO) return;
    var key = keyOf.get(c.taskId);
    if (key === undefined) return;
    var once = c.taskId + '|' + c.date;
    if (seen.has(once)) return;
    seen.add(once);
    var days = index.get(key);
    if (!days) { days = new Map(); index.set(key, days); }
    days.set(c.date, (days.get(c.date) || 0) + 1);
  });
  return index;
}

/* Map of ISO date -> area ids (colour keys: the Activity board colours its dots
   and heatmap by area) for dates in startISO..endISO with at least one completion
   (task or subtask) of a task in `areas` -- the day strip's / month grid's done
   circles. The ids come in the order of the `areas` argument (stable, no
   duplicates); a date with no completion is absent. Same rule as activityIndex:
   completions of deleted tasks are ignored. */
export function doneDates(tasks, completions, areas, startISO, endISO) {
  var areaOf = new Map();
  tasks.forEach(function (t) { if (areas.indexOf(t.area) !== -1) areaOf.set(t.id, t.area); });
  var found = new Map(); /* date -> Set of area ids */
  completions.forEach(function (c) {
    if (c.date < startISO || c.date > endISO || !areaOf.has(c.taskId)) return;
    var set = found.get(c.date);
    if (!set) { set = new Set(); found.set(c.date, set); }
    set.add(areaOf.get(c.taskId));
  });
  var out = new Map();
  found.forEach(function (set, date) {
    out.set(date, areas.filter(function (a, i) { return set.has(a) && areas.indexOf(a) === i; }));
  });
  return out;
}

var MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* The month calendar behind the expanded day strip: the month containing
   anchorISO, always 6 weeks x 7 days (so paging months never changes the grid's
   height), starting on weekStartDow (0=Sun .. 6=Sat). Days of the neighbouring
   months fill the gaps with inMonth:false. */
export function monthGrid(anchorISO, weekStartDow) {
  var a = parseISO(anchorISO);
  var first = new Date(a.getFullYear(), a.getMonth(), 1);
  var start = addDays(first, -((first.getDay() - weekStartDow + 7) % 7));
  var weeks = [];
  for (var w = 0; w < 6; w++) {
    var row = [];
    for (var i = 0; i < 7; i++) {
      var d = addDays(start, w * 7 + i);
      row.push({ date: fmtISO(d), inMonth: d.getMonth() === first.getMonth() });
    }
    weeks.push(row);
  }
  return { title: MONTH_LONG[first.getMonth()] + ' ' + first.getFullYear(), first: fmtISO(first), weeks: weeks };
}

/* ISO of the 1st of the month n months from anchorISO's month (n may be negative) */
export function shiftMonthISO(anchorISO, n) {
  var a = parseISO(anchorISO);
  return fmtISO(new Date(a.getFullYear(), a.getMonth() + n, 1));
}

/* The `n` days ending at endISO (oldest first) from one row's date->count Map
   (undefined = no activity): the same shape as activeDays. */
export function windowDays(counts, endISO, n) {
  var out = [];
  var end = parseISO(endISO);
  for (var i = n - 1; i >= 0; i--) {
    var date = fmtISO(addDays(end, -i));
    var count = (counts && counts.get(date)) || 0;
    out.push({ date: date, count: count, active: count > 0 });
  }
  return out;
}

/* 0 = none, 1, 2, 3, 4 = four or more */
export function intensityLevel(count) { return count >= 4 ? 4 : count > 0 ? count : 0; }

/* Heatmap grid: `weeks` week-columns, the last one holding endISO; each column
   has 7 cells starting on weekStartDow (0=Sun .. 6=Sat). Days after endISO are
   inRange:false (drawn blank, not tappable). month = short month name on the
   first column and wherever the month changes, else ''.
   Returns { weeks: [{ month, cells: [{ date, count, level, inRange }] }], total }
   where total = sum of the counts shown in the grid. */
export function heatmapGrid(counts, endISO, weeks, weekStartDow) {
  var end = parseISO(endISO);
  var lastStart = addDays(end, -((end.getDay() - weekStartDow + 7) % 7));
  var firstStart = addDays(lastStart, -7 * (weeks - 1));
  var total = 0;
  var prevMonth = -1;
  var cols = [];
  for (var w = 0; w < weeks; w++) {
    var wkStart = addDays(firstStart, w * 7);
    var cells = [];
    for (var d = 0; d < 7; d++) {
      var day = addDays(wkStart, d);
      var date = fmtISO(day);
      var inRange = date <= endISO;
      var count = inRange ? ((counts && counts.get(date)) || 0) : 0;
      total += count;
      cells.push({ date: date, count: count, level: intensityLevel(count), inRange: inRange });
    }
    var m = wkStart.getMonth();
    cols.push({ month: m !== prevMonth ? MONTH_SHORT[m] : '', cells: cells });
    prevMonth = m;
  }
  return { weeks: cols, total: total };
}

/* Which rows the board shows: for each area, its non-archived projects in
   order, plus a loose row (first) when the area has tasks outside any project.
   Areas with no rows are left out. Returns
   [{ area, rows: [{ key, projectId|null, name|null, area }] }]; name is null
   for the loose row (the UI words it). */
export function reviewGroups(areaIds, projects, tasks) {
  return areaIds.map(function (area) {
    var rows = [];
    if (tasks.some(function (t) { return t.area === area && !t.projectId; })) {
      rows.push({ key: 'loose:' + area, projectId: null, name: null, area: area });
    }
    sortByOrder(projects.filter(function (p) { return p.area === area && !p.archived; })).forEach(function (p) {
      rows.push({ key: 'p:' + p.id, projectId: p.id, name: p.name, area: area });
    });
    return { area: area, rows: rows };
  }).filter(function (g) { return g.rows.length > 0; });
}

/* ================= limits & validation ================= */
/* Names: trimmed, 1..80 characters. Messages say what to do (CLAUDE.md). */
export function validateName(raw) {
  var v = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!v) return { ok: false, value: v, error: 'Type a name to save it.' };
  if (v.length > LIMITS.name) return { ok: false, value: v, error: 'Names can have up to ' + LIMITS.name + ' characters. Shorten it to save.' };
  return { ok: true, value: v };
}
export function validateNote(raw) {
  var v = String(raw === undefined || raw === null ? '' : raw).trim();
  if (v.length > LIMITS.note) return { ok: false, value: v, error: 'Notes can have up to ' + LIMITS.note + ' characters. Shorten it to save.' };
  return { ok: true, value: v };
}
var COUNT_ERRORS = {
  subtasks: 'A task can have up to ' + LIMITS.subtasks + ' subtasks. Remove one to add another.',
  projects: 'You can have up to ' + LIMITS.projects + ' projects. Delete one to add another.',
  tasks: 'You can have up to ' + LIMITS.tasks + ' tasks. Delete some to add more.'
};
/* kind: 'subtasks' | 'projects' | 'tasks'; count = how many exist now */
export function canAdd(kind, count) {
  if (count >= LIMITS[kind]) return { ok: false, error: COUNT_ERRORS[kind] };
  return { ok: true };
}
/* Message for a text field that has just hit its maxlength */
export function limitHitMessage(kind) {
  return kind === 'note'
    ? 'Notes are limited to ' + LIMITS.note + ' characters.'
    : 'Names are limited to ' + LIMITS.name + ' characters.';
}

/* ================= id-based diff (Undo / Redo) =================
   A mutation is described by what it did to the three collections, keyed by
   item id. Undo applies the diff backwards, Redo forwards, and neither touches
   items the mutation did not (so Undo of an old toast cannot wipe later edits
   to other items). */
export var COLLECTIONS = ['projects', 'tasks', 'completions'];

function clone(x) { return JSON.parse(JSON.stringify(x)); }

/* id -> JSON string, per collection: cheap to compare later */
export function snapshotCollections(data) {
  var snap = {};
  COLLECTIONS.forEach(function (k) {
    var m = new Map();
    data[k].forEach(function (item, index) { m.set(item.id, { json: JSON.stringify(item), index: index }); });
    snap[k] = m;
  });
  return snap;
}
export function diffCollections(snap, data) {
  var diff = {};
  COLLECTIONS.forEach(function (k) {
    var d = { added: [], removed: [], changed: [] };
    var seen = new Set();
    data[k].forEach(function (item) {
      seen.add(item.id);
      var old = snap[k].get(item.id);
      if (!old) { d.added.push(clone(item)); return; }
      var now = JSON.stringify(item);
      if (now !== old.json) d.changed.push({ before: JSON.parse(old.json), after: JSON.parse(now) });
    });
    snap[k].forEach(function (old, id) {
      if (!seen.has(id)) d.removed.push({ item: JSON.parse(old.json), index: old.index });
    });
    diff[k] = d;
  });
  return diff;
}
export function isEmptyDiff(diff) {
  return COLLECTIONS.every(function (k) {
    return !diff[k].added.length && !diff[k].removed.length && !diff[k].changed.length;
  });
}
/* forward = true re-applies the mutation, false reverses it. Mutates data. */
export function applyDiff(data, diff, forward) {
  COLLECTIONS.forEach(function (k) {
    var d = diff[k];
    var list = data[k];
    var drop = forward ? d.removed.map(function (r) { return r.item.id; }) : d.added.map(function (a) { return a.id; });
    var dropSet = new Set(drop);
    list = list.filter(function (item) { return !dropSet.has(item.id); });
    var swap = new Map();
    d.changed.forEach(function (c) { swap.set(c.after.id, forward ? c.after : c.before); });
    list = list.map(function (item) { return swap.has(item.id) ? clone(swap.get(item.id)) : item; });
    if (forward) {
      d.added.forEach(function (a) { if (!list.some(function (x) { return x.id === a.id; })) list.push(clone(a)); });
    } else {
      d.removed.slice().sort(function (a, b) { return a.index - b.index; }).forEach(function (r) {
        if (list.some(function (x) { return x.id === r.item.id; })) return;
        list.splice(Math.min(r.index, list.length), 0, clone(r.item));
      });
    }
    data[k] = list;
  });
}
