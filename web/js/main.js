/* Entry point: wires storage hooks to toasts, delegated event handlers, the
   midnight rollover, and the first render. Module evaluation order guarantees
   storage.js has loaded local data before this runs. */

import {
  onAppClick, onAppChange, onAppInput, onAppPointerCancelCapture, onAppPointerDownCapture, onAppPointerUpCapture,
  onFocusOut, onKeyDown, onAppScroll
} from './events.js';
import { onLongPressPointerDown } from './long-press.js';
import { onSwipeEntryPointerDown } from './swipe-entry.js';
import { onPopState, onSheetPointerDown, onSheetPointerMove, onSheetPointerUp } from './layers.js';
import { render } from './shell.js';
import { ui, PAGE_IDS, clearActive } from './state.js';
import { hooks, loadStatus, onStorageEvent, recoveredMessage } from './storage.js';
import { actions, initCloud, notifySync } from './cloud.js';
import { initAccountUi, reportSignInUnavailable } from './page-account.js';
import { exportData } from './page-settings.js';
import {
  AUTH_HINT_KEY, CONFLICT_BACKUP_KEY, DIRTY_KEY, LAST_KEY, OWNER_KEY, REV_KEY
} from './sync-core.js';
import { showToast } from './toast.js';
import { formatBytes, msUntilMidnight, todayISO } from './utils.js';

/* A failed save must never be silent: the edit is in memory only until the
   user acts (CLAUDE.md: no silent data loss). */
hooks.onSaveError = function () {
  showToast({
    message: 'Could not save to this device (storage full or blocked). Export your data from Settings to keep it.',
    tone: 'warn'
  });
};
hooks.onSizeWarn = function (bytes) {
  showToast({
    message: 'Your data is ' + formatBytes(bytes) + ', close to the 1 MB sync limit. Export a backup and archive old projects.',
    tone: 'warn'
  });
};

/* Another tab saved to this device. The in-memory data was replaced by theirs (or
   our edit was NOT written because theirs was newer): say so and show it. */
hooks.onExternalChange = function (info) {
  clearActive();
  render();
  showToast(info && info.lostEdit
    ? { message: 'Another tab saved newer data, so it is loaded here. Please make your last change again.', tone: 'warn' }
    : { message: 'Updated from another tab.' });
};
/* next steps the sync code offers in its error toasts */
actions.exportData = exportData;

/* localStorage changed in another tab: reload the data, or just refresh the sync
   status when only the sync bookkeeping moved */
var SYNC_KEYS = [AUTH_HINT_KEY, CONFLICT_BACKUP_KEY, DIRTY_KEY, LAST_KEY, OWNER_KEY, REV_KEY];
function onStorage(e) {
  if (onStorageEvent(e)) return;
  if (e.key === null || SYNC_KEYS.indexOf(e.key) !== -1) notifySync();
}

/* ?page=living|prod|hobby|all opens that page (handy for links and testing) */
function applyLaunchDeepLink() {
  var page;
  try { page = new URLSearchParams(location.search).get('page'); } catch (err) { return; }
  if (PAGE_IDS.indexOf(page) !== -1) ui.page = page;
}

/* Device-local midnight: when the date turns over while the app is open, a
   selection that was "today" follows to the new today. Re-checked when the tab
   becomes visible again, because timers sleep with the device. */
var lastToday = todayISO();
var midnightTimer = null;
function checkDayRollover() {
  var now = todayISO();
  if (now === lastToday) return;
  if (ui.selectedDate === lastToday) ui.selectedDate = now;
  lastToday = now;
  render();
}
function scheduleMidnight() {
  if (midnightTimer) clearTimeout(midnightTimer);
  midnightTimer = setTimeout(function () { checkDayRollover(); scheduleMidnight(); }, msUntilMidnight() + 1000);
}

function init() {
  applyLaunchDeepLink();
  /* capture phase: records a press on a button while an editor is open, before the blur it causes (events.js) */
  document.addEventListener('pointerdown', onAppPointerDownCapture, true);
  document.addEventListener('pointerup', onAppPointerUpCapture, true);
  document.addEventListener('pointercancel', onAppPointerCancelCapture, true);
  document.addEventListener('click', onAppClick);
  document.addEventListener('pointerdown', onLongPressPointerDown);
  document.addEventListener('pointerdown', onSwipeEntryPointerDown);
  /* bottom sheet: drag the grip down to dismiss; Back closes the top layer */
  document.addEventListener('pointerdown', onSheetPointerDown);
  document.addEventListener('pointermove', onSheetPointerMove);
  document.addEventListener('pointerup', onSheetPointerUp);
  document.addEventListener('pointercancel', onSheetPointerUp);
  window.addEventListener('popstate', onPopState);
  window.addEventListener('storage', onStorage);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('change', onAppChange);
  document.addEventListener('input', onAppInput);
  document.addEventListener('focusout', onFocusOut);
  document.addEventListener('scroll', onAppScroll, true);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkDayRollover(); });
  scheduleMidnight();
  render();
  initAccountUi();

  if (loadStatus.kind === 'recovered') {
    showToast({
      message: recoveredMessage(loadStatus),
      tone: 'warn'
    });
  }
}

init();

/* Cloud sync is optional: nothing here is needed to use the app. The sign-in
   service loads only if this browser has signed in before; if it cannot load
   (offline, blocked), say so once and carry on locally. */
initCloud().then(function (ok) {
  if (ok === false) reportSignInUnavailable();
});

/* Register the service worker: offline fallback, and what lets Chromium install
   this as a real home-screen app. Non-fatal on failure. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  });
}
