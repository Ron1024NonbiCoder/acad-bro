# AcadBro — Dev Doc (living, handoff-ready)

Productivity + hobby tracker. Sibling of GymBro (`C:\Users\Sir\Downloads\GymBro`):
**same design language, gestures and architecture, different domain.**
Last updated: 2026-10-26.

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
| 2026-10-26 | Git: local repo, Claude commits at milestones, no remote / no push without permission | |
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
- Dev server: `node scripts/serve.mjs` (PORT env, default 5180). `?page=prod&demo=1` shows a demo swipe row.
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
- **M4: Review board + heatmaps.**
- **M5: Auth + Firestore sync** (needs the Firebase project).
- **M6: Polish, limits, Android wrapper.**

## 6. To-dos

### Claude
| Status | Item |
|---|---|
| done 2026-10-26 | M1 shell & infrastructure (tests 10+13 pass; serve on PORT, default 5180) |
| next | M2 projects & tasks CRUD + view switch |
| pending | M3–M6 |
| pending | Hand-test gestures / settings / import on a real phone (M1 only machine-checked) |
| pending | PNG icons (iOS ignores SVG apple-touch-icon) |

### Product Owner
| Status | Item |
|---|---|
| open | Answer §3 open decisions |
| open | Create a new Firebase project (Hosting + Firestore + Email/Password auth) and send the web config. Not needed until M5. |

## 7. Serious bugs

_None yet._

## 8. Changelog

- 2026-10-26: Project started; decisions §2 recorded.
- 2026-10-26: M1 shell built (index/styles/sw/manifest, state, storage, toast, day strip, swipe/long-press ports, settings + JSON import/export).
