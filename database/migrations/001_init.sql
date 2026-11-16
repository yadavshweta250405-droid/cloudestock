-- WareTrack 3D :: initial schema
-- All timestamps are ISO-8601 UTC strings. Enumerations are enforced with CHECK constraints.

CREATE TABLE warehouses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  address     TEXT,
  city        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE storage_sections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  zone          TEXT NOT NULL DEFAULT 'indoor' CHECK (zone IN ('indoor','outdoor')),
  UNIQUE (warehouse_id, code)
);

CREATE TABLE storage_racks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id   INTEGER NOT NULL REFERENCES storage_sections(id) ON DELETE CASCADE,
  code         TEXT NOT NULL UNIQUE,
  row_no       INTEGER NOT NULL CHECK (row_no > 0),
  col_no       INTEGER NOT NULL CHECK (col_no > 0),
  capacity     INTEGER NOT NULL CHECK (capacity > 0),             -- units the rack can hold
  max_pallets  INTEGER NOT NULL DEFAULT 6 CHECK (max_pallets BETWEEN 1 AND 6),  -- pallet positions (2 bays x 3 levels)
  UNIQUE (section_id, row_no, col_no)
);

CREATE TABLE docks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  number        INTEGER NOT NULL CHECK (number > 0),
  direction     TEXT NOT NULL DEFAULT 'both' CHECK (direction IN ('inbound','outbound','both')),
  status        TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','occupied','maintenance')),
  UNIQUE (warehouse_id, number)
);

CREATE TABLE employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  department    TEXT NOT NULL CHECK (department IN ('Receiving','Picking','Shipping','Inventory','Maintenance','Management')),
  job_title     TEXT,
  status        TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','busy','on_break','off_duty')),
  warehouse_id  INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  hired_at      TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin','warehouse_manager','inventory_manager','employee')),
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  employee_id    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at  TEXT
);

CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE categories (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL UNIQUE,
  color               TEXT NOT NULL DEFAULT '#3b82f6',
  default_section_id  INTEGER REFERENCES storage_sections(id) ON DELETE SET NULL
);

CREATE TABLE products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sku            TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT,
  category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  unit_price     REAL NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  unit           TEXT NOT NULL DEFAULT 'pcs',
  reorder_level  INTEGER NOT NULL DEFAULT 20 CHECK (reorder_level >= 0),
  image_key      TEXT,
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_products_category ON products(category_id);

CREATE TABLE inventory (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  rack_id      INTEGER NOT NULL REFERENCES storage_racks(id) ON DELETE RESTRICT,
  quantity     INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved     INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  batch_no     TEXT NOT NULL DEFAULT 'B-0000',
  received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (product_id, rack_id, batch_no),
  CHECK (reserved <= quantity)
);
CREATE INDEX idx_inventory_rack ON inventory(rack_id);
CREATE INDEX idx_inventory_product ON inventory(product_id);

CREATE TABLE stock_movements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rack_id         INTEGER REFERENCES storage_racks(id) ON DELETE SET NULL,
  batch_no        TEXT,
  type            TEXT NOT NULL CHECK (type IN ('IN','OUT','ADJUST','TRANSFER_IN','TRANSFER_OUT')),
  quantity        INTEGER NOT NULL,                 -- signed change applied to the rack row
  balance_after   INTEGER NOT NULL CHECK (balance_after >= 0),
  reason          TEXT,
  reference_type  TEXT,
  reference_id    INTEGER,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_movements_product ON stock_movements(product_id, created_at);
CREATE INDEX idx_movements_created ON stock_movements(created_at);

CREATE TABLE drivers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  phone       TEXT,
  license_no  TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_duty','off_duty')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE vehicles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  plate           TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL DEFAULT 'truck' CHECK (type IN ('truck','van')),
  capacity_units  INTEGER NOT NULL CHECK (capacity_units > 0),
  status          TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','loading','on_route','returning','maintenance')),
  color           TEXT NOT NULL DEFAULT '#2563eb',
  driver_id       INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  dock_id         INTEGER REFERENCES docks(id) ON DELETE SET NULL,
  parking_slot    INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE deliveries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE,
  vehicle_id     INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  driver_id      INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  dock_id        INTEGER REFERENCES docks(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'Loading' CHECK (status IN ('Loading','In Transit','Delivered','Cancelled')),
  destination    TEXT,
  eta_minutes    INTEGER,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  dispatched_at  TEXT,
  delivered_at   TEXT
);
CREATE INDEX idx_deliveries_status ON deliveries(status);

CREATE TABLE orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  number           TEXT NOT NULL UNIQUE,
  customer_name    TEXT NOT NULL,
  customer_email   TEXT,
  customer_phone   TEXT,
  delivery_address TEXT NOT NULL,
  city             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'Pending'
                   CHECK (status IN ('Pending','Processing','Packed','Ready for Dispatch','Dispatched','Delivered','Cancelled')),
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  notes            TEXT,
  total_amount     REAL NOT NULL DEFAULT 0,
  delivery_id      INTEGER REFERENCES deliveries(id) ON DELETE SET NULL,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  dispatched_at    TEXT,
  delivered_at     TEXT
);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_delivery ON orders(delivery_id);

CREATE TABLE order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  unit_price  REAL NOT NULL CHECK (unit_price >= 0)
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- Which inventory rows are reserved for which order line (released on cancel, consumed on dispatch)
CREATE TABLE order_allocations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id  INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  inventory_id   INTEGER NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
  quantity       INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE TABLE inbound_shipments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ref          TEXT NOT NULL UNIQUE,
  supplier     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Arrived','Unloading','Received','Cancelled')),
  dock_id      INTEGER REFERENCES docks(id) ON DELETE SET NULL,
  expected_at  TEXT,
  arrived_at   TEXT,
  received_at  TEXT,
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE inbound_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id        INTEGER NOT NULL REFERENCES inbound_shipments(id) ON DELETE CASCADE,
  product_id         INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  received_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  batch_no           TEXT
);

CREATE TABLE tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('receiving','putaway','picking','packing','loading','inventory_check','maintenance','other')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','cancelled')),
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assignee_id     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  target_type     TEXT NOT NULL DEFAULT 'none' CHECK (target_type IN ('none','rack','dock','section','office')),
  target_id       INTEGER,
  reference_type  TEXT,
  reference_id    INTEGER,
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  started_at      TEXT,
  completed_at    TEXT,
  due_at          TEXT
);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX idx_tasks_ref ON tasks(reference_type, reference_id);

CREATE TABLE notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,       -- NULL = broadcast to everyone
  level        TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','success','warning','danger')),
  title        TEXT NOT NULL,
  message      TEXT,
  entity_type  TEXT,
  entity_id    INTEGER,
  created_at   TEXT NOT NULL
);
CREATE TABLE notification_reads (
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id  INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, notification_id)
);

CREATE TABLE activity_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name    TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    INTEGER,
  message      TEXT NOT NULL,
  meta         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_activity_created ON activity_logs(id DESC);
