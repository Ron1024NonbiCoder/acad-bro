/* Task list rendering (M2): toolbar, Add form, Grouped / Flat views, task rows
   with their swipe tray and expanded body, inline panels, and the Manage
   sheet. Pure string builders over DB + ui + settings; every interaction is a
   data-action resolved in events.js -> tasks-actions.js.

   Swipe target markup (see swipe-entry.js): .entry-card.has-tray > .task-row
   (the drag surface), .swipe-reveal, .swipe-tray. The expanded body sits in the
   same card but outside .task-row, so dragging inside it never swipes. */

import { ui, AREA_IDS } from './state.js';
import { DB } from './storage.js';
import { settings, viewFor, weekStartDow } from './settings.js';
import { escapeHtml, parseISO, MONTH_SHORT, WEEKDAY_SHORT, todayISO } from './utils.js';
import { trayWidth } from './swipe-entry.js';
import {
  LIMITS, PRIORITY_MARKS, PRIORITY_NAMES, activeDays, describeRecur, doneCompletion, indexCompletions,
  isDone, isOverdue, isRelevant, isSubtaskDone, sortByOrder, sortFlat, subtaskProgress
} from './tasks-core.js';

function areaName(id) { return DB.areaLabels[id] || id; }
function prettyDate(iso) { var d = parseISO(iso); return MONTH_SHORT[d.getMonth()] + ' ' + d.getDate(); }
function dueLabel(iso) {
  var t = todayISO();
  if (iso === t) return 'Today';
  var d = parseISO(t);
  d.setDate(d.getDate() + 1);
  if (iso === d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')) return 'Tomorrow';
  return prettyDate(iso);
}

/* ================= icons (tray buttons) ================= */
function svg(inner) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
}
var ICONS = {
  due: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  priority: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  repeat: svg('<path d="M17 2l3 3-3 3M20 5H8a4 4 0 0 0-4 4v1M7 22l-3-3 3-3M4 19h12a4 4 0 0 0 4-4v-1"/>'),
  rename: svg('<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>'),
  note: svg('<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6"/>'),
  move: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11v5M9.5 13.5L12 11l2.5 2.5"/>'),
  del: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>')
};
var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

/* Seven buttons: fixed order, nearest the card first. A full swipe fires the first (Due). */
var TRAY_BUTTONS = [
  ['task-due', 'Due', ICONS.due],
  ['task-priority', 'Prio', ICONS.priority],
  ['task-repeat', 'Repeat', ICONS.repeat],
  ['task-rename', 'Rename', ICONS.rename],
  ['task-note', 'Note', ICONS.note],
  ['task-move', 'Move', ICONS.move],
  ['task-delete', 'Delete', ICONS.del]
];

/* ================= render context ================= */
function makeCtx() {
  var projects = new Map();
  DB.projects.forEach(function (p) { projects.set(p.id, p); });
  return {
    iso: ui.selectedDate,
    comps: indexCompletions(DB.completions),
    showCompleted: settings.showCompleted,
    projects: projects
  };
}
/* the task's project if it still exists, else null (loose) */
function projectOf(t, cx) { return t.projectId ? (cx.projects.get(t.projectId) || null) : null; }
function visibleInArea(area, cx) {
  return DB.tasks.filter(function (t) {
    if (t.area !== area) return false;
    var p = projectOf(t, cx);
    if (p && p.archived) return false;
    return isRelevant(t, cx.iso, cx.comps, cx.showCompleted);
  });
}
/* not-done first, then creation order */
function groupOrder(list, cx) {
  var base = sortByOrder(list);
  var open = base.filter(function (t) { return !isDone(t, cx.iso, cx.comps); });
  var done = base.filter(function (t) { return isDone(t, cx.iso, cx.comps); });
  return open.concat(done);
}

/* ================= pieces ================= */
/* An editor on the render that opened it (ui.editorEnter, set by openEditing)
   is wrapped once so it expands + fades in (styles.css .ed-enter) instead of
   cutting in; every later render emits it bare. */
function enterWrap(html, cls) {
  return ui.editorEnter ? '<div class="ed-enter' + (cls ? ' ' + cls : '') + '"><div class="ed-enter-inner">' + html + '</div></div>' : html;
}
function nameInput(type, value, placeholder, extra) {
  return '<input type="text" class="name-input" data-edit-input="' + type + '" data-limit="name" maxlength="' + LIMITS.name + '"'
    + ' value="' + escapeHtml(value) + '" placeholder="' + escapeHtml(placeholder) + '" aria-label="' + escapeHtml(placeholder) + '"'
    + ' autocomplete="off" autocapitalize="sentences" enterkeyhint="done" data-autofocus="1"' + (extra || '') + '>';
}
function noteArea(type, value, label) {
  return '<textarea class="note-input" data-edit-input="' + type + '" data-limit="note" maxlength="' + LIMITS.note + '" rows="3"'
    + ' placeholder="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '" data-autofocus="1">' + escapeHtml(value) + '</textarea>'
    + '<div class="editor-hint">Saves when you tap away. Esc cancels.</div>';
}

function toolbarHtml() {
  var view = viewFor(ui.page);
  var seg = [['grouped', 'Grouped'], ['flat', 'Flat']].map(function (v) {
    return '<button type="button" class="segmented-btn' + (view === v[0] ? ' is-on' : '') + '" data-action="set-view" data-value="' + v[0]
      + '" aria-pressed="' + (view === v[0]) + '">' + v[1] + '</button>';
  }).join('');
  return '<div class="list-toolbar">'
    + '<div class="segmented" role="group" aria-label="List view">' + seg + '</div>'
    + '<button type="button" class="chip-btn' + (settings.showCompleted ? ' is-on' : '') + '" data-action="toggle-completed" aria-pressed="' + settings.showCompleted + '">Show completed</button>'
    + '<button type="button" class="text-btn" data-action="open-manage">Manage</button>'
    + '</div>';
}

function activeProjects(area) {
  return sortByOrder(DB.projects.filter(function (p) { return p.area === area && !p.archived; }));
}

function addRowHtml() {
  var ed = ui.editing;
  if (!ed || ed.type !== 'add-task') {
    return '<div class="add-row"><button type="button" class="btn primary add-btn" data-action="start-add-task">+ Add</button></div>';
  }
  var areaChips = '';
  if (ui.page === 'all') {
    areaChips = '<div class="chip-row" role="group" aria-label="Area">' + AREA_IDS.map(function (a) {
      return '<button type="button" class="chip-btn area-chip area-' + a + (ed.area === a ? ' is-on' : '') + '" data-action="add-pick-area" data-area="' + a
        + '" aria-pressed="' + (ed.area === a) + '">' + escapeHtml(areaName(a)) + '</button>';
    }).join('') + '</div>';
  }
  var opts = '<option value="">No project</option>' + activeProjects(ed.area).map(function (p) {
    return '<option value="' + escapeHtml(p.id) + '"' + (ed.projectId === p.id ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>';
  }).join('');
  return enterWrap('<div class="add-row add-form" data-edit-scope="add">'
    + nameInput('add-task', ed.text || '', 'New task in ' + areaName(ed.area))
    + areaChips
    + '<div class="add-opts"><select data-draft="add-project" aria-label="Project (optional)">' + opts + '</select>'
    + '<button type="button" class="btn primary" data-action="save-add">Add</button>'
    + '<button type="button" class="btn" data-action="cancel-edit">Cancel</button></div>'
    + '</div>', 'from-add');
}

/* ================= task row ================= */
function chipsHtml(t, cx, showProject) {
  var out = [];
  var pr = t.priority || 0;
  if (pr > 0) out.push('<span class="chip prio prio-' + pr + '" title="' + PRIORITY_NAMES[pr] + ' priority">' + PRIORITY_MARKS[pr] + '</span>');
  if (t.recur) out.push('<span class="chip recur">↻ ' + escapeHtml(describeRecur(t.recur)) + '</span>');
  else if (t.due) {
    var od = isOverdue(t, cx.iso, cx.comps);
    out.push('<span class="chip due' + (od ? ' overdue' : '') + '">' + (od ? 'Overdue ' : 'Due ') + escapeHtml(dueLabel(t.due)) + '</span>');
  }
  var sp = subtaskProgress(t, cx.iso, cx.comps);
  if (sp.total) out.push('<span class="chip">' + sp.done + '/' + sp.total + ' subtasks</span>');
  if (t.note) out.push('<span class="chip">Note</span>');
  var dc = doneCompletion(t, cx.iso, cx.comps);
  if (dc && dc.date !== cx.iso) out.push('<span class="chip">Done ' + escapeHtml(prettyDate(dc.date)) + '</span>');
  var p = projectOf(t, cx);
  if (showProject && p) out.push('<span class="chip proj">' + escapeHtml(p.name) + '</span>');
  return out.length ? '<div class="entry-sub chips">' + out.join('') + '</div>' : '';
}

function panelHtml(t, cx) {
  var p = ui.panel;
  if (!p || p.taskId !== t.id) return '';
  var d = p.draft;
  var body = '';
  var title = '';
  if (p.type === 'due') {
    title = 'Due date';
    body = '<input type="date" data-draft="date" value="' + escapeHtml(d.date || '') + '" aria-label="Due date">'
      + (t.recur ? '<div class="editor-hint">A due date replaces the repeat.</div>' : '')
      + '<div class="editor-actions">'
      + '<button type="button" class="btn primary" data-action="save-panel">Save</button>'
      + (t.due ? '<button type="button" class="btn" data-action="clear-due">Clear</button>' : '')
      + '<button type="button" class="btn" data-action="close-panel">Cancel</button></div>';
  } else if (p.type === 'completion') {
    title = 'Done on';
    body = '<input type="date" data-draft="date" value="' + escapeHtml(d.date || '') + '" aria-label="Completion date">'
      + '<div class="editor-actions">'
      + '<button type="button" class="btn primary" data-action="save-panel">Save</button>'
      + '<button type="button" class="btn" data-action="close-panel">Cancel</button></div>';
  } else if (p.type === 'priority') {
    title = 'Priority';
    body = '<div class="chip-row">' + [0, 1, 2, 3].map(function (n) {
      return '<button type="button" class="chip-btn prio-btn prio-' + n + ((t.priority || 0) === n ? ' is-on' : '') + '" data-action="set-priority" data-value="' + n
        + '" aria-pressed="' + ((t.priority || 0) === n) + '">' + (n ? PRIORITY_MARKS[n] + ' ' : '') + PRIORITY_NAMES[n] + '</button>';
    }).join('') + '</div>'
      + '<div class="editor-actions"><button type="button" class="btn" data-action="close-panel">Cancel</button></div>';
  } else if (p.type === 'repeat') {
    title = 'Repeat';
    var kinds = [['none', 'None'], ['weekdays', 'Weekdays'], ['monthly', 'Monthly']];
    body = '<div class="segmented" role="group" aria-label="Repeat kind">' + kinds.map(function (k) {
      return '<button type="button" class="segmented-btn' + (d.kind === k[0] ? ' is-on' : '') + '" data-action="draft-recur-kind" data-value="' + k[0]
        + '" aria-pressed="' + (d.kind === k[0]) + '">' + k[1] + '</button>';
    }).join('') + '</div>';
    if (d.kind === 'weekdays') {
      var start = weekStartDow();
      var chips = '';
      for (var i = 0; i < 7; i++) {
        var dow = (start + i) % 7;
        var on = d.days.indexOf(dow) !== -1;
        chips += '<button type="button" class="chip-btn day-chip' + (on ? ' is-on' : '') + '" data-action="draft-toggle-day" data-value="' + dow
          + '" aria-pressed="' + on + '" aria-label="' + WEEKDAY_SHORT[dow] + '">' + WEEKDAY_SHORT[dow] + '</button>';
      }
      body += '<div class="chip-row">' + chips + '</div>';
    } else if (d.kind === 'monthly') {
      var days = '';
      for (var n = 1; n <= 31; n++) days += '<option value="' + n + '"' + (d.monthDay === n ? ' selected' : '') + '>' + n + '</option>';
      body += '<label class="field-row">Day of month <select data-draft="monthDay" aria-label="Day of month">' + days + '</select></label>'
        + (d.monthDay > 28 ? '<div class="editor-hint">In shorter months it falls on the last day.</div>' : '');
    }
    body += '<div class="editor-actions"><button type="button" class="btn primary" data-action="save-panel">Save</button>'
      + '<button type="button" class="btn" data-action="close-panel">Cancel</button></div>';
  } else if (p.type === 'move') {
    title = 'Move to';
    var areas = AREA_IDS.map(function (a) {
      return '<option value="' + a + '"' + (d.area === a ? ' selected' : '') + '>' + escapeHtml(areaName(a)) + '</option>';
    }).join('');
    var projs = '<option value="">No project</option>' + activeProjects(d.area).map(function (pr) {
      return '<option value="' + escapeHtml(pr.id) + '"' + (d.projectId === pr.id ? ' selected' : '') + '>' + escapeHtml(pr.name) + '</option>';
    }).join('');
    body = '<div class="field-grid"><label class="field-row">Area <select data-draft="area" aria-label="Area">' + areas + '</select></label>'
      + '<label class="field-row">Project <select data-draft="projectId" aria-label="Project">' + projs + '</select></label></div>'
      + '<div class="editor-actions"><button type="button" class="btn primary" data-action="save-panel">Save</button>'
      + '<button type="button" class="btn" data-action="close-panel">Cancel</button></div>';
  }
  return '<div class="task-panel" data-edit-scope="panel"><div class="panel-title">' + title + '</div>' + body + '</div>';
}

function expandedHtml(t, cx) {
  var ed = ui.editing;
  var parts = [panelHtml(t, cx)];
  if (ed && ed.type === 'task-note' && ed.id === t.id) {
    parts.push(enterWrap('<div class="task-note-edit">' + noteArea('task-note', t.note || '', 'Note') + '</div>'));
  } else if (t.note) {
    parts.push('<p class="task-note" data-action="edit-task-note" data-task-id="' + escapeHtml(t.id) + '" title="Edit note">' + escapeHtml(t.note) + '</p>');
  }
  var subs = (t.subtasks || []).map(function (s) {
    var done = isSubtaskDone(t, s.id, cx.iso, cx.comps);
    var renaming = ed && ed.type === 'subtask-rename' && ed.id === t.id && ed.subId === s.id;
    return '<li class="subtask-row' + (done ? ' is-done' : '') + '">'
      + '<button type="button" class="sub-check' + (done ? ' completed' : '') + '" data-action="toggle-subtask" data-task-id="' + escapeHtml(t.id)
      + '" data-sub-id="' + escapeHtml(s.id) + '" role="checkbox" aria-checked="' + done + '" aria-label="' + escapeHtml(s.title) + '">' + (done ? CHECK : '') + '</button>'
      + (renaming
        ? nameInput('subtask-rename', s.title, 'Subtask name', ' data-select-all="1"')
        : '<span class="sub-title" data-action="rename-subtask" data-task-id="' + escapeHtml(t.id) + '" data-sub-id="' + escapeHtml(s.id) + '">' + escapeHtml(s.title) + '</span>')
      + '<button type="button" class="sub-del" data-action="delete-subtask" data-task-id="' + escapeHtml(t.id) + '" data-sub-id="' + escapeHtml(s.id)
      + '" aria-label="Delete subtask ' + escapeHtml(s.title) + '">&#10005;</button></li>';
  }).join('');
  parts.push('<ul class="subtask-list">' + subs + '</ul>');
  var full = (t.subtasks || []).length >= LIMITS.subtasks;
  parts.push('<input type="text" class="name-input sub-add" data-edit-input="add-subtask" data-task-id="' + escapeHtml(t.id) + '" data-limit="name" maxlength="' + LIMITS.name
    + '" placeholder="' + (full ? 'Subtask limit reached (' + LIMITS.subtasks + ')' : 'Add a subtask') + '" aria-label="Add a subtask" autocomplete="off" enterkeyhint="done"'
    + (full ? ' disabled' : '') + (ui.focusSubtaskFor === t.id ? ' data-autofocus="1"' : '') + '>');
  var done = isDone(t, cx.iso, cx.comps);
  parts.push('<div class="task-body-actions"><button type="button" class="btn" data-action="toggle-done" data-task-id="' + escapeHtml(t.id) + '">'
    + (done ? 'Mark not done' : 'Mark done') + '</button>'
    + (t.note || (ed && ed.type === 'task-note') ? '' : '<button type="button" class="btn" data-action="edit-task-note" data-task-id="' + escapeHtml(t.id) + '">Add note</button>')
    + '</div>');
  return '<div class="task-body">' + parts.join('') + '</div>';
}

function taskCardHtml(t, cx, showProject) {
  var id = t.id;
  var done = isDone(t, cx.iso, cx.comps);
  var open = ui.trayOpenId === id;
  var expanded = !!ui.expanded[id];
  var renaming = ui.editing && ui.editing.type === 'task-rename' && ui.editing.id === id;
  var od = isOverdue(t, cx.iso, cx.comps);
  var cls = 'entry-card has-tray tray-' + TRAY_BUTTONS.length + ' task-card' + (open ? ' is-tray-open' : '') + (done ? ' is-done' : '')
    + (expanded ? ' is-expanded' : '') + (od ? ' is-overdue' : '') + ((t.priority || 0) === 3 && !done ? ' is-high' : '');
  var eid = escapeHtml(id);
  var title = renaming
    ? nameInput('task-rename', t.title, 'Task name', ' data-select-all="1"')
    : '<div class="entry-title task-title" data-edit-action="task-rename" data-entry-id="' + eid + '">' + escapeHtml(t.title) + '</div>';
  var tray = TRAY_BUTTONS.map(function (b) {
    return '<button type="button" class="tray-btn' + (b[0] === 'task-delete' ? ' danger' : '') + '" data-action="tray-action" data-tray="' + b[0] + '" data-id="' + eid
      + '" aria-label="' + b[1] + '">' + b[2] + '<span>' + b[1] + '</span></button>';
  }).join('');
  return '<div class="' + cls + '" data-task-card="' + eid + '">'
    + '<div class="entry-row task-row" data-entry-id="' + eid + '">'
    + '<span class="entry-toggle habit' + (done ? ' completed' : '') + '" data-action="expand-task" data-task-id="' + eid + '"'
    + (done ? ' data-edit-action="completion-date" data-entry-id="' + eid + '" title="Hold to change the done date"' : '')
    + ' aria-hidden="true">' + (done ? CHECK : '') + '</span>'
    + '<div class="entry-main"' + (renaming ? '' : ' data-action="expand-task" data-task-id="' + eid + '"') + '>'
    + title + chipsHtml(t, cx, showProject) + '</div></div>'
    + '<div class="swipe-reveal reveal-right" aria-hidden="true">' + CHECK + '</div>'
    + '<div class="swipe-tray" data-n="' + TRAY_BUTTONS.length + '" style="--tray-w:' + trayWidth(TRAY_BUTTONS.length) + 'px">' + tray + '</div>'
    + (expanded ? expandedHtml(t, cx) : '')
    + '</div>';
}

/* ================= views ================= */
function projectDots(p, cx) {
  var days = activeDays(p.id, DB.tasks, DB.completions, cx.iso, 7);
  return '<span class="pdots" role="img" aria-label="Activity, last 7 days">' + days.map(function (d) {
    var label = prettyDate(d.date) + ': ' + (d.count ? d.count + (d.count === 1 ? ' task' : ' tasks') + ' done' : 'no activity');
    return '<i class="pdot' + (d.active ? ' on' : '') + '" title="' + escapeHtml(label) + '"></i>';
  }).join('') + '</span>';
}

function projectCardHtml(p, tasks, cx) {
  var folded = !!ui.collapsed[p.id];
  var renaming = ui.editing && ui.editing.type === 'project-rename' && ui.editing.id === p.id;
  var doneN = tasks.filter(function (t) { return isDone(t, cx.iso, cx.comps); }).length;
  var pid = escapeHtml(p.id);
  var head = '<header class="project-head" data-edit-action="project-rename" data-project-id="' + pid + '"'
    + (renaming ? '' : ' data-action="fold-project"') + ' role="button" tabindex="0" aria-expanded="' + !folded + '">'
    + '<span class="chev' + (folded ? ' is-folded' : '') + '" aria-hidden="true">&#9662;</span>'
    + (renaming ? nameInput('project-rename', p.name, 'Project name', ' data-select-all="1"') : '<span class="project-name">' + escapeHtml(p.name) + '</span>')
    + '<span class="project-count">' + doneN + '/' + tasks.length + '</span>'
    + projectDots(p, cx)
    + '</header>';
  var body = '';
  if (!folded) {
    body = (p.note ? '<p class="project-note">' + escapeHtml(p.note) + '</p>' : '')
      + (tasks.length
        ? '<div class="entry-list">' + groupOrder(tasks, cx).map(function (t) { return taskCardHtml(t, cx, false); }).join('') + '</div>'
        : '<p class="empty-sub">No tasks for this day</p>');
  }
  return '<section class="project-card' + (folded ? ' is-folded' : '') + '" data-project-card="' + pid + '">' + head + body + '</section>';
}

function groupedHtml(area, tasks, cx) {
  var loose = tasks.filter(function (t) { return !projectOf(t, cx); });
  var html = loose.length ? '<div class="entry-list loose-list">' + groupOrder(loose, cx).map(function (t) { return taskCardHtml(t, cx, false); }).join('') + '</div>' : '';
  activeProjects(area).forEach(function (p) {
    html += projectCardHtml(p, tasks.filter(function (t) { return t.projectId === p.id; }), cx);
  });
  return html;
}
function flatHtml(tasks, cx) {
  return '<div class="entry-list">' + sortFlat(tasks, cx.iso, cx.comps).map(function (t) { return taskCardHtml(t, cx, true); }).join('') + '</div>';
}

function areaCardHtml(area, cx) {
  var tasks = visibleInArea(area, cx);
  var hasProjects = activeProjects(area).length > 0;
  var body;
  if (!tasks.length && !(viewFor(ui.page) === 'grouped' && hasProjects)) {
    body = '<p class="empty-state">' + (DB.tasks.some(function (t) { return t.area === area; }) ? 'Nothing for this day' : 'No tasks yet') + '</p>';
  } else {
    body = viewFor(ui.page) === 'flat' ? flatHtml(tasks, cx) : groupedHtml(area, tasks, cx);
  }
  return '<section class="area-card day-card area-' + area + '" aria-label="' + escapeHtml(areaName(area)) + '">'
    + '<header class="area-card-head"><span class="area-dot" aria-hidden="true"></span><h3>' + escapeHtml(areaName(area)) + '</h3></header>'
    + body + '</section>';
}

/* The whole main view under the day heading */
export function renderTaskArea() {
  var cx = makeCtx();
  var ids = ui.page === 'all' ? AREA_IDS : [ui.page];
  return toolbarHtml() + addRowHtml() + ids.map(function (a) { return areaCardHtml(a, cx); }).join('');
}

/* ================= Manage sheet ================= */
function manageRowHtml(p) {
  var ed = ui.editing;
  var sheet = ui.sheet;
  var pid = escapeHtml(p.id);
  var n = DB.tasks.filter(function (t) { return t.projectId === p.id; }).length;
  var renaming = ed && ed.type === 'project-rename' && ed.id === p.id;
  var noting = ed && ed.type === 'project-note' && ed.id === p.id;
  var confirming = sheet && sheet.confirmDeleteId === p.id;
  var meta = n + (n === 1 ? ' task' : ' tasks') + (p.archived ? ' · Archived' : '') + (p.note && !noting ? ' · has note' : '');
  var actions = [
    ['rename-project', 'Rename'], ['note-project', 'Note'], ['archive-project', p.archived ? 'Restore' : 'Archive'], ['delete-project', 'Delete']
  ].map(function (a) {
    return '<button type="button" class="text-btn' + (a[0] === 'delete-project' ? ' danger-text' : '') + '" data-action="' + a[0] + '" data-project-id="' + pid + '">' + a[1] + '</button>';
  }).join('');
  var confirm = '';
  if (confirming) {
    confirm = '<div class="confirm-box" role="alertdialog" aria-label="Delete project">'
      + '<p>' + escapeHtml(p.name) + ' has ' + n + (n === 1 ? ' task' : ' tasks') + '. What should happen to them?</p>'
      + '<div class="editor-actions">'
      + '<button type="button" class="btn danger" data-action="confirm-delete-project" data-mode="tasks" data-project-id="' + pid + '">Delete tasks too</button>'
      + '<button type="button" class="btn" data-action="confirm-delete-project" data-mode="loose" data-project-id="' + pid + '">Keep as loose tasks</button>'
      + '<button type="button" class="btn" data-action="cancel-delete-project" data-project-id="' + pid + '">Cancel</button></div></div>';
  }
  return '<div class="manage-row' + (p.archived ? ' is-archived' : '') + '" data-project-row="' + pid + '">'
    + '<div class="manage-top"><div class="manage-main">'
    + (renaming ? nameInput('project-rename', p.name, 'Project name', ' data-select-all="1"') : '<div class="manage-name">' + escapeHtml(p.name) + '</div>')
    + '<div class="manage-meta">' + escapeHtml(meta) + '</div></div></div>'
    + (noting ? enterWrap('<div class="manage-note-edit">' + noteArea('project-note', p.note || '', 'Project note') + '</div>') : '')
    + '<div class="manage-actions">' + actions + '</div>'
    + confirm + '</div>';
}

export function manageSheetHtml(sheet) {
  var areas = sheet.area === 'all' ? AREA_IDS : [sheet.area];
  var ed = ui.editing;
  return areas.map(function (a) {
    var list = sortByOrder(DB.projects.filter(function (p) { return p.area === a; }));
    var adding = ed && ed.type === 'add-project' && ed.area === a;
    return '<div class="manage-area area-' + a + '"><div class="settings-group-label">' + escapeHtml(areaName(a)) + '</div>'
      + (list.length ? list.map(manageRowHtml).join('') : '<p class="empty-sub">No projects yet</p>')
      + (adding
        ? enterWrap('<div class="add-form" data-edit-scope="project">' + nameInput('add-project', ed.text || '', 'New project in ' + areaName(a))
          + '<div class="add-opts"><button type="button" class="btn primary" data-action="save-add">Add</button>'
          + '<button type="button" class="btn" data-action="cancel-edit">Cancel</button></div></div>')
        : '<button type="button" class="btn add-project-btn" data-action="new-project" data-area="' + a + '">+ New project</button>')
      + '</div>';
  }).join('');
}
