/* Mutable UI state (current page, selected day, open editors/sheet). Never
   reassigned: import { ui } and mutate it. */

import { todayISO } from './utils.js';

/* Page order: the top tabs, the phone bottom bar and body.page-* all read this.
   Labels for the three areas come from DB.areaLabels (renamable); 'all' is a
   combined view, not an area. */
export var AREA_IDS = ['living', 'prod', 'hobby'];
export var PAGE_IDS = ['all'].concat(AREA_IDS);

export var ui = {
  page: 'all', /* 'all' | 'living' | 'prod' | 'hobby' */
  view: 'main', /* 'main' | 'settings' */
  selectedDate: todayISO(), /* local ISO; any day, past included (backfill) */
  trayOpenId: null, /* the row whose swipe-left action tray is held open (swipe-entry.js) */
  /* null | { type:'import', fileName, counts, data }
          | { type:'manage', area:'all'|area, confirmDeleteId? } -- shown in the bottom sheet */
  sheet: null,

  /* ---- M2: tasks & projects (tasks-actions.js owns the transitions) ---- */
  expanded: {},   /* taskId -> true: rows tapped open (subtasks, note, panels) */
  collapsed: {},  /* projectId -> true: grouped-view project cards folded shut */
  /* The one in-place text editor: null | { type, ... } with type one of
     add-task {area, projectId, text} | add-project {area} | task-rename {id}
     | task-note {id} | project-rename {id} | project-note {id}
     | subtask-rename {id: taskId, subId} */
  editing: null,
  /* The one inline form under an expanded row: null | { type:'due'|'repeat'|'move'
     |'priority'|'completion', taskId, draft } */
  panel: null,
  addArea: null,        /* last area chosen in the Add form on the All page */
  addProjectId: null,   /* last project chosen in the Add form */
  focusPending: false,  /* render() focuses [data-autofocus] once, then clears this */
  focusSubtaskFor: null /* taskId whose add-subtask input should regain focus */
};

/* One active thing at a time. Every "this row is open or being edited" flag
   lives here; opening any of them calls this first so the previous one closes.
   Page-level containers (sheet, settings view) are deliberately NOT cleared. */
export function clearActive() {
  ui.trayOpenId = null;
  ui.editing = null;
  ui.panel = null;
}
