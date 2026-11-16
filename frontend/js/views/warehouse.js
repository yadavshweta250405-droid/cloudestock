import { h, fmt, mount, badge, table, formModal, toast, confirmDialog, modal, dl, bar } from '../ui/dom.js';
import { api } from '../api.js';
import { DOCK_DIRECTIONS } from '/shared/constants.js';
import { pageHead, btn, load, attempt, canDo } from './common.js';

export async function render(root, app) {
  const write = canDo(app, 'warehouse:write');
  const content = h('div');

  async function rackDetail(id) {
    const r = await api.get(`/racks/${id}`);
    const m = modal({ title: `Rack ${r.code}`, wide: true, body: h('div', null, dl([['Section', `${r.sectionCode} · ${r.sectionName}`], ['Status', badge(r.status)], ['Capacity', `${fmt.n(r.occupied)} / ${fmt.n(r.capacity)} units`], ['Pallet positions', `${r.pallets.length} / ${r.maxPallets}`]]), h('div', { style: { margin: '10px 0' } }, bar(r.capacity ? r.occupied / r.capacity : 0)),
      h('h3', { style: { margin: '14px 0 8px' } }, 'Pallets'), table({ rows: r.pallets, empty: 'Empty rack', columns: [{ label: 'SKU', key: 'sku', mono: true }, { label: 'Product', key: 'productName' }, { label: 'Batch', key: 'batchNo', mono: true }, { label: 'Quantity', num: true, render: (p) => fmt.n(p.quantity) }, { label: 'Reserved', num: true, render: (p) => fmt.n(p.reserved) }] })), actions: [] });
    m.setActions([write && btn('Edit capacity', () => { m.close(); formModal({ title: `Rack ${r.code} capacity`, initial: { capacity: r.capacity, maxPallets: r.maxPallets }, fields: [{ name: 'capacity', label: 'Capacity (units)', type: 'number', min: r.occupied || 1, required: true, half: true }, { name: 'maxPallets', label: 'Pallet positions (1–6)', type: 'number', min: Math.max(1, r.pallets.length), max: 6, required: true, half: true }],
      onSubmit: async (v, mm) => { await api.patch(`/racks/${r.id}`, v); mm.close(); toast('Rack updated', '', 'success'); refresh(); } }); }, { ic: 'edit' }),
    write && btn('Delete rack', async () => { if (await confirmDialog({ title: `Delete rack ${r.code}?`, message: 'Only empty racks can be deleted.', danger: true, confirmLabel: 'Delete' })) { if (await attempt(() => api.del(`/racks/${r.id}`), 'Rack deleted')) { m.close(); refresh(); } } }, { kind: 'danger', ic: 'trash' }), btn('Close', () => m.close())].filter(Boolean));
  }
  const rackForm = (w, section) => formModal({ title: 'Add rack', submitLabel: 'Add rack', initial: { sectionId: section?.id },
    fields: [{ name: 'sectionId', label: 'Section', type: 'select', numeric: true, required: true, options: w.sections.map((s) => ({ value: s.id, label: `${s.code} · ${s.name} (${s.zone})` })) }, { name: 'row', label: 'Row (1–3 indoor, 1–2 yard)', type: 'number', min: 1, max: 3, required: true, half: true }, { name: 'col', label: 'Column (1–4)', type: 'number', min: 1, max: 4, required: true, half: true },
      { name: 'capacity', label: 'Capacity (units)', type: 'number', min: 1, value: 600, half: true }, { name: 'maxPallets', label: 'Pallet positions', type: 'number', min: 1, max: 6, value: 6, half: true }],
    onSubmit: async (v, m) => { await api.post('/racks', v); m.close(); toast('Rack added', 'It appears in the 3D warehouse immediately', 'success'); refresh(); } });

  async function paint() {
    const w = await api.get('/warehouse');
    return h('div', null,
      h('div', { class: 'grid g3', style: { marginBottom: '14px' } },
        h('div', { class: 'card' }, h('b', null, w.warehouse?.name), h('div', { class: 'muted' }, `${w.warehouse?.address}, ${w.warehouse?.city}`)),
        h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Capacity'), h('b', { style: { fontSize: '20px' } }, `${fmt.n(w.occupied)} / ${fmt.n(w.capacity)}`), bar(w.utilization)),
        h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Utilization'), h('b', { style: { fontSize: '20px' } }, fmt.pct(w.utilization, 1)), h('div', { class: 'muted' }, `${fmt.n(w.available)} units free`))),
      w.sections.map((s) => h('div', { class: 'card', style: { marginBottom: '14px' } }, h('div', { class: 'page-head', style: { marginBottom: '10px' } }, h('div', null, h('h3', { style: { margin: 0 } }, `Section ${s.code} · ${s.name}`, h('small', null, s.zone)), h('div', { class: 'muted' }, `${fmt.n(s.occupied)} / ${fmt.n(s.capacity)} units · ${fmt.pct(s.utilization, 1)}`)), h('div', { class: 'spacer' }), badge(s.status), write && btn('Add rack', () => rackForm(w, s), { sm: true, ic: 'plus' })),
        h('div', { style: { marginBottom: '10px' } }, bar(s.utilization)),
        h('div', { class: 'rackgrid' }, s.racks.map((r) => h('button', { class: `rackcell ${r.status}`, onClick: () => rackDetail(r.id) }, h('b', null, r.code), h('small', null, `${fmt.n(r.occupied)}/${fmt.n(r.capacity)} · ${r.pallets}/${r.maxPallets} pallets`), h('div', { style: { marginTop: '6px' } }, bar(r.utilization))))))),
      h('div', { class: 'card' }, h('h3', null, 'Loading docks'), table({ rows: w.docks, columns: [{ label: 'Dock', render: (d) => h('b', null, `Dock ${d.number}`) }, { label: 'Direction', render: (d) => fmt.label(d.direction) }, { label: 'Status', render: (d) => badge(d.status) },
        write && { label: '', actions: true, render: (d) => [
          d.status !== 'occupied' && btn(d.status === 'maintenance' ? 'Reopen' : 'Maintenance', async () => { if (await attempt(() => api.patch(`/docks/${d.id}`, { status: d.status === 'maintenance' ? 'free' : 'maintenance' }))) refresh(); }, { sm: true }),
          d.status !== 'occupied' && btn('Direction', () => formModal({ title: `Dock ${d.number} direction`, initial: { direction: d.direction }, fields: [{ name: 'direction', label: 'Direction', type: 'select', options: DOCK_DIRECTIONS.map((x) => ({ value: x, label: fmt.label(x) })) }], onSubmit: async (v, m) => { await api.patch(`/docks/${d.id}`, v); m.close(); refresh(); } }), { sm: true })] }].filter(Boolean) })));
  }
  const refresh = async () => { try { mount(content, await paint()); } catch (e) { mount(content, h('div', { class: 'card empty' }, e.message)); } };
  mount(root, pageHead('Warehouse layout', 'Sections, racks and docks as built in the 3D world', write && btn('Add rack', async () => rackForm(await api.get('/warehouse')), { kind: 'primary', ic: 'plus' })), content);
  await load(content, paint);
  return { refresh, open: rackDetail };
}
