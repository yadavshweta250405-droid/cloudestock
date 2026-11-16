import { validate, idRule } from '../core/validate.js';
import { conflict, notFound, badRequest } from '../core/errors.js';
import { likeTerm, nowIso, pad, pageParams } from '../core/util.js';
import { ORDER_STATUSES, ORDER_TRANSITIONS, PRIORITIES } from '../../../shared/constants.js';

const ORDER_SQL = `
  SELECT o.*, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count,
         (SELECT COALESCE(SUM(quantity),0) FROM order_items i WHERE i.order_id = o.id) AS unit_count,
         d.code AS delivery_code, d.status AS delivery_status, v.code AS vehicle_code
  FROM orders o LEFT JOIN deliveries d ON d.id = o.delivery_id LEFT JOIN vehicles v ON v.id = d.vehicle_id`;

export function createService(ctx) {
  const { db } = ctx;
  const map = (o) => ({
    id: o.id, number: o.number, customerName: o.customer_name, customerEmail: o.customer_email, customerPhone: o.customer_phone, deliveryAddress: o.delivery_address, city: o.city,
    status: o.status, priority: o.priority, notes: o.notes, totalAmount: o.total_amount, deliveryId: o.delivery_id, deliveryCode: o.delivery_code, deliveryStatus: o.delivery_status,
    vehicleCode: o.vehicle_code, itemCount: o.item_count, unitCount: o.unit_count, createdAt: o.created_at, updatedAt: o.updated_at, dispatchedAt: o.dispatched_at, deliveredAt: o.delivered_at,
    nextStatuses: ORDER_TRANSITIONS[o.status] || [],
  });

  function reserve(itemId, product, qty) {
    const rows = db.all('SELECT * FROM inventory WHERE product_id = ? AND quantity - reserved > 0 ORDER BY received_at, id', [product.id]);
    const avail = rows.reduce((s, r) => s + r.quantity - r.reserved, 0);
    if (avail < qty) throw conflict(`Insufficient stock for ${product.sku} (${product.name}): requested ${qty}, available ${avail}`, { productId: product.id, requested: qty, available: avail });
    let left = qty;
    for (const r of rows) {
      if (left <= 0) break;
      const take = Math.min(left, r.quantity - r.reserved);
      db.run('UPDATE inventory SET reserved = reserved + ? WHERE id = ?', [take, r.id]);
      db.run('INSERT INTO order_allocations(order_item_id, inventory_id, quantity) VALUES(?,?,?)', [itemId, r.id, take]);
      left -= take;
    }
  }
  function release(orderId) {
    const allocs = db.all('SELECT a.* FROM order_allocations a JOIN order_items i ON i.id = a.order_item_id WHERE i.order_id = ?', [orderId]);
    for (const a of allocs) db.run('UPDATE inventory SET reserved = reserved - ? WHERE id = ?', [a.quantity, a.inventory_id]);
    db.run('DELETE FROM order_allocations WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)', [orderId]);
  }
  function mergeItems(items) {
    const m = new Map();
    for (const it of items) m.set(it.productId, (m.get(it.productId) || 0) + it.quantity);
    return [...m].map(([productId, quantity]) => ({ productId, quantity }));
  }
  function placeItems(orderId, items) {
    let total = 0;
    for (const it of mergeItems(items)) {
      const p = db.get('SELECT * FROM products WHERE id = ? AND active = 1', [it.productId]);
      if (!p) throw notFound(`Product #${it.productId}`);
      const { lastId } = db.run('INSERT INTO order_items(order_id, product_id, quantity, unit_price) VALUES(?,?,?,?)', [orderId, p.id, it.quantity, p.unit_price]);
      reserve(lastId, p, it.quantity);
      total += p.unit_price * it.quantity;
    }
    return Math.round(total * 100) / 100;
  }

  const svc = {
    map, release,
    list({ status, q, priority, limit = 100, offset = 0 } = {}) {
      const where = []; const params = [];
      if (status) { where.push('o.status = ?'); params.push(status); }
      if (priority) { where.push('o.priority = ?'); params.push(priority); }
      if (q) { where.push(`(o.number LIKE ? ESCAPE '\\' OR o.customer_name LIKE ? ESCAPE '\\' OR o.city LIKE ? ESCAPE '\\')`); params.push(likeTerm(q), likeTerm(q), likeTerm(q)); }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const total = db.get(`SELECT COUNT(*) c FROM orders o ${w}`, params).c;
      const items = db.all(`${ORDER_SQL} ${w} ORDER BY o.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]).map(map);
      return { items, total };
    },
    get(id) {
      const row = db.get(`${ORDER_SQL} WHERE o.id = ?`, [id]);
      if (!row) throw notFound('Order');
      const o = map(row);
      o.items = db.all('SELECT i.*, p.sku, p.name FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id', [id]).map((i) => ({
        id: i.id, productId: i.product_id, sku: i.sku, name: i.name, quantity: i.quantity, unitPrice: i.unit_price,
        allocations: db.all('SELECT a.quantity, r.code AS rack_code FROM order_allocations a JOIN inventory v ON v.id = a.inventory_id JOIN storage_racks r ON r.id = v.rack_id WHERE a.order_item_id = ?', [i.id]).map((a) => ({ rackCode: a.rack_code, quantity: a.quantity })),
      }));
      o.history = db.all(`SELECT user_name, action, message, created_at FROM activity_logs WHERE entity_type = 'order' AND entity_id = ? ORDER BY id DESC LIMIT 20`, [id])
        .map((h) => ({ userName: h.user_name, action: h.action, message: h.message, createdAt: h.created_at }));
      return o;
    },
    create(d, user) {
      const id = db.transaction(() => {
        const t = nowIso();
        const number = `SO-${pad(db.get('SELECT COALESCE(MAX(id),0)+1 n FROM orders').n, 6)}`;
        const { lastId } = db.run(
          `INSERT INTO orders(number,customer_name,customer_email,customer_phone,delivery_address,city,status,priority,notes,total_amount,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [number, d.customerName, d.customerEmail ?? null, d.customerPhone ?? null, d.deliveryAddress, d.city, 'Pending', d.priority ?? 'normal', d.notes ?? null, 0, user?.id ?? null, t, t]);
        const total = placeItems(lastId, d.items);
        db.run('UPDATE orders SET total_amount = ? WHERE id = ?', [total, lastId]);
        ctx.activity.log(user, 'order.created', 'order', lastId, `Order ${number} created for ${d.customerName} (${d.items.length} line(s), stock reserved)`);
        return lastId;
      });
      ctx.changed('orders', 'inventory');
      return svc.get(id);
    },
    update(id, d, user) {
      db.transaction(() => {
        const o = db.get('SELECT * FROM orders WHERE id = ?', [id]);
        if (!o) throw notFound('Order');
        if (o.status !== 'Pending') throw conflict(`Only Pending orders can be edited (this one is ${o.status})`);
        let total = o.total_amount;
        if (d.items) {
          release(id);
          db.run('DELETE FROM order_items WHERE order_id = ?', [id]);
          total = placeItems(id, d.items);
        }
        db.run(`UPDATE orders SET customer_name=?, customer_email=?, customer_phone=?, delivery_address=?, city=?, priority=?, notes=?, total_amount=?, updated_at=? WHERE id=?`,
          [d.customerName ?? o.customer_name, d.customerEmail === undefined ? o.customer_email : d.customerEmail, d.customerPhone === undefined ? o.customer_phone : d.customerPhone, d.deliveryAddress ?? o.delivery_address, d.city ?? o.city, d.priority ?? o.priority, d.notes === undefined ? o.notes : d.notes, total, nowIso(), id]);
        ctx.activity.log(user, 'order.updated', 'order', id, `Order ${o.number} updated`);
      });
      ctx.changed('orders', 'inventory');
      return svc.get(id);
    },
    transition(id, to, user) {
      const o = db.get('SELECT * FROM orders WHERE id = ?', [id]);
      if (!o) throw notFound('Order');
      if (!ORDER_STATUSES.includes(to)) throw badRequest('Unknown order status');
      if (!(ORDER_TRANSITIONS[o.status] || []).includes(to)) throw conflict(`An order cannot move from “${o.status}” to “${to}”`);
      if (to === 'Dispatched') {
        if (!o.delivery_id) throw conflict('Assign this order to a vehicle (create a delivery) before dispatching it');
        ctx.svc.deliveries.dispatch(o.delivery_id, user);
        return svc.get(id);
      }
      if (to === 'Delivered') { ctx.svc.deliveries.deliverOrder(id, user); return svc.get(id); }
      db.transaction(() => {
        if (to === 'Cancelled') {
          release(id);
          ctx.svc.tasks.closeByReference('order', id, 'cancelled');
          if (o.delivery_id) ctx.svc.deliveries.detachOrder(o, user);
        }
        db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [to, nowIso(), id]);
        if (to === 'Processing') {
          const rack = db.get(`SELECT v.rack_id FROM order_allocations a JOIN order_items i ON i.id = a.order_item_id JOIN inventory v ON v.id = a.inventory_id WHERE i.order_id = ? ORDER BY a.id LIMIT 1`, [id]);
          ctx.svc.tasks.createAuto({ title: `Pick order ${o.number}`, type: 'picking', priority: o.priority, targetType: rack ? 'rack' : 'none', targetId: rack?.rack_id, referenceType: 'order', referenceId: id });
        }
        if (to === 'Packed') ctx.svc.tasks.closeByReference('order', id, 'done', ['picking']);
        ctx.activity.log(user, 'order.status', 'order', id, `Order ${o.number}: ${o.status} → ${to}`);
      });
      if (to === 'Cancelled') ctx.notifications.notify({ level: 'warning', title: `Order ${o.number} cancelled`, message: 'Reserved stock has been released.', entityType: 'order', entityId: id });
      ctx.changed('orders', 'inventory', 'tasks', 'employees', 'deliveries');
      return svc.get(id);
    },
  };
  return svc;
}

export function registerRoutes(router, ctx) {
  const s = ctx.svc.orders;
  const schema = {
    customerName: { type: 'string', required: true, minLength: 2, maxLength: 100 }, customerEmail: { type: 'email', nullable: true },
    customerPhone: { type: 'string', maxLength: 30, nullable: true }, deliveryAddress: { type: 'string', required: true, minLength: 5, maxLength: 200 },
    city: { type: 'string', required: true, minLength: 2, maxLength: 80 }, priority: { type: 'enum', values: PRIORITIES }, notes: { type: 'string', maxLength: 500, nullable: true },
    items: { type: 'array', required: true, min: 1, max: 50, item: { shape: { productId: idRule({ required: true }), quantity: idRule({ required: true, max: 100000 }) } } },
  };
  router.get('/api/orders', { perm: 'orders:read' }, (r) => {
    const { limit, offset } = pageParams(r.query, 100);
    return s.list({ status: ORDER_STATUSES.includes(r.query.status) ? r.query.status : null, priority: PRIORITIES.includes(r.query.priority) ? r.query.priority : null, q: r.query.q, limit, offset });
  });
  router.post('/api/orders', { perm: 'orders:write' }, (r) => { r.setStatus(201); return s.create(validate(r.body, schema), r.user); });
  router.get('/api/orders/:id', { perm: 'orders:read' }, (r) => s.get(Number(r.params.id)));
  router.put('/api/orders/:id', { perm: 'orders:write' }, (r) => s.update(Number(r.params.id), validate(r.body, schema, { partial: true }), r.user));
  router.post('/api/orders/:id/status', { perm: 'orders:write' }, (r) => s.transition(Number(r.params.id), validate(r.body, { status: { type: 'enum', values: ORDER_STATUSES, required: true } }).status, r.user));
}
