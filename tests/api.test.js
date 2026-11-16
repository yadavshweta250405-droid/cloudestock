import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.WARETRACK_QUIET = '1';
const { loadConfig } = await import('../backend/src/config.js');
const { createApp } = await import('../backend/src/server.js');
const { seedDatabase, DEMO_USERS } = await import('../database/seed.js');

let app; let base; const tokens = {}; let ctx;
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));

async function api(method, url, body, token) {
  const res = await fetch(base + url, {
    method, headers: { ...(body !== undefined && !(body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
const as = (role) => tokens[role];
/** racks with enough free capacity and a free pallet position */
const freeRacks = (minFree, n = 1, exclude = []) => ctx.db.all(
  `SELECT r.id, r.code FROM storage_racks r LEFT JOIN (SELECT rack_id, SUM(quantity) q, COUNT(*) p FROM inventory WHERE quantity > 0 GROUP BY rack_id) u ON u.rack_id = r.id
   WHERE r.capacity - COALESCE(u.q,0) >= ? AND COALESCE(u.p,0) < r.max_pallets ${exclude.length ? `AND r.id NOT IN (${exclude.join(',')})` : ''} ORDER BY r.id LIMIT ?`, [minFree, n]);
const get = (url, role = 'admin') => api('GET', url, undefined, as(role));
const post = (url, body, role = 'admin') => api('POST', url, body ?? {}, as(role));

before(async () => {
  const cfg = loadConfig({ port: 0, db: { file: ':memory:' }, storage: { dir: storageDir }, jobs: { vehicleReturnDelayMs: 400 }, autoSeed: false, sync: { intervalMs: 3600000 } });
  app = createApp(cfg, { log: { info() {}, warn() {}, error: console.error } });
  await seedDatabase(app.ctx);
  const addr = await app.start();
  ctx = app.ctx;
  base = `http://127.0.0.1:${addr.port}`;
  for (const u of DEMO_USERS) {
    const r = await api('POST', '/api/auth/login', { email: u.email, password: u.password });
    assert.equal(r.status, 200, `login ${u.role}`);
    tokens[u.role] = r.body.token;
  }
});
after(async () => { await app.stop(); fs.rmSync(storageDir, { recursive: true, force: true }); });

// ------------------------------------------------------------------ auth
test('auth: rejects bad credentials, anonymous access and unknown routes', async () => {
  assert.equal((await api('POST', '/api/auth/login', { email: 'admin@waretrack.local', password: 'wrong' })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { email: 'nope', password: 'x' })).status, 422);
  assert.equal((await api('GET', '/api/products')).status, 401);
  assert.equal((await api('GET', '/api/products', undefined, 'garbage')).status, 401);
  assert.equal((await get('/api/does-not-exist')).status, 404);
  const me = await get('/api/auth/me');
  assert.equal(me.body.user.role, 'admin');
  assert.ok(!JSON.stringify(me.body).includes('password'));
});
test('auth: role based permissions', async () => {
  assert.equal((await get('/api/users', 'employee')).status, 403);
  assert.equal((await get('/api/users', 'inventory_manager')).status, 403);
  assert.equal((await get('/api/users', 'admin')).status, 200);
  assert.equal((await post('/api/products', { sku: 'X-1', name: 'Nope' }, 'employee')).status, 403);
  assert.equal((await post('/api/deliveries', { vehicleId: 1, orderIds: [1] }, 'inventory_manager')).status, 403);
  assert.equal((await post('/api/employees', { name: 'Zed Zed', department: 'Picking' }, 'inventory_manager')).status, 403);
  assert.equal((await get('/api/scene', 'employee')).status, 200);
});
test('auth: user management, password policy, logout invalidates token', async () => {
  const bad = await post('/api/users', { email: 'x@y.co', name: 'Test User', password: 'short', role: 'employee' });
  assert.equal(bad.status, 422); assert.ok(bad.body.error.details.password);
  const ok = await post('/api/users', { email: 'temp@waretrack.local', name: 'Temp User', password: 'Temp1234', role: 'employee' });
  assert.equal(ok.status, 201);
  assert.equal((await post('/api/users', { email: 'temp@waretrack.local', name: 'Dup User', password: 'Temp1234', role: 'employee' })).status, 409);
  const login = await api('POST', '/api/auth/login', { email: 'temp@waretrack.local', password: 'Temp1234' });
  assert.equal(login.status, 200);
  assert.equal((await api('POST', '/api/auth/logout', {}, login.body.token)).status, 200);
  assert.equal((await api('GET', '/api/auth/me', undefined, login.body.token)).status, 401);
  const self = await api('PATCH', `/api/users/${(await get('/api/auth/me')).body.user.id}`, { active: false }, as('admin'));
  assert.equal(self.status, 409);
  const scrypt = ctx.db.get('SELECT password_hash h FROM users LIMIT 1').h;
  assert.ok(scrypt.startsWith('scrypt$'));
});

// ------------------------------------------------------------------ products & inventory
let newProduct;
test('products: CRUD with validation', async () => {
  assert.equal((await post('/api/products', { sku: 'bad sku', name: 'x' }, 'inventory_manager')).status, 422);
  const c = await post('/api/products', { sku: 'test-001', name: 'Test Widget', unitPrice: 12.5, reorderLevel: 10, categoryId: 1 }, 'inventory_manager');
  assert.equal(c.status, 201); newProduct = c.body;
  assert.equal(newProduct.sku, 'TEST-001'); assert.equal(newProduct.onHand, 0); assert.equal(newProduct.status, 'out');
  assert.equal((await post('/api/products', { sku: 'TEST-001', name: 'Dup' })).status, 409);
  const u = await api('PUT', `/api/products/${newProduct.id}`, { name: 'Test Widget v2', unitPrice: 15 }, as('inventory_manager'));
  assert.equal(u.body.name, 'Test Widget v2'); assert.equal(u.body.unitPrice, 15);
  const list = await get('/api/products?q=widget');
  assert.ok(list.body.items.some((p) => p.id === newProduct.id));
  assert.ok((await get('/api/products?status=low')).body.items.every((p) => p.status === 'low'));
});
test('inventory: receive, capacity, pallet limit, issue, adjust, transfer — all recorded in history', async () => {
  const [rack, rack2] = freeRacks(250, 2);
  assert.equal((await post('/api/inventory/receive', { productId: newProduct.id, rackId: rack.id, quantity: 0 }, 'inventory_manager')).status, 422);
  const tooMuch = await post('/api/inventory/receive', { productId: newProduct.id, rackId: rack.id, quantity: 601, batchNo: 'T1' }, 'inventory_manager');
  assert.equal(tooMuch.status, 409); assert.match(tooMuch.body.error.message, /capacity/i);
  assert.equal((await post('/api/inventory/receive', { productId: newProduct.id, rackId: rack.id, quantity: 100, batchNo: 'T1' }, 'inventory_manager')).status, 201);
  assert.equal((await post('/api/inventory/receive', { productId: newProduct.id, rackId: rack.id, quantity: 100, batchNo: 'T1' }, 'inventory_manager')).status, 201);
  assert.equal(ctx.db.get('SELECT quantity q FROM inventory WHERE product_id=? AND rack_id=?', [newProduct.id, rack.id]).q, 200);
  const p = (await get(`/api/products/${newProduct.id}`)).body;
  assert.equal(p.onHand, 200); assert.equal(p.locations.length, 1); assert.equal(p.movements[0].type, 'IN'); assert.equal(p.movements[0].balanceAfter, 200);
  assert.equal((await post('/api/inventory/issue', { productId: newProduct.id, rackId: rack.id, batchNo: 'T1', quantity: 500 })).status, 409);
  assert.equal((await post('/api/inventory/issue', { productId: newProduct.id, rackId: rack.id, batchNo: 'T1', quantity: 50, reason: 'Damaged' })).status, 200);
  const inv = ctx.db.get('SELECT id FROM inventory WHERE product_id=? AND rack_id=?', [newProduct.id, rack.id]);
  assert.equal((await post('/api/inventory/adjust', { inventoryId: inv.id, newQuantity: 120, reason: 'Cycle count' })).status, 200);
  assert.equal((await post('/api/inventory/adjust', { inventoryId: inv.id, newQuantity: 120, reason: 'same' })).status, 400);
  assert.equal((await post('/api/inventory/transfer', { inventoryId: inv.id, toRackId: rack2.id, quantity: 20 })).status, 200);
  assert.equal(ctx.db.get('SELECT SUM(quantity) q FROM inventory WHERE product_id=?', [newProduct.id]).q, 120);
  const types = (await get(`/api/stock-movements?productId=${newProduct.id}`)).body.items.map((m) => m.type);
  for (const t of ['IN', 'OUT', 'ADJUST', 'TRANSFER_IN', 'TRANSFER_OUT']) assert.ok(types.includes(t), t);
  // low-stock alert (120 > reorder 15 -> ok) then drop below
  await api('PUT', `/api/products/${newProduct.id}`, { reorderLevel: 30 }, as('admin'));
  assert.equal((await post('/api/inventory/issue', { productId: newProduct.id, rackId: rack.id, batchNo: 'T1', quantity: 95 })).status, 200);
  assert.ok((await get('/api/notifications')).body.items.some((n) => n.title === 'Low stock: TEST-001'));
});
test('inventory: pallet positions limited to 6 per rack; suggestions work', async () => {
  const [rack] = freeRacks(100);
  const have = ctx.db.get('SELECT COUNT(*) c FROM inventory WHERE rack_id = ? AND quantity > 0', [rack.id]).c;
  const prods = (await get('/api/products')).body.items;
  let failed = null; let ok = 0;
  for (let i = 0; i < 7 && !failed; i++) {
    const r = await post('/api/inventory/receive', { productId: prods[i].id, rackId: rack.id, quantity: 10, batchNo: `PL${i}` });
    if (r.status === 201) ok++; else failed = r;
  }
  assert.equal(ok, 6 - have, 'exactly the free pallet positions can be filled');
  assert.equal(failed.status, 409); assert.match(failed.body.error.message, /pallet position/);
  const s = await get(`/api/inventory/suggest-rack?productId=${prods[0].id}&quantity=20`);
  assert.equal(s.status, 200); assert.ok(s.body.items.length > 0);
  assert.ok(s.body.items.every((x) => x.rackId !== rack.id || x.freePallets > 0));
});
test('products: delete removes unused, archives products with history, blocks products in stock', async () => {
  assert.equal((await api('DELETE', `/api/products/${newProduct.id}`, undefined, as('admin'))).status, 409);   // still in stock
  const fresh = (await post('/api/products', { sku: 'TEMP-DEL', name: 'Temp Delete Me' })).body;
  const d = await api('DELETE', `/api/products/${fresh.id}`, undefined, as('admin'));
  assert.equal(d.body.mode, 'removed'); assert.equal((await get(`/api/products/${fresh.id}`)).status, 404);
});
test('products: image upload validates content and is served', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const noType = await api('POST', `/api/products/${newProduct.id}/image`, png, as('admin'));
  assert.equal(noType.status, 415);   // content-type missing
  const res = await fetch(`${base}/api/products/${newProduct.id}/image`, { method: 'POST', headers: { Authorization: `Bearer ${as('admin')}`, 'Content-Type': 'image/png' }, body: png });
  assert.equal(res.status, 200); const { imageUrl } = await res.json();
  const img = await fetch(base + imageUrl); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  const fake = await fetch(`${base}/api/products/${newProduct.id}/image`, { method: 'POST', headers: { Authorization: `Bearer ${as('admin')}`, 'Content-Type': 'image/png' }, body: Buffer.from('not an image') });
  assert.equal(fake.status, 400);
});

// ------------------------------------------------------------------ orders & deliveries
const orderBody = (items, extra = {}) => ({ customerName: 'Test Customer', deliveryAddress: '1 Test Street', city: 'Testville', items, ...extra });
test('orders: create reserves stock; insufficient stock rejected atomically; cancel releases', async () => {
  const p = ctx.db.get(`SELECT p.id, SUM(i.quantity) q, SUM(i.reserved) r FROM products p JOIN inventory i ON i.product_id=p.id WHERE p.sku='HOME-BTL' GROUP BY p.id`);
  const before = p.r;
  assert.equal((await post('/api/orders', orderBody([]), 'inventory_manager')).status, 422);
  const tooBig = await post('/api/orders', orderBody([{ productId: p.id, quantity: p.q + 1 }]));
  assert.equal(tooBig.status, 409); assert.match(tooBig.body.error.message, /Insufficient stock/);
  assert.equal(ctx.db.get('SELECT COALESCE(SUM(reserved),0) r FROM inventory WHERE product_id=?', [p.id]).r, before, 'failed order must not leave reservations');
  const o = await post('/api/orders', orderBody([{ productId: p.id, quantity: 10 }, { productId: p.id, quantity: 5 }]), 'inventory_manager');
  assert.equal(o.status, 201); assert.equal(o.body.status, 'Pending'); assert.equal(o.body.items.length, 1); assert.equal(o.body.items[0].quantity, 15);
  assert.equal(ctx.db.get('SELECT SUM(reserved) r FROM inventory WHERE product_id=?', [p.id]).r, before + 15);
  const edit = await api('PUT', `/api/orders/${o.body.id}`, { items: [{ productId: p.id, quantity: 4 }] }, as('admin'));
  assert.equal(edit.body.unitCount, 4); assert.equal(ctx.db.get('SELECT SUM(reserved) r FROM inventory WHERE product_id=?', [p.id]).r, before + 4);
  assert.equal((await post(`/api/orders/${o.body.id}/status`, { status: 'Delivered' })).status, 409);   // illegal jump
  const c = await post(`/api/orders/${o.body.id}/status`, { status: 'Cancelled' });
  assert.equal(c.body.status, 'Cancelled'); assert.equal(ctx.db.get('SELECT SUM(reserved) r FROM inventory WHERE product_id=?', [p.id]).r, before);
  assert.equal((await post(`/api/orders/${o.body.id}/status`, { status: 'Pending' })).status, 409);
});
test('orders + deliveries: full fulfilment flow updates stock, vehicle, dock, workers and returns the vehicle', async () => {
  const p = ctx.db.get(`SELECT p.id FROM products p WHERE p.sku='ELEC-SPKR'`);
  const stockBefore = ctx.db.get('SELECT SUM(quantity) q FROM inventory WHERE product_id=?', [p.id]).q;
  const o = (await post('/api/orders', orderBody([{ productId: p.id, quantity: 7 }]), 'inventory_manager')).body;
  // cannot assign a delivery before the order is packed
  const vehicle = ctx.db.get(`SELECT * FROM vehicles WHERE status='available' AND driver_id IS NOT NULL AND type='truck' ORDER BY id LIMIT 1`);
  assert.equal((await post('/api/deliveries', { vehicleId: vehicle.id, orderIds: [o.id] })).status, 409);
  const pr = (await post(`/api/orders/${o.id}/status`, { status: 'Processing' })).body;
  const task = ctx.db.get(`SELECT * FROM tasks WHERE reference_type='order' AND reference_id=? AND type='picking'`, [o.id]);
  assert.ok(task, 'picking task created'); assert.equal(pr.status, 'Processing');
  assert.equal((await post(`/api/orders/${o.id}/status`, { status: 'Packed' })).body.status, 'Packed');
  assert.equal(ctx.db.get('SELECT status FROM tasks WHERE id=?', [task.id]).status, 'done');
  assert.equal((await post(`/api/orders/${o.id}/status`, { status: 'Dispatched' })).status, 409);    // no vehicle yet
  assert.equal((await post(`/api/orders/${o.id}/status`, { status: 'Ready for Dispatch' })).body.status, 'Ready for Dispatch');
  // capacity check against a tiny van
  const del = await post('/api/deliveries', { vehicleId: vehicle.id, orderIds: [o.id] });
  assert.equal(del.status, 201); assert.equal(del.body.status, 'Loading');
  assert.equal(ctx.db.get('SELECT status FROM vehicles WHERE id=?', [vehicle.id]).status, 'loading');
  assert.equal(ctx.db.get('SELECT status FROM docks WHERE id=?', [del.body.dockId]).status, 'occupied');
  const sceneLoading = (await get('/api/scene')).body;
  assert.equal(sceneLoading.docks.find((d) => d.id === del.body.dockId).vehicle.code, vehicle.code);
  assert.equal((await post('/api/deliveries', { vehicleId: vehicle.id, orderIds: [o.id] })).status, 409);   // vehicle busy
  // dispatch deducts stock exactly once
  const disp = await post(`/api/deliveries/${del.body.id}/dispatch`);
  assert.equal(disp.body.status, 'In Transit');
  assert.equal(ctx.db.get('SELECT SUM(quantity) q FROM inventory WHERE product_id=?', [p.id]).q, stockBefore - 7);
  assert.equal(ctx.db.get('SELECT SUM(reserved) r FROM inventory WHERE product_id=? ', [p.id]).r, ctx.db.get(`SELECT COALESCE(SUM(a.quantity),0) r FROM order_allocations a JOIN inventory v ON v.id=a.inventory_id WHERE v.product_id=?`, [p.id]).r);
  assert.equal(ctx.db.get('SELECT status FROM vehicles WHERE id=?', [vehicle.id]).status, 'on_route');
  assert.equal(ctx.db.get('SELECT status FROM docks WHERE id=?', [del.body.dockId]).status, 'free');
  assert.equal((await get(`/api/orders/${o.id}`)).body.status, 'Dispatched');
  assert.equal((await post(`/api/deliveries/${del.body.id}/dispatch`)).status, 409);                      // not twice
  assert.equal((await post(`/api/orders/${o.id}/status`, { status: 'Cancelled' })).status, 409);          // on the road
  // deliver -> vehicle returns by itself (background job)
  const done = await post(`/api/orders/${o.id}/status`, { status: 'Delivered' });
  assert.equal(done.body.status, 'Delivered');
  assert.equal(ctx.db.get('SELECT status FROM vehicles WHERE id=?', [vehicle.id]).status, 'returning');
  await new Promise((r) => setTimeout(r, 900));
  const back = ctx.db.get('SELECT * FROM vehicles WHERE id=?', [vehicle.id]);
  assert.equal(back.status, 'available'); assert.notEqual(back.parking_slot, null);
  assert.equal(ctx.db.get('SELECT status FROM drivers WHERE id=?', [vehicle.driver_id]).status, 'available');
  const mv = (await get(`/api/stock-movements?productId=${p.id}&type=OUT`)).body.items[0];
  assert.equal(mv.quantity, -7); assert.equal(mv.referenceType, 'order');
});
test('deliveries: capacity limit, cancel frees resources, maintenance vehicles refused', async () => {
  const p = ctx.db.get(`SELECT id FROM products WHERE sku='APP-TEE'`);
  const van = ctx.db.get(`SELECT * FROM vehicles WHERE code='VAN-201'`);
  const o = (await post('/api/orders', orderBody([{ productId: p.id, quantity: 160 }]))).body;
  for (const s of ['Processing', 'Packed', 'Ready for Dispatch']) await post(`/api/orders/${o.id}/status`, { status: s });
  const big = await post('/api/deliveries', { vehicleId: van.id, orderIds: [o.id] });
  assert.equal(big.status, 409); assert.match(big.body.error.message, /capacity/);
  const maint = ctx.db.get(`SELECT id FROM vehicles WHERE status='maintenance'`);
  assert.equal((await post('/api/deliveries', { vehicleId: maint.id, orderIds: [o.id] })).status, 409);
  const truck = ctx.db.get(`SELECT * FROM vehicles WHERE status='available' AND capacity_units >= 400 ORDER BY id LIMIT 1`);
  const d = (await post('/api/deliveries', { vehicleId: truck.id, orderIds: [o.id] })).body;
  const cancel = await post(`/api/deliveries/${d.id}/cancel`);
  assert.equal(cancel.body.status, 'Cancelled');
  assert.equal(ctx.db.get('SELECT status FROM vehicles WHERE id=?', [truck.id]).status, 'available');
  assert.equal(ctx.db.get('SELECT status FROM docks WHERE id=?', [d.dockId]).status, 'free');
  assert.equal((await get(`/api/orders/${o.id}`)).body.deliveryId, null);
  // cancelling an order while it sits on a loading delivery removes it and aborts the empty delivery
  const d2 = (await post('/api/deliveries', { vehicleId: truck.id, orderIds: [o.id] })).body;
  assert.equal((await post(`/api/orders/${o.id}/status`, { status: 'Cancelled' })).body.status, 'Cancelled');
  assert.equal((await get(`/api/deliveries/${d2.id}`)).body.status, 'Cancelled');
  assert.equal(ctx.db.get('SELECT status FROM vehicles WHERE id=?', [truck.id]).status, 'available');
});
test('vehicles & drivers: register, validate, protect', async () => {
  const dr = await post('/api/drivers', { name: 'Test Driver', licenseNo: 'DL-999999' }); assert.equal(dr.status, 201);
  assert.equal((await post('/api/drivers', { name: 'Test Driver 2', licenseNo: 'DL-999999' })).status, 409);
  const v = await post('/api/vehicles', { plate: 'zz-0001', capacityUnits: 300, type: 'van', driverId: dr.body.id });
  assert.equal(v.status, 201); assert.equal(v.body.status, 'available'); assert.equal(v.body.plate, 'ZZ-0001');
  assert.equal((await post('/api/vehicles', { plate: 'ZZ-0001', capacityUnits: 300 })).status, 409);
  assert.equal((await api('PATCH', `/api/vehicles/${v.body.id}`, { status: 'maintenance' }, as('admin'))).body.status, 'maintenance');
  assert.equal((await api('DELETE', `/api/vehicles/${v.body.id}`, undefined, as('admin'))).status, 200);
});

// ------------------------------------------------------------------ receiving
test('receiving: schedule -> arrive -> partial receive -> complete, with auto putaway and dock release', async () => {
  const p = ctx.db.get(`SELECT id FROM products WHERE sku='ELEC-KEYB'`);
  const before = ctx.db.get('SELECT SUM(quantity) q FROM inventory WHERE product_id=?', [p.id]).q;
  const s = (await post('/api/shipments', { supplier: 'Test Supplier', items: [{ productId: p.id, quantity: 50 }] }, 'inventory_manager')).body;
  assert.equal(s.status, 'Scheduled');
  assert.equal((await post(`/api/shipments/${s.id}/receive`, {})).status, 409);   // not arrived yet
  const a = (await post(`/api/shipments/${s.id}/arrive`)).body;
  assert.equal(a.status, 'Arrived'); assert.ok(a.dockNumber);
  assert.equal((await get('/api/scene')).body.docks.find((d) => d.inbound?.id === s.id).status, 'occupied');
  const item = a.items[0];
  assert.equal((await post(`/api/shipments/${s.id}/receive`, { lines: [{ itemId: item.id, quantity: 60 }] })).status, 409);
  const part = (await post(`/api/shipments/${s.id}/receive`, { lines: [{ itemId: item.id, quantity: 20 }] })).body;
  assert.equal(part.status, 'Unloading');
  const full = (await post(`/api/shipments/${s.id}/receive`, {})).body;
  assert.equal(full.status, 'Received');
  assert.equal(ctx.db.get('SELECT SUM(quantity) q FROM inventory WHERE product_id=?', [p.id]).q, before + 50);
  assert.equal(ctx.db.get('SELECT status FROM docks WHERE id=?', [a.dockId]).status, 'free');
  assert.equal(ctx.db.get(`SELECT COUNT(*) c FROM tasks WHERE reference_type='shipment' AND reference_id=? AND status='done'`, [s.id]).c, 1);
});

// ------------------------------------------------------------------ employees / tasks / warehouse
test('employees & tasks: assignment drives availability; employees can only update their own tasks', async () => {
  const e = (await post('/api/employees', { name: 'Test Picker', department: 'Picking', jobTitle: 'Picker' })).body;
  assert.equal(e.status, 'available'); assert.match(e.code, /^EMP-/);
  assert.equal((await post('/api/employees', { name: 'X', department: 'Nope' })).status, 422);
  const t = (await post('/api/tasks', { title: 'Restock aisle 3', type: 'picking', assigneeId: e.id })).body;
  assert.equal(t.status, 'in_progress');
  assert.equal((await get(`/api/employees/${e.id}`)).body.status, 'busy');
  assert.equal((await api('PATCH', `/api/employees/${e.id}`, { status: 'off_duty' }, as('admin'))).status, 409);
  assert.equal((await post(`/api/tasks/${t.id}/complete`, {}, 'employee')).status, 403);          // not theirs
  const t2 = (await post('/api/tasks', { title: 'Queued job', type: 'picking', assigneeId: e.id })).body;
  assert.equal(t2.status, 'pending');
  assert.equal((await post(`/api/tasks/${t.id}/complete`)).body.status, 'done');
  assert.equal((await get(`/api/tasks/${t2.id}`)).body.status, 'in_progress', 'next queued task starts automatically');
  await post(`/api/tasks/${t2.id}/cancel`);
  assert.equal((await get(`/api/employees/${e.id}`)).body.status, 'available');
  // the employee user completes their own task
  const myId = (await get('/api/auth/me', 'employee')).body.user.employeeId;
  const mine = (await post('/api/tasks', { title: 'Own task', type: 'loading', assigneeId: myId })).body;
  assert.equal(mine.status, 'in_progress');
  assert.equal((await post(`/api/tasks/${mine.id}/complete`, {}, 'employee')).body.status, 'done');
  assert.equal((await api('DELETE', `/api/employees/${e.id}`, undefined, as('admin'))).body.mode, 'archived');
});
test('warehouse: structure, rack management rules', async () => {
  const w = (await get('/api/warehouse')).body;
  assert.equal(w.sections.length, 3); assert.equal(w.docks.length, 4);
  assert.equal(w.capacity, ctx.db.get('SELECT SUM(capacity) c FROM storage_racks').c);
  const full = w.sections.flatMap((s) => s.racks).find((r) => r.status === 'full');
  assert.ok(full);
  assert.equal((await api('PATCH', `/api/racks/${full.id}`, { capacity: 100 }, as('admin'))).status, 409);
  assert.equal((await api('DELETE', `/api/racks/${full.id}`, undefined, as('admin'))).status, 409);
  assert.equal((await post('/api/racks', { sectionId: w.sections[0].id, row: 1, col: 1 })).status, 409);   // already exists
  assert.equal((await post('/api/racks', { sectionId: w.sections[2].id, row: 3, col: 1 })).status, 400);   // outdoor has 2 rows
  assert.equal((await post('/api/docks', {})).status, 409);                                                // 3D building has 4 bays
  assert.equal((await post('/api/sections', { code: 'Z', name: 'Extra hall', zone: 'indoor' })).status, 409);
  assert.equal((await api('PATCH', `/api/docks/${w.docks[1].id}`, { status: 'maintenance' }, as('warehouse_manager'))).status, 200);
  await api('PATCH', `/api/docks/${w.docks[1].id}`, { status: 'free' }, as('admin'));
  assert.equal((await get(`/api/racks/${full.id}`)).body.pallets.length, 3);
});

// ------------------------------------------------------------------ dashboard / scene consistency / realtime
test('dashboard: every statistic equals the database', async () => {
  const d = (await get('/api/dashboard')).body;
  const q = (sql) => ctx.db.get(sql).c;
  assert.equal(d.kpis.totalProducts, q('SELECT COUNT(*) c FROM products WHERE active=1'));
  assert.equal(d.kpis.totalInventory, q('SELECT SUM(quantity) c FROM inventory'));
  assert.equal(d.kpis.totalOrders, q('SELECT COUNT(*) c FROM orders'));
  assert.equal(d.kpis.completedOrders, q(`SELECT COUNT(*) c FROM orders WHERE status='Delivered'`));
  assert.equal(d.kpis.availableVehicles, q(`SELECT COUNT(*) c FROM vehicles WHERE status='available'`));
  assert.equal(d.kpis.warehouseCapacity, q('SELECT SUM(capacity) c FROM storage_racks'));
  assert.ok(Math.abs(d.kpis.warehouseUtilization - d.kpis.totalInventory / d.kpis.warehouseCapacity) < 1e-9);
  assert.equal(d.charts.inbound.length, 14); assert.equal(d.charts.stockLevel.at(-1), d.kpis.totalInventory);
  assert.ok(d.recentActivity.length > 0);
});
test('scene: racks/pallets/docks/vehicles/workers reflect the database', async () => {
  const s = (await get('/api/scene')).body;
  assert.equal(s.racks.length, ctx.db.get('SELECT COUNT(*) c FROM storage_racks').c);
  const palletUnits = s.racks.flatMap((r) => r.pallets).reduce((a, p) => a + p.quantity, 0);
  assert.equal(palletUnits, ctx.db.get('SELECT SUM(quantity) c FROM inventory').c);
  assert.equal(s.vehicles.length, ctx.db.get('SELECT COUNT(*) c FROM vehicles').c);
  assert.ok(s.racks.every((r) => r.pallets.length <= r.maxPallets));
  assert.ok(s.employees.some((e) => e.task));
  assert.ok(s.meta.sync.lastSyncAt === null || typeof s.meta.sync.lastSyncAt === 'string');
});
test('realtime: mutations push a "changed" event over SSE; sync writes a snapshot', async () => {
  const res = await fetch(`${base}/api/events?token=${as('admin')}`);
  assert.equal(res.status, 200);
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  const readUntil = async (needle) => { const t = Date.now(); while (!buf.includes(needle) && Date.now() - t < 3000) { const { value } = await reader.read(); buf += dec.decode(value); } return buf.includes(needle); };
  assert.ok(await readUntil('event: hello'));
  const pr = ctx.db.get('SELECT id FROM products LIMIT 1'); const [rk] = freeRacks(10);
  await post('/api/inventory/receive', { productId: pr.id, rackId: rk.id, quantity: 5, batchNo: 'RT1' });
  assert.ok(await readUntil('"inventory"')); assert.ok(buf.includes('event: changed'));
  await reader.cancel();
  assert.equal((await api('GET', '/api/events')).status, 401);
  const sync = await post('/api/sync/run'); assert.ok(sync.body.lastSyncAt);
  const snap = JSON.parse((await ctx.storage.get('snapshots/latest.json')).toString());
  assert.equal(snap.kpis.totalInventory, ctx.db.get('SELECT SUM(quantity) c FROM inventory').c);
  assert.equal((await post('/api/sync/run', {}, 'employee')).status, 403);
});
test('search, activity log and notifications', async () => {
  assert.ok((await get('/api/search?q=earbuds')).body.groups.products.length >= 1);
  assert.ok((await get('/api/search?q=TRK')).body.groups.vehicles.length >= 1);
  assert.deepEqual((await get('/api/search?q=a')).body.groups, {});
  assert.ok((await get('/api/activity')).body.items.length > 5);
  assert.equal((await get('/api/activity', 'employee')).status, 403);
  const n = await get('/api/notifications'); assert.ok(n.body.unread > 0);
  assert.equal((await post('/api/notifications/read', {})).body.unread, 0);
});
test('server: static frontend, SPA fallback, traversal blocked, bad JSON handled', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/shared/constants.js')).status, 200);
  assert.equal((await fetch(base + '/some/spa/route')).status, 200);
  assert.ok([400, 403, 404].includes((await fetch(base + '/shared/..%2f..%2fpackage.json')).status));
  assert.equal((await fetch(base + '/uploads/..%2f..%2fwaretrack.db')).status, 404);
  const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(base + '/api/health')).status, 200);
});
