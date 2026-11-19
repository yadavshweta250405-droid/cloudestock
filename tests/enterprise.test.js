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
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ent-'));

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
const get = (url, role = 'admin') => api('GET', url, undefined, as(role));
const post = (url, body, role = 'admin') => api('POST', url, body ?? {}, as(role));
const patch = (url, body, role = 'admin') => api('PATCH', url, body ?? {}, as(role));

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

test('enterprise: multiple warehouses listing, creation and structure', async () => {
  const list = await get('/api/warehouses');
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length >= 2, 'Has seeded warehouses');

  const created = await post('/api/warehouses', { name: 'Metro East Logistics Hub', address: '88 Express Highway', city: 'Boston' });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Metro East Logistics Hub');

  const whStructure = await get(`/api/warehouse?warehouseId=${created.body.id}`);
  assert.equal(whStructure.status, 200);
  assert.equal(whStructure.body.warehouse.id, created.body.id);
  assert.equal(whStructure.body.sections.length, 3);
  assert.equal(whStructure.body.docks.length, 4);
});

test('enterprise: purchase orders workflow and inventory receiving', async () => {
  const suppliers = await get('/api/suppliers');
  assert.equal(suppliers.status, 200);
  assert.ok(suppliers.body.items.length >= 1);
  const supId = suppliers.body.items[0].id;

  const prods = (await get('/api/products')).body.items;
  assert.ok(prods.length >= 2);

  const poRes = await post('/api/purchase-orders', {
    supplierId: supId,
    currency: 'USD',
    notes: 'Urgent restocking',
    items: [
      { productId: prods[0].id, quantity: 50, unitCost: 15 },
      { productId: prods[1].id, quantity: 30, unitCost: 25 }
    ]
  });
  assert.equal(poRes.status, 201);
  const poId = poRes.body.id;
  assert.equal(poRes.body.status, 'pending');
  assert.equal(poRes.body.items.length, 2);

  // Transition to approved
  const appRes = await patch(`/api/purchase-orders/${poId}/status`, { status: 'approved' });
  assert.equal(appRes.status, 200);
  assert.equal(appRes.body.status, 'approved');

  // Transition to ordered
  const ordRes = await patch(`/api/purchase-orders/${poId}/status`, { status: 'ordered' });
  assert.equal(ordRes.status, 200);
  assert.equal(ordRes.body.status, 'ordered');

  // Receive goods into warehouse
  const racks = (await get('/api/warehouse')).body.sections[0].racks;
  const recvRes = await post(`/api/purchase-orders/${poId}/receive`, {
    allocations: [
      { itemId: poRes.body.items[0].id, quantity: 50, rackId: racks[0].id },
      { itemId: poRes.body.items[1].id, quantity: 30, rackId: racks[1].id }
    ]
  });
  assert.equal(recvRes.status, 200);
  assert.equal(recvRes.body.status, 'completed');
  assert.equal(recvRes.body.items[0].received_quantity, 50);
});

test('enterprise: product returns workflow, inspection and restock', async () => {
  const prods = (await get('/api/products')).body.items;
  const retRes = await post('/api/returns', {
    customerName: 'Marcus Sterling',
    customerEmail: 'marcus@sterling.org',
    reason: 'damaged',
    notes: 'Outer packaging arrived scuffed',
    refundAmount: 75.50,
    items: [
      { productId: prods[0].id, quantity: 5, condition: 'opened_good' }
    ]
  });
  assert.equal(retRes.status, 201);
  const retId = retRes.body.id;
  assert.equal(retRes.body.status, 'requested');

  // Inspect and approve
  const inspRes = await patch(`/api/returns/${retId}/inspect`, {
    approved: true,
    inspectionNotes: 'Items inspected and confirmed in resellable condition',
    itemConditions: [{ itemId: retRes.body.items[0].id, condition: 'opened_good' }]
  });
  assert.equal(inspRes.status, 200);
  assert.equal(inspRes.body.status, 'approved');

  // Restock into warehouse rack
  const rack = (await get('/api/warehouse')).body.sections[0].racks[0];
  const restockRes = await post(`/api/returns/${retId}/restock`, {
    allocations: [
      { itemId: retRes.body.items[0].id, quantity: 5, rackId: rack.id }
    ]
  });
  assert.equal(restockRes.status, 200);
  assert.equal(restockRes.body.status, 'restocked');
  assert.equal(restockRes.body.items[0].restocked_quantity, 5);
});

test('enterprise: multi-currency listing and exchange rate update', async () => {
  const currencies = await get('/api/currencies');
  assert.equal(currencies.status, 200);
  assert.ok(currencies.body.items.length >= 5);
  const eur = currencies.body.items.find(c => c.code === 'EUR');
  assert.ok(eur);

  const upd = await patch('/api/currencies/EUR', { exchangeRate: 0.94 });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.exchange_rate, 0.94);
});

test('enterprise: multi-item order pick-path generation', async () => {
  const orders = (await get('/api/orders')).body.items;
  const processingOrder = orders.find(o => o.status === 'Processing') || orders[0];
  assert.ok(processingOrder);

  const pp = await get(`/api/orders/${processingOrder.id}/pick-path`);
  assert.equal(pp.status, 200);
  assert.ok(Array.isArray(pp.body.stops));
  assert.equal(pp.body.orderId, processingOrder.id);
});
