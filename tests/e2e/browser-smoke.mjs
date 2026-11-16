// Browser smoke test (Playwright + headless Chromium).
//   node tests/e2e/browser-smoke.mjs            -> uses a permissive Three.js STUB (checks all app/scene logic, not pixels)
//   REAL_THREE=1 node tests/e2e/browser-smoke.mjs -> uses the real Three.js (CDN or frontend/vendor) and saves screenshots
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(path.join(process.env.NPM_GLOBAL || '/home/claude/.npm-global/lib/node_modules', 'playwright')); }
process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/opt/pw-browsers';
const REAL = process.env.REAL_THREE === '1';
const PORT = 3111; const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync('/tmp/wt-e2e-');
const shots = path.join(root, 'tests', 'e2e', 'screenshots'); fs.mkdirSync(shots, { recursive: true });

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'backend/src/server.js'], { cwd: root, env: { ...process.env, PORT, DB_FILE: path.join(tmp, 'db.sqlite'), STORAGE_DIR: path.join(tmp, 'files'), VEHICLE_RETURN_DELAY_MS: '1500', WARETRACK_QUIET: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }

// ---- permissive Three.js stub: every API call succeeds and returns another stub
const STUB = `
const store = new WeakMap();
function make(name) {
  const target = function () {}; const props = {};
  const proxy = new Proxy(target, {
    get(_, k) {
      if (k === Symbol.toPrimitive) return () => 0; if (k === Symbol.iterator) return function* () {}; if (k === 'then') return undefined;
      if (k in props) return props[k];
      if (k === 'x' || k === 'y' || k === 'z' || k === 'length' || k === 'count') return 0;
      if (k === 'width' || k === 'height') return 1;
      const child = (typeof k === 'string' && /^(clone|copy|set|add|remove|lerp|lerpVectors|sub|multiplyScalar|normalize|setFromObject|setFromCenterAndSize|expandByPoint|getSize|getCenter|compose|makeTranslation|slice|traverse|forEach|applyAxisAngle|addScaledVector|setScalar|setFromCamera|updateProjectionMatrix|setMatrixAt|setColorAt)$/.test(k)) ? (...a) => proxy : make(String(k));
      props[k] = child; return child;
    },
    set(_, k, v) { props[k] = v; return true; },
    apply() { return proxy; }, construct() { return proxy; },
  });
  return proxy;
}
`;
const names = new Set(['Scene', 'Color', 'Fog', 'PerspectiveCamera', 'Vector3', 'Vector2', 'HemisphereLight', 'DirectionalLight', 'AmbientLight', 'Group']);
for (const f of fs.readdirSync(path.join(root, 'frontend/js/three'))) for (const m of fs.readFileSync(path.join(root, 'frontend/js/three', f), 'utf8').matchAll(/THREE\.([A-Za-z0-9_]+)/g)) names.add(m[1]);
const special = new Set(['WebGLRenderer', 'Raycaster']);
const threeStub = STUB + [...names].filter((n) => !special.has(n)).map((n) => `export const ${n} = make('${n}');`).join('\n') + `
export class WebGLRenderer { constructor() { const p = make('R'); p.domElement = document.createElement('canvas'); p.info = { render: { calls: 1, triangles: 2 }, memory: { geometries: 3 } }; p.shadowMap = {}; return p; } }
export class Raycaster { setFromCamera() {} intersectObjects() { return []; } }
`;
const orbitStub = STUB + `export class OrbitControls { constructor() { const p = make('OC'); p.target = make('T'); p.update = () => {}; p.addEventListener = () => {}; p.dispose = () => {}; return p; } }`;
const roundedStub = STUB + `export class RoundedBoxGeometry { constructor() { return make('RBG'); } }`;

const browser = await playwright.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
const page = await ctx.newPage();
const errors = []; const warnings = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); if (m.type() === 'warning') warnings.push(m.text()); });
page.on('requestfailed', (r) => { if (!r.url().includes('jsdelivr') && !r.url().includes('/api/events')) errors.push(`requestfailed: ${r.url()}`); });
if (!REAL) {
  await page.route('https://cdn.jsdelivr.net/**', (route) => {
    const u = route.request().url(); const body = u.includes('OrbitControls') ? orbitStub : u.includes('RoundedBox') ? roundedStub : threeStub;
    route.fulfill({ status: 200, contentType: 'text/javascript', body });
  });
}
let failed = 0;
const check = (cond, msg) => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`); if (!cond) failed++; };
const wait = (ms) => page.waitForTimeout(ms);

try {
  await page.goto(BASE);
  await page.waitForSelector('#email');
  check(true, 'login screen rendered');
  await page.fill('#email', 'admin@waretrack.local'); await page.fill('#password', 'wrong'); await page.click('button[type=submit]');
  await page.waitForSelector('.form-error:not(.hidden)'); check(true, 'bad password shows an error');
  await page.fill('#password', 'Admin@123'); await page.click('button[type=submit]');
  await page.waitForSelector('.shell'); check(true, 'signed in, shell rendered');
  await page.waitForSelector('.chips-top .kpi', { timeout: 15000 });
  check((await page.locator('.chips-top .kpi').count()) === 4, '3D HUD KPI chips rendered from /api/scene');
  await wait(800);
  check(await page.evaluate(() => !!window.__world), '3D world object created');
  const dbg = await page.evaluate(() => { const w = window.__world; return { vehicles: w.debug.vehicles.size, workers: w.debug.workers.size, pallets: w.debug.palletMap().length }; });
  check(dbg.vehicles >= 6 && dbg.workers >= 12 && dbg.pallets > 50, `scene built from data: ${dbg.vehicles} vehicles, ${dbg.workers} workers, ${dbg.pallets} pallets`);
  if (REAL) await page.screenshot({ path: path.join(shots, 'world.png') });

  // select every kind of object and read its info card
  const sceneInfo = await page.evaluate(async () => { const r = await fetch('/api/scene', { headers: { Authorization: `Bearer ${localStorage.getItem('waretrack.token')}` } }); return r.json(); });
  const rack = sceneInfo.racks.find((r) => r.pallets.length); const veh = sceneInfo.vehicles.find((v) => v.delivery);
  const refs = [['warehouse', { type: 'warehouse', id: 1 }, 'Total inventory'], ['office', { type: 'office', id: 1 }, 'Management staff'], ['section', { type: 'section', id: sceneInfo.sections[0].id }, 'Utilization'],
    ['rack', { type: 'rack', id: rack.id }, 'Rack ID'], ['pallet', { type: 'pallet', id: rack.pallets[0].inventoryId, rackId: rack.id }, 'Batch number'], ['vehicle', { type: 'vehicle', id: veh.id }, 'Assigned orders'],
    ['worker', { type: 'worker', id: sceneInfo.employees[0].id }, 'Employee ID'], ['dock', { type: 'dock', id: sceneInfo.docks[0].id }, 'Loading status']];
  if (sceneInfo.inboundShipments[0]) refs.push(['shipment', { type: 'shipment', id: sceneInfo.inboundShipments[0].id }, 'Supplier']);
  for (const [name, ref, label] of refs) {
    await page.evaluate((r) => window.__world.select(r, { focus: true }), ref); await wait(120);
    const txt = await page.locator('.infocard').innerText().catch(() => '');
    check(txt.includes(label), `${name}: info card shows "${label}"`);
  }
  check((await page.locator('.track .step').count()) === 5, 'shipment tracking timeline rendered');
  await page.click('.lists .tabs button:nth-child(2)'); check((await page.locator('.lists .row').count()) > 5, 'workers list rendered');
  await page.click('.controls button[title="Interior view (lift the roof)"]'); await wait(100);
  await page.evaluate(() => window.__world.deselect());

  // management views
  const views = [['dashboard', '.kpis'], ['inventory', 'table'], ['orders', 'table'], ['deliveries', 'table'], ['receiving', 'table'], ['people', 'table'], ['warehouse', '.rackgrid'], ['activity', 'table'], ['users', 'table']];
  for (const [v, sel] of views) {
    await page.click(`.rail button[data-id="${v}"]`); await page.waitForSelector(`.sheet ${sel}`, { timeout: 8000 }); await wait(250);
    check(true, `view "${v}" rendered`);
    if (REAL || v === 'dashboard' || v === 'orders') await page.screenshot({ path: path.join(shots, `${v}.png`) });
  }
  const svgCount = await (async () => { await page.click('.rail button[data-id="dashboard"]'); await page.waitForSelector('.sheet .chart svg'); return page.locator('.sheet .chart svg').count(); })();
  check(svgCount >= 3, `dashboard charts rendered (${svgCount} SVG charts)`);

  // inventory: add product through the UI form (validation + success)
  await page.click('.rail button[data-id="inventory"]'); await page.waitForSelector('.sheet table');
  await page.click('text=Add product'); await page.waitForSelector('.modal');
  await page.click('.modal .btn.primary'); await page.waitForSelector('.modal .field.invalid'); check(true, 'product form shows validation errors');
  await page.fill('#f_sku', 'E2E-001'); await page.fill('#f_name', 'E2E Test Product'); await page.click('.modal .btn.primary');
  await page.waitForSelector('.modal', { state: 'detached' }); await wait(500);
  check((await page.locator('td', { hasText: 'E2E-001' }).count()) === 1, 'new product appears in the table');

  // orders: create an order via the UI, then it reserves stock
  await page.click('.rail button[data-id="orders"]'); await page.waitForFunction(() => document.querySelector('.sheet h1')?.textContent === 'Orders' && document.querySelectorAll('.sheet tbody tr').length > 0); const before = await page.locator('.sheet tbody tr').count();
  await page.click('text=New order'); await page.waitForSelector('.modal');
  await page.fill('#f_customerName', 'Browser Test Co'); await page.fill('#f_city', 'Testville'); await page.fill('#f_deliveryAddress', '1 Browser Street');
  await page.selectOption('.modal .toolbar select', { index: 2 }); await page.click('.modal .btn.primary');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 }); await wait(600);
  const afterCount = await page.locator('.sheet tbody tr').count();
  check(afterCount === before + 1, `order created via UI form (rows ${before} -> ${afterCount})`);
  await page.click('.sheet tbody tr:first-child'); await page.waitForSelector('.modal .steps'); check(true, 'order detail dialog opened');
  await page.click('.modal .btn.primary'); await wait(700);   // Move to Processing
  check((await page.locator('.modal .badge', { hasText: 'Processing' }).count()) > 0, 'order moved to Processing from the dialog');
  await page.keyboard.press('Escape');

  // realtime: change data through the API, the world must update by itself (SSE)
  const palletsBefore = await page.evaluate(() => window.__world.debug.palletMap().length);
  await page.evaluate(async () => {
    const t = localStorage.getItem('waretrack.token'); const H = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };
    const w = await (await fetch('/api/warehouse', { headers: H })).json(); const rk = w.sections.flatMap((s) => s.racks).find((r) => r.pallets < 5 && r.available > 50);
    const p = (await (await fetch('/api/products?limit=50', { headers: H })).json()).items[3];
    await fetch('/api/inventory/receive', { method: 'POST', headers: H, body: JSON.stringify({ productId: p.id, rackId: rk.id, quantity: 20, batchNo: 'RT-E2E' }) });
  });
  await wait(1200);
  const palletsAfter = await page.evaluate(() => window.__world.debug.palletMap().length);
  check(palletsAfter === palletsBefore + 1, `3D scene updated live over SSE (pallets ${palletsBefore} -> ${palletsAfter})`);

  // role check: employee has a reduced menu
  await page.click('.usermenu'); await page.click('text=Sign out'); await page.waitForSelector('#email');
  await page.fill('#email', 'employee@waretrack.local'); await page.fill('#password', 'Employee@123'); await page.click('button[type=submit]'); await page.waitForSelector('.shell');
  const navIds = await page.locator('.rail button').evaluateAll((b) => b.map((x) => x.dataset.id));
  check(!navIds.includes('users') && navIds.includes('people'), `employee menu: ${navIds.join(', ')}`);
  await page.click('.rail button[data-id="inventory"]'); await page.waitForSelector('.sheet table');
  check((await page.locator('text=Add product').count()) === 0, 'employee does not see write actions');

  // mobile layout
  await page.setViewportSize({ width: 390, height: 800 }); await wait(300);
  await page.click('.rail button[data-id="world"]'); await wait(600);
  check(await page.locator('.rail').evaluate((el) => getComputedStyle(el).flexDirection === 'row'), 'mobile: navigation becomes a bottom bar');
  if (REAL) await page.screenshot({ path: path.join(shots, 'mobile-world.png') });
} catch (e) {
  failed++; console.log(' FAIL exception:', e.message); await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
}
if (warnings.length) console.log('  browser warnings:\n    ' + [...new Set(warnings)].slice(0, 8).join('\n    '));
const realErrors = errors.filter((e) => !/Failed to load resource.*(401|409|422|400)/.test(e));
check(realErrors.length === 0, `no browser console/page errors${realErrors.length ? ':\n    ' + realErrors.join('\n    ') : ''}`);
await browser.close(); server.kill('SIGINT'); fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll browser checks passed'); process.exit(failed ? 1 : 0);
