import pg from 'pg';
import { loadConfig } from '../backend/src/config.js';
const { Client } = pg;

const config = loadConfig();
const dbUrl = config.db.url || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL is not set in .env or environment');
  process.exit(1);
}

console.log('--- Testing Amazon RDS PostgreSQL Connection ---');

let client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

try {
  console.log(`Connecting to database "${dbName}"...`);
  await client.connect();
  console.log('CONNECTED successfully to database: ' + dbName);
} catch (err) {
  console.log(`Could not connect to "${dbName}": ${err.message}`);
  console.log('Retrying with default database "postgres"...');
  dbName = 'postgres';
  client = new Client({
    host,
    port,
    user,
    password,
    database: dbName,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  console.log('CONNECTED successfully to database: ' + dbName);
}

try {
  const res = await client.query('SELECT version(), current_database(), current_user, now()');
  console.log('\n--- RDS PostgreSQL Info ---');
  console.log('PostgreSQL Version :', res.rows[0].version.split(',')[0]);
  console.log('Current Database   :', res.rows[0].current_database);
  console.log('Current User       :', res.rows[0].current_user);
  console.log('Server Time        :', res.rows[0].now);

  // If connected to 'postgres' and 'waretrack' doesn't exist, create 'waretrack'
  if (dbName === 'postgres') {
    const checkDb = await client.query("SELECT 1 FROM pg_database WHERE datname = 'waretrack'");
    if (checkDb.rows.length === 0) {
      console.log('\nCreating database "waretrack"...');
      await client.query('CREATE DATABASE waretrack');
      console.log('Database "waretrack" created successfully!');
    } else {
      console.log('Database "waretrack" exists.');
    }
  }

  console.log('\nAmazon RDS is 100% accessible, authenticated, and ready!');
} catch (e) {
  console.error('Query error:', e.message);
} finally {
  await client.end();
}
