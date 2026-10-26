/* Long-press detection, layered on top of elements that already respond to a
   normal click. A short tap still reaches onAppClick as an ordinary click; a
   held press fires the handler registered here instead.

   The trailing click after a held press is suppressed via a short time-window
   flag rather than preventDefault() on the pointer events (cancelling
   pointerdown would also swallow the click on touch devices).

   App-wide rule (carried over from GymBro): HOLD EDITS. Any element carrying
   `data-edit-action="<name>"` is long-pressable and opens the editor of that
   name; EDIT_ACTIONS below is the only place those names resolve. Checkable
   rows use the swipe gesture instead (swipe-entry.js). */

import { tick } from './haptics.js';
import { openPanel, startProjectRename, startTaskRename } from './tasks-actions.js';

var LONG_PRESS_MS = 550;
var MOVE_THRESHOLD = 10; /* px of travel before a hold no longer counts as a press */
var SUPPRESS_CLICK_MS = 400; /* trailing click after a fired long-press, ignored within this window */

/* data-edit-action value -> the editor it opens, given the pressed element.
   Hold a task title = rename; hold a done badge = change its done date
   (backfill fix); hold a project header = rename it. */
var EDIT_ACTIONS = {
  'task-rename': function (el) { startTaskRename(el.dataset.entryId); },
  'completion-date': function (el) { openPanel('completion', el.dataset.entryId); },
  'project-rename': function (el) { startProjectRename(el.dataset.projectId); }
};

var press = null;
var suppressClickAt = 0;

function clearPress() {
  if (press) clearTimeout(press.timer);
  press = null;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
}

function onMove(e) {
  if (!press || e.pointerId !== press.pointerId) return;
  var dx = e.clientX - press.startX;
  var dy = e.clientY - press.startY;
  if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) clearPress();
}

function onUp(e) {
  if (!press || e.pointerId !== press.pointerId) return;
  clearPress();
}

export function onLongPressPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  if (!e.target.closest) return;
  if (e.target.closest('input, textarea, select')) return; /* holding inside a field selects text */
  var target = e.target.closest('[data-edit-action]');
  if (!target) return;
  clearPress();
  press = {
    pointerId: e.pointerId,
    target: target,
    startX: e.clientX,
    startY: e.clientY,
    timer: setTimeout(function () {
      press = null;
      suppressClickAt = Date.now();
      /* the buzz is the only feedback that the hold "took" on a phone */
      tick();
      var fn = EDIT_ACTIONS[target.dataset.editAction];
      if (fn) fn(target);
    }, LONG_PRESS_MS)
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/* True if this click is the trailing click of a press that already fired, so
   the caller should skip its normal behaviour for it. */
export function consumeLongPressClick() {
  if (suppressClickAt && Date.now() - suppressClickAt < SUPPRESS_CLICK_MS) {
    suppressClickAt = 0;
    return true;
  }
  return false;
}
