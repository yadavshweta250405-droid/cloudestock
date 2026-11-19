import { h, fmt, mount, badge, table, formModal, modal, toast, toastError, dl, debounce, confirmDialog, icon } from '../ui/dom.js';
import { api } from '../api.js';
import { ORDER_STATUSES } from '/shared/constants.js';
import { pageHead, btn, load, attempt, canDo, productOptions } from './common.js';

const FLOW = ['Pending', 'Processing', 'Packed', 'Ready for Dispatch', 'Dispatched', 'Delivered'];

export async function render(root, app) {
  const write = canDo(app, 'orders:write'); const fleet = canDo(app, 'deliveries:write');
  const state = { status: '', q: '' };
  const content = h('div');

  async function orderForm(existing) {
    const prods = await productOptions();
    const items = (existing?.items || [{ productId: '', quantity: 1 }]).map((i) => ({ productId: i.productId, quantity: i.quantity }));
    const list = h('div');
    const paintItems = () => mount(list, items.map((it, i) => {
      const sel = h('select', { style: { flex: 1, minWidth: 0 }, onChange: (e) => { it.productId = Number(e.target.value) || ''; paintItems(); } },
        h('option', { value: '' }, 'Choose product…'), prods.map((p) => h('option', { value: p.value, selected: p.value === it.productId }, `${p.product.sku} · ${p.product.name} (${p.product.available} avail.)`)));
      const qty = h('input', { type: 'number', min: 1, value: it.quantity, style: { width: '90px' }, 'aria-label': 'Quantity', onInput: (e) => { it.quantity = Number(e.target.value); } });
      return h('div', { class: 'toolbar', style: { marginBottom: '6px', flexWrap: 'nowrap' } }, sel, qty, btn('', () => { items.splice(i, 1); if (!items.length) items.push({ productId: '', quantity: 1 }); paintItems(); }, { sm: true, ic: 'x', title: 'Remove line' }));
    }));
    paintItems();
    const m = formModal({ title: existing ? `Edit ${existing.number}` : 'New order', submitLabel: existing ? 'Save order' : 'Create order & reserve stock', wide: true, initial: existing || {},
      fields: [
        { name: 'customerName', label: 'Customer', required: true, half: true }, { name: 'city', label: 'City', required: true, half: true },
        { name: 'deliveryAddress', label: 'Delivery address', required: true }, { name: 'customerEmail', label: 'Email', type: 'email', half: true, nullEmpty: true }, { name: 'customerPhone', label: 'Phone', half: true, nullEmpty: true },
        { name: 'priority', label: 'Priority', type: 'select', half: true, options: ['normal', 'low', 'high', 'urgent'].map((v) => ({ value: v, label: fmt.label(v) })), value: 'normal' }, { name: 'notes', label: 'Notes', half: true, nullEmpty: true }],
      extra: h('div', null, h('div', { class: 'field' }, h('label', null, 'Items *'), h('div', { class: 'help' }, 'Stock is reserved on creation. Duplicate products are merged.')), list, btn('Add line', () => { items.push({ productId: '', quantity: 1 }); paintItems(); }, { sm: true, ic: 'plus' })),
      onSubmit: async (v, mm) => {
        const lines = items.filter((i) => i.productId);
        if (!lines.length) { const e = new Error('Add at least one product line'); throw e; }
        const payload = { ...v, items: lines.map((i) => ({ productId: i.productId, quantity: i.quantity })) };
        const o = existing ? await api.put(`/orders/${existing.id}`, payload) : await api.post('/orders', payload);
        mm.close(); toast(existing ? 'Order updated' : `Order ${o.number} created`, 'Stock reserved', 'success'); refresh(); } });
    return m;
  }

  async function detail(id) {
    const m = modal({ title: 'Order', wide: true, body: h('div', null, h('div', { class: 'spinner' })), actions: [] });
    const paint = async () => {
      let o; try { o = await api.get(`/orders/${id}`); } catch (e) { m.close(); return toastError(e); }
      const flowIdx = FLOW.indexOf(o.status);
      const steps = h('div', { class: 'steps', style: { margin: '6px 0 16px' } }, FLOW.map((s, i) => h('div', { class: `step ${o.status === 'Cancelled' ? '' : i < flowIdx ? 'done' : i === flowIdx ? 'cur' : ''}` }, h('i', null, i < flowIdx ? icon('check') : i + 1), s)));
      const act = [];
      if (write) for (const next of o.nextStatuses) {
        if (next === 'Dispatched') continue;
        if (next === 'Cancelled') act.push(btn('Cancel order', async () => { if (await confirmDialog({ title: `Cancel ${o.number}?`, message: 'Reserved stock will be released.', confirmLabel: 'Cancel order', danger: true })) { await attempt(() => api.post(`/orders/${id}/status`, { status: next }), 'Order cancelled'); paint(); refresh(); } }, { kind: 'danger' }));
        else if (next === 'Delivered') act.push(btn('Mark delivered', async () => { await attempt(() => api.post(`/orders/${id}/status`, { status: next }), 'Order delivered'); paint(); refresh(); }, { kind: 'primary', ic: 'check' }));
        else act.push(btn(`Move to ${next}`, async () => { await attempt(() => api.post(`/orders/${id}/status`, { status: next }), `Order is now ${next}`); paint(); refresh(); }, { kind: 'primary', ic: 'arrow' }));
      }
      if (fleet && ['Packed', 'Ready for Dispatch'].includes(o.status) && !o.deliveryId) act.push(btn('Assign to vehicle', () => { m.close(); import('./deliveries.js').then((d) => d.newDeliveryModal(app, { orderIds: [o.id], onDone: refresh })); }, { kind: 'primary', ic: 'truck' }));
      if (fleet && o.status === 'Ready for Dispatch' && o.deliveryId) act.push(btn(`Dispatch ${o.deliveryCode}`, async () => { await attempt(() => api.post(`/orders/${id}/status`, { status: 'Dispatched' }), 'Vehicle dispatched'); paint(); refresh(); }, { kind: 'primary', ic: 'truck' }));
      if (write && o.status === 'Pending') act.unshift(btn('Edit', () => { m.close(); orderForm(o); }, { ic: 'edit' }));
      m.el.querySelector('h2').textContent = `${o.number} · ${o.customerName}`;
      m.setBody(steps, h('div', { class: 'grid g2' },
        h('div', null, dl([['Status', badge(o.status)], ['Priority', badge(o.priority)], ['Customer', o.customerName], ['Address', `${o.deliveryAddress}, ${o.city}`], ['Contact', [o.customerEmail, o.customerPhone].filter(Boolean).join(' · ') || '–'], ['Delivery', o.deliveryCode ? `${o.deliveryCode} (${o.vehicleCode}) · ${o.deliveryStatus}` : 'Not assigned'], ['Created', fmt.dt(o.createdAt)], ['Total', fmt.money(o.totalAmount)]])),
        h('div', null, h('b', null, 'History'), o.history.length ? o.history.map((x) => h('div', { class: 'list-row' }, h('span', null, x.message), h('span', { class: 'muted', style: { fontSize: '11.5px', whiteSpace: 'nowrap' } }, fmt.ago(x.createdAt)))) : h('div', { class: 'muted' }, 'No history'))),
      h('h3', { style: { margin: '16px 0 8px' } }, 'Items'),
      table({ rows: o.items, columns: [{ label: 'SKU', key: 'sku', mono: true }, { label: 'Product', key: 'name' }, { label: 'Qty', num: true, render: (i) => fmt.n(i.quantity) }, { label: 'Unit', num: true, render: (i) => fmt.money(i.unitPrice) }, { label: 'Line total', num: true, render: (i) => fmt.money(i.quantity * i.unitPrice) },
        { label: 'Reserved from', render: (i) => i.allocations.length ? i.allocations.map((a) => `${a.rackCode} ×${a.quantity}`).join(', ') : (['Dispatched', 'Delivered'].includes(o.status) ? 'Shipped' : '–') }] }));
      m.setActions([...act, btn('Close', () => m.close())]);
    };
    await paint();
  }

  async function paintList() {
    const { items, total } = await api.get('/orders', { status: state.status, q: state.q, limit: 200 });
    return h('div', null, h('div', { class: 'muted', style: { marginBottom: '8px' } }, `${total} order${total === 1 ? '' : 's'}`), table({ rows: items, empty: { title: 'No orders', hint: write ? 'Create one with “New order”.' : '' }, onRow: (o) => detail(o.id), columns: [
      { label: 'Order', render: (o) => h('b', null, o.number) }, { label: 'Customer', render: (o) => h('div', null, o.customerName, h('div', { class: 'muted' }, o.city)) }, { label: 'Items', num: true, render: (o) => `${o.itemCount} / ${fmt.n(o.unitCount)} units` },
      { label: 'Total', num: true, render: (o) => fmt.money(o.totalAmount) }, { label: 'Priority', render: (o) => badge(o.priority) }, { label: 'Status', render: (o) => badge(o.status) }, { label: 'Delivery', render: (o) => o.deliveryCode ? `${o.deliveryCode} · ${o.vehicleCode}` : '–' }, { label: 'Created', render: (o) => fmt.dt(o.createdAt) }] }));
  }
  const refresh = async () => { try { mount(content, await paintList()); } catch (e) { mount(content, h('div', { class: 'card empty' }, e.message)); } };
  const deb = debounce(refresh, 250);
  const chips = () => h('div', { class: 'chips' }, ['', ...ORDER_STATUSES].map((s) => h('button', { class: `chip ${state.status === s ? 'active' : ''}`, onClick: () => { state.status = s; mount(root, ...shell()); refresh(); } }, s || 'All')));
  const shell = () => [pageHead('Orders', 'Create, reserve, pack and ship customer orders', write && btn('New order', () => orderForm(), { kind: 'primary', ic: 'plus' })),
    h('div', { class: 'toolbar' }, h('input', { type: 'search', placeholder: 'Search order, customer, city…', value: state.q, onInput: (e) => { state.q = e.target.value; deb(); } }), chips()), content];
  mount(root, ...shell()); await load(content, paintList);
  return { refresh, open: (id) => detail(id) };
}
