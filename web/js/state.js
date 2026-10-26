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
  /* null | { type:'import', fileName, counts, data } -- shown in the bottom sheet */
  sheet: null
};

/* One active thing at a time. Every "this row is open or being edited" flag
   lives here; opening any of them calls this first so the previous one closes.
   M1 only has the swipe tray; M2 adds the editors. Page-level containers
   (sheet, settings view) are deliberately NOT cleared. */
export function clearActive() {
  ui.trayOpenId = null;
}
