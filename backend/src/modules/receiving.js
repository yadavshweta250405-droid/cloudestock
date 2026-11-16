import { validate, idRule } from '../core/validate.js';
import { conflict, notFound } from '../core/errors.js';
import { nowIso, pad } from '../core/util.js';
import { SHIPMENT_STATUSES } from '../../../shared/constants.js';

const SHIP_SQL = `SELECT s.*, dk.number AS dock_number FROM inbound_shipments s LEFT JOIN docks dk ON dk.id = s.dock_id`;

export function createService(ctx) {
  const { db } = ctx;
  const map = (s, withItems = true) => {
    const o = {
      id: s.id, ref: s.ref, supplier: s.supplier, status: s.status, dockId: s.dock_id, dockNumber: s.dock_number, expectedAt: s.expected_at, arrivedAt: s.arrived_at, receivedAt: s.received_at, notes: s.notes, createdAt: s.created_at,
    };
    const items = db.all('SELECT i.*, p.sku, p.name FROM inbound_items i JOIN products p ON p.id = i.product_id WHERE i.shipment_id = ? ORDER BY i.id', [s.id]);
    o.itemCount = items.length; o.unitCount = items.reduce((a, i) => a + i.quantity, 0); o.receivedUnits = items.reduce((a, i) => a + i.received_quantity, 0);
    if (withItems) o.items = items.map((i) => ({ id: i.id, productId: i.product_id, sku: i.sku, name: i.name, quantity: i.quantity, receivedQuantity: i.received_quantity, batchNo: i.batch_no }));
    return o;
  };
  const svc = {
    map,
    list({ status } = {}) {
      return db.all(`${SHIP_SQL} ${status ? 'WHERE s.status = ?' : ''} ORDER BY CASE s.status WHEN 'Unloading' THEN 0 WHEN 'Arrived' THEN 1 WHEN 'Scheduled' THEN 2 ELSE 3 END, s.id DESC LIMIT 200`, status ? [status] : []).map((s) => map(s, false));
    },
    get(id) { const s = db.get(`${SHIP_SQL} WHERE s.id = ?`, [id]); if (!s) throw notFound('Shipment'); return map(s); },
    create(d, user) {
      const id = db.transaction(() => {
        const n = db.get('SELECT COALESCE(MAX(id),0)+1 n FROM inbound_shipments').n;
        const ref = `ASN-${pad(n, 4)}`;
        const { lastId } = db.run('INSERT INTO inbound_shipments(ref,supplier,status,expected_at,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?)', [ref, d.supplier, 'Scheduled', d.expectedAt ?? null, d.notes ?? null, user?.id ?? null, nowIso()]);
        for (const it of d.items) {
          if (!db.get('SELECT id FROM products WHERE id = ? AND active = 1', [it.productId])) throw notFound(`Product #${it.productId}`);
          db.run('INSERT INTO inbound_items(shipment_id, product_id, quantity, batch_no) VALUES(?,?,?,?)', [lastId, it.productId, it.quantity, it.batchNo ?? null]);
        }
        ctx.activity.log(user, 'shipment.created', 'shipment', lastId, `Inbound shipment ${ref} from ${d.supplier} scheduled (${d.items.length} line(s))`);
        return lastId;
      });
      ctx.changed('shipments');
      return svc.get(id);
    },
    arrive(id, dockId, user) {
      db.transaction(() => {
        const s = db.get('SELECT * FROM inbound_shipments WHERE id = ?', [id]);
        if (!s) throw notFound('Shipment');
        if (s.status !== 'Scheduled') throw conflict(`Shipment ${s.ref} is ${s.status}; only Scheduled shipments can arrive`);
        let dock;
        if (dockId) {
          dock = db.get('SELECT * FROM docks WHERE id = ?', [dockId]);
          if (!dock) throw notFound('Dock');
          if (dock.status !== 'free') throw conflict(`Dock ${dock.number} is ${dock.status}`);
          if (dock.direction === 'outbound') throw conflict(`Dock ${dock.number} is outbound-only`);
        } else {
          dock = db.get(`SELECT * FROM docks WHERE status = 'free' AND direction IN ('inbound','both') ORDER BY (direction = 'inbound') DESC, number LIMIT 1`);
          if (!dock) throw conflict('No free inbound dock. Release a dock first.');
        }
        db.run(`UPDATE inbound_shipments SET status = 'Arrived', dock_id = ?, arrived_at = ? WHERE id = ?`, [dock.id, nowIso(), id]);
        db.run(`UPDATE docks SET status = 'occupied' WHERE id = ?`, [dock.id]);
        ctx.svc.tasks.createAuto({ title: `Unload ${s.ref} (${s.supplier}) at Dock ${dock.number}`, type: 'receiving', targetType: 'dock', targetId: dock.id, referenceType: 'shipment', referenceId: id, priority: 'high' });
        ctx.activity.log(user, 'shipment.arrived', 'shipment', id, `${s.ref} arrived and docked at Dock ${dock.number}`);
      });
      ctx.notifications.notify({ level: 'info', title: 'Inbound truck at the dock', message: `${svc.get(id).ref} from ${svc.get(id).supplier} is ready to be unloaded.`, entityType: 'shipment', entityId: id });
      ctx.changed('shipments', 'docks', 'tasks', 'employees');
      return svc.get(id);
    },
    /** Books received goods into racks. lines = [{itemId, quantity, rackId?}]; no lines = receive everything outstanding with suggested racks. */
    receive(id, lines, user) {
      const touched = new Set();
      db.transaction(() => {
        const s = db.get('SELECT * FROM inbound_shipments WHERE id = ?', [id]);
        if (!s) throw notFound('Shipment');
        if (!['Arrived', 'Unloading'].includes(s.status)) throw conflict(`Shipment ${s.ref} is ${s.status}; it must be docked (Arrived) before goods can be received`);
        const items = db.all('SELECT * FROM inbound_items WHERE shipment_id = ?', [id]);
        const work = lines?.length ? lines : items.map((i) => ({ itemId: i.id, quantity: i.quantity - i.received_quantity }));
        for (const l of work) {
          if (l.quantity <= 0) continue;
          const item = items.find((i) => i.id === l.itemId);
          if (!item) throw notFound(`Shipment line #${l.itemId}`);
          const remaining = item.quantity - item.received_quantity;
          if (l.quantity > remaining) throw conflict(`Line #${item.id}: only ${remaining} units are still expected`);
          const batch = item.batch_no || `LOT-${s.ref.slice(4)}-${item.id}`;
          let rackId = l.rackId;
          if (!rackId) {
            const sug = ctx.svc.inventory.suggestRack(item.product_id, l.quantity, batch)[0];
            if (!sug) throw conflict(`No rack has space for ${l.quantity} units of this product. Add capacity or free a rack.`);
            rackId = sug.rackId;
          }
          const r = ctx.svc.inventory.adjust({ productId: item.product_id, rackId, batchNo: batch, delta: l.quantity, type: 'IN', reason: `Received on ${s.ref}`, refType: 'shipment', refId: id, userId: user?.id ?? null });
          db.run('UPDATE inbound_items SET received_quantity = received_quantity + ?, batch_no = ? WHERE id = ?', [l.quantity, batch, item.id]);
          ctx.activity.log(user, 'stock.in', 'shipment', id, `${s.ref}: received ${l.quantity} × ${r.product.sku} into ${r.rack.code}`);
          touched.add(item.product_id);
        }
        const open = db.get('SELECT COUNT(*) c FROM inbound_items WHERE shipment_id = ? AND received_quantity < quantity', [id]).c;
        if (open === 0) {
          db.run(`UPDATE inbound_shipments SET status = 'Received', received_at = ? WHERE id = ?`, [nowIso(), id]);
          if (s.dock_id) db.run(`UPDATE docks SET status = 'free' WHERE id = ?`, [s.dock_id]);
          ctx.svc.tasks.closeByReference('shipment', id, 'done');
          ctx.activity.log(user, 'shipment.received', 'shipment', id, `${s.ref} fully received; dock released`);
        } else db.run(`UPDATE inbound_shipments SET status = 'Unloading' WHERE id = ?`, [id]);
      });
      touched.forEach((pid) => ctx.svc.inventory.checkLowStock(pid));
      ctx.changed('shipments', 'inventory', 'docks', 'tasks', 'employees');
      return svc.get(id);
    },
    cancel(id, user) {
      db.transaction(() => {
        const s = db.get('SELECT * FROM inbound_shipments WHERE id = ?', [id]);
        if (!s) throw notFound('Shipment');
        if (!['Scheduled', 'Arrived'].includes(s.status)) throw conflict(`Shipment ${s.ref} is ${s.status} and cannot be cancelled`);
        db.run(`UPDATE inbound_shipments SET status = 'Cancelled', dock_id = NULL WHERE id = ?`, [id]);
        if (s.dock_id) db.run(`UPDATE docks SET status = 'free' WHERE id = ?`, [s.dock_id]);
        ctx.svc.tasks.closeByReference('shipment', id, 'cancelled');
        ctx.activity.log(user, 'shipment.cancelled', 'shipment', id, `Inbound shipment ${s.ref} cancelled`);
      });
      ctx.changed('shipments', 'docks', 'tasks', 'employees');
      return svc.get(id);
    },
  };
  return svc;
}

export function registerRoutes(router, ctx) {
  const s = ctx.svc.receiving;
  router.get('/api/shipments', { perm: 'receiving:read' }, (r) => ({ items: s.list({ status: SHIPMENT_STATUSES.includes(r.query.status) ? r.query.status : null }) }));
  router.get('/api/shipments/:id', { perm: 'receiving:read' }, (r) => s.get(Number(r.params.id)));
  router.post('/api/shipments', { perm: 'receiving:write' }, (r) => {
    r.setStatus(201);
    return s.create(validate(r.body, {
      supplier: { type: 'string', required: true, minLength: 2, maxLength: 100 }, expectedAt: { type: 'date', nullable: true }, notes: { type: 'string', maxLength: 500, nullable: true },
      items: { type: 'array', required: true, min: 1, max: 50, item: { shape: { productId: idRule({ required: true }), quantity: idRule({ required: true, max: 100000 }), batchNo: { type: 'string', maxLength: 40, pattern: /^[A-Za-z0-9._-]+$/ } } } },
    }), r.user);
  });
  router.post('/api/shipments/:id/arrive', { perm: 'receiving:write' }, (r) => s.arrive(Number(r.params.id), validate(r.body || {}, { dockId: idRule({ nullable: true }) }).dockId, r.user));
  router.post('/api/shipments/:id/receive', { perm: 'receiving:write' }, (r) => {
    const d = validate(r.body || {}, { lines: { type: 'array', max: 50, item: { shape: { itemId: idRule({ required: true }), quantity: idRule({ required: true, max: 100000 }), rackId: idRule({ nullable: true }) } } } });
    return s.receive(Number(r.params.id), d.lines, r.user);
  });
  router.post('/api/shipments/:id/cancel', { perm: 'receiving:write' }, (r) => s.cancel(Number(r.params.id), r.user));
}
