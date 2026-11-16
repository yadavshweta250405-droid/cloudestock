const KEY = 'waretrack.token';
export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const session = {
  get token() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ } },
};
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, url, body, opts = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let payload;
  if (opts.raw) { payload = body; headers['Content-Type'] = opts.contentType; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(url, { method, headers, body: payload }); }
  catch { throw new ApiError(0, 'Cannot reach the server. Check that it is running.'); }
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!res.ok) {
    const err = data?.error || {};
    if (res.status === 401 && !url.includes('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, err.message || `Request failed (${res.status})`, err.details);
  }
  return data;
}
const qs = (p) => { const u = new URLSearchParams(); Object.entries(p || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') u.set(k, v); }); const s = u.toString(); return s ? `?${s}` : ''; };
export const api = {
  get: (url, params) => request('GET', `/api${url}${qs(params)}`),
  post: (url, body = {}) => request('POST', `/api${url}`, body),
  put: (url, body) => request('PUT', `/api${url}`, body),
  patch: (url, body) => request('PATCH', `/api${url}`, body),
  del: (url) => request('DELETE', `/api${url}`),
  upload: (url, file) => request('POST', `/api${url}`, file, { raw: true, contentType: file.type }),
};

/** Server-Sent Events: the backend pushes "changed", "notification" and "sync" events; EventSource reconnects by itself. */
export function connectEvents(handlers) {
  if (!window.EventSource || !session.token) return () => {};
  const es = new EventSource(`/api/events?token=${encodeURIComponent(session.token)}`);
  for (const [type, fn] of Object.entries(handlers)) es.addEventListener(type, (e) => { try { fn(JSON.parse(e.data)); } catch { /* ignore malformed */ } });
  es.onerror = () => handlers.connection?.(false);
  es.onopen = () => handlers.connection?.(true);
  return () => es.close();
}
