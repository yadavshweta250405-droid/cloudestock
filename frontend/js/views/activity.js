import { h, fmt, mount, badge, table } from '../ui/dom.js';
import { api } from '../api.js';
import { pageHead, btn, tabs, load, canDo } from './common.js';

export async function render(root, app) {
  const state = { tab: canDo(app, 'activity:read') ? 'activity' : 'notifications' };
  const content = h('div');
  async function paint() {
    if (state.tab === 'activity') {
      const { items } = await api.get('/activity', { limit: 200 });
      return table({ rows: items, empty: 'No activity yet', columns: [{ label: 'When', render: (a) => fmt.dt(a.createdAt) }, { label: 'User', key: 'userName' }, { label: 'Action', render: (a) => h('span', { class: 'mono' }, a.action) }, { label: 'Details', key: 'message' }] });
    }
    const r = await api.get('/notifications', { limit: 100 });
    return table({ rows: r.items, empty: 'No notifications', columns: [{ label: 'When', render: (n) => fmt.dt(n.created_at) }, { label: 'Level', render: (n) => badge(n.level) }, { label: 'Title', render: (n) => h('b', null, n.title) }, { label: 'Message', key: 'message' }, { label: '', render: (n) => (n.is_read ? '' : badge('new', 'blue')) }] });
  }
  const refresh = async () => { try { mount(content, await paint()); } catch (e) { mount(content, h('div', { class: 'card empty' }, e.message)); } };
  const items = [canDo(app, 'activity:read') && ['activity', 'Activity log'], ['notifications', 'Notifications']].filter(Boolean);
  mount(root, pageHead('Activity & alerts', 'Audit trail of every change and system notifications', btn('Mark notifications read', async () => { await api.post('/notifications/read', {}); refresh(); }, { ic: 'check' })), tabs(items, state.tab, (t) => { state.tab = t; refresh(); }), h('div', { style: { height: '14px' } }), content);
  await load(content, paint);
  return { refresh };
}
