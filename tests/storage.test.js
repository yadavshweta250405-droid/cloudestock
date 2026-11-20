import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACTS, assertContract } from '../backend/src/services/contracts.js';
import { createStorage } from '../backend/src/services/storage/index.js';
import { LocalStorage } from '../backend/src/services/storage/local.js';
import { S3Storage } from '../backend/src/services/storage/s3.js';

test('storage contract: methods are defined', () => {
  assert.deepEqual(CONTRACTS.storage, ['put', 'get', 'delete', 'exists', 'publicUrl', 'list']);
});

test('storage provider: local implementation matches contract', () => {
  const local = new LocalStorage('./database/data/files');
  assert.doesNotThrow(() => assertContract('storage', local));
});

test('storage provider: S3 implementation matches contract and constructs valid URLs', () => {
  const s3 = new S3Storage({ bucket: 'my-waretrack-bucket', region: 'ap-south-1' });
  assert.doesNotThrow(() => assertContract('storage', s3));

  // Direct S3 URL
  const url1 = s3.publicUrl('products/PRD-001.png');
  assert.equal(url1, 'https://my-waretrack-bucket.s3.ap-south-1.amazonaws.com/products/PRD-001.png');

  // CloudFront CDN URL
  const s3Cf = new S3Storage({ bucket: 'my-waretrack-bucket', region: 'ap-south-1', cloudfrontUrl: 'https://d12345.cloudfront.net' });
  const url2 = s3Cf.publicUrl('products/PRD-001.png');
  assert.equal(url2, 'https://d12345.cloudfront.net/products/PRD-001.png');
});

test('createStorage: instantiates correct provider based on config', () => {
  const localStore = createStorage({ provider: 'local', dir: './database/data/files' });
  assert.ok(localStore instanceof LocalStorage);

  const s3Store = createStorage({ provider: 's3', bucket: 'test-bucket', region: 'us-east-1' });
  assert.ok(s3Store instanceof S3Storage);

  assert.throws(() => createStorage({ provider: 'unknown-provider' }), /not implemented/i);
});
