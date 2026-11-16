import { likeTerm, pageParams } from '../core/util.js';
import { validate, idRule } from '../core/validate.js';

export function createService(ctx) {
  const { db } = ctx;
  return {
    search(q) {
      const t = likeTerm(q);
      const lim = 6;
      return {
        products: db.all(`SELECT id, sku, name FROM products WHERE active = 1 AND (sku LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY name LIMIT ?`, [t, t, lim]).map((p) => ({ type: 'product', id: p.id, title: p.name, subtitle: p.sku })),
        orders: db.all(`SELECT id, number, customer_name, status FROM orders WHERE number LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?`, [t, t, lim]).map((o) => ({ type: 'order', id: o.id, title: o.number, subtitle: `${o.customer_name} · ${o.status}` })),
        vehicles: db.all(`SELECT id, code, plate, status FROM vehicles WHERE code LIKE ? ESCAPE '\\' OR plate LIKE ? ESCAPE '\\' LIMIT ?`, [t, t, lim]).map((v) => ({ type: 'vehicle', id: v.id, title: v.code, subtitle: `${v.plate} · ${v.status.replace('_', ' ')}` })),
        employees: db.all(`SELECT id, code, name, department FROM employees WHERE active = 1 AND (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\') LIMIT ?`, [t, t, lim]).map((e) => ({ type: 'employee', id: e.id, title: e.name, subtitle: `${e.code} · ${e.department}` })),
        racks: db.all(`SELECT id, code FROM storage_racks WHERE code LIKE ? ESCAPE '\\' ORDER BY code LIMIT ?`, [t, lim]).map((r) => ({ type: 'rack', id: r.id, title: `Rack ${r.code}`, subtitle: 'Storage rack' })),
      };
    },
    activity({ limit, offset }) {
      return db.all('SELECT * FROM activity_logs ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset])
        .map((a) => ({ id: a.id, userName: a.user_name, action: a.action, entityType: a.entity_type, entityId: a.entity_id, message: a.message, createdAt: a.created_at }));
    },
  };
}

export function registerRoutes(router, ctx) {
  router.get('/api/search', { perm: 'search:read' }, (r) => {
    const q = String(r.query.q || '').trim();
    if (q.length < 2) return { groups: {} };
    return { groups: ctx.svc.misc.search(q) };
  });
  router.get('/api/activity', { perm: 'activity:read' }, (r) => ({ items: ctx.svc.misc.activity(pageParams(r.query, 50)) }));
  router.get('/api/notifications', (r) => ({ items: ctx.notifications.listFor(r.user.id, { limit: pageParams(r.query, 50).limit }), unread: ctx.notifications.unreadCount(r.user.id) }));
  router.post('/api/notifications/read', (r) => {
    const d = validate(r.body || {}, { id: idRule() });
    if (d.id) ctx.notifications.markRead(r.user.id, d.id); else ctx.notifications.markAllRead(r.user.id);
    return { unread: ctx.notifications.unreadCount(r.user.id) };
  });
  router.get('/api/sync', () => ctx.sync.status());
  router.post('/api/sync/run', { perm: 'sync:run' }, async () => ctx.sync.syncNow());
}
