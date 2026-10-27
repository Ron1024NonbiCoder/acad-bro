/* Transient notifications: "Saved", "Deleted X" + Undo, failures.

   Lives OUTSIDE render(): render() replaces #app-root's innerHTML wholesale, and
   every action that raises a toast also re-renders, so a toast rendered from app
   state would be rebuilt mid-animation. The host node is static markup in
   index.html and this module patches it directly. Actions are real JS callbacks
   held in the toast record, not data-action strings.

   Timing: a bare message clears itself in 4s, one with buttons gets 8s (long
   enough to reach for Undo on a phone). Warnings never auto-dismiss faster than
   an action toast. Both can be dismissed early with the x. */

import { escapeHtml } from './utils.js';
import { tick } from './haptics.js';
import { tokenMs } from './motion.js';

var PLAIN_MS = 4000;
var ACTION_MS = 8000;
var MAX_VISIBLE = 3; /* older toasts retire early rather than filling the screen */
var EXIT_MS = 220;   /* fallback only: the exit waits for the --dur token the .toast transition uses */

/* read per exit (CSS may load after this module), so it never drifts from styles.css */
function exitMs() { return tokenMs('--dur', EXIT_MS); }

var seq = 0;
var live = []; /* [{ id, node, timer, actions }] -- oldest first */

function host() {
  return typeof document !== 'undefined' ? document.getElementById('toast-host') : null;
}

function raf(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
  else setTimeout(fn, 16);
}

function clearTimer(rec) {
  if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
}

function drop(rec) {
  var i = live.indexOf(rec);
  if (i !== -1) live.splice(i, 1);
  clearTimer(rec);
  if (!rec.node) return;
  rec.node.classList.add('leaving');
  /* removed on a timer, not transitionend: a background tab may never fire it */
  var node = rec.node;
  rec.node = null;
  setTimeout(function () {
    if (node.parentNode) node.parentNode.removeChild(node);
  }, exitMs());
}

export function dismissToast(id) {
  for (var i = 0; i < live.length; i++) {
    if (live[i].id === id) { drop(live[i]); return; }
  }
}

export function dismissAllToasts() {
  live.slice().forEach(drop);
}

/* opts: { message, actions?, tone? }
     message  plain text (escaped here -- callers never pass markup)
     actions  [{ label, onClick, primary? }]; onClick may be omitted
     tone     undefined | 'good' | 'warn' -- colours the left edge only
   Returns the toast id. Undo pattern: showToast({ message:'Deleted X',
   actions:[{ label:'Undo', primary:true, onClick: restore }] }); restore then
   raises its own toast (with Redo when sensible). */
export function showToast(opts) {
  var el = host();
  if (!el) return null; /* headless tests and any page without the host node */
  var o = opts || {};
  var actions = (o.actions || []).filter(function (a) { return a && a.label; });

  while (live.length >= MAX_VISIBLE) drop(live[0]);

  var id = 'toast-' + (++seq);
  var node = document.createElement('div');
  node.className = 'toast' + (o.tone ? ' toast-' + o.tone : '') + (actions.length ? ' has-actions' : '');
  node.setAttribute('role', o.tone === 'warn' ? 'alert' : 'status');

  var html = '<div class="toast-msg">' + escapeHtml(String(o.message || '')) + '</div>';
  if (actions.length) {
    html += '<div class="toast-actions">';
    actions.forEach(function (a, i) {
      html += '<button type="button" class="toast-btn' + (a.primary ? ' primary' : '')
        + '" data-toast-action="' + i + '">' + escapeHtml(a.label) + '</button>';
    });
    html += '</div>';
  }
  html += '<button type="button" class="toast-close" data-toast-close="1" aria-label="Dismiss">&#10005;</button>';
  node.innerHTML = html;

  var rec = { id: id, node: node, timer: null, actions: actions };
  node.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-toast-action],[data-toast-close]') : null;
    if (!btn) return;
    /* the action fires with this toast already gone, so a handler that raises
       its own toast doesn't have this one hanging underneath it */
    var idx = btn.getAttribute('data-toast-action');
    drop(rec);
    if (idx !== null && rec.actions[Number(idx)] && rec.actions[Number(idx)].onClick) {
      tick();
      rec.actions[Number(idx)].onClick();
    }
  });

  el.appendChild(node);
  /* two frames so the off-screen state paints once before .shown transitions it
     in; the timer is a floor for hidden tabs where rAF never fires */
  function show() { if (rec.node) node.classList.add('shown'); }
  raf(function () { raf(show); });
  setTimeout(show, 60);

  rec.timer = setTimeout(function () { drop(rec); }, actions.length || o.tone === 'warn' ? ACTION_MS : PLAIN_MS);
  live.push(rec);
  return id;
}
