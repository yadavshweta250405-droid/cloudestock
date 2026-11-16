# AWS integration guide

**Status: no AWS code or SDK is installed.** The application runs fully locally. This guide explains how each local component maps to an AWS service, so integration is "add one provider file per service + set environment variables", not a rewrite.

## 1. How the seams work
Business logic (`backend/src/modules/*`) calls only the interfaces in `backend/src/services/contracts.js` through `ctx`. Each service folder has `index.js` that picks an implementation from `<NAME>_PROVIDER`:

```js
// backend/src/services/storage/index.js (today)
switch (cfg.provider) { case 'local': return assertContract('storage', new LocalStorage(cfg.dir));
                        default: throw unsupportedProvider('Storage', cfg.provider); }   // ← add  case 's3': …
```
Adding a provider = create `s3.js` implementing the contract's methods, add one `case`. `assertContract` fails at startup if a method is missing.

## 2. Mapping
| Local component | AWS service | Contract methods to implement | Notes |
|---|---|---|---|
| SQLite (`services/database/sqlite.js`) | **Amazon RDS (PostgreSQL)** or Aurora | `all get run exec transaction close` | Use `pg` with a pool. `transaction()` must hold ONE connection for the whole callback. **The contract is currently synchronous** (SQLite); a Postgres driver is async → see §3.1. |
| Local folder (`services/storage/local.js`) | **Amazon S3** (+ CloudFront) | `put get delete exists publicUrl list` | Product images (`products/…`) and the sync snapshot (`snapshots/latest.json`). `publicUrl` → CloudFront URL or pre-signed URL. Private bucket, block public access. |
| Local auth (`services/auth/local.js`) | **Amazon Cognito** | `login logout authenticate hashPassword verifyPassword revokeUserSessions` | Map Cognito groups to the 4 roles; `authenticate(token)` verifies the Cognito JWT (JWKS) and returns `{id,email,name,role,employeeId}`. Keep a `users` row per Cognito `sub` for `employee_id` linkage. |
| Event bus + SSE (`services/events/local.js`) | **API Gateway WebSocket** (or AppSync) fed by **EventBridge/SNS** | `publish subscribe` | With >1 server instance, in-process events are not enough: publish to SNS/Redis and let each instance fan out to its SSE clients, or move push to API Gateway WebSocket. Event names/payloads stay identical (`changed`, `notification`, `sync`). |
| Notifications (`services/notifications/local.js`) | **Amazon SNS** (+ SES for email) | `notify listFor markRead markAllRead unreadCount` | Keep the DB table for the in-app bell; additionally `sns.publish` for warning/danger levels (SMS/email to managers). |
| Jobs (`services/jobs/local.js`) | **Amazon SQS + Lambda** / **EventBridge Scheduler** | `register enqueue every stop` | `vehicle.return` (delayed job) → SQS delay queue or Step Functions wait; `stock.low-scan`, `data.sync` → EventBridge schedules invoking Lambda/ECS task. |
| Sync (`services/sync/local.js`) | **Lambda → S3** (or DynamoDB) | `start stop syncNow status` | Writes the aggregate snapshot; with S3 it can also feed QuickSight/Athena. |
| Node process | **EC2** (or ECS Fargate / App Runner) behind an **ALB** | — | See §5. |
| Logging | **CloudWatch Logs / Alarms** | — | `ctx.log` is a thin console wrapper; ship stdout via the CloudWatch agent / awslogs driver; alarm on 5xx, task failures, DB connections. |
| REST API | **API Gateway** (optional) | — | Only needed if you split the monolith into Lambdas; the ALB → Node route works without it. |

## 3. Code changes required (by file)
### 3.1 Database: sync → async
`SqliteDatabase` is synchronous, and every module calls `db.get/all/run/transaction` without `await`. PostgreSQL drivers are async, so the migration is mechanical but touches every module:
1. Make the contract async (`await db.get(...)`), starting in `services/database/*`, then `modules/*.js`, `database/seed.js`, `container.js`, tests.
2. `transaction(fn)` becomes `async` and uses one client: `BEGIN` … `COMMIT/ROLLBACK`. Replace `BEGIN IMMEDIATE` race protection with `SELECT … FOR UPDATE` on the rows being changed (rack, inventory row, order) — this matters: SQLite serialises writers; Postgres does not.
3. Translate SQL: `?` → `$1…`; `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`; `strftime(...)` defaults → `now()` / `timestamptz`; `lastInsertRowid` → `RETURNING id`; `AUTOINCREMENT` → `GENERATED … AS IDENTITY`; `COLLATE NOCASE` → `citext`/lower index; `COALESCE(...)` and `CASE` are portable; `LIKE … ESCAPE` is portable; `PRAGMA` calls go away.
4. New migrations folder `database/migrations/pg/*.sql` (same tables, Postgres dialect); `migrate.js` chooses by provider.
5. Files: `services/database/index.js` (+ new `postgres.js`), all `modules/*.js`, `database/migrate.js`, `database/seed.js`, `scripts/gen-docs.mjs`, `tests/api.test.js`.

### 3.2 Storage → S3
New `services/storage/s3.js` (`@aws-sdk/client-s3`: `PutObject/GetObject/DeleteObject/HeadObject/ListObjectsV2`); `server.js` `/uploads/*` handler already goes through `ctx.storage.get`, so images keep working (or return a redirect to CloudFront and drop the proxy).

### 3.3 Auth → Cognito
New `services/auth/cognito.js`; frontend login can stay (the server calls `InitiateAuth` with USER_PASSWORD_AUTH) or switch to the hosted UI/Amplify. `modules/auth.js` user CRUD → Cognito Admin APIs. Session table becomes unnecessary.

### 3.4 Events / notifications / jobs / sync
New providers per §2. `container.js` needs no change except passing deps. For multi-instance SSE, add a subscriber in `server.js` that listens to the shared bus and writes to its own clients.

### 3.5 Frontend
Serve `frontend/`, `shared/`, `public/` from **S3 + CloudFront** (set `CORS_ORIGIN`, or put API and static behind one CloudFront distribution with path routing `/api/*` → ALB). `index.html` import map already supports a self-hosted Three.js (`npm run vendor:three`).

## 4. Environment variables (planned)
```
# selection
DB_PROVIDER=postgres  STORAGE_PROVIDER=s3  AUTH_PROVIDER=cognito  EVENTS_PROVIDER=sns  NOTIFICATIONS_PROVIDER=sns  JOBS_PROVIDER=sqs  SYNC_PROVIDER=lambda
AWS_REGION=eu-west-1
# RDS
DATABASE_URL=postgres://user:pass@host:5432/waretrack   # or DB_HOST/DB_PORT/DB_NAME/DB_USER + Secrets Manager ARN (DB_SECRET_ARN)
DB_POOL_MAX=10  DB_SSL=true
# S3
S3_BUCKET=waretrack-files-<env>  S3_PREFIX=  CLOUDFRONT_URL=https://dxxxx.cloudfront.net
# Cognito
COGNITO_USER_POOL_ID=eu-west-1_xxxxx  COGNITO_CLIENT_ID=xxxx  COGNITO_ISSUER=https://cognito-idp.eu-west-1.amazonaws.com/<pool>
# messaging
SNS_ALERT_TOPIC_ARN=arn:aws:sns:…  SQS_QUEUE_URL=https://sqs…  EVENT_BUS_NAME=waretrack
WS_ENDPOINT=https://xxxx.execute-api.eu-west-1.amazonaws.com/prod      # API Gateway WebSocket management endpoint
```
Credentials: use the **instance/task IAM role** — never put access keys in `.env`.
Minimum IAM (least privilege): `s3:GetObject/PutObject/DeleteObject/ListBucket` on the bucket; `sns:Publish` on the topic; `sqs:SendMessage/ReceiveMessage/DeleteMessage` on the queue; `secretsmanager:GetSecretValue` on the DB secret; `cognito-idp:AdminCreateUser/AdminUpdateUserAttributes/AdminDisableUser/…` if the app manages users; `logs:*` via the agent role.

## 5. Deploying the complete application
1. **Network**: VPC with 2 AZs; public subnets (ALB), private subnets (app, RDS); security groups: ALB 443 ← internet, app 3000 ← ALB, RDS 5432 ← app.
2. **Data**: RDS PostgreSQL (Multi-AZ for prod, automated backups, encryption), apply `migrations/pg`, run the seed only in non-prod.
3. **Files**: S3 bucket (private, versioned) + CloudFront (OAC).
4. **Compute**: EC2 (Node 22 + systemd/pm2) or ECS Fargate from a Dockerfile (`FROM node:22-slim`, `COPY . .`, `CMD ["node","backend/src/server.js"]`, `HOST=0.0.0.0`). Health check `GET /api/health`. SSE needs ALB idle timeout ≥ 60 s (heartbeat is 25 s).
5. **Config**: SSM Parameter Store/Secrets Manager → env vars; `NODE_ENV=production`; **disable/replace demo seed users** (`AUTO_SEED=false`).
6. **Edge**: ACM certificate, HTTPS only, CloudFront in front of static assets (and optionally the API), optional WAF rate rules.
7. **Observability**: CloudWatch log group, alarms (5xx, CPU, RDS connections, DLQ depth), dashboard.
8. **CI/CD**: GitHub Actions/CodePipeline: `npm test` → build image → push ECR → deploy; migrations run as a pre-deploy step.

## 6. Migrating existing local data
| Data | Procedure |
|---|---|
| Database | `pgloader sqlite:///database/data/waretrack.db postgresql://…` after creating the Postgres schema from `migrations/pg` (data-only load); or export each table to CSV and `COPY`. Verify row counts and `SELECT SUM(quantity) FROM inventory` equality; reset identity sequences to `MAX(id)+1`. |
| Files | `aws s3 sync database/data/files s3://$S3_BUCKET/ --exclude "snapshots/*"`; keys (`products/…`) stay the same, so `products.image_key` remains valid. |
| Users | scrypt hashes cannot be imported into Cognito → create users with `AdminCreateUser` (temporary passwords) mapped by e-mail and store the Cognito `sub`; keep `role` as a group. |
| In-flight jobs | Vehicles in `returning` are re-queued by `deliveries.recover()` on startup (or enqueue `vehicle.return` once after cutover). |

## 7. Verification checklist after integration
`npm test` against the Postgres provider (parameterise `tests/api.test.js` to use `DATABASE_URL`), concurrency test (two simultaneous orders for the last units must not oversell), SSE through ALB, image upload/download via S3, Cognito login for each role, CloudWatch alarm fire-drill.
