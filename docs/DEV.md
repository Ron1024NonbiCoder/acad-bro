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
| 2026-10-27 | **Android = TWA first** (Play Store wrapper over the hosted PWA, same UI) | M6. Needs `assetlinks.json` + PNG icons. |
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
- [ ] Timezone handling (travel across zones): explained to PO 2026-10-27, waiting on choice. *Default: follow the device timezone.*
- [x] 2026-10-26 Input limits accepted: name 80 chars, note 2000, 30 subtasks per task, 200 projects, 5000 tasks. Hitting a limit shows a toast (never a silent reject).
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
- Tests: `node scripts/test-sync-core.mjs` (20). Headless smoke with a mocked Firebase SDK (login, save, rejected save + recovery, both conflict choices, restore + undo, logout, SDK unreachable) was run from a scratchpad script (not in the repo); it served the mock through CDP Fetch interception, so no live backend was touched.

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

## 6. To-dos

### Claude
| Status | Item |
|---|---|
| done 2026-10-26 | M1 shell & infrastructure (tests 10+13 pass; serve on PORT, default 5180) |
| done 2026-10-26 | M2 projects/tasks/subtasks CRUD + views, and M3 recurrence (tests 13+21+10 pass; headless smoke at 390px passes, `scratchpad/smoke.mjs`) |
| done 2026-10-27 | M4 review board + per-project heatmaps (`web/js/review-board.js`; pure logic in tasks-core.js; tests 13+28+10 pass; headless smoke at 390 and 360px passes) |
| done 2026-10-27 (code) | M5 auth + sync built and machine-tested against a mocked SDK (tests 20+13+28+10 pass; rules checked on the Firestore emulator). **Not tested against the live backend**: needs the PO steps below, then a real two-device pass |
| pending | M5 live test: log in, edit, confirm a second device/browser sees it; force a conflict (edit offline on both) and try both choices + Restore |
| pending | M6 |
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
| open | Auth: confirm Email/Password is enabled, then add your user (console > Authentication > Users > Add user). Checked after deploy 2026-10-27: Auth is set up, 0 users. |
| done 2026-10-27 | Deploy approved; Claude deployed rules + indexes, then hosting (commit `193436d`). Verified: live title "AcadBro", `sw.js` = `acadbro-v5`, live rules = repo rules, anonymous read of `users/x` -> 403. Auth now answers (0 users). |
| open | Timezone choice (§3). |
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
