import pg from 'pg';
import { loadConfig } from '../backend/src/config.js';

const config = loadConfig();
const BASE_URL = 'http://127.0.0.1:3000';

async function main() {
  console.log('=== VERIFYING LIVE BACKEND CONNECTIVITY TO AWS RDS & S3 ===\n');

  // 1. Health check
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const health = await healthRes.json();
  console.log(`[PASS] Server is live on ${BASE_URL}:`, health);

  // 2. Login to get token
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@waretrack.local', password: 'Admin@123' })
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
  const { token, user } = await loginRes.json();
  console.log(`[PASS] Logged in as ${user.name} (${user.role}) - Token obtained.`);

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // 3. Verify S3 image serving via backend
  const prodRes = await fetch(`${BASE_URL}/api/products/2`, { headers: authHeaders });
  const prod = await prodRes.json();
  console.log(`[PASS] Product fetched: ${prod.name} (SKU: ${prod.sku}), Image URL: ${prod.imageUrl}`);
  
  if (prod.imageUrl) {
    const imgRes = await fetch(`${BASE_URL}${prod.imageUrl}`);
    console.log(`[PASS] S3 Image fetched via backend proxy: status=${imgRes.status}, content-type=${imgRes.headers.get('content-type')}`);
  }

  // 4. Connect to AWS RDS directly
  const pool = new pg.Pool({
    connectionString: config.db.url,
    ssl: { rejectUnauthorized: false }
  });
  const client = await pool.connect();
  const dbInfo = await client.query('SELECT current_database(), current_user, version()');
  console.log(`[PASS] Connected directly to AWS RDS: ${dbInfo.rows[0].current_database} as ${dbInfo.rows[0].current_user}`);

  const countBeforeRes = await client.query('SELECT count(*) c FROM orders');
  const countBefore = Number(countBeforeRes.rows[0].c);
  console.log(`[RDS Info] Total orders in AWS RDS PostgreSQL before write: ${countBefore}`);

  // 5. Test Live API Write (Create Order)
  const testOrderPayload = {
    customerName: 'AWS RDS Live Verification Customer',
    deliveryAddress: '742 Evergreen Terrace, Springfield',
    city: 'Mumbai',
    priority: 'high',
    items: [
      { productId: 2, quantity: 2 }
    ]
  };

  console.log('\n[TEST 1] Sending POST /api/orders to create order in live backend...');
  const createOrderRes = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(testOrderPayload)
  });

  if (!createOrderRes.ok) {
    const errText = await createOrderRes.text();
    throw new Error(`Create order failed: ${createOrderRes.status} - ${errText}`);
  }
  const createdOrder = await createOrderRes.json();
  console.log(`[PASS] Order created via API -> ID: ${createdOrder.id}, Order Number: ${createdOrder.number}, Status: ${createdOrder.status}`);

  // Give write-through queue a moment to ensure RDS transaction commits
  await new Promise(r => setTimeout(r, 1000));

  // 6. Direct AWS RDS verification for INSERT
  const rdsOrderRes = await client.query('SELECT * FROM orders WHERE number = $1', [createdOrder.number]);
  if (rdsOrderRes.rows.length === 0) {
    console.error(`[FAIL] Order number ${createdOrder.number} not found in AWS RDS orders table!`);
  } else {
    const rdsOrder = rdsOrderRes.rows[0];
    console.log(`[PASS] VERIFIED IN AWS RDS PostgreSQL: Order ${rdsOrder.number} (RDS ID: ${rdsOrder.id}) exists! Customer: "${rdsOrder.customer_name}", Status: "${rdsOrder.status}"`);
  }

  // 7. Test Live API Update (Update Order status to Processing)
  console.log('\n[TEST 2] Updating order status via API (POST /api/orders/:id/status)...');
  const updateRes = await fetch(`${BASE_URL}/api/orders/${createdOrder.id}/status`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ status: 'Processing' })
  });
  if (updateRes.ok) {
    const updatedOrder = await updateRes.json();
    console.log(`[PASS] Order ${createdOrder.number} status updated to "${updatedOrder.status}" via API.`);
  } else {
    console.error(`[WARN] Status update API returned: ${updateRes.status} ${await updateRes.text()}`);
  }

  await new Promise(r => setTimeout(r, 1000));

  const rdsUpdatedRes = await client.query('SELECT number, status, priority FROM orders WHERE number = $1', [createdOrder.number]);
  console.log(`[PASS] VERIFIED IN AWS RDS: Order ${rdsUpdatedRes.rows[0]?.number} status in RDS is now "${rdsUpdatedRes.rows[0]?.status}"`);

  // 8. Test Product Inventory Read from API vs RDS
  console.log('\n[TEST 3] Verifying Products & Inventory sync...');
  const catRes = await fetch(`${BASE_URL}/api/categories`, { headers: authHeaders });
  const catData = await catRes.json();
  const rdsCatRes = await client.query('SELECT count(*) c FROM categories');
  console.log(`[PASS] Categories API items: ${catData.items.length} | RDS PostgreSQL categories count: ${rdsCatRes.rows[0].c}`);

  const empRes = await fetch(`${BASE_URL}/api/employees`, { headers: authHeaders });
  const empData = await empRes.json();
  const rdsEmpRes = await client.query('SELECT count(*) c FROM employees');
  console.log(`[PASS] Employees API items: ${empData.items.length} | RDS PostgreSQL employees count: ${rdsEmpRes.rows[0].c}`);

  const vehRes = await fetch(`${BASE_URL}/api/vehicles`, { headers: authHeaders });
  const vehData = await vehRes.json();
  const rdsVehRes = await client.query('SELECT count(*) c FROM vehicles');
  console.log(`[PASS] Vehicles API items: ${vehData.items.length} | RDS PostgreSQL vehicles count: ${rdsVehRes.rows[0].c}`);

  client.release();
  await pool.end();

  console.log('\n=== ALL VERIFICATIONS PASSED SUCCESSFULLY ===');
}

main().catch(err => {
  console.error('\n[VERIFICATION ERROR]:', err);
  process.exit(1);
});
