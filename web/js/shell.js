/* The app shell: top-level render() plus page / day / settings navigation.

   render() swaps #app-root's innerHTML wholesale. Everything that must survive
   that (header, bottom nav, toast host, sheet frame) is static markup in
   index.html; this module only patches them (nav labels, body classes, the
   sheet body). */

import { ui, clearActive, PAGE_IDS } from './state.js';
import { DB } from './storage.js';
import { escapeHtml, addDays, parseISO, fmtISO, todayISO, shortWeekdayDate } from './utils.js';
import { renderDayStrip, parkStrip } from './day-strip.js';
import { renderSettingsView, importSheetHtml } from './page-settings.js';
import { accountSheet } from './page-account.js';
import { syncSheet, syncBackStack, setLayerCloser } from './layers.js';
import { tickNav } from './haptics.js';
import { closeTray } from './swipe-entry.js';
import { renderTaskArea, manageSheetHtml } from './page-tasks.js';
import { renderReviewBoard } from './review-board.js';
import { cancelEditing, postRenderFocus } from './tasks-actions.js';
import { afterTransition, reducedMotion, tokenMs } from './motion.js';

/* Page order is state.js PAGE_IDS: the top tabs, the phone bottom bar
   (index.html) and body.page-* all follow it. */
export function pageLabel(id) {
  return id === 'all' ? 'All' : (DB.areaLabels[id] || id);
}

/* ================= pieces ================= */
export function renderPageTabs() {
  return '<nav class="page-tabs" aria-label="Areas">' + PAGE_IDS.map(function (id) {
    return '<button type="button" class="page-tab tab-' + id + (ui.page === id ? ' active' : '') + '" data-action="switch-page" data-page="' + id + '"'
      + (ui.page === id ? ' aria-current="page"' : '') + '>' + escapeHtml(pageLabel(id)) + '</button>';
  }).join('') + '</nav>';
}

function dayHeading() {
  var t = todayISO();
  if (ui.selectedDate === t) return 'Today';
  if (ui.selectedDate === fmtISO(addDays(parseISO(t), -1))) return 'Yesterday';
  if (ui.selectedDate === fmtISO(addDays(parseISO(t), 1))) return 'Tomorrow';
  return shortWeekdayDate(parseISO(ui.selectedDate));
}

function renderSectionHeader() {
  /* the Today button keeps its slot when hidden so the heading row never jumps */
  var away = ui.selectedDate !== todayISO();
  return '<div class="section-header"><h2>' + escapeHtml(dayHeading()) + '</h2>'
    + '<button type="button" class="text-btn' + (away ? '' : ' is-off') + '" data-action="nav-today"' + (away ? '' : ' tabindex="-1" aria-hidden="true"') + '>Back to today</button></div>';
}

/* The bottom nav is static markup; keep its labels in step with areaLabels */
function syncNavLabels() {
  var items = document.querySelectorAll('.bottom-nav-item');
  for (var i = 0; i < items.length; i++) {
    var lab = items[i].querySelector('.bottom-nav-label');
    var text = pageLabel(items[i].dataset.page);
    if (lab && lab.textContent !== text) lab.textContent = text;
  }
}

/* ================= sheet / layers ================= */
function currentSheet() {
  var acct = accountSheet(ui.sheet);
  if (acct) return acct;
  if (ui.sheet && ui.sheet.type === 'import') return { title: 'Import data', html: importSheetHtml(ui.sheet) };
  if (ui.sheet && ui.sheet.type === 'manage') return { title: ui.sheet.area === 'all' ? 'Projects' : pageLabel(ui.sheet.area) + ' projects', html: manageSheetHtml(ui.sheet) };
  return null;
}

/* the conflict choice and the recovery-slot question cannot be dismissed: every
   answer is safe, leaving them open is not an answer (a waiting login depends on it) */
function sheetLocked() { return !!(ui.sheet && (ui.sheet.type === 'conflict' || ui.sheet.type === 'replace-recovery')); }

export function closeSheet() {
  if (!ui.sheet || sheetLocked()) return;
  ui.sheet = null;
  ui.editing = null; /* an open project editor lived in the sheet */
  render();
}

export function openSettings() {
  clearActive();
  swapWithFade(function () {
    ui.view = 'settings';
    render();
    window.scrollTo(0, 0);
  });
}
export function closeSettings() {
  swapWithFade(function () {
    ui.view = 'main';
    ui.sheet = null;
    render();
  });
}

/* Escape / hardware Back: close the topmost layer. Returns true if one closed. */
export function closeTopLayer() {
  if (cancelEditing()) return true;
  if (ui.sheet) { closeSheet(); return true; }
  if (ui.trayOpenId) { closeTray(); return true; }
  if (ui.view === 'settings') { closeSettings(); return true; }
  return false;
}

/* Back pressed (layers.js popped a tag): drop that layer's ui state */
setLayerCloser(function (tag) {
  if (tag === 'sheet') { if (!sheetLocked()) { ui.sheet = null; ui.editing = null; } }
  else if (tag === 'settings') { swapWithFade(function () { ui.view = 'main'; ui.sheet = null; render(); }); return; }
  render();
});

/* ================= navigation ================= */
/* Every page change (area tabs / bottom nav, Settings in and out, Back) goes
   through here so they all transition the same way: #app-root fades out
   (--dur-fast), `change` swaps the view while it is invisible, then it fades
   back in. A change requested mid-fade first finishes the pending one, so
   nothing is dropped. Reduced motion: `change` runs at once. */
var pendingSwap = null;
export function swapWithFade(change) {
  if (pendingSwap) pendingSwap();
  var root = document.getElementById('app-root');
  if (!root || reducedMotion()) { change(); return; }
  var run = function () {
    if (pendingSwap !== run) return;
    pendingSwap = null;
    change();
    root.classList.remove('swap-out'); /* the same opacity transition fades the new view in */
  };
  pendingSwap = run;
  root.classList.add('swap-out');
  /* swap only once the fade-out has ended: the timer can fire before the
     transition does when frames start late (busy main thread), so a timer
     wake-up re-checks the opacity and keeps waiting; the hard cap covers a
     background tab, where the transition may never finish */
  var fast = tokenMs('--dur-fast', 160);
  var start = Date.now();
  var cap = fast * 3 + 200;
  afterTransition(root, 'opacity', fast + 80, function check() {
    if (pendingSwap !== run) return; /* already finished by a newer swap */
    var op = 0;
    try { op = parseFloat(getComputedStyle(root).opacity); } catch (e) { op = 0; }
    if (op > 0 && Date.now() - start < cap) afterTransition(root, 'opacity', 40, check);
    else run();
  });
}

export function switchPage(id) {
  if (pendingSwap) pendingSwap(); /* judge "already there" against the page being faded to */
  if (PAGE_IDS.indexOf(id) === -1 || (id === ui.page && ui.view === 'main')) return;
  tickNav();
  clearActive();
  swapWithFade(function () {
    ui.page = id;
    ui.view = 'main';
    render();
  });
}

export function selectDay(iso) {
  clearActive();
  ui.selectedDate = iso;
  render();
}

/* ================= top-level render ================= */
export function render() {
  var root = document.getElementById('app-root');
  /* the bottom nav lives outside #app-root and takes its active item and its
     hidden-in-Settings state from these body classes -- no per-render DOM work */
  document.body.className = 'page-' + ui.page + (ui.view === 'settings' ? ' view-settings' : '') + (ui.sheet ? ' sheet-open' : '') + (sheetLocked() ? ' sheet-locked' : '');
  if (ui.view === 'settings') {
    root.innerHTML = renderSettingsView();
  } else {
    root.innerHTML = renderReviewBoard() + renderPageTabs() + renderDayStrip() + renderSectionHeader()
      + renderTaskArea();
  }
  syncNavLabels();
  /* the sheet body holds the controls; syncSheet touches the frame only on open/close */
  var sheet = currentSheet();
  syncSheet(sheet);
  var layers = [];
  if (ui.view === 'settings') layers.push('settings');
  if (sheet) layers.push('sheet');
  syncBackStack(layers);
  ui.editorEnter = false; /* the expand-in plays on the opening render only */
  if (ui.view === 'main') parkStrip();
  postRenderFocus();
}
