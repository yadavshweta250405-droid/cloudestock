import { h, icon, mount, clear, fmt, toast, toastError, formModal, debounce, badge } from './ui/dom.js';
import { api, session, connectEvents, setUnauthorizedHandler } from './api.js';
import { can, ROLE_LABELS } from '/shared/constants.js';

export const app = { user: null, scene: null, world: null, route: null, viewApi: null, sync: null, connected: true };

const NAV = [
  { id: 'world', label: '3D World', icon: 'box', perm: 'scene:read' },
  { id: 'dashboard', label: 'Analytics', icon: 'chart', perm: 'dashboard:read' },
  { id: 'inventory', label: 'Inventory', icon: 'layers', perm: 'products:read' },
  { id: 'orders', label: 'Orders', icon: 'clipboard', perm: 'orders:read' },
  { id: 'deliveries', label: 'Fleet', icon: 'truck', perm: 'deliveries:read' },
  { id: 'receiving', label: 'Inbound', icon: 'inbox', perm: 'receiving:read' },
  { id: 'people', label: 'Team', icon: 'users', perm: 'employees:read' },
  { id: 'warehouse', label: 'Layout', icon: 'building', perm: 'warehouse:read' },
  { id: 'activity', label: 'Activity', icon: 'activity', perm: 'dashboard:read' },
  { id: 'users', label: 'Users', icon: 'lock', perm: 'users:manage' },
];
const loaders = {
  world: () => import('./views/world.js'), dashboard: () => import('./views/dashboard.js'), inventory: () => import('./views/inventory.js'), orders: () => import('./views/orders.js'),
  deliveries: () => import('./views/deliveries.js'), receiving: () => import('./views/receiving.js'), people: () => import('./views/people.js'), warehouse: () => import('./views/warehouse.js'),
  activity: () => import('./views/activity.js'), users: () => import('./views/users.js'),
};

let root; let stopEvents = () => {}; let els = {};

export function startApp(el) {
  root = el;
  setUnauthorizedHandler(() => { if (app.user) { toast('Session expired', 'Please sign in again.', 'warning'); signOut(false); } });
  window.addEventListener('hashchange', () => { if (app.user) route(); });
  boot();
}

async function boot() {
  if (!session.token) return showLogin();
  mount(root, h('div', { class: 'login' }, h('div', { class: 'spinner' })));
  try { const me = await api.get('/auth/me'); app.user = me.user; app.unread = me.unreadNotifications; showShell(); }
  catch { session.token = null; showLogin(); }
}

// ----------------------------------------------------------------------------------------- login
const DEMO = [
  ['WareTrack Admin', 'admin@waretrack.local', 'Admin@123'],
  ['Riverside Admin', 'admin@riversidehub.local', 'Admin@123'],
  ['Warehouse Manager', 'manager@waretrack.local', 'Manager@123'],
  ['Inventory Manager', 'inventory@waretrack.local', 'Inventory@123']
];
function showLogin() {
  stopEvents(); app.user = null;
  const err = h('div', { class: 'form-error hidden' });
  const email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true, placeholder: 'you@company.com' });
  const pass = h('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••' });
  const btn = h('button', { class: 'btn primary', type: 'submit', style: { width: '100%', justifyContent: 'center', padding: '11px' } }, 'Sign in');
  const form = h('form', { onSubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; err.classList.add('hidden');
    try { const r = await api.post('/auth/login', { email: email.value, password: pass.value }); session.token = r.token; app.user = r.user; app.unread = 0; showShell(); }
    catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); btn.disabled = false; }
  } }, err,
  h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), email), h('div', { class: 'field' }, h('label', { for: 'password' }, 'Password'), pass), btn);
  mount(root, h('div', { class: 'login' }, h('div', { class: 'box' },
    h('div', { class: 'brand' }, h('div', { class: 'logo' }, icon('box')), 'WareTrack 3D'),
    h('h1', null, 'Sign in'), h('p', null, 'Interactive 3D warehouse management'), form,
    h('div', { class: 'demo' }, h('b', null, 'Demo accounts (local seed data)'), DEMO.map(([r, e, p]) => h('button', { type: 'button', onClick: () => { email.value = e; pass.value = p; } }, `${r} – ${e}`))))));
}

export function signOut(callApi = true) {
  if (callApi) api.post('/auth/logout').catch(() => {});
  session.token = null; app.world?.dispose?.(); app.world = null; app.worldView = null; app.scene = null; showLogin();
}

let simActive = false;
let simSpeed = 1;
let simTimer = null;

const PERSONAS = [
  { label: 'Alex Chen · Platform Master (Super Admin)', email: 'admin@waretrack.local', pass: 'Admin@123' },
  { label: 'David Park · Riverside Director (Client Admin)', email: 'admin@riversidehub.local', pass: 'Admin@123' },
  { label: 'Priya Nair · Receiving Lead (Dept Manager)', email: 'manager@waretrack.local', pass: 'Manager@123' },
  { label: 'Elena Petrova · Inventory Lead (Dept Manager)', email: 'inventory@waretrack.local', pass: 'Inventory@123' },
  { label: 'Aisha Khan · Ground Worker (Operator)', email: 'employee@waretrack.local', pass: 'Employee@123' }
];

async function switchPersona(email, pass) {
  try {
    const r = await api.post('/auth/login', { email, password: pass });
    session.token = r.token;
    app.user = r.user;
    app.unread = 0;
    toast('Role Switched', `Logged in as ${r.user.name} (${ROLE_LABELS[r.user.role]})`, 'success');
    showShell();
  } catch (e) {
    toast('Switch failed', e.message, 'error');
  }
}

function toggleSim() {
  simActive = !simActive;
  if (simActive) {
    startSimLoop();
    toast('Auto-Pilot ON', `Live simulation active (${simSpeed}x speed)`, 'success');
  } else {
    stopSimLoop();
    toast('Auto-Pilot OFF', 'Warehouse in 100% manual control mode', 'info');
  }
  showShell();
}

function startSimLoop() {
  stopSimLoop();
  const delay = Math.max(7000, 22000 / simSpeed);
  simTimer = setInterval(async () => {
    if (!simActive || !app.user) return;
    try {
      const act = Math.floor(Math.random() * 3);
      if (act === 0) {
        // Auto-generate customer order
        const prods = (await api.get('/products')).items.filter((p) => p.available > 5);
        if (prods.length) {
          const p = prods[Math.floor(Math.random() * prods.length)];
          const custs = ['Northwind Traders', 'Bluebird Cafe', 'Summit Sports', 'PharmaCare Logistics'];
          const c = custs[Math.floor(Math.random() * custs.length)];
          await api.post('/orders', { customerName: c, items: [{ productId: p.id, quantity: Math.min(10, Math.floor(Math.random() * 4) + 1) }] });
        }
      } else if (act === 1) {
        // Assign pending task to available employee
        const tasks = (await api.get('/tasks', { status: 'pending' })).items;
        const free = (await api.get('/employees')).items.filter((e) => e.status === 'available');
        if (tasks.length && free.length) {
          await api.post(`/tasks/${tasks[0].id}/assign`, { employeeId: free[0].id });
        }
      }
    } catch { /* ignore sim errors */ }
  }, delay);
}

function stopSimLoop() {
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
}

// ----------------------------------------------------------------------------------------- shell
function showShell() {
  const visible = NAV.filter((n) => can(app.user.role, n.perm));
  els = {};
  els.search = h('input', { type: 'search', placeholder: 'Search products, orders, vehicles, workers, racks…', 'aria-label': 'Search', autocomplete: 'off' });
  els.results = h('div', { class: 'search-results hidden' });
  els.live = h('div', { class: 'live', title: 'Data freshness' }, 'LIVE');
  els.bell = h('button', { class: 'icon-btn', 'aria-label': 'Notifications', onClick: toggleBell }, icon('bell'));
  els.bellWrap = h('div', { style: { position: 'relative' } }, els.bell);
  els.userWrap = h('div', { style: { position: 'relative' } });
  els.rail = h('nav', { class: 'rail', 'aria-label': 'Main' }, visible.map((n) => h('button', { 'data-id': n.id, title: n.label, onClick: () => { location.hash = `#/${n.id}`; } }, icon(n.icon), n.label)));
  els.worldHost = h('div', { class: 'world' });
  els.sheet = h('div', { class: 'sheet hidden' });

  const personaSelect = h('select', {
    style: { fontSize: '12px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' },
    onChange: (e) => {
      const p = PERSONAS.find((x) => x.email === e.target.value);
      if (p) switchPersona(p.email, p.pass);
    }
  }, PERSONAS.map((p) => h('option', { value: p.email, selected: p.email === app.user?.email }, p.label)));

  const simBtn = h('button', {
    class: `btn sm ${simActive ? 'primary' : ''}`,
    title: 'Toggle live autonomous simulation engine',
    style: { fontWeight: '700' },
    onClick: toggleSim
  }, simActive ? 'Auto-Pilot: ON' : 'Auto-Pilot: OFF');

  const speedSelect = h('select', {
    style: { fontSize: '11px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' },
    onChange: (e) => { simSpeed = Number(e.target.value); if (simActive) startSimLoop(); }
  }, [1, 2, 5].map((s) => h('option', { value: s, selected: simSpeed === s }, `${s}x`)));

  mount(root, h('div', { class: 'shell' },
    h('header', { class: 'topbar' },
      h('div', { class: 'brand', style: { cursor: 'pointer' }, onClick: () => { location.hash = '#/world'; app.world?.select?.({ type: 'office', id: 1 }, { focus: true }); } },
        h('div', { class: 'logo' }, icon('box')), h('span', null, 'WareTrack 3D')),
      h('div', { class: 'search' }, icon('search'), els.search, els.results),
      h('div', { class: 'wh-nav-pills', style: { display: 'flex', gap: '6px', alignItems: 'center', marginLeft: '10px' } },
        h('button', { class: 'btn sm', title: 'Focus WareTrack WH-01', onClick: () => { location.hash = '#/world'; app.world?.select?.({ type: 'warehouse', id: 1 }, { focus: true }); } }, 'WH-01: WareTrack'),
        h('button', { class: 'btn sm primary', title: 'Focus Riverside Hub WH-02', onClick: () => { location.hash = '#/world'; app.world?.select?.({ type: 'warehouse', id: 2 }, { focus: true }); } }, 'WH-02: Riverside Hub'),
        h('button', { class: 'btn sm', title: 'Focus Management Office', onClick: () => { location.hash = '#/world'; app.world?.select?.({ type: 'office', id: 1 }, { focus: true }); } }, 'Management Office')),
      h('div', { class: 'spacer' }),
      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginRight: '8px' } },
        simBtn, simActive && speedSelect, personaSelect),
      els.live, els.bellWrap, els.userWrap),
    els.rail, h('main', { class: 'main' }, els.worldHost, els.sheet)));
  renderUser(); renderBell();
  els.search.addEventListener('input', debounce(runSearch, 250));
  els.search.addEventListener('focus', () => els.results.childElementCount && els.results.classList.remove('hidden'));
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) els.results.classList.add('hidden'); if (!e.target.closest('[data-pop]') && !e.target.closest('.icon-btn') && !e.target.closest('.usermenu')) closePops(); });
  stopEvents();
  stopEvents = connectEvents({
    changed: onChanged, sync: (e) => { app.sync = e.syncedAt; updateLive(); },
    notification: (e) => { toast(e.notification.title, e.notification.message, e.notification.level); refreshUnread(); },
    connection: (ok) => { app.connected = ok; updateLive(); },
  });
  setInterval(updateLive, 20000);
  if (!location.hash || location.hash === '#/') location.hash = '#/world';
  route();
}

function updateLive() {
  const last = app.scene?.meta?.sync?.lastSyncAt || app.sync;
  const stale = !app.connected || (last && Date.now() - Date.parse(last) > 30 * 60000);
  els.live.classList.toggle('stale', !!stale);
  els.live.textContent = !app.connected ? 'RECONNECTING…' : `LIVE · updated ${fmt.ago(last || app.scene?.meta?.serverTime)}`;
}

const refreshSceneSoon = debounce(() => refreshScene(), 150);
const refreshViewSoon = debounce(() => app.viewApi?.refresh?.(), 200);
function onChanged() { refreshSceneSoon(); if (app.route !== 'world') refreshViewSoon(); else app.viewApi?.refresh?.(); refreshUnread(); }

export async function refreshScene() {
  try {
    app.scene = await api.get('/scene');
    app.world?.applyData(app.scene);
    app.worldView?.onScene?.(app.scene);
    updateLive();
  } catch (e) { if (e.status !== 401) console.warn('scene refresh failed', e.message); }
}
async function refreshUnread() { try { const r = await api.get('/notifications', { limit: 1 }); app.unread = r.unread; renderBell(); } catch { /* ignore */ } }

function renderBell() {
  els.bell.querySelector('.dot')?.remove();
  if (app.unread > 0) els.bell.appendChild(h('span', { class: 'dot' }, app.unread > 99 ? '99+' : app.unread));
}
function closePops() { els.bellWrap.querySelector('[data-pop]')?.remove(); els.userWrap.querySelector('[data-pop]')?.remove(); }
async function toggleBell() {
  if (els.bellWrap.querySelector('[data-pop]')) return closePops();
  closePops();
  const pop = h('div', { class: 'dropdown', 'data-pop': '1' }, h('div', { class: 'spinner' }));
  els.bellWrap.appendChild(pop);
  try {
    const r = await api.get('/notifications', { limit: 30 });
    mount(pop, h('div', { class: 'item', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, h('b', null, 'Notifications'),
      h('button', { class: 'btn sm', onClick: async () => { const x = await api.post('/notifications/read', {}); app.unread = x.unread; renderBell(); toggleBell(); toggleBell(); } }, 'Mark all read')),
    r.items.length ? r.items.map((n) => h('div', { class: `item ${n.is_read ? '' : 'unread'}` }, h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'space-between' } }, h('b', null, n.title), badge(n.level)), h('span', null, n.message), h('div', { class: 'muted', style: { fontSize: '11px', marginTop: '3px' } }, fmt.ago(n.created_at)))) : h('div', { class: 'empty' }, 'No notifications'));
  } catch (e) { mount(pop, h('div', { class: 'empty' }, e.message)); }
}
function renderUser() {
  const u = app.user; const initials = u.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const btn = h('button', { class: 'usermenu', 'aria-label': 'Account menu', onClick: () => {
    if (els.userWrap.querySelector('[data-pop]')) return closePops(); closePops();
    els.userWrap.appendChild(h('div', { class: 'dropdown', 'data-pop': '1', style: { width: '230px' } },
      h('div', { class: 'item' }, h('b', null, u.name), h('span', null, u.email)),
      h('div', { class: 'item' }, h('button', { class: 'btn sm', style: { width: '100%' }, onClick: changePassword }, icon('lock'), 'Change password')),
      h('div', { class: 'item' }, h('button', { class: 'btn sm danger', style: { width: '100%' }, onClick: () => signOut() }, icon('logout'), 'Sign out'))));
  } }, h('div', { class: 'avatar' }, initials), h('div', { class: 'who' }, h('b', null, u.name), h('span', null, ROLE_LABELS[u.role])));
  mount(els.userWrap, btn);
}
function changePassword() {
  closePops();
  formModal({ title: 'Change password', submitLabel: 'Change password', fields: [
    { name: 'currentPassword', label: 'Current password', type: 'password', required: true },
    { name: 'newPassword', label: 'New password', type: 'password', required: true, help: 'At least 8 characters with a letter and a number.' }],
  onSubmit: async (v, m) => { await api.post('/auth/change-password', v); m.close(); toast('Password changed', 'Please sign in again.', 'success'); signOut(false); } });
}

// ----------------------------------------------------------------------------------------- search
async function runSearch() {
  const q = els.search.value.trim();
  if (q.length < 2) { els.results.classList.add('hidden'); return; }
  try {
    const { groups } = await api.get('/search', { q });
    const names = { products: 'Products', orders: 'Orders', vehicles: 'Vehicles', employees: 'Workers', racks: 'Racks' };
    const content = Object.entries(groups).filter(([, v]) => v.length).map(([g, items]) => [h('div', { class: 'grp' }, names[g]), items.map((it) => h('button', { onClick: () => { els.results.classList.add('hidden'); els.search.value = ''; openEntity(it.type, it.id); } }, h('span', null, it.title), h('small', null, it.subtitle)))]);
    mount(els.results, content.length ? content : h('div', { class: 'empty' }, `No results for “${q}”`));
    els.results.classList.remove('hidden');
  } catch (e) { toastError(e); }
}

/** Jump to a record: 3D objects are focused in the world, records open in their management view. */
export async function openEntity(type, id) {
  const world = { rack: 'rack', vehicle: 'vehicle', employee: 'worker', dock: 'dock' }[type];
  if (world) { location.hash = '#/world'; await ready; setTimeout(() => app.viewApi?.focusEntity?.({ type: world, id }), 60); return; }
  const view = { product: 'inventory', order: 'orders', delivery: 'deliveries', shipment: 'receiving' }[type];
  if (view) { location.hash = `#/${view}`; await ready; setTimeout(() => app.viewApi?.open?.(id), 80); }
}

// ----------------------------------------------------------------------------------------- routing
let ready = Promise.resolve();
async function route() {
  const id = (location.hash.replace(/^#\//, '').split('?')[0]) || 'world';
  const nav = NAV.find((n) => n.id === id && can(app.user.role, n.perm)) || NAV.find((n) => can(app.user.role, n.perm));
  if (!nav) return;
  if (location.hash !== `#/${nav.id}`) { location.hash = `#/${nav.id}`; return; }
  app.route = nav.id;
  els.rail.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.id === nav.id));
  ready = (async () => {
    try {
      const mod = await loaders[nav.id]();
      if (app.route !== nav.id) return;
      const isWorld = nav.id === 'world';
      els.worldHost.classList.toggle('hidden', !isWorld); els.sheet.classList.toggle('hidden', isWorld);
      if (isWorld) {
        app.viewApi = (await mod.show(els.worldHost, app)) || {};
      } else {
        app.world?.setPaused?.(true);
        clear(els.sheet); els.sheet.scrollTop = 0; mount(els.sheet, h('div', { class: 'spinner' }));
        const body = h('div'); const api2 = await mod.render(body, app);
        mount(els.sheet, body); app.viewApi = api2 || {};
      }
    } catch (e) { console.error(e); toastError(e); }
  })();
  await ready;
}
