import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].replace(/\s+#.*$/, '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function merge(a, b) {
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) a[k] = merge(a[k] || {}, v);
    else a[k] = v;
  }
  return a;
}

export function loadConfig(overrides = {}) {
  loadDotEnv(path.join(ROOT, '.env'));
  const e = process.env;
  const num = (k, d) => (e[k] !== undefined && e[k] !== '' && !Number.isNaN(Number(e[k])) ? Number(e[k]) : d);
  const bool = (k, d) => (e[k] === undefined || e[k] === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(e[k]).toLowerCase()));
  const provider = (k) => e[k] || 'local';
  const cfg = {
    env: e.NODE_ENV || 'development',
    host: e.HOST || '127.0.0.1',
    port: num('PORT', 3000),
    root: ROOT,
    corsOrigin: e.CORS_ORIGIN || '',
    autoSeed: bool('AUTO_SEED', true),
    db: {
      provider: e.DB_PROVIDER || 'sqlite',
      file: path.resolve(ROOT, e.DB_FILE || 'database/data/waretrack.db'),
      url: e.DATABASE_URL || '',
    },
    storage: {
      provider: provider('STORAGE_PROVIDER'),
      dir: path.resolve(ROOT, e.STORAGE_DIR || 'database/data/files'),
      bucket: e.S3_BUCKET || '',
      prefix: e.S3_PREFIX || '',
      region: e.AWS_REGION || 'us-east-1',
      cloudfrontUrl: e.CLOUDFRONT_URL || '',
    },
    auth: { provider: provider('AUTH_PROVIDER'), sessionTtlHours: num('SESSION_TTL_HOURS', 12) },
    events: { provider: provider('EVENTS_PROVIDER') },
    notifications: {
      provider: provider('NOTIFICATIONS_PROVIDER'),
      topicArn: e.SNS_TOPIC_ARN || '',
      region: e.AWS_REGION || 'ap-south-1',
    },
    jobs: { provider: provider('JOBS_PROVIDER'), vehicleReturnDelayMs: num('VEHICLE_RETURN_DELAY_MS', 20000), lowStockScanMs: num('LOW_STOCK_SCAN_MS', 300000) },
    sync: { provider: provider('SYNC_PROVIDER'), intervalMs: num('SYNC_INTERVAL_MS', 300000), key: 'snapshots/latest.json' },
  };
  return merge(cfg, overrides);
}
