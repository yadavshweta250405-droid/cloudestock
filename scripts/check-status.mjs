import { S3Storage } from '../backend/src/services/storage/s3.js';
import { PostgresDatabase } from '../backend/src/services/database/postgres.js';
import { loadConfig } from '../backend/src/config.js';

const config = loadConfig();

async function run() {
  console.log('Testing S3 Storage...');
  const s3 = new S3Storage({
    bucket: config.storage.bucket,
    region: config.storage.region,
    prefix: config.storage.prefix,
  });

  const list = await s3.list();
  console.log('S3 files in bucket:', list);

  const buf = await s3.get('products/2-6f5c927f42.png');
  console.log('S3 get result buffer length:', buf ? buf.length : 'NULL');

  console.log('\nTesting Postgres Database...');
  const db = new PostgresDatabase(config.db);
  const client = await db.pool.connect();
  const res = await client.query('SELECT id, name, sku, image_key FROM products WHERE id = 2');
  console.log('Product in RDS:', res.rows[0]);
  client.release();
  db.close();
}

run().catch(console.error);
