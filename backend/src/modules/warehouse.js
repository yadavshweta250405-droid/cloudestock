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
    structure() {
      const wh = db.get('SELECT * FROM warehouses ORDER BY id LIMIT 1');
      const racks = db.all(
        `SELECT r.*, COALESCE(u.qty,0) AS used, COALESCE(u.res,0) AS reserved, COALESCE(u.pallets,0) AS pallets
         FROM storage_racks r LEFT JOIN (SELECT rack_id, SUM(quantity) qty, SUM(reserved) res, COUNT(*) pallets FROM inventory WHERE quantity > 0 GROUP BY rack_id) u ON u.rack_id = r.id
         ORDER BY r.section_id, r.row_no, r.col_no`);
      const sections = db.all('SELECT * FROM storage_sections ORDER BY id').map((s) => {
        const rs = racks.filter((r) => r.section_id === s.id).map((r) => ({
          id: r.id, code: r.code, sectionId: r.section_id, row: r.row_no, col: r.col_no, capacity: r.capacity, maxPallets: r.max_pallets, occupied: r.used, reserved: r.reserved, pallets: r.pallets,
          available: r.capacity - r.used, utilization: r.capacity ? r.used / r.capacity : 0, status: rackStatus(r.used, r.capacity),
        }));
        const capacity = rs.reduce((a, r) => a + r.capacity, 0); const occupied = rs.reduce((a, r) => a + r.occupied, 0);
        return { id: s.id, code: s.code, name: s.name, zone: s.zone, capacity, occupied, available: capacity - occupied, utilization: capacity ? occupied / capacity : 0, status: rackStatus(occupied, capacity), racks: rs };
      });
      const docks = db.all('SELECT * FROM docks ORDER BY number').map((d) => ({ id: d.id, number: d.number, direction: d.direction, status: d.status }));
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
  router.get('/api/warehouse', { perm: 'warehouse:read' }, () => s.structure());
  router.get('/api/racks/:id', { perm: 'warehouse:read' }, (r) => s.rack(Number(r.params.id)));
  router.post('/api/sections', { perm: 'warehouse:write' }, (r) => { r.setStatus(201); return s.createSection(validate(r.body, { code: { type: 'string', required: true, minLength: 1, maxLength: 4, pattern: /^[A-Za-z0-9]+$/ }, name: { type: 'string', required: true, minLength: 2, maxLength: 60 }, zone: { type: 'enum', values: ZONES, required: true } }), r.user); });
  router.patch('/api/sections/:id', { perm: 'warehouse:write' }, (r) => s.updateSection(Number(r.params.id), validate(r.body, { name: { type: 'string', required: true, minLength: 2, maxLength: 60 } }), r.user));
  router.post('/api/racks', { perm: 'warehouse:write' }, (r) => { r.setStatus(201); return s.createRack(validate(r.body, { sectionId: idRule({ required: true }), row: idRule({ required: true, max: 3 }), col: idRule({ required: true, max: 4 }), capacity: { type: 'int', min: 1, max: 100000 }, maxPallets: { type: 'int', min: 1, max: 6 } }), r.user); });
  router.patch('/api/racks/:id', { perm: 'warehouse:write' }, (r) => s.updateRack(Number(r.params.id), validate(r.body, { capacity: { type: 'int', min: 1, max: 100000 }, maxPallets: { type: 'int', min: 1, max: 6 } }, { partial: true }), r.user));
  router.delete('/api/racks/:id', { perm: 'warehouse:write' }, (r) => s.deleteRack(Number(r.params.id), r.user));
  router.post('/api/docks', { perm: 'warehouse:write' }, (r) => { r.setStatus(201); return s.createDock(validate(r.body || {}, { direction: { type: 'enum', values: DOCK_DIRECTIONS } }), r.user); });
  router.patch('/api/docks/:id', { perm: 'warehouse:write' }, (r) => s.updateDock(Number(r.params.id), validate(r.body, { direction: { type: 'enum', values: DOCK_DIRECTIONS }, status: { type: 'enum', values: ['free', 'maintenance'] } }, { partial: true }), r.user));
}
