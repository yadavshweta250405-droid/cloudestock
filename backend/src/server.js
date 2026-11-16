import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ROOT } from './config.js';
import { createContainer, defaultLogger } from './container.js';
import { Router } from './core/router.js';
import { HttpError, unauthorized, forbidden } from './core/errors.js';
import { can } from '../../shared/constants.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createApp(config = loadConfig(), { log = defaultLogger } = {}) {
  const ctx = createContainer(config, { log });
  const router = new Router();
  ctx.registerRoutes(router);
  const sseClients = new Set();

  ctx.events.subscribe((event) => {
    const frame = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const c of sseClients) c.write(frame);
  });
  const heartbeat = setInterval(() => { for (const c of sseClients) c.write(': ping\n\n'); }, 25000);
  heartbeat.unref();

  const bearer = (req, url) => {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) return h.slice(7).trim();
    return url.searchParams.get('token') || null;   // EventSource cannot set headers
  };

  function send(res, status, body, headers = {}) {
    const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(payload);
  }

  async function handleApi(req, res, url) {
    if (url.pathname === '/api/health') return send(res, 200, { status: 'ok', time: new Date().toISOString() });
    if (url.pathname === '/api/events' && req.method === 'GET') {
      const user = await ctx.auth.authenticate(bearer(req, url));
      if (!user) throw unauthorized();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ user: user.name, sync: ctx.sync.status() })}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return undefined;
    }
    const m = router.match(req.method, url.pathname);
    if (!m) throw new HttpError(404, `No such endpoint: ${req.method} ${url.pathname}`);
    const { route, params } = m;
    const token = bearer(req, url);
    let user = null;
    if (!route.opts.public) {
      user = await ctx.auth.authenticate(token);
      if (!user) throw unauthorized();
      if (route.opts.perm && !can(user.role, route.opts.perm)) throw forbidden();
    }
    let body;
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (route.opts.raw) body = await readBody(req, 2 * 1024 * 1024);
      else {
        const buf = await readBody(req, 1024 * 1024);
        if (buf.length) {
          try { body = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Request body must be valid JSON'); }
        }
      }
    }
    let status = 200;
    const result = await route.handler({
      req, res, params, query: Object.fromEntries(url.searchParams), body, user, token, ctx, setStatus: (c) => { status = c; },
    });
    return send(res, status, result === undefined ? { ok: true } : result);
  }

  function errorResponse(res, err) {
    if (res.headersSent) { res.end(); return; }
    let status = err.status || 500;
    let message = err.message;
    let details = err.details;
    if (!err.status) {
      const msg = String(err.message || '');
      let m;
      if ((m = msg.match(/UNIQUE constraint failed: (\w+)\.(\w+)/))) { status = 409; message = `${m[2].replace(/_/g, ' ')} already exists`; details = { [m[2]]: 'must be unique' }; }
      else if (/FOREIGN KEY constraint failed/.test(msg)) { status = 409; message = 'This record is referenced by other data and cannot be changed this way'; }
      else if (/CHECK constraint failed/.test(msg)) { status = 422; message = 'Value rejected by a database rule'; }
      else { ctx.log.error(err.stack || err); message = 'Internal server error'; }
    }
    send(res, status, { error: { status, message, details } });
  }

  async function serveStatic(req, res, url) {
    let pathname = decodeURIComponent(url.pathname);
    let root = path.join(ROOT, 'frontend');
    if (pathname.startsWith('/shared/')) { root = path.join(ROOT, 'shared'); pathname = pathname.slice(7); }
    else if (pathname.startsWith('/public/')) { root = path.join(ROOT, 'public'); pathname = pathname.slice(7); }
    else if (pathname.startsWith('/uploads/')) {
      const key = pathname.slice(9);
      let buf = null;
      try { buf = await ctx.storage.get(key); } catch { /* invalid key */ }
      if (!buf) return send(res, 404, { error: { status: 404, message: 'File not found' } });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(key).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      return res.end(buf);
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    let file = path.normalize(path.join(root, pathname));
    if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, { error: { status: 403, message: 'Forbidden' } });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(pathname)) return send(res, 404, { error: { status: 404, message: 'File not found' } });
      file = path.join(ROOT, 'frontend', 'index.html');   // single page app fallback
    }
    const ext = path.extname(file).toLowerCase();
    if (file === path.join(ROOT, 'frontend', 'index.html')) {
      // Three.js is loaded from a pinned CDN build unless `npm run vendor:three` downloaded a local copy.
      const local = fs.existsSync(path.join(ROOT, 'frontend', 'vendor', 'three', 'three.module.js'));
      const cdn = 'https://cdn.jsdelivr.net/npm/three@0.160.0';
      const map = local ? { three: '/vendor/three/three.module.js', 'three/addons/': '/vendor/three/addons/' } : { three: `${cdn}/build/three.module.js`, 'three/addons/': `${cdn}/examples/jsm/` };
      const html = fs.readFileSync(file, 'utf8').replace('<!--IMPORTMAP-->', `<script type="importmap">${JSON.stringify({ imports: map })}</script>`);
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (config.corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, url);
      else send(res, 405, { error: { status: 405, message: 'Method not allowed' } });
    } catch (err) { errorResponse(res, err); }
  });

  return {
    ctx, server,
    async start() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
      ctx.startBackground();
      return server.address();
    },
    async stop() {
      clearInterval(heartbeat);
      for (const c of sseClients) c.end();
      await new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); });
      ctx.close();
    },
  };
}

// ---- CLI entry ----
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const app = createApp(config);
  const { seedIfEmpty } = await import('../../database/seed.js');
  if (config.autoSeed) await seedIfEmpty(app.ctx);
  const addr = await app.start();
  console.log(`\n  WareTrack 3D is running  ->  http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${addr.port}\n`);
  const shutdown = async () => { await app.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
