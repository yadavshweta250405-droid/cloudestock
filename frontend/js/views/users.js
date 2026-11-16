import { h, fmt, mount, badge, table, formModal, toast } from '../ui/dom.js';
import { api } from '../api.js';
import { ROLES, ROLE_LABELS } from '/shared/constants.js';
import { pageHead, btn, load, attempt } from './common.js';

export async function render(root, app) {
  const content = h('div');
  const form = async (u) => {
    const emps = (await api.get('/employees')).items;
    formModal({ title: u ? `Edit ${u.name}` : 'New user', submitLabel: u ? 'Save' : 'Create user', initial: u || {},
      fields: [{ name: 'name', label: 'Name', required: true, half: true }, { name: 'email', label: 'Email', type: 'email', required: true, half: true },
        { name: 'role', label: 'Role', type: 'select', required: true, half: true, options: Object.values(ROLES).map((r) => ({ value: r, label: ROLE_LABELS[r] })) }, { name: 'employeeId', label: 'Linked employee', type: 'select', numeric: true, nullEmpty: true, half: true, options: [{ value: '', label: 'None' }, ...emps.map((e) => ({ value: e.id, label: `${e.code} · ${e.name}` }))], help: 'Needed for employees to work on their own tasks.' },
        { name: 'password', label: u ? 'New password (leave empty to keep)' : 'Password', type: 'password', required: !u, help: 'At least 8 characters with a letter and a number.' }].concat(u ? [{ name: 'active', label: 'Account active', type: 'checkbox' }] : []),
      onSubmit: async (v, m) => { if (u && !v.password) delete v.password; u ? await api.patch(`/users/${u.id}`, v) : await api.post('/users', v); m.close(); toast(u ? 'User updated' : 'User created', '', 'success'); refresh(); } });
  };
  const paint = async () => table({ rows: (await api.get('/users')).items, columns: [{ label: 'Name', render: (u) => h('b', null, u.name) }, { label: 'Email', key: 'email' }, { label: 'Role', render: (u) => badge(ROLE_LABELS[u.role], 'blue') }, { label: 'Status', render: (u) => badge(u.active ? 'active' : 'disabled', u.active ? 'green' : 'red') }, { label: 'Last sign-in', render: (u) => fmt.ago(u.lastLoginAt) },
    { label: '', actions: true, render: (u) => btn('Edit', () => form(u), { sm: true, ic: 'edit' }) }] });
  const refresh = async () => { try { mount(content, await paint()); } catch (e) { mount(content, h('div', { class: 'card empty' }, e.message)); } };
  mount(root, pageHead('Users & roles', 'Administrators, managers and employees', btn('New user', () => form(null), { kind: 'primary', ic: 'plus' })), content);
  await load(content, paint); void attempt;
  return { refresh };
}
