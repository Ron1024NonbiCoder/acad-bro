# Headless smoke scripts

Raw Chrome DevTools Protocol, no npm dependencies (Node's built-in `fetch` and `WebSocket`).
Run every command from the repo root.

**Offline by design.** They load the app only from a local static server on 127.0.0.1/localhost.
Chrome is started with `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1`,
so no other host even resolves. The M5 smoke replaces the Firebase SDK (`https://www.gstatic.com/firebasejs/...`)
with an in-memory mock served through CDP `Fetch` interception (and bypasses the service worker so every SDK
request reaches that interception). The live Firebase backend is never contacted.

## Needs

- Node >= 22.7 (built-in `WebSocket`; ESM `.js` without package.json). Tested on Node 24.
- Google Chrome. Default path `C:\Program Files\Google\Chrome\Application\chrome.exe`; override with `CHROME_PATH`.
- Free ports: the scripts use DevTools ports 9347 (m2), 9351 (m4), 9371/9372 (m5b at 390/360), 9400-9799 random (m6, motion).
- Output (screenshots, throwaway Chrome profiles) goes to `SMOKE_OUT`, default `<os tmp>/acadbro-smoke`.

## Self-contained (start their own static server on an OS-picked port)

| Script | Checks | Command |
|---|---|---|
| `check-icons.mjs` | PNG icon sizes (IHDR) in `web/icon/` | `node scripts/smoke/check-icons.mjs` |
| `smoke-m6.mjs` | M6 steps 1-2: tap-while-editing, toasts vs header gear/sync dot and vs sheet close at 360/390, import limits + 2 MB cap (33 checks) | `node scripts/smoke/smoke-m6.mjs` |
| `smoke-motion.mjs` | M6 step 4: no layout shift outside input windows, reduced motion (32 checks) | `node scripts/smoke/smoke-motion.mjs` |

Optional args for m6/motion: `[webRoot] [label]` (webRoot defaults to `<repo>/web`).

## Need the dev server

Start it first and read the port it logs (5180 by default, it moves up if busy):

```
node scripts/serve.mjs
```

| Script | Checks | Command |
|---|---|---|
| `smoke-m2.mjs` | M2/M3: views, CRUD, recurrence at 390px (53 checks) | `node scripts/smoke/smoke-m2.mjs <port>` |
| `smoke-m4.mjs` | M4: review board + heatmaps (37 checks) | `node scripts/smoke/smoke-m4.mjs <port>` |
| `smoke-m5b.mjs` | M5: login, sync, rejected save, conflicts, restore, logout, SDK unreachable, with the mocked SDK (140 checks) | `W=390 node scripts/smoke/smoke-m5b.mjs <port>` and `W=360 ...` |

PowerShell: `$env:W='360'; node scripts/smoke/smoke-m5b.mjs <port>`.

## Known

- `smoke-m5b.mjs` marks the cloud copy in the "recovery copy" check with a cloud-only task (`CloudOnlyTask`):
  area labels are fixed since M6 step 2, so a label marker would be reset.
- All PASS/`ok` lines go to stdout; exit code 0 means every check passed.
