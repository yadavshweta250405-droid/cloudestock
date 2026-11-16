export const nowIso = () => new Date().toISOString();
export const pad = (n, w = 4) => String(n).padStart(w, '0');
export const toInt = (v, d = 0) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : d; };
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const pageParams = (q, defLimit = 100) => ({ limit: clamp(toInt(q.limit, defLimit), 1, 500), offset: Math.max(0, toInt(q.offset, 0)) });
export const likeTerm = (q) => `%${String(q || '').replace(/[%_\\]/g, (c) => '\\' + c)}%`;
export const priorityRank = `CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`;
export function stockStatus(onHand, reorder) { return onHand <= 0 ? 'out' : onHand <= reorder ? 'low' : 'ok'; }
