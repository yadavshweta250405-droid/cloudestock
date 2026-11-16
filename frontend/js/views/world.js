import { h, icon, mount, fmt, badge, bar, toast, toastError, confirmDialog, spinner } from '../ui/dom.js';
import { api } from '../api.js';
import { refreshScene, openEntity } from '../app.js';
import { canDo, attempt, receiveStockModal } from './common.js';

let S = null;

export async function show(host, app) {
  if (!S || S.host !== host) { S = { host, app, world: null, sel: null, tab: 'docks', interior: false, low: false, els: {} }; await init(S); }
  else { S.world?.setPaused(false); S.world?.start?.(); await refreshScene(); }
  return S.viewApi;
}

async function init(s) {
  const { app } = s; const e = s.els;
  e.canvasHost = h('div', { style: { position: 'absolute', inset: '0' } });
  e.chips = h('div', { class: 'chips-top' });
  e.card = h('aside', { class: 'infocard glass hidden', 'aria-live': 'polite' });
  e.track = h('section', { class: 'track glass' });
  e.lists = h('section', { class: 'lists glass' });
  e.tip = h('div', { class: 'tooltip3d hidden' });
  e.legend = h('div', { class: 'legend3d glass' }, [['#2f5bd6', 'Rack in use'], ['#f97316', 'Nearly full (85%+)'], ['#ef4444', 'Full'], ['#f59e0b', 'Low-stock pallet']].map(([c, t]) => h('div', null, h('i', { style: { background: c } }), t)));
  e.interiorBtn = ctl('eye', 'Interior view (lift the roof)', () => s.world?.setInterior(!s.world.interior));
  e.qualityBtn = ctl('sun', 'Performance mode', () => { s.low = !s.low; s.world?.setQuality(s.low ? 'low' : 'high'); e.qualityBtn.classList.toggle('on', s.low); toast(s.low ? 'Performance mode on' : 'High quality on', '', 'info', 1800); });
  e.controls = h('div', { class: 'controls glass' }, ctl('plus', 'Zoom in', () => s.world?.zoom(0.75)), ctl('minus', 'Zoom out', () => s.world?.zoom(1.3)), ctl('rotate', 'Rotate view', () => s.world?.rotate(45)), ctl('compass', 'Reset camera', () => { s.world?.deselect(); s.world?.resetCamera(); }), e.interiorBtn, e.qualityBtn);
  e.loading = h('div', { class: 'loading3d glass' }, spinner(), h('div', { class: 'muted', style: { textAlign: 'center' } }, 'Building the warehouse…'));
  mount(s.host, e.canvasHost, h('div', { class: 'hud' }, e.chips, e.legend, e.controls, e.card, e.track, e.lists, e.tip, e.loading));

  const handlers = {
    onSelect: (ref) => { s.sel = ref; renderCard(s); renderTrack(s); },
    onHover: (ref, pos) => { if (!ref || !pos) { e.tip.classList.add('hidden'); return; } const t = tipFor(s, ref); if (!t) { e.tip.classList.add('hidden'); return; } const r = s.host.getBoundingClientRect(); e.tip.textContent = t; e.tip.style.left = `${pos.x - r.left}px`; e.tip.style.top = `${pos.y - r.top}px`; e.tip.classList.remove('hidden'); },
    onInterior: (on) => { s.interior = on; e.interiorBtn.classList.toggle('on', on); },
  };
  s.viewApi = {
    refresh: () => refreshScene(),
    focusEntity: (ref) => { if (s.world) s.world.focus(ref); },
    onScene: (d) => { e.loading.classList.add('hidden'); renderChips(s, d); renderCard(s); renderTrack(s); renderLists(s, d); },
  };
  app.worldView = s.viewApi;
  try {
    const mod = await import('../three/world.js');
    s.world = mod.createWorld(e.canvasHost, handlers); app.world = s.world; window.__world = s.world;
  } catch (err) {
    console.error('3D engine failed to start', err);
    e.loading.classList.add('hidden'); e.legend.classList.add('hidden'); e.controls.classList.add('hidden');
    mount(e.canvasHost, h('div', { class: 'world-msg' }, h('div', { class: 'glass' }, h('h3', null, '3D view unavailable'),
      h('p', null, err?.message?.includes('WebGL') ? 'Your browser or device could not create a WebGL context.' : 'The Three.js library could not be loaded. It is fetched from a CDN; if you are offline run “npm run vendor:three” once, then reload.'),
      h('p', { class: 'muted' }, 'All management screens (inventory, orders, fleet, team) still work.'), h('button', { class: 'btn primary', onClick: () => { location.hash = '#/dashboard'; } }, 'Open analytics'))));
  }
  await refreshScene();
}
const ctl = (ic, title, fn) => h('button', { title, 'aria-label': title, onClick: fn }, icon(ic));

// ------------------------------------------------------------------ HUD pieces
function renderChips(s, d) {
  const k = d.kpis;
  s.els.chips.replaceChildren(
    chip('box', fmt.n(k.stockOnHand), 'Stock on hand · units'), chip('truck', `${k.trucksOnSite}`, `Trucks on site · ${k.totalVehicles - k.trucksOnSite} on road`),
    chip('percent', k.onTimeRate === null ? '–' : fmt.pct(k.onTimeRate, 1), 'On-time delivery · 30 days'), chip('building', fmt.pct(k.utilization, 0), `Utilization · ${k.lowStock} low-stock`));
}
const chip = (ic, v, l) => h('div', { class: 'kpi' }, h('div', { class: 'ic' }, icon(ic)), h('div', null, h('b', null, v), h('span', null, l)));

function tipFor(s, ref) {
  const d = s.app.scene; if (!d) return null;
  switch (ref.type) {
    case 'rack': { const r = d.racks.find((x) => x.id === ref.id); return r && `Rack ${r.code} · ${fmt.pct(r.utilization)} full`; }
    case 'pallet': { const r = d.racks.find((x) => x.id === ref.rackId); const p = r?.pallets.find((x) => x.inventoryId === ref.id); return p && `${p.name} · ${fmt.n(p.quantity)} units`; }
    case 'vehicle': { const v = d.vehicles.find((x) => x.id === ref.id); return v && `${v.code} · ${fmt.label(v.status)}`; }
    case 'shipment': { const x = d.inboundShipments.find((y) => y.id === ref.id); return x && `${x.ref} · inbound`; }
    case 'worker': { const w = d.employees.find((x) => x.id === ref.id); return w && `${w.name} · ${fmt.label(w.status)}`; }
    case 'dock': { const k = d.docks.find((x) => x.id === ref.id); return k && `Dock ${k.number} · ${k.status}`; }
    case 'warehouse': return d.warehouse?.name || 'Warehouse';
    case 'office': return 'Management office';
    case 'section': { const x = d.sections.find((y) => y.id === ref.id); return x && `Section ${x.code} · ${x.name}`; }
    default: return null;
  }
}

const row = (k, v) => h('div', null, h('span', { class: 'muted' }, k), h('b', { style: { textAlign: 'right' } }, v));
function renderCard(s) {
  const el = s.els.card; const d = s.app.scene; const ref = s.sel;
  if (!ref || !d) { el.classList.add('hidden'); return; }
  const c = cardFor(s, ref, d); if (!c) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  mount(el, h('div', { class: 'head' }, h('div', { class: 'ic' }, icon(c.icon)), h('div', null, h('h4', null, c.title), h('small', null, c.sub)), h('button', { class: 'x', 'aria-label': 'Close', onClick: () => s.world?.deselect() }, icon('x'))),
    h('div', { class: 'mini' }, c.rows.map(([k, v]) => row(k, v))), c.extra, c.actions?.length ? h('div', { class: 'acts' }, c.actions) : null);
}
const act = (label, fn, kind = '') => h('button', { class: `btn sm ${kind}`, onClick: fn }, label);

function cardFor(s, ref, d) {
  const app = s.app; const dock = (id) => d.docks.find((x) => x.id === id);
  switch (ref.type) {
    case 'warehouse': {
      const products = new Set(d.racks.flatMap((r) => r.pallets.map((p) => p.productId)));
      return { icon: 'building', title: d.warehouse?.name || 'Warehouse', sub: `${d.warehouse?.code} · ${d.warehouse?.city}`, rows: [['Total inventory', `${fmt.n(d.occupied)} units`], ['Total products', fmt.n(products.size)], ['Storage capacity', `${fmt.n(d.capacity)} units`], ['Occupied', fmt.n(d.occupied)], ['Available', fmt.n(d.available)], ['Utilization', fmt.pct(d.utilization, 1)]],
        extra: h('div', { style: { marginTop: '8px' } }, bar(d.utilization)), actions: [act('Open layout', () => { location.hash = '#/warehouse'; }), act('Interior view', () => s.world.setInterior(!s.world.interior))] };
    }
    case 'section': {
      const x = d.sections.find((y) => y.id === ref.id); if (!x) return null; const racks = d.racks.filter((r) => r.sectionId === x.id);
      return { icon: 'layers', title: `Section ${x.code}`, sub: `${x.name} · ${x.zone}`, rows: [['Racks', racks.length], ['Capacity', fmt.n(x.capacity)], ['Occupied', fmt.n(x.occupied)], ['Available', fmt.n(x.available)], ['Utilization', fmt.pct(x.utilization, 1)], ['Status', badge(x.status)], ['Low-stock racks', racks.filter((r) => r.lowStock).length]], extra: h('div', { style: { marginTop: '8px' } }, bar(x.utilization)) };
    }
    case 'rack': {
      const r = d.racks.find((x) => x.id === ref.id); if (!r) return null;
      return { icon: 'layers', title: `Rack ${r.code}`, sub: `Section ${r.sectionCode} · row ${r.row}, column ${r.col}`, rows: [['Rack ID', r.code], ['Storage location', `${r.sectionCode} / R${r.row} / C${r.col}`], ['Quantity stored', `${fmt.n(r.occupied)} units`], ['Available capacity', `${fmt.n(r.available)} units`], ['Pallet positions', `${r.pallets.length} / ${r.maxPallets}`], ['Stock status', badge(r.status)]],
        extra: h('div', null, h('div', { style: { margin: '8px 0' } }, bar(r.utilization)), h('hr'), h('div', { class: 'mini' }, r.pallets.length ? r.pallets.map((p) => h('div', { style: { cursor: 'pointer' }, onClick: () => s.world.select({ type: 'pallet', id: p.inventoryId, rackId: r.id }, { focus: true }) }, h('span', null, p.name), h('b', null, `${fmt.n(p.quantity)}${p.status !== 'ok' ? ' [!]' : ''}`))) : h('span', { class: 'muted' }, 'Empty rack')) ),
        actions: [canDo(app, 'inventory:write') && act('Receive stock', () => receiveStockModal(app, {}), 'primary'), act('Open rack', () => { location.hash = '#/warehouse'; setTimeout(() => app.viewApi?.open?.(r.id), 300); })].filter(Boolean) };
    }
    case 'pallet': {
      const r = d.racks.find((x) => x.id === ref.rackId); const p = r?.pallets.find((x) => x.inventoryId === ref.id); if (!p) return null;
      return { icon: 'box', title: p.name, sub: `${p.sku} · ${p.category || 'Uncategorised'}`, rows: [['Product', p.name], ['SKU', p.sku], ['Quantity', `${fmt.n(p.quantity)} (${fmt.n(p.reserved)} reserved)`], ['Batch number', p.batchNo], ['Storage location', `Rack ${r.code}`], ['Stock status', badge(p.status)]],
        actions: [act('Open product', () => openEntity('product', p.productId), 'primary'), canDo(app, 'inventory:write') && act('Receive more', () => receiveStockModal(app, { product: { id: p.productId, sku: p.sku, name: p.name } }))].filter(Boolean) };
    }
    case 'vehicle': {
      const v = d.vehicles.find((x) => x.id === ref.id); if (!v) return null; const dl = v.delivery;
      const where = v.status === 'loading' ? `Dock ${v.dockNumber}` : v.status === 'on_route' ? 'On the road' : v.status === 'returning' ? 'Driving back to the yard' : v.parkingSlot !== null ? `Yard bay ${v.parkingSlot + 1}` : '–';
      const fleet = canDo(app, 'deliveries:write');
      return { icon: 'truck', title: v.code, sub: `${fmt.label(v.type)} · ${v.plate}`, rows: [['Vehicle ID', v.code], ['Driver', v.driverName || '–'], ['Assigned orders', dl ? dl.orders.map((o) => o.number).join(', ') || '–' : 'None'], ['Delivery status', dl ? badge(dl.status) : badge(v.status)], ['Current location', where], ['Destination', dl?.destination || '–'], ['Capacity', `${fmt.n(v.capacityUnits)} units`]],
        actions: [fleet && dl?.status === 'Loading' && act('Dispatch', async () => { await attempt(() => api.post(`/deliveries/${dl.id}/dispatch`), `${v.code} dispatched`); }, 'primary'),
          fleet && dl?.status === 'In Transit' && act('Mark delivered', async () => { await attempt(() => api.post(`/deliveries/${dl.id}/complete`), 'Delivery completed'); }, 'primary'),
          fleet && dl?.status === 'Loading' && act('Cancel loading', async () => { if (await confirmDialog({ title: `Cancel ${dl.code}?`, message: 'The vehicle returns to the yard.', danger: true, confirmLabel: 'Cancel delivery' })) await attempt(() => api.post(`/deliveries/${dl.id}/cancel`), 'Delivery cancelled'); }),
          fleet && v.status === 'available' && act('New delivery', () => import('./deliveries.js').then((m) => m.newDeliveryModal(app, { vehicleId: v.id }).catch((e) => toast('Cannot create delivery', e.message, 'error')))),
          fleet && ['available', 'maintenance'].includes(v.status) && act(v.status === 'available' ? 'Maintenance' : 'Back in service', async () => { await attempt(() => api.patch(`/vehicles/${v.id}`, { status: v.status === 'available' ? 'maintenance' : 'available' })); })].filter(Boolean) };
    }
    case 'shipment': {
      const x = d.inboundShipments.find((y) => y.id === ref.id); if (!x) return null;
      return { icon: 'inbox', title: x.ref, sub: `Inbound · ${x.supplier}`, rows: [['Supplier', x.supplier], ['Status', badge(x.status)], ['Dock', x.dockNumber ? `Dock ${x.dockNumber}` : '–'], ['Units received', `${fmt.n(x.receivedUnits)} / ${fmt.n(x.unitCount)}`], ['Lines', x.itemCount]],
        actions: [canDo(app, 'receiving:write') && act('Receive all goods', async () => { await attempt(() => api.post(`/shipments/${x.id}/receive`, {}), `${x.ref} received into racks`); }, 'primary'), act('Open shipment', () => openEntity('shipment', x.id))].filter(Boolean) };
    }
    case 'worker': {
      const w = d.employees.find((x) => x.id === ref.id); if (!w) return null; const m = canDo(app, 'employees:write');
      const setStatus = (st) => attempt(() => api.patch(`/employees/${w.id}`, { status: st }), `${w.name} is now ${fmt.label(st).toLowerCase()}`);
      return { icon: 'user', title: w.name, sub: `${w.code} · ${w.jobTitle || w.department}`, rows: [['Employee ID', w.code], ['Name', w.name], ['Assigned task', w.task ? w.task.title : 'None'], ['Working status', badge(w.status)], ['Current department', w.department], ['Location', w.task?.targetLabel || (w.status === 'on_break' ? 'Break area' : 'Patrolling')]],
        actions: [m && w.status === 'available' && act('Send on break', () => setStatus('on_break')), m && w.status !== 'busy' && w.status !== 'available' && act('Back on duty', () => setStatus('available'), 'primary'), m && w.status === 'available' && act('Off duty', () => setStatus('off_duty')), act('Open team', () => { location.hash = '#/people'; })].filter(Boolean) };
    }
    case 'dock': {
      const k = dock(ref.id); if (!k) return null; const status = k.vehicle ? `${fmt.label(k.vehicle.status)} · ${k.vehicle.delivery?.status || ''}` : k.inbound ? `Unloading ${k.inbound.ref}` : fmt.label(k.status);
      return { icon: 'truck', title: `Dock ${k.number}`, sub: fmt.label(k.direction), rows: [['Dock number', k.number], ['Direction', fmt.label(k.direction)], ['Incoming shipments', k.inbound ? `${k.inbound.ref} (${k.inbound.supplier})` : d.scheduledShipments.length ? `${d.scheduledShipments.length} scheduled` : 'None'], ['Outgoing shipments', k.vehicle?.delivery ? `${k.vehicle.delivery.code} · ${k.vehicle.delivery.orders.length} order(s)` : 'None'], ['Loading status', status], ['Assigned vehicle', k.vehicle?.code || (k.inbound ? 'Supplier truck' : '–')]],
        actions: [canDo(app, 'warehouse:write') && k.status !== 'occupied' && act(k.status === 'maintenance' ? 'Reopen dock' : 'Set maintenance', async () => { await attempt(() => api.patch(`/docks/${k.id}`, { status: k.status === 'maintenance' ? 'free' : 'maintenance' })); }), k.vehicle?.delivery?.status === 'Loading' && canDo(app, 'deliveries:write') && act('Dispatch', async () => { await attempt(() => api.post(`/deliveries/${k.vehicle.delivery.id}/dispatch`), 'Dispatched'); }, 'primary')].filter(Boolean) };
    }
    case 'office':
      return { icon: 'building', title: 'Management office', sub: 'Operations & administration', rows: [['Management staff', d.office.employees], ['Open tasks', d.office.openTasks], ['Open orders', d.office.openOrders], ['Active users', d.office.activeUsers]], actions: [act('Analytics', () => { location.hash = '#/dashboard'; }, 'primary'), act('Orders', () => { location.hash = '#/orders'; })] };
    default: return null;
  }
}

// ------------------------------------------------------------------ shipment tracking
const STEPS = ['Order confirmed', 'Picked', 'Loading', 'In transit', 'Delivered'];
function renderTrack(s) {
  const d = s.app.scene; const el = s.els.track; if (!d) return;
  let v = null;
  if (s.sel?.type === 'vehicle') v = d.vehicles.find((x) => x.id === s.sel.id && x.delivery);
  if (!v) v = d.vehicles.find((x) => x.delivery && x.delivery.status === 'Loading') || d.vehicles.find((x) => x.delivery && x.delivery.status === 'In Transit');
  if (!v) { mount(el, h('h5', null, 'Shipment tracking'), h('div', { class: 'muted' }, 'No active shipment. Assign a packed order to a vehicle to see it here.')); return; }
  const dl = v.delivery; const cur = dl.status === 'Loading' ? 2 : dl.status === 'In Transit' ? 3 : 4;
  mount(el, h('h5', null, h('span', null, `Shipment tracking · ${dl.code}`), h('span', { class: 'muted', style: { fontWeight: 500 } }, `${v.code} · ${dl.orders.length} order(s)`)),
    h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' } },
      h('div', { class: 'steps', style: { flex: '1 1 300px' } }, STEPS.map((l, i) => h('div', { class: `step ${i < cur ? 'done' : i === cur ? 'cur' : ''}` }, h('i', null, i < cur ? icon('check') : i + 1), l === 'Loading' && dl.dockNumber ? `Loading · Dock ${dl.dockNumber}` : l))),
      h('div', { style: { fontSize: '12.5px', lineHeight: 1.45 } }, h('b', null, dl.orders.map((o) => o.number).join(', ')), h('div', { class: 'muted' }, `To ${dl.destination || '–'}`), badge(dl.status), dl.status !== 'Delivered' && h('span', { class: 'muted', style: { marginLeft: '6px' } }, `ETA ~${dl.etaMinutes} min`))));
}

// ------------------------------------------------------------------ docks / workers / vehicles lists
function renderLists(s, d) {
  const el = s.els.lists; const t = s.tab;
  const tabBtn = (id, label) => h('button', { class: t === id ? 'active' : '', onClick: () => { s.tab = id; renderLists(s, d); } }, label);
  const sel = (type, id) => () => s.world?.select({ type, id }, { focus: true });
  let rows;
  if (t === 'docks') rows = d.docks.map((k) => h('div', { class: 'row', onClick: sel('dock', k.id) }, h('b', null, `Dock ${k.number}`), h('span', { class: 't' }, k.vehicle ? `${k.vehicle.code} · ${k.vehicle.delivery?.status || 'loading'}` : k.inbound ? `${k.inbound.ref} · ${k.inbound.status}` : fmt.label(k.direction)), badge(k.status)));
  else if (t === 'workers') rows = d.employees.filter((e) => e.status !== 'off_duty').map((e) => h('div', { class: 'row', onClick: sel('worker', e.id) }, h('b', null, e.code.replace('EMP-', 'E-')), h('span', { class: 't' }, e.task ? e.task.title : e.name), badge(e.status)));
  else rows = d.vehicles.map((v) => h('div', { class: 'row', onClick: sel('vehicle', v.id) }, h('b', null, v.code), h('span', { class: 't' }, v.delivery ? `${v.delivery.code} → ${v.delivery.destination || ''}` : v.driverName || '–'), badge(v.status)));
  mount(el, h('div', { class: 'tabs' }, tabBtn('docks', `Docks ${d.docks.filter((k) => k.status === 'occupied').length}/${d.docks.length}`), tabBtn('workers', `Workers ${d.employees.filter((e) => e.status === 'busy').length}/${d.employees.filter((e) => e.status !== 'off_duty').length}`), tabBtn('vehicles', `Trucks ${d.vehicles.length}`)),
    h('div', { class: 'body' }, rows.length ? rows : h('div', { class: 'muted', style: { padding: '8px' } }, 'Nothing to show')));
}
