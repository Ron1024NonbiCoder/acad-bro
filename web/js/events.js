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
import { foldReviewBoard, pickReviewCell, toggleReviewRow } from './review-board.js';
import {
  askAnswer, chooseVersion, confirmDiscardRecovery, confirmRestore, exportRecoveryCopy, logOut, openLogin,
  openRelogin, openRestore, reloadAppClicked, retrySignInService, setDiscardConfirm, submitLogin, syncNowClicked
} from './page-account.js';
import { commitEditor, handleTaskAction, onDraftChange, onLimitedInput } from './tasks-actions.js';
import { todayISO } from './utils.js';
import {
  applyUpdateClicked, changeWeekStart, checkUpdateClicked, confirmImport, exportData, onImportFile, toggleHaptics
} from './page-settings.js';

/* The haptic map, applied once here by action name instead of inside every
   handler: navigate = tickNav, commit (save / confirm / add) = tickLanded,
   destructive = tickOff. switch-page buzzes inside switchPage(). */
function actionHaptic(action) {
  if (/^(select-day|nav-today|open-settings|close-settings|review-fold|review-row)$/.test(action)) tickNav();
  else if (/^(remove-|delete-|confirm-delete-|confirm-remove-|log-out$|discard-|confirm-discard-|ask-replace$)/.test(action)) tickOff();
  else if (/^(save-|confirm-|add-|create-|set-|toggle-|submit-|conflict-keep-)/.test(action)) tickLanded();
}

/* ---- tap while an editor is open ----
   Pressing a button while a rename / note / add field has focus blurs the field;
   the blur commits and render() replaces #app-root, so the pressed button is
   detached before its click fires and the tap is lost. relatedTarget cannot
   tell us what was pressed (null for buttons on iOS Safari), so a capture-phase
   pointerdown records the press (pendingTap) and onFocusOut defers the commit
   to onAppClick, which commits first and then runs the tapped action from the
   dataset it read before the re-render. A press that never becomes a click (a
   drag, a scroll, pointercancel) commits after TAP_WAIT_MS, as before. */
var TAP_WAIT_MS = 600;
var pendingTap = null; /* { skipped: [input elements whose commit was deferred], timer } */

function armTapTimer() {
  if (!pendingTap) return;
  if (pendingTap.timer) clearTimeout(pendingTap.timer);
  pendingTap.timer = setTimeout(function () { settlePendingTap(true); }, TAP_WAIT_MS);
}
/* Drop the pending tap; commit the deferred fields when asked. Returns it. */
function settlePendingTap(commit) {
  var tap = pendingTap;
  pendingTap = null;
  if (!tap) return null;
  if (tap.timer) clearTimeout(tap.timer);
  if (commit) commitSkipped(tap);
  return tap;
}
function commitSkipped(tap) {
  tap.skipped.forEach(function (el) { if (el.isConnected) commitEditor(el, false); });
  tap.skipped = [];
}

export function onAppPointerDownCapture(e) {
  var t = e.target;
  var prev = pendingTap ? settlePendingTap(false) : null; /* a new press carries the deferred commits over */
  var skipped = prev ? prev.skipped : [];
  var hit = t && t.closest ? t.closest('[data-action]') : null;
  var active = document.activeElement;
  var editing = active && active.matches && active.matches('[data-edit-input]') ? active : null;
  var scope = editing ? editing.closest('[data-edit-scope]') : null;
  var worthy = hit && !t.closest('input, textarea, select') && (editing || skipped.length)
    && !(scope && scope.contains(hit));
  if (!worthy) {
    if (skipped.length) commitSkipped({ skipped: skipped }); /* the press went somewhere else: commit as today */
    return;
  }
  pendingTap = { skipped: skipped, timer: null };
  armTapTimer();
}
export function onAppPointerUpCapture() { armTapTimer(); }
export function onAppPointerCancelCapture() { settlePendingTap(true); }

export function onAppClick(e) {
  var tap = settlePendingTap(false);
  var target = e.target.closest('[data-action]');
  /* read before any re-render detaches the pressed element */
  var ds = target ? Object.assign({}, target.dataset) : null;
  if (tap) commitSkipped(tap);
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
  var action = ds.action;
  actionHaptic(action);
  switch (action) {
    case 'switch-page': switchPage(ds.page); break;
    case 'select-day': selectDay(ds.date); break;
    case 'nav-today': selectDay(todayISO()); break;
    case 'review-fold': foldReviewBoard(render); break;
    case 'review-row': toggleReviewRow(ds.key); render(); break;
    case 'review-cell': pickReviewCell(ds.date); render(); break;
    case 'open-settings': openSettings(); break;
    case 'close-settings': closeSettings(); break;
    case 'close-sheet': closeSheet(); break;
    case 'set-week-start': changeWeekStart(ds.value); break;
    case 'toggle-haptics': toggleHaptics(); break;
    case 'export-data': exportData(); break;
    case 'check-update': checkUpdateClicked(); break;
    case 'apply-update': applyUpdateClicked(); break;
    case 'confirm-import': confirmImport(); break;
    case 'open-login': openLogin(); break;
    case 'submit-login': submitLogin(); break;
    case 'log-out': logOut(); break;
    case 'sync-now': syncNowClicked(); break;
    case 'conflict-keep-local': chooseVersion('local'); break;
    case 'conflict-keep-cloud': chooseVersion('cloud'); break;
    case 'relogin': openRelogin(); break;
    case 'reload-app': reloadAppClicked(); break;
    case 'retry-sdk': retrySignInService(); break;
    case 'export-recovery': exportRecoveryCopy(); break;
    case 'ask-export': exportRecoveryCopy(); break;
    case 'ask-replace': askAnswer(true); break;
    case 'ask-cancel': askAnswer(false); break;
    case 'open-restore': openRestore(); break;
    case 'confirm-restore': confirmRestore(); break;
    case 'discard-recovery': setDiscardConfirm(true); break;
    case 'cancel-discard-recovery': setDiscardConfirm(false); break;
    case 'confirm-discard-recovery': confirmDiscardRecovery(); break;
    case 'tray-action': runTrayAction(ds.tray, ds.id); break;
    default: handleTaskAction(action, ds); break;
  }
}

export function onKeyDown(e) {
  /* Enter in the login form submits it */
  if (e.key === 'Enter' && !e.isComposing && e.target && e.target.matches && e.target.matches('[data-login-field]')) {
    e.preventDefault();
    submitLogin();
    return;
  }
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
  if (pendingTap) { /* a button is being pressed: commit when its click arrives */
    if (pendingTap.skipped.indexOf(el) === -1) pendingTap.skipped.push(el);
    return;
  }
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
