/* Account UI: the Settings > Account rows, the header sync dot, and the three
   bottom sheets that belong to sync (log in, the conflict choice, restoring a
   recovery copy). Pure rendering + user actions; the sync loop itself is
   auth.js, reached only through cloud.js.

   Live status changes patch two nodes in place (#account-rows and #sync-dot)
   instead of calling render(): render() rewrites the sheet body, which would
   wipe a half-typed login form, and a full repaint under the finger is the
   kind of jump CLAUDE.md rules out. */

import { ui, clearActive } from './state.js';
import {
  DB, countsOf, replaceData, saveData, saveInfo, snapshotJSON
} from './storage.js';
import {
  backupAccess, clearConflictBackup, isDirty, readConflictBackup, readOwner, saveConflictBackup
} from './sync-core.js';
import {
  actions, answerReplaceRecovery, sync, syncSummary, onSyncChange, cloudLogin, cloudLogout, cloudSyncNow,
  cloudChoose, ensureBackend, reloadApp
} from './cloud.js';
import { render, closeSheet } from './shell.js';
import { showToast } from './toast.js';
import { downloadFile } from './download.js';
import { escapeHtml, shortWeekdayDate, pad2, todayISO } from './utils.js';

var EMAIL_HINT = 'Please enter a valid email, like name@example.com';

function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
function countsText(c) { return plural(c.projects, 'project') + ', ' + plural(c.tasks, 'task'); }
function when(ms) {
  if (ms === null || ms === undefined) return 'unknown time';
  var d = new Date(ms);
  return shortWeekdayDate(d) + ' · ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* ================= Settings > Account rows ================= */
function dotHtml(kind) { return '<span class="sync-dot-fill is-' + kind + '" aria-hidden="true"></span>'; }

function backupRowHtml() {
  var b = readConflictBackup();
  if (!b) return '';
  var c = countsOf(normalizedCounts(b.data));
  var access = backupAccess(b, sync.uid);
  var hint = (access.label ? access.label + ' · ' : '') + backupSource(b) + ' · ' + when(b.at) + ' · ' + countsText(c);
  return '<button type="button" class="settings-row" data-action="open-restore">'
    + '<span class="settings-row-text"><span class="settings-row-label">Recovery copy</span>'
    + '<span class="settings-row-hint' + (access.label ? ' is-warn' : '') + '">' + escapeHtml(hint) + '</span></span>'
    + '<span class="settings-row-chevron" aria-hidden="true">&#8250;</span></button>';
}
function normalizedCounts(data) {
  return {
    projects: Array.isArray(data && data.projects) ? data.projects : [],
    tasks: Array.isArray(data && data.tasks) ? data.tasks : [],
    completions: Array.isArray(data && data.completions) ? data.completions : []
  };
}
function backupSource(b) {
  if (b.kept === 'cloud') return 'From this device';
  if (b.kept === 'local') return 'From the cloud';
  return 'Before a restore';
}

export function renderAccountRows() {
  var out;
  if (!sync.user) {
    if (sync.phase === 'loading') {
      out = '<div class="settings-row is-static is-muted"><span class="settings-row-text">'
        + '<span class="settings-row-label">Log in</span>'
        + '<span class="settings-row-hint">Loading the sign-in service...</span></span></div>';
    } else if (syncSummary(Date.now()).kind === 'paused') {
      /* signed in before, but the service did not load: say edits are waiting, offer a retry */
      var paused = syncSummary(Date.now());
      out = '<button type="button" class="settings-row" data-action="retry-sdk">'
        + '<span class="settings-row-text"><span class="settings-row-label">' + escapeHtml(paused.text) + '</span>'
        + '<span class="settings-row-hint is-warn">' + (sync.reloadAdvised ? 'Connection is back. Tap to reload and resume syncing.' : 'Your changes stay on this device. Tap to try again.') + '</span></span>'
        + dotHtml('paused') + '</button>';
    } else {
      var unavailable = sync.phase === 'unavailable';
      out = '<button type="button" class="settings-row" data-action="open-login">'
        + '<span class="settings-row-text"><span class="settings-row-label">' + (unavailable ? 'Sign-in unavailable' : 'Log in') + '</span>'
        + '<span class="settings-row-hint">' + (unavailable ? 'Please check your connection, then tap to try again.' : 'Optional. Syncs your data across devices.') + '</span></span>'
        + '<span class="settings-row-chevron" aria-hidden="true">&#8250;</span></button>';
    }
  } else {
    var s = syncSummary(Date.now());
    var busy = s.kind === 'syncing' || s.kind === 'loading' || s.kind === 'attention';
    out = '<div class="settings-row is-static"><span class="settings-row-text">'
      + '<span class="settings-row-label account-email">' + escapeHtml(sync.user) + '</span>'
      + '<span class="settings-row-hint' + (s.kind === 'error' || s.kind === 'attention' || s.kind === 'offline' ? ' is-warn' : '') + '">' + escapeHtml(s.text) + '</span></span>'
      + dotHtml(s.kind) + '</div>'
      + nextStepRow(busy)
      + '<button type="button" class="settings-row" data-action="log-out">'
      + '<span class="settings-row-text"><span class="settings-row-label">Log out</span>'
      + '<span class="settings-row-hint">Your data stays on this device.</span></span></button>';
  }
  return out + backupRowHtml();
}

/* The row under the status line is the next step for the current problem:
   Log in again (session ended), Reload (newer cloud data), else Sync now. */
function nextStepRow(busy) {
  var kind = sync.error && sync.error.kind;
  if (kind === 'auth') {
    return '<button type="button" class="settings-row" data-action="relogin">'
      + '<span class="settings-row-text"><span class="settings-row-label">Log in again</span>'
      + '<span class="settings-row-hint">Changes not yet synced stay on this device.</span></span>'
      + '<span class="settings-row-chevron" aria-hidden="true">&#8250;</span></button>';
  }
  if (kind === 'format') {
    return '<button type="button" class="settings-row" data-action="reload-app">'
      + '<span class="settings-row-text"><span class="settings-row-label">Reload app</span>'
      + '<span class="settings-row-hint">Gets the newest version, then syncs.</span></span>'
      + '<span class="settings-row-chevron" aria-hidden="true">&#8635;</span></button>';
  }
  return '<button type="button" class="settings-row' + (busy ? ' is-muted' : '') + '" data-action="sync-now"' + (busy ? ' aria-disabled="true"' : '') + '>'
    + '<span class="settings-row-text"><span class="settings-row-label">Sync now</span></span>'
    + '<span class="settings-row-chevron" aria-hidden="true">&#8635;</span></button>';
}

export function refreshAccountSection() {
  var el = document.getElementById('account-rows');
  if (el) el.innerHTML = renderAccountRows();
}

/* ================= header sync dot ================= */
export function refreshSyncDot() {
  var el = document.getElementById('sync-dot');
  if (!el) return;
  var s = syncSummary(Date.now());
  el.classList.toggle('hidden', s.kind === 'off');
  if (s.kind === 'off') return;
  var fill = el.querySelector('.sync-dot-fill');
  if (fill) fill.className = 'sync-dot-fill is-' + s.kind;
  var label = 'Sync: ' + s.text;
  el.setAttribute('title', label);
  el.setAttribute('aria-label', label);
}

/* ================= bottom sheets ================= */
export function accountSheet(sheet) {
  if (!sheet) return null;
  if (sheet.type === 'login') return { title: sheet.relogin ? 'Log in again' : 'Log in', html: loginHtml(sheet) };
  if (sheet.type === 'conflict' && sync.conflict) return { title: 'Two versions found', html: conflictHtml(sync.conflict) };
  if (sheet.type === 'replace-recovery' && sync.replaceAsk) return { title: 'Recovery copy in use', html: replaceAskHtml(sync.replaceAsk) };
  if (sheet.type === 'restore') return { title: 'Recovery copy', html: restoreHtml(sheet) };
  return null;
}

function loginHtml(sheet) {
  var note = sheet && sheet.relogin
    ? '<p class="settings-note">' + (isDirty() ? 'Changes not yet synced stay on this device and are sent once you are logged in.' : 'Your data stays on this device while you log in.') + '</p>'
    : '';
  return '<div class="login-form">' + note
    + '<label class="field-label" for="login-email">Email</label>'
    + '<input id="login-email" type="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" placeholder="name@example.com" data-login-field'
    + (sheet && sheet.email ? ' value="' + escapeHtml(sheet.email) + '"' : '') + '>'
    + '<label class="field-label" for="login-password">Password</label>'
    + '<input id="login-password" type="password" autocomplete="current-password" data-login-field>'
    + '<p class="form-error" id="login-error" role="alert"></p>'
    + '<div class="editor-actions">'
    + '<button type="button" class="btn primary" id="login-submit" data-action="submit-login">Log in</button>'
    + '<button type="button" class="btn" data-action="close-sheet">Cancel</button></div>'
    + '<p class="settings-note">Accounts are set up by the app owner.</p>'
    + '</div>';
}

function conflictHtml(c) {
  return '<p class="settings-note">Both versions changed. Pick one; the other is kept as a recovery copy.</p>'
    + '<div class="conflict-cards">'
    + '<div class="conflict-card"><span class="conflict-card-title">This device</span>'
    + '<span>' + escapeHtml(countsText(c.localCounts)) + '</span>'
    + '<span class="conflict-when">Edited ' + escapeHtml(when(c.localMs)) + '</span></div>'
    + '<div class="conflict-card"><span class="conflict-card-title">Cloud</span>'
    + '<span>' + escapeHtml(countsText(c.cloudCounts)) + '</span>'
    + '<span class="conflict-when">Updated ' + escapeHtml(when(c.cloudMs)) + '</span></div></div>'
    + '<p class="form-error" id="conflict-error" role="alert"></p>'
    + '<div class="editor-actions">'
    + '<button type="button" class="btn primary" data-action="conflict-keep-local">Keep this device</button>'
    + '<button type="button" class="btn" data-action="conflict-keep-cloud">Keep cloud copy</button></div>';
}

function restoreHtml(sheet) {
  var b = readConflictBackup();
  if (!b) return '<p class="settings-note">No recovery copy is stored.</p>';
  var c = normalizedCounts(b.data);
  var now = countsOf(DB);
  var access = backupAccess(b, sync.uid);
  var discard = sheet.confirmDiscard
    ? '<div class="confirm-box"><div>Discard this recovery copy for good?</div><div class="editor-actions">'
      + '<button type="button" class="btn danger" data-action="confirm-discard-recovery">Discard</button>'
      + '<button type="button" class="btn" data-action="cancel-discard-recovery">Keep</button></div></div>'
    : '<div class="editor-actions">'
      + (access.canRestore ? '<button type="button" class="btn primary" data-action="confirm-restore">Restore this copy</button>' : '')
      + '<button type="button" class="btn' + (access.canRestore ? '' : ' primary') + '" data-action="export-recovery">Export this copy</button>'
      + '<button type="button" class="btn danger" data-action="discard-recovery">Discard</button></div>';
  return '<div class="import-preview">'
    + '<div class="import-file">' + escapeHtml(backupSource(b)) + '</div>'
    + '<div class="import-counts">' + escapeHtml(when(b.at) + ' · ' + countsText(countsOf(c)) + ', ' + plural(c.completions.length, 'completion')) + '</div>'
    + (access.canRestore
      ? '<p class="settings-note">Restoring replaces your current data (' + escapeHtml(countsText(now)) + '), which is kept as a new recovery copy.</p>'
      : '<p class="settings-note is-warn">' + escapeHtml(access.label) + '. Log in with that account to restore it. You can still export it.</p>')
    + discard + '</div>';
}

/* ask before an occupied recovery slot is replaced (the slot holds ONE copy) */
function replaceAskHtml(ask) {
  var b = readConflictBackup();
  var why = ask.reason === 'conflict'
    ? 'Keeping one version saves the other as the recovery copy.'
    : 'Logging in saves the data on this device as the recovery copy.';
  var held = '';
  if (b) {
    var c = normalizedCounts(b.data);
    var access = backupAccess(b, sync.uid);
    held = '<div class="import-preview"><div class="import-file">' + escapeHtml(backupSource(b)) + (access.label ? ' · ' + escapeHtml(access.label) : '') + '</div>'
      + '<div class="import-counts">' + escapeHtml(when(b.at) + ' · ' + countsText(countsOf(c))) + '</div></div>';
  }
  return '<p class="settings-note">' + why + ' There is room for one, and it holds this:</p>' + held
    + '<div class="editor-actions">'
    + '<button type="button" class="btn primary" data-action="ask-export">Export the current recovery copy first</button>'
    + '<button type="button" class="btn danger" data-action="ask-replace">Replace it</button>'
    + '<button type="button" class="btn" data-action="ask-cancel">Cancel</button></div>';
}

/* ================= login ================= */
function openLoginSheet(extra) {
  clearActive();
  ui.sheet = Object.assign({ type: 'login', busy: false }, extra || {});
  render();
  /* after the slide-in, so the keyboard does not fight the animation */
  setTimeout(function () {
    var el = document.getElementById(ui.sheet && ui.sheet.email ? 'login-password' : 'login-email');
    if (el && ui.sheet && ui.sheet.type === 'login') el.focus();
  }, 340);
}

/* The session ended: log in again. Not-yet-synced changes stay on this device
   and the sheet says so. */
export function openRelogin() {
  openLoginSheet({ relogin: true, email: sync.user || '' });
}

export function openLogin() {
  if (sync.user) return;
  if (sync.phase === 'ready') { openLoginSheet(); return; }
  ensureBackend().then(function (ok) {
    if (ok) openLoginSheet();
    else showToast({
      message: 'Could not load the sign-in service. Please check your connection, then try again.',
      tone: 'warn',
      actions: [{ label: 'Retry', primary: true, onClick: openLogin }]
    });
  });
}

/* ---- the sign-in service did not load: retry, then offer a reload ---- */
var sdkFailures = 0;
export function reportSignInUnavailable() {
  sdkFailures++;
  var again = sdkFailures >= 2;
  showToast({
    message: again
      ? 'The sign-in service still did not load. Your changes stay on this device. Please check your connection, retry, or reload the app.'
      : 'Cloud sync is paused: the sign-in service did not load. Your changes stay on this device and sync once it is back.',
    tone: 'warn',
    actions: [{ label: 'Retry', primary: true, onClick: retrySignInService }].concat(again ? [{ label: 'Reload', onClick: reloadApp }] : [])
  });
}
export function retrySignInService() {
  /* the page cannot retry the import any more, but the SDK host answers: reload */
  if (sync.reloadAdvised) { reloadApp(); return; }
  ensureBackend().then(function (ok) {
    if (ok) {
      sdkFailures = 0;
      showToast({ message: 'Sign-in service loaded. Sync resumes now.', tone: 'good' });
    } else {
      reportSignInUnavailable();
    }
  });
}
export function reloadAppClicked() { reloadApp(); }

function showFormError(id, msg) {
  var el = document.getElementById(id);
  if (el) el.textContent = msg;
}
function fieldValue(id) { var el = document.getElementById(id); return el ? el.value : ''; }

export function submitLogin() {
  if (!ui.sheet || ui.sheet.type !== 'login' || ui.sheet.busy) return;
  var email = fieldValue('login-email').trim();
  var password = fieldValue('login-password');
  var problem = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? EMAIL_HINT : (!password ? 'Please enter your password.' : '');
  if (problem) {
    showFormError('login-error', problem);
    var f = document.getElementById(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'login-email' : 'login-password');
    if (f) f.focus();
    return;
  }
  showFormError('login-error', '');
  var sheet = ui.sheet;
  sheet.busy = true;
  setBusy(true);
  cloudLogin(email, password).then(function (res) {
    sheet.busy = false;
    if (ui.sheet !== sheet) return; /* the sheet changed meanwhile (e.g. the conflict choice opened) */
    setBusy(false);
    if (res.ok) closeSheet();
    else showFormError('login-error', res.error);
  });
}
function setBusy(on) {
  var b = document.getElementById('login-submit');
  if (!b) return;
  b.disabled = on;
  b.textContent = on ? 'Logging in...' : 'Log in';
}

export function logOut() {
  cloudLogout().then(function (res) {
    if (!res.ok) { showToast({ message: res.error, tone: 'warn' }); return; }
    showToast(res.unsynced
      ? { message: 'Logged out. Changes not yet synced stay on this device. Log in again to send them.', tone: 'warn' }
      : { message: 'Logged out. Your data stays on this device.' });
  });
}

export function syncNowClicked() {
  var s = syncSummary(Date.now());
  if (s.kind === 'syncing' || s.kind === 'loading' || s.kind === 'attention') return;
  cloudSyncNow();
}

/* ================= conflict choice ================= */
export function chooseVersion(which) {
  Promise.resolve(cloudChoose(which)).then(function (res) {
    if (res && res.ok === false && !res.cancelled) showFormError('conflict-error', res.error || 'Please try again.');
  });
}

/* ================= recovery copy ================= */
export function openRestore() {
  if (!readConflictBackup()) { refreshAccountSection(); return; }
  clearActive();
  ui.sheet = { type: 'restore', confirmDiscard: false };
  render();
}
export function setDiscardConfirm(on) {
  if (!ui.sheet || ui.sheet.type !== 'restore') return;
  ui.sheet.confirmDiscard = on;
  render();
}
/* Download the recovery copy as an AcadBro JSON file (importable from Settings). */
export function exportRecoveryCopy() {
  var b = readConflictBackup();
  if (!b) { showToast({ message: 'No recovery copy is stored.', tone: 'warn' }); return; }
  var name = 'acadbro-recovery-' + todayISO() + '.json';
  if (!downloadFile(name, JSON.stringify(b.data, null, 2))) {
    showToast({ message: 'Export did not start. Try again, or use a different browser.', tone: 'warn' });
    return;
  }
  showToast({ message: 'Exported the recovery copy (' + countsText(countsOf(normalizedCounts(b.data))) + ') to ' + name, tone: 'good' });
}
export function askAnswer(replace) { answerReplaceRecovery(replace); }

export function confirmDiscardRecovery() {
  clearConflictBackup();
  ui.sheet = null;
  render();
  showToast({ message: 'Recovery copy discarded.' });
}

/* Restoring SWAPS: the recovery copy goes live and the data it replaces becomes
   the new recovery copy, so Undo is the same operation again and nothing is
   ever dropped. */
function swapWithRecovery(isUndo) {
  var b = readConflictBackup();
  if (!b) { showToast({ message: 'No recovery copy is stored.', tone: 'warn' }); return false; }
  /* another account's copy is never restored here (Undo of our own swap is exempt:
     it puts back what this very restore replaced) */
  if (!isUndo && !backupAccess(b, sync.uid).canRestore) {
    showToast({ message: 'This recovery copy belongs to another account, so it cannot be restored here. You can still export it.', tone: 'warn' });
    return false;
  }
  var prevJSON = snapshotJSON();
  var prev = JSON.parse(prevJSON);
  if (!saveConflictBackup('restore', prev, readOwner())) {
    showToast({ message: 'Could not keep your current data safe first (device storage is full), so nothing was changed. Please export your data, then try again.', tone: 'warn' });
    return false;
  }
  if (!replaceData(b.data)) {
    saveConflictBackup(b.kept, b.data, b.ownerUid); /* put the slot back as it was */
    showToast({ message: 'This recovery copy could not be read, so nothing was changed.', tone: 'warn' });
    return false;
  }
  if (!saveData()) {
    if (!saveInfo.reloaded) replaceData(prev); /* newer data from another tab stays */
    saveConflictBackup(b.kept, b.data, b.ownerUid);
    render();
    showToast({ message: 'Restore not saved. Your current data is unchanged.', tone: 'warn' });
    return false;
  }
  ui.sheet = null;
  clearActive();
  render();
  showToast({
    message: (isUndo ? 'Restore undone: ' : 'Restored ') + countsText(countsOf(DB)) + '. The data it replaced is kept as a recovery copy.',
    tone: 'good',
    actions: [{ label: isUndo ? 'Redo' : 'Undo', primary: true, onClick: function () { swapWithRecovery(!isUndo); } }]
  });
  return true;
}
export function confirmRestore() { swapWithRecovery(false); }

/* ================= wiring ================= */
export function initAccountUi() {
  actions.relogin = openRelogin;
  var reloadToasted = false;
  onSyncChange(function () {
    if (sync.reloadAdvised && !reloadToasted) {
      reloadToasted = true;
      showToast({
        message: 'The connection is back, but this page needs a reload to use the sign-in service. Your changes are safe on this device.',
        tone: 'warn',
        actions: [{ label: 'Reload', primary: true, onClick: reloadApp }]
      });
    }
    refreshSyncDot();
    refreshAccountSection();
    /* the two locked sheets: a question about the recovery slot sits above a conflict */
    var want = sync.replaceAsk ? 'replace-recovery' : (sync.conflict ? 'conflict' : null);
    var cur = ui.sheet && ui.sheet.type;
    if (want && cur !== want) {
      clearActive();
      ui.sheet = { type: want };
      render();
    } else if (!want && (cur === 'conflict' || cur === 'replace-recovery')) {
      ui.sheet = null;
      render();
    }
  });
  /* "Synced 2 min ago" keeps counting while the page is open */
  setInterval(function () { refreshSyncDot(); if (ui.view === 'settings') refreshAccountSection(); }, 30000);
  refreshSyncDot();
}
