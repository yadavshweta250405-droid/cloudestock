import { h, icon, toast, toastError, formModal, modal, fmt, badge, spinner, mount } from '../ui/dom.js';
import { api } from '../api.js';
import { can } from '/shared/constants.js';

export const canDo = (app, perm) => can(app.user.role, perm);
export function pageHead(title, sub, ...actions) {
  return h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub && h('div', { class: 'sub' }, sub)), h('div', { class: 'spacer' }), ...actions.filter(Boolean));
}
export const btn = (label, onClick, { kind = '', ic, sm = false, title } = {}) => h('button', { class: `btn ${kind} ${sm ? 'sm' : ''}`, onClick, title }, ic && icon(ic), label);
export function tabs(items, active, onChange) {
  const wrap = h('div', { class: 'tabs', role: 'tablist' });
  const paint = (a) => mount(wrap, items.map(([id, label]) => h('button', { role: 'tab', class: id === a ? 'active' : '', onClick: () => { paint(id); onChange(id); } }, label)));
  paint(active); return wrap;
}
/** Wraps an async action with error toasts + optional success toast. Returns the result or undefined on failure. */
export async function attempt(fn, success) {
  try { const r = await fn(); if (success) toast(success, '', 'success'); return r; } catch (e) { toastError(e); return undefined; }
}
/** Renders async content into a container with a spinner and an error state. */
export async function load(container, fn) {
  mount(container, spinner());
  try { const node = await fn(); mount(container, node); } catch (e) { mount(container, h('div', { class: 'card empty' }, h('b', null, 'Could not load this view'), e.message, h('div', { style: { marginTop: '10px' } }, btn('Retry', () => load(container, fn), { ic: 'refresh' })))); }
}
export const kpi = (ic, value, label, kind = '') => h('div', { class: `kpi ${kind}` }, h('div', { class: 'ic' }, icon(ic)), h('div', null, h('b', null, value), h('span', null, label)));
export const statusBadge = (s) => badge(s);
export const rackLabel = (r) => `${r.code} · free ${fmt.n(r.capacity - r.occupied)}`;
export async function rackOptions() {
  const w = await api.get('/warehouse');
  return w.sections.flatMap((s) => s.racks.map((r) => ({ value: r.id, label: `${r.code} · ${fmt.n(r.available)} free · ${r.pallets}/${r.maxPallets} pallets` })));
}
export const productOptions = async (activeOnly = true) => (await api.get('/products', { limit: 500 })).items.filter((p) => !activeOnly || p.active).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}`, product: p }));

export function receiveStockModal(app, { product, onDone } = {}) {
  Promise.all([productOptions(), rackOptions()]).then(async ([prods, racks]) => {
    let suggestion = '';
    if (product) { try { const s = await api.get('/inventory/suggest-rack', { productId: product.id, quantity: 1 }); if (s.items[0]) suggestion = `Suggested: ${s.items[0].rackCode} (${s.items[0].reason}, ${fmt.n(s.items[0].freeUnits)} free)`; } catch { /* optional */ } }
    formModal({ title: product ? `Receive stock – ${product.sku}` : 'Receive stock', submitLabel: 'Receive', initial: { productId: product?.id, rackId: undefined },
      fields: [
        { name: 'productId', label: 'Product', type: 'select', required: true, options: [{ value: '', label: 'Choose a product…' }, ...prods], numeric: true, readonly: !!product },
        { name: 'rackId', label: 'Storage rack', type: 'select', required: true, options: [{ value: '', label: 'Choose a rack…' }, ...racks], numeric: true, help: suggestion || 'Rack capacity and pallet positions are enforced.' },
        { name: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1, half: true }, { name: 'batchNo', label: 'Batch / lot no.', half: true, help: 'Optional' },
        { name: 'reason', label: 'Note', type: 'text' }],
      onSubmit: async (v, m) => { await api.post('/inventory/receive', { ...v, productId: v.productId ?? product?.id }); m.close(); toast('Stock received', `${v.quantity} units booked in`, 'success'); onDone?.(); } });
  }).catch(toastError);
}
export function viewOrderLink(app, id, label) { return h('a', { href: '#/orders', class: 'mono', onClick: (e) => { e.preventDefault(); import('../app.js').then((m) => m.openEntity('order', id)); } }, label); }
export { modal };
