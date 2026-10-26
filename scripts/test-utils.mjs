/* Date helper tests. Plain node asserts; exits non-zero on failure.
   Run: node scripts/test-utils.mjs */

import assert from 'node:assert/strict';
import {
  addDays, escapeHtml, fmtISO, formatBytes, isISODate, mondayIndex, msUntilMidnight,
  parseISO, shortWeekdayDate, startOfWeek, todayDate, todayISO
} from '../web/js/utils.js';

var n = 0;
function test(name, fn) {
  try { fn(); n++; } catch (err) {
    console.error('FAIL ' + name + '\n  ' + (err && err.message));
    process.exitCode = 1;
  }
}

test('fmtISO / parseISO round trip, local not UTC', function () {
  var d = new Date(2026, 9, 26, 23, 59); /* Oct 26 2026, late evening local */
  assert.equal(fmtISO(d), '2026-10-26');
  var p = parseISO('2026-01-05');
  assert.equal(p.getFullYear(), 2026);
  assert.equal(p.getMonth(), 0);
  assert.equal(p.getDate(), 5);
  assert.equal(p.getHours(), 0); /* local midnight */
  assert.equal(fmtISO(parseISO('2024-02-29')), '2024-02-29');
});

test('isISODate accepts real dates only', function () {
  assert.equal(isISODate('2026-10-26'), true);
  assert.equal(isISODate('2024-02-29'), true);
  assert.equal(isISODate('2026-02-29'), false);
  assert.equal(isISODate('2026-02-30'), false);
  assert.equal(isISODate('2026-13-01'), false);
  assert.equal(isISODate('2026-1-1'), false);
  assert.equal(isISODate('26-10-26'), false);
  assert.equal(isISODate(20261026), false);
  assert.equal(isISODate(null), false);
});

test('todayDate is local midnight; todayISO uses the injected clock', function () {
  var t = todayDate(new Date(2026, 9, 26, 17, 45, 12, 500));
  assert.equal(t.getHours(), 0);
  assert.equal(t.getMinutes(), 0);
  assert.equal(t.getSeconds(), 0);
  assert.equal(t.getMilliseconds(), 0);
  assert.equal(todayISO(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31');
  assert.equal(todayISO(new Date(2027, 0, 1, 0, 0, 0)), '2027-01-01');
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('addDays crosses month, year and leap day', function () {
  assert.equal(fmtISO(addDays(parseISO('2026-10-31'), 1)), '2026-11-01');
  assert.equal(fmtISO(addDays(parseISO('2026-12-31'), 1)), '2027-01-01');
  assert.equal(fmtISO(addDays(parseISO('2024-02-28'), 1)), '2024-02-29');
  assert.equal(fmtISO(addDays(parseISO('2026-03-01'), -1)), '2026-02-28');
  assert.equal(fmtISO(addDays(parseISO('2026-10-26'), -7)), '2026-10-19');
});

test('addDays keeps local midnight across every DST change in a year', function () {
  var d = parseISO('2026-01-01');
  for (var i = 0; i < 366; i++) {
    assert.equal(d.getHours(), 0, 'not midnight on ' + fmtISO(d));
    d = addDays(d, 1);
  }
  assert.equal(fmtISO(d), '2027-01-02');
});

test('mondayIndex: Mon=0 .. Sun=6 (2026-10-26 is a Monday)', function () {
  assert.equal(parseISO('2026-10-26').getDay(), 1);
  assert.equal(mondayIndex(parseISO('2026-10-26')), 0);
  assert.equal(mondayIndex(parseISO('2026-10-27')), 1);
  assert.equal(mondayIndex(parseISO('2026-11-01')), 6); /* Sunday */
});

test('startOfWeek honours the week-start day', function () {
  var wed = parseISO('2026-10-28');
  assert.equal(fmtISO(startOfWeek(wed, 1)), '2026-10-26'); /* Monday start */
  assert.equal(fmtISO(startOfWeek(wed, 0)), '2026-10-25'); /* Sunday start */
  assert.equal(fmtISO(startOfWeek(wed, 6)), '2026-10-24'); /* Saturday start */
  /* a day that is already the start stays put */
  assert.equal(fmtISO(startOfWeek(parseISO('2026-10-26'), 1)), '2026-10-26');
  assert.equal(fmtISO(startOfWeek(parseISO('2026-10-25'), 0)), '2026-10-25');
  /* Sunday belongs to the week that began the previous Monday */
  assert.equal(fmtISO(startOfWeek(parseISO('2026-11-01'), 1)), '2026-10-26');
  /* across a year boundary */
  assert.equal(fmtISO(startOfWeek(parseISO('2027-01-01'), 1)), '2026-12-28');
});

test('msUntilMidnight', function () {
  assert.equal(msUntilMidnight(new Date(2026, 9, 26, 23, 59, 59, 0)), 1000);
  assert.equal(msUntilMidnight(new Date(2026, 9, 26, 0, 0, 0, 0)) > 23 * 3600 * 1000, true);
  assert.equal(msUntilMidnight(new Date(2026, 11, 31, 12, 0, 0, 0)), 12 * 3600 * 1000);
});

test('shortWeekdayDate', function () {
  assert.equal(shortWeekdayDate(parseISO('2026-10-26')), 'Mon, Oct 26');
});

test('escapeHtml / formatBytes', function () {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(1572864), '1.5 MB');
});

if (!process.exitCode) console.log('test-utils: ' + n + ' tests passed');
