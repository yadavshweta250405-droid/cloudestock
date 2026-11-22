import { LocalNotifications } from './local.js';

/**
 * Amazon SNS Notifications Provider.
 *
 * Implements CONTRACTS.notifications: ['notify', 'listFor', 'markRead', 'markAllRead', 'unreadCount'].
 *
 * Persists in-app notifications locally and forwards alerts to Amazon SNS Topic
 * for real-time email, SMS, or webhook dispatching to subscribers.
 */
export class SnsNotifications {
  constructor(cfg, deps) {
    this.cfg = cfg || {};
    this.local = new LocalNotifications(deps);
    this.topicArn = cfg.topicArn || process.env.SNS_TOPIC_ARN || '';
    this.region = cfg.region || process.env.AWS_REGION || 'ap-south-1';
    this.client = null;
  }

  async #getClient() {
    if (this.client) return this.client;
    try {
      const { SNSClient } = await import('@aws-sdk/client-sns');
      const clientConfig = { region: this.region };

      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        clientConfig.credentials = {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
        };
      }

      this.client = new SNSClient(clientConfig);
      return this.client;
    } catch {
      throw new Error(
        '[notifications:sns] Package "@aws-sdk/client-sns" is not installed. Run "npm install @aws-sdk/client-sns" to use SNS notifications.',
      );
    }
  }

  notify(data) {
    const n = this.local.notify(data);
    if (!n) return null; // Deduped locally

    if (this.topicArn) {
      this.#publishToSns(data, n).catch((err) => {
        console.warn(`[notifications:sns] Publish notice: ${err.message}`);
      });
    }

    return n;
  }

  async #publishToSns({ level = 'info', title, message = '', entityType, entityId }, n) {
    const client = await this.#getClient();
    const { PublishCommand } = await import('@aws-sdk/client-sns');

    const subject = `[WareTrack 3D] ${level.toUpperCase()}: ${title}`.slice(0, 100);
    const body = [
      '==================================================',
      ' WareTrack 3D Enterprise Notification',
      '==================================================',
      `Alert Level : ${level.toUpperCase()}`,
      `Title       : ${title}`,
      `Message     : ${message || '(No extra details)'}`,
      `Reference   : ${entityType ? `${entityType} #${entityId || ''}` : 'General Alert'}`,
      `Time        : ${new Date().toISOString()}`,
      '==================================================',
      'Access your live 3D warehouse dashboard at:',
      'http://13.205.235.73:3000',
    ].join('\n');

    await client.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Subject: subject,
        Message: body,
      }),
    );
  }

  listFor(userId, opts) {
    return this.local.listFor(userId, opts);
  }

  unreadCount(userId) {
    return this.local.unreadCount(userId);
  }

  markRead(userId, id) {
    return this.local.markRead(userId, id);
  }

  markAllRead(userId) {
    return this.local.markAllRead(userId);
  }
}
