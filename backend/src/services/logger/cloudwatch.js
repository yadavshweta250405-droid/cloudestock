/**
 * Amazon CloudWatch Logging Service for WareTrack 3D
 *
 * Implements non-blocking, batched asynchronous log forwarding to
 * AWS CloudWatch Logs group `/waretrack3d/backend` using AWS SDK v3.
 *
 * Handles:
 * - Application runtime errors and uncaught exceptions
 * - HTTP API request logs (method, path, status, latency)
 * - Important system and domain events (orders, shipments, stock)
 */
export class CloudWatchLogger {
  constructor(cfg = {}) {
    this.enabled = !!cfg.cloudwatchEnabled;
    this.logGroupName = cfg.logGroupName || '/waretrack3d/backend';
    this.region = cfg.region || process.env.AWS_REGION || 'ap-south-1';
    this.logStreamName = cfg.logStreamName || `backend-${new Date().toISOString().slice(0, 10)}-pid${process.pid}`;

    this.queue = [];
    this.client = null;
    this.streamReady = false;
    this.isFlushing = false;
    this.initPromise = null;
    this.disabledDueToAuth = false;

    if (this.enabled) {
      this.timer = setInterval(() => this.flush(), 3000);
      if (this.timer.unref) this.timer.unref();
    }
  }

  async #getClient() {
    if (this.client) return this.client;
    const { CloudWatchLogsClient } = await import('@aws-sdk/client-cloudwatch-logs');
    const clientConfig = { region: this.region };

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      clientConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
      };
    }

    this.client = new CloudWatchLogsClient(clientConfig);
    return this.client;
  }

  async #ensureLogStream() {
    if (this.streamReady) return true;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const client = await this.#getClient();
        const { CreateLogGroupCommand, CreateLogStreamCommand } = await import('@aws-sdk/client-cloudwatch-logs');

        // 1. Ensure Log Group exists
        try {
          await client.send(new CreateLogGroupCommand({ logGroupName: this.logGroupName }));
        } catch (err) {
          if (err.name !== 'ResourceAlreadyExistsException') {
            // If lacking permissions, log locally and disable to avoid recurring errors
            if (err.name === 'AccessDeniedException' || err.name === 'UnauthorizedOperation') {
              this.disabledDueToAuth = true;
              console.warn(`[logger:cloudwatch] Notice: ${err.message}. Local logging continues.`);
              return false;
            }
          }
        }

        // 2. Ensure Log Stream exists
        try {
          await client.send(new CreateLogStreamCommand({
            logGroupName: this.logGroupName,
            logStreamName: this.logStreamName,
          }));
        } catch (err) {
          if (err.name !== 'ResourceAlreadyExistsException') {
            if (err.name === 'AccessDeniedException') {
              this.disabledDueToAuth = true;
              console.warn(`[logger:cloudwatch] Notice: ${err.message}`);
              return false;
            }
          }
        }

        this.streamReady = true;
        console.log(`[logger:cloudwatch] Active stream -> ${this.logGroupName} [${this.logStreamName}]`);
        return true;
      } catch (err) {
        console.warn(`[logger:cloudwatch] Init error: ${err.message}`);
        return false;
      }
    })();

    return this.initPromise;
  }

  enqueue(level, message, meta = null) {
    // Always mirror to stdout/stderr locally
    const prefix = `[${level.toUpperCase()}]`;
    if (level === 'error') console.error(prefix, message, meta || '');
    else if (level === 'warn') console.warn(prefix, message, meta || '');
    else if (process.env.WARETRACK_QUIET !== '1') console.log(prefix, message, meta || '');

    if (!this.enabled || this.disabledDueToAuth) return;

    const payload = {
      level,
      message,
      ...(meta && typeof meta === 'object' ? meta : meta ? { data: meta } : {}),
      service: 'waretrack3d-backend',
      environment: process.env.NODE_ENV || 'development',
      time: new Date().toISOString(),
    };

    this.queue.push({
      timestamp: Date.now(),
      message: JSON.stringify(payload),
    });

    if (this.queue.length >= 25 || level === 'error') {
      this.flush().catch(() => {});
    }
  }

  info(msg, meta) { this.enqueue('info', msg, meta); }
  warn(msg, meta) { this.enqueue('warn', msg, meta); }
  error(msg, meta) { this.enqueue('error', msg, meta); }

  logApiRequest({ method, path, status, durationMs, user, ip }) {
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    this.enqueue(level, `HTTP ${method} ${path} -> ${status} (${durationMs}ms)`, {
      category: 'api_request',
      method,
      path,
      status,
      durationMs,
      userId: user?.id || null,
      userName: user?.name || 'anonymous',
      ip: ip || '127.0.0.1',
    });
  }

  logSystemEvent(action, message, meta) {
    this.enqueue('info', `Event: ${action} - ${message}`, {
      category: 'system_event',
      action,
      ...meta,
    });
  }

  async flush() {
    if (this.isFlushing || this.queue.length === 0 || !this.enabled || this.disabledDueToAuth) return;
    this.isFlushing = true;

    try {
      const ready = await this.#ensureLogStream();
      if (!ready || this.queue.length === 0) return;

      const eventsToSend = this.queue.splice(0, 50);
      eventsToSend.sort((a, b) => a.timestamp - b.timestamp);

      const client = await this.#getClient();
      const { PutLogEventsCommand } = await import('@aws-sdk/client-cloudwatch-logs');

      await client.send(new PutLogEventsCommand({
        logGroupName: this.logGroupName,
        logStreamName: this.logStreamName,
        logEvents: eventsToSend,
      }));
    } catch (err) {
      if (err.name === 'AccessDeniedException') {
        this.disabledDueToAuth = true;
        console.warn(`[logger:cloudwatch] AccessDenied: ${err.message}. Further remote flushes paused.`);
      } else {
        console.warn(`[logger:cloudwatch] Flush notice: ${err.message}`);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}
