import pg from 'pg';
import { loadConfig } from '../backend/src/config.js';

const config = loadConfig();

async function main() {
  const pool = new pg.Pool({
    connectionString: config.db.url,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  console.log('Connected to RDS PostgreSQL. Fixing identity sequences...');

  const tables = [
    'warehouses', 'storage_sections', 'storage_racks', 'docks', 'employees',
    'users', 'sessions', 'categories', 'products', 'inventory', 'stock_movements',
    'suppliers', 'inbound_shipments', 'inbound_items', 'orders', 'order_items',
    'vehicles', 'deliveries', 'audit_log', 'system_settings', 'superstore_sales'
  ];

  for (const t of tables) {
    try {
      const q = `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE(MAX(id), 1)) AS val FROM ${t}`;
      const res = await client.query(q);
      console.log(`[PASS] Sequence for ${t}: next starts after ${res.rows[0].val}`);
    } catch (e) {
      console.warn(`[SKIP] Table ${t}: ${e.message}`);
    }
  }

  client.release();
  await pool.end();
}

main().catch(console.error);
