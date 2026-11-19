-- WareTrack 3D :: Superstore dataset integration
-- Adds dedicated sales analytics tables that sit alongside the warehouse tables.
-- No existing tables are modified.

CREATE TABLE IF NOT EXISTS superstore_regions (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE,       -- East, West, Central, South
  manager TEXT                        -- from People sheet
);

CREATE TABLE IF NOT EXISTS superstore_sales (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  row_id        INTEGER,
  order_id      TEXT NOT NULL,
  order_date    TEXT NOT NULL,        -- YYYY-MM-DD
  ship_date     TEXT NOT NULL,        -- YYYY-MM-DD
  ship_mode     TEXT,
  customer_id   TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  segment       TEXT,                 -- Consumer, Corporate, Home Office
  country       TEXT,
  city          TEXT,
  state         TEXT,
  postal_code   TEXT,
  region        TEXT,
  product_id    TEXT NOT NULL,
  category      TEXT,                 -- Furniture, Office Supplies, Technology
  sub_category  TEXT,
  product_name  TEXT,
  sales         REAL NOT NULL DEFAULT 0,
  quantity      INTEGER NOT NULL DEFAULT 1,
  discount      REAL NOT NULL DEFAULT 0,
  profit        REAL NOT NULL DEFAULT 0,
  returned      INTEGER NOT NULL DEFAULT 0  -- 0 = not returned, 1 = returned
);

CREATE INDEX IF NOT EXISTS idx_ss_order_id   ON superstore_sales(order_id);
CREATE INDEX IF NOT EXISTS idx_ss_order_date ON superstore_sales(order_date);
CREATE INDEX IF NOT EXISTS idx_ss_category   ON superstore_sales(category);
CREATE INDEX IF NOT EXISTS idx_ss_region     ON superstore_sales(region);
CREATE INDEX IF NOT EXISTS idx_ss_customer   ON superstore_sales(customer_id);
