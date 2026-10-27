/* Delegated document-level handlers wiring clicks/keys/changes/scroll to
   actions. Every control carries data-action="<name>"; the switch below is the
   one place those names resolve. */

import { ui } from './state.js';
import {
  closeSettings, closeSheet, closeTopLayer, openSettings, render, selectDay, switchPage
} from './shell.js';
import { settleStripScroll } from './day-strip.js';
import { closeTray, consumeSwipeEntryClick, runTrayAction } from './swipe-entry.js';
import { consumeLongPressClick } from './long-press.js';
import { tickLanded, tickNav, tickOff } from './haptics.js';
import { pickReviewCell, toggleReviewBoard, toggleReviewRow } from './review-board.js';
import { commitEditor, handleTaskAction, onDraftChange, onLimitedInput } from './tasks-actions.js';
import { todayISO } from './utils.js';
import {
  changeWeekStart, confirmImport, exportData, onImportFile, toggleHaptics
} from './page-settings.js';

/* The haptic map, applied once here by action name instead of inside every
   handler: navigate = tickNav, commit (save / confirm / add) = tickLanded,
   destructive = tickOff. switch-page buzzes inside switchPage(). */
function actionHaptic(action) {
  if (/^(select-day|nav-today|open-settings|close-settings|review-fold|review-row)$/.test(action)) tickNav();
  else if (/^(remove-|delete-|confirm-delete-|confirm-remove-)/.test(action)) tickOff();
  else if (/^(save-|confirm-|add-|create-|set-|toggle-)/.test(action)) tickLanded();
}

export function onAppClick(e) {
  var target = e.target.closest('[data-action]');
  /* A held-open swipe tray: a tap on the card itself, or anywhere else but the
     tray's own buttons, only closes it (and is not also a select / open). The
     trailing click of the very swipe that opened it is eaten first, or it would
     close the tray the instant it opened. */
  if (ui.trayOpenId && !e.target.closest('.swipe-tray')) {
    if (consumeSwipeEntryClick()) return;
    var wasOnOpenCard = !!e.target.closest('.entry-card.is-tray-open');
    closeTray();
    if (wasOnOpenCard) return;
  }
  if (!target) return;
  /* a click inside a text field / picker (placing the caret, opening a select)
     must not trigger the row or header action that wraps it */
  if (e.target.closest('input, textarea, select')) return;
  /* the trailing click of a fired long-press must not also do the tap thing */
  if (consumeLongPressClick()) return;
  var action = target.dataset.action;
  actionHaptic(action);
  switch (action) {
    case 'switch-page': switchPage(target.dataset.page); break;
    case 'select-day': selectDay(target.dataset.date); break;
    case 'nav-today': selectDay(todayISO()); break;
    case 'review-fold': toggleReviewBoard(); render(); break;
    case 'review-row': toggleReviewRow(target.dataset.key); render(); break;
    case 'review-cell': pickReviewCell(target.dataset.date); render(); break;
    case 'open-settings': openSettings(); break;
    case 'close-settings': closeSettings(); break;
    case 'close-sheet': closeSheet(); break;
    case 'set-week-start': changeWeekStart(target.dataset.value); break;
    case 'toggle-haptics': toggleHaptics(); break;
    case 'export-data': exportData(); break;
    case 'confirm-import': confirmImport(); break;
    case 'tray-action': runTrayAction(target.dataset.tray, target.dataset.id); break;
    default: handleTaskAction(action, target.dataset); break;
  }
}

export function onKeyDown(e) {
  var field = e.target && e.target.closest ? e.target.closest('[data-edit-input]') : null;
  if (field && e.key === 'Enter' && !e.isComposing) {
    /* Enter commits a one-line field (Add forms stay open for the next entry);
       in a note, Enter is a newline and Ctrl/Cmd+Enter commits */
    var multi = field.tagName === 'TEXTAREA';
    if (!multi || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      commitEditor(field, /^(add-task|add-project|add-subtask)$/.test(field.dataset.editInput));
    }
    return;
  }
  if (e.key === 'Escape' && field && field.dataset.editInput === 'add-subtask') {
    field.dataset.committed = '1'; /* abandon what was typed; no toast needed, nothing was saved */
    field.value = '';
    field.blur();
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') {
    if (closeTopLayer()) e.preventDefault();
    return;
  }
  /* role="button" divs (the day cells) activate like buttons */
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-action]')) {
    e.preventDefault();
    e.target.click();
  }
}

/* Leaving an in-place field commits it (Enter does too). Moving focus to
   another control of the same form (the project picker, the Add button) does
   not: the form is not finished yet. */
export function onFocusOut(e) {
  var el = e.target;
  if (!el || !el.matches || !el.matches('[data-edit-input]') || !el.isConnected) return;
  var scope = el.closest('[data-edit-scope]');
  if (scope && e.relatedTarget && scope.contains(e.relatedTarget)) return;
  commitEditor(el, false);
}
export function onAppInput(e) {
  if (e.target && e.target.dataset && e.target.dataset.limit) onLimitedInput(e.target);
}

export function onAppChange(e) {
  var t = e.target;
  if (t && t.dataset && t.dataset.draft) { onDraftChange(t); return; }
  if (t && t.id === 'import-file') {
    var file = t.files && t.files[0];
    t.value = ''; /* picking the same file again must fire again */
    onImportFile(file);
  }
}

/* scroll doesn't bubble; capture phase on document still sees it. The strip
   settles 120ms after the last scroll event, then pages a week if needed. */
var stripScrollTimer = null;
export function onAppScroll(e) {
  var el = e.target;
  if (!el || !el.classList || !el.classList.contains('day-strip')) return;
  if (stripScrollTimer) clearTimeout(stripScrollTimer);
  stripScrollTimer = setTimeout(function () {
    if (settleStripScroll(el)) render();
  }, 120);
}
