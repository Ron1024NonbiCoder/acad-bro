/* Date/format/string helpers shared by every module.
   Dates are local ISO strings (YYYY-MM-DD); the day boundary is midnight,
   device-local (docs/DEV.md decision 2026-10-26). No timezone is ever stored. */

/* ================= date utils ================= */
export function pad2(n) { return String(n).padStart(2, '0'); }
export function fmtISO(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
export function parseISO(s) {
  var parts = s.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}
/* true only for a real calendar date written exactly YYYY-MM-DD ('2026-02-30' is not) */
export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fmtISO(parseISO(s)) === s;
}
/* local midnight of `now` (injectable for tests) */
export function todayDate(now) { var d = now ? new Date(now) : new Date(); d.setHours(0, 0, 0, 0); return d; }
export function todayISO(now) { return fmtISO(todayDate(now)); }
/* setDate, not +24h: stays on local midnight across daylight-saving changes */
export function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
export function mondayIndex(d) { return (d.getDay() + 6) % 7; } /* Mon=0 .. Sun=6 */
/* First day of d's week when weeks start on startDow (0=Sun .. 6=Sat, i.e. Date#getDay) */
export function startOfWeek(d, startDow) { return addDays(d, -((d.getDay() - startDow + 7) % 7)); }
/* ms from `now` until the next local midnight (for the day-rollover timer) */
export function msUntilMidnight(now) {
  var n = now ? new Date(now) : new Date();
  var next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  return next.getTime() - n.getTime();
}
export var WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortWeekdayDate(d) { return WEEKDAY_SHORT[d.getDay()] + ', ' + MONTH_SHORT[d.getMonth()] + ' ' + d.getDate(); }

export function uid(prefix) { return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 10); }

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

/* "1.2 MB" / "340 KB" */
export function formatBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}
