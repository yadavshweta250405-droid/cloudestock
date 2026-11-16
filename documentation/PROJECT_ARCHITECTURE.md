# Project architecture

## 1. Big picture
```
 Browser (vanilla ES modules)                        Node 22 process
 ┌──────────────────────────────┐   REST/JSON    ┌─────────────────────────────────────────────┐
 │ app shell, 10 views, forms   │ ─────────────▶ │ http server  →  router  →  auth + RBAC      │
 │ 3D world (Three.js)          │ ◀───────────── │   modules/*  (business rules, transactions) │
 │   scene ← /api/scene         │   SSE push     │   services/* (swappable infrastructure)     │
 └──────────────────────────────┘ "changed"      │   SQLite (node:sqlite) · local file storage │
                                                 └─────────────────────────────────────────────┘
```
Single source of truth = the database. The 3D world holds **no state of its own**: it renders `GET /api/scene` and animates toward it.

## 2. Backend layers
| Layer | Files | Responsibility |
|---|---|---|
| Transport | `server.js`, `core/router.js` | HTTP, JSON parsing/limits, auth header, RBAC check, error mapping (SQLite UNIQUE → 409 etc.), SSE endpoint, static files (path-traversal safe), security headers |
| Validation | `core/validate.js`, `core/errors.js` | Declarative schemas → 422 with per-field messages |
| Domain modules | `modules/*.js` | Each exports `createService(ctx)` (rules) + `registerRoutes(router, ctx)` + optional `startJobs`. Only these know SQL. |
| Infrastructure services | `services/*` | Contracts in `services/contracts.js`; a provider is chosen per service by env var. |
| Wiring | `container.js` | Builds `ctx`: db, events, storage, auth, notifications, jobs, sync, activity log, `ctx.changed()` |
| Data | `database/migrations`, `seed.js` | Versioned SQL; seed uses the real services for live data |

### Infrastructure contracts (AWS-ready)
`database`, `storage`, `auth`, `notifications`, `events`, `jobs`, `sync` — each has a method list asserted at startup (`assertContract`). Business logic never imports a concrete implementation; it calls `ctx.storage.put(...)`, `ctx.events.publish(...)`, `ctx.jobs.enqueue(...)` and so on. Selecting a provider: `services/<name>/index.js` switches on `*_PROVIDER` (only `local` ships; other values throw a clear "not implemented" error pointing to the AWS guide).

## 3. Key business rules (enforced in the backend, in transactions)
* **Inventory** is `(product, rack, batch)` rows with `quantity` and `reserved`. All stock changes go through `inventory.adjust()` which enforces: rack **capacity**, **pallet positions** (max 6/rack), no negative stock, no removal of reserved stock, and always writes a **stock_movements** ledger row with the resulting balance.
* **Orders**: `Pending → Processing → Packed → Ready for Dispatch → Dispatched → Delivered` (`Cancelled` allowed until dispatch). Creating an order **reserves** stock (oldest first, across racks) and stores the allocation; cancelling releases it. Editing a pending order re-allocates atomically. Dispatch and delivery are executed by the *delivery* they belong to.
* **Deliveries**: assigning orders to an available vehicle with a free driver and a free outbound dock (capacity checked) puts the vehicle in `loading`; **dispatch** deducts stock exactly once (OUT movements), sets orders `Dispatched`, frees the dock and sets the vehicle `on_route`; completing the last order sets `returning` and a **background job** brings the vehicle back to `available` and a parking bay.
* **Inbound**: `Scheduled → Arrived (dock occupied, receiving task) → Unloading → Received`; receiving books stock via `adjust()` into the chosen or **suggested** rack (already stores the product → category's section → least filled).
* **Tasks & workers**: workflows create tasks (pick order, load truck, unload shipment); a free employee of the right department is auto-assigned and becomes `busy`; completing a task frees them and they automatically take the next waiting task. Status `busy` can't be set by hand.
* **Alerts**: low/out-of-stock notifications (de-duplicated, 6 h), delivery/vehicle/shipment notifications; all pushed live.

## 4. Real-time model
1. A mutation commits (SQLite is synchronous → transactions can't interleave).
2. `ctx.changed('inventory', 'orders', …)` coalesces scopes for 40 ms and publishes one `changed` event.
3. `server.js` forwards events to every `EventSource` client (`/api/events?token=…`, 25 s heartbeat; the browser reconnects automatically).
4. The browser debounces, re-fetches `/api/scene` (and refreshes the open table view) and `world.applyData()` **diffs** the state: pallets rebuilt in instanced meshes (changed ones flash), vehicles get a new *plan* (drive to dock / leave / patrol / return / park), workers get a new walking target.
5. The sync service additionally writes an aggregate snapshot every `SYNC_INTERVAL_MS` and exposes `lastSyncAt` for the LIVE chip (the guide's "sync → data file → dashboard" loop).

## 5. The 3D world (`frontend/js/three/`)
| File | Role |
|---|---|
| `layout.js` | Coordinates (metres): hall, docks, office, yard, road lanes; rack/pallet placement; **pedestrian and road graphs** with Dijkstra (pure, unit-tested) |
| `sim.js` | `Mover` (path following, turning) — pure, unit-tested |
| `models.js` | Factories: hall (roof/near walls/door gear), office, trucks and vans (decals), forklifts, workers, trees, ground/road/markings, text sprites |
| `world.js` | Renderer, lights/shadows, OrbitControls, **instanced** rack frames + pallets/boxes/tags, picking, hover/selection highlight + pin, camera tweens, interior view, LOD, quality toggle, vehicle/worker/forklift simulation, flash FX |

Performance choices: ~10 draw calls for all racks and ~1,000 boxes (InstancedMesh), shared geometries/materials, one shadow-casting light (1024/2048 map), pixel-ratio cap, "performance mode", far-zoom LOD (hides tags, drops small shadows), render loop paused when another screen is open or the tab is hidden.

Picking: raycast against pickable meshes; invisible objects are filtered manually (Three.js raycasts invisible meshes); a rack's transparent pick-box yields to a pallet hit inside it.

## 6. Security
* Passwords: scrypt with per-user salt, timing-safe compare; policy ≥8 chars, letter + digit; login lock after 5 failures/5 min per ip+email.
* Sessions: 256-bit random bearer tokens, stored only as SHA-256 hashes, expiring, revoked on logout/password/role change/deactivation.
* RBAC: one permission matrix (`shared/constants.js`) enforced per route on the server; the UI hides what you can't do (cosmetic only).
* Input: schema validation, parameterised SQL everywhere, JSON size limit 1 MB (2 MB images with signature check), DOM built with text nodes (no `innerHTML` of data), static server blocks traversal.
* Known limits: tokens travel in `localStorage` and (for SSE) in the query string — acceptable for a LAN/demo, use HTTPS and consider httpOnly cookies / Cognito for production; no CSRF risk because cookies aren't used.

## 7. Assumptions
Single warehouse per deployment (schema supports more); 600-unit racks with 6 pallet positions; on-time = delivered ≤72 h after order; demo passwords are fixed; "units" is the only quantity measure; SQLite single-writer is fine for one server instance.
