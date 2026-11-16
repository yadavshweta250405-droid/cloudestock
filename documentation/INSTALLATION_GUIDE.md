# Installation guide

## Requirements
* **Node.js 22.13 or newer** (`node -v`). The app uses Node's built-in SQLite, `fetch` and `crypto.scrypt`; there is **nothing to `npm install`**.
* A modern browser with WebGL (Chrome, Edge, Firefox, Safari). Internet access on first load (Three.js comes from a CDN) — or run `npm run vendor:three` once for offline use.

## Install and run
```bash
cd waretrack3d
cp .env.example .env        # optional: defaults work without it
npm start                   # http://127.0.0.1:3000
```
First start creates `database/data/waretrack.db`, applies `database/migrations/*.sql` and loads demo data (`AUTO_SEED=true`). The demo logins are printed in the console and listed in the README.

### Step by step (explicit commands)
```bash
npm run db:migrate    # apply migrations only
npm run db:seed       # insert demo data (only if the DB has no users)
npm run db:reset      # delete the database + uploaded files, then re-seed
npm run dev           # same as start, restarts on file changes
./scripts/dev.sh      # (Windows: scripts\dev.bat) checks Node, copies .env, starts dev server
```

### Open from a phone or another computer on your network
Set `HOST=0.0.0.0` in `.env`, restart, then open `http://<your-computer-ip>:3000`. Only do this on a trusted network (HTTP, demo passwords).

### Offline 3D engine
```bash
npm run vendor:three   # downloads three.module.js + 2 addons into frontend/vendor/three
```
The server detects the folder and rewrites the page's import map automatically; reload the page.

## Configuration (`.env`)
See `.env.example`. Notable: `PORT`, `HOST`, `DB_FILE`, `STORAGE_DIR`, `AUTO_SEED`, `SESSION_TTL_HOURS`, `VEHICLE_RETURN_DELAY_MS` (how long a delivered truck takes to drive back), `SYNC_INTERVAL_MS` (snapshot sync, default 5 min), `CORS_ORIGIN`.

## Tests
```bash
npm test                       # 27 tests: API integration + 3D layout/pathing/movement logic
npm run test:e2e               # browser smoke test (needs Playwright + Chromium; uses a Three.js stub)
REAL_THREE=1 npm run test:e2e  # same with real Three.js, saves screenshots to tests/e2e/screenshots
```

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `Node.js 22.13 or newer` message | Upgrade Node. |
| 3D area says "3D view unavailable" | Three.js could not load (offline?) → `npm run vendor:three`; or WebGL is disabled in the browser. All 2D screens still work. |
| Blank/odd 3D scene | Open the browser console (F12) and note the first error. |
| "Cannot reach the server" | The server process stopped; run `npm start` again. |
| Forgot demo passwords | `npm run db:reset` (wipes data). |
| Phone is slow | Click the sun icon in the 3D controls ("Performance mode": no shadows, 1× pixel ratio). |
