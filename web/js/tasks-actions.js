/* Every task / project mutation and editor transition (M2).

   Mutations all go through commit(): run the change on DB, diff the three
   collections (tasks-core.js), saveData(), render(), then toast with Undo. Undo
   applies the diff backwards and raises a Redo toast, and so on, so every
   create / update / delete is announced and reversible (CLAUDE.md: no silent
   data loss). A failed save is reported by storage.js's onSaveError hook.

   Editors: one in-place text editor (ui.editing) and one inline form (ui.panel)
   at a time; opening either calls clearActive() first. Text editors commit on
   Enter and on blur, and cancel on Escape. */

import { ui, clearActive, AREA_IDS } from './state.js';
import { DB, saveData } from './storage.js';
import { settings, setSetting, setViewFor } from './settings.js';
import { render } from './shell.js';
import { showToast } from './toast.js';
import { closeTray } from './swipe-entry.js';
import { isISODate, uid, parseISO, todayISO, MONTH_SHORT } from './utils.js';
import {
  LIMITS, applyDiff, canAdd, describeRecur, diffCollections, doneCompletion, isEmptyDiff,
  limitHitMessage, normalizeRecur, snapshotCollections, subtaskCompletion, validateName, validateNote
} from './tasks-core.js';

/* ================= small helpers ================= */
function now() { return new Date().toISOString(); }
export function findTask(id) { for (var i = 0; i < DB.tasks.length; i++) if (DB.tasks[i].id === id) return DB.tasks[i]; return null; }
export function findProject(id) { for (var i = 0; i < DB.projects.length; i++) if (DB.projects[i].id === id) return DB.projects[i]; return null; }
function q(s) {
  s = String(s);
  return '"' + (s.length > 36 ? s.slice(0, 35) + '…' : s) + '"';
}
function warn(message) { showToast({ message: message, tone: 'warn' }); }
function nextOrder(list) {
  var m = 0;
  list.forEach(function (x) { if ((x.order || 0) > m) m = x.order || 0; });
  return m + 1;
}
function areaLabel(id) { return DB.areaLabels[id] || id; }
function prettyDate(iso) { var d = parseISO(iso); return MONTH_SHORT[d.getMonth()] + ' ' + d.getDate(); }
function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

/* ================= commit + Undo/Redo ================= */
function announce(message, diff) {
  showToast({
    message: message,
    actions: [{ label: 'Undo', primary: true, onClick: function () { replay(diff, false, message); } }]
  });
}
function replay(diff, forward, message) {
  applyDiff(DB, diff, forward);
  var ok = saveData();
  render();
  showToast({
    message: ok ? (forward ? message : 'Undone: ' + message) : (forward ? 'Redone' : 'Undone') + ' on screen but not saved. Export your data to be safe.',
    tone: ok ? undefined : 'warn',
    actions: [{ label: forward ? 'Undo' : 'Redo', primary: true, onClick: function () { replay(diff, !forward, message); } }]
  });
}
/* mutate() edits DB in place and may return false to abort. Returns true if
   something changed and was saved (or at least announced). */
function commit(message, mutate) {
  var snap = snapshotCollections(DB);
  if (mutate() === false) return false;
  var diff = diffCollections(snap, DB);
  if (isEmptyDiff(diff)) return false;
  var ok = saveData();
  render();
  if (ok) announce(message, diff);
  return true;
}

/* ================= tasks ================= */
export function addTask(area, projectId, rawTitle) {
  var v = validateName(rawTitle);
  if (!v.ok) { warn(v.error); return false; }
  var lim = canAdd('tasks', DB.tasks.length);
  if (!lim.ok) { warn(lim.error); return false; }
  if (AREA_IDS.indexOf(area) === -1) return false;
  var proj = projectId ? findProject(projectId) : null;
  if (proj && (proj.area !== area || proj.archived)) proj = null;
  var t = now();
  return commit('Added ' + q(v.value) + (proj ? ' to ' + q(proj.name) : ' to ' + areaLabel(area)), function () {
    DB.tasks.push({
      id: uid('t'), area: area, projectId: proj ? proj.id : null, title: v.value, note: '',
      priority: 0, due: null, recur: null, subtasks: [], order: nextOrder(DB.tasks), createdAt: t, updatedAt: t
    });
  });
}

export function renameTask(id, raw) {
  var task = findTask(id);
  if (!task) return false;
  var v = validateName(raw);
  if (!v.ok) { warn(v.error + ' Kept ' + q(task.title) + '.'); return false; }
  if (v.value === task.title) return false;
  return commit('Renamed to ' + q(v.value), function () { task.title = v.value; task.updatedAt = now(); });
}

export function setTaskNote(id, raw) {
  var task = findTask(id);
  if (!task) return false;
  var v = validateNote(raw);
  if (!v.ok) { warn(v.error); return false; }
  if (v.value === (task.note || '')) return false;
  return commit(v.value ? 'Note saved on ' + q(task.title) : 'Note cleared on ' + q(task.title), function () { task.note = v.value; task.updatedAt = now(); });
}

export function setTaskDue(id, iso) {
  var task = findTask(id);
  if (!task) return false;
  if (iso !== null && !isISODate(iso)) { warn('Pick a valid date, or use Clear.'); return false; }
  var hadRecur = !!task.recur;
  if (!hadRecur && (task.due || null) === iso) return false;
  var msg = iso
    ? 'Due ' + prettyDate(iso) + ': ' + q(task.title) + (hadRecur ? ' (repeat removed)' : '')
    : 'Due date cleared: ' + q(task.title);
  return commit(msg, function () {
    task.due = iso;
    if (iso) task.recur = null;
    task.updatedAt = now();
  });
}

export function setTaskPriority(id, p) {
  var task = findTask(id);
  p = Number(p);
  if (!task || !(p >= 0 && p <= 3) || (task.priority || 0) === p) return false;
  var names = ['No priority', 'Low priority', 'Medium priority', 'High priority'];
  return commit(names[p] + ': ' + q(task.title), function () { task.priority = p; task.updatedAt = now(); });
}

export function setTaskRecur(id, recur) {
  var task = findTask(id);
  if (!task) return false;
  var r = recur === null ? null : normalizeRecur(recur);
  if (recur !== null && !r) { warn('Pick at least one weekday, or a day of the month.'); return false; }
  if (JSON.stringify(r) === JSON.stringify(task.recur || null)) return false;
  var hadDue = !!task.due;
  var msg = r
    ? 'Repeats ' + describeRecur(r).replace(/^Monthly/, 'monthly') + ': ' + q(task.title) + (hadDue ? ' (due date removed)' : '')
    : 'Repeat removed: ' + q(task.title);
  return commit(msg, function () {
    task.recur = r;
    if (r) task.due = null;
    task.updatedAt = now();
  });
}

export function moveTask(id, area, projectId) {
  var task = findTask(id);
  if (!task || AREA_IDS.indexOf(area) === -1) return false;
  var proj = projectId ? findProject(projectId) : null;
  if (proj && proj.area !== area) proj = null;
  var pid = proj ? proj.id : null;
  if (task.area === area && (task.projectId || null) === pid) return false;
  return commit('Moved ' + q(task.title) + ' to ' + (proj ? q(proj.name) + ' in ' : '') + areaLabel(area), function () {
    task.area = area;
    task.projectId = pid;
    task.updatedAt = now();
  });
}

export function deleteTask(id) {
  var task = findTask(id);
  if (!task) return false;
  return commit('Deleted ' + q(task.title), function () {
    DB.tasks = DB.tasks.filter(function (t) { return t.id !== id; });
    DB.completions = DB.completions.filter(function (c) { return c.taskId !== id; });
  });
}

/* Swipe right / "Mark done" for the selected day D */
export function toggleTaskDone(id) {
  var task = findTask(id);
  if (!task) return false;
  var D = ui.selectedDate;
  var existing = doneCompletion(task, D, DB.completions);
  if (existing) {
    return commit('Not done: ' + q(task.title), function () {
      DB.completions = DB.completions.filter(function (c) {
        if (c.taskId !== id || (c.subtaskId !== null && c.subtaskId !== undefined)) return true;
        return task.recur ? c.date !== D : false;
      });
    });
  }
  return commit('Done: ' + q(task.title) + (D !== todayISO() ? ' on ' + prettyDate(D) : ''), function () {
    DB.completions.push({ id: uid('c'), taskId: id, subtaskId: null, date: D, at: now() });
  });
}
/* Long-press on a done badge: move that completion to another day */
export function setCompletionDate(taskId, iso) {
  var task = findTask(taskId);
  if (!task) return false;
  if (!isISODate(iso)) { warn('Pick a valid date to save it.'); return false; }
  var c = doneCompletion(task, ui.selectedDate, DB.completions);
  if (!c) return false;
  if (c.date === iso) return false;
  if (task.recur) {
    var clash = DB.completions.some(function (x) { return x.taskId === taskId && x.subtaskId === null && x.date === iso && x.id !== c.id; });
    if (clash) { warn('Already marked done on ' + prettyDate(iso) + '. Pick another date.'); return false; }
  }
  return commit('Done date set to ' + prettyDate(iso) + ': ' + q(task.title), function () {
    c.date = iso;
    c.at = now();
    /* the task's subtasks ticked on the old day stay where they were */
  });
}

/* ================= subtasks ================= */
export function addSubtask(taskId, raw) {
  var task = findTask(taskId);
  if (!task) return false;
  var v = validateName(raw);
  if (!v.ok) { warn(v.error); return false; }
  var lim = canAdd('subtasks', (task.subtasks || []).length);
  if (!lim.ok) { warn(lim.error); return false; }
  return commit('Subtask added: ' + q(v.value), function () {
    task.subtasks = (task.subtasks || []).concat([{ id: uid('s'), title: v.value }]);
    task.updatedAt = now();
  });
}
export function renameSubtask(taskId, subId, raw) {
  var task = findTask(taskId);
  var sub = task && (task.subtasks || []).filter(function (s) { return s.id === subId; })[0];
  if (!sub) return false;
  var v = validateName(raw);
  if (!v.ok) { warn(v.error + ' Kept ' + q(sub.title) + '.'); return false; }
  if (v.value === sub.title) return false;
  return commit('Subtask renamed to ' + q(v.value), function () {
    task.subtasks = task.subtasks.map(function (s) { return s.id === subId ? Object.assign({}, s, { title: v.value }) : s; });
    task.updatedAt = now();
  });
}
export function deleteSubtask(taskId, subId) {
  var task = findTask(taskId);
  var sub = task && (task.subtasks || []).filter(function (s) { return s.id === subId; })[0];
  if (!sub) return false;
  return commit('Deleted subtask ' + q(sub.title), function () {
    task.subtasks = task.subtasks.filter(function (s) { return s.id !== subId; });
    task.updatedAt = now();
    DB.completions = DB.completions.filter(function (c) { return !(c.taskId === taskId && c.subtaskId === subId); });
  });
}
export function toggleSubtask(taskId, subId) {
  var task = findTask(taskId);
  var sub = task && (task.subtasks || []).filter(function (s) { return s.id === subId; })[0];
  if (!sub) return false;
  var D = ui.selectedDate;
  var existing = subtaskCompletion(task, subId, D, DB.completions);
  if (existing) {
    return commit('Subtask not done: ' + q(sub.title), function () {
      DB.completions = DB.completions.filter(function (c) {
        if (c.taskId !== taskId || c.subtaskId !== subId) return true;
        return task.recur ? c.date !== D : false;
      });
    });
  }
  return commit('Subtask done: ' + q(sub.title), function () {
    DB.completions.push({ id: uid('c'), taskId: taskId, subtaskId: subId, date: D, at: now() });
  });
}

/* ================= projects ================= */
export function addProject(area, raw) {
  var v = validateName(raw);
  if (!v.ok) { warn(v.error); return false; }
  var lim = canAdd('projects', DB.projects.length);
  if (!lim.ok) { warn(lim.error); return false; }
  if (AREA_IDS.indexOf(area) === -1) return false;
  var t = now();
  return commit('Project ' + q(v.value) + ' added to ' + areaLabel(area), function () {
    DB.projects.push({ id: uid('p'), area: area, name: v.value, note: '', archived: false, order: nextOrder(DB.projects), createdAt: t, updatedAt: t });
  });
}
export function renameProject(id, raw) {
  var p = findProject(id);
  if (!p) return false;
  var v = validateName(raw);
  if (!v.ok) { warn(v.error + ' Kept ' + q(p.name) + '.'); return false; }
  if (v.value === p.name) return false;
  return commit('Project renamed to ' + q(v.value), function () { p.name = v.value; p.updatedAt = now(); });
}
export function setProjectNote(id, raw) {
  var p = findProject(id);
  if (!p) return false;
  var v = validateNote(raw);
  if (!v.ok) { warn(v.error); return false; }
  if (v.value === (p.note || '')) return false;
  return commit(v.value ? 'Note saved on ' + q(p.name) : 'Note cleared on ' + q(p.name), function () { p.note = v.value; p.updatedAt = now(); });
}
export function setProjectArchived(id, archived) {
  var p = findProject(id);
  if (!p || !!p.archived === archived) return false;
  return commit((archived ? 'Archived ' : 'Restored ') + q(p.name), function () { p.archived = archived; p.updatedAt = now(); });
}
/* mode: 'tasks' = delete its tasks too, 'loose' = keep them as loose tasks */
export function deleteProject(id, mode) {
  var p = findProject(id);
  if (!p) return false;
  var mine = DB.tasks.filter(function (t) { return t.projectId === id; });
  var msg = !mine.length
    ? 'Deleted project ' + q(p.name)
    : mode === 'tasks'
      ? 'Deleted project ' + q(p.name) + ' and ' + plural(mine.length, 'task')
      : 'Deleted project ' + q(p.name) + '; ' + plural(mine.length, 'task') + ' kept as loose';
  return commit(msg, function () {
    DB.projects = DB.projects.filter(function (x) { return x.id !== id; });
    if (mode === 'tasks') {
      var gone = new Set(mine.map(function (t) { return t.id; }));
      DB.tasks = DB.tasks.filter(function (t) { return !gone.has(t.id); });
      DB.completions = DB.completions.filter(function (c) { return !gone.has(c.taskId); });
    } else {
      mine.forEach(function (t) { t.projectId = null; t.updatedAt = now(); });
    }
  });
}

/* ================= device-local view settings ================= */
export function setView(value) {
  if (value !== 'grouped' && value !== 'flat') return;
  closeTray();
  var ok = setViewFor(ui.page, value);
  render();
  if (!ok) warn('View changed for this session only. Allow site storage to keep it.');
}
export function toggleShowCompleted() {
  var on = !settings.showCompleted;
  var ok = setSetting('showCompleted', on);
  render();
  showToast({
    message: (on ? 'Showing completed tasks' : 'Hiding earlier completed tasks') + (ok ? '' : ' for this session only'),
    tone: ok ? undefined : 'warn',
    actions: [{ label: 'Undo', primary: true, onClick: function () { setSetting('showCompleted', !on); render(); } }]
  });
}

/* ================= editors ================= */
function openEditing(ed) {
  clearActive();
  closeTray();
  ui.editing = ed;
  ui.focusPending = true;
  ui.editorEnter = true;
  render();
}
function activeInput() { return document.querySelector('[data-edit-input]:not([data-edit-input="add-subtask"])'); }
/* keep what has been typed when the form must re-render under it */
function captureText() {
  var el = activeInput();
  if (el && ui.editing && 'text' in ui.editing) ui.editing.text = el.value;
}

export function startAddTask() {
  var area = ui.page === 'all' ? (ui.addArea && AREA_IDS.indexOf(ui.addArea) !== -1 ? ui.addArea : AREA_IDS[0]) : ui.page;
  var pid = ui.addProjectId && (findProject(ui.addProjectId) || {}).area === area ? ui.addProjectId : null;
  openEditing({ type: 'add-task', area: area, projectId: pid, text: '' });
}
export function startAddProject(area) { openEditing({ type: 'add-project', area: area, text: '' }); }
export function startTaskRename(id) {
  if (!findTask(id)) return;
  openEditing({ type: 'task-rename', id: id });
}
export function startTaskNote(id) {
  if (!findTask(id)) return;
  ui.expanded[id] = true;
  openEditing({ type: 'task-note', id: id });
}
export function startProjectRename(id) {
  if (!findProject(id)) return;
  openEditing({ type: 'project-rename', id: id });
}
export function startProjectNote(id) {
  if (!findProject(id)) return;
  openEditing({ type: 'project-note', id: id });
}
export function startSubtaskRename(taskId, subId) { openEditing({ type: 'subtask-rename', id: taskId, subId: subId }); }

/* Open the inline form under a task (tray buttons and the full-swipe Due) */
export function openPanel(type, taskId) {
  var task = findTask(taskId);
  if (!task) return;
  var draft = {};
  var D = ui.selectedDate;
  if (type === 'due') draft = { date: task.due || D };
  else if (type === 'repeat') {
    var r = task.recur;
    draft = {
      kind: r ? r.kind : 'none',
      days: r && r.kind === 'weekdays' ? r.days.slice() : [parseISO(D).getDay()],
      monthDay: r && r.kind === 'monthly' ? r.day : parseISO(D).getDate()
    };
  } else if (type === 'move') draft = { area: task.area, projectId: task.projectId || '' };
  else if (type === 'completion') {
    var c = doneCompletion(task, D, DB.completions);
    if (!c) { showToast({ message: 'Mark it done first, then hold the badge to change the date.' }); return; }
    draft = { date: c.date };
  }
  clearActive();
  closeTray();
  ui.expanded[taskId] = true;
  ui.panel = { type: type, taskId: taskId, draft: draft };
  render();
}

function readPanelDraft() {
  var p = ui.panel;
  if (!p) return null;
  var els = document.querySelectorAll('.task-panel [data-draft]');
  for (var i = 0; i < els.length; i++) {
    var key = els[i].dataset.draft;
    if (key === 'monthDay') p.draft[key] = Number(els[i].value);
    else p.draft[key] = els[i].value;
  }
  return p;
}

function savePanel() {
  var p = readPanelDraft();
  if (!p) return;
  var d = p.draft;
  if ((p.type === 'due' || p.type === 'completion') && !isISODate(d.date)) { warn('Pick a valid date, or use Clear.'); return; }
  if (p.type === 'repeat' && d.kind === 'weekdays' && !d.days.length) { warn('Pick at least one weekday to save.'); return; }
  ui.panel = null;
  var changed = false;
  if (p.type === 'due') changed = setTaskDue(p.taskId, d.date);
  else if (p.type === 'completion') changed = setCompletionDate(p.taskId, d.date);
  else if (p.type === 'move') changed = moveTask(p.taskId, d.area, d.projectId || null);
  else if (p.type === 'repeat') {
    changed = setTaskRecur(p.taskId, d.kind === 'none' ? null
      : d.kind === 'weekdays' ? { kind: 'weekdays', days: d.days } : { kind: 'monthly', day: d.monthDay });
  }
  if (!changed) render(); /* unchanged or rejected (it said why): just close the form */
}

/* Escape / Back / tap-away: drop the open editor or panel without saving.
   Returns true if something was open. */
export function cancelEditing() {
  if (!ui.editing && !ui.panel) return false;
  var els = document.querySelectorAll('[data-edit-input]');
  for (var i = 0; i < els.length; i++) els[i].dataset.committed = '1';
  ui.editing = null;
  ui.panel = null;
  render();
  return true;
}

/* Commit the in-place input `el` (Enter, blur or the Add button). `again` keeps
   the Add form open for the next entry. */
export function commitEditor(el, again) {
  if (!el || el.dataset.committed) return;
  el.dataset.committed = '1';
  var type = el.dataset.editInput;
  var value = el.value;
  var ed = ui.editing;
  var ok;
  function reopen() { /* validation failed: keep the editor and the typed text */
    delete el.dataset.committed;
  }
  switch (type) {
    case 'add-task':
      if (!ed || ed.type !== 'add-task') return;
      if (!value.trim()) {
        if (again) { warn('Type a task name to add it.'); reopen(); return; }
        ui.editing = null; render(); return;
      }
      ui.addArea = ed.area;
      ui.addProjectId = ed.projectId;
      ui.editing = again ? { type: 'add-task', area: ed.area, projectId: ed.projectId, text: '' } : null;
      ui.focusPending = !!again;
      ok = addTask(ed.area, ed.projectId, value);
      if (!ok) { ui.editing = ed; ed.text = value; ui.focusPending = true; reopen(); render(); }
      return;
    case 'add-project':
      if (!ed || ed.type !== 'add-project') return;
      if (!value.trim()) {
        if (again) { warn('Type a project name to add it.'); reopen(); return; }
        ui.editing = null; render(); return;
      }
      ui.editing = again ? { type: 'add-project', area: ed.area, text: '' } : null;
      ui.focusPending = !!again;
      ok = addProject(ed.area, value);
      if (!ok) { ui.editing = ed; ed.text = value; ui.focusPending = true; reopen(); render(); }
      return;
    case 'task-rename':
      ui.editing = null;
      if (!renameTask(ed && ed.id, value)) render();
      return;
    case 'task-note':
      ui.editing = null;
      if (!setTaskNote(ed && ed.id, value)) render();
      return;
    case 'project-rename':
      ui.editing = null;
      if (!renameProject(ed && ed.id, value)) render();
      return;
    case 'project-note':
      ui.editing = null;
      if (!setProjectNote(ed && ed.id, value)) render();
      return;
    case 'subtask-rename':
      ui.editing = null;
      if (!renameSubtask(ed && ed.id, ed && ed.subId, value)) render();
      return;
    case 'add-subtask':
      /* the persistent input in an expanded row: no ui.editing state */
      if (!value.trim()) { if (again) { warn('Type a subtask name to add it.'); } reopen(); return; }
      if (again) ui.focusSubtaskFor = el.dataset.taskId;
      ok = addSubtask(el.dataset.taskId, value);
      if (!ok) { ui.focusSubtaskFor = null; reopen(); }
      return;
    default: break;
  }
}

/* Typing in a limited field: say so the moment the cap is reached (maxlength
   alone would just swallow keystrokes silently). */
export function onLimitedInput(el) {
  var kind = el.dataset.limit;
  if (!kind) return;
  var max = kind === 'note' ? LIMITS.note : LIMITS.name;
  if (el.value.length >= max) {
    if (!el.dataset.limitWarned) { el.dataset.limitWarned = '1'; warn(limitHitMessage(kind)); }
  } else if (el.dataset.limitWarned) {
    delete el.dataset.limitWarned;
  }
}

/* ================= row / project interaction ================= */
function toggleExpand(id) {
  if (ui.expanded[id]) {
    delete ui.expanded[id];
    if (ui.panel && ui.panel.taskId === id) ui.panel = null;
    if (ui.editing && (ui.editing.id === id) && /^(task-note|subtask-rename)$/.test(ui.editing.type)) ui.editing = null;
  } else {
    ui.expanded[id] = true;
  }
  render();
}
function foldProject(id) {
  if (ui.collapsed[id]) delete ui.collapsed[id]; else ui.collapsed[id] = true;
  render();
}

export function openManage() {
  clearActive();
  closeTray();
  ui.sheet = { type: 'manage', area: ui.page, confirmDeleteId: null };
  render();
}

function projectTaskCount(id) { return DB.tasks.filter(function (t) { return t.projectId === id; }).length; }

/* Draft inputs inside the Add form / panels fire `change` (selects, date) */
export function onDraftChange(el) {
  var key = el.dataset.draft;
  if (key === 'add-project' && ui.editing && ui.editing.type === 'add-task') {
    ui.editing.projectId = el.value || null; /* no render: the typed text stays put */
    return;
  }
  var p = ui.panel;
  if (!p) return;
  if (p.type === 'move' && key === 'area') {
    p.draft.area = el.value;
    p.draft.projectId = '';
    render();
    return;
  }
  readPanelDraft();
}

/* data-action dispatcher for everything M2 adds. Returns true if handled. */
export function handleTaskAction(action, ds) {
  switch (action) {
    case 'expand-task': toggleExpand(ds.taskId); return true;
    case 'fold-project': foldProject(ds.projectId); return true;
    case 'set-view': setView(ds.value); return true;
    case 'toggle-completed': toggleShowCompleted(); return true;
    case 'start-add-task': startAddTask(); return true;
    case 'add-pick-area':
      captureText();
      if (ui.editing && ui.editing.type === 'add-task') {
        ui.editing.area = ds.area;
        ui.editing.projectId = null;
        ui.focusPending = true;
        render();
      }
      return true;
    case 'save-add': commitEditor(activeInput(), false); return true;
    case 'cancel-edit': cancelEditing(); return true;
    case 'toggle-done': toggleTaskDone(ds.taskId); return true;
    case 'toggle-subtask': toggleSubtask(ds.taskId, ds.subId); return true;
    case 'delete-subtask': deleteSubtask(ds.taskId, ds.subId); return true;
    case 'rename-subtask': startSubtaskRename(ds.taskId, ds.subId); return true;
    case 'edit-task-note': startTaskNote(ds.taskId); return true;
    case 'set-priority': {
      var p = ui.panel;
      var id = p ? p.taskId : ds.taskId;
      ui.panel = null;
      if (!setTaskPriority(id, ds.value)) render();
      return true;
    }
    case 'save-panel': savePanel(); return true;
    case 'close-panel': cancelEditing(); return true;
    case 'clear-due': {
      var pd = ui.panel;
      var tid = pd ? pd.taskId : null;
      ui.panel = null;
      if (!tid || !setTaskDue(tid, null)) render();
      return true;
    }
    case 'draft-recur-kind':
      if (ui.panel && ui.panel.type === 'repeat') { readPanelDraft(); ui.panel.draft.kind = ds.value; render(); }
      return true;
    case 'draft-toggle-day':
      if (ui.panel && ui.panel.type === 'repeat') {
        readPanelDraft();
        var n = Number(ds.value);
        var days = ui.panel.draft.days;
        var i = days.indexOf(n);
        if (i === -1) days.push(n); else days.splice(i, 1);
        render();
      }
      return true;
    case 'open-manage': openManage(); return true;
    case 'new-project': startAddProject(ds.area); return true;
    case 'rename-project': startProjectRename(ds.projectId); return true;
    case 'note-project': startProjectNote(ds.projectId); return true;
    case 'archive-project': {
      var proj = findProject(ds.projectId);
      if (proj) setProjectArchived(proj.id, !proj.archived);
      return true;
    }
    case 'delete-project':
      if (!projectTaskCount(ds.projectId)) { deleteProject(ds.projectId, 'loose'); return true; }
      if (ui.sheet && ui.sheet.type === 'manage') { clearActive(); ui.sheet.confirmDeleteId = ds.projectId; render(); }
      return true;
    case 'confirm-delete-project':
      if (ui.sheet && ui.sheet.type === 'manage') ui.sheet.confirmDeleteId = null;
      deleteProject(ds.projectId, ds.mode === 'tasks' ? 'tasks' : 'loose');
      return true;
    case 'cancel-delete-project':
      if (ui.sheet && ui.sheet.type === 'manage') { ui.sheet.confirmDeleteId = null; render(); }
      return true;
    default: return false;
  }
}

/* After each render: focus the editor that just opened, once */
export function postRenderFocus() {
  var want = ui.focusPending || ui.focusSubtaskFor;
  if (!want) return;
  var el = document.querySelector('[data-autofocus]');
  ui.focusPending = false;
  ui.focusSubtaskFor = null;
  if (!el) return;
  try {
    el.focus({ preventScroll: false });
    if (el.dataset.selectAll) el.select();
    else if (el.setSelectionRange) { var n = el.value.length; el.setSelectionRange(n, n); }
  } catch (err) { /* detached or unfocusable: harmless */ }
}

/* Tray buttons (swipe-entry.js TRAY_ACTIONS) and the swipe-right action */
export var TASK_TRAY = {
  'task-due': function (id) { openPanel('due', id); },
  'task-priority': function (id) { openPanel('priority', id); },
  'task-repeat': function (id) { openPanel('repeat', id); },
  'task-rename': function (id) { startTaskRename(id); },
  'task-note': function (id) { startTaskNote(id); },
  'task-move': function (id) { openPanel('move', id); },
  'task-delete': function (id) { deleteTask(id); }
};
