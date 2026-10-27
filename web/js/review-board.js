/* Review board (M4): 7-day activity dots per project, and a 12-week heatmap
   that opens in place under a tapped row. Tracking, not pressure: a dot is
   either filled (something was completed that day) or outlined; there are no
   counters, goals or streaks anywhere.

   Pure string builders over DB + ui + settings, like page-tasks.js; all the
   counting is tasks-core.js (activityIndex / windowDays / heatmapGrid /
   reviewGroups, node-tested). Rendered inside render()'s innerHTML swap, so
   nothing here holds DOM references.

   Interactions (events.js): a dot is a plain select-day button (jumps the day
   strip), a row name opens its heatmap (review-row), a heatmap cell shows its
   date + count in a label under the grid (review-cell), the title bar folds the
   whole board (review-fold, remembered per device in settings.js). */

import { ui, clearActive, AREA_IDS } from './state.js';
import { DB } from './storage.js';
import { settings, setSetting, weekStartDow } from './settings.js';
import { escapeHtml, addDays, fmtISO, parseISO, shortWeekdayDate, todayISO, MONTH_SHORT, WEEKDAY_SHORT } from './utils.js';
import { activityIndex, heatmapGrid, reviewGroups, windowDays } from './tasks-core.js';
import { afterTransition, reducedMotion, tokenMs } from './motion.js';

var DAYS = 7;
var HEAT_WEEKS = 12;

function areaName(id) { return DB.areaLabels[id] || id; }
function prettyDate(iso) { var d = parseISO(iso); return MONTH_SHORT[d.getMonth()] + ' ' + d.getDate(); }
function taskWord(n) { return n + (n === 1 ? ' task' : ' tasks'); }

/* ================= state changes (events.js re-renders afterwards) ================= */
/* The element that should fade in on the next render: set by the toggles below
   and consumed by it, so an ordinary re-render (completing a task...) never
   replays the fade. */
var enterKey = null;

export function toggleReviewBoard() {
  clearActive();
  var show = !settings.reviewShown;
  setSetting('reviewShown', show);
  enterKey = show ? 'board' : null;
}
/* The title-bar tap. Opening re-renders at once (the body fades in via
   .rb-enter); closing first collapses the body in place (.rb-closing: pinned
   height -> 0 + fade) and re-renders only after that transition ends, so the
   content below slides up instead of jumping. Taps during the fold are ignored. */
var folding = false;
export function foldReviewBoard(render) {
  if (folding) return;
  var body = settings.reviewShown && typeof document !== 'undefined' ? document.querySelector('.review-board .rb-body') : null;
  if (!body || reducedMotion()) { toggleReviewBoard(); render(); return; }
  folding = true;
  var chev = document.querySelector('.rb-top .chev');
  if (chev) chev.classList.add('is-folded'); /* the chevron answers the tap at once */
  body.style.height = body.offsetHeight + 'px';
  void body.offsetHeight; /* commit the pinned height so the collapse transitions from it */
  body.classList.add('rb-closing');
  afterTransition(body, 'height', tokenMs('--dur', 220) + 80, function () {
    folding = false;
    toggleReviewBoard();
    render();
  });
}
export function toggleReviewRow(key) {
  clearActive();
  ui.reviewRow = ui.reviewRow === key ? null : key;
  ui.reviewCell = null;
  enterKey = ui.reviewRow ? 'row:' + key : null;
}
export function pickReviewCell(date) {
  ui.reviewCell = ui.reviewCell === date ? null : date;
}

/* ================= pieces ================= */
function dotLabel(d) {
  return shortWeekdayDate(parseISO(d.date)) + ': ' + (d.count ? taskWord(d.count) + ' done' : 'no activity');
}

function headRow(days) {
  return '<div class="rb-row rb-head" aria-hidden="true"><span></span>' + days.map(function (d, i) {
    var dt = parseISO(d.date);
    return '<span class="rb-day' + (i === days.length - 1 ? ' is-sel' : '') + '"><b>' + WEEKDAY_SHORT[dt.getDay()].charAt(0) + '</b><i>' + dt.getDate() + '</i></span>';
  }).join('') + '</div>';
}

function heatmapHtml(counts, endISO, enter) {
  var g = heatmapGrid(counts, endISO, HEAT_WEEKS, weekStartDow());
  var today = todayISO();
  var months = g.weeks.map(function (w) { return '<span>' + w.month + '</span>'; }).join('');
  var cellsByDate = {};
  var cells = '';
  /* grid-auto-flow: column fills each week top to bottom, so emit week by week */
  g.weeks.forEach(function (w) {
    w.cells.forEach(function (c) {
      cellsByDate[c.date] = c;
      if (!c.inRange) { cells += '<span class="hm-c is-out" aria-hidden="true"></span>'; return; }
      var label = shortWeekdayDate(parseISO(c.date)) + ': ' + (c.count ? taskWord(c.count) + ' done' : 'no activity');
      cells += '<button type="button" class="hm-c l' + c.level + (c.date === today ? ' is-today' : '') + (c.date === ui.reviewCell ? ' is-picked' : '')
        + '" data-action="review-cell" data-date="' + c.date + '" aria-label="' + escapeHtml(label) + '" aria-pressed="' + (c.date === ui.reviewCell) + '"></button>';
    });
  });
  /* weekday initials in the order of the week-start setting */
  var first = g.weeks[0].cells;
  var dows = '<span></span>' + first.map(function (c, i) {
    return '<span>' + (i % 2 === 0 ? WEEKDAY_SHORT[parseISO(c.date).getDay()].charAt(0) : '') + '</span>';
  }).join('');
  var picked = ui.reviewCell && cellsByDate[ui.reviewCell] && cellsByDate[ui.reviewCell].inRange ? cellsByDate[ui.reviewCell] : null;
  var label = picked
    ? shortWeekdayDate(parseISO(picked.date)) + ' · ' + (picked.count ? taskWord(picked.count) + ' done' : 'nothing completed')
    : (g.total ? 'Tap a square to see its day.' : 'Complete a task to see activity here.');
  var legend = '<span class="hm-legend" aria-hidden="true">Less' + [0, 1, 2, 3, 4].map(function (l) { return '<i class="hm-c l' + l + '"></i>'; }).join('') + 'More</span>';
  return '<div class="hm' + (enter ? ' rb-enter' : '') + '" role="group" aria-label="Last ' + HEAT_WEEKS + ' weeks">'
    + '<div class="hm-body"><div class="hm-dows" aria-hidden="true">' + dows + '</div>'
    + '<div class="hm-main"><div class="hm-months" style="--cols:' + HEAT_WEEKS + '" aria-hidden="true">' + months + '</div>'
    + '<div class="hm-grid" style="--cols:' + HEAT_WEEKS + '">' + cells + '</div></div></div>'
    + '<div class="hm-foot"><span class="hm-label' + (picked ? ' is-picked' : '') + '" aria-live="polite">' + escapeHtml(label) + '</span>' + legend + '</div>'
    + '</div>';
}

function rowHtml(row, index, endISO) {
  var counts = index.get(row.key);
  var days = windowDays(counts, endISO, DAYS);
  var open = ui.reviewRow === row.key;
  var key = escapeHtml(row.key);
  var name = row.projectId ? row.name : 'Loose';
  var dots = days.map(function (d) {
    return '<button type="button" class="rb-dot-btn" data-action="select-day" data-date="' + d.date + '" aria-label="' + escapeHtml(dotLabel(d)) + '" title="' + escapeHtml(dotLabel(d)) + '">'
      + '<i class="rb-dot' + (d.active ? ' on' : '') + '"></i></button>';
  }).join('');
  return '<div class="rb-item area-' + row.area + (open ? ' is-open' : '') + '" data-review-row="' + key + '">'
    + '<div class="rb-row">'
    + '<button type="button" class="rb-name" data-action="review-row" data-key="' + key + '" aria-expanded="' + open + '" title="' + escapeHtml(name) + '">'
    + '<span class="chev' + (open ? '' : ' is-folded') + '" aria-hidden="true">&#9662;</span><span class="rb-name-text">' + escapeHtml(name) + '</span></button>'
    + dots + '</div>'
    + (open ? heatmapHtml(counts, endISO, enterKey === 'row:' + row.key) : '')
    + '</div>';
}

/* ================= board ================= */
export function renderReviewBoard() {
  var end = ui.selectedDate;
  var shown = settings.reviewShown;
  var areas = ui.page === 'all' ? AREA_IDS : [ui.page];
  var groups = reviewGroups(areas, DB.projects, DB.tasks);
  /* one pass covers both the 7 dots and the 12-week grid (the grid always reaches back further) */
  var start = fmtISO(addDays(parseISO(end), -(HEAT_WEEKS * 7 + 6)));
  var index = activityIndex(DB.tasks, DB.completions, start, end);

  var from = fmtISO(addDays(parseISO(end), -(DAYS - 1)));
  var top = '<button type="button" class="rb-top" data-action="review-fold" aria-expanded="' + shown + '">'
    + '<span class="chev' + (shown ? '' : ' is-folded') + '" aria-hidden="true">&#9662;</span>'
    + '<span class="section-sub">Activity</span><span class="rb-range">' + prettyDate(from) + ' – ' + prettyDate(end) + '</span></button>';

  var body = '';
  if (shown) {
    var anyActive = false;
    var rows = groups.map(function (g) {
      var label = ui.page === 'all'
        ? '<div class="rb-group area-' + g.area + '"><span class="area-dot" aria-hidden="true"></span>' + escapeHtml(areaName(g.area)) + '</div>'
        : '';
      return label + g.rows.map(function (r) {
        var counts = index.get(r.key);
        if (windowDays(counts, end, DAYS).some(function (d) { return d.active; })) anyActive = true;
        return rowHtml(r, index, end);
      }).join('');
    }).join('');
    var hint;
    if (!groups.length) hint = '<p class="rb-note">Add a task to see activity here.</p>';
    else if (!anyActive) hint = '<p class="rb-note">Complete a task to see activity here.</p>';
    else hint = '';
    body = '<div class="rb-body' + (enterKey === 'board' ? ' rb-enter' : '') + '">' + (groups.length ? headRow(windowDays(null, end, DAYS)) : '') + rows + hint + '</div>';
  }
  enterKey = null;
  return '<section class="review-board" aria-label="Activity, last ' + DAYS + ' days">' + top + body + '</section>';
}
