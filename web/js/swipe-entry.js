/* Live drag-to-reveal swipe, ported from GymBro. The surface tracks the finger
   the whole way (transform: translateX on it) with a detached rounded action
   pill growing in the gap it leaves (--swipe-dx / --swipe-progress). Releasing
   past COMMIT_PX fires the action; short of it, the surface springs back.
   Right = complete; left = action tray (a short swipe opens it and it stays
   open; a swipe the whole way across fires its first button).

   One table (ROW_TARGETS), same shape as long-press.js's EDIT_ACTIONS.
   Per target:
     selector  what a pointerdown must land inside
     surface   'card' (default) = slide the row's .entry-card, pill outside the
               card; 'self' = slide the matched row itself
     idKey     dataset key the handlers receive (default 'entryId')
     onRight / onLeft   handlers; a missing onRight means a right drag does not
               move the surface at all
     tray      true = left swipe opens the card's .swipe-tray (markup: shell.js
               demoRowHtml shows the shape)
     swallowClick   true = eat the trailing click in the capture phase

   M1 has no real rows: the only target is the demo row shell.js renders when
   the URL has ?demo=1, so the gesture can be checked by hand. M2 replaces it
   with task rows. */

import { ui } from './state.js';
import { tickLanded, tickLatch, tickUnlatch } from './haptics.js';
import { showToast } from './toast.js';

var ACTIVATE_PX = 8;       /* travel before a touch starts tracking as a drag, not a tap */
var COMMIT_PX = 96;        /* drag past this and released = the action fires */
var MAX_PX = 144;          /* hard cap on how far the surface can be dragged */
var RESIST_START = 96;     /* rubber-band resistance kicks in past this point */
var RESIST_FACTOR = 0.35;
var HORIZONTAL_RATIO = 1.4; /* dx must beat dy by this much, so a scroll is ignored */
var SUPPRESS_CLICK_MS = 400;
var SETTLE_MS = 240;       /* matches the .swipe-settling transition in styles.css */

var TRAY_OPEN_FRAC = 0.35;  /* released past this share of the tray's width = it stays open */
var TRAY_FULL_PX = 32;      /* past the tray's full width by this much = fire the first button */
var TRAY_RESIST = 0.5;      /* how much of a drag beyond the tray's edge still moves the card */
var TRAY_OVER_MAX = 44;     /* and the most it can move past the edge */

/* n buttons of 52px, 4px gaps, 8px edge -- the same arithmetic as the
   .tray-N classes in styles.css */
export function trayWidth(n) { return n > 0 ? n * 52 + (n - 1) * 4 + 8 : 0; }

var ROW_TARGETS = [
  {
    selector: '.demo-entry-row',
    onRight: function (id) { showToast({ message: 'Demo: swipe right fired for ' + id, tone: 'good' }); },
    tray: true
  }
];

/* What each tray button does. Keys are the buttons' data-tray values; every one
   gets the row's id. */
var TRAY_ACTIONS = {
  'demo-edit': function (id) { showToast({ message: 'Demo: edit ' + id }); },
  'demo-delete': function (id) { showToast({ message: 'Demo: delete ' + id, tone: 'warn' }); }
};

/* The tray is closed by forgetting it and dropping the class on the node that
   is already there -- no render(), so the card slides shut instead of being
   replaced. Anything that opens an editor closes it through clearActive(). */
export function closeTray() {
  ui.trayOpenId = null;
  var open = document.querySelector('.entry-card.is-tray-open');
  if (open) open.classList.remove('is-tray-open');
}
function openTray(surface, id) {
  var other = document.querySelector('.entry-card.is-tray-open');
  if (other && other !== surface) other.classList.remove('is-tray-open');
  surface.classList.add('is-tray-open');
  ui.trayOpenId = id;
}
export function runTrayAction(name, id) {
  closeTray();
  var fn = TRAY_ACTIONS[name];
  if (fn) fn(id);
}

var drag = null;
var suppressClickAt = 0;

function findRow(target) {
  if (!target.closest) return null;
  for (var i = 0; i < ROW_TARGETS.length; i++) {
    var row = target.closest(ROW_TARGETS[i].selector);
    if (row) return { row: row, config: ROW_TARGETS[i] };
  }
  return null;
}

/* dx dampened past RESIST_START so the surface never runs away under the
   finger, and capped at MAX_PX. A target with no right action is pinned at 0
   on that side. */
function clampDx(dx, config) {
  if (dx > 0 && !config.onRight) return 0;
  var sign = dx < 0 ? -1 : 1;
  var abs = Math.abs(dx);
  if (abs <= RESIST_START) return dx;
  var resisted = RESIST_START + (abs - RESIST_START) * RESIST_FACTOR;
  return sign * Math.min(resisted, MAX_PX);
}

/* Where the card sits for a finger `dx` from where the drag began, for a row
   with a tray. An open tray is the starting offset (-tray width), so the same
   drag can close it again; past the tray's far edge the card resists. */
function trayPos(dx) {
  var w = drag.trayW;
  var pos = drag.base + dx;
  if (drag.base < 0) pos = Math.min(0, pos);
  else if (pos >= 0) return clampDx(dx, drag.config);
  if (-pos > w) pos = -(w + Math.min((-pos - w) * TRAY_RESIST, TRAY_OVER_MAX));
  return pos;
}
function latchLine() { return drag.tray ? drag.trayW + TRAY_FULL_PX : COMMIT_PX; }

function paint(dx) {
  var clamped = drag.tray ? trayPos(dx) : clampDx(dx, drag.config);
  var el = drag.surface;
  el.style.transform = 'translateX(' + clamped + 'px)';
  el.style.setProperty('--swipe-progress', Math.min(1, Math.abs(clamped) / COMMIT_PX).toFixed(3));
  el.style.setProperty('--swipe-dx', Math.abs(clamped).toFixed(1) + 'px');
  el.classList.toggle('dragging-right', clamped > 0);
  el.classList.toggle('dragging-left', clamped < 0);
  /* one buzz on crossing the commit line each way */
  var pastCommit = drag.tray
    ? (clamped < 0 ? -clamped >= latchLine() : clamped >= COMMIT_PX)
    : Math.abs(clamped) >= COMMIT_PX;
  if (pastCommit && !drag.latched) { drag.latched = true; tickLatch(); }
  else if (!pastCommit && drag.latched) { drag.latched = false; tickUnlatch(); }
  return clamped;
}

/* Spring the surface back to rest. */
function settle(el) {
  el.classList.add('swipe-settling');
  el.style.transition = '';
  el.style.transform = '';
  el.style.removeProperty('--swipe-progress');
  el.classList.remove('dragging-right', 'dragging-left');
  setTimeout(function () {
    el.classList.remove('swipe-settling');
    el.style.removeProperty('--swipe-dx');
  }, SETTLE_MS);
}

/* One-shot capture-phase click eater for swallowClick targets. */
function swallowNextClick() {
  function eat(e) {
    e.stopImmediatePropagation();
    e.preventDefault();
    done();
  }
  function done() {
    document.removeEventListener('click', eat, true);
    clearTimeout(timer);
  }
  var timer = setTimeout(done, SUPPRESS_CLICK_MS);
  document.addEventListener('click', eat, true);
}

function clearDrag() {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  drag = null;
}

function onMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  var dx = e.clientX - drag.startX;
  var dy = e.clientY - drag.startY;
  if (!drag.active) {
    /* a right drag on a left-only row never activates */
    var usable = (drag.tray ? trayPos(dx) === drag.base : clampDx(dx, drag.config) === 0) ? 0 : dx;
    if (Math.abs(usable) < ACTIVATE_PX) return;
    if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_RATIO) return;
    drag.active = true;
    drag.surface.style.transition = 'none';
  }
  if (e.cancelable) e.preventDefault();
  paint(dx);
}

/* Lift of the finger on a tray row: decide where the card comes to rest. */
function finishTray(d, dx, surface) {
  drag = d; /* trayPos() reads the drag record; clearDrag() already dropped it */
  var pos = trayPos(dx);
  drag = null;
  var id = d.row.dataset.entryId;
  suppressClickAt = Date.now();
  if (pos > 0) {
    /* a closed card dragged right: the ordinary swipe-right action */
    settle(surface);
    if (pos >= COMMIT_PX) { tickLanded(); d.config.onRight(id); }
    return;
  }
  if (-pos >= d.trayW + TRAY_FULL_PX) {
    /* all the way across: the first button, with the tray left shut */
    var first = surface.querySelector('.swipe-tray [data-tray]');
    closeTray();
    settle(surface);
    if (first) { tickLanded(); runTrayAction(first.dataset.tray, first.dataset.id); }
    return;
  }
  if (-pos >= d.trayW * TRAY_OPEN_FRAC) openTray(surface, id);
  else closeTray();
  settle(surface);
}

function onUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  var drag0 = drag;
  var wasActive = drag.active;
  var dx = e.clientX - drag.startX;
  var config = drag.config;
  var row = drag.row;
  var surface = drag.surface;
  clearDrag();
  if (!wasActive) return;
  if (drag0.tray) {
    finishTray(drag0, dx, surface);
    return;
  }
  var clamped = clampDx(dx, config);
  settle(surface);
  suppressClickAt = Date.now();
  if (config.swallowClick) swallowNextClick();
  if (Math.abs(clamped) >= COMMIT_PX) {
    var id = row.dataset[config.idKey || 'entryId'];
    tickLanded();
    if (clamped > 0) config.onRight(id);
    else config.onLeft(id);
  }
}

function onCancel(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  var wasActive = drag.active;
  var surface = drag.surface;
  clearDrag();
  if (wasActive) settle(surface);
}

export function onSwipeEntryPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  var found = findRow(e.target);
  if (!found) return;
  var surface = found.config.surface === 'self' ? found.row : found.row.closest('.entry-card');
  if (!surface) return;
  clearDrag();
  /* the pill is as tall as the row's visible box, measured once; +2 covers the
     card's 1px border top and bottom */
  if (found.config.surface !== 'self') {
    surface.style.setProperty('--swipe-h', (surface.offsetHeight + 2) + 'px');
  }
  var tray = found.config.tray ? surface.querySelector(':scope > .swipe-tray') : null;
  var trayW = tray ? trayWidth(parseInt(tray.dataset.n, 10) || 0) : 0;
  drag = {
    pointerId: e.pointerId,
    row: found.row,
    surface: surface,
    config: found.config,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    latched: false,
    tray: !!tray,
    trayW: trayW,
    base: tray && surface.classList.contains('is-tray-open') ? -trayW : 0
  };
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

/* Called from click handlers for tap actions on swipeable rows: true means this
   click is the trailing click of a swipe that actually dragged, so the caller
   should skip its normal behaviour. A tap that never moved past ACTIVATE_PX is
   not suppressed. */
export function consumeSwipeEntryClick() {
  if (suppressClickAt && Date.now() - suppressClickAt < SUPPRESS_CLICK_MS) {
    suppressClickAt = 0;
    return true;
  }
  return false;
}
