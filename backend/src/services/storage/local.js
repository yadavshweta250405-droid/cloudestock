import fs from 'node:fs';
import path from 'node:path';

/** Local file storage (a folder). Same method set an S3 implementation would expose. */
export class LocalStorage {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }
  resolve(key) {
    const full = path.resolve(this.dir, key);
    if (full !== this.dir && !full.startsWith(this.dir + path.sep)) throw new Error('Invalid storage key');
    return full;
  }
  async put(key, buffer, contentType = 'application/octet-stream') {
    const full = this.resolve(key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
    return { key, size: buffer.length, contentType };
  }
  async get(key) {
    const full = this.resolve(key);
    return fs.existsSync(full) ? fs.readFileSync(full) : null;
  }
  async exists(key) { return fs.existsSync(this.resolve(key)); }
  async delete(key) { const f = this.resolve(key); if (fs.existsSync(f)) fs.unlinkSync(f); }
  async list(prefix = '') {
    const out = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else out.push(path.relative(this.dir, p).split(path.sep).join('/'));
      }
    };
    walk(this.dir);
    return out.filter((k) => k.startsWith(prefix));
  }
  publicUrl(key) { return `/uploads/${key}`; }
}
