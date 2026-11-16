/** In-process event bus. The HTTP layer bridges it to browsers through Server-Sent Events. */
export class LocalEvents {
  constructor() { this.handlers = new Set(); this.seq = 0; }
  publish(type, payload = {}) {
    const event = { id: ++this.seq, type, at: new Date().toISOString(), ...payload };
    for (const h of this.handlers) { try { h(event); } catch (e) { console.error('[events] handler failed:', e.message); } }
    return event;
  }
  subscribe(handler) { this.handlers.add(handler); return () => this.handlers.delete(handler); }
}
