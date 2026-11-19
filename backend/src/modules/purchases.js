import { validate, idRule } from '../core/validate.js';
import { pageParams } from '../core/util.js';
import { notFound, conflict } from '../core/errors.js';
import { PURCHASE_ORDER_STATUSES } from '../../../shared/constants.js';

export function createService(ctx) {
  const { db } = ctx;

  const svc = {
    listSuppliers() {
      return db.all('SELECT * FROM suppliers ORDER BY name ASC');
    },

    createSupplier(d, user) {
      const code = d.code || `SUP-${String(db.get('SELECT COUNT(*) c FROM suppliers').c + 1).padStart(3, '0')}`;
      const { lastId } = db.run(
        'INSERT INTO suppliers(code, name, contact_name, email, phone, address, city, payment_terms, active) VALUES(?,?,?,?,?,?,?,?,?)',
        [code, d.name, d.contactName || null, d.email || null, d.phone || null, d.address || null, d.city || null, d.paymentTerms || 'Net 30', 1]
      );
      ctx.activity.log(user, 'supplier.created', 'supplier', lastId, `Supplier ${d.name} (${code}) added`);
      return { id: lastId, code, name: d.name };
    },

    list(params = {}) {
      const conds = [];
      const args = [];
      if (params.status) { conds.push('po.status = ?'); args.push(params.status); }
      if (params.warehouseId) { conds.push('po.warehouse_id = ?'); args.push(params.warehouseId); }
      if (params.supplierId) { conds.push('po.supplier_id = ?'); args.push(params.supplierId); }
      if (params.q) {
        conds.push('(po.number LIKE ? OR s.name LIKE ?)');
        args.push(`%${params.q}%`, `%${params.q}%`);
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const total = db.get(`SELECT COUNT(*) c FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id ${where}`, args).c;
      const items = db.all(
        `SELECT po.*, s.name AS supplier_name, s.code AS supplier_code, w.name AS warehouse_name,
                (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) AS item_count,
                (SELECT COALESCE(SUM(quantity), 0) FROM purchase_order_items WHERE po_id = po.id) AS total_units,
                (SELECT COALESCE(SUM(received_quantity), 0) FROM purchase_order_items WHERE po_id = po.id) AS total_received
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         JOIN warehouses w ON w.id = po.warehouse_id
         ${where}
         ORDER BY po.id DESC
         LIMIT ? OFFSET ?`,
        [...args, params.limit || 50, params.offset || 0]
      );
      return { total, items };
    },

    get(id) {
      const po = db.get(
        `SELECT po.*, s.name AS supplier_name, s.code AS supplier_code, s.email AS supplier_email,
                s.phone AS supplier_phone, s.payment_terms, w.name AS warehouse_name
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         JOIN warehouses w ON w.id = po.warehouse_id
         WHERE po.id = ?`,
        [id]
      );
      if (!po) throw notFound('Purchase Order');
      const items = db.all(
        `SELECT poi.*, p.name AS product_name, p.sku, p.unit, p.unit_price
         FROM purchase_order_items poi
         JOIN products p ON p.id = poi.product_id
         WHERE poi.po_id = ?`,
        [id]
      );
      return { ...po, items };
    },

    create(d, user) {
      return db.transaction(() => {
        const num = d.number || `PO-${new Date().getFullYear()}-${String(db.get('SELECT COUNT(*) c FROM purchase_orders').c + 1).padStart(4, '0')}`;
        const whId = d.warehouseId || db.get('SELECT id FROM warehouses ORDER BY id LIMIT 1').id;
        let totalAmount = 0;
        for (const it of d.items) {
          totalAmount += (it.quantity * (it.unitCost ?? 0));
        }

        const { lastId } = db.run(
          `INSERT INTO purchase_orders(number, supplier_id, warehouse_id, status, total_amount, currency, notes, expected_delivery, created_by)
           VALUES(?,?,?,?,?,?,?,?,?)`,
          [num, d.supplierId, whId, 'pending', totalAmount, d.currency || 'USD', d.notes || null, d.expectedDelivery || null, user?.id || null]
        );

        for (const it of d.items) {
          db.run(
            `INSERT INTO purchase_order_items(po_id, product_id, quantity, unit_cost, received_quantity)
             VALUES(?,?,?,?,0)`,
            [lastId, it.productId, it.quantity, it.unitCost ?? 0]
          );
        }

        ctx.activity.log(user, 'po.created', 'purchase_order', lastId, `Purchase order ${num} created (${d.items.length} line(s), total $${totalAmount})`);
        ctx.notifications.notify({
          level: 'info',
          title: `New Purchase Order ${num}`,
          message: `Created for supplier with ${d.items.length} items totaling $${totalAmount.toFixed(2)}.`,
          entityType: 'purchase_order',
          entityId: lastId
        });
        ctx.changed('purchases');
        return svc.get(lastId);
      });
    },

    transition(id, toStatus, user) {
      return db.transaction(() => {
        const po = svc.get(id);
        if (!PURCHASE_ORDER_STATUSES.includes(toStatus)) throw conflict(`Invalid status ${toStatus}`);
        if (po.status === 'completed' || po.status === 'cancelled') throw conflict(`PO is already ${po.status}`);

        const now = new Date().toISOString();
        let orderedAt = po.ordered_at;
        if (toStatus === 'ordered' && !orderedAt) orderedAt = now;

        db.run('UPDATE purchase_orders SET status = ?, ordered_at = ?, updated_at = ? WHERE id = ?', [toStatus, orderedAt, now, id]);
        ctx.activity.log(user, 'po.status', 'purchase_order', id, `PO ${po.number} status changed: ${po.status} -> ${toStatus}`);

        if (toStatus === 'approved') {
          ctx.notifications.notify({ level: 'success', title: `PO ${po.number} Approved`, message: `Purchase order approved. Ready to send to supplier ${po.supplier_name}.`, entityType: 'purchase_order', entityId: id });
        } else if (toStatus === 'ordered') {
          ctx.notifications.notify({ level: 'info', title: `PO ${po.number} Ordered`, message: `Goods ordered from ${po.supplier_name}. Awaiting warehouse delivery.`, entityType: 'purchase_order', entityId: id });
        }

        ctx.changed('purchases');
        return svc.get(id);
      });
    },

    receive(id, allocations, user) {
      return db.transaction(() => {
        const po = svc.get(id);
        if (po.status === 'cancelled') throw conflict('Cannot receive a cancelled PO');
        const now = new Date().toISOString();

        let allDone = true;
        for (const alloc of allocations) {
          const item = po.items.find(i => i.id === alloc.itemId);
          if (!item) continue;
          const qty = Number(alloc.quantity);
          if (qty <= 0) continue;

          // Find or create default rack if not supplied
          let rackId = alloc.rackId;
          if (!rackId) {
            const defRack = db.get('SELECT id FROM storage_racks ORDER BY id LIMIT 1');
            rackId = defRack ? defRack.id : 1;
          }

          // Book into inventory
          const batchNo = alloc.batchNo || `PO-${po.number.slice(-4)}-${Date.now().toString().slice(-4)}`;
          const existing = db.get('SELECT id, quantity FROM inventory WHERE product_id = ? AND rack_id = ? AND batch_no = ?', [item.product_id, rackId, batchNo]);
          if (existing) {
            db.run('UPDATE inventory SET quantity = quantity + ? WHERE id = ?', [qty, existing.id]);
          } else {
            db.run('INSERT INTO inventory(product_id, rack_id, quantity, reserved, batch_no, received_at) VALUES(?,?,?,0,?,?)', [item.product_id, rackId, qty, batchNo, now]);
          }

          // Record stock movement
          const currentStock = db.get('SELECT COALESCE(SUM(quantity), 0) s FROM inventory WHERE product_id = ?', [item.product_id]).s;
          db.run(
            `INSERT INTO stock_movements(product_id, rack_id, batch_no, type, quantity, balance_after, reason, reference_type, reference_id, user_id, created_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
            [item.product_id, rackId, batchNo, 'IN', qty, currentStock, `PO Receipt: ${po.number}`, 'purchase_order', id, user?.id || null, now]
          );

          // Update received qty on PO item
          const newRecv = item.received_quantity + qty;
          db.run('UPDATE purchase_order_items SET received_quantity = ? WHERE id = ?', [newRecv, item.id]);
          if (newRecv < item.quantity) allDone = false;
        }

        const newStatus = allDone ? 'completed' : 'partially_received';
        db.run('UPDATE purchase_orders SET status = ?, received_at = ?, updated_at = ? WHERE id = ?', [newStatus, now, now, id]);

        ctx.activity.log(user, 'po.received', 'purchase_order', id, `PO ${po.number}: Received items booked into warehouse stock (Status: ${newStatus})`);
        ctx.notifications.notify({
          level: 'success',
          title: `Stock Received for PO ${po.number}`,
          message: `Goods added to warehouse inventory. PO status is now ${newStatus}.`,
          entityType: 'purchase_order',
          entityId: id
        });

        ctx.changed('purchases', 'inventory', 'warehouse');
        return svc.get(id);
      });
    }
  };

  return svc;
}

export function registerRoutes(router, ctx) {
  const s = ctx.svc.purchases;

  router.get('/api/suppliers', { perm: 'products:read' }, () => ({ items: s.listSuppliers() }));
  router.post('/api/suppliers', { perm: 'products:write' }, (r) => {
    r.setStatus(201);
    return s.createSupplier(validate(r.body || {}, { name: { type: 'string', required: true, minLength: 2, maxLength: 100 } }), r.user);
  });

  router.get('/api/purchase-orders', { perm: 'purchase_orders:read' }, (r) => {
    const { limit, offset } = pageParams(r.query, 50);
    return s.list({
      status: r.query.status,
      warehouseId: r.query.warehouseId ? Number(r.query.warehouseId) : null,
      supplierId: r.query.supplierId ? Number(r.query.supplierId) : null,
      q: r.query.q,
      limit,
      offset
    });
  });

  router.post('/api/purchase-orders', { perm: 'purchase_orders:write' }, (r) => {
    r.setStatus(201);
    const schema = {
      supplierId: { type: 'number', required: true },
      warehouseId: { type: 'number', nullable: true },
      currency: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true, maxLength: 500 },
      expectedDelivery: { type: 'string', nullable: true },
      items: { type: 'array', required: true, minLength: 1 }
    };
    return s.create(validate(r.body, schema), r.user);
  });

  router.get('/api/purchase-orders/:id', { perm: 'purchase_orders:read' }, (r) => s.get(Number(r.params.id)));

  router.patch('/api/purchase-orders/:id/status', { perm: 'purchase_orders:write' }, (r) => {
    const d = validate(r.body, { status: { type: 'enum', values: PURCHASE_ORDER_STATUSES, required: true } });
    return s.transition(Number(r.params.id), d.status, r.user);
  });

  router.post('/api/purchase-orders/:id/receive', { perm: 'purchase_orders:write' }, (r) => {
    const d = validate(r.body, { allocations: { type: 'array', required: true, minLength: 1 } });
    return s.receive(Number(r.params.id), d.allocations, r.user);
  });
}
