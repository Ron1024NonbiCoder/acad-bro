/* localStorage persistence, the live DB object, JSON export/import, and the
   (stubbed) cloud-sync interface.

   Nothing here touches the DOM or imports shell.js, so node can test it with a
   localStorage shim. Failure is reported through `hooks` (main.js wires them to
   toasts) instead of imports, and callers re-render after a change themselves.

   No silent data loss (CLAUDE.md): unreadable stored data is copied to
   CORRUPT_KEY before anything can overwrite it, a failed write returns false
   and calls hooks.onSaveError, and a doc near the 1 MB Firestore limit warns. */

import { markDirty } from './sync-core.js';
import { todayISO } from './utils.js';

export var STORAGE_KEY = 'acadbro-data-v1';
export var CORRUPT_KEY = 'acadbro-data-corrupt';
export var SCHEMA = 1;
export var SIZE_WARN_BYTES = 800 * 1024; /* docs/DEV.md: warn at 800 KB (Firestore doc limit is 1 MB) */

/* Set by main.js: onSaveError(err), onSizeWarn(bytes). Both optional. */
export var hooks = { onSaveError: null, onSizeWarn: null };

/* Cloud sync arrives in M5. The seam: saveData() calls cloud.onLocalChange(DB)
   after a successful local write; M5 assigns it. applyCloudData() is the way
   a fetched cloud doc replaces local state. */
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
   one default the model promises (subtaskId null = the whole task). */
export function normalizeData(raw) {
  if (!isObj(raw) || raw.schema !== SCHEMA) return null;
  var d = Object.assign({}, raw);
  var def = defaultData();
  d.areaLabels = Object.assign({}, def.areaLabels, isObj(raw.areaLabels) ? raw.areaLabels : {});
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

var sizeWarned = false;
export function dataSizeBytes() {
  return new TextEncoder().encode(JSON.stringify(DB)).length;
}

/* Persist DB. Returns true on success. On failure the edit is still in memory
   for this session, hooks.onSaveError tells the user, and false lets the
   caller avoid claiming "Saved". */
export function saveData() {
  dataRev++;
  DB.updatedAt = new Date().toISOString();
  var json = JSON.stringify(DB);
  try {
    var store = ls();
    if (!store) throw new Error('storage unavailable');
    store.setItem(STORAGE_KEY, json);
  } catch (err) {
    if (hooks.onSaveError) hooks.onSaveError(err);
    return false;
  }
  /* "this device has edits the cloud may not have": cleared only by an
     acknowledged cloud write (M5) */
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
export function applyCloudData(raw) { return replaceData(raw); }

/* ================= export / import ================= */
export function snapshotJSON() { return JSON.stringify(DB); }

export function buildExport() {
  return {
    json: JSON.stringify(DB, null, 2),
    filename: 'acadbro-' + todayISO() + '.json',
    counts: countsOf(DB)
  };
}

/* { ok:true, data, counts } | { ok:false, error } -- errors say what to do */
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
  return { ok: true, data: data, counts: countsOf(data) };
}
