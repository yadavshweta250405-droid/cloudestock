# Features checklist

Legend: ✅ implemented **and verified by an automated test** · 🟡 implemented, verified only partly (see note) · ⚠️ implemented but **not verified** in a real environment · ❌ not implemented.
"API test" = `tests/api.test.js` · "Browser test" = `tests/e2e/browser-smoke.mjs` (Three.js stubbed) · "Unit" = layout/sim tests.

## 3D environment
| Feature | Status | Notes |
|---|---|---|
| Isometric-style perspective camera, orbit/zoom/pan, reset, rotate, zoom buttons | ⚠️ | Needs real WebGL; code path executed with stub |
| Hall with 4 numbered docks, blue roof, trim; office; container; trees; road with lanes; yellow bay markings | ⚠️ | Visual fidelity to the video is unverified |
| Racks (32) with pallets and boxes, instanced; colours by fill status; FULL / low-stock badges; section labels | ⚠️ | Data → instances verified (pallet counts); pixels not |
| Trucks/vans with logo decals; inbound supplier trucks; decorative forklifts; workers with department hard-hats | ⚠️ | |
| Soft shadows, hemisphere + sun light, fog; performance mode; far-zoom LOD; instancing | ⚠️ | Not measured on devices |
| Interior view (roof lifts, front walls drop) auto-enabled when selecting an indoor rack/pallet | ⚠️ | |
| Hover cursor + tooltip, click selection, glow box + blue pin marker, camera fly-to | 🟡 | Selection → card verified for all 9 types; pixel picking not |

## Interactive objects → info cards (all values from the database)
| Object | Fields shown | Status |
|---|---|---|
| Warehouse | total inventory, total products, capacity, available, occupied, utilization | 🟡 card verified (browser test) |
| Section | racks, capacity, occupied, available, utilization, status, low-stock racks | 🟡 |
| Rack | id, location, products stored (+ quantities), quantity, available capacity, stock status | 🟡 |
| Pallet | product, SKU, quantity, batch, location, stock status | 🟡 |
| Truck | vehicle id, driver, assigned orders, delivery status, current location, destination | 🟡 |
| Worker | employee id, name, task, working status, department | 🟡 |
| Dock | number, incoming shipments, outgoing shipments, loading status, assigned vehicle | 🟡 |
| Office | staff, open tasks/orders, users | 🟡 |
| Inbound truck | supplier, status, dock, units | 🟡 |
Actions from cards (dispatch, complete delivery, set maintenance, break/off duty, receive stock, open product) call the same APIs as the screens: ✅ at API level, ⚠️ through the 3D buttons.

## Live simulation (3D ⇄ data)
| Behaviour | Status |
|---|---|
| Inventory change → pallet size/colour updates + flash ring | ✅ pallet count updates over SSE (browser test); animation ⚠️ |
| Order dispatched → truck leaves the dock and drives the road | ✅ state (API test) · ⚠️ animation |
| Vehicle delivered → returns, status updates, parks in a bay (background job) | ✅ (API test, real timer) · ⚠️ animation |
| Worker receives a task → walks to rack/dock and works; free → idles/wanders | ✅ task/status logic · ✅ routes (unit) · ⚠️ animation |
| Section/rack full → red; low stock → warning badge | ✅ data (API test) · ⚠️ colours |
| LIVE chip: fresh/stale/reconnecting | 🟡 |

## Inventory
Add/edit/delete(archive) products ✅ · stock in/out/adjust/transfer ✅ · assign to rack (receive, suggest rack) ✅ · movement history ✅ · low-stock alerts ✅ · search & filters ✅ (API) · image upload with signature check ✅ · categories ✅ · batch numbers ✅ · capacity & pallet-position enforcement ✅

## Orders
Create/view/edit(pending) ✅ · all 7 statuses with enforced transitions ✅ · reserve stock (oldest first) / release on cancel ✅ · failed order leaves no reservation ✅ · dispatch deducts stock once ✅ · UI create + advance ✅ (browser test)

## Deliveries / fleet
Register vehicles & drivers ✅ · assign driver ✅ · assign orders to vehicles (capacity, dock, driver checks) ✅ · dispatch / deliver / cancel ✅ · history ✅ · maintenance toggle ✅ · 3D movement ⚠️

## Employees & tasks
Add/edit/archive ✅ · departments ✅ · availability (available/busy/on break/off duty) ✅ · tasks: create, auto-assign, queue, start, complete, cancel ✅ · employees limited to own tasks ✅ · auto tasks from workflows ✅ · 3D activity ⚠️

## Warehouse
Sections, racks, capacity edit/delete rules ✅ · docks status/direction ✅ · inbound receiving (schedule/arrive/partial/complete) ✅ · utilization ✅ · layout limits (4 docks, 2+1 sections, 3×4 grid) documented

## Analytics
All 13 requested statistics + charts (stock level, movements, orders by status, section utilization, category, top products) ✅ equal to DB (API test) · recent activity ✅ · notifications ✅ · inventory trends ✅ · charts render ✅ (browser test)

## Platform
Auth (scrypt, tokens, lockout) ✅ · 4 roles + permission matrix ✅ · route protection ✅ (API) · menu hiding ✅ (browser) · migrations ✅ · seed ✅ · transactions ✅ · SSE ✅ · sync snapshot ✅ · responsive layout 🟡 (mobile nav verified; touch usage not) · AWS-ready abstractions ✅ (documented, no AWS code)

## Not implemented / known limitations
* ❌ React/TypeScript/Vite/Tailwind/Prisma/Express/Socket.IO (see README *Deviations*).
* ❌ Multiple warehouses in the UI/3D (schema supports it).
* ❌ Barcode scanning, pick-path optimisation, returns, purchase orders beyond inbound shipments, multi-currency.
* ❌ Email/SMS delivery of notifications (in-app only; SNS later).
* Demo passwords are fixed; tokens are in `localStorage`; HTTP only (put TLS in front).
* Worker/truck paths are graph-based; they do not avoid each other (they may overlap occasionally).
