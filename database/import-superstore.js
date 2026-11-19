// WareTrack 3D :: Sample Superstore data importer
// Reads the three CSVs (orders, people, returns) and inserts into superstore_sales + superstore_regions.
// Usage: node database/import-superstore.js
//
// Safe to re-run: clears superstore tables then re-inserts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const csvDir = __dir;

// ---- minimal CSV parser (handles quoted fields with commas inside) ----
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  const headers = splitCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCSVLine(lines[i]);
    if (vals.length < 2) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h.trim()] = (vals[idx] || '').trim(); });
    rows.push(obj);
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// Convert M/D/YYYY to YYYY-MM-DD
function toISO(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  const [m, d, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// ---- Bootstrap database (runs migration 002 if not yet applied) ----
const { loadConfig }   = await import('../backend/src/config.js');
const { createDatabase } = await import('../backend/src/services/database/index.js');
const { migrate }      = await import('./migrate.js');

const cfg = loadConfig();
const db  = createDatabase(cfg.db);
migrate(db);

// ---- Load CSVs ----
console.log('Reading CSV files...');
const ordersRaw  = parseCSV(fs.readFileSync(path.join(csvDir, 'superstore_orders.csv'),  'utf8'));
const peopleRaw  = parseCSV(fs.readFileSync(path.join(csvDir, 'superstore_people.csv'),  'utf8'));
const returnsRaw = parseCSV(fs.readFileSync(path.join(csvDir, 'superstore_returns.csv'), 'utf8'));

console.log(`  Orders: ${ordersRaw.length} rows`);
console.log(`  People: ${peopleRaw.length} rows`);
console.log(`  Returns: ${returnsRaw.length} rows`);

// Set of returned order IDs
const returnedOrderIds = new Set(returnsRaw.map(r => r['Order ID']));

// ---- Clear existing superstore data ----
console.log('Clearing previous superstore data...');
db.exec('DELETE FROM superstore_sales');
db.exec('DELETE FROM superstore_regions');

// ---- Insert regions / people ----
console.log('Inserting regions...');
for (const p of peopleRaw) {
  if (!p['Region']) continue;
  db.run(
    'INSERT OR REPLACE INTO superstore_regions(name, manager) VALUES(?, ?)',
    [p['Region'], p['Person']]
  );
}

// ---- Insert sales rows ----
console.log('Inserting sales rows (this may take a moment)...');

const insertSale = db.prepare(`
  INSERT INTO superstore_sales(
    row_id, order_id, order_date, ship_date, ship_mode,
    customer_id, customer_name, segment,
    country, city, state, postal_code, region,
    product_id, category, sub_category, product_name,
    sales, quantity, discount, profit, returned
  ) VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?,?,?)
`);

db.exec('BEGIN');
let inserted = 0;
for (const r of ordersRaw) {
  const orderDate = toISO(r['Order Date']);
  const shipDate  = toISO(r['Ship Date']);
  const isReturned = returnedOrderIds.has(r['Order ID']) ? 1 : 0;

  insertSale.run(
    parseInt(r['Row ID'])    || null,
    r['Order ID'],
    orderDate,
    shipDate,
    r['Ship Mode'],
    r['Customer ID'],
    r['Customer Name'],
    r['Segment'],
    r['Country'],
    r['City'],
    r['State'],
    r['Postal Code'],
    r['Region'],
    r['Product ID'],
    r['Category'],
    r['Sub-Category'],
    r['Product Name'],
    parseFloat(r['Sales'])    || 0,
    parseInt(r['Quantity'])   || 1,
    parseFloat(r['Discount']) || 0,
    parseFloat(r['Profit'])   || 0,
    isReturned
  );
  inserted++;
}
db.exec('COMMIT');

console.log(`Done! ${inserted} sales rows inserted.`);

// ---- Quick verification ----
const total = db.get('SELECT COUNT(*) c, ROUND(SUM(sales),2) s, ROUND(SUM(profit),2) p FROM superstore_sales');
const regions = db.all('SELECT name, manager FROM superstore_regions ORDER BY name');
const returned = db.get('SELECT COUNT(*) c FROM superstore_sales WHERE returned = 1');

console.log('\n--- Verification ---');
console.log(`Total rows   : ${total.c}`);
console.log(`Total sales  : $${total.s}`);
console.log(`Total profit : $${total.p}`);
console.log(`Returned rows: ${returned.c}`);
console.log('Regions:');
regions.forEach(r => console.log(`  ${r.name} -> ${r.manager}`));

db.close();
console.log('\nImport complete. Restart the server to reflect changes.');
