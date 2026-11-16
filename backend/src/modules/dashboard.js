import { stockStatus } from '../core/util.js';
import { rackStatus } from './warehouse.js';

const dayKey = (d) => d.toISOString().slice(0, 10);

export function createService(ctx) {
  const { db } = ctx;
  const one = (sql, p = []) => db.get(sql, p);

  const svc = {
    kpis() {
      const inv = one('SELECT COALESCE(SUM(quantity),0) qty, COALESCE(SUM(reserved),0) res FROM inventory');
      const cap = one('SELECT COALESCE(SUM(capacity),0) c FROM storage_racks').c;
      const products = db.all(`SELECT p.reorder_level, COALESCE(s.q,0) q FROM products p LEFT JOIN (SELECT product_id, SUM(quantity) q FROM inventory GROUP BY product_id) s ON s.product_id = p.id WHERE p.active = 1`);
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const del = db.all(`SELECT created_at, delivered_at FROM orders WHERE status = 'Delivered' AND delivered_at > ?`, [since]);
      const onTime = del.filter((o) => Date.parse(o.delivered_at) - Date.parse(o.created_at) <= 72 * 3600 * 1000).length;
      return {
        totalProducts: products.length,
        totalInventory: inv.qty, reservedInventory: inv.res, availableInventory: inv.qty - inv.res,
        totalOrders: one('SELECT COUNT(*) c FROM orders').c,
        pendingOrders: one(`SELECT COUNT(*) c FROM orders WHERE status = 'Pending'`).c,
        openOrders: one(`SELECT COUNT(*) c FROM orders WHERE status NOT IN ('Delivered','Cancelled')`).c,
        completedOrders: one(`SELECT COUNT(*) c FROM orders WHERE status = 'Delivered'`).c,
        activeDeliveries: one(`SELECT COUNT(*) c FROM deliveries WHERE status IN ('Loading','In Transit')`).c,
        availableVehicles: one(`SELECT COUNT(*) c FROM vehicles WHERE status = 'available'`).c,
        totalVehicles: one('SELECT COUNT(*) c FROM vehicles').c,
        trucksOnSite: one(`SELECT COUNT(*) c FROM vehicles WHERE status != 'on_route'`).c,
        totalEmployees: one('SELECT COUNT(*) c FROM employees WHERE active = 1').c,
        activeEmployees: one(`SELECT COUNT(*) c FROM employees WHERE active = 1 AND status IN ('available','busy')`).c,
        warehouseCapacity: cap, warehouseOccupied: inv.qty, warehouseUtilization: cap ? inv.qty / cap : 0,
        lowStockProducts: products.filter((p) => stockStatus(p.q, p.reorder_level) !== 'ok').length,
        incomingShipments: one(`SELECT COUNT(*) c FROM inbound_shipments WHERE status IN ('Scheduled','Arrived','Unloading')`).c,
        outgoingShipments: one(`SELECT COUNT(*) c FROM orders o JOIN deliveries d ON d.id = o.delivery_id WHERE d.status IN ('Loading','In Transit')`).c,
        docksInUse: one(`SELECT COUNT(*) c FROM docks WHERE status = 'occupied'`).c, totalDocks: one('SELECT COUNT(*) c FROM docks').c,
        onTimeRate: del.length ? onTime / del.length : null,
      };
    },
    charts() {
      const days = 14;
      const labels = []; const today = new Date();
      for (let i = days - 1; i >= 0; i--) labels.push(dayKey(new Date(today.getTime() - i * 86400000)));
      const mv = db.all(`SELECT substr(created_at,1,10) d, type, SUM(ABS(quantity)) q FROM stock_movements WHERE created_at >= ? AND type IN ('IN','OUT') GROUP BY d, type`, [labels[0]]);
      const inbound = labels.map((l) => mv.find((m) => m.d === l && m.type === 'IN')?.q || 0);
      const outbound = labels.map((l) => mv.find((m) => m.d === l && m.type === 'OUT')?.q || 0);
      // stock level at end of each day = current stock minus every net change that happened after that day
      const current = one('SELECT COALESCE(SUM(quantity),0) q FROM inventory').q;
      const level = labels.map((l) => {
        const end = new Date(Date.parse(l + 'T00:00:00Z') + 86400000).toISOString();
        const after = one(`SELECT COALESCE(SUM(quantity),0) q FROM stock_movements WHERE created_at >= ? AND type IN ('IN','OUT','ADJUST')`, [end]).q;
        return current - after;
      });
      return {
        labels, inbound, outbound, stockLevel: level,
        ordersByStatus: db.all('SELECT status, COUNT(*) c FROM orders GROUP BY status').map((r) => ({ status: r.status, count: r.c })),
        sections: ctx.svc.warehouse.structure().sections.map((s) => ({ code: s.code, name: s.name, capacity: s.capacity, occupied: s.occupied, utilization: s.utilization })),
        categoryStock: db.all(`SELECT COALESCE(c.name,'Uncategorised') name, COALESCE(c.color,'#94a3b8') color, SUM(i.quantity) q FROM inventory i JOIN products p ON p.id = i.product_id LEFT JOIN categories c ON c.id = p.category_id GROUP BY c.id ORDER BY q DESC`).map((r) => ({ name: r.name, color: r.color, quantity: r.q })),
        topProducts: db.all(`SELECT p.sku, p.name, SUM(ABS(m.quantity)) q FROM stock_movements m JOIN products p ON p.id = m.product_id WHERE m.type = 'OUT' AND m.created_at >= ? GROUP BY p.id ORDER BY q DESC LIMIT 6`, [new Date(Date.now() - 30 * 86400000).toISOString()]).map((r) => ({ sku: r.sku, name: r.name, quantity: r.q })),
      };
    },
    recentActivity(limit = 12) {
      return db.all('SELECT * FROM activity_logs ORDER BY id DESC LIMIT ?', [limit]).map((a) => ({ id: a.id, userName: a.user_name, action: a.action, entityType: a.entity_type, entityId: a.entity_id, message: a.message, createdAt: a.created_at }));
    },
    lowStock() {
      return ctx.svc.inventory.listProducts({ limit: 500 }).items.filter((p) => p.status !== 'ok').sort((a, b) => a.onHand - b.onHand).slice(0, 12);
    },
    summary(user) {
      return { kpis: svc.kpis(), charts: svc.charts(), recentActivity: svc.recentActivity(10), lowStock: svc.lowStock(), unreadNotifications: user ? ctx.notifications.unreadCount(user.id) : undefined, serverTime: new Date().toISOString() };
    },
    /** Compact snapshot written by the sync service (the "data.json" of the reference guide). Totals only, no personal data. */
    snapshot() { return { kpis: svc.kpis(), sections: svc.charts().sections, orders: svc.charts().ordersByStatus }; },

    /** Everything the 3D world needs in one call. */
    scene() {
      const struct = ctx.svc.warehouse.structure();
      const pallets = ctx.svc.inventory.listInventory({ limit: 20000 });
      const totals = new Map(db.all('SELECT product_id, SUM(quantity) q FROM inventory GROUP BY product_id').map((r) => [r.product_id, r.q]));
      const byRack = new Map();
      for (const p of pallets) {
        const status = stockStatus(totals.get(p.productId) || 0, p.reorderLevel);
        if (!byRack.has(p.rackId)) byRack.set(p.rackId, []);
        byRack.get(p.rackId).push({ inventoryId: p.id, productId: p.productId, sku: p.sku, name: p.productName, category: p.categoryName, color: p.categoryColor, quantity: p.quantity, reserved: p.reserved, batchNo: p.batchNo, status, reorderLevel: p.reorderLevel });
      }
      const sections = struct.sections.map(({ racks, ...s }) => s);
      const racks = struct.sections.flatMap((s) => s.racks.map((r) => ({ ...r, sectionCode: s.code, zone: s.zone, pallets: byRack.get(r.id) || [], lowStock: (byRack.get(r.id) || []).some((p) => p.status !== 'ok') })));
      const vehicles = ctx.svc.deliveries.listVehicles().map((v) => ({ ...v, delivery: v.deliveryId ? ctx.svc.deliveries.get(v.deliveryId) : null }));
      const shipments = ctx.svc.receiving.list().filter((s) => ['Arrived', 'Unloading'].includes(s.status)).map((s) => ctx.svc.receiving.get(s.id));
      const upcoming = ctx.svc.receiving.list({ status: 'Scheduled' });
      const docks = struct.docks.map((d) => ({
        ...d, vehicle: vehicles.find((v) => v.dockId === d.id) || null, inbound: shipments.find((s) => s.dockId === d.id) || null,
      }));
      const employees = ctx.svc.employees.list();
      const k = svc.kpis();
      return {
        meta: { serverTime: new Date().toISOString(), sync: ctx.sync.status() },
        warehouse: struct.warehouse, capacity: struct.capacity, occupied: struct.occupied, available: struct.available, utilization: struct.utilization,
        sections, racks, docks, vehicles, inboundShipments: shipments, scheduledShipments: upcoming, employees,
        kpis: { stockOnHand: k.totalInventory, trucksOnSite: k.trucksOnSite, onTimeRate: k.onTimeRate, utilization: k.warehouseUtilization, lowStock: k.lowStockProducts, openOrders: k.openOrders, totalVehicles: k.totalVehicles, activeDeliveries: k.activeDeliveries },
        office: { employees: employees.filter((e) => e.department === 'Management').length, openTasks: db.get(`SELECT COUNT(*) c FROM tasks WHERE status IN ('pending','in_progress')`).c, openOrders: k.openOrders, activeUsers: db.get('SELECT COUNT(*) c FROM users WHERE active = 1').c },
      };
    },
  };
  return svc;
}

export function registerRoutes(router, ctx) {
  router.get('/api/dashboard', { perm: 'dashboard:read' }, (r) => ctx.svc.dashboard.summary(r.user));
  router.get('/api/scene', { perm: 'scene:read' }, () => ctx.svc.dashboard.scene());
}
