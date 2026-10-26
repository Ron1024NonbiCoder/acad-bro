/* Device-local preferences (not part of the synced data doc, like GymBro's
   settings.js). Live object: import { settings } and read it; change it only
   through setSetting() so it is persisted. */

export var SETTINGS_KEY = 'acadbro-settings-v1';

var DEFAULT_VIEWS = { all: 'grouped', living: 'grouped', prod: 'grouped', hobby: 'grouped' };
var VIEW_KINDS = { grouped: true, flat: true };
var DEFAULTS = { weekStart: 'mon', haptics: true, showCompleted: false };
var WEEK_STARTS = { mon: 1, sun: 0, sat: 6 }; /* -> Date#getDay() number */

function ls() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (err) { return null; } }

function load() {
  var out = { weekStart: DEFAULTS.weekStart, haptics: DEFAULTS.haptics, showCompleted: DEFAULTS.showCompleted, views: Object.assign({}, DEFAULT_VIEWS) };
  try {
    var raw = ls() && ls().getItem(SETTINGS_KEY);
    var p = raw ? JSON.parse(raw) : null;
    if (p && WEEK_STARTS[p.weekStart] !== undefined) out.weekStart = p.weekStart;
    if (p && typeof p.haptics === 'boolean') out.haptics = p.haptics;
    if (p && typeof p.showCompleted === 'boolean') out.showCompleted = p.showCompleted;
    if (p && p.views && typeof p.views === 'object') {
      Object.keys(DEFAULT_VIEWS).forEach(function (k) { if (VIEW_KINDS[p.views[k]]) out.views[k] = p.views[k]; });
    }
  } catch (err) { /* corrupt settings: defaults are harmless */ }
  return out;
}

export var settings = load();

/* returns false when the browser refused to store it (the change still applies
   for this session; the caller tells the user) */
export function setSetting(key, value) {
  settings[key] = value;
  try { ls().setItem(SETTINGS_KEY, JSON.stringify(settings)); return true; } catch (err) { return false; }
}

/* The task-list view for a page ('all' | 'living' | 'prod' | 'hobby'): 'grouped' | 'flat'.
   Remembered per page, per device. */
export function viewFor(page) { return settings.views[page] === 'flat' ? 'flat' : 'grouped'; }
export function setViewFor(page, view) {
  if (!VIEW_KINDS[view]) return false;
  return setSetting('views', Object.assign({}, settings.views, (function () { var o = {}; o[page] = view; return o; })()));
}

export function weekStartDow() { return WEEK_STARTS[settings.weekStart]; }
export var WEEK_START_LABELS = { mon: 'Monday', sun: 'Sunday', sat: 'Saturday' };
