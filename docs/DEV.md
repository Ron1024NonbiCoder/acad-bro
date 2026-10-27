# AcadBro — Dev Doc (living, handoff-ready)

Productivity + hobby tracker. Sibling of GymBro (`C:\Users\Sir\Downloads\GymBro`):
**same design language, gestures and architecture, different domain.**
Last updated: 2026-10-27.

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
| 2026-10-26 | Storage shape (proposed): one doc `users/{uid}` written whole, like GymBro | Risk: 1 MB Firestore doc limit. Add a size guard (warn at 800 KB). Revisit if users accumulate large amounts of notes. |

## 3. Open decisions (waiting on Product Owner)

Defaults in *italics* are what gets built if no answer comes. Each is written so it is cheap to change.

- [x] 2026-10-26 Recurrence: **chosen weekdays** (all 7 = daily) and **monthly on day D**. If D exceeds the month's length, it falls on the last day of that month *(Claude default; confirm)*.
- [x] 2026-10-26 **Subtask completion counts as activity** for its day (and for its task's project). Subtask completions are logged in `completions` with a `subtaskId`.
- [x] 2026-10-26 A missed recurring occurrence **just passes**. No overdue pile-up.
- [x] 2026-10-26 **Task list has switchable views**: *Grouped by project* (collapsible project cards; loose tasks at top) / *Flat* (sorted by due, then priority, with a project chip). The choice is remembered per area, per device.
- [x] 2026-10-26 **All page** = everything due, recurring, or done on the selected day, grouped by area.
- [x] 2026-10-26 **Swipe-left tray**: Due / Priority / Repeat / Rename / Note / Move / Delete. A full swipe fires Due. Subtasks are added in the expanded view (tap the task).
- [ ] Monthly day D beyond the month's length goes to the last day (Claude default; confirm).
- [ ] Can areas be renamed / added? *Fixed 3 areas, labels renamable.*
- [x] 2026-10-26 Input limits accepted: name 80 chars, note 2000, 30 subtasks per task, 200 projects, 5000 tasks. Hitting a limit shows a toast (never a silent reject).
- [ ] Priority levels: *none / low / med / high.*
- [ ] Project archive vs delete: *both; archive hides the project but keeps its history.*
- [ ] Legal / disclaimer / privacy text: *none until public release.*
- [ ] App name / branding: *"AcadBro" for now.*
- [ ] Sync conflict handling: *GymBro model (dirty marker + base timestamp; a true conflict asks the user and keeps a recovery copy).*

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
- **M5: Auth + Firestore sync** (needs the Firebase project).
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
| blocked on PO | M5 auth + sync (needs the console steps and sign-up decision in the Product Owner table) |
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
| open | Console: create the **Firestore database** (pick region; GymBro uses `nam5`; can't change later). |
| done 2026-10-26 | Decided: **login-only** for now (like GymBro; accounts created by hand in the console). Sign-up can be added later. |

## 7. Serious bugs

| Status | Bug |
|---|---|
| open | While an editor is open, tapping another button commits on blur and re-renders, so that first tap can be swallowed. (From the builder's report; not reproduced on a device.) |
| open (minor) | Stacked toasts (top-right) can cover the Manage sheet's close button for a few seconds. Esc, scrim tap or drag-down still close it. |
| fixed 2026-10-26 | Review board header "LAST 7 DAYS" overlapped the first day column. Label is now "7 days" and the column is 64px. |

## 8. Changelog

- 2026-10-27: M4 built: Review board (7-day dots per project, loose row, All grouped by area) + in-place 12-week heatmaps, fold toggle, week-start aware. New `web/js/review-board.js`; `tasks-core.js` gained `activityIndex/windowDays/heatmapGrid/intensityLevel/reviewGroups` (+7 tests, test-tasks-core 21 -> 28); placeholder removed from shell.js; SW cache `acadbro-v1` -> `acadbro-v2`. Not deployed.
- 2026-10-27: Firebase Hosting set up and deployed (hosting only): `firebase.json` + `.firebaserc` at repo root, `public: web`, `no-cache` on `/`, `index.html`, `sw.js`, `manifest.json`. Live at https://acadbro-166c4.web.app (title + headers verified). Redeploy: `cd <repo> && npx -y firebase-tools@latest deploy --only hosting`. Note `js/*` is cached 1h, so after a deploy a client may take up to an hour or a SW update to see new JS; bump the SW cache version on each release. Firestore/Auth config comes with M5.

- 2026-10-26: Project started; decisions §2 recorded.
- 2026-10-26: M2+M3 built: projects/tasks/subtasks CRUD, Grouped/Flat views, Show completed, swipe tray, Manage sheet, weekday/monthly recurrence, backfill via hold on done badge.
- 2026-10-26: M1 shell built (index/styles/sw/manifest, state, storage, toast, day strip, swipe/long-press ports, settings + JSON import/export).
