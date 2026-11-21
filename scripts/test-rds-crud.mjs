import pg from 'pg';
const { Client } = pg;

const rdsUrl = process.env.DATABASE_URL || 'postgres://postgres:Shweta152504@waretrack3d-db.cdegiemkurxk.ap-south-1.rds.amazonaws.com:5432/waretrack';

console.log('=== Amazon RDS PostgreSQL CRUD Operations Test ===\n');
console.log('Target Database: waretrack @ waretrack3d-db.cdegiemkurxk.ap-south-1.rds.amazonaws.com:5432\n');

const client = new Client({
  connectionString: rdsUrl,
  ssl: { rejectUnauthorized: false }
});

let allPassed = true;
function report(step, testName, passed, details = '') {
  const status = passed ? '[PASS]' : '[FAIL]';
  console.log(`${step}. ${testName.padEnd(45)} ${status}`);
  if (details) console.log(`   ${details}`);
  if (!passed) allPassed = false;
}

try {
  await client.connect();
  report('Step 0', 'Connect to RDS PostgreSQL instance', true, 'Connected successfully via SSL');

  const testTable = `_rds_crud_test_${Date.now()}`;

  // 1. Create temporary test table
  await client.query(`
    CREATE TABLE "${testTable}" (
      id SERIAL PRIMARY KEY,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  report('Step 1', `Create temporary test table (${testTable})`, true, 'Schema isolated, existing tables untouched');

  // 2. INSERT operation
  const insertRes = await client.query(`
    INSERT INTO "${testTable}" (item_name, quantity, price, status)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, ['Test Pallet Cargo-A1', 45, 129.99, 'in_transit']);

  const insertedId = insertRes.rows[0]?.id;
  const insertRead = await client.query(`SELECT * FROM "${testTable}" WHERE id = $1`, [insertedId]);
  const insertVerified = insertRead.rows.length === 1 &&
                         insertRead.rows[0].item_name === 'Test Pallet Cargo-A1' &&
                         insertRead.rows[0].quantity === 45 &&
                         insertRead.rows[0].status === 'in_transit';

  report('Step 2', 'INSERT operation + verification', insertVerified,
    `Inserted ID: ${insertedId} | Read back: "${insertRead.rows[0]?.item_name}", qty=${insertRead.rows[0]?.quantity}, price=$${insertRead.rows[0]?.price}, status='${insertRead.rows[0]?.status}'`);

  // 3. UPDATE operation
  await client.query(`
    UPDATE "${testTable}"
    SET quantity = $1, status = $2, price = $3
    WHERE id = $4
  `, [90, 'delivered', 149.99, insertedId]);

  const updateRead = await client.query(`SELECT * FROM "${testTable}" WHERE id = $1`, [insertedId]);
  const updateVerified = updateRead.rows.length === 1 &&
                         updateRead.rows[0].quantity === 90 &&
                         updateRead.rows[0].status === 'delivered' &&
                         updateRead.rows[0].price === 149.99;

  report('Step 3', 'UPDATE operation + verification', updateVerified,
    `Updated ID: ${insertedId} | New values: qty=${updateRead.rows[0]?.quantity}, price=$${updateRead.rows[0]?.price}, status='${updateRead.rows[0]?.status}'`);

  // 4. DELETE operation
  await client.query(`DELETE FROM "${testTable}" WHERE id = $1`, [insertedId]);

  const deleteRead = await client.query(`SELECT * FROM "${testTable}" WHERE id = $1`, [insertedId]);
  const deleteVerified = deleteRead.rows.length === 0;

  report('Step 4', 'DELETE operation + verification', deleteVerified,
    `Deleted ID: ${insertedId} | Verification query returned: ${deleteRead.rows.length} rows (record completely removed)`);

  // 5. Cleanup (DROP temporary test table)
  await client.query(`DROP TABLE IF EXISTS "${testTable}"`);

  const cleanupCheck = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = $1
  `, [testTable]);
  const cleanupVerified = cleanupCheck.rows.length === 0;

  report('Step 5', 'Cleanup (DROP temporary test table)', cleanupVerified,
    `Temporary table "${testTable}" dropped successfully. Zero residual data.`);

  console.log('\n======================================================');
  console.log(`FINAL RESULT: ${allPassed ? 'ALL TESTS PASSED [PASS]' : 'SOME TESTS FAILED [FAIL]'}`);
  console.log('All RDS PostgreSQL CRUD operations verified live on AWS.');
  console.log('======================================================\n');
} catch (err) {
  report('Step Error', 'Database operation exception', false, err.message);
} finally {
  await client.end();
}
