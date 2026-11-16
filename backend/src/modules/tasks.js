import { validate, idRule } from '../core/validate.js';
import { conflict, notFound, forbidden, badRequest } from '../core/errors.js';
import { nowIso, pageParams, priorityRank } from '../core/util.js';
import { TASK_TYPES, TASK_STATUSES, TASK_TARGETS, TASK_DEPARTMENT, PRIORITIES, can } from '../../../shared/constants.js';

const TASK_SQL = `
  SELECT t.*, e.name AS assignee_name, e.code AS assignee_code, e.department AS assignee_department,
    CASE t.target_type
      WHEN 'rack' THEN (SELECT code FROM storage_racks WHERE id = t.target_id)
      WHEN 'dock' THEN 'Dock ' || (SELECT number FROM docks WHERE id = t.target_id)
      WHEN 'section' THEN 'Section ' || (SELECT code FROM storage_sections WHERE id = t.target_id)
      WHEN 'office' THEN 'Office' END AS target_label
  FROM tasks t LEFT JOIN employees e ON e.id = t.assignee_id`;

export function createService(ctx) {
  const { db } = ctx;
  const map = (t) => ({
    id: t.id, title: t.title, type: t.type, status: t.status, priority: t.priority, assigneeId: t.assignee_id, assigneeName: t.assignee_name, assigneeCode: t.assignee_code,
    department: TASK_DEPARTMENT[t.type] || null, targetType: t.target_type, targetId: t.target_id, targetLabel: t.target_label,
    referenceType: t.reference_type, referenceId: t.reference_id, notes: t.notes, createdAt: t.created_at, startedAt: t.started_at, completedAt: t.completed_at, dueAt: t.due_at,
  });
  const raw = (id) => db.get('SELECT * FROM tasks WHERE id = ?', [id]);
  const typesFor = (dept) => Object.entries(TASK_DEPARTMENT).filter(([, d]) => d === dept).map(([t]) => t);

  const svc = {
    list({ status, assigneeId, type, limit = 200, offset = 0 } = {}) {
      const where = []; const params = [];
      if (status) { where.push('t.status = ?'); params.push(status); }
      if (assigneeId) { where.push('t.assignee_id = ?'); params.push(assigneeId); }
      if (type) { where.push('t.type = ?'); params.push(type); }
      params.push(limit, offset);
      return db.all(`${TASK_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, ${priorityRank.replace(/priority/g, 't.priority')}, t.id DESC LIMIT ? OFFSET ?`, params).map(map);
    },
    get(id) { const t = db.get(`${TASK_SQL} WHERE t.id = ?`, [id]); if (!t) throw notFound('Task'); return map(t); },
    _checkTarget(type, id) {
      if (type === 'none' || type === 'office') return;
      const table = { rack: 'storage_racks', dock: 'docks', section: 'storage_sections' }[type];
      if (!id || !db.get(`SELECT id FROM ${table} WHERE id = ?`, [id])) throw badRequest(`Task target ${type} #${id ?? '?'} does not exist`);
    },
    _start(taskId, empId) {
      db.run(`UPDATE tasks SET status = 'in_progress', assignee_id = ?, started_at = ? WHERE id = ?`, [empId, nowIso(), taskId]);
      db.run(`UPDATE employees SET status = 'busy' WHERE id = ?`, [empId]);
    },
    _autoAssign(taskId) {
      const t = raw(taskId);
      const dept = TASK_DEPARTMENT[t.type];
      const emp = db.get(
        `SELECT e.id FROM employees e WHERE e.active = 1 AND e.status = 'available' AND e.department ${dept ? '= ?' : `NOT IN ('Management')`}
         ORDER BY COALESCE((SELECT MAX(completed_at) FROM tasks x WHERE x.assignee_id = e.id), '') ASC, e.id LIMIT 1`, dept ? [dept] : []);
      if (emp) svc._start(taskId, emp.id);
      return !!emp;
    },
    /** Creates a task (used by user requests and by business workflows). Assigns it automatically when nobody is chosen. */
    create(d, user) {
      const id = db.transaction(() => {
        svc._checkTarget(d.targetType ?? 'none', d.targetId);
        if (d.assigneeId) {
          const e = db.get('SELECT * FROM employees WHERE id = ? AND active = 1', [d.assigneeId]);
          if (!e) throw notFound('Employee');
        }
        const { lastId } = db.run(
          `INSERT INTO tasks(title,type,status,priority,assignee_id,target_type,target_id,reference_type,reference_id,notes,created_by,created_at,due_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [d.title, d.type ?? 'other', 'pending', d.priority ?? 'normal', d.assigneeId ?? null, d.targetType ?? 'none', d.targetId ?? null, d.referenceType ?? null, d.referenceId ?? null, d.notes ?? null, user?.id ?? null, nowIso(), d.dueAt ?? null]);
        if (d.assigneeId) {
          const e = db.get('SELECT status FROM employees WHERE id = ?', [d.assigneeId]);
          if (e.status === 'available') svc._start(lastId, d.assigneeId);
        } else svc._autoAssign(lastId);
        const t = raw(lastId);
        ctx.activity.log(user, 'task.created', 'task', lastId, `Task “${d.title}” created${t.assignee_id ? ' and assigned' : ' (waiting for a free worker)'}`);
        return lastId;
      });
      ctx.changed('tasks', 'employees');
      return svc.get(id);
    },
    update(id, d, user) {
      const t = raw(id); if (!t) throw notFound('Task');
      if (['done', 'cancelled'].includes(t.status)) throw conflict(`A ${t.status} task cannot be edited`);
      db.run('UPDATE tasks SET title=?, priority=?, notes=?, due_at=? WHERE id=?', [d.title ?? t.title, d.priority ?? t.priority, d.notes === undefined ? t.notes : d.notes, d.dueAt === undefined ? t.due_at : d.dueAt, id]);
      ctx.activity.log(user, 'task.updated', 'task', id, `Task “${d.title ?? t.title}” updated`);
      ctx.changed('tasks');
      return svc.get(id);
    },
    assign(id, employeeId, user) {
      db.transaction(() => {
        const t = raw(id); if (!t) throw notFound('Task');
        if (t.status !== 'pending') throw conflict('Only pending tasks can be (re)assigned');
        const e = db.get('SELECT * FROM employees WHERE id = ? AND active = 1', [employeeId]);
        if (!e) throw notFound('Employee');
        if (e.status === 'off_duty') throw conflict(`${e.name} is off duty`);
        db.run('UPDATE tasks SET assignee_id = ? WHERE id = ?', [employeeId, id]);
        if (e.status === 'available') svc._start(id, employeeId);
        ctx.activity.log(user, 'task.assigned', 'task', id, `Task “${t.title}” assigned to ${e.name}`);
      });
      ctx.changed('tasks', 'employees');
      return svc.get(id);
    },
    start(id, user) {
      db.transaction(() => {
        const t = raw(id); if (!t) throw notFound('Task');
        if (t.status !== 'pending') throw conflict('Only pending tasks can be started');
        if (!t.assignee_id) throw conflict('Assign the task to an employee first');
        const e = db.get('SELECT * FROM employees WHERE id = ?', [t.assignee_id]);
        if (e.status !== 'available') throw conflict(`${e.name} is ${e.status.replace('_', ' ')} and cannot start a task right now`);
        svc._start(id, e.id);
        ctx.activity.log(user, 'task.started', 'task', id, `${e.name} started “${t.title}”`);
      });
      ctx.changed('tasks', 'employees');
      return svc.get(id);
    },
    _finish(id, status, user, verb) {
      const t = raw(id); if (!t) throw notFound('Task');
      if (!['pending', 'in_progress'].includes(t.status)) throw conflict(`Task is already ${t.status}`);
      if (status === 'done' && t.status !== 'in_progress') throw conflict('Only tasks in progress can be completed');
      db.run('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?', [status, nowIso(), id]);
      if (t.assignee_id && t.status === 'in_progress') svc._freeEmployee(t.assignee_id);
      ctx.activity.log(user, `task.${verb}`, 'task', id, `Task “${t.title}” ${verb}`);
    },
    complete(id, user) { db.transaction(() => svc._finish(id, 'done', user, 'completed')); ctx.changed('tasks', 'employees'); return svc.get(id); },
    cancel(id, user) { db.transaction(() => svc._finish(id, 'cancelled', user, 'cancelled')); ctx.changed('tasks', 'employees'); return svc.get(id); },
    _freeEmployee(empId) {
      const still = db.get(`SELECT COUNT(*) c FROM tasks WHERE assignee_id = ? AND status = 'in_progress'`, [empId]).c;
      if (still === 0) { db.run(`UPDATE employees SET status = 'available' WHERE id = ? AND status = 'busy'`, [empId]); svc.pickNext(empId); }
    },
    /** A free employee takes the most urgent waiting task assigned to them or open for their department. */
    pickNext(empId) {
      const e = db.get('SELECT * FROM employees WHERE id = ?', [empId]);
      if (!e || !e.active || e.status !== 'available') return false;
      const types = typesFor(e.department);
      const t = db.get(
        `SELECT id FROM tasks WHERE status = 'pending' AND (assignee_id = ? ${types.length ? `OR (assignee_id IS NULL AND type IN (${types.map(() => '?').join(',')}))` : ''})
         ORDER BY (assignee_id = ?) DESC, ${priorityRank}, id LIMIT 1`, [empId, ...types, empId]);
      if (!t) return false;
      svc._start(t.id, empId);
      return true;
    },
    // ----- workflow helpers (called by other modules inside their transactions) -----
    createAuto(d) {
      svc._checkTarget(d.targetType ?? 'none', d.targetId);
      const { lastId } = db.run(
        `INSERT INTO tasks(title,type,status,priority,target_type,target_id,reference_type,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
        [d.title, d.type, 'pending', d.priority ?? 'normal', d.targetType ?? 'none', d.targetId ?? null, d.referenceType ?? null, d.referenceId ?? null, nowIso()]);
      svc._autoAssign(lastId);
      return lastId;
    },
    closeByReference(refType, refId, status = 'done', types = null) {
      const rows = db.all(`SELECT * FROM tasks WHERE reference_type = ? AND reference_id = ? AND status IN ('pending','in_progress') ${types ? `AND type IN (${types.map(() => '?').join(',')})` : ''}`, [refType, refId, ...(types || [])]);
      for (const t of rows) {
        db.run('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?', [status, nowIso(), t.id]);
        if (t.assignee_id && t.status === 'in_progress') svc._freeEmployee(t.assignee_id);
      }
    },
  };
  return svc;
}

export function registerRoutes(router, ctx) {
  const t = ctx.svc.tasks;
  const schema = {
    title: { type: 'string', required: true, minLength: 3, maxLength: 140 },
    type: { type: 'enum', values: TASK_TYPES }, priority: { type: 'enum', values: PRIORITIES },
    assigneeId: idRule({ nullable: true }), targetType: { type: 'enum', values: TASK_TARGETS }, targetId: idRule({ nullable: true }),
    notes: { type: 'string', maxLength: 1000, nullable: true }, dueAt: { type: 'date', nullable: true },
  };
  router.get('/api/tasks', { perm: 'tasks:read' }, (r) => {
    const { limit, offset } = pageParams(r.query, 200);
    const status = TASK_STATUSES.includes(r.query.status) ? r.query.status : null;
    const assigneeId = r.query.mine === 'true' ? (r.user.employeeId || -1) : Number(r.query.assigneeId) || null;
    return { items: t.list({ status, assigneeId, type: TASK_TYPES.includes(r.query.type) ? r.query.type : null, limit, offset }) };
  });
  router.post('/api/tasks', { perm: 'tasks:write' }, (r) => { r.setStatus(201); return t.create(validate(r.body, schema), r.user); });
  router.get('/api/tasks/:id', { perm: 'tasks:read' }, (r) => t.get(Number(r.params.id)));
  router.patch('/api/tasks/:id', { perm: 'tasks:write' }, (r) => t.update(Number(r.params.id), validate(r.body, schema, { partial: true }), r.user));
  router.post('/api/tasks/:id/assign', { perm: 'tasks:write' }, (r) => t.assign(Number(r.params.id), validate(r.body, { employeeId: idRule({ required: true }) }).employeeId, r.user));
  const own = (r) => { const task = t.get(Number(r.params.id)); if (!can(r.user.role, 'tasks:write') && task.assigneeId !== r.user.employeeId) throw forbidden('You can only update tasks assigned to you'); return task.id; };
  router.post('/api/tasks/:id/start', { perm: 'tasks:update_own' }, (r) => t.start(own(r), r.user));
  router.post('/api/tasks/:id/complete', { perm: 'tasks:update_own' }, (r) => t.complete(own(r), r.user));
  router.post('/api/tasks/:id/cancel', { perm: 'tasks:write' }, (r) => t.cancel(Number(r.params.id), r.user));
}
