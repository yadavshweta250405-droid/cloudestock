import { h, fmt, mount, badge } from '../ui/dom.js';
import { api } from '../api.js';
import { lineChart, groupedBars, donut, hbars, PALETTE } from '../ui/charts.js';
import { pageHead, kpi, btn, load } from './common.js';

const STATUS_COLORS = { Pending: '#f59e0b', Processing: '#3b82f6', Packed: '#0d9488', 'Ready for Dispatch': '#6366f1', Dispatched: '#8b5cf6', Delivered: '#16a34a', Cancelled: '#ef4444' };

export async function render(root, app) {
  const body = h('div');
  async function paint() {
    const d = await api.get('/dashboard'); const k = d.kpis; const c = d.charts;
    return h('div', null,
      h('div', { class: 'kpis' },
        kpi('box', fmt.n(k.totalProducts), 'Total products'), kpi('layers', fmt.n(k.totalInventory), 'Units in inventory'), kpi('clipboard', fmt.n(k.totalOrders), 'Total orders'),
        kpi('clock', fmt.n(k.pendingOrders), 'Pending orders', k.pendingOrders ? 'warn' : ''), kpi('check', fmt.n(k.completedOrders), 'Completed orders', 'good'),
        kpi('truck', fmt.n(k.activeDeliveries), 'Active deliveries'), kpi('truck', `${k.availableVehicles}/${k.totalVehicles}`, 'Vehicles available'), kpi('users', `${k.activeEmployees}/${k.totalEmployees}`, 'Employees on shift'),
        kpi('building', fmt.pct(k.warehouseUtilization, 1), `Utilization · ${fmt.n(k.warehouseOccupied)} / ${fmt.n(k.warehouseCapacity)}`, k.warehouseUtilization > 0.85 ? 'warn' : ''),
        kpi('alert', fmt.n(k.lowStockProducts), 'Low / out of stock', k.lowStockProducts ? 'bad' : 'good'), kpi('inbox', fmt.n(k.incomingShipments), 'Incoming shipments'), kpi('truck', fmt.n(k.outgoingShipments), 'Outgoing shipments (orders)'),
        kpi('percent', k.onTimeRate === null ? '–' : fmt.pct(k.onTimeRate, 1), 'On-time delivery (30d)', 'good')),
      h('div', { class: 'grid g2' },
        h('div', { class: 'card' }, h('h3', null, 'Inventory level', h('small', null, 'units, last 14 days')), lineChart({ labels: c.labels, series: [{ name: 'Stock on hand', color: '#2f5bd6', values: c.stockLevel }] })),
        h('div', { class: 'card' }, h('h3', null, 'Stock movements', h('small', null, 'inbound vs outbound units per day')), groupedBars({ labels: c.labels, series: [{ name: 'Inbound', color: '#0d9488', values: c.inbound }, { name: 'Outbound', color: '#2f5bd6', values: c.outbound }] })),
        h('div', { class: 'card' }, h('h3', null, 'Orders by status'), donut({ items: c.ordersByStatus.map((o) => ({ label: o.status, value: o.count, color: STATUS_COLORS[o.status] || '#94a3b8' })), center: { value: fmt.n(k.totalOrders), label: 'orders' } })),
        h('div', { class: 'card' }, h('h3', null, 'Storage utilization by section'), hbars({ items: c.sections.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.utilization, kind: s.utilization >= 0.97 ? 'bad' : s.utilization >= 0.85 ? 'warn' : '' })), format: (v, it) => { const s = c.sections.find((x) => it.label.startsWith(x.code + ' ')); return `${fmt.pct(v)} (${fmt.n(s.occupied)}/${fmt.n(s.capacity)})`; } })),
        h('div', { class: 'card' }, h('h3', null, 'Stock by category'), donut({ items: c.categoryStock.map((x, i) => ({ label: x.name, value: x.quantity, color: x.color || PALETTE[i % 8] })), center: { value: fmt.n(k.totalInventory), label: 'units' } })),
        h('div', { class: 'card' }, h('h3', null, 'Top shipped products', h('small', null, 'units, last 30 days')), c.topProducts.length ? hbars({ items: c.topProducts.map((p) => ({ label: p.name, value: p.quantity })) }) : h('div', { class: 'muted' }, 'No shipments yet')),
        h('div', { class: 'card' }, h('h3', null, 'Low stock alerts'), d.lowStock.length ? d.lowStock.map((p) => h('div', { class: 'list-row' }, h('div', null, h('b', null, p.name), h('div', { class: 'muted mono' }, p.sku)), h('div', { style: { textAlign: 'right' } }, h('b', null, `${fmt.n(p.onHand)} / ${p.reorderLevel}`), h('div', null, badge(p.status))))) : h('div', { class: 'muted' }, 'All products are above their reorder level.')),
        h('div', { class: 'card' }, h('h3', null, 'Recent activity'), d.recentActivity.map((a) => h('div', { class: 'list-row' }, h('span', null, a.message), h('span', { class: 'muted', style: { whiteSpace: 'nowrap', fontSize: '12px' } }, fmt.ago(a.createdAt)))))));
  }
  mount(root, pageHead('Analytics', 'Every number is calculated from the database in real time', btn('Refresh', () => load(body, paint), { ic: 'refresh' })), body);
  await load(body, paint);
  return { refresh: () => paint().then((n) => mount(body, n)).catch(() => {}) };
}
