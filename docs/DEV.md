# AcadBro — Dev Doc (living, handoff-ready)

Productivity + hobby tracker. Sibling of GymBro (`C:\Users\Sir\Downloads\GymBro`):
**same design language, gestures and architecture, different domain.**
Last updated: 2026-10-27 (M5 code complete, not deployed).

---

## 1. Product philosophy

- **Tracking, not pressure.** No streak counters, no "you broke your streak".
  Activity is shown neutrally (heatmap, dots, counts).
- **A day is "active" for a project if ≥1 of its tasks was completed that day.**
- Everything the user creates is fully CRUD-able, edited in place (underline input, GymBro `.ai-name-input` style).
- **No silent data loss.** Every create/update/delete tells the user (toast); deletes have Undo; save/sync failures show a banner/toast.
- One active editor at a time (`clearActive()` before opening any editor).
- Mobile + tablet first. Desktop only has to "work".

## 2. Decisions log

| Date | Decision | Notes |
|---|---|---|
| 2026-10-26 | Core units: **Areas → Projects → Tasks → Subtasks** | Areas are fixed: Living / Prod / Hobby. "All" is a combined view, not an area. |
| 2026-10-26 | Tasks support due date, priority, subtasks (1 level), recurring | Habits = recurring tasks (no separate habit concept). Done / not done only. |
| 2026-10-26 | Tasks may be loose in an area (no project) | Their activity counts toward the area only. |
| 2026-10-26 | Activity display: per-project heatmap (intensity = completed-task count), 7-day review board dots per area | No streaks. |
| 2026-10-26 | Stack = GymBro: vanilla ES modules, no build step, Firebase Hosting + Firestore + email/password Auth, offline-first PWA | Android wrapper later (GymBro uses a native WebView shell). |
| 2026-10-26 | **Separate Firebase project** (not shared with GymBro) | The user creates it (see user to-dos). |
| 2026-10-26 | Auth: optional. Works offline/local without login; login enables cloud sync | Same as GymBro. |
| 2026-10-26 | Day boundary = midnight, device-local | Dates stored as local ISO `YYYY-MM-DD`. No timezone stored (same as GymBro). |
| 2026-10-26 | Backfill allowed: pick a past day in the day strip, then complete tasks there | Completion date stays editable. |
| 2026-10-26 | UI = GymBro clone, dark only | Accents: All=violet `#8b7cf6`, Living=teal `#2fc4c9`, Prod=sky `#3ea6ff`, Hobby=orange `#f5920b`; red `#e5302c` = overdue / high priority. |
| 2026-10-26 | Platform: PWA, mobile-first | |
| 2026-10-26 | Git: Claude commits at milestones. Remote `origin` = github.com/Ron1024NonbiCoder/acad-bro; no push or deploy without the Product Owner's explicit OK each time | First push 2026-10-27 on request. |
| 2026-10-27 | **Review board (M4) lives in the shell, not on its own page.** It sits above the area tabs on every page and follows the current tab: All = rows grouped by area (area label + dot), Living/Prod/Hobby = that area's rows | Rows = non-archived projects in order, plus a **Loose** row (first) only when the area has loose tasks. Areas with no rows are left out. Claude default; confirm. |
| 2026-10-27 | Board columns = 7 days **ending on the day selected in the strip** (not always today). A dot is filled in the area colour if >=1 task or subtask completion that day, else outlined. Tapping a dot = `select-day` (jumps the strip) | Same count rule as `activeDays`: distinct tasks per day. |
| 2026-10-27 | Tapping a row name opens its **12-week heatmap in place** (one row open at a time; tap again closes). Week columns, rows start on the Settings week-start day, newest week at the right, days after the selected day are blank. Levels 0/1/2/3/4+ = 4 tints of the row's area colour. Tapping a cell shows 'Tue, Aug 18 · 4 tasks done' in a label under the grid (no modal, no jump) | Heatmap window also ends on the selected day. Open row + picked cell are session-only UI state. |
| 2026-10-27 | Day strip expands into a **calendar month grid** (chevron + vertical swipe; month paging; filled accent circle on days with a completion; tap a day selects it then collapses after ~300 ms). **Revised 2026-10-28 (PO sent GymBro screenshots):** the collapsed strip also shows the filled accent circle behind the number (not a small dot), and the chevron sits bottom-right of the card | Mirrors GymBro; one done-marker meaning everywhere. Details in "M7 plan". |
| 2026-10-28 | **Done circle takes the colour(s) of the area(s) the day's completions belong to** (PO; overrides "page accent colour"): the same colours the Activity board uses (Living teal, Prod sky, Hobby orange), on the strip and the month grid. One area = solid; two or more = the circle cross-fades through them in a loop (CSS, ~2.5 s per colour, colour only so no layout work). Reduced motion = static, first area in Living, Prod, Hobby order. Page scope still applies (Hobby: Hobby's colour only; All: every area). Number text is `--bg` (near-black) on every colour (contrast 8:1 or better). The old small dot under the number is removed entirely (markup and CSS) | The Activity board colours by area (projects have no colour of their own), so the area id is the colour key. `doneDates` now returns date -> area ids. |
| 2026-10-28 | M7 details Claude chose beyond the plan: grid title row = month + year left, tertiary "Today" (keeps its slot when hidden), then prev/next; weekday letters row; a month change fades the cells in (`.month-enter`); open/close = body fades out, render, height eases to the new height while content fades in (like the board fold); a day tap folds the grid after `--dur-slow` (re-armed by another tap, cancelled by a toggle); the swipe's trailing click is eaten (reset on the next press); `touch-action: pan-x` on the card and on `.day-strip` (none while open) so vertical swipes are not taken for page scroll (page cannot scroll with a finger that starts on the card, ~70 px closed / ~330 px open); done circles on out-of-month days are dimmed to 75% (number stays dark); Escape closes the grid; haptics: tickLanded on a grid day pick, tickNav on open/close/page | Page-scroll trade-off is the main thing to feel on a phone. |
| 2026-10-27 | **Board can be folded** (title bar 'Activity'); the choice is remembered per device (`reviewShown` in settings.js, not synced). Default open | Claude addition: with many projects the board gets tall above the task list. Confirm or remove. |
| 2026-10-27 | Review empty states: no rows -> 'Add a task to see activity here.'; rows but no activity in the 7 days -> 'Complete a task to see activity here.'; heatmap with nothing in 12 weeks -> same hint. Wording is neutral: no streak, goal or 'missed' language anywhere | |
| 2026-10-27 | **M5 sync = GymBro model, login-only.** Email+password login (no sign-up UI, no password reset; accounts are made by hand in the console). Login turns sync on; logged out = pure local, as before | Claude built it; confirm the choices below. |
| 2026-10-27 | **Firebase SDK is loaded lazily**, only if this browser has signed in before (`acadbro-auth-hint`) or the user taps Log in. A never-signed-in or offline user makes zero network calls | Claude choice (GymBro loads the SDK on every launch). Offline launch while signed in: the SDK is not cached by the service worker, so sync pauses (toast + Settings status) until the CDN is reachable; local edits stay marked dirty and sync later. |
| 2026-10-27 | **Data on this device is never replaced without a recovery copy.** First login onto an account that already has cloud data, or switching to another account: the local data is saved to the recovery slot first; if it cannot be stored (quota) nothing is replaced and the user is told | Claude addition over GymBro (GymBro lets the cloud win silently). |
| 2026-10-27 | Conflict = bottom sheet that cannot be dismissed ("Keep this device" / "Keep cloud copy"); the losing side goes to a **single recovery slot** (`acadbro-conflict-backup`), shown in Settings > Account > Recovery copy. Restoring SWAPS (the data it replaces becomes the new recovery copy), so Undo is the same operation | One slot: a newer conflict replaces the older copy (the toast says so). |
| 2026-10-27 | Sync status shown as a **header dot** (green synced / blue pending or syncing / orange offline, error, or needs a choice) plus the Settings > Account row ("Synced 2 min ago"). Errors toast once per kind (retries do not repeat), a "Back in sync" toast follows recovery | Red stays reserved for overdue/high priority. |
| 2026-10-27 | Foreground re-check: when the app returns to the foreground it re-reads the cloud doc (max every 20 s, only when idle) and applies or asks if another device wrote | Claude addition to close GymBro's gap (two devices open at once = last writer wins until the next launch). Still no check at the moment of each save. |
| 2026-10-27 | **PO confirmed** the M5 choices above (lazy SDK, recovery copy on first login, foreground re-check, single recovery slot) and the §3 defaults | |
| 2026-10-27 | Per-save cloud check: PO said "edge case, not now", but the code **already has it**: `auth.js` saves inside `runTransaction` that only commits while the doc carries the `rev` this device last saw (rules require `rev`). The §7 "known gap" row was stale; corrected | Found while verifying the live rules after deploy. |
| 2026-10-27 | **Firebase SDK cached by the service worker** (cache-first, versioned URL, cached on first use) so an offline launch while signed in can still sync later | `sw.js` `SDK_PREFIX` must match `cloud.js` `SDK_BASE` when the SDK version is bumped. |
| 2026-10-28 | **App updates are announced in Settings, not by toast** (PO): a new "App" group has "Check for updates" and, once a new service worker has taken over, "Update ready" -> tap reloads. No auto-reload (the user may be mid-edit); a quiet `reg.update()` runs when the app returns to the foreground (at most every 10 min) | `web/js/app-update.js`. Detection is the service worker, so a deploy must change `sw.js` (bump `CACHE`). |
| 2026-10-27 | **Android = TWA first** (wrapper over the hosted PWA, same UI) | M6. Needs `assetlinks.json` + PNG icons. |
| 2026-10-27 | TWA: **self-installed APK first** (no Play Store yet); package name **`app.acadbro`** (fixed forever once on Play) | Keystore: Claude creates it and sets the password; losing it only means reinstalling (§3). |
| 2026-10-27 | M6 scope (PO): known bugs, PNG + maskable icons, transitions / no layout jumps, full verifier pass over M1–M5, TWA | Plan: §5 "M6 plan". |
| 2026-10-27 | **TWA built (M6 step 6)** with Bubblewrap 1.24.1: `android/`, package `app.acadbro`, version 1 (code 1), minSdk 21 / target 35, orientation default (as the web manifest), fallback = Custom Tabs, notifications off, signed with the RSA-2048 key `acadbro` (SHA-256 `7B:C2:CD:01:...:AE:BE:54`, full value in `web/.well-known/assetlinks.json`) | Built APK is **not in git**; copy at `C:\Users\Sir\Downloads\AcadBro-APK\acadbro.apk`. The TWA loads the **live** site, so the phone shows whatever is deployed. |
| 2026-10-27 | Hosting `ignore`: `**/.*` replaced by `**/.!(well-known)` + `**/.!(well-known)/**`; `/.well-known/assetlinks.json` gets `Content-Type: application/json` | Checked with firebase-tools 15.34 `listFiles` (the deploy file list): the old pattern in fact kept `.well-known/assetlinks.json` (it only matches dot basenames) but let files inside dot-folders through; the new one keeps assetlinks and drops every other dotfile and dot-folder. |
| 2026-10-27 | Firestore region `asia-northeast1` (Tokyo), Standard edition — set by PO | |
| 2026-10-26 | Storage shape (proposed): one doc `users/{uid}` written whole, like GymBro | Risk: 1 MB Firestore doc limit. Add a size guard (warn at 800 KB). Revisit if users accumulate large amounts of notes. |

## 3. Open decisions (waiting on Product Owner)

Defaults in *italics* are what gets built if no answer comes. Each is written so it is cheap to change.

- [x] 2026-10-26 Recurrence: **chosen weekdays** (all 7 = daily) and **monthly on day D**. If D exceeds the month's length, it falls on the last day of that month *(Claude default; confirm)*.
- [x] 2026-10-26 **Subtask completion counts as activity** for its day (and for its task's project). Subtask completions are logged in `completions` with a `subtaskId`.
- [x] 2026-10-26 A missed recurring occurrence **just passes**. No overdue pile-up.
- [x] 2026-10-26 **Task list has switchable views**: *Grouped by project* (collapsible project cards; loose tasks at top) / *Flat* (sorted by due, then priority, with a project chip). The choice is remembered per area, per device.
- [x] 2026-10-26 **All page** = everything due, recurring, or done on the selected day, grouped by area.
- [x] 2026-10-26 **Swipe-left tray**: Due / Priority / Repeat / Rename / Note / Move / Delete. A full swipe fires Due. Subtasks are added in the expanded view (tap the task).
- [x] 2026-10-27 Monthly day D beyond the month's length goes to the last day.
- [x] 2026-10-27 Areas: **fixed 3 areas with fixed labels (Living / Prod / Hobby). No rename feature** (PO changed this 2026-10-27; earlier default was "labels renamable").
- [ ] Timezone handling (travel across zones): **PO 2026-10-27: edge case, decide later.** Built as: follow the device timezone. Options when revisited: (2) fixed home timezone in the profile, synced; (3) device timezone + a toast when the timezone changes; plus an optional "day starts at HH:00" for late nights. Switching later only affects new records (stored `date` is never rewritten).
- [x] 2026-10-26 Input limits accepted: name 80 chars, note 2000, 30 subtasks per task, 200 projects, 5000 tasks. Hitting a limit shows a toast (never a silent reject).
- [x] 2026-10-27 TWA keystore: **Claude creates it and sets the password**; testing stage, so if it is lost the PO uninstalls and reinstalls the app. Keystore + password live outside the repo (see M6 step 6). Revisit before any Play Store release (use Play App Signing then).
- [x] 2026-10-27 PO approved the M6 step 2 defaults: import over the limits is refused with an explanation (no truncation); import files over 2 MB refused with the reason. (Area rename was approved, then **withdrawn** the same day: no rename feature.)
- [x] 2026-10-27 Priority levels: *none / low / med / high.*
- [x] 2026-10-27 Project archive vs delete: *both; archive hides the project but keeps its history.*
- [x] 2026-10-27 Legal / disclaimer / privacy text: *none until public release.*
- [x] 2026-10-27 App name / branding: *"AcadBro" for now.*
- [x] 2026-10-27 Sync conflict handling: GymBro model (dirty marker + base timestamp; a true conflict asks the user and keeps a recovery copy). Built in M5, see section 4.

## 4. Architecture (mirrors GymBro)

- `web/` is the deploy root. `index.html` holds static hosts (toast, sheet, nav) **outside** `#app-root`, so a re-render doesn't kill them.
- `shell.js` `render()` swaps `#app-root` wholesale. `state.js` exports a mutable `ui` object (never reassigned).
- `events.js` delegates `data-action` clicks.
- `storage.js`: local-first, using localStorage key `acadbro-data-v1`, a DIRTY marker, a BASE (cloud `updatedAt`), and retry backoff of 2/5/15/30/60s.
- `swipe-entry.js`: right = complete, left = action tray. `long-press.js`: hold = edit logged values.
- Tests: `node scripts/test-*.mjs` (no framework). Needs Node ≥ 22.7 (ESM `.js` without package.json). `test-rules.mjs` needs the Firestore emulator.
- Headless smokes in `scripts/smoke/` (Chrome over CDP, local server only, Chrome's resolver blocks every other host; Firebase SDK mocked via CDP Fetch, never the live backend). Self-contained: `node scripts/smoke/check-icons.mjs`, `node scripts/smoke/smoke-m6.mjs` (33), `node scripts/smoke/smoke-motion.mjs` (32). With `node scripts/serve.mjs` running: `node scripts/smoke/smoke-m2.mjs <port>` (53), `smoke-m4.mjs <port>` (37), `W=390|360 node scripts/smoke/smoke-m5b.mjs <port>` (140). Details, env (`CHROME_PATH`, `SMOKE_OUT`) and ports: `scripts/smoke/README.md`.
- Dev server: `node scripts/serve.mjs` (PORT env, default 5180). `?page=prod` deep-links a page.
- Review board: `review-board.js` (string builders) over pure `tasks-core.js` `activityIndex` (one pass for all rows) / `windowDays` / `heatmapGrid` / `reviewGroups` / `intensityLevel`. The fade-in on opening is a one-shot `.rb-enter` class (only on the render that opened it). Actions: `review-fold`, `review-row`, `review-cell` (events.js); dots reuse `select-day`.
- Task logic: `tasks-core.js` (pure, node-tested), `tasks-actions.js` (one `commit()` = save + re-render + toast with Undo → Redo), `page-tasks.js` (render).
- `activeDays(projectId, tasks, completions, endISO, n, area)` → `[{date, count, active}]`; count = distinct tasks with any completion (task or subtask) that day.
- "Overdue" = one-off, not done, due before the **selected** day (not before today).
- Due and Repeat are mutually exclusive on a task: setting one clears the other (said in the toast; can be undone).
- Deleting a task/project also deletes its completions; Undo restores them.
- Editors: rename/note/add commit on blur + Enter, Esc cancels; Due/Repeat/Move/done-date panels use explicit Save/Cancel. A press on a button while an editor is open is recorded by a capture-phase `pointerdown` (`pendingTap`, `events.js`); the blur-commit is deferred to the click, which commits first and then runs the tapped action from a dataset copy read before the re-render (600 ms / pointercancel fallback commits as before).
- Tray buttons are 40px (7 × 52px doesn't fit 360px phones).
- `storage.js` reports save/size errors via `hooks` (testable in node). Corrupt local data is copied aside + warning toast (`recoveredMessage`): 3 slots `acadbro-data-corrupt`, `-2`, `-3` (`keepCorruptCopy`; times in `acadbro-data-corrupt-meta`); the same text reuses its slot, a new one takes the first free slot, and when all 3 are full the oldest is overwritten and the toast says so; if no copy fits, the toast says no copy was kept and to make no changes. Import = preview sheet → confirm, backup in `acadbro-import-backup`, Undo; if that backup cannot be written, a warning toast asks Import / Cancel first (nothing changes until then). Files over 2 MB are refused before parsing; `parseImport` returns `problems` (over `LIMITS`: counts, name/note length, subtasks per task) and the sheet then shows them with no Replace button (nothing applied or trimmed). `normalizeData` always uses the default `areaLabels` (labels are fixed; the field stays for the rules).
- Device-local settings (week start, haptics) live in `settings.js` and are never synced.
- Motion (M6 step 4): durations come only from the tokens `--ease-out`, `--dur-fast` (160ms), `--dur` (220ms), `--dur-slow` (300ms) in `styles.css`; JS timers read them through `motion.js` (`tokenMs`, `afterTransition` = transitionend with a timeout fallback, `reducedMotion`). Toast exit waits `tokenMs('--dur')` (`EXIT_MS` 220 is only the fallback).
- Page changes: `shell.js swapWithFade(change)` fades `#app-root` out (`.swap-out`, `--dur-fast`, taps off), runs `change` (state + `render()`) while hidden, then fades back in. Used by `switchPage`, `openSettings`, `closeSettings` and Back out of Settings; a new swap mid-fade finishes the pending one first. The swap waits for the fade-out's `transitionend`; its timer (`--dur-fast` + 80ms) only re-checks the opacity and keeps waiting while it is above 0, with a hard cap of 3 × `--dur-fast` + 200ms (background tab). Any new page/view change must go through it.
- Editors opened by `openEditing` set the one-shot `ui.editorEnter`; `page-tasks.js enterWrap()` wraps the add-task / add-project forms and the task / project note editors once in `.ed-enter > .ed-enter-inner` (grid rows 0fr -> 1fr + fade, `--dur-fast`; the add form grows from the 48px of the + Add row it replaces). `render()` clears the flag, so later renders never replay it. Renames swap in place and are not wrapped.
- Review board fold: `review-board.js foldReviewBoard(render)` pins the body height, collapses it (`.rb-closing`, `--dur`), and re-renders after transitionend (fallback `--dur` + 80ms); taps during the fold are ignored. Opening keeps the `.rb-enter` fade.
- All three skip the animation under `prefers-reduced-motion: reduce` (the change happens at once).
- Icons: `web/icon/icon.svg` is the source. PNGs `icon-192.png`, `icon-512.png` (purpose any, transparent corners), `icon-maskable-512.png` (opaque #030303, artwork scaled 0.9 so the ring stays inside the 80% safe zone), `apple-touch-icon.png` (180, opaque) were rendered from it with headless Chrome by a scratchpad script (not in the repo; re-render if the SVG changes). All four are in `manifest.json` / `index.html` / `sw.js` SHELL.

### Android TWA (M6 step 6, built 2026-10-27)

- **Android Studio route (PO sideloads with AS, 2026-10-27):** open the `android/` folder in AS and press Run; see `android/README.md`. `app/build.gradle` now has a `signingConfigs.acadbro` block that reads `C:\Users\Sir\.acadbro-keys\keystore.properties` (path, alias, passwords; outside the repo) and signs BOTH `debug` and `release` with the AcadBro key. Without that, AS's default debug key has another SHA-256 and the TWA would show a URL bar. Verified: `gradlew assembleDebug` succeeds and `apksigner verify --print-certs` shows `7bc2cd01…2eaabe54`, equal to `assetlinks.json` (live). `bubblewrap update` overwrites this block; re-apply it from git history. No Gradle work needed by hand.

- Project: `android/` (Bubblewrap-generated Gradle project). Source of truth = `android/twa-manifest.json`; `manifest-checksum.txt` = SHA-1 of that file (Bubblewrap compares it to decide whether to regenerate).
- Toolchain: `~/.bubblewrap/config.json` (shared with other projects on this PC, do not edit): JDK 17 at `C:\Users\Sir\.bubblewrap\jdk-17.0.19+10`, SDK at `C:\Users\Sir\.bubblewrap\android_sdk` (build-tools 35.0.0).
- Keystore: `C:\Users\Sir\.acadbro-keys\acadbro.keystore` (PKCS12, alias `acadbro`, store password = key password); password in `C:\Users\Sir\.acadbro-keys\password.txt`. Both outside the repo; never commit or print them.
- Build (Git Bash): `cd "C:/Users/Sir/Downloads/AcadBro/android" && unset NoDefaultCurrentDirectoryInExePath && export BUBBLEWRAP_KEYSTORE_PASSWORD="$(cat /c/Users/Sir/.acadbro-keys/password.txt)" BUBBLEWRAP_KEY_PASSWORD="$(cat /c/Users/Sir/.acadbro-keys/password.txt)" && npx -y @bubblewrap/cli build --skipPwaValidation` -> `android/app-release-signed.apk` (+ `.aab`, both gitignored), then copy to `C:\Users\Sir\Downloads\AcadBro-APK\acadbro.apk`. **Trap:** the Claude shell sets `NoDefaultCurrentDirectoryInExePath=1`, so cmd cannot run `gradlew.bat` from the current folder ("'gradlew.bat' is not recognized") unless it is unset.
- Changing the app: edit `twa-manifest.json`, bump `appVersionCode` (and `appVersion`; the field is `appVersion`, not `appVersionName`), run `npx -y @bubblewrap/cli update`, then build. `update` re-downloads `iconUrl` / `maskableIconUrl` (live site URLs). For the first build they pointed at a local static server of `web/` (no live call), then were set back to the live URLs and the checksum recomputed.
- Check: `apksigner verify --print-certs <apk>` (SDK build-tools) SHA-256 must equal `web/.well-known/assetlinks.json`; `aapt dump badging` shows `package: name='app.acadbro'`.
- **Web deploy checklist (no new APK needed):** (1) bump `CACHE` in `web/sw.js` on every deploy: it is what makes installed apps see an update and show "Update ready" in Settings; (2) `firebase deploy --only hosting`; (3) installed users get the code on their next launch, or via Settings > App > Check for updates. A new APK/AAB (bump `appVersionCode`) is only for manifest, package, signing key, launch URL, icon/name/theme-colour or native changes.
- Digital Asset Links: `web/.well-known/assetlinks.json` (package + cert SHA-256) must be live at `https://acadbro-166c4.web.app/.well-known/assetlinks.json` for Chrome to hide the URL bar. New key = new fingerprint there + reinstall on the phone.

### Cloud sync (M5, built 2026-10-27)

- Files: `sync-core.js` (pure, node-tested: markers, BASE, `decideOnLoad`, retry delays, recovery copy, `syncInfo`), `cloud.js` (live `sync` status object + lazy loader + the actions the UI calls; no Firebase), `auth.js` (Firebase: login/logout, `cloudSave`, load, conflict, retry; dynamic-imported, SDK from `gstatic.com/firebasejs/12.16.0`), `page-account.js` (Settings > Account rows, header dot, login / conflict / restore sheets). Seam in `storage.js`: `cloud.onLocalChange` (set by auth.js while signed in) and `applyCloudData()` (swaps DB and writes localStorage **without** marking dirty).
- localStorage keys: `acadbro-dirty` (token per local save), `acadbro-sync-base` (cloud `updatedAt` ms last seen), `acadbro-last-sync`, `acadbro-owner-uid` (whose data this is), `acadbro-auth-hint`, `acadbro-conflict-backup`.
- Cloud doc `users/{uid}`: `schema, areaLabels, projects, tasks, completions, rev, updatedAt` (`updatedAt` = server timestamp; `rev` = the save token the transaction checks). `auth.js buildPayload()` and `firestore.rules` must list the same fields (maintenance contract in the rules file: deploy rules first).
- Load verdict (`decideOnLoad`): not dirty or data belongs to another account -> apply cloud (local copy kept as recovery first when it belongs to no account/another); dirty and cloud == BASE -> upload local; dirty and cloud moved on -> conflict sheet. If not dirty and cloud == BASE nothing is swapped (no re-render).
- Uploads are off until the account's doc has been fetched (`cloudReady`). Debounce 1 s; flush on `pagehide`/hidden; the dirty marker is cleared only when the acknowledged write's token still matches; retry 2/5/15/30/60 s, plus on `online` and on foreground. A write unacknowledged after 15 s is reported ("taking a while"), never waited on silently.
- Messages are positive and each says what to do next (see `ERRORS` / `LOGIN_ERRORS` in auth.js). Log out: tries one last upload (4 s cap), keeps local data, and warns if edits are still unsynced.
- Tests: `node scripts/test-sync-core.mjs` (29 as of 2026-10-27; storage 18). Headless smoke with a mocked Firebase SDK (login, save, rejected save + recovery, both conflict choices, restore + undo, logout, SDK unreachable) is `scripts/smoke/smoke-m5b.mjs` (moved from the scratchpad 2026-10-27); it serves the mock through CDP Fetch interception, so no live backend was touched.

### Data model (draft v1)

```js
{
  schema: 1,
  areaLabels: { living: 'Living', prod: 'Prod', hobby: 'Hobby' },
  projects: [{ id, area, name, note, archived, order, createdAt, updatedAt }],
  tasks: [{
    id, area, projectId /* null = loose */, title, note,
    priority /* 0..3 */, due /* 'YYYY-MM-DD'|null */,
    recur /* null | { kind:'weekdays', days:[0-6] } | { kind:'monthly', day:1..31 } */,
    subtasks: [{ id, title }],   // done-state derived from completions
    order, createdAt, updatedAt
  }],
  completions: [{ id, taskId, subtaskId /* null = whole task */, date /* local YYYY-MM-DD */, at /* ISO ts */ }],
  updatedAt
}
```

A one-off task counts as done if it has a completion with `subtaskId === null`. A recurring task is done *for date D* if such a completion has `date === D` (its subtasks reset per occurrence). A day is active for a project if it has any completion (task or subtask) for a task in that project. Heatmaps and the review board are derived from `completions`.

## 5. Milestones

- **M1: Shell & infrastructure** (not affected by the open decisions): scaffold, design tokens, header/tabs/bottom nav, day strip, toast + undo, haptics, local storage + dirty marker, service worker, manifest, test harness.
- **M2: Projects & tasks CRUD**: swipe gestures, subtasks, due/priority, backfill.
- **M3: Recurring tasks** (depends on the recurrence decision).
- **M4: Review board + heatmaps.** (done 2026-10-27)
- **M5: Auth + Firestore sync** (done in code 2026-10-27; needs the console steps and a rules deploy before it can work live).
- **M6: Polish, limits, Android wrapper.**
- **M7: Expandable day strip (month grid).** Planned 2026-10-27, see "M7 plan".

### M5 plan (from GymBro scan, 2026-10-26)

- Firebase JS SDK from CDN ESM `https://www.gstatic.com/firebasejs/12.16.0/{firebase-app,firebase-auth,firebase-firestore}.js`. Web config is public by design (security = rules).
- New `web/js/auth.js` (modelled on GymBro `web/auth.js`): init, login, logout, `onAuthStateChanged`, `cloudSave` (`setDoc` on `users/{uid}`, `serverTimestamp()` as `updatedAt`), `loadCloudData` (`getDoc`), readback of `updatedAt` as BASE.
- Fill AcadBro seams: `storage.js:23-26` `cloud.onLocalChange` stub; `applyCloudData` (`storage.js:137`) is the apply path; toasts via `hooks.onSaveError/onSizeWarn` (`main.js:17,23`).
- Extend `web/js/sync-core.js` with `saveConflictBackup` / `readConflictBackup` / `syncInfo` (GymBro has them; add node tests).
- Conflict flow = GymBro: not dirty → apply cloud; dirty and cloud == BASE → push local; else dialog "Keep this device" / "Keep cloud copy", discarded side kept as recovery backup; dirty cleared only by token-matched ack. Retry backoff 2/5/15/30/60s + retry on `online`.
- New root files: `firebase.json` (auth emailPassword, firestore rules, hosting `public: web`), `.firebaserc` (default `acadbro-166c4`), `firestore.rules` (owner-only on `users/{uid}`, delete denied, all else denied, schema/size caps), `firestore.indexes.json`.
- Rule ordering: deploy rules **before** shipping client fields that need them. No deploy without Product Owner OK.

### M6 plan (2026-10-27, written for handoff to an executing agent)

Facts come from a repo scan on 2026-10-27; re-check line numbers before editing. Steps 1–5 are not blocked by any open decision; step 6 waits for the keystore answer (§3). After each step: run all `node scripts/test-*.mjs`, bump the SW cache in `web/sw.js` if anything under `web/` changed, update this doc (§6/§7/§8), commit. **No deploy and no phone install without the PO's OK.**

**Step 1: the two known bugs (§7)**
- 1a. *Editor open, first tap elsewhere is swallowed.* Cause: `events.js` `onFocusOut` (~:129-135) commits on blur, `commitEditor` (`tasks-actions.js` ~:449-513) calls `render()` (`shell.js` ~:125-146), which replaces `#app-root`, so the pressed button is detached before `click` fires. `relatedTarget` cannot be trusted (it is null for buttons on iOS Safari). Fix: a capture-phase `pointerdown` listener records the `[data-action]` element pressed outside the edit scope (`pendingTap`). `onFocusOut` skips the commit while `pendingTap` is set; `onAppClick` commits the open editor first, then runs the tapped action from the dataset it read before the re-render. Clear `pendingTap` on `click`, or after 600 ms (drag/scroll): then commit as today. Esc still cancels; Enter still commits.
  Accept: headless smoke at 390px: open rename, type, tap another task's tray button, then both the "Saved" toast and the tapped action happen; same for note and add editors; a scroll gesture still commits.
- 1b. *Stacked toasts cover the Manage sheet's close button.* Toast host is top-right, z 60 (`styles.css` ~:779-790); sheet z 50, max-height `calc(100dvh - 48px)`, close button in `.sheet-head` (`index.html` ~:58). Fix: while a sheet is open (existing body/layer state in `layers.js`), give the toast host `right: 56px` so the right edge stays clear. No layout change to the sheet.
  Accept: at 360 and 390px with 3 toasts and Manage open, `elementFromPoint` at the close button's centre returns the button.

**Step 2: limit gaps found in the scan**
- Import (`storage.js` `parseImport` ~:241) does not check `LIMITS` (`tasks-core.js` ~:16). PO-approved: the preview sheet checks counts and lengths; if anything is over, the import is not applied and the sheet says exactly what is over, in positive wording ("This file has 5200 tasks. AcadBro holds up to 5000; please trim the file and import again."). No silent truncation. Also refuse files over 2 MB before parsing, with a message.
- Login fields (`page-account.js` ~:156/:159): `maxlength` 254 (email) / 128 (password).
- **Area labels are fixed (PO 2026-10-27: no rename feature).** Do not build a rename UI. But `storage.js` normalise (~:53) still merges `areaLabels` from loaded/imported data, so an import file or old cloud doc could show other labels. Claude default: normalise always uses the default labels (ignore `areaLabels` from input). Keep the `areaLabels` field in the data and cloud doc unchanged (the rules require it; no schema bump).
  Accept: unit tests in `test-storage.mjs` for the import checks and for "custom areaLabels in input → default labels".

**Step 3: PNG + maskable icons**
- Today: only `web/icon/icon.svg`; the manifest has one SVG icon; no apple-touch-icon.
- Make `icon-192.png`, `icon-512.png` (purpose `any`), `icon-maskable-512.png` (purpose `maskable`, artwork inside the central 80%, background `#030303`), `apple-touch-icon.png` 180×180, no transparency. Render them from the SVG with headless Chrome (no new npm dependency in the repo); commit only the PNGs. Update `manifest.json` icons, add `<link rel="apple-touch-icon">` to `index.html`, add the icons to `SHELL` in `sw.js`.
  Accept: a script reads each PNG header and confirms its size; the Chrome DevTools manifest pane shows no icon warnings.

**Step 4: transitions and layout jumps**
- Tokens exist (`styles.css` ~:68-69: `--ease-out`, `--dur-fast` 160ms, `--dur` 220ms, `--dur-slow` 300ms). Replace hard-coded toast timings (~:809/:813) with tokens; keep `toast.js` `EXIT_MS` in step with them.
- Three jumps to fix, each with a one-shot class like the existing `.rb-enter`:
  a. Opening an editor (`tasks-actions.js` ~:342 `openEditing` → `render()`): editor row expands and fades in (`grid-template-rows: 0fr → 1fr` + opacity, `--dur-fast`).
  b. Folding the review board (`events.js` ~:57): collapse is instant today; animate the close too, and render after `transitionend` (with a timeout fallback).
  c. Settings view swap (`shell.js` ~:129-131): add a shared `swapWithFade()` helper in `shell.js` (fade out, swap, fade in) and use it for every page change, so all pages transition the same way.
- All of them honour `prefers-reduced-motion` (existing overrides near `styles.css` :665/:842/:896/:943).
  Accept: headless smoke with a `PerformanceObserver('layout-shift')` shows no shifts outside user-input windows in these three flows; screenshots before/after for the verifier.

**Step 5: fresh-context verifier pass over M1–M5**
- (5a, done 2026-10-27: now `scripts/smoke/`, see its README.) First move the headless smoke from the scratchpad into the repo (Chrome over CDP, mocked Firebase via Fetch interception, never the live backend) so later agents can rerun it.
- The verifier (a fresh agent that has not seen this work) checks every §2/§3 decision against the running app at 360 and 390px and reports gaps; Claude fixes them or lists them in §7.

**Step 6: TWA** (done in code 2026-10-27, see §4 "Android TWA"; assetlinks not live until a hosting deploy)
- Keystore (PO decision 2026-10-27): the executing agent lets Bubblewrap create it at `C:\Users\Sir\.acadbro-keys\acadbro.keystore` (alias `acadbro`), with a random 24-character password saved next to it in `C:\Users\Sir\.acadbro-keys\password.txt`. Both stay outside the repo and are never printed in chat or in this doc. If lost: make a new key, update `assetlinks.json`, and the PO uninstalls and reinstalls the app.
- Tool: Bubblewrap (`npx -y @bubblewrap/cli init --manifest https://acadbro-166c4.web.app/manifest.json`), project in `android/` at the repo root. Package `app.acadbro`, name "AcadBro", theme/background `#030303`, start URL `/`.
- Commit `android/twa-manifest.json` and the generated project; **never commit the keystore**: add `*.keystore`, `*.jks`, `android/**/build/` to `.gitignore`.
- Add `web/.well-known/assetlinks.json` (package name + SHA-256 of the signing certificate). **Trap:** `firebase.json` hosting `ignore` has `"**/.*"`, which drops `.well-known/`. Narrow that pattern, then confirm the file is served as JSON with a 200.
- `bubblewrap build` → signed APK. The PO installs it on the phone (Claude does not touch devices).
  Accept: `https://acadbro-166c4.web.app/.well-known/assetlinks.json` returns 200 JSON; the app opens with no URL bar (PO, on the device). If the URL bar shows, the fingerprint in assetlinks does not match the key.
- Data: a TWA runs in Chrome and shares Chrome's storage for this site, so local data is the same as the installed PWA on that phone; signed-in data is also in the cloud.

### M7 plan: expandable day strip (month grid), written 2026-10-27 for handoff

Goal: the day strip opens into a month calendar (as in GymBro's expanded strip), shows which days had completions, and lets you jump to any day. Built 2026-10-28 (code + headless smoke; not hand-tested on a phone); decisions below are from the Product Owner (2026-10-27) unless marked *default*.

**Behaviour**
1. **Open / close:** a small chevron button in its own row at the **bottom-right** of the strip card, as in GymBro (`aria-expanded`; chevron flips when open; the row exists in both states so the card height only changes by the grid itself), **and** a vertical swipe on the strip card (down opens, up closes). Escape also closes. The swipe must not fight the week scroller (horizontal) or page scroll: start only on the strip card, commit after ~24px vertical and |dy| > |dx|.
2. **Grid = calendar month with paging.** Title row: month + year (e.g. "October 2026"), prev/next arrows, and a tertiary "Today" button shown only when another month than today's is on screen. Swipe left/right on the grid also pages a month. Opening shows the month of `ui.selectedDate`. Paging never changes `ui.selectedDate`.
3. **Done marker (strip AND grid):** a filled circle behind the day number, centred on it; no dot anywhere. **Colour (PO 2026-10-28, replaces "page accent colour"):** the colour(s) of the area(s) the day's completions belong to, the same colours the Activity board uses (Living teal, Prod sky, Hobby orange). One area = solid; two or more = the circle slowly cross-fades through them in a loop (CSS animation, ~2.5 s per colour, no layout shift); `prefers-reduced-motion` = no animation, first area in area order. Page scope applies (Hobby: only Hobby's colour; All: every area). The number is near-black (`--bg`) on all colours for contrast. **Revised 2026-10-28:** the collapsed strip uses the same filled circle, replacing the old small dot, so there is one marker everywhere. The selected tile and today's triangle still show on a done day (GymBro: circle inside the tile). Same data source: `doneDates` (`tasks-core.js`).
4. **Tap a day:** select it (highlight shows at once), then collapse after ~300 ms back to the strip on that day's week. Future days are selectable, like the strip. Haptic `tickLanded` on select, `tickNav` on open/close/page.
5. **Today** keeps the small accent triangle under its number; **selected** day keeps the `--card-3` tile; the 1st of a month shows its month name above the number only for neighbour-month days (as "Nov 1" in the screenshot).
6. Grid replaces the strip inside the same `.day-strip-card` (the card animates its height; content fades; no cut-jump). Honour reduced motion (same pattern as `foldReviewBoard`: pinned height, `afterTransition`).
7. Leading/trailing days from adjacent months are shown **dimmed, tappable, with done circles** *(default)*. The grid always renders **6 rows** *(default)* so paging months never changes the card height (no layout jump).
8. Week start follows `settings.weekStart` (Mon default).
9. Open state is **not** remembered across launches *(default)*: the app always starts on the collapsed strip.

**Files**
- `tasks-core.js`: pure `monthGrid(anchorISO, weekStartDow)` -> `{ title, first, weeks: [[{ date, inMonth }]] }` (6 rows x 7), `shiftMonthISO(iso, n)`, and `doneDates` now returns a Map date -> area ids (areas-argument order), all node-tested.
- `state.js`: `ui.stripOpen` (bool), `ui.monthAnchor` (ISO of the 1st, or null = month of selectedDate). Both reset to closed/null on launch.
- `day-strip.js`: `renderMonthGrid()`, `toggleStrip(render)` (animated), `shiftMonth(n)`, `monthToday()`; `renderDayStrip` renders chevron + either strip or grid. `doneDates` range extended to the visible grid.
- `events.js`: actions `strip-toggle`, `month-prev`, `month-next`, `month-today`; vertical swipe handler on `.day-strip-card`; horizontal swipe on the grid; `select-day` from a grid cell sets `ui.selectedDate`, then collapses after ~300 ms (timer cancelled if the user taps again or toggles).
- `styles.css`: `.strip-toggle`, `.month-grid`, `.month-head`, `.month-cell` (+ `.is-out`, `.has-done`, `.selected`, `.is-today`), reuse tokens/radius/`--dur`; no new colours.
- `main.js`: wires the strip swipe listeners (pointerdown/move/up/cancel).
- `sw.js`: bump cache (v11).
- `scripts/smoke/smoke-strip.mjs` (new, 89 checks: 390 + 360 motion, 390 reduced, Sunday start); `smoke-m4.mjs` strip assertions updated from the dot slot to the circle.

**Tests / acceptance**
- `test-tasks-core`: `monthGrid` for a 4-, 5- and 6-row month, Mon- and Sun-start, Feb leap year, year boundary (Dec -> Jan).
- DONE 2026-10-28: `smoke-strip.mjs` (+ `smoke-m4` strip checks), `smoke-motion` and the rest re-run green (see §8). Original list: `smoke-m4` (or a new `smoke-strip.mjs`): open via chevron and via swipe; circles match `.has-done` on the strip for the same days; tap a day -> `ui.selectedDate` moves, grid collapses after ~300 ms; month paging does not change the selected day or the card height; no horizontal scroll at 360/390; no console errors.
- `smoke-motion`: no layout shift outside input windows; reduced motion swaps without animation.
- Fresh-context `verifier` pass; then a hand test on the phone (swipe conflicts are the main risk).

**Still open for the Product Owner** (defaults above apply if no answer): dim vs hide neighbour-month days; fixed 6 rows vs variable rows; remember open state; show a count on the circle (not asked for, **not** built: tracking not pressure, see §1).

## 6. To-dos

### Claude
| Status | Item |
|---|---|
| done 2026-10-26 | M1 shell & infrastructure (tests 10+13 pass; serve on PORT, default 5180) |
| done 2026-10-26 | M2 projects/tasks/subtasks CRUD + views, and M3 recurrence (tests 13+21+10 pass; headless smoke at 390px passes, now `scripts/smoke/smoke-m2.mjs`) |
| done 2026-10-27 | M4 review board + per-project heatmaps (`web/js/review-board.js`; pure logic in tasks-core.js; tests 13+28+10 pass; headless smoke at 390 and 360px passes) |
| done 2026-10-27 (code) | M5 auth + sync built and machine-tested against a mocked SDK (tests 20+13+28+10 pass; rules checked on the Firestore emulator). **Not tested against the live backend**: needs the PO steps below, then a real two-device pass |
| pending | M5 live test: log in, edit, confirm a second device/browser sees it; force a conflict (edit offline on both) and try both choices + Restore |
| done 2026-10-27 | M6 steps 1–2 (tap-while-editing bug, toast vs sheet close button, import limits + 2 MB cap, login maxlength, fixed area labels). Tests: storage 22, sync-core 29, tasks-core 28, utils 10 pass; headless smoke at 390/360px passes (and fails on the pre-fix code). Not deployed |
| done 2026-10-27 | M6 steps 3–4: PNG + maskable + apple-touch icons; transitions (editor expand, board fold, `swapWithFade` page changes, toast timings on tokens), reduced-motion honoured. Tests: storage 22, sync-core 29, tasks-core 28, utils 10 pass; step 1–2 smoke 27/27; motion smoke (390px, motion + reduced) passes, no layout shift without recent input in the 3 flows; Chrome reports no manifest/installability errors. Not deployed, not tried on a real phone |
| done 2026-10-27 | M6 step 5a: smokes moved from scratchpads into `scripts/smoke/` (m2 53/53, m4 37/37, m5b 139/140 at 390 and 360, m6 27/27, motion 32/32, icons 4/4). The old pre-review `smoke-m5.mjs` was not moved (its mock predates the transactional save; `smoke-m5b.mjs` supersedes it) |
| done 2026-10-27 | `smoke-m5b.mjs` "recovery copy" check now marks the cloud copy with a cloud-only task (`CloudOnlyTask`) instead of an area label; 140/140 at 390 and 360 |
| planned 2026-10-27 | M6 step 5b, see §5 "M6 plan" |
| done 2026-10-27 (code) | M6 step 6: TWA project `android/`; signed APK at `C:\Users\Sir\Downloads\AcadBro-APK\acadbro.apk` (apksigner verify OK, cert SHA-256 = assetlinks, aapt package `app.acadbro`); `web/.well-known/assetlinks.json` served 200 `application/json` by the local hosting emulator. Tests: storage, sync-core, tasks-core, utils pass. **Not deployed, not installed on any device** |
| done 2026-10-27 | Toasts no longer cover the header gear / sync dot: the host starts below the header (`top: 66px`). smoke-m6 checks it at 360/390 with 3 toasts (+ negative control) |
| done 2026-10-27 | Verifier fix pass (7 items, see §7 and §8). Tests: storage 26, sync-core 29, tasks-core 28, utils 10; smokes: icons 4/4, m6 33/33, motion 32/32 × 5 runs, m2 53/53, m4 37/37, m5b 140/140 at 390 and 360. Not deployed |
| done 2026-10-28 (code) | M7 expandable day strip (month grid) + area-coloured done circles, see "M7 plan" and §8. Tests: tasks-core 34; smoke-strip 89/89, m4 43, m6 33, motion 32 (motion + reduced), m5b ok at 390/360. **Not hand-tested on a phone** (swipe vs page-scroll vs week-scroller conflicts are the risk); fresh-context verifier pass still pending. Not deployed |
| pending | Smoke m2 check "old done one-off hidden" (`smoke-m2.mjs` ~:166) is stale: the working tree (not M7) always shows completed one-offs now, and the same file already asserts that further down. Update/remove the old check |
| pending | Fresh-context verifier pass over M1–M4 before calling v1 usable |
| pending | Hand-test gestures / settings / import on a real phone (M1 only machine-checked) |
| done 2026-10-27 | PNG icons (iOS ignores SVG apple-touch-icon): M6 step 3 |

### Product Owner
| Status | Item |
|---|---|
| open | Answer §3 open decisions |
| done 2026-10-26 | Firebase project created: `acadbro-166c4` (hosting site `acadbro-166c4`). Claude registered web app `AcadBro Web` (appId `1:395278719258:web:52c74d6abe52f6acf174a3`). |
| open | Console: enable **Email/Password** sign-in (Authentication → Sign-in method). |
| done 2026-10-26 | Firestore database `(default)` created: Standard edition, `asia-northeast1` (Tokyo), free tier. Checked 2026-10-27: live rules were still the deny-all default; local `firestore.rules` validates and passes 19/19 emulator checks. |
| open | Console: **create your account by hand** (Authentication > Users > Add user: email + password). There is no sign-up screen and no password reset, so keep the password safe. |
| open | **Deploy the rules BEFORE the app**: `cd "C:\Users\Sir\Downloads\AcadBro" && npx -y firebase-tools@latest deploy --only firestore:rules,firestore:indexes` then `--only hosting`. Claude has not deployed anything; say the word and it will. (`firebase.json` also carries `auth.providers.emailPassword`, which the CLI schema accepts; a plain `firebase deploy` would apply it too.) |
| done 2026-10-27 | Confirmed the M5 decisions in section 2. |
| done 2026-10-27 | Auth: Email/Password enabled and the PO's account created. |
| suspended 2026-10-27 | Run the M5 QA checklist on phone + desktop. **PO: QA paused until the app is more complete.** Checklist (12 steps): login uploads local data; wrong-password message; second device login keeps a recovery copy; foreground pull; airplane-mode edit (orange dot); offline cold start (SDK cache); back online ("Back in sync"); offline edits on both -> conflict sheet; both choices + Recovery copy; restore + Undo; logout warning; M1–M4 regression. |
| done 2026-10-27 | Deploy approved; Claude deployed rules + indexes, then hosting (commit `193436d`). Verified: live title "AcadBro", `sw.js` = `acadbro-v5`, live rules = repo rules, anonymous read of `users/x` -> 403. Auth now answers (0 users). |
| deferred | Timezone choice (§3): edge case, later. |
| done 2026-10-27 | Hosting deployed on the PO's "firebase deploy" (hosting only; rules unchanged since the earlier deploy). Verified live: title AcadBro, `sw.js` = `acadbro-v8`, `/.well-known/assetlinks.json` 200 `application/json` and identical to the repo file, 4 icons + `js/motion.js` 200. |
| open | After that deploy: copy `C:\Users\Sir\Downloads\AcadBro-APK\acadbro.apk` to the phone, install it (allow "install unknown apps"), open AcadBro and check there is **no URL bar**. If the URL bar shows, the cause is a fingerprint mismatch between assetlinks and the signing key (or the deploy is not live yet / Chrome cached an old check: clear Chrome's data or reinstall). |
| open | Hand-test sync on a real phone + desktop (conflict, offline edit, log out/in). |
| done 2026-10-26 | Decided: **login-only** for now (like GymBro; accounts created by hand in the console). Sign-up can be added later. |

## 7. Serious bugs

| Status | Bug |
|---|---|
| fixed in code 2026-10-27 (not deployed; not yet seen on a phone) | A task completed on a day showed as a filled dot on the Activity board but nothing on the day strip (the strip had no done indicator at all). Each strip day now has a small dot in the page accent colour when a task or subtask was completed that day on the current page (all areas on All). Same counting source as the board (`doneDates` in `tasks-core.js`); the dot slot exists on every cell so the strip never changes height. |
| fixed in code (row corrected 2026-10-27; needs the live two-device test) | Two devices open at once could overwrite each other. Saves now run in a transaction gated on `rev`, so a stale device gets the conflict sheet instead. |
| fixed in code 2026-10-27 (not deployed, not yet tested offline on a device) | Offline launch while signed in: the Firebase SDK was not in the service-worker cache, so sync stayed paused until online. `sw.js` now caches `gstatic.com/firebasejs/12.16.0/*` cache-first (SW cache `acadbro-v5`). Only works after the SDK has loaded once online. |
| fixed in code 2026-10-27 (M6 step 1a; not deployed, not tried on a real phone) | While an editor was open, tapping another button committed on blur and re-rendered, so that tap was swallowed. Now a capture-phase `pointerdown` records the press (`pendingTap`), blur defers its commit, and the click commits first then runs the tapped action. Reproduced and fixed in a headless run at 390px (rename, note and add editors; Esc still cancels). |
| fixed in code 2026-10-27 (M6 step 1b; not deployed) | Stacked toasts (top-right) could cover the Manage sheet's close button. While a sheet is open (`body.sheet-open`) the toast host sits at `right: 56px` (`styles.css`). Checked at 360 and 390px with 3 toasts and a tall Manage sheet: the close button is hit; the old position covers it. |
| fixed in the smoke 2026-10-27 (M6 step 5a) | The M5 smoke's SDK mock could be bypassed: once `sw.js` controls the page it fetches `gstatic.com/firebasejs` itself, outside page-level CDP Fetch, so the real SDK loads. Seen when the smoke's click waits grew to 450 ms (gstatic hits 0, login failed); those runs may have sent a sign-in with the fake `me@example.com` / `secret1` to the live Auth endpoint (not verified; a wrong login cannot write data). Now: `Network.setBypassServiceWorker` + Chrome `--host-resolver-rules` so only localhost resolves. |
| fixed in code 2026-10-27 (not deployed) | Up to 3 toasts (top-right, 8 s) covered the header gear and sync dot (elementFromPoint at the gear hit `.toast-close` at 360/390px). The toast host now starts below the header (`styles.css .toast-host top: 66px`); the sheet-open right offset (step 1b) is unchanged. smoke-m6 checks gear + dot at 360/390 with 3 toasts and a real gear tap. |
| fixed in code 2026-10-27 (not deployed) | A second local-data corruption overwrote the first saved copy at `acadbro-data-corrupt`, and the toast could claim a copy was kept when none was. Now 3 rotating slots (oldest overwritten only when full, said in the toast); messages from `storage.js recoveredMessage` claim a copy only when one exists. Node-tested (storage 22 -> 26). |
| fixed in code 2026-10-27 (not deployed) | Page-change fade sometimes swapped the view before it was fully faded (opacity 0.02–0.18 at swap in 2 of 3 motion-smoke runs): the 240 ms fallback timer fired before the transition ended when frames started late. `swapWithFade` now re-checks opacity on the timer and waits for `transitionend` (hard cap for background tabs). Reproduced 2/3 before, 0/5 after. |
| fixed in code 2026-10-27 (not deployed) | Each SW cache bump deleted the cached Firebase SDK, so the first offline launch after an update could not sync. The SDK now lives in `acadbro-sdk-12.16.0`, which activate keeps (it deletes only other `acadbro-*` caches, after moving their SDK entries over). App cache `acadbro-v8`. Not tested in a real browser offline. |
| fixed in code 2026-10-28 (found while building M7; not deployed) | (1) A vertical swipe on the strip would have been cancelled by the browser as page scroll: `touch-action` on the card does not reach into the `.day-strip` scroller (it stops at the nearest scroller), so `.day-strip` has its own `touch-action: pan-x`. (2) The click-eating flag after a strip swipe could swallow the next real tap when the touch swipe produced no click; it is now reset on every new press. Both covered by smoke-strip (touch swipes) |
| fixed 2026-10-26 | Review board header "LAST 7 DAYS" overlapped the first day column. Label is now "7 days" and the column is 64px. |

## 8. Changelog

- 2026-10-28: **M7 built (not deployed, not hand-tested on a phone).** `tasks-core.js`: `monthGrid`, `shiftMonthISO`, `doneDates` -> Map date -> area ids (+5 tests, 29 -> 34). `state.js` `ui.stripOpen` / `ui.monthAnchor`. `day-strip.js` rewritten: week strip + 6-row month grid in one card, chevron row bottom-right in both states, `toggleStrip` (fade out, render at pinned height, ease height, fade in; instant under reduced motion), `shiftMonth`, `monthToday`, `scheduleStripClose`, `.done-circle` markup. `events.js`: actions `strip-toggle`, `month-prev/next/today`, grid day pick (tickLanded, folds after 300 ms), Escape, vertical/horizontal strip swipes (`main.js` wires them). `styles.css`: `.strip-body`, `.strip-foot`, `.strip-toggle`, `.month-*`, `.done-circle` (+ `dc-fade-2/3` keyframes), `touch-action`; `.strip-done-dot` and its slot removed. `sw.js` cache v11. New `scripts/smoke/smoke-strip.mjs` (89 checks); `smoke-m4` strip checks now assert circles. Open for PO: dim vs hide neighbour days, fixed 6 rows, open state not remembered (all defaults kept).
- 2026-10-28: **Removed the "Show completed" toggle (not deployed).** Completed one-off tasks are now always listed on every task page (All/Living/Prod/Hobby share one toolbar). `tasks-core.js isRelevant(task, iso)` no longer takes comps/showCompleted; the `showCompleted` setting, `toggle-completed` action and its toast are gone (a stale `showCompleted` key in saved settings is ignored). `test-tasks-core` (29 pass) and `smoke-m2` updated; smoke-m2 not re-run.
- 2026-10-28: **Update prompt in Settings (not deployed).** New `web/js/app-update.js` (status idle/checking/uptodate/ready/error, `controllerchange` on an already-controlled page = "ready"), `page-settings.js` "App" group (`renderAppUpdateRows`, refreshed in place), `events.js` actions `check-update` / `apply-update`, `main.js initAppUpdate()`, `sw.js` cache `acadbro-v10`. `firebase.json`: `**/*.@(js|css)` now `no-cache` (before, the default 1 h HTTP cache could hand the network-first service worker stale JS after a deploy). `smoke-m6` and `smoke-motion` still pass; the update flow was checked by a fresh-context verifier in headless Chrome with the service worker active (simulated deploy by serving a changed `sw.js`): check -> "newest version", then "Update ready" in place with no layout shift, tap reloads, no console errors. Not exercised: the error status, the 20 s install timeout, the foreground quiet check, real touch, a real phone/TWA.

- 2026-10-27: **Day strip done dots (not deployed).** `tasks-core.js doneDates`, `day-strip.js` (dot under each day with a completion on the current page), `styles.css .strip-done-dot` (strip is 5px taller on every day, gap 6px to 4px), `sw.js` cache `acadbro-v9`. Tests: `test-tasks-core` (29 pass), `smoke-m4` (+6 strip checks), `smoke-motion` and `smoke-m6` still pass.

- 2026-10-27: **M6 step 6: Android TWA (not deployed, not installed).** New `android/` (Bubblewrap 1.24.1, package `app.acadbro`, v1); keystore + password outside the repo (`C:\Users\Sir\.acadbro-keys\`); signed APK copied to `C:\Users\Sir\Downloads\AcadBro-APK\acadbro.apk` (not in git). New `web/.well-known/assetlinks.json`. `firebase.json` hosting: ignore narrowed to keep `.well-known`, JSON content type for assetlinks (the only firebase.json change). `.gitignore`: keystores, APK/AAB/idsig, Android build dirs. `sw.js` not bumped (assetlinks is not in the SW cache; nothing the SW serves changed). `firestore.rules`, `web/js/*` untouched.

- 2026-10-27: **Verifier fix pass (not deployed).** (1) `styles.css .toast-host` starts at `top: 66px` (below the header), so the gear and sync dot stay tappable; new smoke-m6 checks (27 -> 33). (2) `storage.js keepCorruptCopy` / `recoveredMessage`: 3 rotating corrupt-copy slots, honest messages; `main.js` uses `recoveredMessage`. (3) `shell.js swapWithFade` swaps only after the fade-out ends (timer re-checks opacity, hard cap). (4) "Show completed" Undo now raises "Undone: ..." + Redo (`tasks-actions.js applyShowCompleted`); import asks Import / Cancel when its backup cannot be stored (`page-settings.js applyImport`); the monthly "shorter months" hint is always in the markup and toggled (`.is-off`, visibility only, no layout shift) on day change. (5) `sw.js`: SDK in `acadbro-sdk-12.16.0`, kept across app cache bumps; `acadbro-v7` -> `acadbro-v8`. (6) §4 cloud-doc field list now includes `rev`. (7) `smoke-m5b.mjs` recovery-copy marker = cloud-only task. Item 4 was checked with a scratch CDP script (hint toggles with equal panel height; Undo -> Redo -> Undo; import backup failure: Cancel keeps data, Import applies), not added to the repo smokes. Left as is: the 30-subtask limit (input disabled with "Subtask limit reached (30)", not silent). `firestore.rules`, `firebase.json`, `auth.js` untouched.

- 2026-10-27: **M6 step 5a: smokes in the repo.** New `scripts/smoke/` (`smoke-m2`, `smoke-m4`, `smoke-m5b`, `smoke-m6`, `smoke-motion`, `check-icons`, README). Scratchpad paths replaced by args/env (`SMOKE_OUT`, `CHROME_PATH`, `W`) and repo-relative defaults. Adaptations, no checks removed: click settle 120/150 -> 450 ms (M6 `swapWithFade` renders after a 160 ms fade); Chrome `--host-resolver-rules` offline guard on every smoke; m5b uses `Network.setBypassServiceWorker` because `sw.js` would otherwise fetch the SDK itself, outside Fetch interception. `web/`, `firestore.rules`, `firebase.json` untouched.

- 2026-10-27: **M6 steps 3–4 done (not deployed).** Icons: `web/icon/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (rendered from icon.svg with headless Chrome; header sizes checked); manifest lists them next to the SVG; `<link rel="apple-touch-icon">`; SW SHELL precaches them. Motion: new `web/js/motion.js`; `shell.js swapWithFade()` for every page change; editor expand-in (`ui.editorEnter`, `.ed-enter`); animated board fold (`foldReviewBoard`); toast transitions use `--dur`/`--ease-out` and `toast.js` reads `--dur` for its exit timer. SW cache `acadbro-v6` -> `acadbro-v7`. `firestore.rules`, `firebase.json`, `auth.js` untouched. Known: while toasts are up (top-right) they can cover the header gear on phones; not changed here.

- 2026-10-27: **M6 steps 1–2 done (not deployed).** `events.js` pendingTap (capture `pointerdown`/`pointerup`/`pointercancel` wired in `main.js`); toast host `right: 56px` while a sheet is open; import checks `LIMITS` (`storage.js importLimitProblems`, shown in the preview sheet, nothing applied) and refuses files over 2 MB before reading (`importSizeError`); login email `maxlength` 254, password 128; `normalizeData` always uses default area labels (no rename UI). SW cache `acadbro-v5` -> `acadbro-v6`. Tests: storage 18 -> 22 (+ the old label-merge assertion changed to "labels are fixed"). `firestore.rules`, `firebase.json`, `auth.js` untouched.
- 2026-10-27: **M5 built (not deployed).** New `cloud.js`, `auth.js`, `page-account.js`; `sync-core.js` gained `saveConflictBackup/readConflictBackup/clearConflictBackup/syncInfo/dirtySinceMs/readOwner/writeOwner/readAuthHint/writeAuthHint`; `storage.applyCloudData` now persists without marking dirty; Settings > Account (log in / status / sync now / log out / recovery copy), header sync dot, login + conflict + restore sheets (conflict sheet locked: `layers.js`, `shell.js`); `events.js` actions + Enter in the login form. New `firestore.rules` (owner-only, delete denied, field allow-list; caps projects 1000 / tasks 20000 / completions 50000 / areaLabels 10, all far above the UI limits because Firestore's 1 MiB doc limit binds first), `firestore.indexes.json`, `firebase.json` (+auth emailPassword, +firestore; hosting block unchanged). SW cache `acadbro-v2` -> `acadbro-v3`. Tests: new test-sync-core (20); storage 13, tasks-core 28, utils 10 unchanged and passing. Rules loaded on the local Firestore emulator and exercised over REST (owner create/update/read ok; other user, extra field, missing field, schema 2, wrong types, over-cap, delete, other collections all denied).
- 2026-10-27: M4 built: Review board (7-day dots per project, loose row, All grouped by area) + in-place 12-week heatmaps, fold toggle, week-start aware. New `web/js/review-board.js`; `tasks-core.js` gained `activityIndex/windowDays/heatmapGrid/intensityLevel/reviewGroups` (+7 tests, test-tasks-core 21 -> 28); placeholder removed from shell.js; SW cache `acadbro-v1` -> `acadbro-v2`. Not deployed.
- 2026-10-27: Firebase Hosting set up and deployed (hosting only): `firebase.json` + `.firebaserc` at repo root, `public: web`, `no-cache` on `/`, `index.html`, `sw.js`, `manifest.json`. Live at https://acadbro-166c4.web.app (title + headers verified). Redeploy: `cd <repo> && npx -y firebase-tools@latest deploy --only hosting`. Note `js/*` is cached 1h, so after a deploy a client may take up to an hour or a SW update to see new JS; bump the SW cache version on each release. Firestore/Auth config comes with M5.

- 2026-10-26: Project started; decisions §2 recorded.
- 2026-10-26: M2+M3 built: projects/tasks/subtasks CRUD, Grouped/Flat views, Show completed, swipe tray, Manage sheet, weekday/monthly recurrence, backfill via hold on done badge.
- 2026-10-26: M1 shell built (index/styles/sw/manifest, state, storage, toast, day strip, swipe/long-press ports, settings + JSON import/export).
