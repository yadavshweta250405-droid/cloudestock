# Database schema

SQLite, migrations in `database/migrations/*.sql` (applied in order, recorded in `schema_migrations`). The complete column-by-column reference is generated from the live schema: **`documentation/_generated/DATABASE_TABLES.md`** (`npm run docs:generate`).

## Entity relationships
```
warehouses 1─* storage_sections 1─* storage_racks 1─* inventory *─1 products *─1 categories
                    │                                   │
                    └─ categories.default_section_id    └─ stock_movements (ledger: product, rack, batch, type, ±qty, balance)
warehouses 1─* docks ──< vehicles.dock_id, deliveries.dock_id, inbound_shipments.dock_id
orders 1─* order_items 1─* order_allocations *─1 inventory          (reservations)
orders *─1 deliveries *─1 vehicles *─1 drivers
inbound_shipments 1─* inbound_items *─1 products
employees 1─* tasks (assignee) ; tasks.target → rack | dock | section ; tasks.reference → order | delivery | shipment
users *─1 employees (optional) ; users 1─* sessions ; notifications *─* users via notification_reads
activity_logs (audit trail, written in the same transaction as the change)
```

## Tables
Users, Employees, Products, Categories, Warehouses, Storage Sections, Storage Racks, Inventory, Stock Movements, Orders, Order Items, Vehicles, Drivers, Deliveries, Tasks, Notifications, Activity Logs (all required) plus support tables: `sessions`, `docks`, `order_allocations`, `inbound_shipments`, `inbound_items`, `notification_reads`, `schema_migrations`.

## Constraints worth knowing
* Enumerations (roles, order/delivery/vehicle/employee/task statuses, movement types, dock states) are `CHECK` constraints; the same lists live in `shared/constants.js`.
* `inventory`: `UNIQUE(product_id, rack_id, batch_no)`, `quantity >= 0`, `reserved <= quantity`. Capacity and pallet-position limits are enforced in `inventory.adjust()` (inside a transaction), not by triggers.
* `storage_racks.max_pallets BETWEEN 1 AND 6` (= the 6 pallet positions drawn in 3D); `UNIQUE(section_id,row_no,col_no)`.
* Referential integrity: `ON DELETE RESTRICT` for records with history (products ↔ inventory/order items, vehicles ↔ deliveries), `SET NULL` for optional links, `CASCADE` for owned children (order items, sessions, shipment lines).
* Soft deletion: products, employees and drivers with history are **archived** (`active = 0`) instead of deleted; unused ones are removed.
* Timestamps are ISO-8601 UTC text. Money is `REAL` (demo); use integer minor units or `NUMERIC` in PostgreSQL.

## Migrations and seed
```bash
npm run db:migrate   # apply pending *.sql
npm run db:seed      # demo data (only when the DB has no users)
npm run db:reset     # wipe + seed
```
To add a column or table, create `database/migrations/002_<name>.sql`; never edit an applied migration. The seed creates 3 sections / 32 racks / 4 docks, 24 products in 5 categories, 64 stock rows (pallets) with a consistent back-dated movement ledger (176 movements; each rack row’s history reconciles to its quantity), 80 delivered historical orders, and live orders in every state, a loading truck, a truck on the road, inbound shipments, tasks, 13 employees, 6 vehicles and 7 drivers. The live part goes through the real services, so every business rule is exercised by seeding.
