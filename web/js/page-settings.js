/* Settings view: week start, haptics, JSON export / import, account (page-account.js).
   Every change tells the user (toast); changes carry Undo, and undoing raises a
   Redo toast. Import is two-step (preview in the bottom sheet, then confirm),
   keeps a recovery copy of what it replaces, and is undoable. */

import { ui } from './state.js';
import { settings, setSetting, WEEK_START_LABELS } from './settings.js';
import {
  DB, buildExport, countsOf, dataSizeBytes, importSizeError, parseImport, replaceData, saveData, saveInfo, snapshotJSON
} from './storage.js';
import { downloadFile } from './download.js';
import { render } from './shell.js';
import { showToast } from './toast.js';
import { escapeHtml, formatBytes } from './utils.js';
import { renderAccountRows } from './page-account.js';

export var IMPORT_BACKUP_KEY = 'acadbro-import-backup';

function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
function countsText(c) { return plural(c.projects, 'project') + ', ' + plural(c.tasks, 'task'); }

/* ================= view ================= */
function pill() { return '<span class="settings-pill" aria-hidden="true"></span>'; }

export function renderSettingsView() {
  var c = countsOf(DB);
  var seg = ['mon', 'sun', 'sat'].map(function (k) {
    return '<button type="button" class="segmented-btn' + (settings.weekStart === k ? ' is-on' : '')
      + '" data-action="set-week-start" data-value="' + k + '" aria-pressed="' + (settings.weekStart === k) + '">'
      + WEEK_START_LABELS[k].slice(0, 3) + '</button>';
  }).join('');
  return '<div class="settings-head">'
    + '<button type="button" class="icon-btn" data-action="close-settings" aria-label="Back" title="Back">&#8249;</button>'
    + '<h2 class="settings-title">Settings</h2></div>'

    + '<div class="settings-group-label">Preferences</div>'
    + '<div class="settings-rows">'
    + '<div class="settings-row"><div class="settings-row-text"><span class="settings-row-label">Week starts on</span></div>'
    + '<div class="segmented" role="group" aria-label="Week starts on">' + seg + '</div></div>'
    + '<button type="button" class="settings-row settings-toggle-row' + (settings.haptics ? ' is-on' : '') + '" data-action="toggle-haptics" role="switch" aria-checked="' + settings.haptics + '">'
    + '<span class="settings-row-text"><span class="settings-row-label">Haptic feedback</span>'
    + '<span class="settings-row-hint">Short vibration on taps and swipes</span></span>' + pill() +'</button>'
    + '</div>'

    + '<div class="settings-group-label">Data</div>'
    + '<div class="settings-rows">'
    + '<button type="button" class="settings-row" data-action="export-data">'
    + '<span class="settings-row-text"><span class="settings-row-label">Export data</span>'
    + '<span class="settings-row-hint">' + escapeHtml(countsText(c)) + ' &middot; ' + formatBytes(dataSizeBytes()) + ' &middot; JSON</span></span>'
    + '<span class="settings-row-chevron" aria-hidden="true">&#8595;</span></button>'
    + '<label class="settings-row" for="import-file">'
    + '<span class="settings-row-text"><span class="settings-row-label">Import data</span>'
    + '<span class="settings-row-hint">Replaces this device\'s data after you confirm</span></span>'
    + '<span class="settings-row-chevron" aria-hidden="true">&#8593;</span>'
    + '<input type="file" id="import-file" accept="application/json,.json" hidden></label>'
    + '</div>'

    + '<div class="settings-group-label">Account</div>'
    + '<div class="settings-rows" id="account-rows">' + renderAccountRows() + '</div>';
}

/* the import preview, shown in the bottom sheet */
export function importSheetHtml(sheet) {
  var now = countsOf(DB);
  var problems = sheet.problems || [];
  var head = '<div class="import-preview">'
    + '<div class="import-file">' + escapeHtml(sheet.fileName) + '</div>'
    + '<div class="import-counts">' + escapeHtml(countsText(sheet.counts)) + ', ' + plural(sheet.counts.completions, 'completion') + '</div>';
  if (problems.length) {
    /* over the limits: nothing is applied or trimmed; say exactly what to fix */
    return head
      + problems.map(function (m) { return '<p class="settings-note import-problem">' + escapeHtml(m) + '</p>'; }).join('')
      + '<p class="settings-note">Your current data stays as it is.</p>'
      + '<div class="editor-actions"><button type="button" class="btn primary" data-action="close-sheet">Got it</button></div></div>';
  }
  return head
    + '<p class="settings-note">This replaces your current data (' + escapeHtml(countsText(now)) + '). You can undo it right after.</p>'
    + '<div class="editor-actions">'
    + '<button type="button" class="btn primary" data-action="confirm-import">Replace data</button>'
    + '<button type="button" class="btn" data-action="close-sheet">Cancel</button>'
    + '</div></div>';
}

/* ================= preferences ================= */
/* One path for change / Undo / Redo: each call applies `value`, then toasts with
   a button that applies `other` (the opposite direction). */
function applySetting(key, value, other, label, message) {
  var ok = setSetting(key, value);
  render();
  showToast({
    message: ok ? message(value) : message(value) + ' for this session only. Allow site storage to keep it.',
    tone: ok ? undefined : 'warn',
    actions: [{ label: label, primary: true, onClick: function () {
      applySetting(key, other, value, label === 'Undo' ? 'Redo' : 'Undo', message);
    } }]
  });
}

export function changeWeekStart(value) {
  if (!WEEK_START_LABELS[value] || value === settings.weekStart) return;
  applySetting('weekStart', value, settings.weekStart, 'Undo', function (v) { return 'Week starts on ' + WEEK_START_LABELS[v]; });
}

export function toggleHaptics() {
  applySetting('haptics', !settings.haptics, settings.haptics, 'Undo', function (v) { return v ? 'Haptics on' : 'Haptics off'; });
}

/* ================= export ================= */
export function exportData() {
  var out = buildExport();
  if (!downloadFile(out.filename, out.json)) {
    showToast({ message: 'Export did not start. Try again, or use a different browser.', tone: 'warn' });
    return;
  }
  showToast({ message: 'Exported ' + countsText(out.counts) + ' to ' + out.filename, tone: 'good' });
}

/* ================= import ================= */
export async function onImportFile(file) {
  if (!file) return;
  var sizeErr = importSizeError(file.size);
  if (sizeErr) { showToast({ message: sizeErr, tone: 'warn' }); return; }
  var text;
  try { text = await file.text(); } catch (err) {
    showToast({ message: 'That file could not be read. Choose it again.', tone: 'warn' });
    return;
  }
  var res = parseImport(text);
  if (!res.ok) { showToast({ message: res.error, tone: 'warn' }); return; }
  ui.sheet = { type: 'import', fileName: file.name, counts: res.counts, data: res.data, problems: res.problems };
  render();
}

function applyImport(data, prevJSON, redo, noBackupOk) {
  /* a recovery copy first: if the page dies mid-import the old data is still here */
  var backedUp = true;
  try { localStorage.setItem(IMPORT_BACKUP_KEY, prevJSON); } catch (err) { backedUp = false; }
  if (!backedUp && !noBackupOk) {
    /* never import without telling: the user picks, nothing changes until then */
    showToast({
      message: 'No room to keep a backup of your current data; Undo in the next toast is the only way back. Import anyway?',
      tone: 'warn',
      actions: [
        { label: 'Import', primary: true, onClick: function () { applyImport(data, snapshotJSON(), redo, true); } }, /* fresh snapshot: edits made meanwhile are what Undo restores */
        { label: 'Cancel', onClick: function () { showToast({ message: 'Import cancelled. Your data is unchanged.' }); } }
      ]
    });
    return;
  }
  replaceData(data);
  if (!saveData()) {
    if (!saveInfo.reloaded) replaceData(JSON.parse(prevJSON)); /* newer data from another tab stays */
    render();
    showToast({ message: 'Import not saved. Your current data is unchanged.', tone: 'warn' });
    return;
  }
  render();
  showToast({
    message: (redo ? 'Import applied: ' : 'Imported ') + countsText(countsOf(DB)),
    tone: 'good',
    actions: [{ label: 'Undo', primary: true, onClick: function () { undoImport(data, prevJSON); } }]
  });
}

function undoImport(data, prevJSON) {
  replaceData(JSON.parse(prevJSON));
  var ok = saveData();
  render();
  showToast({
    message: ok ? 'Import undone: ' + countsText(countsOf(DB)) : 'Import undone on screen but not saved. Export your data to be safe.',
    tone: ok ? undefined : 'warn',
    actions: [{ label: 'Redo', primary: true, onClick: function () { applyImport(data, snapshotJSON(), true); } }]
  });
}

export function confirmImport() {
  var sheet = ui.sheet;
  if (!sheet || sheet.type !== 'import') return;
  if (sheet.problems && sheet.problems.length) return; /* over the limits: never applied */
  ui.sheet = null;
  applyImport(sheet.data, snapshotJSON(), false);
}
