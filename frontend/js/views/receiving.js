import { h, fmt, mount, badge, table, formModal, toast, confirmDialog, modal, dl } from '../ui/dom.js';
import { api } from '../api.js';
import { pageHead, btn, load, attempt, canDo, productOptions, rackOptions } from './common.js';

export async function render(root, app) {
  const write = canDo(app, 'receiving:write');
  const content = h('div');

  async function newShipment() {
    const prods = await productOptions(); const lines = [{ productId: '', quantity: 10 }]; const list = h('div');
    const paint = () => mount(list, lines.map((l, i) => h('div', { class: 'toolbar', style: { flexWrap: 'nowrap', marginBottom: '6px' } },
      h('select', { style: { flex: 1, minWidth: 0 }, onChange: (e) => { l.productId = Number(e.target.value) || ''; } }, h('option', { value: '' }, 'Choose product…'), prods.map((p) => h('option', { value: p.value, selected: p.value === l.productId }, p.label))),
      h('input', { type: 'number', min: 1, value: l.quantity, style: { width: '90px' }, onInput: (e) => { l.quantity = Number(e.target.value); } }), btn('', () => { lines.splice(i, 1); if (!lines.length) lines.push({ productId: '', quantity: 10 }); paint(); }, { sm: true, ic: 'x' }))));
    paint();
    formModal({ title: 'Schedule inbound shipment', submitLabel: 'Schedule', wide: true, fields: [{ name: 'supplier', label: 'Supplier', required: true, half: true }, { name: 'expectedAt', label: 'Expected', type: 'datetime-local', half: true, nullEmpty: true }, { name: 'notes', label: 'Notes', nullEmpty: true }],
      extra: h('div', null, h('div', { class: 'field' }, h('label', null, 'Expected goods *')), list, btn('Add line', () => { lines.push({ productId: '', quantity: 10 }); paint(); }, { sm: true, ic: 'plus' })),
      onSubmit: async (v, m) => { const items = lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, quantity: l.quantity })); if (!items.length) throw new Error('Add at least one product line');
        const s = await api.post('/shipments', { ...v, expectedAt: v.expectedAt ? new Date(v.expectedAt).toISOString() : null, items }); m.close(); toast(`${s.ref} scheduled`, '', 'success'); refresh(); } });
  }
  async function receiveModal(s) {
    const racks = await rackOptions();
    const rows = s.items.filter((i) => i.quantity > i.receivedQuantity);
    const state = rows.map((i) => ({ itemId: i.id, quantity: i.quantity - i.receivedQuantity, rackId: '' }));
    const m = modal({ title: `Receive ${s.ref}`, wide: true, body: h('div', null, h('div', { class: 'muted', style: { marginBottom: '10px' } }, 'Choose the quantity and rack for each line. Leave the rack on “Auto” to use the suggested putaway location.'),
      table({ rows: rows.map((r, i) => ({ r, i })), columns: [{ label: 'Product', render: ({ r }) => `${r.sku} · ${r.name}` }, { label: 'Outstanding', num: true, render: ({ r }) => fmt.n(r.quantity - r.receivedQuantity) },
        { label: 'Receive now', render: ({ i, r }) => h('input', { type: 'number', min: 0, max: r.quantity - r.receivedQuantity, value: state[i].quantity, style: { width: '90px' }, onInput: (e) => { state[i].quantity = Number(e.target.value); } }) },
        { label: 'Rack', render: ({ i }) => h('select', { onChange: (e) => { state[i].rackId = Number(e.target.value) || ''; } }, h('option', { value: '' }, 'Auto'), racks.map((r) => h('option', { value: r.value }, r.label))) }] })), actions: [] });
    m.setActions([btn('Cancel', () => m.close()), btn('Book into stock', async () => {
      const lines = state.filter((l) => l.quantity > 0).map((l) => ({ itemId: l.itemId, quantity: l.quantity, rackId: l.rackId || null }));
      if (!lines.length) return toast('Nothing to receive', 'Enter a quantity above zero.', 'warning');
      if (await attempt(() => api.post(`/shipments/${s.id}/receive`, { lines }), 'Goods received')) { m.close(); refresh(); } }, { kind: 'primary', ic: 'check' })]);
  }
  async function detail(id) {
    const s = await api.get(`/shipments/${id}`);
    modal({ title: `${s.ref} · ${s.supplier}`, wide: true, body: h('div', null, dl([['Status', badge(s.status)], ['Dock', s.dockNumber ? `Dock ${s.dockNumber}` : '–'], ['Expected', fmt.dt(s.expectedAt)], ['Arrived', fmt.dt(s.arrivedAt)], ['Received', fmt.dt(s.receivedAt)], ['Notes', s.notes || '–']]),
      h('h3', { style: { margin: '16px 0 8px' } }, 'Lines'), table({ rows: s.items, columns: [{ label: 'SKU', key: 'sku', mono: true }, { label: 'Product', key: 'name' }, { label: 'Expected', num: true, render: (i) => fmt.n(i.quantity) }, { label: 'Received', num: true, render: (i) => fmt.n(i.receivedQuantity) }, { label: 'Batch', render: (i) => i.batchNo || '–' }] })), actions: [] });
  }
  async function paint() {
    const { items } = await api.get('/shipments');
    return table({ rows: items, empty: { title: 'No inbound shipments', hint: 'Schedule one when a supplier delivery is expected.' }, onRow: (s) => detail(s.id), columns: [
      { label: 'Shipment', render: (s) => h('b', null, s.ref) }, { label: 'Supplier', key: 'supplier' }, { label: 'Lines', num: true, render: (s) => s.itemCount }, { label: 'Units', num: true, render: (s) => `${fmt.n(s.receivedUnits)} / ${fmt.n(s.unitCount)}` },
      { label: 'Dock', render: (s) => s.dockNumber ? `Dock ${s.dockNumber}` : '–' }, { label: 'Expected', render: (s) => fmt.dt(s.expectedAt) }, { label: 'Status', render: (s) => badge(s.status) },
      write && { label: '', actions: true, render: (s) => [
        s.status === 'Scheduled' && btn('Arrived at dock', async () => { if (await attempt(() => api.post(`/shipments/${s.id}/arrive`), 'Truck docked')) refresh(); }, { sm: true, kind: 'primary', ic: 'truck' }),
        ['Arrived', 'Unloading'].includes(s.status) && btn('Receive goods', async () => receiveModal(await api.get(`/shipments/${s.id}`)), { sm: true, kind: 'primary', ic: 'inbox' }),
        ['Arrived', 'Unloading'].includes(s.status) && btn('Receive all', async () => { if (await attempt(() => api.post(`/shipments/${s.id}/receive`, {}), 'Shipment received')) refresh(); }, { sm: true }),
        ['Scheduled', 'Arrived'].includes(s.status) && btn('Cancel', async () => { if (await confirmDialog({ title: `Cancel ${s.ref}?`, message: 'The dock will be released.', danger: true, confirmLabel: 'Cancel shipment' })) { if (await attempt(() => api.post(`/shipments/${s.id}/cancel`), 'Shipment cancelled')) refresh(); } }, { sm: true, kind: 'danger' })] }].filter(Boolean) });
  }
  const refresh = async () => { try { mount(content, await paint()); } catch (e) { mount(content, h('div', { class: 'card empty' }, e.message)); } };
  mount(root, pageHead('Inbound shipments', 'Schedule suppliers, dock trucks and book goods into racks', write && btn('Schedule shipment', newShipment, { kind: 'primary', ic: 'plus' })), content);
  await load(content, paint);
  return { refresh, open: (id) => detail(id) };
}
