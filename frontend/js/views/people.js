
import { h, fmt, mount, badge, table, formModal, toast, confirmDialog, modal } from '../ui/dom.js';
import { api } from '../api.js';
import { DEPARTMENTS, TASK_TYPES, PRIORITIES } from '/shared/constants.js';
import { pageHead, btn, tabs, load, attempt, canDo } from './common.js';

export async function render(root, app) {
  const manage = canDo(app, 'employees:write'); const tmanage = canDo(app, 'tasks:write');
  const myEmp = app.user.employeeId;
  const state = { tab: tmanage || manage ? 'employees' : 'tasks', tstatus: 'open', dept: '' };
  const content = h('div');

  const employeeForm = (e) => formModal({
    title: e ? `Edit ${e.name}` : 'Add employee', submitLabel: e ? 'Save' : 'Add employee', initial: e || {},
    fields: [{ name: 'name', label: 'Full name', required: true }, { name: 'department', label: 'Department', type: 'select', required: true, half: true, options: DEPARTMENTS.map((d) => ({ value: d, label: d })) }, { name: 'jobTitle', label: 'Job title', half: true, nullEmpty: true },
    { name: 'email', label: 'Email', type: 'email', half: true, nullEmpty: true }, { name: 'phone', label: 'Phone', half: true, nullEmpty: true }].concat(e ? [{ name: 'status', label: 'Availability', type: 'select', options: ['available', 'on_break', 'off_duty'].map((s) => ({ value: s, label: fmt.label(s) })), readonly: e.status === 'busy', help: e.status === 'busy' ? 'Busy employees are controlled by their active task.' : '' }] : []),
    onSubmit: async (v, m) => { e ? await api.patch(`/employees/${e.id}`, v) : await api.post('/employees', v); m.close(); toast(e ? 'Employee updated' : 'Employee added', '', 'success'); refresh(); }
  });

  async function taskForm() {
    const [emps, w] = await Promise.all([api.get('/employees'), api.get('/warehouse')]);
    const racks = w.sections.flatMap((s) => s.racks.map((r) => ({ value: `rack:${r.id}`, label: `Rack ${r.code}` })));
    const targets = [{ value: 'none:', label: 'No location' }, { value: 'office:', label: 'Office' }, ...w.docks.map((d) => ({ value: `dock:${d.id}`, label: `Dock ${d.number}` })), ...w.sections.map((s) => ({ value: `section:${s.id}`, label: `Section ${s.code}` })), ...racks];
    formModal({
      title: 'New task', submitLabel: 'Create task', fields: [
        { name: 'title', label: 'Title', required: true }, { name: 'type', label: 'Type', type: 'select', half: true, options: TASK_TYPES.map((t) => ({ value: t, label: fmt.label(t) })), value: 'picking' }, { name: 'priority', label: 'Priority', type: 'select', half: true, options: PRIORITIES.map((p) => ({ value: p, label: fmt.label(p) })), value: 'normal' },
        { name: 'target', label: 'Location (workers walk there in 3D)', type: 'select', options: targets }, { name: 'assigneeId', label: 'Assign to', type: 'select', numeric: true, nullEmpty: true, options: [{ value: '', label: 'Auto-assign to a free worker' }, ...emps.items.filter((x) => x.status !== 'off_duty').map((x) => ({ value: x.id, label: `${x.name} · ${x.department} · ${fmt.label(x.status)}` }))] },
        { name: 'notes', label: 'Notes', type: 'textarea', nullEmpty: true }],
      onSubmit: async (v, m) => { const [targetType, targetId] = (v.target || 'none:').split(':'); delete v.target; const t = await api.post('/tasks', { ...v, targetType, targetId: targetId ? Number(targetId) : null }); m.close(); toast('Task created', t.assigneeName ? `${t.assigneeName} ${t.status === 'in_progress' ? 'started it' : 'has it queued'}` : 'Waiting for a free worker', 'success'); refresh(); }
    });
  }
  async function assign(t) {
    const emps = (await api.get('/employees')).items.filter((e) => e.status !== 'off_duty');
    formModal({
      title: `Assign “${t.title}”`, submitLabel: 'Assign', fields: [{ name: 'employeeId', label: 'Employee', type: 'select', numeric: true, required: true, options: [{ value: '', label: 'Choose…' }, ...emps.map((e) => ({ value: e.id, label: `${e.name} · ${e.department} · ${fmt.label(e.status)}` }))] }],
      onSubmit: async (v, m) => { await api.post(`/tasks/${t.id}/assign`, v); m.close(); toast('Task assigned', '', 'success'); refresh(); }
    });
  }

  async function paintTab() {
    if (state.tab === 'employees') {
      const { items } = await api.get('/employees', { department: state.dept });
      return h('div', null, h('div', { class: 'toolbar' }, h('select', { onChange: (e) => { state.dept = e.target.value; refresh(); } }, h('option', { value: '' }, 'All departments'), DEPARTMENTS.map((d) => h('option', { value: d, selected: d === state.dept }, d)))),
        table({
          rows: items, empty: 'No employees', columns: [
            { label: 'ID', key: 'code', mono: true }, { label: 'Name', render: (e) => h('b', null, e.name) },
            { label: 'Site', render: (e) => e.code.startsWith('RIV-') ? h('span', { class: 'badge', style: { background: '#e0f2fe', color: '#0369a1' } }, 'Riverside Hub') : h('span', { class: 'badge' }, 'WareTrack') },
            { label: 'Department', key: 'department' }, { label: 'Role', render: (e) => e.jobTitle || '–' }, { label: 'Status', render: (e) => badge(e.status) },
            { label: 'Current task', render: (e) => e.task ? `${e.task.title}${e.task.targetLabel ? ` → ${e.task.targetLabel}` : ''}` : h('span', { class: 'muted' }, 'None') },
            manage && { label: '', actions: true, render: (e) => [btn('', () => employeeForm(e), { sm: true, ic: 'edit' }), btn('', async () => { if (await confirmDialog({ title: `Remove ${e.name}?`, message: 'Employees with task history are archived.', danger: true, confirmLabel: 'Remove' })) { const r = await attempt(() => api.del(`/employees/${e.id}`)); if (r) { toast(`Employee ${r.mode}`, '', 'success'); refresh(); } } }, { sm: true, kind: 'danger', ic: 'trash' })] }].filter(Boolean)
        }));
    }
    const params = { limit: 200, status: state.tstatus === 'open' ? undefined : state.tstatus === 'all' ? undefined : state.tstatus };
    if (!tmanage) params.mine = 'true';
    let { items } = await api.get('/tasks', params);
    if (state.tstatus === 'open') items = items.filter((t) => ['pending', 'in_progress'].includes(t.status));
    const ownsTask = (t) => tmanage || t.assigneeId === myEmp;
    return h('div', null, h('div', { class: 'chips', style: { marginBottom: '12px' } }, [['open', 'Open'], ['pending', 'Pending'], ['in_progress', 'In progress'], ['done', 'Done'], ['all', 'All']].map(([v, l]) => h('button', { class: `chip ${state.tstatus === v ? 'active' : ''}`, onClick: () => { state.tstatus = v; refresh(); } }, l))),
      table({
        rows: items, empty: { title: 'No tasks', hint: tmanage ? 'Tasks are also created automatically when orders are picked, trucks are loaded and shipments arrive.' : 'Nothing is assigned to you.' }, columns: [
          { label: 'Task', render: (t) => h('div', null, h('b', null, t.title), h('div', { class: 'muted' }, `${fmt.label(t.type)}${t.referenceType ? ` · ${t.referenceType} #${t.referenceId}` : ''}`)) }, { label: 'Location', render: (t) => t.targetLabel || '–' }, { label: 'Assignee', render: (t) => t.assigneeName || h('span', { class: 'muted' }, 'Unassigned') },
          { label: 'Priority', render: (t) => badge(t.priority) }, { label: 'Status', render: (t) => badge(t.status) }, { label: 'Created', render: (t) => fmt.ago(t.createdAt) },
          {
            label: '', actions: true, render: (t) => [
              t.status === 'pending' && t.assigneeId && ownsTask(t) && btn('Start', async () => { if (await attempt(() => api.post(`/tasks/${t.id}/start`), 'Task started')) refresh(); }, { sm: true }),
              t.status === 'in_progress' && ownsTask(t) && btn('Complete', async () => { if (await attempt(() => api.post(`/tasks/${t.id}/complete`), 'Task completed')) refresh(); }, { sm: true, kind: 'primary', ic: 'check' }),
              t.status === 'pending' && tmanage && btn('Assign', () => assign(t), { sm: true }), ['pending', 'in_progress'].includes(t.status) && tmanage && btn('Cancel', async () => { if (await attempt(() => api.post(`/tasks/${t.id}/cancel`), 'Task cancelled')) refresh(); }, { sm: true, kind: 'danger' })]
          }]
      }));
  }
  const refresh = async () => { try { mount(content, await paintTab()); } catch (e) { mount(content, h('div', { class: 'card empty' }, e.message)); } };
  const paintAll = () => mount(root, pageHead('Team & tasks', 'Workers in the 3D warehouse act out their assigned tasks', state.tab === 'employees' ? manage && btn('Add employee', () => employeeForm(null), { kind: 'primary', ic: 'plus' }) : tmanage && btn('New task', taskForm, { kind: 'primary', ic: 'plus' })),
    tabs([['employees', 'Employees'], ['tasks', tmanage ? 'Tasks' : 'My tasks']], state.tab, (t) => { state.tab = t; paintAll(); refresh(); }), h('div', { style: { height: '14px' } }), content);
  paintAll(); await load(content, paintTab); void modal;
  return { refresh };
}
