import { validate, idRule } from '../core/validate.js';
import { conflict, notFound } from '../core/errors.js';
import { nowIso, pad, pageParams } from '../core/util.js';
import { DELIVERY_STATUSES, VEHICLE_TYPES } from '../../../shared/constants.js';

const MAX_PARKING = 8;
const DELIVERY_SQL = `
  SELECT d.*, v.code AS vehicle_code, v.plate, v.type AS vehicle_type, v.color AS vehicle_color, v.capacity_units, dr.name AS driver_name, dk.number AS dock_number
  FROM deliveries d JOIN vehicles v ON v.id = d.vehicle_id LEFT JOIN drivers dr ON dr.id = d.driver_id LEFT JOIN docks dk ON dk.id = d.dock_id`;
const VEHICLE_SQL = `
  SELECT v.*, dr.name AS driver_name, dr.phone AS driver_phone, dk.number AS dock_number,
    (SELECT id FROM deliveries x WHERE x.vehicle_id = v.id AND x.status IN ('Loading','In Transit') ORDER BY x.id DESC LIMIT 1) AS delivery_id
  FROM vehicles v LEFT JOIN drivers dr ON dr.id = v.driver_id LEFT JOIN docks dk ON dk.id = v.dock_id`;

export function createService(ctx) {
  const { db } = ctx;

  const mapDelivery = (d) => ({
    id: d.id, code: d.code, status: d.status, vehicleId: d.vehicle_id, vehicleCode: d.vehicle_code, plate: d.plate, vehicleType: d.vehicle_type, vehicleColor: d.vehicle_color,
    driverId: d.driver_id, driverName: d.driver_name, dockId: d.dock_id, dockNumber: d.dock_number, destination: d.destination, etaMinutes: d.eta_minutes,
    createdAt: d.created_at, dispatchedAt: d.dispatched_at, deliveredAt: d.delivered_at,
    orders: db.all(`SELECT o.id, o.number, o.status, o.city, o.customer_name, (SELECT COALESCE(SUM(quantity),0) FROM order_items WHERE order_id = o.id) AS units FROM orders o WHERE o.delivery_id = ? ORDER BY o.id`, [d.id])
      .map((o) => ({ id: o.id, number: o.number, status: o.status, city: o.city, customerName: o.customer_name, units: o.units })),
  });
  const mapVehicle = (v) => ({
    id: v.id, code: v.code, plate: v.plate, type: v.type, capacityUnits: v.capacity_units, status: v.status, color: v.color, driverId: v.driver_id, driverName: v.driver_name,
    driverPhone: v.driver_phone, dockId: v.dock_id, dockNumber: v.dock_number, parkingSlot: v.parking_slot, deliveryId: v.delivery_id,
  });
  const mapDriver = (d) => ({ id: d.id, name: d.name, phone: d.phone, licenseNo: d.license_no, status: d.status, vehicleCode: d.vehicle_code });

  const freeSlot = () => {
    const used = new Set(db.all('SELECT parking_slot FROM vehicles WHERE parking_slot IS NOT NULL').map((r) => r.parking_slot));
    for (let i = 0; i < MAX_PARKING; i++) if (!used.has(i)) return i;
    return null;
  };
  const orderUnits = (orderId) => db.get('SELECT COALESCE(SUM(quantity),0) u FROM order_items WHERE order_id = ?', [orderId]).u;

  /** Frees vehicle, dock, driver of a delivery that will not go out (cancelled). */
  function abort(d) {
    db.run(`UPDATE deliveries SET status = 'Cancelled' WHERE id = ?`, [d.id]);
    db.run(`UPDATE vehicles SET status = 'available', dock_id = NULL, parking_slot = ? WHERE id = ?`, [freeSlot(), d.vehicle_id]);
    if (d.dock_id) db.run(`UPDATE docks SET status = 'free' WHERE id = ? AND status = 'occupied'`, [d.dock_id]);
    if (d.driver_id) db.run(`UPDATE drivers SET status = 'available' WHERE id = ?`, [d.driver_id]);
    ctx.svc.tasks.closeByReference('delivery', d.id, 'cancelled');
  }

  const svc = {
    mapVehicle, mapDelivery,
    // ---------- vehicles & drivers ----------
    listVehicles() { return db.all(`${VEHICLE_SQL} ORDER BY v.code`).map(mapVehicle); },
    getVehicle(id) { const v = db.get(`${VEHICLE_SQL} WHERE v.id = ?`, [id]); if (!v) throw notFound('Vehicle'); return mapVehicle(v); },
    createVehicle(d, user) {
      const id = db.transaction(() => {
        if (d.driverId && !db.get('SELECT id FROM drivers WHERE id = ?', [d.driverId])) throw notFound('Driver');
        if (d.driverId && db.get('SELECT id FROM vehicles WHERE driver_id = ?', [d.driverId])) throw conflict('That driver is already assigned to another vehicle');
        const n = db.get('SELECT COALESCE(MAX(id),0)+1 n FROM vehicles').n;
        const code = d.code ? d.code.toUpperCase() : `${d.type === 'van' ? 'VAN' : 'TRK'}-${100 + n}`;
        const slot = freeSlot();
        if (slot === null) throw conflict('The yard has no free parking space');
        const { lastId } = db.run('INSERT INTO vehicles(code,plate,type,capacity_units,status,color,driver_id,parking_slot,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          [code, d.plate.toUpperCase(), d.type ?? 'truck', d.capacityUnits, 'available', d.color ?? '#2563eb', d.driverId ?? null, slot, nowIso()]);
        ctx.activity.log(user, 'vehicle.created', 'vehicle', lastId, `Vehicle ${code} registered`);
        return lastId;
      });
      ctx.changed('vehicles');
      return svc.getVehicle(id);
    },
    updateVehicle(id, d, user) {
      const v = db.get('SELECT * FROM vehicles WHERE id = ?', [id]);
      if (!v) throw notFound('Vehicle');
      db.transaction(() => {
        if (d.status && d.status !== v.status) {
          const ok = (v.status === 'available' && d.status === 'maintenance') || (v.status === 'maintenance' && d.status === 'available');
          if (!ok) throw conflict(`Vehicle status can only toggle between available and maintenance (currently ${v.status})`);
        }
        if (d.driverId !== undefined && d.driverId !== null) {
          if (!db.get('SELECT id FROM drivers WHERE id = ?', [d.driverId])) throw notFound('Driver');
          if (db.get('SELECT id FROM vehicles WHERE driver_id = ? AND id != ?', [d.driverId, id])) throw conflict('That driver is already assigned to another vehicle');
        }
        if (d.driverId !== undefined && ['loading', 'on_route', 'returning'].includes(v.status)) throw conflict('The driver cannot be changed while the vehicle is on a delivery');
        db.run('UPDATE vehicles SET plate=?, type=?, capacity_units=?, color=?, driver_id=?, status=? WHERE id=?',
          [d.plate ? d.plate.toUpperCase() : v.plate, d.type ?? v.type, d.capacityUnits ?? v.capacity_units, d.color ?? v.color, d.driverId === undefined ? v.driver_id : d.driverId, d.status ?? v.status, id]);
        ctx.activity.log(user, 'vehicle.updated', 'vehicle', id, `Vehicle ${v.code} updated${d.status ? ` (${d.status})` : ''}`);
      });
      ctx.changed('vehicles');
      return svc.getVehicle(id);
    },
    deleteVehicle(id, user) {
      const v = db.get('SELECT * FROM vehicles WHERE id = ?', [id]);
      if (!v) throw notFound('Vehicle');
      if (v.status !== 'available' && v.status !== 'maintenance') throw conflict(`Vehicle ${v.code} is ${v.status.replace('_', ' ')} and cannot be removed`);
      if (db.get('SELECT id FROM deliveries WHERE vehicle_id = ? LIMIT 1', [id])) throw conflict(`Vehicle ${v.code} has delivery history. Set it to maintenance instead.`);
      db.run('DELETE FROM vehicles WHERE id = ?', [id]);
      ctx.activity.log(user, 'vehicle.deleted', 'vehicle', id, `Vehicle ${v.code} removed`);
      ctx.changed('vehicles');
      return { deleted: true };
    },
    listDrivers() { return db.all('SELECT d.*, (SELECT code FROM vehicles WHERE driver_id = d.id) AS vehicle_code FROM drivers d ORDER BY d.name').map(mapDriver); },
    createDriver(d, user) {
      const { lastId } = db.run('INSERT INTO drivers(name,phone,license_no,created_at) VALUES(?,?,?,?)', [d.name, d.phone ?? null, d.licenseNo.toUpperCase(), nowIso()]);
      ctx.activity.log(user, 'driver.created', 'driver', lastId, `Driver ${d.name} added`);
      ctx.changed('vehicles');
      return svc.listDrivers().find((x) => x.id === lastId);
    },
    updateDriver(id, d, user) {
      const cur = db.get('SELECT * FROM drivers WHERE id = ?', [id]);
      if (!cur) throw notFound('Driver');
      if (d.status && d.status !== cur.status && (cur.status === 'on_duty' || d.status === 'on_duty')) throw conflict('Driver duty status is controlled by deliveries');
      db.run('UPDATE drivers SET name=?, phone=?, license_no=?, status=? WHERE id=?', [d.name ?? cur.name, d.phone === undefined ? cur.phone : d.phone, d.licenseNo ? d.licenseNo.toUpperCase() : cur.license_no, d.status ?? cur.status, id]);
      ctx.activity.log(user, 'driver.updated', 'driver', id, `Driver ${d.name ?? cur.name} updated`);
      ctx.changed('vehicles');
      return svc.listDrivers().find((x) => x.id === id);
    },
    deleteDriver(id, user) {
      const cur = db.get('SELECT * FROM drivers WHERE id = ?', [id]);
      if (!cur) throw notFound('Driver');
      if (cur.status === 'on_duty') throw conflict('Driver is on a delivery');
      if (db.get('SELECT id FROM deliveries WHERE driver_id = ? LIMIT 1', [id])) { db.run(`UPDATE drivers SET status = 'off_duty' WHERE id = ?`, [id]); db.run('UPDATE vehicles SET driver_id = NULL WHERE driver_id = ?', [id]); ctx.changed('vehicles'); return { deleted: true, mode: 'archived' }; }
      db.run('DELETE FROM drivers WHERE id = ?', [id]);
      ctx.activity.log(user, 'driver.deleted', 'driver', id, `Driver ${cur.name} removed`);
      ctx.changed('vehicles');
      return { deleted: true, mode: 'removed' };
    },

    // ---------- deliveries ----------
    list({ status, vehicleId, limit = 100, offset = 0 } = {}) {
      const where = []; const params = [];
      if (status) { where.push('d.status = ?'); params.push(status); }
      if (vehicleId) { where.push('d.vehicle_id = ?'); params.push(vehicleId); }
      return db.all(`${DELIVERY_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]).map(mapDelivery);
    },
    get(id) { const d = db.get(`${DELIVERY_SQL} WHERE d.id = ?`, [id]); if (!d) throw notFound('Delivery'); return mapDelivery(d); },

    create(d, user) {
      const id = db.transaction(() => {
        const v = db.get('SELECT * FROM vehicles WHERE id = ?', [d.vehicleId]);
        if (!v) throw notFound('Vehicle');
        if (v.status !== 'available') throw conflict(`Vehicle ${v.code} is ${v.status.replace('_', ' ')} and cannot take a new delivery`);
        const orderIds = [...new Set(d.orderIds)];
        const orders = orderIds.map((oid) => {
          const o = db.get('SELECT * FROM orders WHERE id = ?', [oid]);
          if (!o) throw notFound(`Order #${oid}`);
          if (!['Packed', 'Ready for Dispatch'].includes(o.status)) throw conflict(`Order ${o.number} is ${o.status}; only Packed or Ready for Dispatch orders can be loaded`);
          if (o.delivery_id) throw conflict(`Order ${o.number} is already assigned to a delivery`);
          return o;
        });
        const units = orders.reduce((s, o) => s + orderUnits(o.id), 0);
        if (units > v.capacity_units) throw conflict(`Load of ${units} units exceeds ${v.code} capacity (${v.capacity_units})`);
        const driverId = d.driverId ?? v.driver_id;
        if (!driverId) throw conflict(`Vehicle ${v.code} has no driver. Choose a driver.`);
        const driver = db.get('SELECT * FROM drivers WHERE id = ?', [driverId]);
        if (!driver) throw notFound('Driver');
        if (driver.status !== 'available') throw conflict(`Driver ${driver.name} is ${driver.status.replace('_', ' ')}`);
        let dock;
        if (d.dockId) {
          dock = db.get('SELECT * FROM docks WHERE id = ?', [d.dockId]);
          if (!dock) throw notFound('Dock');
          if (dock.status !== 'free') throw conflict(`Dock ${dock.number} is ${dock.status}`);
          if (dock.direction === 'inbound') throw conflict(`Dock ${dock.number} is inbound-only`);
        } else {
          dock = db.get(`SELECT * FROM docks WHERE status = 'free' AND direction IN ('outbound','both') ORDER BY (direction = 'outbound') DESC, number LIMIT 1`);
          if (!dock) throw conflict('No free outbound loading dock. Wait for a dock to be released.');
        }
        const n = db.get('SELECT COALESCE(MAX(id),0)+1 n FROM deliveries').n;
        const cities = [...new Set(orders.map((o) => o.city))];
        const destination = cities.slice(0, 3).join(' · ') + (cities.length > 3 ? ` +${cities.length - 3}` : '');
        const { lastId } = db.run('INSERT INTO deliveries(code,vehicle_id,driver_id,dock_id,status,destination,eta_minutes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          [`DL-${pad(n, 4)}`, v.id, driverId, dock.id, 'Loading', destination, 25 + 12 * orders.length, user?.id ?? null, nowIso()]);
        for (const o of orders) db.run('UPDATE orders SET delivery_id = ?, updated_at = ? WHERE id = ?', [lastId, nowIso(), o.id]);
        db.run(`UPDATE vehicles SET status = 'loading', dock_id = ?, parking_slot = NULL, driver_id = ? WHERE id = ?`, [dock.id, driverId, v.id]);
        db.run(`UPDATE docks SET status = 'occupied' WHERE id = ?`, [dock.id]);
        db.run(`UPDATE drivers SET status = 'on_duty' WHERE id = ?`, [driverId]);
        ctx.svc.tasks.createAuto({ title: `Load ${v.code} at Dock ${dock.number} (${orders.length} order${orders.length > 1 ? 's' : ''})`, type: 'loading', targetType: 'dock', targetId: dock.id, referenceType: 'delivery', referenceId: lastId, priority: orders.some((o) => o.priority === 'urgent') ? 'urgent' : 'normal' });
        ctx.activity.log(user, 'delivery.created', 'delivery', lastId, `Delivery DL-${pad(n, 4)}: ${v.code} loading at Dock ${dock.number} with ${orders.length} order(s)`);
        return lastId;
      });
      ctx.changed('deliveries', 'vehicles', 'orders', 'docks', 'tasks', 'employees');
      return svc.get(id);
    },

    /** Removes an order from its delivery (order cancelled). Cancels the delivery when it becomes empty. */
    detachOrder(order, user) {
      const d = db.get('SELECT * FROM deliveries WHERE id = ?', [order.delivery_id]);
      if (!d) return;
      if (d.status !== 'Loading') throw conflict(`Order ${order.number} is already on the road and cannot be cancelled`);
      db.run('UPDATE orders SET delivery_id = NULL WHERE id = ?', [order.id]);
      if (db.get('SELECT COUNT(*) c FROM orders WHERE delivery_id = ?', [d.id]).c === 0) {
        abort(d);
        ctx.activity.log(user, 'delivery.cancelled', 'delivery', d.id, `Delivery ${d.code} cancelled (no orders left)`);
      }
    },
    cancel(id, user) {
      db.transaction(() => {
        const d = db.get('SELECT * FROM deliveries WHERE id = ?', [id]);
        if (!d) throw notFound('Delivery');
        if (d.status !== 'Loading') throw conflict(`Only deliveries that are still loading can be cancelled (this one is ${d.status})`);
        db.run('UPDATE orders SET delivery_id = NULL, updated_at = ? WHERE delivery_id = ?', [nowIso(), id]);
        abort(d);
        ctx.activity.log(user, 'delivery.cancelled', 'delivery', id, `Delivery ${d.code} cancelled; orders returned to the dock queue`);
      });
      ctx.changed('deliveries', 'vehicles', 'orders', 'docks', 'tasks', 'employees');
      return svc.get(id);
    },

    /** Vehicle leaves: stock is deducted for every order on board, orders become Dispatched, the 3D truck drives off. */
    dispatch(id, user) {
      const touched = new Set();
      db.transaction(() => {
        const d = db.get('SELECT * FROM deliveries WHERE id = ?', [id]);
        if (!d) throw notFound('Delivery');
        if (d.status !== 'Loading') throw conflict(`Only deliveries in Loading status can be dispatched (this one is ${d.status})`);
        const orders = db.all('SELECT * FROM orders WHERE delivery_id = ?', [id]);
        const notReady = orders.filter((o) => o.status !== 'Ready for Dispatch');
        if (notReady.length) throw conflict(`Not ready for dispatch: ${notReady.map((o) => `${o.number} (${o.status})`).join(', ')}`);
        const t = nowIso();
        for (const o of orders) {
          const allocs = db.all('SELECT a.* FROM order_allocations a JOIN order_items i ON i.id = a.order_item_id WHERE i.order_id = ?', [o.id]);
          for (const a of allocs) touched.add(ctx.svc.inventory.fulfil(a, { refId: o.id, reason: `Dispatched on ${d.code}`, userId: user?.id ?? null }));
          db.run('DELETE FROM order_allocations WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)', [o.id]);
          db.run(`UPDATE orders SET status = 'Dispatched', dispatched_at = ?, updated_at = ? WHERE id = ?`, [t, t, o.id]);
        }
        db.run(`UPDATE deliveries SET status = 'In Transit', dispatched_at = ?, dock_id = NULL WHERE id = ?`, [t, id]);
        db.run(`UPDATE vehicles SET status = 'on_route', dock_id = NULL, parking_slot = NULL WHERE id = ?`, [d.vehicle_id]);
        if (d.dock_id) db.run(`UPDATE docks SET status = 'free' WHERE id = ?`, [d.dock_id]);
        ctx.svc.tasks.closeByReference('delivery', id, 'done');
        ctx.activity.log(user, 'delivery.dispatched', 'delivery', id, `Delivery ${d.code} dispatched with ${orders.length} order(s)`);
      });
      const d = svc.get(id);
      ctx.notifications.notify({ level: 'success', title: `${d.vehicleCode} is on the road`, message: `${d.code} → ${d.destination} with ${d.orders.length} order(s).`, entityType: 'delivery', entityId: id });
      touched.forEach((pid) => ctx.svc.inventory.checkLowStock(pid));
      ctx.changed('deliveries', 'vehicles', 'orders', 'inventory', 'docks', 'tasks', 'employees');
      return d;
    },

    deliverOrder(orderId, user) {
      db.transaction(() => {
        const o = db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (!o) throw notFound('Order');
        if (o.status !== 'Dispatched') throw conflict(`Order ${o.number} is ${o.status}; only Dispatched orders can be delivered`);
        const t = nowIso();
        db.run(`UPDATE orders SET status = 'Delivered', delivered_at = ?, updated_at = ? WHERE id = ?`, [t, t, orderId]);
        ctx.activity.log(user, 'order.delivered', 'order', orderId, `Order ${o.number} delivered to ${o.customer_name}`);
        const d = db.get('SELECT * FROM deliveries WHERE id = ?', [o.delivery_id]);
        if (d && db.get(`SELECT COUNT(*) c FROM orders WHERE delivery_id = ? AND status != 'Delivered'`, [d.id]).c === 0) {
          db.run(`UPDATE deliveries SET status = 'Delivered', delivered_at = ? WHERE id = ?`, [t, d.id]);
          db.run(`UPDATE vehicles SET status = 'returning' WHERE id = ?`, [d.vehicle_id]);
          ctx.activity.log(user, 'delivery.completed', 'delivery', d.id, `Delivery ${d.code} completed; ${db.get('SELECT code FROM vehicles WHERE id = ?', [d.vehicle_id]).code} is driving back`);
          ctx.jobs.enqueue('vehicle.return', { vehicleId: d.vehicle_id }, { delayMs: ctx.config.jobs.vehicleReturnDelayMs });
        }
      });
      const deliveredOrder = db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
      if (deliveredOrder) {
        ctx.notifications.notify({
          level: 'success',
          title: 'Order Delivered',
          message: `Order ${deliveredOrder.number} has been delivered successfully.`,
          entityType: 'orders',
          entityId: orderId,
        });
      }
      ctx.changed('deliveries', 'vehicles', 'orders');
    },
    complete(id, user) {
      db.transaction(() => {
        const d = db.get('SELECT * FROM deliveries WHERE id = ?', [id]);
        if (!d) throw notFound('Delivery');
        if (d.status !== 'In Transit') throw conflict(`Only deliveries in transit can be completed (this one is ${d.status})`);
        for (const o of db.all(`SELECT id FROM orders WHERE delivery_id = ? AND status = 'Dispatched'`, [id])) svc.deliverOrder(o.id, user);
      });
      return svc.get(id);
    },
    /** Vehicle arrives back at the yard (background job). */
    returnVehicle(vehicleId) {
      const done = db.transaction(() => {
        const v = db.get('SELECT * FROM vehicles WHERE id = ?', [vehicleId]);
        if (!v || v.status !== 'returning') return false;
        db.run(`UPDATE vehicles SET status = 'available', parking_slot = ? WHERE id = ?`, [freeSlot(), vehicleId]);
        if (v.driver_id) db.run(`UPDATE drivers SET status = 'available' WHERE id = ?`, [v.driver_id]);
        ctx.activity.log(null, 'vehicle.returned', 'vehicle', vehicleId, `${v.code} is back at the yard and available`);
        return v;
      });
      if (done) {
        ctx.notifications.notify({ level: 'info', title: `${done.code} is back`, message: 'Vehicle returned to the yard and is available for new deliveries.', entityType: 'vehicle', entityId: vehicleId });
        ctx.changed('vehicles');
      }
    },
    /** After a restart, vehicles still "returning" would otherwise never come back. */
    recover() {
      for (const v of db.all(`SELECT id FROM vehicles WHERE status = 'returning'`)) ctx.jobs.enqueue('vehicle.return', { vehicleId: v.id }, { delayMs: 1500 });
    },
  };
  ctx.jobs.register('vehicle.return', ({ vehicleId }) => svc.returnVehicle(vehicleId));
  return svc;
}

export function startJobs(ctx) { ctx.svc.deliveries.recover(); }

export function registerRoutes(router, ctx) {
  const s = ctx.svc.deliveries;
  const vehicleSchema = {
    code: { type: 'string', maxLength: 20, pattern: /^[A-Za-z0-9-]+$/, patternMessage: 'may only contain letters, numbers and dashes' },
    plate: { type: 'string', required: true, minLength: 3, maxLength: 20 }, type: { type: 'enum', values: VEHICLE_TYPES },
    capacityUnits: { type: 'int', required: true, min: 1, max: 100000 }, color: { type: 'string', pattern: /^#[0-9a-fA-F]{6}$/, patternMessage: 'must be a hex colour like #2563eb' }, driverId: idRule({ nullable: true }),
  };
  router.get('/api/vehicles', { perm: 'deliveries:read' }, () => ({ items: s.listVehicles() }));
  router.get('/api/vehicles/:id', { perm: 'deliveries:read' }, (r) => s.getVehicle(Number(r.params.id)));
  router.post('/api/vehicles', { perm: 'deliveries:write' }, (r) => { r.setStatus(201); return s.createVehicle(validate(r.body, vehicleSchema), r.user); });
  router.patch('/api/vehicles/:id', { perm: 'deliveries:write' }, (r) => s.updateVehicle(Number(r.params.id), validate(r.body, { ...vehicleSchema, status: { type: 'enum', values: ['available', 'maintenance'] } }, { partial: true }), r.user));
  router.delete('/api/vehicles/:id', { perm: 'deliveries:write' }, (r) => s.deleteVehicle(Number(r.params.id), r.user));

  const driverSchema = { name: { type: 'string', required: true, minLength: 2, maxLength: 80 }, phone: { type: 'string', maxLength: 30, nullable: true }, licenseNo: { type: 'string', required: true, minLength: 4, maxLength: 30 } };
  router.get('/api/drivers', { perm: 'deliveries:read' }, () => ({ items: s.listDrivers() }));
  router.post('/api/drivers', { perm: 'deliveries:write' }, (r) => { r.setStatus(201); return s.createDriver(validate(r.body, driverSchema), r.user); });
  router.patch('/api/drivers/:id', { perm: 'deliveries:write' }, (r) => s.updateDriver(Number(r.params.id), validate(r.body, { ...driverSchema, status: { type: 'enum', values: ['available', 'off_duty'] } }, { partial: true }), r.user));
  router.delete('/api/drivers/:id', { perm: 'deliveries:write' }, (r) => s.deleteDriver(Number(r.params.id), r.user));

  router.get('/api/deliveries', { perm: 'deliveries:read' }, (r) => {
    const { limit, offset } = pageParams(r.query, 100);
    return { items: s.list({ status: DELIVERY_STATUSES.includes(r.query.status) ? r.query.status : null, vehicleId: Number(r.query.vehicleId) || null, limit, offset }) };
  });
  router.get('/api/deliveries/:id', { perm: 'deliveries:read' }, (r) => s.get(Number(r.params.id)));
  router.post('/api/deliveries', { perm: 'deliveries:write' }, (r) => {
    r.setStatus(201);
    return s.create(validate(r.body, { vehicleId: idRule({ required: true }), orderIds: { type: 'array', required: true, min: 1, max: 30, item: idRule() }, dockId: idRule({ nullable: true }), driverId: idRule({ nullable: true }) }), r.user);
  });
  router.post('/api/deliveries/:id/dispatch', { perm: 'deliveries:write' }, (r) => s.dispatch(Number(r.params.id), r.user));
  router.post('/api/deliveries/:id/complete', { perm: 'deliveries:write' }, (r) => s.complete(Number(r.params.id), r.user));
  router.post('/api/deliveries/:id/cancel', { perm: 'deliveries:write' }, (r) => s.cancel(Number(r.params.id), r.user));
}
