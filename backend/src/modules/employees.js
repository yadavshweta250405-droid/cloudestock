import { validate } from '../core/validate.js';
import { conflict, notFound } from '../core/errors.js';
import { nowIso, pad } from '../core/util.js';
import { DEPARTMENTS } from '../../../shared/constants.js';

export function createService(ctx) {
  const { db } = ctx;
  const SQL = `SELECT e.*, t.id AS task_id, t.title AS task_title, t.type AS task_type, t.target_type, t.target_id,
      CASE t.target_type WHEN 'rack' THEN (SELECT code FROM storage_racks WHERE id=t.target_id) WHEN 'dock' THEN 'Dock '||(SELECT number FROM docks WHERE id=t.target_id)
        WHEN 'section' THEN 'Section '||(SELECT code FROM storage_sections WHERE id=t.target_id) WHEN 'office' THEN 'Office' END AS target_label
    FROM employees e LEFT JOIN tasks t ON t.assignee_id = e.id AND t.status = 'in_progress'`;
  const map = (e) => ({
    id: e.id, code: e.code, name: e.name, email: e.email, phone: e.phone, department: e.department, jobTitle: e.job_title, status: e.status, active: !!e.active, hiredAt: e.hired_at,
    task: e.task_id ? { id: e.task_id, title: e.task_title, type: e.task_type, targetType: e.target_type, targetId: e.target_id, targetLabel: e.target_label } : null,
  });
  const svc = {
    map,
    list({ includeInactive = false, department, q } = {}) {
      const where = []; const params = [];
      if (!includeInactive) where.push('e.active = 1');
      if (department) { where.push('e.department = ?'); params.push(department); }
      if (q) { where.push(`(e.name LIKE ? OR e.code LIKE ?)`); params.push(`%${q}%`, `%${q}%`); }
      return db.all(`${SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.department, e.name`, params).map(map);
    },
    get(id) { const e = db.get(`${SQL} WHERE e.id = ?`, [id]); if (!e) throw notFound('Employee'); return map(e); },
    create(d, user) {
      const id = db.transaction(() => {
        const wh = db.get('SELECT id FROM warehouses ORDER BY id LIMIT 1');
        const next = db.get('SELECT COALESCE(MAX(id),0)+1 n FROM employees').n;
        const { lastId } = db.run('INSERT INTO employees(code,name,email,phone,department,job_title,status,warehouse_id,hired_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
          [`EMP-${pad(next, 3)}`, d.name, d.email ?? null, d.phone ?? null, d.department, d.jobTitle ?? null, 'available', wh?.id ?? null, d.hiredAt ?? nowIso().slice(0, 10), nowIso()]);
        ctx.activity.log(user, 'employee.created', 'employee', lastId, `Employee ${d.name} added to ${d.department}`);
        return lastId;
      });
      ctx.svc.tasks.pickNext(id);
      ctx.changed('employees');
      return svc.get(id);
    },
    update(id, d, user) {
      const e = db.get('SELECT * FROM employees WHERE id = ?', [id]);
      if (!e) throw notFound('Employee');
      db.transaction(() => {
        if (d.status && d.status !== e.status) {
          if (e.status === 'busy' || d.status === 'busy') throw conflict('Status “busy” is controlled by tasks. Complete or cancel the active task instead.');
        }
        if ((d.department && d.department !== e.department || d.active === false) && e.status === 'busy') throw conflict('This employee has an active task. Complete or cancel it first.');
        const n = { name: d.name ?? e.name, email: d.email === undefined ? e.email : d.email, phone: d.phone === undefined ? e.phone : d.phone, department: d.department ?? e.department, job_title: d.jobTitle === undefined ? e.job_title : d.jobTitle, status: d.status ?? e.status, active: d.active === undefined ? e.active : (d.active ? 1 : 0) };
        if (!n.active) n.status = 'off_duty';
        db.run('UPDATE employees SET name=?, email=?, phone=?, department=?, job_title=?, status=?, active=? WHERE id=?', [n.name, n.email, n.phone, n.department, n.job_title, n.status, n.active, id]);
        ctx.activity.log(user, 'employee.updated', 'employee', id, `Employee ${n.name} updated (${n.status.replace('_', ' ')})`);
      });
      ctx.svc.tasks.pickNext(id);   // back from break -> take waiting work
      ctx.changed('employees', 'tasks');
      return svc.get(id);
    },
    remove(id, user) {
      const e = db.get('SELECT * FROM employees WHERE id = ?', [id]);
      if (!e) throw notFound('Employee');
      const mode = db.transaction(() => {
        if (e.status === 'busy') throw conflict('This employee has an active task. Complete or cancel it first.');
        const history = db.get('SELECT COUNT(*) c FROM tasks WHERE assignee_id = ?', [id]).c;
        let m;
        if (history) { db.run(`UPDATE employees SET active = 0, status = 'off_duty' WHERE id = ?`, [id]); db.run(`UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ? AND status = 'pending'`, [id]); m = 'archived'; }
        else { db.run('DELETE FROM employees WHERE id = ?', [id]); m = 'removed'; }
        ctx.activity.log(user, 'employee.deleted', 'employee', id, `Employee ${e.name} ${m}`);
        return m;
      });
      ctx.changed('employees', 'tasks');
      return { deleted: true, mode };
    },
  };
  return svc;
}

export function registerRoutes(router, ctx) {
  const s = ctx.svc.employees;
  const email = { type: 'email', nullable: true };
  const schema = {
    name: { type: 'string', required: true, minLength: 2, maxLength: 80 }, email, phone: { type: 'string', maxLength: 30, nullable: true },
    department: { type: 'enum', values: DEPARTMENTS, required: true }, jobTitle: { type: 'string', maxLength: 60, nullable: true },
    hiredAt: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/, patternMessage: 'must be YYYY-MM-DD' },
  };
  router.get('/api/employees', { perm: 'employees:read' }, (r) => ({ items: s.list({ includeInactive: r.query.includeInactive === 'true', department: DEPARTMENTS.includes(r.query.department) ? r.query.department : null, q: r.query.q }) }));
  router.get('/api/employees/:id', { perm: 'employees:read' }, (r) => s.get(Number(r.params.id)));
  router.post('/api/employees', { perm: 'employees:write' }, (r) => { r.setStatus(201); return s.create(validate(r.body, schema), r.user); });
  router.patch('/api/employees/:id', { perm: 'employees:write' }, (r) => s.update(Number(r.params.id), validate(r.body, { ...schema, status: { type: 'enum', values: ['available', 'on_break', 'off_duty'] }, active: { type: 'bool' } }, { partial: true }), r.user));
  router.delete('/api/employees/:id', { perm: 'employees:write' }, (r) => s.remove(Number(r.params.id), r.user));
}
