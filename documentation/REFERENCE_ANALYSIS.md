# Reference analysis (Phase 1)

## 1. The video (30 s, 478×850 screen recording of a dashboard named "WareTrack")
Frames were extracted and inspected (see the build log). What was observed:

**Look & feel**
* Isometric-style 3D view from the front-right, narrow field of view, pale lavender-white ground, soft shadows, rounded low-poly models.
* Palette: royal blue (`#2f5bd6`) for the building, trucks' cabs, rack uprights and UI accents; white/neutral grey for walls, roads and cards; teal for a shipping container; cardboard tan boxes on wooden pallets; green round trees.
* Warehouse building: blue roof with a white circular logo, grey walls with a blue trim, a row of numbered loading doors each framed in blue, pallets visible in the doorways. Second view: sawtooth roof over four doors with number tags.
* Yard: yellow bay outlines, pallets and box stacks lying around, an outdoor rack with pallets, blue pallet crates, a road with dashed lane markings, white-and-blue box trucks (logo on the side) and a white/teal delivery truck driving on the road, **yellow forklifts** (with drivers) moving pallets, a parked cluster of forklifts at charging bays, concrete barriers.
* Blue **map-pin markers** float over pallets/objects of interest; a selected forklift gets a ring/outline and a small label.

**UI over the 3D canvas** (glass panels)
* Top bar: logo "WareTrack", global search ("sites, trucks, forklifts, pallets, shipments"), site selector (name, "% full · docks"), green "Live" chip with clock, notification bell, user (name + role).
* Top-left: three floating KPI chips — Stock on hand (with delta), Trucks on site, On-time delivery %.
* Right: zoom +/−, rotate, reset controls; a **frosted selection card** (icon, id, status pill, progress bar, key/value rows: carrying, moves today, speed, charger, site).
* Bottom-left: **Shipment tracking** timeline (Order confirmed → Picked → Loading → In transit → Delivered) with a detail tile (shipment id, destination, status, ETA).
* Bottom-right: tabbed list (Docks / Forklifts / Trucks) with per-row status pills and progress bars.
* Camera moves between the building, the dock side, the yard and the road while objects keep animating.

**Functions implied**: click-to-inspect, per-object live status, tracking, search, live clock, switching of site, camera control.

## 2. The Markdown guide ("Build a Live 3D Dashboard with Claude Code")
* Concept: every part of the business becomes a clickable 3D object that opens a stats card with real numbers.
* Three-part loop: **sync script** (pull numbers every 5 min) → **data file** → **3D dashboard** polling that file every minute, with a LIVE dot ("updated X min ago", grey if >30 min).
* Rules: totals only (no personal data), keys in `.env` never in the page, failed sync keeps the last good numbers, **Three.js** (not a flat chart page), animated objects, hover cursor / glow / glass card, 6–10 interactive objects, phone support, local server, plan before code, optional hosting with a password and a daily summary.

## 3. How both were combined
| Reference idea | Implementation here |
|---|---|
| Isometric blue/white warehouse, doors, trucks, forklifts, pallets, trees, road | `frontend/js/three/models.js`, `world.js` (hall with 4 numbered docks, office, yard racks, container, two decorative forklifts, trucks with logo decals) |
| Glass cards, KPI chips, tracking timeline, tabbed lists, controls, search, live chip, bell, user | `views/world.js`, `app.js`, `css/styles.css` |
| Click → real numbers | Selection → card built from `/api/scene` (database) for warehouse, section, rack, pallet, truck, inbound truck, worker, dock, office |
| Sync → data file → live dashboard | `services/sync` writes `snapshots/latest.json` every 5 min and exposes `lastSyncAt`; the browser is additionally pushed every change by SSE, the LIVE chip shows freshness (grey after 30 min or when the stream drops) |
| Totals only / keys safe | Snapshot contains aggregates only; secrets only in `.env` (git-ignored); AWS keys will follow the same rule |
| "Strategy game" feel | State changes animate: dispatching a delivery makes the truck drive off, returning trucks drive back and park, tasks send workers walking to racks/docks, stock changes pulse the pallet, full racks turn red, low stock shows a warning badge |
