import { nowIso } from '../../core/util.js';

/** Notifications stored in the database and pushed live through the event bus. */
export class LocalNotifications {
  constructor({ db, events }) { this.db = db; this.events = events; }
  notify({ level = 'info', title, message = '', entityType = null, entityId = null, userId = null, dedupeMinutes = 0 }) {
    if (dedupeMinutes > 0) {
      const since = new Date(Date.now() - dedupeMinutes * 60000).toISOString();
      const dup = this.db.get(
        `SELECT id FROM notifications WHERE title = ? AND COALESCE(entity_type,'') = ? AND COALESCE(entity_id,0) = ? AND created_at > ?`,
        [title, entityType || '', entityId || 0, since],
      );
      if (dup) return null;
    }
    const { lastId } = this.db.run(
      'INSERT INTO notifications(user_id, level, title, message, entity_type, entity_id, created_at) VALUES(?,?,?,?,?,?,?)',
      [userId, level, title, message, entityType, entityId, nowIso()],
    );
    const n = { id: lastId, level, title, message, entityType, entityId };
    this.events.publish('notification', { notification: n });
    return n;
  }
  listFor(userId, { limit = 50 } = {}) {
    return this.db.all(
      `SELECT n.id, n.level, n.title, n.message, n.entity_type, n.entity_id, n.created_at,
              CASE WHEN r.notification_id IS NULL THEN 0 ELSE 1 END AS is_read
       FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
       WHERE n.user_id IS NULL OR n.user_id = ? ORDER BY n.id DESC LIMIT ?`,
      [userId, userId, limit],
    );
  }
  unreadCount(userId) {
    return this.db.get(
      `SELECT COUNT(*) AS c FROM notifications n
       WHERE (n.user_id IS NULL OR n.user_id = ?) AND NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id = n.id AND r.user_id = ?)`,
      [userId, userId],
    ).c;
  }
  markRead(userId, id) { this.db.run('INSERT OR IGNORE INTO notification_reads(user_id, notification_id) VALUES(?,?)', [userId, id]); }
  markAllRead(userId) {
    this.db.run(
      `INSERT OR IGNORE INTO notification_reads(user_id, notification_id)
       SELECT ?, id FROM notifications WHERE user_id IS NULL OR user_id = ?`, [userId, userId]);
  }
}
