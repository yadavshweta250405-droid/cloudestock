import { validate, idRule } from '../core/validate.js';
import { pageParams } from '../core/util.js';
import { notFound, conflict } from '../core/errors.js';
import { RETURN_STATUSES, RETURN_REASONS } from '../../../shared/constants.js';

export function createService(ctx) {
  const { db } = ctx;

  const svc = {
    list(params = {}) {
      const conds = [];
      const args = [];
      if (params.status) { conds.push('r.status = ?'); args.push(params.status); }
      if (params.reason) { conds.push('r.reason = ?'); args.push(params.reason); }
      if (params.warehouseId) { conds.push('r.warehouse_id = ?'); args.push(params.warehouseId); }
      if (params.q) {
        conds.push('(r.number LIKE ? OR r.customer_name LIKE ? OR r.customer_email LIKE ?)');
        args.push(`%${params.q}%`, `%${params.q}%`, `%${params.q}%`);
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const total = db.get(`SELECT COUNT(*) c FROM returns r ${where}`, args).c;
      const items = db.all(
        `SELECT r.*, w.name AS warehouse_name, o.number AS order_number,
                (SELECT COUNT(*) FROM return_items WHERE return_id = r.id) AS item_count,
                (SELECT COALESCE(SUM(quantity), 0) FROM return_items WHERE return_id = r.id) AS total_units,
                (SELECT COALESCE(SUM(restocked_quantity), 0) FROM return_items WHERE return_id = r.id) AS total_restocked
         FROM returns r
         JOIN warehouses w ON w.id = r.warehouse_id
         LEFT JOIN orders o ON o.id = r.order_id
         ${where}
         ORDER BY r.id DESC
         LIMIT ? OFFSET ?`,
        [...args, params.limit || 50, params.offset || 0]
      );
      return { total, items };
    },

    get(id) {
      const r = db.get(
        `SELECT r.*, w.name AS warehouse_name, o.number AS order_number, o.customer_phone
         FROM returns r
         JOIN warehouses w ON w.id = r.warehouse_id
         LEFT JOIN orders o ON o.id = r.order_id
         WHERE r.id = ?`,
        [id]
      );
      if (!r) throw notFound('Return Request');
      const items = db.all(
        `SELECT ri.*, p.name AS product_name, p.sku, p.unit, p.unit_price, sr.code AS rack_code
         FROM return_items ri
         JOIN products p ON p.id = ri.product_id
         LEFT JOIN storage_racks sr ON sr.id = ri.restocked_rack_id
         WHERE ri.return_id = ?`,
        [id]
      );
      return { ...r, items };
    },

    create(d, user) {
      return db.transaction(() => {
        const num = d.number || `RET-${new Date().getFullYear()}-${String(db.get('SELECT COUNT(*) c FROM returns').c + 1).padStart(4, '0')}`;
        const whId = d.warehouseId || db.get('SELECT id FROM warehouses ORDER BY id LIMIT 1').id;

        const { lastId } = db.run(
          `INSERT INTO returns(number, order_id, warehouse_id, customer_name, customer_email, status, reason, notes, refund_amount, created_by)
           VALUES(?,?,?,?,?,?,?,?,?,?)`,
          [num, d.orderId || null, whId, d.customerName, d.customerEmail || null, 'requested', d.reason || 'other', d.notes || null, d.refundAmount || 0, user?.id || null]
        );

        for (const it of d.items) {
          db.run(
            `INSERT INTO return_items(return_id, product_id, quantity, condition, restocked_quantity)
             VALUES(?,?,?,?,0)`,
            [lastId, it.productId, it.quantity, it.condition || 'unopened']
          );
        }

        ctx.activity.log(user, 'return.created', 'return', lastId, `Return request ${num} submitted for ${d.customerName} (${d.items.length} items, Reason: ${d.reason})`);
        ctx.notifications.notify({
          level: 'warning',
          title: `Return Requested: ${num}`,
          message: `${d.customerName} requested return for ${d.items.length} product(s) (Reason: ${d.reason}). Inspection required.`,
          entityType: 'return',
          entityId: lastId
        });
        ctx.changed('returns');
        return svc.get(lastId);
      });
    },

    inspect(id, d, user) {
      return db.transaction(() => {
        const r = svc.get(id);
        if (r.status === 'restocked') throw conflict('Cannot inspect an already restocked return');

        const now = new Date().toISOString();
        const decisionStatus = d.approved ? 'approved' : 'rejected';

        db.run(
          `UPDATE returns
           SET status = ?, inspection_notes = ?, inspected_by = ?, inspected_at = ?, refund_amount = ?, updated_at = ?
           WHERE id = ?`,
          [decisionStatus, d.inspectionNotes || null, user?.id || null, now, d.refundAmount ?? r.refund_amount, now, id]
        );

        // Update individual item condition if provided
        if (d.itemConditions) {
          for (const ic of d.itemConditions) {
            db.run('UPDATE return_items SET condition = ? WHERE id = ? AND return_id = ?', [ic.condition, ic.itemId, id]);
          }
        }

        ctx.activity.log(user, 'return.inspected', 'return', id, `Return ${r.number} inspected: ${decisionStatus.toUpperCase()} by ${user?.name || 'Staff'}`);
        ctx.notifications.notify({
          level: d.approved ? 'success' : 'danger',
          title: `Return ${r.number} ${decisionStatus.toUpperCase()}`,
          message: `Inspection completed for customer ${r.customer_name}. Status is now ${decisionStatus}.`,
          entityType: 'return',
          entityId: id
        });

        ctx.changed('returns');
        return svc.get(id);
      });
    },

    restock(id, allocations, user) {
      return db.transaction(() => {
        const r = svc.get(id);
        if (r.status !== 'approved') throw conflict('Only approved returns can be restocked into warehouse racks');
        const now = new Date().toISOString();

        for (const alloc of allocations) {
          const item = r.items.find(i => i.id === alloc.itemId);
          if (!item) continue;
          const qty = Number(alloc.quantity);
          if (qty <= 0) continue;

          let rackId = alloc.rackId;
          if (!rackId) {
            const defRack = db.get('SELECT id FROM storage_racks ORDER BY id LIMIT 1');
            rackId = defRack ? defRack.id : 1;
          }

          const batchNo = alloc.batchNo || `RET-${r.number.slice(-4)}`;
          const existing = db.get('SELECT id FROM inventory WHERE product_id = ? AND rack_id = ? AND batch_no = ?', [item.product_id, rackId, batchNo]);
          if (existing) {
            db.run('UPDATE inventory SET quantity = quantity + ? WHERE id = ?', [qty, existing.id]);
          } else {
            db.run('INSERT INTO inventory(product_id, rack_id, quantity, reserved, batch_no, received_at) VALUES(?,?,?,0,?,?)', [item.product_id, rackId, qty, batchNo, now]);
          }

          const currentStock = db.get('SELECT COALESCE(SUM(quantity), 0) s FROM inventory WHERE product_id = ?', [item.product_id]).s;
          db.run(
            `INSERT INTO stock_movements(product_id, rack_id, batch_no, type, quantity, balance_after, reason, reference_type, reference_id, user_id, created_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
            [item.product_id, rackId, batchNo, 'IN', qty, currentStock, `Customer return restocked: ${r.number}`, 'return', id, user?.id || null, now]
          );

          db.run('UPDATE return_items SET restocked_quantity = restocked_quantity + ?, restocked_rack_id = ? WHERE id = ?', [qty, rackId, item.id]);
        }

        db.run('UPDATE returns SET status = ?, updated_at = ? WHERE id = ?', ['restocked', now, id]);

        ctx.activity.log(user, 'return.restocked', 'return', id, `Return ${r.number} items successfully restocked into warehouse inventory`);
        ctx.notifications.notify({
          level: 'success',
          title: `Return ${r.number} Restocked`,
          message: `Returned goods restored to warehouse inventory shelves.`,
          entityType: 'return',
          entityId: id
        });

        ctx.changed('returns', 'inventory', 'warehouse');
        return svc.get(id);
      });
    }
  };

  return svc;
}

export function registerRoutes(router, ctx) {
  const s = ctx.svc.returns;

  router.get('/api/returns', { perm: 'returns:read' }, (r) => {
    const { limit, offset } = pageParams(r.query, 50);
    return s.list({
      status: r.query.status,
      reason: r.query.reason,
      warehouseId: r.query.warehouseId ? Number(r.query.warehouseId) : null,
      q: r.query.q,
      limit,
      offset
    });
  });

  router.post('/api/returns', { perm: 'returns:write' }, (r) => {
    r.setStatus(201);
    const schema = {
      customerName: { type: 'string', required: true, minLength: 2, maxLength: 100 },
      customerEmail: { type: 'email', nullable: true },
      orderId: { type: 'number', nullable: true },
      warehouseId: { type: 'number', nullable: true },
      reason: { type: 'enum', values: RETURN_REASONS, required: true },
      notes: { type: 'string', nullable: true, maxLength: 500 },
      refundAmount: { type: 'number', nullable: true },
      items: { type: 'array', required: true, minLength: 1 }
    };
    return s.create(validate(r.body, schema), r.user);
  });

  router.get('/api/returns/:id', { perm: 'returns:read' }, (r) => s.get(Number(r.params.id)));

  router.patch('/api/returns/:id/inspect', { perm: 'returns:write' }, (r) => {
    const schema = {
      approved: { type: 'boolean', required: true },
      inspectionNotes: { type: 'string', nullable: true, maxLength: 500 },
      refundAmount: { type: 'number', nullable: true },
      itemConditions: { type: 'array', nullable: true }
    };
    return s.inspect(Number(r.params.id), validate(r.body, schema), r.user);
  });

  router.post('/api/returns/:id/restock', { perm: 'returns:write' }, (r) => {
    const d = validate(r.body, { allocations: { type: 'array', required: true, minLength: 1 } });
    return s.restock(Number(r.params.id), d.allocations, r.user);
  });
}
