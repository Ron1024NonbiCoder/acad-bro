/* Overlay layers: the bottom sheet, and the Back stack that ties it (and the
   Settings view) to the Android/browser Back button. Ported from GymBro's
   layers.js (the "..." menu is left out until something needs it).

   ---- Why the sheet is not in #app-root ----
   render() replaces #app-root's innerHTML on every click, so a sheet in there
   would replay its slide-in each time. The frame lives in index.html
   (#sheet-host); render() calls syncSheet() at the end, which only swaps the
   sheet BODY and toggles the open class when open/closed actually changes.
   Whether a sheet is open is derived from ui state (shell.js currentSheet()).

   ---- Back ----
   One reconciler instead of a pushState at every open/close call site:
   render() calls syncBackStack(desired) with the layers that SHOULD be open,
   bottom to top (e.g. ['settings', 'sheet']). It compares that with the history
   entries it has pushed and pushes / goes back to match, so every way of
   closing a layer leaves history consistent. A Back press the reconciler did
   not cause pops our top layer and closes it via the closer shell.js registers. */

var pushed = [];          /* tags we pushed, bottom -> top */
var expectPops = 0;       /* history.go(-n) we caused; their popstate is ours */
var closer = null;        /* (tag) => void; registered by shell.js */

export function setLayerCloser(fn) { closer = fn; }

export function syncBackStack(desired) {
  var p = 0;
  while (p < pushed.length && p < desired.length && pushed[p] === desired[p]) p++;
  var extraOld = pushed.length - p;
  var extraNew = desired.slice(p);
  try {
    if (extraOld === 0) {
      extraNew.forEach(function (tag) { history.pushState({ acLayer: tag }, ''); pushed.push(tag); });
    } else if (extraNew.length === 0) {
      expectPops++;
      pushed.length = p;
      history.go(-extraOld);
    } else {
      /* one layer swapped for another: replace the top entry in place (a go()
         followed by a pushState would race) */
      history.replaceState({ acLayer: extraNew[0] }, '');
      pushed.length = p + extraOld;
      pushed[pushed.length - 1] = extraNew[0];
      extraNew.slice(1).forEach(function (tag) { history.pushState({ acLayer: tag }, ''); pushed.push(tag); });
    }
  } catch (e) { /* history unavailable (file://, sandbox): Back just won't close layers */ }
}

export function onPopState() {
  if (expectPops > 0) { expectPops--; return; }
  var tag = pushed.pop();
  if (!tag) return; /* a stale entry: nothing to close */
  if (closer) closer(tag);
}

/* ================= bottom sheet ================= */

var sheetOpen = false;
var hideTimer = null;

function host() { return document.getElementById('sheet-host'); }

/* sheet: {title, html} | null */
export function syncSheet(sheet) {
  var h = host();
  if (!h) return;
  var frame = h.querySelector('.sheet');
  if (sheet) {
    h.querySelector('.sheet-title').textContent = sheet.title;
    h.querySelector('.sheet-body').innerHTML = sheet.html;
    if (!sheetOpen) {
      sheetOpen = true;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      frame.style.transform = '';
      h.hidden = false;
      document.body.classList.add('sheet-open');
      /* two frames so the closed state paints first; timer backstop for background tabs */
      var shown = false;
      var show = function () { if (shown) return; shown = true; h.classList.add('is-open'); };
      requestAnimationFrame(function () { requestAnimationFrame(show); });
      setTimeout(show, 60);
    }
  } else if (sheetOpen) {
    sheetOpen = false;
    h.classList.remove('is-open');
    document.body.classList.remove('sheet-open');
    hideTimer = setTimeout(function () {
      h.hidden = true;
      h.querySelector('.sheet-body').innerHTML = '';
      hideTimer = null;
    }, 320);
  }
}

export function isSheetOpen() { return sheetOpen; }

/* drag the handle/header down to dismiss: follows the finger, closes past 30%
   of the sheet's height, otherwise springs back (CSS transition) */
var drag = null;
export function onSheetPointerDown(e) {
  var grip = e.target.closest && e.target.closest('.sheet-grip');
  if (!grip || !sheetOpen) return;
  var frame = host().querySelector('.sheet');
  drag = { y0: e.clientY, dy: 0, frame: frame, h: frame.offsetHeight, id: e.pointerId };
  frame.classList.add('is-dragging');
}
export function onSheetPointerMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  drag.dy = Math.max(0, e.clientY - drag.y0);
  drag.frame.style.transform = 'translateY(' + drag.dy + 'px)';
}
export function onSheetPointerUp(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  var d = drag;
  drag = null;
  d.frame.classList.remove('is-dragging');
  if (d.dy > d.h * 0.3) {
    if (closer) closer('sheet');
  } else {
    d.frame.style.transform = '';
  }
}
