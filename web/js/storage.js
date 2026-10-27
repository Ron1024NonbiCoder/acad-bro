/* localStorage persistence, the live DB object, JSON export/import, and the
   cloud-sync seam.

   Nothing here touches the DOM or imports shell.js, so node can test it with a
   localStorage shim. Failure is reported through `hooks` (main.js wires them to
   toasts) instead of imports, and callers re-render after a change themselves.

   No silent data loss (CLAUDE.md): unreadable stored data is copied to
   CORRUPT_KEY before anything can overwrite it, a failed write returns false
   and calls hooks.onSaveError, and a doc near the 1 MB Firestore limit warns. */

import { markDirty } from './sync-core.js';
import { LIMITS } from './tasks-core.js';
import { todayISO } from './utils.js';

export var STORAGE_KEY = 'acadbro-data-v1';
export var CORRUPT_KEY = 'acadbro-data-corrupt';
export var SCHEMA = 1;
export var SIZE_WARN_BYTES = 800 * 1024; /* docs/DEV.md: warn at 800 KB (Firestore doc limit is 1 MB) */

/* Set by main.js: onSaveError(err), onSizeWarn(bytes), onExternalChange(info).
   All optional. onExternalChange fires after another tab's data replaced the
   in-memory DB; info.lostEdit = true when this tab's own edit was NOT applied. */
export var hooks = { onSaveError: null, onSizeWarn: null, onExternalChange: null };

/* The cloud-sync seam: saveData() calls cloud.onLocalChange(DB) after a
   successful local write; auth.js assigns it while signed in. applyCloudData()
   is the way a fetched cloud doc replaces local state. */
export var cloud = { onLocalChange: null };

function ls() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (err) { return null; } }
function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

/* ================= schema v1 ================= */
export function defaultData() {
  return {
    schema: SCHEMA,
    areaLabels: { living: 'Living', prod: 'Prod', hobby: 'Hobby' },
    projects: [],
    tasks: [],
    completions: [],
    updatedAt: null
  };
}

/* A usable v1 doc from raw parsed JSON, or null when it is not one. Fills
   missing fields with defaults and keeps unknown ones (a newer minor field
   survives a round trip). Items are kept as they are; only completions get the
   one default the model promises (subtaskId null = the whole task).
   Area labels are fixed (PO 2026-10-27, no rename): whatever the input says,
   the defaults win. The field stays in the doc because firestore.rules need it. */
export function normalizeData(raw) {
  if (!isObj(raw) || raw.schema !== SCHEMA) return null;
  var d = Object.assign({}, raw);
  var def = defaultData();
  d.areaLabels = def.areaLabels;
  ['projects', 'tasks', 'completions'].forEach(function (k) {
    d[k] = Array.isArray(raw[k]) ? raw[k].filter(isObj) : [];
  });
  d.completions = d.completions.map(function (c) {
    return c.subtaskId === undefined || c.subtaskId === null ? Object.assign({}, c, { subtaskId: null }) : c;
  });
  d.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
  return d;
}

export function countsOf(data) {
  return { projects: data.projects.length, tasks: data.tasks.length, completions: data.completions.length };
}

/* ================= storage ================= */
/* 'new' = nothing stored yet; 'ok' = loaded; 'recovered' = stored data was
   unreadable, defaults are in use and the original is kept at CORRUPT_KEY
   (corruptSaved says whether that copy could be written). main.js tells the user. */
export var loadStatus = { kind: 'new', corruptSaved: false, newerSchema: false };

export function loadData() {
  loadStatus = { kind: 'new', corruptSaved: false, newerSchema: false };
  var store = ls();
  var raw = null;
  try { raw = store ? store.getItem(STORAGE_KEY) : null; } catch (err) { raw = null; }
  if (raw) {
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (err) { parsed = null; }
    var data = normalizeData(parsed);
    if (data) { loadStatus.kind = 'ok'; return data; }
    loadStatus.kind = 'recovered';
    loadStatus.newerSchema = isObj(parsed) && typeof parsed.schema === 'number' && parsed.schema > SCHEMA;
    try { store.setItem(CORRUPT_KEY, raw); loadStatus.corruptSaved = true; } catch (err) { /* quota */ }
  }
  /* nothing is written yet: a fresh install stays unsynced-dirty-free until the first edit */
  return defaultData();
}

/* Bumped on every write and every wholesale swap, so caches can key on it. */
export var dataRev = 0;
export var DB = loadData();

/* ---- two tabs, one localStorage ----
   knownStamp = the updatedAt stored in localStorage the last time THIS tab read
   or wrote it. If the stored one differs when we are about to write, another
   tab saved in between: writing would silently overwrite its work, so we load
   its data instead and tell the user (hooks.onExternalChange). */
function storedStamp() {
  try {
    var store = ls();
    var raw = store ? store.getItem(STORAGE_KEY) : null;
    var o = raw ? JSON.parse(raw) : null;
    return isObj(o) && typeof o.updatedAt === 'string' ? o.updatedAt : null;
  } catch (err) { return null; }
}
var knownStamp = storedStamp();

/* Pure: is what is stored newer than what this tab last knew? Nothing stored =
   nothing to protect; stored but never known (this tab started empty) = stale. */
export function isStaleWrite(known, stored) {
  if (stored === null || stored === undefined) return false;
  if (known === null || known === undefined) return true;
  return stored > known;
}

/* Replace the in-memory DB with what localStorage holds. Returns true when the
   data changed. Unreadable / missing stored data leaves memory alone. */
export function reloadFromStorage() {
  var store = ls();
  var raw = null;
  try { raw = store ? store.getItem(STORAGE_KEY) : null; } catch (err) { raw = null; }
  if (!raw) return false;
  var parsed = null;
  try { parsed = JSON.parse(raw); } catch (err) { return false; }
  var d = normalizeData(parsed);
  if (!d) return false;
  DB = d;
  dataRev++;
  knownStamp = d.updatedAt;
  return true;
}

/* Another tab changed localStorage ('storage' event, wired in main.js). */
export function onStorageEvent(e) {
  if (e && e.key !== null && e.key !== undefined && e.key !== STORAGE_KEY) return false;
  if (!isStaleWrite(knownStamp, storedStamp())) return false;
  if (!reloadFromStorage()) return false;
  if (hooks.onExternalChange) hooks.onExternalChange({ lostEdit: false });
  return true;
}

/* Cheap guard before sync reads the DB: pull in newer data from another tab. */
export function syncDBFromStorage() {
  if (!isStaleWrite(knownStamp, storedStamp())) return false;
  if (!reloadFromStorage()) return false;
  if (hooks.onExternalChange) hooks.onExternalChange({ lostEdit: false });
  return true;
}

/* Set by every saveData(): reloaded = this tab's edit was NOT written because
   another tab had saved newer data (callers that roll back must then leave the
   freshly loaded data alone). */
export var saveInfo = { reloaded: false };

var sizeWarned = false;
export function dataSizeBytes() {
  return new TextEncoder().encode(JSON.stringify(DB)).length;
}

/* Persist DB. Returns true on success. On failure the edit is still in memory
   for this session, hooks.onSaveError tells the user, and false lets the
   caller avoid claiming "Saved". */
export function saveData() {
  saveInfo.reloaded = false;
  if (isStaleWrite(knownStamp, storedStamp()) && reloadFromStorage()) {
    saveInfo.reloaded = true;
    if (hooks.onExternalChange) hooks.onExternalChange({ lostEdit: true });
    return false;
  }
  dataRev++;
  DB.updatedAt = new Date().toISOString();
  var json = JSON.stringify(DB);
  try {
    var store = ls();
    if (!store) throw new Error('storage unavailable');
    store.setItem(STORAGE_KEY, json);
    knownStamp = DB.updatedAt;
  } catch (err) {
    if (hooks.onSaveError) hooks.onSaveError(err);
    return false;
  }
  /* "this device has edits the cloud may not have": cleared only by an
     acknowledged cloud write (auth.js) */
  markDirty();
  var bytes = new TextEncoder().encode(json).length;
  if (bytes >= SIZE_WARN_BYTES) {
    if (!sizeWarned && hooks.onSizeWarn) hooks.onSizeWarn(bytes);
    sizeWarned = true;
  } else {
    sizeWarned = false;
  }
  if (cloud.onLocalChange) cloud.onLocalChange(DB);
  return true;
}

/* Swap the whole doc (import, undo of an import, cloud doc). Returns false,
   leaving DB untouched, when raw is not a usable v1 doc. Does not save. */
export function replaceData(raw) {
  var d = normalizeData(raw);
  if (!d) return false;
  DB = d;
  dataRev++;
  return true;
}
/* A cloud doc becomes the local state. Unlike saveData() this is NOT an edit:
   it must not mark the device dirty or restamp updatedAt, or every launch
   would look like it had unsynced changes.
   -> { ok, persisted }
      ok = false: raw is not a usable v1 doc; DB is untouched.
      ok = true, persisted = false: the cloud data is live in memory but could
      NOT be written to this device. The caller must not record "synced" (BASE,
      owner, dirty) and must tell the user; nothing is reported from here. */
export function applyCloudData(raw) {
  if (!replaceData(raw)) return { ok: false, persisted: false };
  try {
    var store = ls();
    if (!store) throw new Error('storage unavailable');
    store.setItem(STORAGE_KEY, JSON.stringify(DB));
    knownStamp = DB.updatedAt;
  } catch (err) {
    return { ok: true, persisted: false };
  }
  return { ok: true, persisted: true };
}

/* ================= export / import ================= */
export function snapshotJSON() { return JSON.stringify(DB); }

export function buildExport() {
  return {
    json: JSON.stringify(DB, null, 2),
    filename: 'acadbro-' + todayISO() + '.json',
    counts: countsOf(DB)
  };
}

/* ---- import limits (tasks-core LIMITS), checked before anything is applied ---- */
export var MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/* A message when the chosen file is too big to read, else null. Checked on
   file.size BEFORE the text is read or parsed. */
export function importSizeError(bytes) {
  if (bytes <= MAX_IMPORT_BYTES) return null;
  return 'This file is ' + (bytes / 1048576).toFixed(1) + ' MB. AcadBro imports files up to '
    + (MAX_IMPORT_BYTES / 1048576) + ' MB; please choose an AcadBro export.';
}

function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
function strLen(v) { return typeof v === 'string' ? v.length : 0; }

/* Everything in `data` that is over LIMITS, as positive, precise sentences
   (empty array = fine). Nothing is trimmed: the import is refused instead. */
export function importLimitProblems(data) {
  var out = [];
  if (data.tasks.length > LIMITS.tasks) {
    out.push('This file has ' + plural(data.tasks.length, 'task') + '. AcadBro holds up to ' + LIMITS.tasks + '; please trim the file and import again.');
  }
  if (data.projects.length > LIMITS.projects) {
    out.push('This file has ' + plural(data.projects.length, 'project') + '. AcadBro holds up to ' + LIMITS.projects + '; please trim the file and import again.');
  }
  var longNames = 0, longNotes = 0, manySubs = 0, maxName = 0, maxNote = 0, maxSubs = 0;
  function name(s) { var n = strLen(s); if (n > LIMITS.name) { longNames++; if (n > maxName) maxName = n; } }
  function note(s) { var n = strLen(s); if (n > LIMITS.note) { longNotes++; if (n > maxNote) maxNote = n; } }
  data.projects.forEach(function (p) { name(p.name); note(p.note); });
  data.tasks.forEach(function (t) {
    name(t.title); note(t.note);
    var subs = Array.isArray(t.subtasks) ? t.subtasks : [];
    if (subs.length > LIMITS.subtasks) { manySubs++; if (subs.length > maxSubs) maxSubs = subs.length; }
    subs.forEach(function (st) { if (isObj(st)) name(st.title); });
  });
  if (longNames) {
    out.push(plural(longNames, 'name') + ' in this file ' + (longNames === 1 ? 'is' : 'are') + ' over ' + LIMITS.name
      + ' characters (the longest has ' + maxName + '). Please shorten ' + (longNames === 1 ? 'it' : 'them') + ' and import again.');
  }
  if (longNotes) {
    out.push(plural(longNotes, 'note') + ' in this file ' + (longNotes === 1 ? 'is' : 'are') + ' over ' + LIMITS.note
      + ' characters (the longest has ' + maxNote + '). Please shorten ' + (longNotes === 1 ? 'it' : 'them') + ' and import again.');
  }
  if (manySubs) {
    out.push(plural(manySubs, 'task') + ' in this file ' + (manySubs === 1 ? 'has' : 'have') + ' more than ' + LIMITS.subtasks
      + ' subtasks (the most is ' + maxSubs + '). AcadBro holds up to ' + LIMITS.subtasks + ' per task; please trim and import again.');
  }
  return out;
}

/* { ok:true, data, counts, problems } | { ok:false, error } -- errors say what
   to do. `problems` lists limit overruns; when it is not empty the caller must
   not apply `data` (the preview sheet shows them instead of the Replace button). */
export function parseImport(text) {
  var parsed;
  try { parsed = JSON.parse(text); } catch (err) {
    return { ok: false, error: 'Choose a JSON file exported from AcadBro.' };
  }
  if (isObj(parsed) && typeof parsed.schema === 'number' && parsed.schema > SCHEMA) {
    return { ok: false, error: 'This file is from a newer AcadBro. Update the app, then import it again.' };
  }
  var data = normalizeData(parsed);
  if (!data) return { ok: false, error: 'Choose a JSON file exported from AcadBro (Settings > Export).' };
  return { ok: true, data: data, counts: countsOf(data), problems: importLimitProblems(data) };
}
