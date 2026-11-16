/**
 * Data synchronisation (the "sync script + data file" loop from the reference guide).
 * Every interval it collects a snapshot of live numbers from the database and writes it through the storage service
 * (a local file today, an S3 object later). The 3D dashboard shows "LIVE / updated X min ago" from lastSyncAt.
 */
export class LocalSync {
  constructor({ cfg, storage, events, jobs, collect, log }) {
    Object.assign(this, { cfg, storage, events, jobs, collect, log });
    this.last = null;
    this.lastError = null;
  }
  start() {
    this.jobs.every('data.sync', this.cfg.intervalMs, () => this.syncNow());
    return this.syncNow();
  }
  stop() { /* timers are owned by the jobs service */ }
  async syncNow() {
    try {
      const snapshot = { syncedAt: new Date().toISOString(), source: 'database', ...this.collect() };
      await this.storage.put(this.cfg.key, Buffer.from(JSON.stringify(snapshot, null, 2)), 'application/json');
      this.last = snapshot.syncedAt;
      this.lastError = null;
      this.events.publish('sync', { syncedAt: this.last });
    } catch (e) {
      this.lastError = e.message;       // keep last good snapshot, retry next interval
      this.log.error(`[sync] failed: ${e.message}`);
    }
    return this.status();
  }
  status() { return { lastSyncAt: this.last, lastError: this.lastError, intervalMs: this.cfg.intervalMs, key: this.cfg.key }; }
}
