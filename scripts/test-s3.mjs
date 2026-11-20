/**
 * Script to test Amazon S3 connection and bucket access.
 * Usage:
 *   node scripts/test-s3.mjs
 *
 * Reads configuration from .env or environment variables:
 *   S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 */

import { loadConfig } from '../backend/src/config.js';
import { S3Storage } from '../backend/src/services/storage/s3.js';

const cfg = loadConfig();
const s3Cfg = cfg.storage;

console.log('--- Testing Amazon S3 Connection ---');
console.log('Bucket :', s3Cfg.bucket || '(Not set)');
console.log('Region :', s3Cfg.region);
console.log('Prefix :', s3Cfg.prefix || '(Root)');

if (!s3Cfg.bucket) {
  console.error('\nERROR: S3_BUCKET is not set in .env');
  console.log('Please add your bucket name in .env, e.g.:');
  console.log('  STORAGE_PROVIDER=s3');
  console.log('  S3_BUCKET=my-waretrack-bucket');
  console.log('  AWS_REGION=ap-south-1');
  process.exit(1);
}

const s3 = new S3Storage(s3Cfg);
const testKey = `test-healthcheck-${Date.now()}.txt`;
const testContent = Buffer.from(`WareTrack 3D S3 Health Check @ ${new Date().toISOString()}`);

try {
  console.log(`\n1. Uploading test file: ${testKey}...`);
  await s3.put(testKey, testContent, 'text/plain');
  console.log('   Upload SUCCESS!');

  console.log(`2. Checking existence...`);
  const exists = await s3.exists(testKey);
  console.log(`   Exists: ${exists}`);

  console.log(`3. Downloading test file...`);
  const downloaded = await s3.get(testKey);
  console.log(`   Content: "${downloaded?.toString()}"`);

  console.log(`4. Deleting test file...`);
  await s3.delete(testKey);
  console.log('   Cleanup SUCCESS!');

  console.log(`5. Public URL format:`);
  console.log(`   ${s3.publicUrl('products/example.png')}`);

  console.log('\nAll S3 operations verified successfully! S3 is ready for WareTrack 3D.');
} catch (err) {
  console.error('\nS3 Connection Test FAILED:');
  console.error(err.message);
  if (err.name === 'CredentialsProviderError' || err.message.includes('credential')) {
    console.error('\nHint: Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY or IAM permissions.');
  }
}
