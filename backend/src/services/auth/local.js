import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { nowIso } from '../../core/util.js';
import { HttpError } from '../../core/errors.js';

const scrypt = promisify(crypto.scrypt);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Local authentication: scrypt password hashes + opaque random bearer tokens stored (hashed) in the sessions table. */
export class LocalAuth {
  constructor({ db, ttlHours }) {
    this.db = db;
    this.ttlMs = ttlHours * 3600 * 1000;
    this.attempts = new Map();   // brute-force protection: key -> {count, until}
  }
  async hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password, salt, 64);
    return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
  }
  async verifyPassword(password, stored) {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(expected, actual);
  }
  checkLock(key) {
    const a = this.attempts.get(key);
    if (a && a.until > Date.now()) throw new HttpError(429, 'Too many failed sign-in attempts. Try again in a few minutes.');
  }
  fail(key) {
    const a = this.attempts.get(key) || { count: 0, until: 0 };
    a.count += 1;
    if (a.count >= 5) { a.until = Date.now() + 5 * 60000; a.count = 0; }
    this.attempts.set(key, a);
  }
  async login(email, password, meta = {}) {
    const key = `${meta.ip || 'ip'}|${String(email).toLowerCase()}`;
    this.checkLock(key);
    const user = this.db.get('SELECT * FROM users WHERE email = ? AND active = 1', [String(email).toLowerCase()]);
    // verify against a dummy hash when the user is unknown to keep timing similar
    const ok = user ? await this.verifyPassword(password, user.password_hash) : (await this.verifyPassword(password, 'scrypt$00$00'), false);
    if (!ok) { this.fail(key); throw new HttpError(401, 'Invalid email or password'); }
    this.attempts.delete(key);
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + this.ttlMs).toISOString();
    this.db.run('INSERT INTO sessions(user_id, token_hash, created_at, expires_at, user_agent) VALUES(?,?,?,?,?)',
      [user.id, sha256(token), nowIso(), expires, String(meta.userAgent || '').slice(0, 200)]);
    this.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
    this.db.run('DELETE FROM sessions WHERE expires_at < ?', [nowIso()]);
    return { token, expiresAt: expires, user: this.publicUser(user) };
  }
  logout(token) { if (token) this.db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]); }
  revokeUserSessions(userId) { this.db.run('DELETE FROM sessions WHERE user_id = ?', [userId]); }
  authenticate(token) {
    if (!token) return null;
    const row = this.db.get(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`, [sha256(token), nowIso()]);
    return row ? this.publicUser(row) : null;
  }
  publicUser(u) {
    return { id: u.id, email: u.email, name: u.name, role: u.role, employeeId: u.employee_id, active: !!u.active };
  }
}
