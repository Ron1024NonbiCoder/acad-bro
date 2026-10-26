/* Haptic feedback. navigator.vibrate is Android/Chromium only; on iOS every
   call is a silent no-op. Always a bonus layer, never the only feedback.
   Vibration needs a user gesture (every caller is one) and throws in some
   embedded webviews, hence the try/catch. */

import { settings } from './settings.js';

function buzz(pattern) {
  if (!settings.haptics) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try { navigator.vibrate(pattern); } catch (err) { /* unsupported webview */ }
}

/* The default: something got checked / committed. */
export function tick() { buzz(12); }
/* Heavier double-tap for the destructive/negative counterpart. */
export function tickOff() { buzz([14, 45, 14]); }
/* Navigation (page, day): the lightest tap. */
export function tickNav() { buzz(8); }
/* A landed swipe commit. */
export function tickLanded() { buzz([30, 40, 30]); }
/* A swipe drag crossing its commit line, and backing out of it. */
export function tickLatch() { buzz(28); }
export function tickUnlatch() { buzz(10); }
