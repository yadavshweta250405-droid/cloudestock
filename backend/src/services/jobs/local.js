/** In-process background jobs: named handlers, delayed one-off jobs and recurring jobs. */
export class LocalJobs {
  constructor({ log }) { this.log = log; this.handlers = new Map(); this.timers = new Set(); this.stopped = false; }
  register(name, handler) { this.handlers.set(name, handler); }
  async run(name, payload) {
    const h = this.handlers.get(name);
    if (!h) { this.log.warn(`[jobs] no handler for "${name}"`); return; }
    try { await h(payload); } catch (e) { this.log.error(`[jobs] "${name}" failed: ${e.stack || e.message}`); }
  }
  enqueue(name, payload = {}, { delayMs = 0 } = {}) {
    const t = setTimeout(() => { this.timers.delete(t); if (!this.stopped) this.run(name, payload); }, delayMs);
    t.unref?.();
    this.timers.add(t);
  }
  every(name, intervalMs, handler) {
    this.register(name, handler);
    const t = setInterval(() => { if (!this.stopped) this.run(name, {}); }, intervalMs);
    t.unref?.();
    this.timers.add(t);
  }
  stop() { this.stopped = true; for (const t of this.timers) { clearTimeout(t); clearInterval(t); } this.timers.clear(); }
}
