import { validate, idRule } from '../core/validate.js';
import { conflict, notFound, badRequest } from '../core/errors.js';
import { stockStatus } from '../core/util.js';
import { DOCK_DIRECTIONS, ZONES } from '../../../shared/constants.js';

// The 3D building has room for: 2 indoor halls (A/B), 1 outdoor yard, 4 loading bays; racks in a 3x4 (indoor) or 2x4 (outdoor) grid.
export const LAYOUT_LIMITS = { indoorSections: 2, outdoorSections: 1, docks: 4, indoorRows: 3, outdoorRows: 2, cols: 4 };

export function rackStatus(used, capacity) {
  const u = capacity ? used / capacity : 0;
  return used === 0 ? 'empty' : u >= 0.97 ? 'full' : u >= 0.85 ? 'near_full' : 'ok';
}

export function createService(ctx) {
  const { db } = ctx;
  const svc = {
    listWarehouses() {
      return db.all(`
        SELECT w.*,
               (SELECT COUNT(*) FROM storage_sections WHERE warehouse_id = w.id) AS section_count,
               (SELECT COUNT(*) FROM storage_racks sr JOIN storage_sections ss ON ss.id = sr.section_id WHERE ss.warehouse_id = w.id) AS rack_count,
               (SELECT COUNT(*) FROM docks WHERE warehouse_id = w.id) AS dock_count,
               (SELECT COALESCE(SUM(sr.capacity), 0) FROM storage_racks sr JOIN storage_sections ss ON ss.id = sr.section_id WHERE ss.warehouse_id = w.id) AS total_capacity,
               (SELECT COALESCE(SUM(i.quantity), 0) FROM inventory i JOIN storage_racks sr ON sr.id = i.rack_id JOIN storage_sections ss ON ss.id = sr.section_id WHERE ss.warehouse_id = w.id) AS total_occupied
        FROM warehouses w
        ORDER BY w.id ASC
      `);
    },
    getWarehouse(id) {
      const wh = db.get('SELECT * FROM warehouses WHERE id = ?', [id]);
      if (!wh) throw notFound('Warehouse');
      return wh;
    },
    createWarehouse(d, user) {
      return db.transaction(() => {
        const code = d.code || `WH-${String(db.get('SELECT COUNT(*) c FROM warehouses').c + 1).padStart(2, '0')}`;
        const { lastId } = db.run(
          'INSERT INTO warehouses(code, name, address, city) VALUES(?,?,?,?)',
          [code, d.name, d.address || null, d.city || null]
        );
        const secA = db.run('INSERT INTO storage_sections(warehouse_id, code, name, zone) VALUES(?,?,?,?)', [lastId, 'A', 'General Storage', 'indoor']).lastId;
        const secB = db.run('INSERT INTO storage_sections(warehouse_id, code, name, zone) VALUES(?,?,?,?)', [lastId, 'B', 'Bulk High-Bay', 'indoor']).lastId;
        const secC = db.run('INSERT INTO storage_sections(warehouse_id, code, name, zone) VALUES(?,?,?,?)', [lastId, 'C', 'Receiving Yard', 'outdoor']).lastId;
        for (let r = 1; r <= 3; r++) {
          for (let c = 1; c <= 4; c++) {
            db.run('INSERT INTO storage_racks(section_id, code, row_no, col_no, capacity, max_pallets) VALUES(?,?,?,?,?,?)', [secA, `W${lastId}-A-${r}-${c}`, r, c, 600, 6]);
            db.run('INSERT INTO storage_racks(section_id, code, row_no, col_no, capacity, max_pallets) VALUES(?,?,?,?,?,?)', [secB, `W${lastId}-B-${r}-${c}`, r, c, 600, 6]);
          }
        }
        for (let r = 1; r <= 2; r++) {
          for (let c = 1; c <= 4; c++) {
            db.run('INSERT INTO storage_racks(section_id, code, row_no, col_no, capacity, max_pallets) VALUES(?,?,?,?,?,?)', [secC, `W${lastId}-C-${r}-${c}`, r, c, 600, 6]);
          }
        }
        [[1, 'inbound'], [2, 'inbound'], [3, 'outbound'], [4, 'outbound']].forEach(([n, dir]) => {
          db.run('INSERT INTO docks(warehouse_id, number, direction) VALUES(?,?,?)', [lastId, n, dir]);
        });
        ctx.activity.log(user, 'warehouse.created', 'warehouse', lastId, `Warehouse ${d.name} (${code}) created in ${d.city || 'local'}`);
        ctx.notifications.notify({
          level: 'success',
          title: `New Warehouse Added: ${d.name}`,
          message: `Registered with code ${code}. 3 sections and 4 loading bays initialized.`,
          entityType: 'warehouse',
          entityId: lastId
        });
        ctx.changed('warehouse');
        return db.get('SELECT * FROM warehouses WHERE id = ?', [lastId]);
      });
    },
    updateWarehouse(id, d, user) {
      const wh = svc.getWarehouse(id);
      db.run('UPDATE warehouses SET name = ?, address = ?, city = ? WHERE id = ?', [d.name ?? wh.name, d.address ?? wh.address, d.city ?? wh.city, id]);
      ctx.activity.log(user, 'warehouse.updated', 'warehouse', id, `Warehouse ${wh.code} updated`);
      ctx.changed('warehouse');
      return svc.getWarehouse(id);
    },
    structure(warehouseId) {
      const wh = warehouseId ? db.get('SELECT * FROM warehouses WHERE id = ?', [warehouseId]) : db.get('SELECT * FROM warehouses ORDER BY id LIMIT 1');
      if (!wh) throw notFound('Warehouse');
      const racks = db.all(
        `SELECT r.*, COALESCE(u.qty,0) AS used, COALESCE(u.res,0) AS reserved, COALESCE(u.pallets,0) AS pallets
         FROM storage_racks r LEFT JOIN (SELECT rack_id, SUM(quantity) qty, SUM(reserved) res, COUNT(*) pallets FROM inventory WHERE quantity > 0 GROUP BY rack_id) u ON u.rack_id = r.id
         ORDER BY r.section_id, r.row_no, r.col_no`);
      const secQuery = warehouseId ? 'SELECT * FROM storage_sections WHERE warehouse_id = ? ORDER BY id' : 'SELECT * FROM storage_sections ORDER BY id';
      const secArgs = warehouseId ? [wh.id] : [];
      const sections = db.all(secQuery, secArgs).map((s) => {
        const rs = racks.filter((r) => r.section_id === s.id).map((r) => ({
          id: r.id, code: r.code, sectionId: r.section_id, row: r.row_no, col: r.col_no, capacity: r.capacity, maxPallets: r.max_pallets, occupied: r.used, reserved: r.reserved, pallets: r.pallets,
          available: r.capacity - r.used, utilization: r.capacity ? r.used / r.capacity : 0, status: rackStatus(r.used, r.capacity),
        }));
        const capacity = rs.reduce((a, r) => a + r.capacity, 0); const occupied = rs.reduce((a, r) => a + r.occupied, 0);
        return { id: s.id, code: s.code, name: s.name, zone: s.zone, capacity, occupied, available: capacity - occupied, utilization: capacity ? occupied / capacity : 0, status: rackStatus(occupied, capacity), racks: rs };
      });
      const dockQuery = warehouseId ? 'SELECT * FROM docks WHERE warehouse_id = ? ORDER BY number' : 'SELECT * FROM docks ORDER BY number';
      const dockArgs = warehouseId ? [wh.id] : [];
      const docks = db.all(dockQuery, dockArgs).map((d) => ({ id: d.id, number: d.number, direction: d.direction, status: d.status }));
      const capacity = sections.reduce((a, s) => a + s.capacity, 0); const occupied = sections.reduce((a, s) => a + s.occupied, 0);
      return { warehouse: wh && { id: wh.id, code: wh.code, name: wh.name, address: wh.address, city: wh.city }, capacity, occupied, available: capacity - occupied, utilization: capacity ? occupied / capacity : 0, sections, docks, limits: LAYOUT_LIMITS };
    },
    rack(id) {
      const r = db.get('SELECT r.*, s.code AS section_code, s.name AS section_name FROM storage_racks r JOIN storage_sections s ON s.id = r.section_id WHERE r.id = ?', [id]);
      if (!r) throw notFound('Rack');
      const pallets = ctx.svc.inventory.listInventory({ rackId: id });
      const used = pallets.reduce((a, p) => a + p.quantity, 0);
      return { id: r.id, code: r.code, sectionCode: r.section_code, sectionName: r.section_name, capacity: r.capacity, maxPallets: r.max_pallets, occupied: used, available: r.capacity - used, status: rackStatus(used, r.capacity), pallets, movements: ctx.svc.inventory.listMovements({ rackId: id, limit: 10 }) };
    },
    createSection(d, user) {
      const id = db.transaction(() => {
        const wh = db.get('SELECT id FROM warehouses ORDER BY id LIMIT 1');
        const count = db.get('SELECT COUNT(*) c FROM storage_sections WHERE zone = ?', [d.zone]).c;
        if (count >= (d.zone === 'indoor' ? LAYOUT_LIMITS.indoorSections : LAYOUT_LIMITS.outdoorSections)) throw conflict(`The 3D warehouse layout supports at most ${d.zone === 'indoor' ? LAYOUT_LIMITS.indoorSections : LAYOUT_LIMITS.outdoorSections} ${d.zone} section(s)`);
        const { lastId } = db.run('INSERT INTO storage_sections(warehouse_id, code, name, zone) VALUES(?,?,?,?)', [wh.id, d.code.toUpperCase(), d.name, d.zone]);
        ctx.activity.log(user, 'section.created', 'section', lastId, `Storage section ${d.code.toUpperCase()} “${d.name}” created`);
        return lastId;
      });
      ctx.changed('warehouse');
      return { id };
    },
    updateSection(id, d, user) {
      const s = db.get('SELECT * FROM storage_sections WHERE id = ?', [id]);
      if (!s) throw notFound('Section');
      db.run('UPDATE storage_sections SET name = ? WHERE id = ?', [d.name ?? s.name, id]);
      ctx.activity.log(user, 'section.updated', 'section', id, `Section ${s.code} renamed to “${d.name ?? s.name}”`);
      ctx.changed('warehouse');
      return { id };
    },
    createRack(d, user) {
      const id = db.transaction(() => {
        const s = db.get('SELECT * FROM storage_sections WHERE id = ?', [d.sectionId]);
        if (!s) throw notFound('Section');
        const maxRow = s.zone === 'indoor' ? LAYOUT_LIMITS.indoorRows : LAYOUT_LIMITS.outdoorRows;
        if (d.row > maxRow) throw badRequest(`Row must be 1–${maxRow} in ${s.zone} sections (3D layout limit)`);
        if (d.col > LAYOUT_LIMITS.cols) throw badRequest(`Column must be 1–${LAYOUT_LIMITS.cols} (3D layout limit)`);
        const code = `${s.code}-${d.row}-${d.col}`;
        const { lastId } = db.run('INSERT INTO storage_racks(section_id, code, row_no, col_no, capacity, max_pallets) VALUES(?,?,?,?,?,?)', [s.id, code, d.row, d.col, d.capacity ?? 600, d.maxPallets ?? 6]);
        ctx.activity.log(user, 'rack.created', 'rack', lastId, `Rack ${code} added (capacity ${d.capacity ?? 600})`);
        return lastId;
      });
      ctx.changed('warehouse', 'inventory');
      return svc.rack(id);
    },
    updateRack(id, d, user) {
      db.transaction(() => {
        const r = db.get('SELECT * FROM storage_racks WHERE id = ?', [id]);
        if (!r) throw notFound('Rack');
        const u = ctx.svc.inventory.rackUsage(id);
        const capacity = d.capacity ?? r.capacity; const maxPallets = d.maxPallets ?? r.max_pallets;
        if (capacity < u.qty) throw conflict(`Capacity cannot be below the ${u.qty} units currently stored`);
        if (maxPallets < u.pallets) throw conflict(`Pallet positions cannot be below the ${u.pallets} pallets currently stored`);
        db.run('UPDATE storage_racks SET capacity = ?, max_pallets = ? WHERE id = ?', [capacity, maxPallets, id]);
        ctx.activity.log(user, 'rack.updated', 'rack', id, `Rack ${r.code} updated (capacity ${capacity}, ${maxPallets} positions)`);
      });
      ctx.changed('warehouse', 'inventory');
      return svc.rack(id);
    },
    deleteRack(id, user) {
      db.transaction(() => {
        const r = db.get('SELECT * FROM storage_racks WHERE id = ?', [id]);
        if (!r) throw notFound('Rack');
        if (db.get('SELECT COUNT(*) c FROM inventory WHERE rack_id = ?', [id]).c) throw conflict(`Rack ${r.code} still holds stock. Transfer it first.`);
        db.run('DELETE FROM storage_racks WHERE id = ?', [id]);
        ctx.activity.log(user, 'rack.deleted', 'rack', id, `Rack ${r.code} removed`);
      });
      ctx.changed('warehouse', 'inventory');
      return { deleted: true };
    },
    createDock(d, user) {
      const id = db.transaction(() => {
        const wh = db.get('SELECT id FROM warehouses ORDER BY id LIMIT 1');
        if (db.get('SELECT COUNT(*) c FROM docks').c >= LAYOUT_LIMITS.docks) throw conflict(`The 3D building has ${LAYOUT_LIMITS.docks} loading bays; no more docks can be added`);
        const number = db.get('SELECT COALESCE(MAX(number),0)+1 n FROM docks').n;
        const { lastId } = db.run('INSERT INTO docks(warehouse_id, number, direction) VALUES(?,?,?)', [wh.id, number, d.direction ?? 'both']);
        ctx.activity.log(user, 'dock.created', 'dock', lastId, `Dock ${number} created`);
        return lastId;
      });
      ctx.changed('docks');
      return { id };
    },
    updateDock(id, d, user) {
      db.transaction(() => {
        const k = db.get('SELECT * FROM docks WHERE id = ?', [id]);
        if (!k) throw notFound('Dock');
        if (k.status === 'occupied' && d.status) throw conflict(`Dock ${k.number} is occupied by a vehicle. Release it first.`);
        if (k.status === 'occupied' && d.direction) throw conflict(`Dock ${k.number} is occupied; its direction cannot change now.`);
        db.run('UPDATE docks SET direction = ?, status = ? WHERE id = ?', [d.direction ?? k.direction, d.status ?? k.status, id]);
        ctx.activity.log(user, 'dock.updated', 'dock', id, `Dock ${k.number} set to ${d.status ?? k.status} / ${d.direction ?? k.direction}`);
      });
      ctx.changed('docks');
      return { id };
    },
  };
  return svc;
}

export function registerRoutes(router, ctx) {
  const s = ctx.svc.warehouse;
  router.get('/api/warehouses', { perm: 'warehouse:read' }, () => ({ items: s.listWarehouses() }));
  router.get('/api/warehouses/:id', { perm: 'warehouse:read' }, (r) => s.getWarehouse(Number(r.params.id)));
  router.post('/api/warehouses', { perm: 'warehouse:write' }, (r) => {
    r.setStatus(201);
    return s.createWarehouse(validate(r.body || {}, { name: { type: 'string', required: true, minLength: 2, maxLength: 100 }, code: { type: 'string', nullable: true }, address: { type: 'string', nullable: true }, city: { type: 'string', nullable: true } }), r.user);
  });
  router.patch('/api/warehouses/:id', { perm: 'warehouse:write' }, (r) => s.updateWarehouse(Number(r.params.id), validate(r.body || {}, { name: { type: 'string', minLength: 2, maxLength: 100 }, address: { type: 'string', nullable: true }, city: { type: 'string', nullable: true } }, { partial: true }), r.user));

  router.get('/api/warehouse', { perm: 'warehouse:read' }, (r) => s.structure(r.query?.warehouseId ? Number(r.query.warehouseId) : undefined));
  router.get('/api/racks/:id', { perm: 'warehouse:read' }, (r) => s.rack(Number(r.params.id)));
  router.post('/api/sections', { perm: 'warehouse:write' }, (r) => { r.setStatus(201); return s.createSection(validate(r.body, { code: { type: 'string', required: true, minLength: 1, maxLength: 4, pattern: /^[A-Za-z0-9]+$/ }, name: { type: 'string', required: true, minLength: 2, maxLength: 60 }, zone: { type: 'enum', values: ZONES, required: true } }), r.user); });
  router.patch('/api/sections/:id', { perm: 'warehouse:write' }, (r) => s.updateSection(Number(r.params.id), validate(r.body, { name: { type: 'string', required: true, minLength: 2, maxLength: 60 } }), r.user));
  router.post('/api/racks', { perm: 'warehouse:write' }, (r) => { r.setStatus(201); return s.createRack(validate(r.body, { sectionId: idRule({ required: true }), row: idRule({ required: true, max: 3 }), col: idRule({ required: true, max: 4 }), capacity: { type: 'int', min: 1, max: 100000 }, maxPallets: { type: 'int', min: 1, max: 6 } }), r.user); });
  router.patch('/api/racks/:id', { perm: 'warehouse:write' }, (r) => s.updateRack(Number(r.params.id), validate(r.body, { capacity: { type: 'int', min: 1, max: 100000 }, maxPallets: { type: 'int', min: 1, max: 6 } }, { partial: true }), r.user));
  router.delete('/api/racks/:id', { perm: 'warehouse:write' }, (r) => s.deleteRack(Number(r.params.id), r.user));
  router.post('/api/docks', { perm: 'warehouse:write' }, (r) => { r.setStatus(201); return s.createDock(validate(r.body || {}, { direction: { type: 'enum', values: DOCK_DIRECTIONS } }), r.user); });
  router.patch('/api/docks/:id', { perm: 'warehouse:write' }, (r) => s.updateDock(Number(r.params.id), validate(r.body, { direction: { type: 'enum', values: DOCK_DIRECTIONS }, status: { type: 'enum', values: ['free', 'maintenance'] } }, { partial: true }), r.user));
}
