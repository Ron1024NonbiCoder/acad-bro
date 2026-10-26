/* Entry point: wires storage hooks to toasts, delegated event handlers, the
   midnight rollover, and the first render. Module evaluation order guarantees
   storage.js has loaded local data before this runs. */

import { onAppClick, onAppChange, onKeyDown, onAppScroll } from './events.js';
import { onLongPressPointerDown } from './long-press.js';
import { onSwipeEntryPointerDown } from './swipe-entry.js';
import { onPopState, onSheetPointerDown, onSheetPointerMove, onSheetPointerUp } from './layers.js';
import { render } from './shell.js';
import { ui, PAGE_IDS } from './state.js';
import { hooks, loadStatus } from './storage.js';
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
  document.addEventListener('click', onAppClick);
  document.addEventListener('pointerdown', onLongPressPointerDown);
  document.addEventListener('pointerdown', onSwipeEntryPointerDown);
  /* bottom sheet: drag the grip down to dismiss; Back closes the top layer */
  document.addEventListener('pointerdown', onSheetPointerDown);
  document.addEventListener('pointermove', onSheetPointerMove);
  document.addEventListener('pointerup', onSheetPointerUp);
  document.addEventListener('pointercancel', onSheetPointerUp);
  window.addEventListener('popstate', onPopState);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('change', onAppChange);
  document.addEventListener('scroll', onAppScroll, true);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkDayRollover(); });
  scheduleMidnight();
  render();

  if (loadStatus.kind === 'recovered') {
    showToast({
      message: loadStatus.newerSchema
        ? 'Saved data is from a newer AcadBro. A copy was kept; update the app to use it.'
        : 'Saved data could not be read. A copy was kept' + (loadStatus.corruptSaved ? ' on this device' : ', but could not be stored') + '; you are starting fresh.',
      tone: 'warn'
    });
  }
}

init();

/* Register the service worker: offline fallback, and what lets Chromium install
   this as a real home-screen app. Non-fatal on failure. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  });
}
