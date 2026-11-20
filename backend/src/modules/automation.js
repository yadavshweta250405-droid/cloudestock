/**
 * WareTrack 3D :: Live Data Automation Service
 *
 * Runs as a background job loop inside the existing jobs scheduler.
 * Every tick it:
 *   1. Picks the next Superstore sale row (loops forever — circular cursor)
 *   2. Maps it to a warehouse order and advances its lifecycle
 *   3. Generates realistic stock movements, delivery events, and notifications
 *   4. Publishes the "changed" signal so connected browsers refresh instantly
 *
 * The cursor position is stored in memory (resets on restart) so the loop
 * starts from row 1 each time the server starts — giving a live "replay" effect.
 *
 * Intervals (all configurable via env):
 *   AUTOMATION_TICK_MS    = 4000   (new event every 4 s)
 *   AUTOMATION_ADVANCE_MS = 12000  (order lifecycle advance every 12 s)
 *   AUTOMATION_RESTOCK_MS = 30000  (auto-restock low inventory every 30 s)
 */

import { nowIso } from '../core/util.js';

const TICK_MS    = parseInt(process.env.AUTOMATION_TICK_MS    || '15000', 10);
const ADVANCE_MS = parseInt(process.env.AUTOMATION_ADVANCE_MS || '25000', 10);
const RESTOCK_MS = parseInt(process.env.AUTOMATION_RESTOCK_MS || '45000', 10);

// Superstore segment -> warehouse order priority mapping
const SEG_PRIORITY = { Consumer: 'normal', Corporate: 'high', 'Home Office': 'normal' };

// Superstore category -> warehouse product category name mapping
const CAT_MAP = {
  'Furniture':        'Furniture',
  'Office Supplies':  'Electronics',   // closest match in seed data
  'Technology':       'Electronics',
};

let superstoreCursor = 0;   // circular index into superstore_sales
let totalSsRows     = 0;    // cached count, refreshed each tick if 0

export function createService(_ctx) {
  // No public API — purely background
  return {};
}

export function registerRoutes(_router, _ctx) {
  // Expose a lightweight status endpoint
  _router.get('/api/automation/status', { perm: 'dashboard:read' }, () => ({
    enabled:     true,
    tickMs:      TICK_MS,
    advanceMs:   ADVANCE_MS,
    restockMs:   RESTOCK_MS,
    cursor:      superstoreCursor,
    totalRows:   totalSsRows,
    description: 'Live Automation Service: replaying Superstore dataset as live warehouse events',
  }));
}

export function startJobs(ctx) {
  const { db, jobs, log, changed, notifications, activity } = ctx;

  // ------------------------------------------------------------------ helpers
  function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function getProducts() {
    return db.all(`
      SELECT p.id, p.sku, p.name, p.unit_price,
             COALESCE(s.qty,0) - COALESCE(s.res,0) AS avail
      FROM products p
      LEFT JOIN (SELECT product_id, SUM(quantity) qty, SUM(reserved) res FROM inventory GROUP BY product_id) s
        ON s.product_id = p.id
      WHERE p.active = 1
    `);
  }

  function getRacks() {
    return db.all('SELECT id FROM storage_racks ORDER BY id');
  }

  function nextOrderNumber() {
    const n = db.get('SELECT COUNT(*) c FROM orders').c + 1;
    return `ORD-AUTO-${String(n).padStart(5, '0')}`;
  }

  function logActivity(action, type, id, msg) {
    activity.log({ id: null, name: 'Automation' }, action, type, id, msg);
  }

  // ------------------------------------------------------------------ TICK: create new order from Superstore row
  jobs.every('automation.tick', TICK_MS, () => {
    try {
      // Refresh count if needed
      if (totalSsRows === 0) {
        totalSsRows = db.get('SELECT COUNT(*) c FROM superstore_sales').c;
        if (totalSsRows === 0) return; // dataset not loaded yet
      }

      // Pick next Superstore row (circular)
      superstoreCursor = superstoreCursor % totalSsRows;
      const ss = db.get(
        'SELECT * FROM superstore_sales LIMIT 1 OFFSET ?',
        [superstoreCursor]
      );
      superstoreCursor++;

      if (!ss) return;

      // Pick a random available product to associate (closest category)
      const products = getProducts().filter(p => p.avail > 0);
      if (products.length === 0) return;

      // Try to pick a product that roughly matches the category
      const catName = CAT_MAP[ss.category] || null;
      let product = catName
        ? products.find(p => p.name.toLowerCase().includes(catName.toLowerCase()))
        : null;
      if (!product) product = products[ri(0, products.length - 1)];

      const qty    = Math.min(ss.quantity || 1, product.avail, 10);
      if (qty <= 0) return;

      const now    = nowIso();
      const num    = nextOrderNumber();
      const prio   = SEG_PRIORITY[ss.segment] || 'normal';
      const addr   = `${ss.city}, ${ss.state}`;

      // Insert order
      const { lastId: orderId } = db.run(
        `INSERT INTO orders(number, customer_name, customer_email, delivery_address, city, status, priority, notes, total_amount, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          num,
          ss.customer_name,
          `${ss.customer_id.toLowerCase()}@superstore.demo`,
          addr, ss.city,
          'Pending',
          prio,
          `Auto: ${ss.category} / ${ss.sub_category} | Region: ${ss.region}`,
          Math.round(ss.sales * 100) / 100,
          now, now,
        ]
      );

      // Insert order item
      db.run(
        'INSERT INTO order_items(order_id, product_id, quantity, unit_price) VALUES(?,?,?,?)',
        [orderId, product.id, qty, product.unit_price]
      );

      // Reserve inventory (simple — pick first available rack row)
      const invRow = db.get(
        'SELECT * FROM inventory WHERE product_id = ? AND quantity - reserved > 0 ORDER BY id LIMIT 1',
        [product.id]
      );
      if (invRow) {
        const take = Math.min(qty, invRow.quantity - invRow.reserved);
        db.run('UPDATE inventory SET reserved = reserved + ? WHERE id = ?', [take, invRow.id]);
        const itemId = db.get('SELECT id FROM order_items WHERE order_id = ? LIMIT 1', [orderId]).id;
        db.run('INSERT INTO order_allocations(order_item_id, inventory_id, quantity) VALUES(?,?,?)', [itemId, invRow.id, take]);
      }

      logActivity('create', 'orders', orderId, `Auto order ${num} for ${ss.customer_name} (${ss.region})`);
      changed('orders');
      log.info(`[automation] created order ${num} — ${ss.customer_name} — $${ss.sales}`);

    } catch (e) {
      log.error(`[automation.tick] ${e.message}`);
    }
  });

  // ------------------------------------------------------------------ ADVANCE: push pending orders through lifecycle
  jobs.every('automation.advance', ADVANCE_MS, () => {
    try {
      // Pending -> Processing
      const pending = db.all(`SELECT id, number FROM orders WHERE status = 'Pending' ORDER BY id LIMIT 3`);
      for (const o of pending) {
        db.run(`UPDATE orders SET status = 'Processing', updated_at = ? WHERE id = ?`, [nowIso(), o.id]);
        logActivity('update', 'orders', o.id, `Order ${o.number} moved to Processing`);
      }

      // Processing -> Packed
      const processing = db.all(`SELECT id, number FROM orders WHERE status = 'Processing' ORDER BY id LIMIT 3`);
      for (const o of processing) {
        db.run(`UPDATE orders SET status = 'Packed', updated_at = ? WHERE id = ?`, [nowIso(), o.id]);
        logActivity('update', 'orders', o.id, `Order ${o.number} packed`);
      }

      // Packed -> Ready for Dispatch
      const packed = db.all(`SELECT id, number FROM orders WHERE status = 'Packed' ORDER BY id LIMIT 2`);
      for (const o of packed) {
        db.run(`UPDATE orders SET status = 'Ready for Dispatch', updated_at = ? WHERE id = ?`, [nowIso(), o.id]);
        logActivity('update', 'orders', o.id, `Order ${o.number} ready for dispatch`);
      }

      // Ready for Dispatch -> Dispatched (needs available vehicle)
      const ready = db.all(`SELECT id, number FROM orders WHERE status = 'Ready for Dispatch' ORDER BY id LIMIT 2`);
      const vehicle = db.get(`SELECT id FROM vehicles WHERE status = 'available' LIMIT 1`);
      if (vehicle && ready.length > 0) {
        for (const o of ready) {
          const now = nowIso();
          const delCode = `DEL-AUTO-${Date.now()}-${ri(1000, 9999)}`;
          const { lastId: delId } = db.run(
            `INSERT INTO deliveries(code, vehicle_id, status, destination, eta_minutes, created_at, dispatched_at)
             VALUES(?,?,?,?,?,?,?)`,
            [delCode, vehicle.id, 'In Transit', o.number, ri(30, 180), now, now]
          );
          db.run(`UPDATE orders SET status = 'Dispatched', delivery_id = ?, dispatched_at = ?, updated_at = ? WHERE id = ?`,
            [delId, now, now, o.id]);
          db.run(`UPDATE vehicles SET status = 'on_route' WHERE id = ?`, [vehicle.id]);

          // Record stock OUT movement
          const items = db.all('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
          for (const item of items) {
            const inv = db.get('SELECT * FROM inventory WHERE product_id = ? LIMIT 1', [item.product_id]);
            if (inv) {
              const newQty = Math.max(0, inv.quantity - item.quantity);
              db.run('UPDATE inventory SET quantity = ?, reserved = MAX(0, reserved - ?) WHERE id = ?',
                [newQty, item.quantity, inv.id]);
              db.run(
                `INSERT INTO stock_movements(product_id, rack_id, batch_no, type, quantity, balance_after, reason, reference_type, reference_id, created_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?)`,
                [item.product_id, inv.rack_id, inv.batch_no, 'OUT', -item.quantity, newQty,
                 'Auto dispatch', 'orders', o.id, nowIso()]
              );
            }
          }

          logActivity('dispatch', 'orders', o.id, `Order ${o.number} dispatched via ${delCode}`);
        }
      }

      // Dispatched -> Delivered (after some time)
      const dispatched = db.all(
        `SELECT id, number, dispatched_at, delivery_id FROM orders WHERE status = 'Dispatched' ORDER BY id LIMIT 2`
      );
      for (const o of dispatched) {
        const ageMs = Date.now() - Date.parse(o.dispatched_at);
        if (ageMs > ADVANCE_MS * 2) {
          const now = nowIso();
          db.run(`UPDATE orders SET status = 'Delivered', delivered_at = ?, updated_at = ? WHERE id = ?`,
            [now, now, o.id]);
          if (o.delivery_id) {
            db.run(`UPDATE deliveries SET status = 'Delivered', delivered_at = ? WHERE id = ?`, [now, o.delivery_id]);
            const veh = db.get('SELECT vehicle_id FROM deliveries WHERE id = ?', [o.delivery_id]);
            if (veh) db.run(`UPDATE vehicles SET status = 'available' WHERE id = ?`, [veh.vehicle_id]);
          }
          logActivity('deliver', 'orders', o.id, `Order ${o.number} delivered`);
        }
      }

      if (pending.length + processing.length + packed.length + ready.length + dispatched.length > 0) {
        changed('orders', 'inventory', 'deliveries');
      }
    } catch (e) {
      log.error(`[automation.advance] ${e.message}`);
    }
  });

  // ------------------------------------------------------------------ RESTOCK: auto top-up low inventory
  jobs.every('automation.restock', RESTOCK_MS, () => {
    try {
      const products = db.all(`
        SELECT p.id, p.sku, p.reorder_level,
               COALESCE(s.qty,0) AS on_hand
        FROM products p
        LEFT JOIN (SELECT product_id, SUM(quantity) qty FROM inventory GROUP BY product_id) s
          ON s.product_id = p.id
        WHERE p.active = 1 AND COALESCE(s.qty,0) < p.reorder_level * 1.5
        LIMIT 5
      `);

      if (products.length === 0) return;

      const racks = getRacks();
      if (racks.length === 0) return;

      for (const p of products) {
        const restockQty = Math.max(p.reorder_level * 3, 50);
        const rack = racks[ri(0, racks.length - 1)];
        const batch = `B-AUTO-${Date.now().toString(36).toUpperCase()}`;
        const now = nowIso();

        // Upsert inventory
        const existing = db.get(
          'SELECT * FROM inventory WHERE product_id = ? AND rack_id = ?',
          [p.id, rack.id]
        );
        if (existing) {
          const newQty = existing.quantity + restockQty;
          db.run('UPDATE inventory SET quantity = ?, received_at = ? WHERE id = ?', [newQty, now, existing.id]);
          db.run(
            `INSERT INTO stock_movements(product_id, rack_id, batch_no, type, quantity, balance_after, reason, created_at)
             VALUES(?,?,?,?,?,?,?,?)`,
            [p.id, rack.id, existing.batch_no, 'IN', restockQty, newQty, 'Auto restock', now]
          );
        } else {
          db.run(
            'INSERT INTO inventory(product_id, rack_id, quantity, reserved, batch_no, received_at) VALUES(?,?,?,0,?,?)',
            [p.id, rack.id, restockQty, batch, now]
          );
          db.run(
            `INSERT INTO stock_movements(product_id, rack_id, batch_no, type, quantity, balance_after, reason, created_at)
             VALUES(?,?,?,?,?,?,?,?)`,
            [p.id, rack.id, batch, 'IN', restockQty, restockQty, 'Auto restock', now]
          );
        }

        log.info(`[automation.restock] restocked ${p.sku} +${restockQty} units`);
      }

      changed('inventory');
    } catch (e) {
      log.error(`[automation.restock] ${e.message}`);
    }
  });

  log.info(`[automation] Live Data Automation started — tick:${TICK_MS}ms advance:${ADVANCE_MS}ms restock:${RESTOCK_MS}ms`);
}
