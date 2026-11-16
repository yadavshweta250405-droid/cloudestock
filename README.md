<div align="center">

# WareTrack 3D
### Interactive 3D Warehouse Management System

[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Three.js](https://img.shields.io/badge/Three.js-r160-black?style=for-the-badge&logo=threedotjs&logoColor=white)](https://threejs.org)
[![SQLite](https://img.shields.io/badge/SQLite-Built--in-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org)
[![Tests](https://img.shields.io/badge/Tests-27%2F27%20pass-brightgreen?style=for-the-badge)](./tests)
[![License](https://img.shields.io/badge/License-Private-red?style=for-the-badge)](#)

> **Ek aisa warehouse management system jahan 3D sirf dikhawa nahi, database ka "live chehra" hai.**
>
> Rack pe click karo → asli stock dikhega. Truck dispatch karo → 3D mein woh sach mein nikal kar road pe chal dega.

---

**[Quick Start](#quick-start)** &bull; **[Screens & Features](#screens--features)** &bull; **[Architecture](#architecture)** &bull; **[Roles & Permissions](#roles--permissions)** &bull; **[Configuration](#configuration)** &bull; **[Tests](#tests)** &bull; **[AWS Migration](#aws-migration)** &bull; **[Roadmap](#roadmap)**

</div>

---

## Ye Project Kya Hai?

**WareTrack 3D** ek poora **Warehouse Management System (WMS)** hai jisme ek **live 3D warehouse model** bana hua hai — bilkul video jaisa (isometric blue building, numbered docks, forklifts, delivery trucks, racks, hardhat workers).

**Jo 3D mein dikhta hai, woh directly database se aata hai:**

| 3D Action | Real Effect |
|-----------|-------------|
| Rack pe click | Us rack ka actual stock, batch numbers, pallet positions |
| Truck pe click | Driver ka naam, assigned orders, destination, status |
| Order Dispatch karo | Truck dock se nikal ke road pe chalti hai (3D animation) |
| Stock Receive karo | Pallet bada hota hai + ek hari ring flash karti hai |
| Worker pe click | Employee ka naam, current task, department |
| Stock low hua | Bell bajti hai + rack pe "!" badge aata hai |

> **Golden Rule:** Database hi ek sach hai. 3D ke paas apna koi data nahi hota — woh sirf `GET /api/scene` render karta hai.

---

## Quick Start

### Requirements

```
Node.js 22.13 ya usse upar  ->  node -v se check karo
Ek modern browser (Chrome, Edge, Firefox, Safari)
Koi bhi npm install NAHI chahiye — zero dependencies!
```

### Chalao (3 Steps mein)

```bash
# Step 1: Folder mein jao
cd waretrack3d

# Step 2: (Optional) .env file banao
cp .env.example .env

# Step 3: Server start karo
npm start
```

**Browser mein kholo:** http://localhost:3000

> **Pehli baar** chalaoge toh database apne aap ban jayega aur demo data bhar jayega. Console mein saare credentials print honge.

---

## Demo Login Credentials

| Role | Email | Password | Kya kar sakta hai |
|------|-------|----------|-------------------|
| **Admin** | `admin@waretrack.local` | `Admin@123` | Poora system — users, layout, settings sab kuch |
| **Warehouse Manager** | `manager@waretrack.local` | `Manager@123` | Fleet, workers, layout, tasks, inventory |
| **Inventory Manager** | `inventory@waretrack.local` | `Inventory@123` | Products, stock in/out, orders, inbound |
| **Employee** | `employee@waretrack.local` | `Employee@123` | 3D dekhna, dashboard, sirf apne tasks |

> **WARNING: Production se pehle** in sab credentials ko zaroor badlo aur `AUTO_SEED=false` karo!

---

## Useful Commands

```bash
npm start              # Server chalao  ->  http://localhost:3000
npm run dev            # Dev mode (file badlane par auto-restart)
npm test               # 27 automated tests chalao
npm run test:e2e       # Browser smoke test (Playwright chahiye)
npm run db:reset       # Poora data mita kar demo data dobara daalo
npm run db:migrate     # Sirf naye schema changes apply karo
npm run db:seed        # Sirf demo data daalo (khali DB par)
npm run vendor:three   # Three.js ko local download karo (offline ke liye)
npm run docs:generate  # API + DB reference docs generate karo
```

> **Phone/LAN se access karna hai?** `.env` mein `HOST=0.0.0.0` karo, restart karo, phir `http://<computer-ka-ip>:3000` kholo. Sirf trusted network par karo!

---

## System Flow — Kaise Kaam Karta Hai?

```
+-----------------------------------------------------------------------+
|                             BROWSER                                   |
|  +----------------------+       +--------------------------------+    |
|  |  10 Management       |       |  3D World (Three.js)           |    |
|  |  Screens + Forms     |       |  - 32 Racks, Pallets           |    |
|  |  (Inventory, Orders, |       |  - 6 Vehicles + Docks          |    |
|  |   Fleet, Team etc.)  |       |  - 13 Workers                  |    |
|  +----------+-----------+       +---------------+----------------+    |
|             |                                   |                     |
|             +---- REST API (JSON) --------------+                     |
|             |<--- SSE "changed" push -----------+                     |
+-------------|-------------------------------------------------------  +
              |
+-------------v---------------------------------------------------------+
|                     NODE.JS SERVER (Port 3000)                        |
|                                                                       |
|   HTTP + Router  ->  Auth + RBAC Check  ->  Business Modules         |
|   +-------------------------------------------------------------+     |
|   |  modules/: inventory, orders, deliveries, receiving,        |     |
|   |            tasks, employees, warehouse, dashboard, auth      |     |
|   +---------------------------+---------------------------------+     |
|                               |                                       |
|   services/ (swappable) ------+                                       |
|   +-----------+----------+-------+---------------+------+------+      |
|   | database  | storage  | auth  | notifications | jobs | sync |      |
|   | (SQLite)  | (local)  |       |               |      |      |      |
|   +-----------+----------+-------+---------------+------+------+      |
+-------------------------------+---------------------------------------+
                                |
+-------------------------------v---------------------------------------+
|              SQLite DATABASE (waretrack.db)                           |
|           23 tables — single source of truth                          |
+-----------------------------------------------------------------------+
```

**Flow step by step:**
1. Aap login karo → server **JWT token** deta hai (12 ghante valid)
2. Har action pe browser `/api/...` call karta hai → server **permission check** karta hai → **business rules** lagate hain → **database transaction** mein save hota hai
3. Save hote hi server **SSE `changed` event** push karta hai sabhi open browsers ko
4. Browser `/api/scene` dobara fetch karta hai → 3D world **diff + animate** hota hai
5. Har 5 min mein **sync service** `snapshots/latest.json` likhti hai → Top bar ka **LIVE chip** batata hai data fresh hai ya stale

---

## Screens & Features

### Top Bar (Har Screen Pe Available)

| Element | Kya Karta Hai |
|---------|---------------|
| **Search Box** | Products, orders, vehicles, workers, racks dhundhta hai. Result pe click → 3D mein camera wahan jaata hai ya screen khulti hai |
| **LIVE Chip** | Green = data fresh hai + SSE connected. Grey = 30 min se purana ya connection toot gaya "RECONNECTING" |
| **Bell (notifications)** | Low stock, truck nikla, truck wapas aaya, inbound truck aaya — sab notifications yahan. "Mark all read" button bhi |
| **User Menu** | Change password, Sign out |

**Left Menu:** `3D World` &bull; `Analytics` &bull; `Inventory` &bull; `Orders` &bull; `Fleet` &bull; `Inbound` &bull; `Team` &bull; `Layout` &bull; `Activity` &bull; `Users` *(sirf Admin)*

---

### Screen 1 — 3D World

#### KPI Chips (Top-Left)
- Stock on hand
- Trucks on site
- On-time delivery % (pichle 30 din)
- Warehouse utilization %

#### Rack Colors (Legend)
| Color | Matlab |
|-------|--------|
| Blue | Normal use mein hai |
| Orange | 85%+ bhara hua |
| Red | Bilkul full |
| Amber | Low-stock pallet |

#### Camera Controls
| Button | Action |
|--------|--------|
| + / - | Zoom in / Zoom out |
| Rotate | 45 degrees ghumao |
| Reset | Camera reset (poori warehouse ek saath dikhti hai) |
| Interior | Chhat uth jaati hai, samne ki diwar neeche, andar ke racks dikhte hain. Indoor rack/pallet select karo → apne aap on hota hai |
| Performance | Shadows band, kam resolution (phone ya slow PC ke liye) |

**Mouse Controls:** Drag = ghumao &bull; Scroll/Pinch = Zoom &bull; Right-drag = Pan &bull; Click = Select &bull; Empty space click / `Esc` = Deselect

#### Click Karo — Glass Info Card Khulta Hai

| Object | Card Mein Kya Dikhega | Card Ke Buttons |
|--------|----------------------|-----------------|
| **Warehouse Building** | Total inventory, products count, capacity, occupied, available, utilization % | Open Layout, Interior View |
| **Section Label (A/B/C)** | Racks count, capacity, occupied, utilization, status, low-stock racks | — |
| **Rack** | Rack ID, location, stored products (clickable), quantity, free capacity, status | Receive Stock, Open Rack |
| **Pallet** | Product naam, SKU, quantity, reserved qty, batch no, location | Open Product, Receive More |
| **Delivery Truck** | Vehicle ID, driver, assigned orders, delivery status, destination, capacity | Dispatch, Mark Delivered, Cancel Loading, New Delivery, Maintenance / Back in Service |
| **Supplier (Inbound) Truck** | Supplier naam, status, dock no, units received so far | Receive All Goods, Open Shipment |
| **Worker** | Employee ID, naam, current task, status, department, location | Send on Break, Back on Duty, Off Duty, Open Team |
| **Dock** | Dock number, direction, incoming shipment, outgoing delivery, loading status | Set Maintenance / Reopen, Dispatch |
| **Office** | Management staff count, open tasks, open orders, active users | Analytics, Orders |

> NOTE: Buttons role ke hisaab se dikhte hain — Employee ko sirf read-only cards milenge.

#### Bottom Panels

**Bottom-Left — Shipment Tracking Timeline:**
```
Order Confirmed -> Picked -> Loading (Dock #) -> In Transit -> Delivered
```
Selected truck ki delivery dikhata hai, warna jo active ho.

**Bottom-Right — Tabbed List:**
`Docks` / `Workers` / `Trucks` — kisi bhi row pe click karo → camera wahan jaata hai + card khulta hai

#### 3D Mein Jo Automatically Hota Hai
- Workers apne department ke color ka hardhat pehente hain. Task milte hi rack/dock tak chalke jaate hain aur bounce animation karte hain. Free workers apne zone mein wander karte hain. Break wale break area mein, off-duty invisible.
- Loading truck dock par; available/maintenance truck yard bay mein; on-route truck road par chalti hai; delivered truck wapas parking bay mein aati hai
- Supplier truck dock par aata hai, receive complete hone par chala jaata hai
- 2 decorative forklifts pallets idhar-udhar le jaate hain (decorative only, real data se linked nahi)
- Full rack pe "FULL" badge, low stock pe "!" badge blink karta hai

---

### Screen 2 — Analytics Dashboard

**13 KPI Cards:**
```
Total Products    | Total Inventory  | Total Orders     | Pending Orders
Completed Orders  | Active Deliveries| Vehicles         | Employees
Utilization %     | Low Stock Items  | Incoming         | Outgoing
On-Time %
```

**Charts (Sab Database Se, Koi Hardcoded Number Nahi):**
- Inventory Level (14 din ka trend)
- Inbound vs Outbound movements
- Orders by Status (pie chart)
- Section Utilization (A/B/C)
- Stock by Category
- Top Shipped Products
- Low Stock Alerts
- Recent Activity

**"Refresh" button** bhi hai manual refresh ke liye.

---

### Screen 3 — Inventory Management

**Tabs:** `Products` &bull; `Stock by Location` &bull; `Movement History`

#### Products Tab
| Button | Kya Karta Hai |
|--------|---------------|
| Add Product | SKU, naam, category, price, reorder level — validation ke saath |
| Receive Stock | Product + rack + quantity + batch; rack ka smart suggestion milta hai |
| Row Click | Product detail: locations table, recent movements, image upload |
| Edit | Product details update karo |
| Delete | Stock hai → blocked; Movement history hai → **archive** (soft delete); Kuch nahi → permanently hata do |
| Adjust | Naya quantity + reason (ADJUST movement record banta hai) |
| Move / Transfer | Ek rack se doosre rack pe stock bhejo |
| Issue | Manual stock nikalna |
| Filters | Search by naam, category, stock level (ok/low/out), archived bhi dikhao |

**Business Rules (Server Side Enforce Hote Hain):**
- Rack ki capacity exceed nahi hogi
- Ek rack pe max 6 pallet positions (6 unique products/batches)
- Negative stock nahi ho sakta
- Reserved stock nahi nikala ja sakta jab tak order cancel na ho
- Har badlav automatically `stock_movements` ledger mein record hota hai balance ke saath

---

### Screen 4 — Orders

**New Order Fields:** Customer naam, delivery address, city, priority (Normal/High/Urgent), items (product + quantity)

> NOTE: Order banate hi stock **reserve** ho jaata hai (oldest batch pehle, multiple racks mein spread). Agar stock nahi hai → clear error aata hai, koi partial reservation nahi hoti.

**Status Filter Chips + Search Box available hain.**

#### Order Status Flow
```
Pending  ->  Processing  ->  Packed  ->  Ready for Dispatch  ->  Dispatched  ->  Delivered
                                                                 |
                                        Cancelled (kisi bhi step se, Dispatch se pehle)
```

| Button | Kab Available |
|--------|--------------|
| Edit | Sirf Pending orders |
| Move to Processing | Pending → Processing; auto-assigns a **picking task** to a free picker |
| Move to Packed | Processing → Packed |
| Ready for Dispatch | Packed → Ready |
| Assign to Vehicle | Packed/Ready + koi delivery nahi assigned |
| Dispatch | Ready + delivery assigned |
| Mark Delivered | Dispatched orders |
| Cancel Order | Dispatch se pehle; reserved stock wapas release hota hai |

---

### Screen 5 — Fleet Management (Vehicles + Drivers + Deliveries)

**New Delivery banate waqt:**
- Vehicle choose karo (sirf available wala dikhega)
- Orders select karo (Packed/Ready status wale)
- Dock choose karo (auto ya manual, free outbound dock chahiye)
- Driver assign karo
- Capacity check automatically hota hai

**Delivery States:**
| Action | Kya Hota Hai |
|--------|--------------|
| Create Delivery | Vehicle → `loading`, dock → `occupied`, "Load Truck" task → Shipping team ko |
| Dispatch | Stock ek hi baar katta hai, orders → `Dispatched`, dock free, truck → `on_route`, 3D mein truck nikal jaata hai |
| Complete / Mark Delivered | Orders → `Delivered`, truck → `returning`, background job truck wapas laata hai, truck → `available` + parking bay |
| Cancel | Sirf loading ke time; vehicle + dock free hote hain |

**Vehicles Tab:**
- Register karo (license plate, type, capacity)
- Edit karo
- Maintenance mode / Back in service toggle
- Remove (sirf agar koi delivery history nahi)

**Drivers Tab:**
- Add/edit karo
- Remove (history hai toh archive)

---

### Screen 6 — Inbound (Supplier Se Maal Aana)

**Complete Flow:**

```
Schedule Shipment -> [Truck Road Pe] -> Arrived at Dock -> [3D Mein Truck Aata Hai]
       |
Receive Goods (line-wise: quantity + rack, ya Auto Putaway)
       |
Receive All -> [Stock Racks Mein, Dock Free, Truck Chala Jaata Hai]
```

- **Partial receive** allowed — status `Unloading` rahegi
- **Auto Putaway** smart suggestion karta hai: agar product pehle se kisi rack mein hai toh wahi, warna section ke hisaab se least-filled rack suggest hoti hai
- **Cancel** bhi possible hai

---

### Screen 7 — Team (Employees + Tasks)

**Employees:**
- Add/edit/archive karo
- Department assign karo (Warehouse, Shipping, Receiving, Management)
- Availability: `Available` / `On Break` / `Off Duty`
- **"Busy" status manually set nahi hota** — woh sirf active task se aata hai

**Tasks:**
- New task banao (type, priority, location — worker 3D mein wahan chalke jaayega)
- Auto-assign ya manual assign karo
- Task complete hote hi worker free hota hai aur agla waiting task khud utha leta hai

**Auto-Created Tasks:**
| Trigger | Task |
|---------|------|
| Order → Processing | Picking task (picker ke liye) |
| New Delivery created | Load Truck task (Shipping team ke liye) |
| Inbound truck arrived | Unloading task (Receiving team ke liye) |

**Employee Role:** Sirf "My Tasks" dikhega; apne tasks hi start/complete kar sakta hai.

---

### Screen 8 — Warehouse Layout

- Capacity cards for each section (A Indoor, B Indoor, C Yard)
- Rack grid har section mein (color = fill status)
- Rack pe click → pallet details + Edit Capacity + Delete Rack (sirf khali rack)
- **Add Rack:** Row 1-3 (indoor) / 1-2 (yard), Column 1-4

**Docks:**
- Maintenance mode / Reopen toggle
- Direction set karo: Inbound / Outbound / Both

---

### Screen 9 — Activity Log

- Poora audit trail: **kisne, kya, kab** kiya
- Notifications section bhi yahan
- "Mark all notifications read" button

### Screen 10 — Users Management (Admin Only)

| Action | Detail |
|--------|--------|
| New User | Email, naam, role assign karo |
| Edit | Naam, email badlo |
| Change Role | Admin, Manager, Inventory, Employee |
| Deactivate | User ko block karo (login nahi hoga) |
| Reset Password | Temporary password do |
| Delete | Sirf agar koi history nahi |

> NOTE: Last admin delete nahi hota; Khud ko deactivate nahi kar sakte.

---

## Roles & Permissions

| Feature | Admin | W. Manager | Inv. Manager | Employee |
|---------|:-----:|:----------:|:------------:|:--------:|
| 3D dekhna, Dashboard, Search | Yes | Yes | Yes | Yes |
| Products + Stock manage | Yes | Yes | Yes | No |
| Orders banana/advance karna | Yes | Yes | Yes | No |
| Inbound shipments | Yes | Yes | Yes | No |
| Activity log dekhna | Yes | Yes | Yes | No |
| Fleet (vehicles, drivers, deliveries) | Yes | Yes | No | No |
| Employees + Tasks manage | Yes | Yes | No | No |
| Warehouse Layout | Yes | Yes | No | No |
| Users manage | Yes | No | No | No |
| Apne tasks start/complete | Yes | Yes | Yes (apne) | Yes (apne) |

> Menu mein jo screen role ke liye accessible nahi hai, woh dikhti hi nahi. **Aur server pe bhi block hai** — sirf chhupana enough nahi hota.

---

## Architecture

### Folder Structure

```
waretrack3d/
|
+-- backend/
|   +-- src/
|       +-- server.js          -> HTTP server, SSE, static file serving, API routing
|       +-- container.js       -> Dependency injection — sab services ko jodhta hai
|       +-- config.js          -> .env loader, defaults
|       +-- modules/           -> Business logic (database se baat karte hain)
|       |   +-- auth.js        -> Login, logout, user CRUD, sessions
|       |   +-- inventory.js   -> Stock in/out/adjust/transfer, low-stock alerts
|       |   +-- orders.js      -> Order lifecycle, reservations
|       |   +-- deliveries.js  -> Fleet management, dispatch
|       |   +-- receiving.js   -> Inbound shipments
|       |   +-- tasks.js       -> Employee tasks, auto-assignment
|       |   +-- employees.js   -> Employee management
|       |   +-- warehouse.js   -> Racks, docks, layout
|       |   +-- dashboard.js   -> Analytics, KPIs, charts
|       |   +-- misc.js        -> Search, activity, notifications, sync
|       |
|       +-- services/          -> Swappable infrastructure (Local aaj, AWS kal)
|       |   +-- contracts.js   -> Interface definitions (assertContract)
|       |   +-- database/      -> SQLite (default) | PostgreSQL (AWS)
|       |   +-- storage/       -> Local disk (default) | S3 (AWS) <- s3.js READY!
|       |   +-- auth/          -> Session tokens (default) | Cognito (AWS)
|       |   +-- events/        -> In-process SSE (default) | SNS/EventBridge (AWS)
|       |   +-- notifications/ -> In-app (default) | SNS+SES (AWS)
|       |   +-- jobs/          -> setTimeout (default) | SQS+Lambda (AWS)
|       |   +-- sync/          -> Local file (default) | Lambda+S3 (AWS)
|       |
|       +-- core/
|           +-- router.js      -> Lightweight HTTP router with RBAC
|           +-- validate.js    -> Declarative schema validation -> 422 errors
|           +-- errors.js      -> HttpError classes (400/401/403/404/409/422)
|
+-- database/
|   +-- migrations/
|   |   +-- 001_init.sql      -> 23 tables ka poora schema
|   +-- migrate.js            -> Migration runner
|   +-- seed.js               -> Demo data generator
|   +-- data/                 -> Runtime mein banta hai (waretrack.db, files/)
|
+-- frontend/
|   +-- index.html            -> Single page app entry point
|   +-- css/styles.css        -> Complete UI styling
|   +-- js/
|       +-- app.js            -> App shell: login, routing, SSE, search, bell, menu
|       +-- views/            -> 10 screens
|       |   +-- world.js      -> 3D world screen
|       |   +-- dashboard.js  -> Analytics
|       |   +-- inventory.js  -> Inventory management
|       |   +-- orders.js     -> Orders
|       |   +-- deliveries.js -> Fleet management
|       |   +-- receiving.js  -> Inbound shipments
|       |   +-- people.js     -> Team management
|       |   +-- warehouse.js  -> Layout editor
|       |   +-- activity.js   -> Activity log
|       |   +-- users.js      -> User management (Admin only)
|       +-- ui/               -> Reusable UI components (modal, table, forms, SVG charts)
|       +-- three/            -> 3D Engine
|           +-- layout.js     -> Coordinates, rack positions, Dijkstra pathfinding
|           +-- sim.js        -> Mover (path following, speed, turning)
|           +-- models.js     -> 3D model factories (building, trucks, workers etc.)
|           +-- world.js      -> Main renderer, lights, picking, animation loop
|
+-- shared/
|   +-- constants.js          -> Roles, statuses, permission matrix (server + browser dono use karte hain)
|
+-- tests/
|   +-- api.test.js           -> 20 API integration tests (real server + SQLite)
|   +-- layout.test.js        -> 3D layout + pathfinding unit tests
|   +-- sim.test.js           -> Mover simulation unit tests
|   +-- e2e/
|       +-- browser-smoke.mjs -> Full browser test (Playwright)
|
+-- documentation/
|   +-- API_DOCUMENTATION.md
|   +-- AWS_INTEGRATION_GUIDE.md
|   +-- DATABASE_SCHEMA.md
|   +-- FEATURES_CHECKLIST.md
|   +-- INSTALLATION_GUIDE.md
|   +-- PROJECT_ARCHITECTURE.md
|   +-- REFERENCE_ANALYSIS.md
|   +-- _generated/           -> Auto-generated (npm run docs:generate)
|       +-- API_ENDPOINTS.md  -> 81 endpoints with permissions
|       +-- DATABASE_TABLES.md -> Column-by-column schema reference
|
+-- scripts/
|   +-- vendor-three.mjs      -> Three.js local download
|   +-- gen-docs.mjs          -> API + DB docs generator
|   +-- check-node.mjs        -> Node version check
|
+-- .env.example              -> Configuration template
+-- .gitignore
+-- Dockerfile                -> Production container config
+-- package.json
+-- README.md                 -> Ye file!
```

---

## Database

**23 Tables** — SQLite (Node.js built-in, koi installation nahi)

### Entity Relationships
```
warehouses --- storage_sections --- storage_racks --- inventory --- products --- categories
                    |                    |
                  docks            stock_movements (ledger)

orders --- order_items --- order_allocations --- inventory
  |
deliveries --- vehicles --- drivers
             +-- docks

inbound_shipments --- inbound_items --- products

users --- sessions
  |
employees --- tasks (target: rack/dock/section, reference: order/delivery/shipment)
```

### Key Tables

| Table | Purpose |
|-------|---------|
| `users` + `sessions` | Authentication, role-based access |
| `employees` | Warehouse workers, department, availability |
| `products` + `categories` | Product catalog |
| `storage_racks` | Physical rack positions (section, row, col, capacity, max_pallets) |
| `inventory` | Stock: (product, rack, batch) → quantity, reserved |
| `stock_movements` | Complete ledger: har stock change ka record, balance ke saath |
| `orders` + `order_items` | Customer orders |
| `order_allocations` | Stock reservations (pending → dispatched lifecycle) |
| `vehicles` + `drivers` | Fleet management |
| `deliveries` | Order fulfillment tracking |
| `inbound_shipments` + `inbound_items` | Supplier receiving |
| `tasks` | Employee task assignments |
| `notifications` | In-app alerts |
| `activity_logs` | Complete audit trail |

### Important Constraints
- `inventory`: UNIQUE(product_id, rack_id, batch_no), quantity >= 0, reserved <= quantity
- `storage_racks.max_pallets`: 1 to 6 (3D mein 6 pallet slots drawn hain)
- Referential integrity: ON DELETE RESTRICT for history-linked records
- Soft delete: products, employees, drivers with history → `active = 0` (archive)

---

## Security

| Feature | Implementation |
|---------|----------------|
| Password Hashing | scrypt with per-user random salt |
| Password Policy | Min 8 chars, at least one letter + one digit |
| Login Lockout | 5 failed attempts/5 min per IP+email combination |
| Session Tokens | 256-bit random, stored as SHA-256 hash only |
| Session Expiry | Configurable (default 12 hours) |
| Token Revocation | Logout, password change, role change, deactivation pe immediately revoke |
| RBAC | Permission matrix `shared/constants.js` — server pe enforce, UI pe hide |
| Input Validation | Declarative schemas, parameterized SQL, JSON size limit 1MB (images 2MB) |
| XSS Protection | DOM built with text nodes — `innerHTML` of user data kabhi nahi |
| Path Traversal | Static server blocks `../` attacks |

> **WARNING — Known Limitations (Production ke liye fix karo):**
> - Tokens `localStorage` mein hain — HTTPS lagao, `httpOnly` cookies consider karo
> - SSE ke liye token URL mein jaata hai — AWS Cognito ek better option hai
> - Login ke alawa baaki APIs pe rate limiting nahi hai

---

## Configuration

`.env.example` copy karke `.env` banao. Bina `.env` ke bhi defaults se chalega.

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `127.0.0.1` | Sirf local. Phone/LAN ke liye `0.0.0.0` |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | `production` mein set karo deployment pe |
| `DB_PROVIDER` | `sqlite` | Database provider |
| `DB_FILE` | `database/data/waretrack.db` | SQLite file path |
| `STORAGE_PROVIDER` | `local` | File storage provider (`local` ya `s3`) |
| `STORAGE_DIR` | `database/data/files` | Local file storage folder |
| `AUTH_PROVIDER` | `local` | Auth provider (`local` ya `cognito`) |
| `AUTO_SEED` | `true` | Khali DB pe demo data daalo. **Production mein `false`!** |
| `SESSION_TTL_HOURS` | `12` | Login session duration |
| `VEHICLE_RETURN_DELAY_MS` | `20000` | Truck deliver karke wapas aane ka time (20 sec demo) |
| `SYNC_INTERVAL_MS` | `300000` | Snapshot sync interval (5 min) |
| `LOW_STOCK_SCAN_MS` | `300000` | Low stock check interval (5 min) |
| `CORS_ORIGIN` | *(empty)* | Alag domain frontend ke liye |

---

## Tests

### Results: 27/27 — All Pass

```bash
npm test                           # 27 tests chalao
REAL_THREE=1 npm run test:e2e      # Real Three.js ke saath browser test + screenshots
```

| Test Suite | Tests | Status | Method |
|------------|-------|--------|--------|
| **API Integration** | 20 | All pass | Real HTTP server + real SQLite in-memory |
| **3D Layout + Pathfinding** | 4 | All pass | Pure unit tests (Dijkstra, rack positions) |
| **Mover Simulation** | 2 | All pass | Physics simulation unit tests |
| **E2E Browser** | 30+ checks | Pass | Playwright (Chromium), Three.js stub |

### API Tests Cover
- Auth: bad credentials, role permissions, user management, password policy, logout
- Products: CRUD, validation, archive vs delete, image upload
- Inventory: receive, capacity limits, pallet limits, issue, adjust, transfer, history
- Orders: create (stock reserve), insufficient stock rejection, cancel (release), full fulfillment flow
- Deliveries: capacity check, dispatch, complete, cancel
- Vehicles & Drivers: register, validate, protect
- Receiving: schedule → arrive → partial → complete, auto putaway, dock release
- Employees & Tasks: assignment, availability, employee task restrictions
- Warehouse: rack management rules
- Dashboard: all stats equal to database values
- Scene: all objects reflected correctly
- Realtime: SSE events fire correctly on mutations
- Search, activity log, notifications
- Server safety: static files, SPA fallback, traversal blocked, bad JSON

### 3D Tests Cover
- Rack placements: unique, inside sections, aisles free
- Cross-aisle geometry: separates halls, truck/dock fits
- Pallet positions: 6 distinct slots per rack
- Walk graph: everything reachable, no teleporting
- Road graph: parking → dock → road flow
- Mover: constant speed, correct direction facing, onDone fires once
- Mover: short-way turning, no waypoint overshoot with large dt

---

## Pehli Baar Chalane Pe Verify Karo (3D Checklist)

Ye 8 cheezein check karo jab pehli baar kholte ho:

- [ ] **3D area khulta hai** aur building/roads/trees dikhte hain? (nahi → F12 → Console ka pehla error)
- [ ] **Camera drag/zoom smooth** hai? (lag free hona chahiye)
- [ ] **Rack/pallet/truck/worker/dock pe click** se glass card khulta hai? (asli click test)
- [ ] **Interior view** pe chhat uth jaati hai aur andar ke racks dikhte hain?
- [ ] **Full order flow:** Orders → Packed → Ready → Fleet → New Delivery → Dispatch → truck dock se nikal ke road pe jaata hai → Delivered → truck wapas parking bay?
- [ ] **Inventory → Receive Stock:** pallet bada hota hai + hari ring flash?
- [ ] **Team → New Task** (rack location de do): worker chal ke wahan jaata hai?
- [ ] **Phone pe chalata hai?** Slow ho toh Performance mode try karo.

> Jo bhi galat dikhe: **screenshot + F12 Console error** bhejo — exact fix milega!

---

## Known Issues & Limitations

### 3D (Verify Ke Baad Fix Karo)
1. Models ke **size/proportion/colour** video reference se tune karne padenge — real screen pe hi ho sakta hai
2. Click-picking ya shadows mein koi issue ho toh `world.js` mein fix
3. FPS measure karo — zarurat ho toh aur LOD/instancing
4. Workers/trucks **ek doosre se bachte nahi** — kabhi overlap dikhega
5. Section labels (A/B/C) positions fixed hain; roof pe overlap lag sakti hai

### Security (Production Se Pehle Zaroori)
6. **HTTPS lagao** (reverse proxy ya ALB ke through)
7. **Demo passwords badlo** — `AUTO_SEED=false` karo
8. Token `localStorage` mein hai + SSE ke liye URL mein — production mein Cognito better
9. Login ke alawa baaki APIs pe **rate limiting nahi** — zaroorat ke hisaab se add karo
10. **Database backup** plan banao (abhi sirf ek file hai)

### Code/Data Limits
11. Max 4 docks, 2 indoor sections + 1 yard, 3x4/2x4 rack grid (3D building ke fixed footprint)
12. Money `REAL` type mein hai (demo) — production mein integer minor units use karo
13. Har SSE event pe poora `/api/scene` dobara aata hai — small/medium warehouse theek, bahut bade ke liye diff-based updates chahiye
14. Orders/tasks lists 200 pe limited hain — pagination add karna chahiye
15. SQLite single-server ke liye theek hai — multiple instances ke liye PostgreSQL

---

## AWS Migration

### Current vs AWS Mapping

| Local (Abhi) | AWS Service | Work Needed |
|-------------|-------------|-------------|
| SQLite | Amazon RDS (PostgreSQL) | DB calls async banana, SQL dialect migrate karna |
| Local disk | Amazon S3 + CloudFront | `s3.js` already created! Bas AWS creds chahiye |
| scrypt tokens | Amazon Cognito | `cognito.js` provider banana |
| In-process SSE | API Gateway WebSocket + SNS | Multi-instance ke liye |
| In-app notifications | Amazon SNS + SES | Email/SMS add karna |
| setTimeout/setInterval | Amazon SQS + EventBridge | Background jobs decouple karna |
| Local file sync | Lambda + S3/DynamoDB | Sync service migrate karna |

### Environment Variables for AWS

```bash
# AWS
AWS_REGION=ap-south-1

# Database (RDS)
DB_PROVIDER=postgres
DATABASE_URL=postgres://user:pass@host:5432/waretrack
DB_POOL_MAX=10
DB_SSL=true

# Storage (S3)
STORAGE_PROVIDER=s3
S3_BUCKET=waretrack-files-prod
CLOUDFRONT_URL=https://dxxxx.cloudfront.net

# Auth (Cognito)
AUTH_PROVIDER=cognito
COGNITO_USER_POOL_ID=ap-south-1_xxxxx
COGNITO_CLIENT_ID=xxxxxx
COGNITO_ISSUER=https://cognito-idp.ap-south-1.amazonaws.com/<pool>

# Messaging
SNS_ALERT_TOPIC_ARN=arn:aws:sns:...
SQS_QUEUE_URL=https://sqs...
```

> **Credentials:** Instance/Task IAM Role use karo — `.env` mein access keys mat daalo kabhi!

---

## Roadmap

### Short Term (1-3 Days)
- Pagination aur sorting for all lists
- CSV/Excel export (inventory, orders, movements)
- Product image gallery
- Order notes/attachments
- Dark mode toggle
- "Forgot password" flow

### Medium Term (1-3 Weeks)
- **Multiple warehouses** + site selector (schema ready hai, UI/3D baaki)
- Purchase orders + supplier master
- Returns/RMA workflow
- Cycle count workflow
- **Barcode/QR scan** (phone camera) for receiving/picking
- **Pick-path optimisation** (best route for picking)
- Email/SMS/WhatsApp notifications via SNS
- Worker/truck collision avoidance
- 3D mein drag and drop se pallet/rack move karna
- TV mode (camera khud ghoomta rahe — kiosk display)
- Sparkline trends har KPI card mein

### Long Term (Future)
- **React + TypeScript + Vite + Tailwind + React Three Fiber** mein frontend port (backend API wahi rahegi)
- **Express + Prisma + PostgreSQL** (agar team chahta ho)
- Full **AWS deployment** — RDS, S3, Cognito, SQS/SNS, CloudWatch, ECS Fargate
- Mobile app / Progressive Web App (PWA)
- Multi-language support (Hindi, English, etc.)
- Multi-tenant (kai companies ek system pe)

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "3D view unavailable" | Internet check karo ya `npm run vendor:three` chalao; Browser mein WebGL on hai? |
| 3D bahut slow hai | Performance mode click karo; Browser hardware acceleration on karo |
| "Cannot reach the server" | `npm start` dobara chalao |
| Password bhool gaye | `npm run db:reset` (WARNING: poora data mitta hai) |
| Port 3000 busy hai | `.env` mein `PORT=3001` karo |
| "Insufficient stock" error | Sahi message hai — pehle Inventory se stock receive karo |
| Delivery nahi ban rahi | Order Packed/Ready chahiye; vehicle available + driver assigned; ek outbound dock free |
| Worker nahi chal raha | Free worker wander karta hai; task do toh target pe jayega; off-duty workers invisible hote hain |
| Node.js version error | Node.js 22.13+ install karo (`node -v` se check) |
| 3D blank screen | F12 → Console mein pehla red error dekho |

---

## Documentation Index

| File | Content |
|------|---------|
| `README.md` | Ye file — complete guide |
| `documentation/API_DOCUMENTATION.md` | API endpoints, auth, examples, curl commands |
| `documentation/AWS_INTEGRATION_GUIDE.md` | Detailed AWS migration steps |
| `documentation/DATABASE_SCHEMA.md` | Tables, constraints, relationships |
| `documentation/PROJECT_ARCHITECTURE.md` | Backend layers, business rules, security |
| `documentation/FEATURES_CHECKLIST.md` | Har feature ka verified/unverified status |
| `documentation/INSTALLATION_GUIDE.md` | Step-by-step setup |
| `documentation/REFERENCE_ANALYSIS.md` | Original reference analysis |
| `documentation/_generated/API_ENDPOINTS.md` | 81 endpoints auto-generated |
| `documentation/_generated/DATABASE_TABLES.md` | Column-by-column schema |

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Server** | Node.js 22 (native `http`) | Built-in SQLite, fetch, crypto — zero dependencies |
| **Database** | SQLite (`node:sqlite`) | Built-in, no install, SQL migrations |
| **3D Engine** | Three.js r160 | Industry standard 3D for browsers |
| **Frontend** | Vanilla ES Modules | No build step, runs directly in browser |
| **Charts** | SVG (hand-written) | No external chart library needed |
| **Live Push** | Server-Sent Events (SSE) | Native browser API, same effect as WebSocket for server→browser |
| **Auth** | scrypt + bearer tokens | Secure password hashing, stateless tokens |
| **Testing** | Node.js built-in `node:test` | No jest/mocha needed |
| **E2E Testing** | Playwright | Real browser automation |

> **Koi `npm install` kyu nahi?** React, Vite, Express, Prisma, Socket.IO — sab offline sandbox mein install nahi ho sake. Isliye ek deliberately dependency-free, production-quality equivalent banaya. Backend API same hai — agar baad mein React/Next.js frontend banana ho toh sirf `frontend/` folder replace hoga, baki sab wahi rahega.

---

<div align="center">

**WareTrack 3D**

*Agar kuch nahi samjha, koi issue mila, ya 3D mein kuch galat dikha → screenshot + Console error bhejo!*

</div>
