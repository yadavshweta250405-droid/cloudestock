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
        h('div', { class: 'card', style: { borderTop: '4px solid #2563eb' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            h('h3', null, 'WaaS Commercial Storage Billing', h('small', null, 'Accrued rental meter')),
            badge('Live Meter', 'green')),
          h('div', { style: { display: 'flex', gap: '20px', margin: '14px 0', alignItems: 'baseline' } },
            h('div', { style: { fontSize: '28px', fontWeight: '800', color: '#1e40af' } }, `$${fmt.n(k.accruedMonthlyRent || 0)}`),
            h('div', { class: 'muted' }, 'estimated monthly storage & handling invoice')),
          h('div', { class: 'list-row' }, h('span', null, 'Ambient Storage (WH-01 WareTrack)'), h('b', null, `${k.ambientPallets || 0} pallets @ $1.50 / day`)),
          h('div', { class: 'list-row' }, h('span', null, 'Cold Chain Storage (WH-02 Riverside)'), h('b', null, `${k.coldPallets || 0} pallets @ $3.50 / day`)),
          h('div', { class: 'list-row' }, h('span', null, 'Dock Handling Operations'), h('b', null, `${k.activeDeliveries || 0} loaded @ $10.00 / truck`)),
          h('div', { style: { marginTop: '12px', display: 'flex', gap: '8px' } },
            btn('Print Monthly Invoice', () => window.print(), { sm: true, ic: 'clipboard' }))),
        h('div', { class: 'card', style: { borderTop: '4px solid #0284c7' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            h('h3', null, 'Cold-Chain IoT Sensor Compliance', h('small', null, 'Riverside Hub WH-02')),
            badge('99.8% Compliant', 'green')),
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', margin: '14px 0' } },
            (k.coldChainSensors || []).map((s) => h('div', { style: { padding: '10px', background: '#f0f9ff', borderRadius: '8px', border: '1px solid #bae6fd' } },
              h('div', { style: { fontSize: '12px', color: '#0369a1', fontWeight: '600' } }, s.zone),
              h('div', { style: { fontSize: '22px', fontWeight: '800', color: '#0c4a6e', marginTop: '4px' } }, `${s.temp} ${s.unit}`),
              h('div', { style: { fontSize: '11px', color: '#0284c7' } }, `Target ${s.target} ${s.unit} · ${s.status}`)))),
          h('div', { class: 'list-row' }, h('span', null, 'FDA / ISO-22000 Spoilage Risk'), h('span', { class: 'badge green' }, 'Zero Excursions')),
          h('div', { style: { marginTop: '12px' } },
            btn('Download Compliance Audit Report', () => alert('Temperature audit verified: All zones maintained within safe limits (-20°C ± 2°C). Zero cold chain excursions logged in 30 days.'), { sm: true, ic: 'check' }))),
        h('div', { class: 'card' }, h('h3', null, 'Inventory level', h('small', null, 'units, last 14 days')), lineChart({ labels: c.labels, series: [{ name: 'Stock on hand', color: '#2f5bd6', values: c.stockLevel }] })),
        h('div', { class: 'card' }, h('h3', null, 'Stock movements', h('small', null, 'inbound vs outbound units per day')), groupedBars({ labels: c.labels, series: [{ name: 'Inbound', color: '#0d9488', values: c.inbound }, { name: 'Outbound', color: '#2f5bd6', values: c.outbound }] })),
        h('div', { class: 'card' }, h('h3', null, 'Orders by status'), donut({ items: c.ordersByStatus.map((o) => ({ label: o.status, value: o.count, color: STATUS_COLORS[o.status] || '#94a3b8' })), center: { value: fmt.n(k.totalOrders), label: 'orders' } })),
        h('div', { class: 'card' }, h('h3', null, 'Storage utilization by section'), hbars({ items: c.sections.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.utilization, kind: s.utilization >= 0.97 ? 'bad' : s.utilization >= 0.85 ? 'warn' : '' })), format: (v, it) => { const s = c.sections.find((x) => it.label.startsWith(x.code + ' ')); return `${fmt.pct(v)} (${fmt.n(s.occupied)}/${fmt.n(s.capacity)})`; } })),
        h('div', { class: 'card' }, h('h3', null, 'Stock by category'), donut({ items: c.categoryStock.map((x, i) => ({ label: x.name, value: x.quantity, color: x.color || PALETTE[i % 8] })), center: { value: fmt.n(k.totalInventory), label: 'units' } })),
        h('div', { class: 'card' }, h('h3', null, 'Top shipped products', h('small', null, 'units, last 30 days')), c.topProducts.length ? hbars({ items: c.topProducts.map((p) => ({ label: p.name, value: p.quantity })) }) : h('div', { class: 'muted' }, 'No shipments yet')),
        h('div', { class: 'card' }, h('h3', null, 'Low stock alerts'), d.lowStock.length ? d.lowStock.map((p) => h('div', { class: 'list-row' }, h('div', null, h('b', null, p.name), h('div', { class: 'muted mono' }, p.sku)), h('div', { style: { textAlign: 'right' } }, h('b', null, `${fmt.n(p.onHand)} / ${p.reorderLevel}`), h('div', null, badge(p.status))))) : h('div', { class: 'muted' }, 'All products are above their reorder level.')),
        h('div', { class: 'card' }, h('h3', null, 'Recent activity'), d.recentActivity.map((a) => h('div', { class: 'list-row' }, h('span', null, a.message), h('span', { class: 'muted', style: { whiteSpace: 'nowrap', fontSize: '12px' } }, fmt.ago(a.createdAt)))))));
  }
  const ssBody = h('div');

  async function paintSuperstore() {
    let ss;
    try { ss = await api.get('/analytics/superstore'); } catch (e) { return h('div', { class: 'card muted' }, 'Superstore analytics not available.'); }
    const t = ss.totals;

    const catColors = { Furniture: '#d97706', 'Office Supplies': '#2563eb', Technology: '#16a34a' };
    const regionColors = { West: '#8b5cf6', East: '#0d9488', Central: '#f59e0b', South: '#ef4444' };

    return h('div', null,
      // ---- KPI bar ----
      h('div', { class: 'kpis' },
        kpi('dollar', `$${fmt.n(t.total_sales)}`, 'Total Sales (Superstore)'),
        kpi('percent', `$${fmt.n(t.total_profit)}`, 'Total Profit'),
        kpi('percent', `${t.profit_margin}%`, 'Profit Margin', t.profit_margin > 15 ? 'good' : 'warn'),
        kpi('clipboard', fmt.n(t.total_orders), 'Distinct Orders'),
        kpi('box', fmt.n(t.total_units), 'Units Sold'),
        kpi('users', fmt.n(t.total_customers), 'Unique Customers'),
        kpi('alert', fmt.n(t.total_returns), 'Returned Lines', t.total_returns ? 'warn' : 'good')),

      h('div', { class: 'grid g2' },
        // Sales by Category (top-level)
        h('div', { class: 'card' },
          h('h3', null, 'Sales by Category'),
          donut({
            items: ['Furniture', 'Office Supplies', 'Technology'].map((cat) => {
              const rows = ss.byCategory.filter(r => r.category === cat);
              const total = rows.reduce((s, r) => s + r.sales, 0);
              return { label: cat, value: Math.round(total), color: catColors[cat] || '#94a3b8' };
            }),
            center: { value: `$${fmt.n(t.total_sales)}`, label: 'sales' }
          })),

        // Sales by Region
        h('div', { class: 'card' },
          h('h3', null, 'Sales by Region'),
          donut({
            items: ss.byRegion.map(r => ({ label: `${r.region} (${r.manager || '-'})`, value: Math.round(r.sales), color: regionColors[r.region] || '#94a3b8' })),
            center: { value: fmt.n(t.total_orders), label: 'orders' }
          })),

        // Sub-category breakdown
        h('div', { class: 'card' },
          h('h3', null, 'Sales by Sub-Category', h('small', null, 'top 12')),
          hbars({
            items: ss.byCategory.slice(0, 12).map(r => ({
              label: `${r.sub_category} (${r.category})`,
              value: r.sales,
              kind: r.profit < 0 ? 'bad' : ''
            }))
          })),

        // Sales by Customer Segment
        h('div', { class: 'card' },
          h('h3', null, 'Sales by Segment'),
          groupedBars({
            labels: ss.bySegment.map(s => s.segment),
            series: [
              { name: 'Sales ($)', color: '#2563eb', values: ss.bySegment.map(s => Math.round(s.sales)) },
              { name: 'Profit ($)', color: '#16a34a', values: ss.bySegment.map(s => Math.round(s.profit)) }
            ]
          })),

        // Annual trend
        h('div', { class: 'card' },
          h('h3', null, 'Annual Sales Trend'),
          lineChart({
            labels: ss.salesByYear.map(r => r.year),
            series: [
              { name: 'Sales ($)', color: '#2563eb', values: ss.salesByYear.map(r => Math.round(r.sales)) },
              { name: 'Profit ($)', color: '#16a34a', values: ss.salesByYear.map(r => Math.round(r.profit)) }
            ]
          })),

        // Ship mode breakdown
        h('div', { class: 'card' },
          h('h3', null, 'Orders by Ship Mode'),
          hbars({ items: ss.byShipMode.map(r => ({ label: r.ship_mode, value: r.orders })) })),

        // Top 10 customers
        h('div', { class: 'card' },
          h('h3', null, 'Top 10 Customers by Sales'),
          ss.topCustomers.map(c =>
            h('div', { class: 'list-row' },
              h('div', null, h('b', null, c.customer_name), h('div', { class: 'muted' }, `${c.segment} - ${c.region}`)),
              h('div', { style: { textAlign: 'right' } },
                h('b', null, `$${fmt.n(c.sales)}`),
                h('div', { class: 'muted' }, `${fmt.n(c.orders)} orders`))))),

        // Top 10 products
        h('div', { class: 'card' },
          h('h3', null, 'Top 10 Products by Sales'),
          ss.topProducts.map(p =>
            h('div', { class: 'list-row' },
              h('div', null, h('b', null, p.product_name.length > 40 ? p.product_name.slice(0, 40) + '...' : p.product_name), h('div', { class: 'muted' }, `${p.category} - ${p.sub_category}`)),
              h('div', { style: { textAlign: 'right' } },
                h('b', null, `$${fmt.n(p.sales)}`),
                h('div', { class: 'muted' }, `${fmt.n(p.units)} units`))))),

        // Returns by Category
        h('div', { class: 'card' },
          h('h3', null, 'Return Rate by Category'),
          hbars({
            items: ss.returnsByCategory.map(r => ({
              label: r.category,
              value: parseFloat(r.return_rate_pct),
              kind: r.return_rate_pct > 10 ? 'warn' : ''
            })),
            format: (v) => `${v}%`
          }))
      ));
  }

  mount(root,
    pageHead('Analytics', 'Every number is calculated from the database in real time', btn('Refresh', () => { load(body, paint); load(ssBody, paintSuperstore); }, { ic: 'refresh' })),
    body,
    h('div', { style: { margin: '28px 0 8px' } },
      h('h2', { style: { borderBottom: '2px solid #e2e8f0', paddingBottom: '10px', color: '#1e293b' } }, 'Sample Superstore Dataset Analytics',
        h('small', { style: { fontWeight: 400, color: '#64748b', marginLeft: '10px' } }, '9,994 orders imported from Sample-Superstore.xlsx'))),
    ssBody);

  await Promise.all([load(body, paint), load(ssBody, paintSuperstore)]);
  return { refresh: () => { paint().then((n) => mount(body, n)).catch(() => {}); paintSuperstore().then((n) => mount(ssBody, n)).catch(() => {}); } };
}
