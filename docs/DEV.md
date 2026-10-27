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
| 2026-10-27 | **Android = TWA first** (wrapper over the hosted PWA, same UI) | M6. Needs `assetlinks.json` + PNG icons. |
| 2026-10-27 | TWA: **self-installed APK first** (no Play Store yet); package name **`app.acadbro`** (fixed forever once on Play) | Keystore: Claude creates it and sets the password; losing it only means reinstalling (§3). |
| 2026-10-27 | M6 scope (PO): known bugs, PNG + maskable icons, transitions / no layout jumps, full verifier pass over M1–M5, TWA | Plan: §5 "M6 plan". |
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
- [x] 2026-10-27 Areas: *fixed 3 areas, labels renamable.*
- [ ] Timezone handling (travel across zones): **PO 2026-10-27: edge case, decide later.** Built as: follow the device timezone. Options when revisited: (2) fixed home timezone in the profile, synced; (3) device timezone + a toast when the timezone changes; plus an optional "day starts at HH:00" for late nights. Switching later only affects new records (stored `date` is never rewritten).
- [x] 2026-10-26 Input limits accepted: name 80 chars, note 2000, 30 subtasks per task, 200 projects, 5000 tasks. Hitting a limit shows a toast (never a silent reject).
- [x] 2026-10-27 TWA keystore: **Claude creates it and sets the password**; testing stage, so if it is lost the PO uninstalls and reinstalls the app. Keystore + password live outside the repo (see M6 step 6). Revisit before any Play Store release (use Play App Signing then).
- [x] 2026-10-27 PO approved the M6 step 2 defaults: import over the limits is refused with an explanation (no truncation); import files over 2 MB refused with the reason; area rename in Settings > Areas, edited in place, max 20 chars, empty resets to the default, with Undo.
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
- Tests: `node scripts/test-*.mjs` (no framework). Needs Node ≥ 22.7 (ESM `.js` without package.json).
- Dev server: `node scripts/serve.mjs` (PORT env, default 5180). `?page=prod` deep-links a page.
- Review board: `review-board.js` (string builders) over pure `tasks-core.js` `activityIndex` (one pass for all rows) / `windowDays` / `heatmapGrid` / `reviewGroups` / `intensityLevel`. The fade-in on opening is a one-shot `.rb-enter` class (only on the render that opened it). Actions: `review-fold`, `review-row`, `review-cell` (events.js); dots reuse `select-day`.
- Task logic: `tasks-core.js` (pure, node-tested), `tasks-actions.js` (one `commit()` = save + re-render + toast with Undo → Redo), `page-tasks.js` (render).
- `activeDays(projectId, tasks, completions, endISO, n, area)` → `[{date, count, active}]`; count = distinct tasks with any completion (task or subtask) that day.
- "Overdue" = one-off, not done, due before the **selected** day (not before today).
- Due and Repeat are mutually exclusive on a task: setting one clears the other (said in the toast; can be undone).
- Deleting a task/project also deletes its completions; Undo restores them.
- Editors: rename/note/add commit on blur + Enter, Esc cancels; Due/Repeat/Move/done-date panels use explicit Save/Cancel.
- Tray buttons are 40px (7 × 52px doesn't fit 360px phones).
- `storage.js` reports save/size errors via `hooks` (testable in node). Corrupt local data is copied to `acadbro-data-corrupt` + warning toast. Import = preview sheet → confirm, backup in `acadbro-import-backup`, Undo.
- Device-local settings (week start, haptics) live in `settings.js` and are never synced.

### Cloud sync (M5, built 2026-10-27)

- Files: `sync-core.js` (pure, node-tested: markers, BASE, `decideOnLoad`, retry delays, recovery copy, `syncInfo`), `cloud.js` (live `sync` status object + lazy loader + the actions the UI calls; no Firebase), `auth.js` (Firebase: login/logout, `cloudSave`, load, conflict, retry; dynamic-imported, SDK from `gstatic.com/firebasejs/12.16.0`), `page-account.js` (Settings > Account rows, header dot, login / conflict / restore sheets). Seam in `storage.js`: `cloud.onLocalChange` (set by auth.js while signed in) and `applyCloudData()` (swaps DB and writes localStorage **without** marking dirty).
- localStorage keys: `acadbro-dirty` (token per local save), `acadbro-sync-base` (cloud `updatedAt` ms last seen), `acadbro-last-sync`, `acadbro-owner-uid` (whose data this is), `acadbro-auth-hint`, `acadbro-conflict-backup`.
- Cloud doc `users/{uid}`: `schema, areaLabels, projects, tasks, completions, updatedAt` (server timestamp). `auth.js buildPayload()` and `firestore.rules` must list the same fields (maintenance contract in the rules file: deploy rules first).
- Load verdict (`decideOnLoad`): not dirty or data belongs to another account -> apply cloud (local copy kept as recovery first when it belongs to no account/another); dirty and cloud == BASE -> upload local; dirty and cloud moved on -> conflict sheet. If not dirty and cloud == BASE nothing is swapped (no re-render).
- Uploads are off until the account's doc has been fetched (`cloudReady`). Debounce 1 s; flush on `pagehide`/hidden; the dirty marker is cleared only when the acknowledged write's token still matches; retry 2/5/15/30/60 s, plus on `online` and on foreground. A write unacknowledged after 15 s is reported ("taking a while"), never waited on silently.
- Messages are positive and each says what to do next (see `ERRORS` / `LOGIN_ERRORS` in auth.js). Log out: tries one last upload (4 s cap), keeps local data, and warns if edits are still unsynced.
- Tests: `node scripts/test-sync-core.mjs` (29 as of 2026-10-27; storage 18). Headless smoke with a mocked Firebase SDK (login, save, rejected save + recovery, both conflict choices, restore + undo, logout, SDK unreachable) was run from a scratchpad script (not in the repo); it served the mock through CDP Fetch interception, so no live backend was touched.

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
- **Area label rename has no UI** although §3 says labels are renamable (PO confirmed). PO-approved: Settings > Areas, three rows edited in place (max 20 chars; empty resets to the default name), auto-save with a "Renamed" toast + Undo → Redo through the normal `commit()` path, so it syncs (areaLabels is cloud data, not device settings).
  Accept: unit tests for the import checks in `test-storage.mjs`; smoke for rename + undo.

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
- First move the headless smoke from the scratchpad into the repo as `scripts/smoke.mjs` (Chrome over CDP, mocked Firebase via Fetch interception, never the live backend) so later agents can rerun it.
- The verifier (a fresh agent that has not seen this work) checks every §2/§3 decision against the running app at 360 and 390px and reports gaps; Claude fixes them or lists them in §7.

**Step 6: TWA**
- Keystore (PO decision 2026-10-27): the executing agent lets Bubblewrap create it at `C:\Users\Sir\.acadbro-keys\acadbro.keystore` (alias `acadbro`), with a random 24-character password saved next to it in `C:\Users\Sir\.acadbro-keys\password.txt`. Both stay outside the repo and are never printed in chat or in this doc. If lost: make a new key, update `assetlinks.json`, and the PO uninstalls and reinstalls the app.
- Tool: Bubblewrap (`npx -y @bubblewrap/cli init --manifest https://acadbro-166c4.web.app/manifest.json`), project in `android/` at the repo root. Package `app.acadbro`, name "AcadBro", theme/background `#030303`, start URL `/`.
- Commit `android/twa-manifest.json` and the generated project; **never commit the keystore**: add `*.keystore`, `*.jks`, `android/**/build/` to `.gitignore`.
- Add `web/.well-known/assetlinks.json` (package name + SHA-256 of the signing certificate). **Trap:** `firebase.json` hosting `ignore` has `"**/.*"`, which drops `.well-known/`. Narrow that pattern, then confirm the file is served as JSON with a 200.
- `bubblewrap build` → signed APK. The PO installs it on the phone (Claude does not touch devices).
  Accept: `https://acadbro-166c4.web.app/.well-known/assetlinks.json` returns 200 JSON; the app opens with no URL bar (PO, on the device). If the URL bar shows, the fingerprint in assetlinks does not match the key.
- Data: a TWA runs in Chrome and shares Chrome's storage for this site, so local data is the same as the installed PWA on that phone; signed-in data is also in the cloud.

## 6. To-dos

### Claude
| Status | Item |
|---|---|
| done 2026-10-26 | M1 shell & infrastructure (tests 10+13 pass; serve on PORT, default 5180) |
| done 2026-10-26 | M2 projects/tasks/subtasks CRUD + views, and M3 recurrence (tests 13+21+10 pass; headless smoke at 390px passes, `scratchpad/smoke.mjs`) |
| done 2026-10-27 | M4 review board + per-project heatmaps (`web/js/review-board.js`; pure logic in tasks-core.js; tests 13+28+10 pass; headless smoke at 390 and 360px passes) |
| done 2026-10-27 (code) | M5 auth + sync built and machine-tested against a mocked SDK (tests 20+13+28+10 pass; rules checked on the Firestore emulator). **Not tested against the live backend**: needs the PO steps below, then a real two-device pass |
| pending | M5 live test: log in, edit, confirm a second device/browser sees it; force a conflict (edit offline on both) and try both choices + Restore |
| planned 2026-10-27 | M6, see §5 "M6 plan". All 6 steps ready to hand off; every decision they need is made (§3) |
| pending | Fresh-context verifier pass over M1–M4 before calling v1 usable |
| pending | Hand-test gestures / settings / import on a real phone (M1 only machine-checked) |
| pending | PNG icons (iOS ignores SVG apple-touch-icon) |

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
| open | Hand-test sync on a real phone + desktop (conflict, offline edit, log out/in). |
| done 2026-10-26 | Decided: **login-only** for now (like GymBro; accounts created by hand in the console). Sign-up can be added later. |

## 7. Serious bugs

| Status | Bug |
|---|---|
| fixed in code (row corrected 2026-10-27; needs the live two-device test) | Two devices open at once could overwrite each other. Saves now run in a transaction gated on `rev`, so a stale device gets the conflict sheet instead. |
| fixed in code 2026-10-27 (not deployed, not yet tested offline on a device) | Offline launch while signed in: the Firebase SDK was not in the service-worker cache, so sync stayed paused until online. `sw.js` now caches `gstatic.com/firebasejs/12.16.0/*` cache-first (SW cache `acadbro-v5`). Only works after the SDK has loaded once online. |
| open | While an editor is open, tapping another button commits on blur and re-renders, so that first tap can be swallowed. (From the builder's report; not reproduced on a device.) |
| open (minor) | Stacked toasts (top-right) can cover the Manage sheet's close button for a few seconds. Esc, scrim tap or drag-down still close it. |
| fixed 2026-10-26 | Review board header "LAST 7 DAYS" overlapped the first day column. Label is now "7 days" and the column is 64px. |

## 8. Changelog

- 2026-10-27: **M5 built (not deployed).** New `cloud.js`, `auth.js`, `page-account.js`; `sync-core.js` gained `saveConflictBackup/readConflictBackup/clearConflictBackup/syncInfo/dirtySinceMs/readOwner/writeOwner/readAuthHint/writeAuthHint`; `storage.applyCloudData` now persists without marking dirty; Settings > Account (log in / status / sync now / log out / recovery copy), header sync dot, login + conflict + restore sheets (conflict sheet locked: `layers.js`, `shell.js`); `events.js` actions + Enter in the login form. New `firestore.rules` (owner-only, delete denied, field allow-list; caps projects 1000 / tasks 20000 / completions 50000 / areaLabels 10, all far above the UI limits because Firestore's 1 MiB doc limit binds first), `firestore.indexes.json`, `firebase.json` (+auth emailPassword, +firestore; hosting block unchanged). SW cache `acadbro-v2` -> `acadbro-v3`. Tests: new test-sync-core (20); storage 13, tasks-core 28, utils 10 unchanged and passing. Rules loaded on the local Firestore emulator and exercised over REST (owner create/update/read ok; other user, extra field, missing field, schema 2, wrong types, over-cap, delete, other collections all denied).
- 2026-10-27: M4 built: Review board (7-day dots per project, loose row, All grouped by area) + in-place 12-week heatmaps, fold toggle, week-start aware. New `web/js/review-board.js`; `tasks-core.js` gained `activityIndex/windowDays/heatmapGrid/intensityLevel/reviewGroups` (+7 tests, test-tasks-core 21 -> 28); placeholder removed from shell.js; SW cache `acadbro-v1` -> `acadbro-v2`. Not deployed.
- 2026-10-27: Firebase Hosting set up and deployed (hosting only): `firebase.json` + `.firebaserc` at repo root, `public: web`, `no-cache` on `/`, `index.html`, `sw.js`, `manifest.json`. Live at https://acadbro-166c4.web.app (title + headers verified). Redeploy: `cd <repo> && npx -y firebase-tools@latest deploy --only hosting`. Note `js/*` is cached 1h, so after a deploy a client may take up to an hour or a SW update to see new JS; bump the SW cache version on each release. Firestore/Auth config comes with M5.

- 2026-10-26: Project started; decisions §2 recorded.
- 2026-10-26: M2+M3 built: projects/tasks/subtasks CRUD, Grouped/Flat views, Show completed, swipe tray, Manage sheet, weekday/monthly recurrence, backfill via hold on done badge.
- 2026-10-26: M1 shell built (index/styles/sw/manifest, state, storage, toast, day strip, swipe/long-press ports, settings + JSON import/export).
