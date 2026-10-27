/* Motion helpers shared by the JS-driven transitions (shell.js swapWithFade,
   review-board.js fold, toast.js exit). Durations come from the CSS motion
   tokens in styles.css (--dur-fast / --dur / --dur-slow) so JS timers never
   drift from the transitions they wait for. */

/* true when the user asked for less motion: callers then skip the animation
   and apply the change at once */
export function reducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
}

/* A motion token in ms ('220ms' / '0.22s'); fallback when it cannot be read. */
export function tokenMs(name, fallback) {
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    var n = /ms$/.test(v) ? parseFloat(v) : (/s$/.test(v) ? parseFloat(v) * 1000 : NaN);
    return n >= 0 ? n : fallback;
  } catch (e) { return fallback; }
}

/* Run fn once when el's `prop` transition ends, or after waitMs at the latest
   (a background tab, a detached node or a cancelled transition never fires
   transitionend). */
export function afterTransition(el, prop, waitMs, fn) {
  var done = false;
  var timer = null;
  function finish(e) {
    if (done || (e && (e.target !== el || (prop && e.propertyName !== prop)))) return;
    done = true;
    el.removeEventListener('transitionend', finish);
    clearTimeout(timer);
    fn();
  }
  el.addEventListener('transitionend', finish);
  timer = setTimeout(finish, waitMs);
}
