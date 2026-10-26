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
import { trayWidth, closeTray } from './swipe-entry.js';

/* Page order is state.js PAGE_IDS: the top tabs, the phone bottom bar
   (index.html) and body.page-* all follow it. */
export function pageLabel(id) {
  return id === 'all' ? 'All' : (DB.areaLabels[id] || id);
}

/* ?demo=1 renders one fake swipeable row (no data) so the gestures can be tried
   by hand before M2 has real rows. */
var DEMO = (function () {
  try { return /[?&]demo=1\b/.test(location.search); } catch (err) { return false; }
})();

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
    + '<div class="rb-row rb-head"><span class="section-sub">Last 7 days</span>' + heads + '</div>'
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

/* One card per area; the empty state is the whole body until M2. */
function areaCardHtml(id) {
  return '<section class="area-card day-card area-' + id + '" aria-label="' + escapeHtml(pageLabel(id)) + '">'
    + '<header class="area-card-head"><span class="area-dot" aria-hidden="true"></span><h3>' + escapeHtml(pageLabel(id)) + '</h3></header>'
    + '<p class="empty-state">No tasks yet</p></section>';
}

function renderAreaCards() {
  var ids = ui.page === 'all' ? AREA_IDS : [ui.page];
  return ids.map(areaCardHtml).join('');
}

/* The demo row: shape of every swipeable row (card + reveal pill + tray). */
function demoRowHtml() {
  var id = 'demo-1';
  return '<div class="entry-card has-tray tray-2' + (ui.trayOpenId === id ? ' is-tray-open' : '') + '">'
    + '<div class="entry-row demo-entry-row" data-entry-id="' + id + '">'
    + '<span class="entry-toggle habit" aria-hidden="true"></span>'
    + '<div class="entry-main"><div class="entry-title" data-edit-action="demo-rename" data-entry-id="' + id + '">Demo row</div>'
    + '<div class="entry-sub">Swipe right = done, left = actions, hold title = edit</div></div></div>'
    + '<div class="swipe-reveal reveal-right" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></div>'
    + '<div class="swipe-tray" data-n="2" style="--tray-w:' + trayWidth(2) + 'px">'
    + '<button type="button" class="tray-btn" data-action="tray-action" data-tray="demo-edit" data-id="' + id + '"><span>Edit</span></button>'
    + '<button type="button" class="tray-btn danger" data-action="tray-action" data-tray="demo-delete" data-id="' + id + '"><span>Delete</span></button>'
    + '</div></div>';
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
  return null;
}

export function closeSheet() {
  if (!ui.sheet) return;
  ui.sheet = null;
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
  if (ui.sheet) { closeSheet(); return true; }
  if (ui.trayOpenId) { closeTray(); return true; }
  if (ui.view === 'settings') { closeSettings(); return true; }
  return false;
}

/* Back pressed (layers.js popped a tag): drop that layer's ui state */
setLayerCloser(function (tag) {
  if (tag === 'sheet') ui.sheet = null;
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
      + (DEMO ? '<div class="entry-list">' + demoRowHtml() + '</div>' : '')
      + renderAreaCards();
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
}
