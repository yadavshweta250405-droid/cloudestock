/**
 * Infrastructure contracts.
 *
 * Business logic (backend/src/modules) only talks to these interfaces through the container (ctx).
 * Each interface has a local implementation today; an AWS-backed implementation can be added later by
 * writing one new file per service and selecting it with an environment variable (see AWS_INTEGRATION_GUIDE.md).
 */
export const CONTRACTS = {
  database: ['all', 'get', 'run', 'exec', 'transaction', 'close'],                       // -> Amazon RDS (PostgreSQL/MySQL)
  storage: ['put', 'get', 'delete', 'exists', 'publicUrl', 'list'],                      // -> Amazon S3
  auth: ['login', 'logout', 'authenticate', 'hashPassword', 'verifyPassword', 'revokeUserSessions'], // -> Amazon Cognito
  notifications: ['notify', 'listFor', 'markRead', 'markAllRead', 'unreadCount'],        // -> Amazon SNS (+ SES)
  events: ['publish', 'subscribe'],                                                      // -> API Gateway WebSocket / EventBridge / SNS
  jobs: ['register', 'enqueue', 'every', 'stop'],                                        // -> Amazon SQS + Lambda / EventBridge Scheduler
  sync: ['start', 'stop', 'syncNow', 'status'],                                          // -> Lambda + S3 / DynamoDB export
};

export function assertContract(name, impl) {
  const missing = CONTRACTS[name].filter((m) => typeof impl[m] !== 'function');
  if (missing.length) throw new Error(`Service "${name}" is missing methods: ${missing.join(', ')}`);
  return impl;
}

export function unsupportedProvider(service, provider) {
  return new Error(
    `${service} provider "${provider}" is not implemented in this build. ` +
    `Only "local" (or "sqlite" for the database) ships today. See documentation/AWS_INTEGRATION_GUIDE.md to add one.`,
  );
}
