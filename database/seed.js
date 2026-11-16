// Seeds demo data. Usage: npm run db:seed   |   npm run db:reset (wipes the database first)
// Historical data is inserted directly (with back-dated timestamps and a consistent movement ledger);
// the "live" operations (orders, deliveries, shipments, tasks) go through the real services so every rule is exercised.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEMO_USERS = [
  { email: 'admin@waretrack.local', name: 'Alex Chen', role: 'admin', password: 'Admin@123', employee: 'EMP-001' },
  { email: 'manager@waretrack.local', name: 'Priya Nair', role: 'warehouse_manager', password: 'Manager@123', employee: 'EMP-002' },
  { email: 'inventory@waretrack.local', name: 'Elena Petrova', role: 'inventory_manager', password: 'Inventory@123', employee: 'EMP-011' },
  { email: 'employee@waretrack.local', name: 'Aisha Khan', role: 'employee', password: 'Employee@123', employee: 'EMP-013' },
];

function rngFactory(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const EMPLOYEES = [
  ['EMP-001', 'Alex Chen', 'Management', 'Operations Manager'], ['EMP-002', 'Priya Nair', 'Receiving', 'Receiving Lead'], ['EMP-003', 'Marcus Reed', 'Receiving', 'Forklift Operator'],
  ['EMP-004', 'Sofia Alvarez', 'Receiving', 'Dock Clerk'], ['EMP-005', "Liam O'Brien", 'Picking', 'Picker'], ['EMP-006', 'Hana Kimura', 'Picking', 'Picker'],
  ['EMP-007', 'Omar Haddad', 'Picking', 'Packer'], ['EMP-008', 'Chloe Dubois', 'Picking', 'Picker'], ['EMP-009', 'Ben Carter', 'Shipping', 'Loader'],
  ['EMP-010', 'Ravi Patel', 'Shipping', 'Dispatch Coordinator'], ['EMP-011', 'Elena Petrova', 'Inventory', 'Inventory Controller'], ['EMP-012', 'Tom Walker', 'Maintenance', 'Technician'],
  ['EMP-013', 'Aisha Khan', 'Shipping', 'Loader'],
];
const CATEGORIES = [['Electronics', '#3b82f6', 'B'], ['Apparel', '#ec4899', 'A'], ['Home & Kitchen', '#f59e0b', 'A'], ['Sports', '#10b981', 'C'], ['Tools', '#ef4444', 'C']];
// sku, name, category, price, reorder level, forced total (null = random)
const PRODUCTS = [
  ['ELEC-EARB', 'Wireless Earbuds Pro', 'Electronics', 129, 40], ['ELEC-CAM4', '4K Action Camera', 'Electronics', 249, 25], ['ELEC-SW02', 'Smart Watch S2', 'Electronics', 199, 30, 18],
  ['ELEC-SPKR', 'Bluetooth Speaker Mini', 'Electronics', 59, 40], ['ELEC-CHRG', 'USB-C Fast Charger 65W', 'Electronics', 39, 60], ['ELEC-KEYB', 'Mechanical Keyboard K8', 'Electronics', 99, 30],
  ['APP-TEE', 'Classic Cotton T-Shirt', 'Apparel', 19, 100], ['APP-DENIM', 'Denim Jacket', 'Apparel', 79, 40], ['APP-SHOE', 'Running Shoes Air', 'Apparel', 119, 50],
  ['APP-BEAN', 'Wool Beanie', 'Apparel', 15, 60], ['APP-HOOD', 'Hooded Sweatshirt', 'Apparel', 49, 50, 0],
  ['HOME-BTL', 'Stainless Water Bottle', 'Home & Kitchen', 24, 80], ['HOME-MUG', 'Ceramic Mug Set (4)', 'Home & Kitchen', 32, 50], ['HOME-PAN', 'Non-stick Pan 28cm', 'Home & Kitchen', 45, 40],
  ['HOME-LAMP', 'LED Desk Lamp', 'Home & Kitchen', 35, 40], ['HOME-PILL', 'Memory Foam Pillow', 'Home & Kitchen', 42, 40],
  ['SPO-YOGA', 'Yoga Mat Premium', 'Sports', 29, 50], ['SPO-DUMB', 'Dumbbell Set 20kg', 'Sports', 89, 30], ['SPO-TENT', 'Camping Tent 4P', 'Sports', 189, 20], ['SPO-HELM', 'Mountain Bike Helmet', 'Sports', 69, 30],
  ['TOOL-DRIL', 'Cordless Drill 18V', 'Tools', 119, 30], ['TOOL-KIT', 'Tool Kit 120pc', 'Tools', 79, 30], ['TOOL-GLV', 'Work Gloves (pair)', 'Tools', 9, 40, 14], ['TOOL-ROLL', 'Paint Roller Kit', 'Tools', 18, 40],
];
const COLORS = ['#2563eb', '#0ea5a4', '#1d4ed8', '#0891b2', '#3b82f6', '#14b8a6'];
const CUSTOMERS = [['Northwind Traders', 'Philadelphia'], ['Bluebird Cafe', 'Boston'], ['Harbor Outfitters', 'Baltimore'], ['Maple & Main', 'Hartford'], ['Summit Sports', 'Pittsburgh'], ['Greenleaf Market', 'Newark'], ['Urban Threads', 'New York'], ['Cobalt Electronics', 'Albany'], ['Riverside Gifts', 'Wilmington'], ['Oak Street Hardware', 'Providence']];
const STREETS = ['Market St', 'Main Ave', 'Harbor Rd', 'Elm St', 'Commerce Blvd', 'Union Sq', 'Pine St', 'Lakeview Dr'];

export async function seedDatabase(ctx) {
  const { db, svc } = ctx;
  const rng = rngFactory(20261102);
  const rnd = (a, b) => a + rng() * (b - a);
  const ri = (a, b) => Math.floor(rnd(a, b + 1));
  const iso = (ms) => new Date(ms).toISOString();
  const now = Date.now();
  const H = 3600000, D = 86400000;

  db.transaction(() => {
    // ----- structure -----
    const wh = db.run('INSERT INTO warehouses(code,name,address,city) VALUES(?,?,?,?)', ['WH-01', 'Riverside Hub', '1200 Riverside Industrial Pkwy', 'Philadelphia']).lastId;
    const sec = {};
    for (const [code, name, zone] of [['A', 'General Merchandise', 'indoor'], ['B', 'Electronics Hall', 'indoor'], ['C', 'Bulk Yard', 'outdoor']]) sec[code] = db.run('INSERT INTO storage_sections(warehouse_id,code,name,zone) VALUES(?,?,?,?)', [wh, code, name, zone]).lastId;
    const racks = {};
    for (const code of ['A', 'B', 'C']) for (let r = 1; r <= (code === 'C' ? 2 : 3); r++) for (let c = 1; c <= 4; c++) racks[`${code}-${r}-${c}`] = db.run('INSERT INTO storage_racks(section_id,code,row_no,col_no,capacity,max_pallets) VALUES(?,?,?,?,?,?)', [sec[code], `${code}-${r}-${c}`, r, c, 600, 6]).lastId;
    [[1, 'inbound'], [2, 'inbound'], [3, 'outbound'], [4, 'outbound']].forEach(([n, dir]) => db.run('INSERT INTO docks(warehouse_id,number,direction) VALUES(?,?,?)', [wh, n, dir]));

    // ----- people -----
    const emp = {};
    for (const [code, name, dept, title] of EMPLOYEES) emp[code] = db.run('INSERT INTO employees(code,name,email,department,job_title,status,warehouse_id,hired_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)', [code, name, `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@waretrack.local`, dept, title, 'available', wh, iso(now - ri(120, 900) * D).slice(0, 10), iso(now)]).lastId;
    return { wh, sec, racks, emp };
  });
  const sec = Object.fromEntries(db.all('SELECT id, code FROM storage_sections').map((s) => [s.code, s.id]));
  const racks = Object.fromEntries(db.all('SELECT id, code FROM storage_racks').map((r) => [r.code, r.id]));
  const empId = Object.fromEntries(db.all('SELECT id, code FROM employees').map((e) => [e.code, e.id]));

  for (const u of DEMO_USERS) {
    const hash = await ctx.auth.hashPassword(u.password);
    db.run('INSERT INTO users(email,name,password_hash,role,employee_id,created_at) VALUES(?,?,?,?,?,?)', [u.email, u.name, hash, u.role, empId[u.employee], iso(now - 200 * D)]);
  }
  const admin = { id: db.get(`SELECT id FROM users WHERE role='admin'`).id, name: 'System' };

  // ----- catalogue -----
  const cat = {};
  for (const [name, color, s] of CATEGORIES) cat[name] = db.run('INSERT INTO categories(name,color,default_section_id) VALUES(?,?,?)', [name, color, sec[s]]).lastId;
  const prod = {};
  for (const [sku, name, c, price, reorder] of PRODUCTS) prod[sku] = db.run('INSERT INTO products(sku,name,description,category_id,unit_price,reorder_level,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', [sku, name, `${name} – demo catalogue item`, cat[c], price, reorder, iso(now - 60 * D), iso(now - 60 * D)]).lastId;

  // ----- stock placement (respects capacity + pallet positions) -----
  const used = {}; const pallets = {};
  Object.values(racks).forEach((id) => { used[id] = 0; pallets[id] = 0; });
  const rows = []; // {productId, rackId, qty, batch}
  const place = (sku, rackCode, qty, batch) => { const rid = racks[rackCode]; used[rid] += qty; pallets[rid] += 1; rows.push({ sku, productId: prod[sku], rackId: rid, qty, batch }); };
  // a nearly-full and a completely full rack for the visual states
  place('SPO-DUMB', 'C-1-1', 195, 'B-2509-01'); place('SPO-TENT', 'C-1-1', 190, 'B-2509-02'); place('SPO-HELM', 'C-1-1', 185, 'B-2509-03');
  place('TOOL-DRIL', 'C-1-2', 200, 'B-2508-01'); place('TOOL-KIT', 'C-1-2', 200, 'B-2508-02'); place('TOOL-ROLL', 'C-1-2', 200, 'B-2508-03');
  const forced = new Map(rows.map((r) => [r.sku, 0]));
  rows.forEach((r) => forced.set(r.sku, (forced.get(r.sku) || 0) + r.qty));
  const cursor = { A: 0, B: 0, C: 0 };
  for (const [sku, , c, , , fixed] of PRODUCTS) {
    const secCode = CATEGORIES.find((x) => x[0] === c)[2];
    const secRacks = Object.keys(racks).filter((k) => k.startsWith(secCode + '-'));
    let total = fixed !== undefined ? fixed : ri(280, 640);
    total -= forced.get(sku) || 0;
    if (total <= 0) continue;
    const n = Math.max(1, Math.ceil(total / 185));
    let left = total;
    for (let i = 0; i < n; i++) {
      const q = Math.min(200, i === n - 1 ? left : Math.min(left, Math.max(5, Math.round(total / n + rnd(-15, 15)))));
      let placed = false;
      for (let tries = 0; tries < secRacks.length && !placed; tries++) {
        const code = secRacks[cursor[secCode]++ % secRacks.length]; const rid = racks[code];
        if (code === 'C-1-1' || code === 'C-1-2') continue;
        if (used[rid] + q <= 600 && pallets[rid] < 6 && !rows.some((r) => r.rackId === rid && r.sku === sku)) { place(sku, code, q, `B-2510-${String(i + 1).padStart(2, '0')}`); placed = true; }
      }
      left -= q;
    }
  }

  // ----- ledger: back-dated receipts + shipped (delivered) orders so history reconciles with stock -----
  const outs = []; const ledger = [];
  for (const r of rows) {
    const nOut = rng() < 0.7 ? ri(1, 2) : 0;
    const outQ = Array.from({ length: nOut }, () => Math.max(1, Math.round(r.qty * rnd(0.04, 0.12))));
    const sumOut = outQ.reduce((a, b) => a + b, 0);
    const in2 = rng() < 0.5 ? Math.round((r.qty + sumOut) * 0.25) : 0;
    const in1 = r.qty + sumOut - in2;
    const t1 = now - rnd(13, 14.9) * D;
    r.receivedAt = iso(t1);
    ledger.push({ ...r, type: 'IN', delta: in1, at: t1, reason: 'Initial receipt' });
    if (in2) ledger.push({ ...r, type: 'IN', delta: in2, at: now - rnd(4, 9) * D, reason: 'Replenishment' });
    outQ.forEach((q) => { const at = now - rnd(0.2, 12) * D; const o = { ...r, type: 'OUT', delta: -q, at, reason: 'Customer shipment' }; ledger.push(o); outs.push(o); });
  }
  db.transaction(() => {
    for (const r of rows) db.run('INSERT INTO inventory(product_id,rack_id,quantity,reserved,batch_no,received_at) VALUES(?,?,?,?,?,?)', [r.productId, r.rackId, r.qty, 0, r.batch, r.receivedAt]);
    // historical delivered orders (one line each), numbered chronologically
    outs.sort((a, b) => a.at - b.at);
    const price = Object.fromEntries(PRODUCTS.map((p) => [prod[p[0]], p[3]]));
    for (const o of outs) {
      const [cust, city] = CUSTOMERS[ri(0, CUSTOMERS.length - 1)];
      const created = o.at - rnd(6, 30) * H;
      const late = rng() < 0.08;
      const delivered = Math.min(late ? created + rnd(80, 100) * H : o.at + rnd(10, 50) * H, now - 30 * 60000);
      const id = db.run(`INSERT INTO orders(number,customer_name,delivery_address,city,status,priority,total_amount,created_by,created_at,updated_at,dispatched_at,delivered_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [`SO-${String(db.get('SELECT COALESCE(MAX(id),0)+1 n FROM orders').n).padStart(6, '0')}`, cust, `${ri(10, 990)} ${STREETS[ri(0, STREETS.length - 1)]}`, city, 'Delivered', 'normal', -o.delta * price[o.productId], admin.id, iso(created), iso(delivered), iso(o.at), iso(delivered)]).lastId;
      db.run('INSERT INTO order_items(order_id,product_id,quantity,unit_price) VALUES(?,?,?,?)', [id, o.productId, -o.delta, price[o.productId]]);
      o.orderId = id;
    }
    // balance_after is computed per (product, rack, batch) row in time order
    const bal = new Map();
    ledger.sort((a, b) => a.at - b.at).forEach((m) => {
      const key = `${m.productId}|${m.rackId}|${m.batch}`;
      const b = (bal.get(key) || 0) + m.delta; bal.set(key, b);
      db.run('INSERT INTO stock_movements(product_id,rack_id,batch_no,type,quantity,balance_after,reason,reference_type,reference_id,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        [m.productId, m.rackId, m.batch, m.type, m.delta, b, m.reason, m.orderId ? 'order' : null, m.orderId ?? null, admin.id, iso(m.at)]);
    });
    // ----- fleet -----
    const drivers = ['Daniel Foster', 'Maria Gomez', 'Kenji Sato', 'Fatima Ali', 'Lucas Meyer', 'Nina Kowalski', 'Jamal Brooks'].map((n, i) => db.run('INSERT INTO drivers(name,phone,license_no,created_at) VALUES(?,?,?,?)', [n, `+1 555 01${10 + i}`, `DL-${4400 + i * 37}`, iso(now - 300 * D)]).lastId);
    [['TRK-101', 'PA-4821', 'truck', 400], ['TRK-102', 'PA-7733', 'truck', 400], ['TRK-103', 'PA-1180', 'truck', 600], ['TRK-104', 'PA-9052', 'truck', 600], ['VAN-201', 'PA-3317', 'van', 150], ['VAN-202', 'PA-6044', 'van', 150]]
      .forEach(([code, plate, type, cap], i) => db.run('INSERT INTO vehicles(code,plate,type,capacity_units,status,color,driver_id,parking_slot,created_at) VALUES(?,?,?,?,?,?,?,?,?)', [code, plate, type, cap, 'available', COLORS[i], drivers[i], i, iso(now - 300 * D)]));
    db.run(`UPDATE vehicles SET status = 'maintenance' WHERE code = 'TRK-104'`);
    ctx.activity.log(admin, 'system.seed', 'system', null, 'Demo data created');
  });

  // ----- live operations through the real services -----
  const P = (sku) => prod[sku];
  const mkOrder = (i, items, priority = 'normal') => {
    const [cust, city] = CUSTOMERS[i % CUSTOMERS.length];
    return svc.orders.create({ customerName: cust, customerEmail: null, customerPhone: null, deliveryAddress: `${100 + i * 17} ${STREETS[i % STREETS.length]}`, city, priority, notes: null, items: items.map(([sku, q]) => ({ productId: P(sku), quantity: q })) }, admin);
  };
  const advance = (o, to) => { for (const s of to) svc.orders.transition(o.id, s, admin); };
  const READY = ['Processing', 'Packed', 'Ready for Dispatch'];

  // an earlier, completed inbound shipment
  const s3 = svc.receiving.create({ supplier: 'Pacific Components Ltd', items: [{ productId: P('ELEC-CHRG'), quantity: 60 }, { productId: P('ELEC-SPKR'), quantity: 40 }] }, admin);
  svc.receiving.arrive(s3.id, null, admin); svc.receiving.receive(s3.id, null, admin);

  const l8 = mkOrder(7, [['ELEC-EARB', 12], ['APP-TEE', 30]]); advance(l8, READY);
  const l9 = mkOrder(8, [['HOME-MUG', 20]]); advance(l9, READY);
  const d1 = svc.deliveries.create({ vehicleId: db.get(`SELECT id FROM vehicles WHERE code='TRK-102'`).id, orderIds: [l8.id, l9.id] }, admin);
  svc.deliveries.dispatch(d1.id, admin);

  const l6 = mkOrder(5, [['SPO-YOGA', 25], ['HOME-BTL', 40]]); advance(l6, READY);
  const l7 = mkOrder(6, [['APP-SHOE', 10], ['APP-BEAN', 20]], 'high'); advance(l7, READY);
  svc.deliveries.create({ vehicleId: db.get(`SELECT id FROM vehicles WHERE code='TRK-101'`).id, orderIds: [l6.id, l7.id] }, admin);

  advance(mkOrder(4, [['TOOL-DRIL', 8], ['TOOL-GLV', 4]]), ['Processing', 'Packed', 'Ready for Dispatch']);
  advance(mkOrder(3, [['HOME-LAMP', 15]]), ['Processing', 'Packed']);
  advance(mkOrder(2, [['ELEC-KEYB', 6], ['ELEC-CAM4', 4]], 'high'), ['Processing']);
  mkOrder(1, [['HOME-PILL', 12], ['HOME-PAN', 9]], 'urgent');
  mkOrder(0, [['SPO-DUMB', 6], ['APP-DENIM', 14]]);

  const s1 = svc.receiving.create({ supplier: 'Northwind Supply Co.', expectedAt: iso(now), items: [{ productId: P('ELEC-SW02'), quantity: 80 }, { productId: P('APP-HOOD'), quantity: 120 }, { productId: P('TOOL-GLV'), quantity: 200 }] }, admin);
  svc.receiving.arrive(s1.id, null, admin);
  svc.receiving.create({ supplier: 'Atlas Sports Imports', expectedAt: iso(now + 20 * H), items: [{ productId: P('SPO-YOGA'), quantity: 150 }, { productId: P('SPO-HELM'), quantity: 40 }] }, admin);

  svc.tasks.create({ title: 'Cycle count – Section A racks', type: 'inventory_check', targetType: 'section', targetId: sec.A, priority: 'normal' }, admin);
  svc.tasks.create({ title: 'Inspect dock leveller at Dock 2', type: 'maintenance', targetType: 'dock', targetId: db.get('SELECT id FROM docks WHERE number = 2').id, priority: 'low' }, admin);
  // someone on a break and someone off duty (pick whoever is currently free)
  const free = (codes) => codes.map((c) => empId[c]).find((id) => db.get('SELECT status FROM employees WHERE id = ?', [id]).status === 'available');
  const brk = free(['EMP-010', 'EMP-009', 'EMP-007', 'EMP-004']); if (brk) svc.employees.update(brk, { status: 'on_break' }, admin);
  const off = free(['EMP-008', 'EMP-006', 'EMP-005']); if (off) svc.employees.update(off, { status: 'off_duty' }, admin);

  svc.inventory.scanLowStock();
  ctx.notifications.notify({ level: 'success', title: 'Welcome to WareTrack 3D', message: 'Demo data is loaded. Click anything in the 3D warehouse to inspect it.' });
}

export async function seedIfEmpty(ctx) {
  if (ctx.db.get('SELECT COUNT(*) c FROM users').c === 0) {
    ctx.log.info('  First start: seeding demo data…');
    await seedDatabase(ctx);
    ctx.log.info('  Demo users (email / password):');
    DEMO_USERS.forEach((u) => ctx.log.info(`    ${u.role.padEnd(18)} ${u.email}  /  ${u.password}`));
    return true;
  }
  return false;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { loadConfig } = await import('../backend/src/config.js');
  const { createContainer } = await import('../backend/src/container.js');
  const config = loadConfig();
  if (process.argv.includes('--reset')) {
    for (const f of [config.db.file, config.db.file + '-wal', config.db.file + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
    fs.rmSync(config.storage.dir, { recursive: true, force: true });
    console.log('Database wiped.');
  }
  const ctx = createContainer(config);
  const did = await seedIfEmpty(ctx);
  if (!did) console.log('Database already contains data. Use "npm run db:reset" to start over.');
  ctx.close();
}
