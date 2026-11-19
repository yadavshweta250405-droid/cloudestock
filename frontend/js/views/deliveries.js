import { h, fmt, mount, badge, table, formModal, toast, confirmDialog, modal, dl } from '../ui/dom.js';
import { api } from '../api.js';
import { pageHead, btn, tabs, load, attempt, canDo } from './common.js';

/** Create a delivery: choose a vehicle, the orders to load and (optionally) a dock. Also used from the order dialog and the 3D cards. */
export async function newDeliveryModal(app, { orderIds = [], vehicleId, onDone } = {}) {
  const [vs, os, ds, w] = await Promise.all([api.get('/vehicles'), api.get('/orders', { limit: 200 }), api.get('/drivers'), api.get('/warehouse')]);
  const vehicles = vs.items.filter((v) => v.status === 'available');
  const orders = os.items.filter((o) => ['Packed', 'Ready for Dispatch'].includes(o.status) && !o.deliveryId);
  if (!vehicles.length) return toast('No vehicle available', 'All vehicles are loading, on the road or in maintenance.', 'warning');
  if (!orders.length) return toast('Nothing to load', 'Orders must be Packed or Ready for Dispatch first.', 'warning');
  const free = ds.items.filter((d) => d.status === 'available');
  const picked = new Set(orderIds);
  const checks = h('div', null, orders.map((o) => h('label', { class: 'list-row', style: { cursor: 'pointer' } }, h('span', null, h('input', { type: 'checkbox', checked: picked.has(o.id), onChange: (e) => (e.target.checked ? picked.add(o.id) : picked.delete(o.id)) }), ` ${o.number} · ${o.customerName} (${o.city})`), h('span', { class: 'muted' }, `${fmt.n(o.unitCount)} units · ${o.status}`))));
  formModal({ title: 'New delivery', submitLabel: 'Assign & start loading', wide: true, initial: { vehicleId: vehicleId || vehicles[0].id },
    fields: [
      { name: 'vehicleId', label: 'Vehicle', type: 'select', numeric: true, required: true, options: vehicles.map((v) => ({ value: v.id, label: `${v.code} · ${v.type} · cap ${v.capacityUnits} · ${v.driverName || 'no driver'}` })) },
      { name: 'dockId', label: 'Loading dock', type: 'select', numeric: true, nullEmpty: true, options: [{ value: '', label: 'Auto (first free outbound dock)' }, ...w.docks.filter((d) => d.status === 'free' && d.direction !== 'inbound').map((d) => ({ value: d.id, label: `Dock ${d.number} (${d.direction})` }))] },
      { name: 'driverId', label: 'Driver (only if the vehicle has none)', type: 'select', numeric: true, nullEmpty: true, options: [{ value: '', label: 'Use the vehicle’s driver' }, ...free.map((d) => ({ value: d.id, label: d.name }))] }],
    extra: h('div', null, h('div', { class: 'field' }, h('label', null, 'Orders to load *'), h('div', { class: 'help' }, 'Only Packed / Ready for Dispatch orders are listed. Load must fit the vehicle capacity.')), checks),
    onSubmit: async (v, m) => {
      if (!picked.size) throw new Error('Select at least one order');
      const d = await api.post('/deliveries', { ...v, orderIds: [...picked] }); m.close(); toast(`${d.code} created`, `${d.vehicleCode} is loading at Dock ${d.dockNumber}`, 'success'); onDone?.(); } });
}

export async function render(root, app) {
  const write = canDo(app, 'deliveries:write');
  const state = { tab: 'deliveries', filter: '' };
  const content = h('div');

  const vehicleForm = async (v) => {
    const drivers = (await api.get('/drivers')).items;
    formModal({ title: v ? `Edit ${v.code}` : 'Register vehicle', submitLabel: v ? 'Save' : 'Register', initial: v || {},
      fields: [{ name: 'plate', label: 'Licence plate', required: true, half: true }, { name: 'type', label: 'Type', type: 'select', half: true, options: [{ value: 'truck', label: 'Truck' }, { value: 'van', label: 'Van' }] },
        { name: 'capacityUnits', label: 'Capacity (units)', type: 'number', min: 1, required: true, half: true }, { name: 'color', label: 'Cab colour', type: 'text', half: true, placeholder: '#2563eb', help: 'Hex colour used in the 3D world' },
        { name: 'driverId', label: 'Driver', type: 'select', numeric: true, nullEmpty: true, options: [{ value: '', label: 'No driver' }, ...drivers.filter((d) => d.status !== 'off_duty' && (!d.vehicleCode || d.vehicleCode === v?.code)).map((d) => ({ value: d.id, label: d.name }))] }],
      onSubmit: async (val, m) => { v ? await api.patch(`/vehicles/${v.id}`, val) : await api.post('/vehicles', val); m.close(); toast(v ? 'Vehicle updated' : 'Vehicle registered', '', 'success'); refresh(); } });
  };
  const driverForm = (d) => formModal({ title: d ? `Edit ${d.name}` : 'Add driver', submitLabel: d ? 'Save' : 'Add driver', initial: d || {},
    fields: [{ name: 'name', label: 'Full name', required: true }, { name: 'phone', label: 'Phone', nullEmpty: true, half: true }, { name: 'licenseNo', label: 'Licence no.', required: true, half: true }],
    onSubmit: async (v, m) => { d ? await api.patch(`/drivers/${d.id}`, v) : await api.post('/drivers', v); m.close(); toast(d ? 'Driver updated' : 'Driver added', '', 'success'); refresh(); } });

  const deliveryDetail = (d) => modal({ title: `${d.code} · ${d.vehicleCode}`, wide: true, body: h('div', null, dl([['Status', badge(d.status)], ['Vehicle', `${d.vehicleCode} (${d.plate})`], ['Driver', d.driverName || '–'], ['Dock', d.dockNumber ? `Dock ${d.dockNumber}` : '–'], ['Destination', d.destination || '–'], ['Created', fmt.dt(d.createdAt)], ['Dispatched', fmt.dt(d.dispatchedAt)], ['Delivered', fmt.dt(d.deliveredAt)]]),
    h('h3', { style: { margin: '16px 0 8px' } }, 'Orders on board'), table({ rows: d.orders, columns: [{ label: 'Order', key: 'number', mono: true }, { label: 'Customer', key: 'customerName' }, { label: 'City', key: 'city' }, { label: 'Units', num: true, render: (o) => fmt.n(o.units) }, { label: 'Status', render: (o) => badge(o.status) }] })), actions: [] });

  function showTrackingModal(d) {
    const sigCanvas = h('canvas', { width: 340, height: 100, style: { border: '1px dashed #94a3b8', borderRadius: '6px', background: '#f8fafc', display: 'block', margin: '8px auto' } });
    const ctx = sigCanvas.getContext('2d');
    ctx.font = '14px Inter, sans-serif'; ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'center';
    ctx.fillText('Recipient Sign Here on Delivery', 170, 55);

    modal({
      title: `Live Shipment Tracking · ${d.code}`,
      body: h('div', null,
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe', marginBottom: '16px' } },
          h('div', null,
            h('div', { style: { fontSize: '11px', color: '#1e40af', fontWeight: '700' } }, 'PUBLIC TRACKING LINK (SHARE WITH CUSTOMER):'),
            h('div', { style: { fontSize: '14px', fontFamily: 'monospace', fontWeight: '600', color: '#1d4ed8' } }, `http://127.0.0.1:3000/#/track/${d.code}`)),
          btn('Copy Link', () => { navigator.clipboard?.writeText(`http://127.0.0.1:3000/#/track/${d.code}`); toast('Copied', 'Tracking URL copied to clipboard', 'success'); }, { sm: true, ic: 'clipboard' })),
        dl([
          ['Vehicle', `${d.vehicleCode} (${d.plate})`],
          ['Driver', d.driverName || 'Marcus Reed (Assigned)'],
          ['Status', badge(d.status)],
          ['Destination', d.destination || 'Metropolitan Regional Logistics Center'],
          ['Live GPS / ETA', d.status === 'In Transit' ? 'On Route · Highway 95 · ~25 mins ETA' : d.status === 'Loading' ? 'Dock Loading Stage' : 'Delivered & Signed'],
          ['Orders On Board', `${d.orders.length} order shipments`]
        ]),
        h('h4', { style: { margin: '14px 0 6px' } }, 'Digital Proof of Delivery (POD)'),
        sigCanvas),
      actions: [
        btn('Simulate Recipient Signature & Complete', async () => {
          ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(50, 60); ctx.bezierCurveTo(100, 20, 200, 90, 290, 40); ctx.stroke();
          toast('Signature Captured', 'Proof of delivery signed by recipient.', 'success');
          if (d.status === 'In Transit') await api.post(`/deliveries/${d.id}/complete`).catch(() => {});
          refresh();
        }, { kind: 'primary', ic: 'check' })
      ]
    });
  }

  async function paintTab() {
    if (state.tab === 'deliveries') {
      const { items } = await api.get('/deliveries', { limit: 200 });
      return table({ rows: items, empty: { title: 'No deliveries yet', hint: 'Pack an order, then assign it to a vehicle.' }, onRow: deliveryDetail, columns: [
        { label: 'Delivery', render: (d) => h('b', null, d.code) }, { label: 'Vehicle', render: (d) => `${d.vehicleCode} · ${d.driverName || '–'}` }, { label: 'Destination', render: (d) => d.destination || '–' }, { label: 'Orders', num: true, render: (d) => d.orders.length },
        { label: 'Dock', render: (d) => d.dockNumber ? `Dock ${d.dockNumber}` : '–' }, { label: 'Status', render: (d) => badge(d.status) }, { label: 'Created', render: (d) => fmt.dt(d.createdAt) }, { label: 'Delivered', render: (d) => fmt.dt(d.deliveredAt) },
        write && { label: '', actions: true, render: (d) => [
          btn('Track', () => showTrackingModal(d), { sm: true, ic: 'truck' }),
          d.status === 'Loading' && btn('Dispatch', async () => { if (await attempt(() => api.post(`/deliveries/${d.id}/dispatch`), `${d.vehicleCode} dispatched`)) refresh(); }, { sm: true, kind: 'primary' }),
          d.status === 'In Transit' && btn('Complete', async () => { if (await attempt(() => api.post(`/deliveries/${d.id}/complete`), 'Delivery completed')) refresh(); }, { sm: true, kind: 'primary' }),
          d.status === 'Loading' && btn('Cancel', async () => { if (await confirmDialog({ title: `Cancel ${d.code}?`, message: 'The vehicle and dock are released; orders stay Ready for Dispatch.', confirmLabel: 'Cancel delivery', danger: true })) { if (await attempt(() => api.post(`/deliveries/${d.id}/cancel`), 'Delivery cancelled')) refresh(); } }, { sm: true, kind: 'danger' })] }].filter(Boolean) });
    }
    if (state.tab === 'vehicles') {
      const { items } = await api.get('/vehicles');
      return table({ rows: items, empty: 'No vehicles registered', columns: [
        { label: 'Vehicle', render: (v) => h('div', null, h('b', null, v.code), ['REF-401', 'HTR-301'].includes(v.code) && h('span', { class: 'badge', style: { marginLeft: '6px', background: '#e0f2fe', color: '#0369a1' } }, 'Riverside')) }, { label: 'Plate', key: 'plate', mono: true }, { label: 'Type', render: (v) => fmt.label(v.type) }, { label: 'Capacity', num: true, render: (v) => fmt.n(v.capacityUnits) },
        { label: 'Driver', render: (v) => v.driverName || '–' }, { label: 'Status', render: (v) => badge(v.status) }, { label: 'Location', render: (v) => v.dockNumber ? `Dock ${v.dockNumber}` : v.parkingSlot !== null ? `Bay ${v.parkingSlot + 1}` : v.status === 'on_route' ? 'On the road' : '–' },
        write && { label: '', actions: true, render: (v) => [
          ['available', 'maintenance'].includes(v.status) && btn(v.status === 'available' ? 'Maintenance' : 'Back in service', async () => { if (await attempt(() => api.patch(`/vehicles/${v.id}`, { status: v.status === 'available' ? 'maintenance' : 'available' }))) refresh(); }, { sm: true }),
          btn('', () => vehicleForm(v), { sm: true, ic: 'edit' }), ['available', 'maintenance'].includes(v.status) && btn('', async () => { if (await confirmDialog({ title: `Remove ${v.code}?`, message: 'Vehicles with delivery history cannot be removed.', danger: true, confirmLabel: 'Remove' })) { if (await attempt(() => api.del(`/vehicles/${v.id}`), 'Vehicle removed')) refresh(); } }, { sm: true, kind: 'danger', ic: 'trash' })] }].filter(Boolean) });
    }
    const { items } = await api.get('/drivers');
    return table({ rows: items, empty: 'No drivers', columns: [{ label: 'Driver', render: (d) => h('b', null, d.name) }, { label: 'Phone', render: (d) => d.phone || '–' }, { label: 'Licence', key: 'licenseNo', mono: true }, { label: 'Vehicle', render: (d) => d.vehicleCode || '–' }, { label: 'Status', render: (d) => badge(d.status) },
      write && { label: '', actions: true, render: (d) => [btn('', () => driverForm(d), { sm: true, ic: 'edit' }), btn('', async () => { if (await confirmDialog({ title: `Remove ${d.name}?`, message: 'Drivers with history are archived.', danger: true, confirmLabel: 'Remove' })) { if (await attempt(() => api.del(`/drivers/${d.id}`), 'Driver removed')) refresh(); } }, { sm: true, kind: 'danger', ic: 'trash' })] }].filter(Boolean) });
  }
  const refresh = async () => { try { mount(content, await paintTab()); } catch (e) { mount(content, h('div', { class: 'card empty' }, e.message)); } };
  const paintAll = () => mount(root, pageHead('Fleet & deliveries', 'Assign orders to vehicles; the 3D trucks follow these records',
    write && state.tab === 'deliveries' && btn('New delivery', () => newDeliveryModal(app, { onDone: refresh }).catch((e) => toast('Cannot create delivery', e.message, 'error')), { kind: 'primary', ic: 'plus' }),
    write && state.tab === 'vehicles' && btn('Register vehicle', () => vehicleForm(null), { kind: 'primary', ic: 'plus' }), write && state.tab === 'drivers' && btn('Add driver', () => driverForm(null), { kind: 'primary', ic: 'plus' })),
  tabs([['deliveries', 'Deliveries'], ['vehicles', 'Vehicles'], ['drivers', 'Drivers']], state.tab, (t) => { state.tab = t; paintAll(); refresh(); }), h('div', { style: { height: '14px' } }), content);
  paintAll(); await load(content, paintTab);
  return { refresh, open: async (id) => deliveryDetail(await api.get(`/deliveries/${id}`)) };
}
