/* The day strip: one calendar week, swipeable (docs/day-strip.md in GymBro),
   that opens into a month grid (M7).

   - Which week: the week containing ui.selectedDate, beginning on
     settings.weekStart (Monday by default; Settings > Week starts on).
   - Selecting a day inside the week only moves the highlight. Past days are
     selectable (backfill), future days too.
   - Other weeks: the DOM holds three pages -- last / this / next week -- in a
     scroll-snap row (scroll-snap-stop: always, so a fling moves one week).
     parkStrip() puts the scroller on the middle page after every render; when a
     swipe settles on a side page, settleStripScroll() moves the selected day a
     week (same weekday) and the caller re-renders, which re-centres.
   - M7: ui.stripOpen swaps the week strip for a 6-row month grid inside the same
     card; ui.monthAnchor is the 1st of the month on screen (null = the month of
     ui.selectedDate). Paging months never touches ui.selectedDate.
   - Done marker (strip and grid alike): a filled circle behind the day number in
     the colour of the area the day's completions belong to -- the same colours
     the Activity board uses (.area-* in styles.css). One area = solid; several =
     the circle cross-fades between them (CSS animation, .done-circle). doneDates()
     gives the area ids per date in a stable order.
   Pure view helpers: no render() import, so shell.js owns when to repaint
   (toggleStrip / scheduleStripClose take render as a parameter). */

import { ui, AREA_IDS } from './state.js';
import { DB } from './storage.js';
import { doneDates, monthGrid, shiftMonthISO } from './tasks-core.js';
import { weekStartDow } from './settings.js';
import { afterTransition, reducedMotion, tokenMs } from './motion.js';
import { WEEKDAY_SHORT, MONTH_SHORT, addDays, fmtISO, parseISO, startOfWeek, todayISO } from './utils.js';

/* Three consecutive weeks as arrays of 7 ISO dates, the week of centerISO in the middle. */
export function stripWeeks(centerISO) {
  var start = startOfWeek(parseISO(centerISO), weekStartDow());
  var weeks = [];
  for (var w = -1; w <= 1; w++) {
    var days = [];
    for (var i = 0; i < 7; i++) days.push(fmtISO(addDays(start, w * 7 + i)));
    weeks.push(days);
  }
  return weeks;
}

/* mirrors .area-living / .area-prod / .area-hobby in styles.css (the Activity board's colours) */
var AREA_COLOR = { living: 'var(--teal)', prod: 'var(--sky)', hobby: 'var(--orange)' };

function areasForPage() { return ui.page === 'all' ? AREA_IDS : [ui.page]; }

/* The day number with its circle behind it (only on a done day). The wrap has one
   size either way, so a done day never shifts the layout. */
function numHtml(iso, doneAreas) {
  var circle = '';
  if (doneAreas && doneAreas.length) {
    var n = Math.min(doneAreas.length, 3);
    var vars = doneAreas.slice(0, n).map(function (a, i) { return '--c' + (i + 1) + ':' + (AREA_COLOR[a] || 'var(--accent)'); }).join(';');
    circle = '<i class="done-circle dc-' + n + '" style="' + vars + '" aria-hidden="true"></i>';
  }
  return '<span class="day-num-wrap">' + circle + '<span class="day-num">' + parseISO(iso).getDate() + '</span></span>';
}

function cellLabel(iso, isToday, isDone) {
  return 'Select ' + iso + (isToday ? ' (today)' : '') + (isDone ? ', tasks done' : '');
}

function cellHtml(iso, done) {
  var d = parseISO(iso);
  var isToday = iso === todayISO();
  var isSelected = iso === ui.selectedDate;
  var doneAreas = done.get(iso);
  var isDone = !!doneAreas;
  return '<div class="strip-cell' + (isToday ? ' is-today' : '') + (isSelected ? ' selected' : '') + (isDone ? ' has-done' : '')
    + '" role="button" tabindex="0" aria-label="' + cellLabel(iso, isToday, isDone) + '"'
    + (isSelected ? ' aria-pressed="true"' : ' aria-pressed="false"')
    + ' data-action="select-day" data-date="' + iso + '">'
    + '<span class="strip-weekday">' + WEEKDAY_SHORT[d.getDay()].charAt(0) + '</span>'
    + numHtml(iso, doneAreas)
    + '<span class="strip-today-mark"></span>'
    + '</div>';
}

function weekStrip() {
  var weeks = stripWeeks(ui.selectedDate);
  /* a circle behind each day with a completion on this page (all areas on "All") */
  var done = doneDates(DB.tasks, DB.completions, areasForPage(), weeks[0][0], weeks[2][6]);
  return '<div class="day-strip"><div class="strip-grid">'
    + weeks.map(function (days) {
      return '<div class="strip-week">' + days.map(function (iso) { return cellHtml(iso, done); }).join('') + '</div>';
    }).join('')
    + '</div></div>';
}

/* ---- month grid ---- */
export function currentMonthAnchor() { return ui.monthAnchor || ui.selectedDate; }

function monthCellHtml(c, done) {
  var iso = c.date;
  var d = parseISO(iso);
  var isToday = iso === todayISO();
  var isSelected = iso === ui.selectedDate;
  var doneAreas = done.get(iso);
  var isDone = !!doneAreas;
  /* the 1st of a neighbouring month carries its month name ("Nov 1") */
  var mon = !c.inMonth && d.getDate() === 1 ? '<span class="month-mon">' + MONTH_SHORT[d.getMonth()] + '</span>' : '';
  return '<div class="month-cell' + (c.inMonth ? '' : ' is-out') + (isToday ? ' is-today' : '') + (isSelected ? ' selected' : '') + (isDone ? ' has-done' : '')
    + '" role="button" tabindex="0" aria-label="' + cellLabel(iso, isToday, isDone) + '"'
    + (isSelected ? ' aria-pressed="true"' : ' aria-pressed="false"')
    + ' data-action="select-day" data-date="' + iso + '">'
    + mon + numHtml(iso, doneAreas)
    + '<span class="strip-today-mark"></span>'
    + '</div>';
}

var enterPage = false; /* one-shot: the next render is a month change, fade the cells in */

function monthGridHtml() {
  var g = monthGrid(currentMonthAnchor(), weekStartDow());
  var done = doneDates(DB.tasks, DB.completions, areasForPage(), g.weeks[0][0].date, g.weeks[5][6].date);
  var onTodayMonth = todayISO().slice(0, 7) === g.first.slice(0, 7);
  var heads = g.weeks[0].map(function (c) { return '<span>' + WEEKDAY_SHORT[parseISO(c.date).getDay()].charAt(0) + '</span>'; }).join('');
  var html = '<div class="month-grid">'
    + '<div class="month-head">'
    + '<span class="month-title" aria-live="polite">' + g.title + '</span>'
    /* the Today button keeps its slot when hidden so the title row never jumps */
    + '<button type="button" class="text-btn month-today' + (onTodayMonth ? ' is-off' : '') + '" data-action="month-today"' + (onTodayMonth ? ' tabindex="-1" aria-hidden="true"' : '') + '>Today</button>'
    + '<button type="button" class="month-nav" data-action="month-prev" aria-label="Previous month">&#8249;</button>'
    + '<button type="button" class="month-nav" data-action="month-next" aria-label="Next month">&#8250;</button>'
    + '</div>'
    + '<div class="month-weekdays" aria-hidden="true">' + heads + '</div>'
    + '<div class="month-cells' + (enterPage ? ' month-enter' : '') + '">'
    + g.weeks.map(function (w) { return w.map(function (c) { return monthCellHtml(c, done); }).join(''); }).join('')
    + '</div></div>';
  enterPage = false;
  return html;
}

/* The chevron row exists in both states (bottom-right), so the card height only
   changes by the grid itself. */
export function renderDayStrip() {
  var open = ui.stripOpen;
  return '<div class="day-strip-card' + (open ? ' is-open' : '') + '"><div class="strip-body">'
    + (open ? monthGridHtml() : weekStrip())
    + '</div><div class="strip-foot"><button type="button" class="strip-toggle" data-action="strip-toggle" aria-expanded="' + open + '"'
    + ' aria-label="' + (open ? 'Show week' : 'Show month') + '"><span class="chev' + (open ? ' is-up' : '') + '" aria-hidden="true">&#9662;</span></button></div></div>';
}

/* ---- open / close / month paging ---- */
var toggling = false;
var closeTimer = null;

export function cancelStripClose() {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
}

/* Open or close the month grid. The card body fades out (--dur-fast), render()
   swaps strip <-> grid while the new body is pinned to the old height, then the
   height eases to the new one while the content fades in: no cut-jump, and what
   is below slides instead of snapping. Reduced motion: swap at once. */
export function toggleStrip(render, open) {
  cancelStripClose();
  if (toggling) return;
  var want = open === undefined ? !ui.stripOpen : !!open;
  if (want === ui.stripOpen) return;
  var body = typeof document !== 'undefined' ? document.querySelector('.day-strip-card .strip-body') : null;
  function apply() { ui.stripOpen = want; ui.monthAnchor = null; }
  if (!body || reducedMotion()) { apply(); render(); return; }
  toggling = true;
  var from = body.offsetHeight;
  body.style.height = from + 'px';
  void body.offsetHeight;
  body.classList.add('is-fading');
  var chev = document.querySelector('.strip-toggle .chev');
  if (chev) chev.classList.toggle('is-up', want); /* the chevron answers the tap at once */
  afterTransition(body, 'opacity', tokenMs('--dur-fast', 160) + 80, function () {
    apply();
    render();
    var nb = document.querySelector('.day-strip-card .strip-body');
    if (!nb) { toggling = false; return; }
    nb.style.height = 'auto';
    var to = nb.offsetHeight;
    nb.style.height = from + 'px';
    nb.classList.add('is-entering');
    void nb.offsetHeight;
    nb.style.height = to + 'px';
    afterTransition(nb, 'height', tokenMs('--dur', 220) + 120, function () {
      nb.style.height = '';
      nb.classList.remove('is-entering');
      toggling = false;
    });
  });
}

export function stripToggling() { return toggling; }

/* Page the month grid (caller re-renders); never touches ui.selectedDate. */
export function shiftMonth(n) {
  ui.monthAnchor = shiftMonthISO(currentMonthAnchor(), n);
  enterPage = true;
}
export function monthToday() {
  ui.monthAnchor = shiftMonthISO(todayISO(), 0);
  enterPage = true;
}

/* A day tapped in the grid: the caller selects it and re-renders (the highlight
   shows at once); the grid folds back to that day's week after ~300 ms. Another
   tap re-arms the timer, a toggle cancels it. */
export function scheduleStripClose(render) {
  cancelStripClose();
  closeTimer = setTimeout(function () { closeTimer = null; toggleStrip(render, false); }, tokenMs('--dur-slow', 300));
}

/* Call after each render: park the scroller on the middle (this week) page. */
export function parkStrip() {
  var el = document.querySelector('.day-strip');
  if (el && el.clientWidth) el.scrollLeft = el.clientWidth;
}

/* Same weekday, n days away (+-7 from a swipe). Caller re-renders. */
export function shiftSelectedDay(n) {
  ui.selectedDate = fmtISO(addDays(parseISO(ui.selectedDate), n));
}

/* The scroller stopped moving: if it rests on a side page the user paged, so
   the selected day moves a week. Returns true when it did (caller re-renders). */
export function settleStripScroll(el) {
  if (!el.clientWidth) return false;
  var page = Math.round(el.scrollLeft / el.clientWidth);
  if (page === 1) return false;
  shiftSelectedDay(page < 1 ? -7 : 7);
  return true;
}
