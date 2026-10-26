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
import { todayISO } from './utils.js';
import {
  changeWeekStart, confirmImport, exportData, onImportFile, toggleHaptics
} from './page-settings.js';

/* The haptic map, applied once here by action name instead of inside every
   handler: navigate = tickNav, commit (save / confirm / add) = tickLanded,
   destructive = tickOff. switch-page buzzes inside switchPage(). */
function actionHaptic(action) {
  if (/^(select-day|nav-today|open-settings|close-settings)$/.test(action)) tickNav();
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
  /* the trailing click of a fired long-press must not also do the tap thing */
  if (consumeLongPressClick()) return;
  var action = target.dataset.action;
  actionHaptic(action);
  switch (action) {
    case 'switch-page': switchPage(target.dataset.page); break;
    case 'select-day': selectDay(target.dataset.date); break;
    case 'nav-today': selectDay(todayISO()); break;
    case 'open-settings': openSettings(); break;
    case 'close-settings': closeSettings(); break;
    case 'close-sheet': closeSheet(); break;
    case 'set-week-start': changeWeekStart(target.dataset.value); break;
    case 'toggle-haptics': toggleHaptics(); break;
    case 'export-data': exportData(); break;
    case 'confirm-import': confirmImport(); break;
    case 'tray-action': runTrayAction(target.dataset.tray, target.dataset.id); break;
    default: break;
  }
}

export function onKeyDown(e) {
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

/* The file input is the only change event the app listens for (M1) */
export function onAppChange(e) {
  var t = e.target;
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
