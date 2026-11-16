import crypto from 'node:crypto';
import { validate, idRule } from '../core/validate.js';
import { badRequest, conflict, notFound, HttpError } from '../core/errors.js';
import { likeTerm, nowIso, pageParams, stockStatus } from '../core/util.js';

const PRODUCT_SQL = `
  SELECT p.*, c.name AS category_name, c.color AS category_color,
         COALESCE(s.qty,0) AS on_hand, COALESCE(s.res,0) AS reserved_qty
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN (SELECT product_id, SUM(quantity) qty, SUM(reserved) res FROM inventory GROUP BY product_id) s ON s.product_id = p.id`;

const IMAGE_TYPES = { 'image/png': ['.png', [0x89, 0x50, 0x4e, 0x47]], 'image/jpeg': ['.jpg', [0xff, 0xd8, 0xff]], 'image/webp': ['.webp', [0x52, 0x49, 0x46, 0x46]] };

export function createService(ctx) {
  const { db, storage } = ctx;

  const mapProduct = (r) => ({
    id: r.id, sku: r.sku, name: r.name, description: r.description, categoryId: r.category_id, categoryName: r.category_name, categoryColor: r.category_color,
    unitPrice: r.unit_price, unit: r.unit, reorderLevel: r.reorder_level, imageUrl: r.image_key ? storage.publicUrl(r.image_key) : null, active: !!r.active,
    onHand: r.on_hand, reserved: r.reserved_qty, available: r.on_hand - r.reserved_qty, status: stockStatus(r.on_hand, r.reorder_level),
    createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const mapInv = (r) => ({
    id: r.id, productId: r.product_id, sku: r.sku, productName: r.product_name, categoryName: r.category_name, categoryColor: r.category_color,
    rackId: r.rack_id, rackCode: r.rack_code, sectionId: r.section_id, sectionCode: r.section_code, quantity: r.quantity, reserved: r.reserved,
    available: r.quantity - r.reserved, batchNo: r.batch_no, receivedAt: r.received_at, reorderLevel: r.reorder_level,
  });
  const mapMove = (r) => ({
    id: r.id, productId: r.product_id, sku: r.sku, productName: r.product_name, rackId: r.rack_id, rackCode: r.rack_code, batchNo: r.batch_no, type: r.type,
    quantity: r.quantity, balanceAfter: r.balance_after, reason: r.reason, referenceType: r.reference_type, referenceId: r.reference_id,
    userName: r.user_name, createdAt: r.created_at,
  });

  const svc = {
    mapProduct,
    rackUsage(rackId) {
      return db.get('SELECT COALESCE(SUM(quantity),0) AS qty, COUNT(CASE WHEN quantity>0 THEN 1 END) AS pallets FROM inventory WHERE rack_id = ?', [rackId]);
    },

    // ---------- products ----------
    listProducts({ q, categoryId, status, includeInactive, limit = 200, offset = 0 } = {}) {
      const where = []; const params = [];
      if (!includeInactive) where.push('p.active = 1');
      if (q) { where.push(`(p.sku LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')`); params.push(likeTerm(q), likeTerm(q)); }
      if (categoryId) { where.push('p.category_id = ?'); params.push(categoryId); }
      const rows = db.all(`${PRODUCT_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name`, params).map(mapProduct);
      const filtered = status ? rows.filter((p) => p.status === status) : rows;
      return { items: filtered.slice(offset, offset + limit), total: filtered.length };
    },
    getProduct(id) {
      const r = db.get(`${PRODUCT_SQL} WHERE p.id = ?`, [id]);
      if (!r) throw notFound('Product');
      const product = mapProduct(r);
      product.locations = svc.listInventory({ productId: id });
      product.movements = svc.listMovements({ productId: id, limit: 15 });
      return product;
    },
    createProduct(d, user) {
      const id = db.transaction(() => {
        if (d.categoryId && !db.get('SELECT id FROM categories WHERE id = ?', [d.categoryId])) throw notFound('Category');
        const t = nowIso();
        const { lastId } = db.run(
          'INSERT INTO products(sku,name,description,category_id,unit_price,unit,reorder_level,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
          [d.sku.toUpperCase(), d.name, d.description ?? null, d.categoryId ?? null, d.unitPrice ?? 0, d.unit ?? 'pcs', d.reorderLevel ?? 20, t, t]);
        ctx.activity.log(user, 'product.created', 'product', lastId, `Product ${d.sku.toUpperCase()} “${d.name}” created`);
        return lastId;
      });
      ctx.changed('products');
      return svc.getProduct(id);
    },
    updateProduct(id, d, user) {
      const cur = db.get('SELECT * FROM products WHERE id = ?', [id]);
      if (!cur) throw notFound('Product');
      db.transaction(() => {
        if (d.categoryId && !db.get('SELECT id FROM categories WHERE id = ?', [d.categoryId])) throw notFound('Category');
        const n = {
          sku: d.sku ? d.sku.toUpperCase() : cur.sku, name: d.name ?? cur.name, description: d.description === undefined ? cur.description : d.description,
          category_id: d.categoryId === undefined ? cur.category_id : d.categoryId, unit_price: d.unitPrice ?? cur.unit_price, unit: d.unit ?? cur.unit,
          reorder_level: d.reorderLevel ?? cur.reorder_level, active: d.active === undefined ? cur.active : (d.active ? 1 : 0),
        };
        db.run('UPDATE products SET sku=?, name=?, description=?, category_id=?, unit_price=?, unit=?, reorder_level=?, active=?, updated_at=? WHERE id=?',
          [n.sku, n.name, n.description, n.category_id, n.unit_price, n.unit, n.reorder_level, n.active, nowIso(), id]);
        ctx.activity.log(user, 'product.updated', 'product', id, `Product ${n.sku} updated`);
      });
      ctx.changed('products', 'inventory');
      svc.checkLowStock(id);
      return svc.getProduct(id);
    },
    /** Hard-deletes unused products; archives (active=0) products that have history. */
    deleteProduct(id, user) {
      const p = db.get('SELECT * FROM products WHERE id = ?', [id]);
      if (!p) throw notFound('Product');
      const result = db.transaction(() => {
        const stock = db.get('SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE product_id = ?', [id]).q;
        if (stock > 0) throw conflict(`Cannot delete ${p.sku}: ${stock} units are still in stock. Issue or transfer the stock first.`);
        const open = db.get(`SELECT COUNT(*) c FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.product_id=? AND o.status NOT IN ('Delivered','Cancelled')`, [id]).c;
        if (open) throw conflict(`Cannot delete ${p.sku}: it is on ${open} open order(s).`);
        const history = db.get('SELECT (SELECT COUNT(*) FROM order_items WHERE product_id=?) + (SELECT COUNT(*) FROM stock_movements WHERE product_id=?) + (SELECT COUNT(*) FROM inbound_items WHERE product_id=?) c', [id, id, id]).c;
        let mode;
        if (history) { db.run('UPDATE products SET active = 0, updated_at = ? WHERE id = ?', [nowIso(), id]); mode = 'archived'; }
        else { db.run('DELETE FROM inventory WHERE product_id = ?', [id]); db.run('DELETE FROM products WHERE id = ?', [id]); mode = 'removed'; }
        ctx.activity.log(user, 'product.deleted', 'product', id, `Product ${p.sku} ${mode}`);
        return mode;
      });
      if (p.image_key && result === 'removed') storage.delete(p.image_key).catch(() => {});
      ctx.changed('products', 'inventory');
      return { deleted: true, mode: result };
    },
    async setProductImage(id, buffer, contentType, user) {
      const p = db.get('SELECT * FROM products WHERE id = ?', [id]);
      if (!p) throw notFound('Product');
      const type = String(contentType || '').split(';')[0].trim().toLowerCase();
      const spec = IMAGE_TYPES[type];
      if (!spec) throw new HttpError(415, 'Only PNG, JPEG or WebP images are accepted');
      if (!buffer.length || !spec[1].every((b, i) => buffer[i] === b)) throw badRequest('File content does not match its image type');
      const key = `products/${id}-${crypto.randomBytes(5).toString('hex')}${spec[0]}`;
      await storage.put(key, buffer, type);
      if (p.image_key) await storage.delete(p.image_key).catch(() => {});
      db.run('UPDATE products SET image_key = ?, updated_at = ? WHERE id = ?', [key, nowIso(), id]);
      ctx.activity.log(user, 'product.image', 'product', id, `Image updated for ${p.sku}`);
      ctx.changed('products');
      return { imageUrl: storage.publicUrl(key) };
    },
    listCategories() { return db.all('SELECT c.*, s.code AS section_code FROM categories c LEFT JOIN storage_sections s ON s.id = c.default_section_id ORDER BY c.name').map((c) => ({ id: c.id, name: c.name, color: c.color, defaultSectionId: c.default_section_id, defaultSectionCode: c.section_code })); },
    createCategory(d, user) {
      const { lastId } = db.run('INSERT INTO categories(name,color,default_section_id) VALUES(?,?,?)', [d.name, d.color ?? '#3b82f6', d.defaultSectionId ?? null]);
      ctx.activity.log(user, 'category.created', 'category', lastId, `Category “${d.name}” created`);
      ctx.changed('products');
      return svc.listCategories().find((c) => c.id === lastId);
    },

    // ---------- inventory rows ----------
    listInventory({ productId, rackId, sectionId, limit = 500 } = {}) {
      const where = ['i.quantity > 0']; const params = [];
      if (productId) { where.push('i.product_id = ?'); params.push(productId); }
      if (rackId) { where.push('i.rack_id = ?'); params.push(rackId); }
      if (sectionId) { where.push('r.section_id = ?'); params.push(sectionId); }
      params.push(limit);
      return db.all(
        `SELECT i.*, p.sku, p.name AS product_name, p.reorder_level, c.name AS category_name, c.color AS category_color,
                r.code AS rack_code, r.section_id, s.code AS section_code
         FROM inventory i JOIN products p ON p.id = i.product_id LEFT JOIN categories c ON c.id = p.category_id
         JOIN storage_racks r ON r.id = i.rack_id JOIN storage_sections s ON s.id = r.section_id
         WHERE ${where.join(' AND ')} ORDER BY r.code, p.name LIMIT ?`, params).map(mapInv);
    },
    listMovements({ productId, rackId, type, limit = 100, offset = 0 } = {}) {
      const where = []; const params = [];
      if (productId) { where.push('m.product_id = ?'); params.push(productId); }
      if (rackId) { where.push('m.rack_id = ?'); params.push(rackId); }
      if (type) { where.push('m.type = ?'); params.push(type); }
      params.push(limit, offset);
      return db.all(
        `SELECT m.*, p.sku, p.name AS product_name, r.code AS rack_code, u.name AS user_name
         FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN storage_racks r ON r.id = m.rack_id LEFT JOIN users u ON u.id = m.user_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`, params).map(mapMove);
    },

    // ---------- core stock operation (always call inside/with a transaction) ----------
    /** Applies a signed change to one (product, rack, batch) row, enforcing capacity, pallet positions and reservations. */
    adjust({ productId, rackId, batchNo = 'B-0000', delta, type, reason, refType = null, refId = null, userId = null, at = null }) {
      return db.transaction(() => {
        if (!Number.isInteger(delta) || delta === 0) throw badRequest('Quantity change must be a non-zero whole number');
        const rack = db.get('SELECT * FROM storage_racks WHERE id = ?', [rackId]);
        if (!rack) throw notFound('Rack');
        const product = db.get('SELECT * FROM products WHERE id = ?', [productId]);
        if (!product) throw notFound('Product');
        let row = db.get('SELECT * FROM inventory WHERE product_id = ? AND rack_id = ? AND batch_no = ?', [productId, rackId, batchNo]);
        if (!row) {
          if (delta < 0) throw conflict(`No stock of ${product.sku} (batch ${batchNo}) in rack ${rack.code}`);
          if (svc.rackUsage(rackId).pallets >= rack.max_pallets) throw conflict(`Rack ${rack.code} has no free pallet position (max ${rack.max_pallets})`);
          const ins = db.run('INSERT INTO inventory(product_id, rack_id, quantity, reserved, batch_no, received_at) VALUES(?,?,?,?,?,?)', [productId, rackId, 0, 0, batchNo, at || nowIso()]);
          row = { id: ins.lastId, quantity: 0, reserved: 0 };
        }
        const newQty = row.quantity + delta;
        if (newQty < 0) throw conflict(`Only ${row.quantity} units of ${product.sku} are in rack ${rack.code}`);
        if (newQty < row.reserved) throw conflict(`${row.reserved} units of ${product.sku} in ${rack.code} are reserved for open orders; only ${row.quantity - row.reserved} can be removed`);
        if (delta > 0) {
          const { qty } = svc.rackUsage(rackId);
          if (qty + delta > rack.capacity) throw conflict(`Rack ${rack.code} capacity exceeded: ${rack.capacity - qty} units free, ${delta} requested`);
        }
        if (newQty === 0) db.run('DELETE FROM inventory WHERE id = ?', [row.id]);
        else db.run('UPDATE inventory SET quantity = ? WHERE id = ?', [newQty, row.id]);
        db.run('INSERT INTO stock_movements(product_id, rack_id, batch_no, type, quantity, balance_after, reason, reference_type, reference_id, user_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          [productId, rackId, batchNo, type, delta, newQty, reason ?? null, refType, refId, userId, at || nowIso()]);
        return { inventoryId: newQty === 0 ? null : row.id, quantity: newQty, product, rack };
      });
    },
    /** Consumes a reservation when an order leaves the building. */
    fulfil(alloc, { refId, reason, userId }) {
      const inv = db.get('SELECT * FROM inventory WHERE id = ?', [alloc.inventory_id]);
      const newQty = inv.quantity - alloc.quantity;
      db.run('UPDATE inventory SET quantity = ?, reserved = reserved - ? WHERE id = ?', [newQty, alloc.quantity, inv.id]);
      db.run('INSERT INTO stock_movements(product_id, rack_id, batch_no, type, quantity, balance_after, reason, reference_type, reference_id, user_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        [inv.product_id, inv.rack_id, inv.batch_no, 'OUT', -alloc.quantity, newQty, reason, 'order', refId, userId, nowIso()]);
      if (newQty === 0 && inv.reserved - alloc.quantity === 0) db.run('DELETE FROM inventory WHERE id = ?', [inv.id]);
      return inv.product_id;
    },

    receive(d, user) {
      const res = db.transaction(() => {
        const r = svc.adjust({ productId: d.productId, rackId: d.rackId, batchNo: d.batchNo || `B-${nowIso().slice(2, 10).replace(/-/g, '')}`, delta: d.quantity, type: 'IN', reason: d.reason || 'Manual stock receipt', userId: user.id });
        ctx.activity.log(user, 'stock.in', 'product', d.productId, `Received ${d.quantity} × ${r.product.sku} into ${r.rack.code}`);
        return r;
      });
      ctx.changed('inventory');
      svc.checkLowStock(d.productId);
      return { inventoryId: res.inventoryId, quantity: res.quantity };
    },
    issue(d, user) {
      const res = db.transaction(() => {
        const r = svc.adjust({ productId: d.productId, rackId: d.rackId, batchNo: d.batchNo, delta: -d.quantity, type: 'OUT', reason: d.reason || 'Manual stock issue', userId: user.id });
        ctx.activity.log(user, 'stock.out', 'product', d.productId, `Issued ${d.quantity} × ${r.product.sku} from ${r.rack.code}`);
        return r;
      });
      ctx.changed('inventory');
      svc.checkLowStock(d.productId);
      return { inventoryId: res.inventoryId, quantity: res.quantity };
    },
    setQuantity(d, user) {
      const res = db.transaction(() => {
        const row = db.get('SELECT * FROM inventory WHERE id = ?', [d.inventoryId]);
        if (!row) throw notFound('Inventory record');
        const delta = d.newQuantity - row.quantity;
        if (delta === 0) throw badRequest('The quantity is unchanged');
        const r = svc.adjust({ productId: row.product_id, rackId: row.rack_id, batchNo: row.batch_no, delta, type: 'ADJUST', reason: d.reason, userId: user.id });
        ctx.activity.log(user, 'stock.adjust', 'product', row.product_id, `Adjusted ${r.product.sku} in ${r.rack.code} by ${delta > 0 ? '+' : ''}${delta} (${d.reason})`);
        return { r, productId: row.product_id };
      });
      ctx.changed('inventory');
      svc.checkLowStock(res.productId);
      return { inventoryId: res.r.inventoryId, quantity: res.r.quantity };
    },
    transfer(d, user) {
      const res = db.transaction(() => {
        const row = db.get('SELECT * FROM inventory WHERE id = ?', [d.inventoryId]);
        if (!row) throw notFound('Inventory record');
        if (row.rack_id === d.toRackId) throw badRequest('Source and destination racks are the same');
        if (d.quantity > row.quantity - row.reserved) throw conflict(`Only ${row.quantity - row.reserved} units are free to move (the rest are reserved)`);
        const out = svc.adjust({ productId: row.product_id, rackId: row.rack_id, batchNo: row.batch_no, delta: -d.quantity, type: 'TRANSFER_OUT', reason: `Transfer to rack ${d.toRackId}`, userId: user.id });
        const inn = svc.adjust({ productId: row.product_id, rackId: d.toRackId, batchNo: row.batch_no, delta: d.quantity, type: 'TRANSFER_IN', reason: `Transfer from rack ${out.rack.code}`, userId: user.id });
        ctx.activity.log(user, 'stock.transfer', 'product', row.product_id, `Moved ${d.quantity} × ${out.product.sku} from ${out.rack.code} to ${inn.rack.code}`);
      });
      ctx.changed('inventory');
      return res ?? { ok: true };
    },

    suggestRack(productId, quantity, batchNo) {
      const product = db.get('SELECT p.*, c.default_section_id FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?', [productId]);
      if (!product) throw notFound('Product');
      const racks = db.all(
        `SELECT r.*, s.code AS section_code, s.name AS section_name, COALESCE(u.qty,0) AS used, COALESCE(u.pallets,0) AS pallets,
                EXISTS(SELECT 1 FROM inventory i WHERE i.rack_id = r.id AND i.product_id = ? AND i.batch_no = ?) AS same_row,
                EXISTS(SELECT 1 FROM inventory i WHERE i.rack_id = r.id AND i.product_id = ? AND i.quantity > 0) AS same_product
         FROM storage_racks r JOIN storage_sections s ON s.id = r.section_id
         LEFT JOIN (SELECT rack_id, SUM(quantity) qty, COUNT(*) pallets FROM inventory WHERE quantity > 0 GROUP BY rack_id) u ON u.rack_id = r.id`,
        [productId, batchNo || '', productId]);
      const fit = racks.filter((r) => r.capacity - r.used >= quantity && (r.same_row || r.pallets < r.max_pallets));
      fit.sort((a, b) => (b.same_product - a.same_product) || ((b.section_id === product.default_section_id) - (a.section_id === product.default_section_id)) || (a.used / a.capacity - b.used / b.capacity) || a.id - b.id);
      return fit.slice(0, 5).map((r) => ({
        rackId: r.id, rackCode: r.code, sectionCode: r.section_code, freeUnits: r.capacity - r.used, freePallets: r.max_pallets - r.pallets,
        reason: r.same_product ? 'Already stores this product' : r.section_id === product.default_section_id ? 'Matches category section' : 'Has free space',
      }));
    },

    /** Raises a (de-duplicated) warning notification when a product is low or out of stock. */
    checkLowStock(productId) {
      const r = db.get(`${PRODUCT_SQL} WHERE p.id = ?`, [productId]);
      if (!r || !r.active) return;
      const st = stockStatus(r.on_hand, r.reorder_level);
      if (st === 'ok') return;
      ctx.notifications.notify({
        level: st === 'out' ? 'danger' : 'warning', entityType: 'product', entityId: r.id, dedupeMinutes: 360,
        title: st === 'out' ? `Out of stock: ${r.sku}` : `Low stock: ${r.sku}`,
        message: `${r.name} has ${r.on_hand} units on hand (reorder level ${r.reorder_level}).`,
      });
    },
    scanLowStock() {
      for (const p of db.all('SELECT id FROM products WHERE active = 1')) svc.checkLowStock(p.id);
    },
  };
  return svc;
}

export function startJobs(ctx) {
  ctx.jobs.every('stock.low-scan', ctx.config.jobs.lowStockScanMs, () => ctx.svc.inventory.scanLowStock());
}

export function registerRoutes(router, ctx) {
  const inv = ctx.svc.inventory;
  const productSchema = {
    sku: { type: 'string', required: true, minLength: 2, maxLength: 40, pattern: /^[A-Za-z0-9._-]+$/, patternMessage: 'may only contain letters, numbers, dot, dash and underscore' },
    name: { type: 'string', required: true, minLength: 2, maxLength: 120 },
    description: { type: 'string', maxLength: 1000, nullable: true },
    categoryId: idRule({ nullable: true }),
    unitPrice: { type: 'number', min: 0, max: 10000000 },
    unit: { type: 'string', maxLength: 20 },
    reorderLevel: { type: 'int', min: 0, max: 1000000 },
  };
  router.get('/api/categories', { perm: 'products:read' }, () => ({ items: inv.listCategories() }));
  router.post('/api/categories', { perm: 'products:write' }, (r) => { r.setStatus(201); return inv.createCategory(validate(r.body, { name: { type: 'string', required: true, minLength: 2, maxLength: 60 }, color: { type: 'string', pattern: /^#[0-9a-fA-F]{6}$/, patternMessage: 'must be a hex colour like #3b82f6' }, defaultSectionId: idRule({ nullable: true }) }), r.user); });

  router.get('/api/products', { perm: 'products:read' }, (r) => {
    const { limit, offset } = pageParams(r.query, 200);
    return inv.listProducts({ q: r.query.q, categoryId: Number(r.query.categoryId) || null, status: ['ok', 'low', 'out'].includes(r.query.status) ? r.query.status : null, includeInactive: r.query.includeInactive === 'true', limit, offset });
  });
  router.post('/api/products', { perm: 'products:write' }, (r) => { r.setStatus(201); return inv.createProduct(validate(r.body, productSchema), r.user); });
  router.get('/api/products/:id', { perm: 'products:read' }, (r) => inv.getProduct(Number(r.params.id)));
  router.put('/api/products/:id', { perm: 'products:write' }, (r) => inv.updateProduct(Number(r.params.id), validate(r.body, { ...productSchema, active: { type: 'bool' } }, { partial: true }), r.user));
  router.patch('/api/products/:id', { perm: 'products:write' }, (r) => inv.updateProduct(Number(r.params.id), validate(r.body, { ...productSchema, active: { type: 'bool' } }, { partial: true }), r.user));
  router.delete('/api/products/:id', { perm: 'products:write' }, (r) => inv.deleteProduct(Number(r.params.id), r.user));
  router.post('/api/products/:id/image', { perm: 'products:write', raw: true }, (r) => inv.setProductImage(Number(r.params.id), r.body || Buffer.alloc(0), r.req.headers['content-type'], r.user));

  router.get('/api/inventory', { perm: 'inventory:read' }, (r) => ({ items: inv.listInventory({ productId: Number(r.query.productId) || null, rackId: Number(r.query.rackId) || null, sectionId: Number(r.query.sectionId) || null }) }));
  router.get('/api/inventory/suggest-rack', { perm: 'inventory:read' }, (r) => {
    const d = validate(r.query, { productId: idRule({ required: true }), quantity: idRule({ required: true }), batchNo: { type: 'string', maxLength: 40 } });
    return { items: inv.suggestRack(d.productId, d.quantity, d.batchNo) };
  });
  const batch = { type: 'string', maxLength: 40, pattern: /^[A-Za-z0-9._-]+$/, patternMessage: 'may only contain letters, numbers, dot, dash and underscore' };
  router.post('/api/inventory/receive', { perm: 'inventory:write' }, (r) => { r.setStatus(201); return inv.receive(validate(r.body, { productId: idRule({ required: true }), rackId: idRule({ required: true }), quantity: idRule({ required: true, max: 1000000 }), batchNo: batch, reason: { type: 'string', maxLength: 200 } }), r.user); });
  router.post('/api/inventory/issue', { perm: 'inventory:write' }, (r) => inv.issue(validate(r.body, { productId: idRule({ required: true }), rackId: idRule({ required: true }), batchNo: { ...batch, required: true }, quantity: idRule({ required: true, max: 1000000 }), reason: { type: 'string', maxLength: 200 } }), r.user));
  router.post('/api/inventory/adjust', { perm: 'inventory:write' }, (r) => inv.setQuantity(validate(r.body, { inventoryId: idRule({ required: true }), newQuantity: { type: 'int', min: 0, max: 1000000, required: true }, reason: { type: 'string', required: true, minLength: 3, maxLength: 200 } }), r.user));
  router.post('/api/inventory/transfer', { perm: 'inventory:write' }, (r) => inv.transfer(validate(r.body, { inventoryId: idRule({ required: true }), toRackId: idRule({ required: true }), quantity: idRule({ required: true }) }), r.user));
  router.get('/api/stock-movements', { perm: 'inventory:read' }, (r) => {
    const { limit, offset } = pageParams(r.query, 100);
    return { items: inv.listMovements({ productId: Number(r.query.productId) || null, rackId: Number(r.query.rackId) || null, type: r.query.type || null, limit, offset }) };
  });
}
