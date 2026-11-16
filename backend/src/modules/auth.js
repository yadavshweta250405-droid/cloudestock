import { validate, idRule } from '../core/validate.js';
import { ROLES } from '../../../shared/constants.js';
import { conflict, notFound, forbidden } from '../core/errors.js';
import { nowIso } from '../core/util.js';

const passwordRule = {
  type: 'string', required: true, minLength: 8, maxLength: 128,
  pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/, patternMessage: 'must contain at least one letter and one number',
};

export function createService(ctx) {
  const { db } = ctx;
  const map = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: !!u.active, employeeId: u.employee_id, lastLoginAt: u.last_login_at, createdAt: u.created_at });
  return {
    list: () => db.all('SELECT * FROM users ORDER BY name').map(map),
    async create(data, actor) {
      const hash = await ctx.auth.hashPassword(data.password);
      const id = db.transaction(() => {
        const { lastId } = db.run('INSERT INTO users(email,name,password_hash,role,employee_id,created_at) VALUES(?,?,?,?,?,?)',
          [data.email, data.name, hash, data.role, data.employeeId ?? null, nowIso()]);
        ctx.activity.log(actor, 'user.created', 'user', lastId, `User ${data.email} created (${data.role})`);
        return lastId;
      });
      return map(db.get('SELECT * FROM users WHERE id = ?', [id]));
    },
    async update(id, data, actor) {
      const u = db.get('SELECT * FROM users WHERE id = ?', [id]);
      if (!u) throw notFound('User');
      const admins = () => db.get(`SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1`).c;
      if (u.role === 'admin' && u.active && ((data.role && data.role !== 'admin') || data.active === false) && admins() <= 1) throw conflict('At least one active administrator is required');
      if (id === actor.id && data.active === false) throw conflict('You cannot deactivate your own account');
      db.transaction(() => {
        const next = { ...u, name: data.name ?? u.name, email: data.email ?? u.email, role: data.role ?? u.role, active: data.active === undefined ? u.active : (data.active ? 1 : 0), employee_id: data.employeeId === undefined ? u.employee_id : data.employeeId };
        db.run('UPDATE users SET name=?, email=?, role=?, active=?, employee_id=? WHERE id=?', [next.name, next.email, next.role, next.active, next.employee_id, id]);
        if (data.password) { /* handled below (async) */ }
        if (!next.active || next.role !== u.role) ctx.auth.revokeUserSessions(id);
        ctx.activity.log(actor, 'user.updated', 'user', id, `User ${next.email} updated`);
      });
      if (data.password) { db.run('UPDATE users SET password_hash=? WHERE id=?', [await ctx.auth.hashPassword(data.password), id]); ctx.auth.revokeUserSessions(id); }
      return map(db.get('SELECT * FROM users WHERE id = ?', [id]));
    },
  };
}

export function registerRoutes(router, ctx) {
  const { auth, svc } = ctx;
  router.post('/api/auth/login', { public: true }, async (r) => {
    const { email, password } = validate(r.body, { email: { type: 'email', required: true }, password: { type: 'string', required: true, maxLength: 200 } });
    const res = await auth.login(email, password, { ip: r.req.socket.remoteAddress, userAgent: r.req.headers['user-agent'] });
    return res;
  });
  router.post('/api/auth/logout', (r) => { auth.logout(r.token); return { ok: true }; });
  router.get('/api/auth/me', (r) => ({ user: r.user, unreadNotifications: ctx.notifications.unreadCount(r.user.id) }));
  router.post('/api/auth/change-password', async (r) => {
    const d = validate(r.body, { currentPassword: { type: 'string', required: true, maxLength: 200 }, newPassword: passwordRule });
    const row = ctx.db.get('SELECT * FROM users WHERE id = ?', [r.user.id]);
    if (!(await auth.verifyPassword(d.currentPassword, row.password_hash))) throw forbidden('Current password is incorrect');
    ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await auth.hashPassword(d.newPassword), r.user.id]);
    auth.revokeUserSessions(r.user.id);
    return { ok: true, message: 'Password changed. Please sign in again.' };
  });

  const userSchema = {
    email: { type: 'email', required: true }, name: { type: 'string', required: true, minLength: 2, maxLength: 80 },
    password: passwordRule, role: { type: 'enum', values: Object.values(ROLES), required: true }, employeeId: idRule({ nullable: true }),
  };
  router.get('/api/users', { perm: 'users:manage' }, () => ({ items: svc.auth.list() }));
  router.post('/api/users', { perm: 'users:manage' }, async (r) => { r.setStatus(201); return svc.auth.create(validate(r.body, userSchema), r.user); });
  router.patch('/api/users/:id', { perm: 'users:manage' }, async (r) => {
    const d = validate(r.body, { ...userSchema, password: { ...passwordRule, required: false }, active: { type: 'bool' } }, { partial: true });
    return svc.auth.update(Number(r.params.id), d, r.user);
  });
}
