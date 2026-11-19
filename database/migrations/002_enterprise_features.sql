-- Migration 002: Enterprise Features Schema
-- Adds Suppliers, Purchase Orders, Returns, and Multi-Currency tables.

CREATE TABLE IF NOT EXISTS suppliers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  contact_name  TEXT,
  email         TEXT,
  phone         TEXT,
  address       TEXT,
  city          TEXT,
  payment_terms TEXT NOT NULL DEFAULT 'Net 30',
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_code ON suppliers(code);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  number             TEXT NOT NULL UNIQUE,
  supplier_id        INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  warehouse_id       INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','ordered','partially_received','completed','cancelled')),
  total_amount       REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  currency           TEXT NOT NULL DEFAULT 'USD',
  notes              TEXT,
  expected_delivery  TEXT,
  ordered_at         TEXT,
  received_at        TEXT,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_warehouse ON purchase_orders(warehouse_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id              INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id         INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost          REAL NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  received_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity >= 0)
);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(po_id);

CREATE TABLE IF NOT EXISTS returns (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  number            TEXT NOT NULL UNIQUE,
  order_id          INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  warehouse_id      INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  customer_name     TEXT NOT NULL,
  customer_email    TEXT,
  status            TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','received','inspected','approved','rejected','restocked')),
  reason            TEXT NOT NULL CHECK (reason IN ('damaged','wrong_item','defective','expired','customer_cancelled','other')),
  notes             TEXT,
  inspection_notes  TEXT,
  inspected_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  inspected_at      TEXT,
  refund_amount     REAL NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);
CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);

CREATE TABLE IF NOT EXISTS return_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id           INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  product_id          INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  condition           TEXT NOT NULL DEFAULT 'unopened' CHECK (condition IN ('unopened','opened_good','damaged','defective')),
  restocked_rack_id   INTEGER REFERENCES storage_racks(id) ON DELETE SET NULL,
  restocked_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (restocked_quantity >= 0)
);
CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);

CREATE TABLE IF NOT EXISTS currencies (
  code           TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  symbol         TEXT NOT NULL,
  exchange_rate  REAL NOT NULL DEFAULT 1.0 CHECK (exchange_rate > 0),
  is_default     INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Seed initial currencies (Base USD = 1.0)
INSERT OR IGNORE INTO currencies (code, name, symbol, exchange_rate, is_default) VALUES
  ('USD', 'US Dollar', '$', 1.0, 1),
  ('EUR', 'Euro', '€', 0.92, 0),
  ('GBP', 'British Pound', '£', 0.79, 0),
  ('INR', 'Indian Rupee', '₹', 84.5, 0),
  ('CAD', 'Canadian Dollar', 'CA$', 1.38, 0),
  ('AUD', 'Australian Dollar', 'A$', 1.52, 0),
  ('JPY', 'Japanese Yen', '¥', 154.2, 0);

-- Seed initial enterprise suppliers
INSERT OR IGNORE INTO suppliers (id, code, name, contact_name, email, phone, city, payment_terms) VALUES
  (1, 'SUP-001', 'Atlas Sports Imports Ltd', 'Johnathan Vance', 'orders@atlassports.com', '+1-555-0192', 'Philadelphia', 'Net 30'),
  (2, 'SUP-002', 'BioMed Pharma Global Inc', 'Dr. Aris Thorne', 'supply@biomedpharma.org', '+1-555-0284', 'Chicago', 'Net 15'),
  (3, 'SUP-003', 'Nordic Cold Chain Supplies', 'Freja Lindqvist', 'contact@nordiccold.se', '+46-8-123-4567', 'Stockholm', 'Net 45'),
  (4, 'SUP-004', 'Apex Industrial Components', 'Marcus Brody', 'sales@apexindustrial.com', '+1-555-0371', 'Pittsburgh', 'Net 30');
