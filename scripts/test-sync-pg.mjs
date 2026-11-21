import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (!isMainThread) {
  // --- Worker Thread ---
  const { Client } = pg;
  const client = new Client({
    connectionString: workerData.connectionString,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  parentPort.on('message', async ({ id, sql, params, signalBuffer }) => {
    const signal = new Int32Array(signalBuffer);
    try {
      // Translate ? to $1, $2, ...
      let idx = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
      const res = await client.query(pgSql, params);
      parentPort.postMessage({ id, success: true, rows: res.rows, rowCount: res.rowCount });
    } catch (err) {
      parentPort.postMessage({ id, success: false, error: err.message });
    } finally {
      Atomics.store(signal, 0, 1);
      Atomics.notify(signal, 0);
    }
  });

  // Signal ready
  parentPort.postMessage({ type: 'ready' });
} else {
  // --- Main Thread Test ---
  console.log('Testing Synchronous PostgreSQL Bridge via Worker Thread...');

  const { loadConfig } = await import('../backend/src/config.js');
  const cfg = loadConfig();
  const connectionString = cfg.db.url || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const worker = new Worker(fileURLToPath(import.meta.url), {
    workerData: { connectionString }
  });

  // Wait for worker ready
  await new Promise((resolve) => {
    worker.once('message', (msg) => {
      if (msg.type === 'ready') resolve();
    });
  });

  console.log('Worker connected to RDS. Executing synchronous query from main thread...');

  function syncQuery(sql, params = []) {
    const signalBuffer = new SharedArrayBuffer(4);
    const signal = new Int32Array(signalBuffer);
    const id = Math.random();

    let response = null;
    const onMsg = (msg) => {
      if (msg.id === id) response = msg;
    };
    worker.on('message', onMsg);

    Atomics.store(signal, 0, 0);
    worker.postMessage({ id, sql, params, signalBuffer });

    // Block main thread until worker finishes
    Atomics.wait(signal, 0, 0, 10000);
    worker.off('message', onMsg);

    if (!response) throw new Error('Query timed out');
    if (!response.success) throw new Error(response.error);
    return response;
  }

  const start = Date.now();
  const res = syncQuery('SELECT COUNT(*) as c FROM warehouses');
  const elapsed = Date.now() - start;

  console.log('SYNCHRONOUS RESULT from RDS:', res.rows[0]);
  console.log('Execution time:', elapsed, 'ms');

  const res2 = syncQuery('SELECT sku, name FROM products LIMIT ?', [3]);
  console.log('SYNCHRONOUS PRODUCTS from RDS:', res2.rows);

  worker.terminate();
  console.log('Test completed successfully!');
}
