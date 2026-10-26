/* Device-local preferences (not part of the synced data doc, like GymBro's
   settings.js). Live object: import { settings } and read it; change it only
   through setSetting() so it is persisted. */

export var SETTINGS_KEY = 'acadbro-settings-v1';

var DEFAULTS = { weekStart: 'mon', haptics: true };
var WEEK_STARTS = { mon: 1, sun: 0, sat: 6 }; /* -> Date#getDay() number */

function ls() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (err) { return null; } }

function load() {
  var out = { weekStart: DEFAULTS.weekStart, haptics: DEFAULTS.haptics };
  try {
    var raw = ls() && ls().getItem(SETTINGS_KEY);
    var p = raw ? JSON.parse(raw) : null;
    if (p && WEEK_STARTS[p.weekStart] !== undefined) out.weekStart = p.weekStart;
    if (p && typeof p.haptics === 'boolean') out.haptics = p.haptics;
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

export function weekStartDow() { return WEEK_STARTS[settings.weekStart]; }
export var WEEK_START_LABELS = { mon: 'Monday', sun: 'Sunday', sat: 'Saturday' };
