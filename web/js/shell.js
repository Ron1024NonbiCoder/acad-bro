/* The app shell: top-level render() plus page / day / settings navigation.

   render() swaps #app-root's innerHTML wholesale. Everything that must survive
   that (header, bottom nav, toast host, sheet frame) is static markup in
   index.html; this module only patches them (nav labels, body classes, the
   sheet body). */

import { ui, clearActive, PAGE_IDS, AREA_IDS } from './state.js';
import { DB } from './storage.js';
import { escapeHtml, addDays, parseISO, fmtISO, todayISO, todayDate, shortWeekdayDate, WEEKDAY_SHORT } from './utils.js';
import { renderDayStrip, parkStrip } from './day-strip.js';
import { renderSettingsView, importSheetHtml } from './page-settings.js';
import { syncSheet, syncBackStack, setLayerCloser } from './layers.js';
import { tickNav } from './haptics.js';
import { closeTray } from './swipe-entry.js';
import { renderTaskArea, manageSheetHtml } from './page-tasks.js';
import { cancelEditing, postRenderFocus } from './tasks-actions.js';

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

/* Placeholder for the 7-day review board (real data lands in M4): the last
   seven days, one row per area, all neutral dots. Same grid the real one will
   use, so nothing shifts when it fills in. */
function renderReviewBoard() {
  var today = todayDate();
  var heads = '';
  for (var i = 6; i >= 0; i--) heads += '<span class="rb-day">' + WEEKDAY_SHORT[addDays(today, -i).getDay()].charAt(0) + '</span>';
  var rows = AREA_IDS.map(function (id) {
    var dots = '';
    for (var j = 0; j < 7; j++) dots += '<span class="rb-dot"></span>';
    return '<div class="rb-row rb-' + id + '"><span class="rb-name">' + escapeHtml(pageLabel(id)) + '</span>' + dots + '</div>';
  }).join('');
  return '<section class="review-board" aria-label="Last 7 days">'
    + '<div class="rb-row rb-head"><span class="section-sub">7 days</span>' + heads + '</div>'
    + rows
    + '<p class="rb-note">Completed tasks show up here.</p>'
    + '</section>';
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
  if (ui.sheet && ui.sheet.type === 'import') return { title: 'Import data', html: importSheetHtml(ui.sheet) };
  if (ui.sheet && ui.sheet.type === 'manage') return { title: ui.sheet.area === 'all' ? 'Projects' : pageLabel(ui.sheet.area) + ' projects', html: manageSheetHtml(ui.sheet) };
  return null;
}

export function closeSheet() {
  if (!ui.sheet) return;
  ui.sheet = null;
  ui.editing = null; /* an open project editor lived in the sheet */
  render();
}

export function openSettings() {
  clearActive();
  ui.view = 'settings';
  render();
  window.scrollTo(0, 0);
}
export function closeSettings() {
  ui.view = 'main';
  ui.sheet = null;
  render();
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
  if (tag === 'sheet') { ui.sheet = null; ui.editing = null; }
  else if (tag === 'settings') { ui.view = 'main'; ui.sheet = null; }
  render();
});

/* ================= navigation ================= */
export function switchPage(id) {
  if (PAGE_IDS.indexOf(id) === -1 || (id === ui.page && ui.view === 'main')) return;
  tickNav();
  clearActive();
  ui.page = id;
  ui.view = 'main';
  render();
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
  document.body.className = 'page-' + ui.page + (ui.view === 'settings' ? ' view-settings' : '') + (ui.sheet ? ' sheet-open' : '');
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
  if (ui.view === 'main') parkStrip();
  postRenderFocus();
}
