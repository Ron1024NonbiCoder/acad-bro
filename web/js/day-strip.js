/* The day strip: one calendar week, swipeable (docs/day-strip.md in GymBro).

   - Which week: the week containing ui.selectedDate, beginning on
     settings.weekStart (Monday by default; Settings > Week starts on).
   - Selecting a day inside the week only moves the highlight. Past days are
     selectable (backfill), future days too.
   - Other weeks: the DOM holds three pages -- last / this / next week -- in a
     scroll-snap row (scroll-snap-stop: always, so a fling moves one week).
     parkStrip() puts the scroller on the middle page after every render; when a
     swipe settles on a side page, settleStripScroll() moves the selected day a
     week (same weekday) and the caller re-renders, which re-centres.
   Pure view helpers: no render() import, so shell.js owns when to repaint. */

import { ui, AREA_IDS } from './state.js';
import { DB } from './storage.js';
import { doneDates } from './tasks-core.js';
import { weekStartDow } from './settings.js';
import { WEEKDAY_SHORT, addDays, fmtISO, parseISO, startOfWeek, todayISO } from './utils.js';

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

function cellHtml(iso, done) {
  var d = parseISO(iso);
  var isToday = iso === todayISO();
  var isSelected = iso === ui.selectedDate;
  var isDone = done.has(iso);
  return '<div class="strip-cell' + (isToday ? ' is-today' : '') + (isSelected ? ' selected' : '') + (isDone ? ' has-done' : '')
    + '" role="button" tabindex="0" aria-label="Select ' + iso + (isToday ? ' (today)' : '') + (isDone ? ', tasks done' : '') + '"'
    + (isSelected ? ' aria-pressed="true"' : ' aria-pressed="false"')
    + ' data-action="select-day" data-date="' + iso + '">'
    + '<span class="strip-weekday">' + WEEKDAY_SHORT[d.getDay()].charAt(0) + '</span>'
    + '<span class="day-num-wrap">' + d.getDate() + '</span>'
    + '<span class="strip-done-dot"></span>'
    + '<span class="strip-today-mark"></span>'
    + '</div>';
}

export function renderDayStrip() {
  var weeks = stripWeeks(ui.selectedDate);
  /* a dot under each day with a completion on this page (all areas on "All") */
  var done = doneDates(DB.tasks, DB.completions, ui.page === 'all' ? AREA_IDS : [ui.page], weeks[0][0], weeks[2][6]);
  return '<div class="day-strip-card"><div class="day-strip"><div class="strip-grid">'
    + weeks.map(function (days) {
      return '<div class="strip-week">' + days.map(function (iso) { return cellHtml(iso, done); }).join('') + '</div>';
    }).join('')
    + '</div></div></div>';
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
