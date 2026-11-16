# API documentation

Base URL `http://localhost:3000/api` · JSON in/out · the full endpoint list with required permission and allowed roles is generated from the router in **`documentation/_generated/API_ENDPOINTS.md`** (81 endpoints).

## Authentication
```http
POST /api/auth/login   {"email":"admin@waretrack.local","password":"Admin@123"}
→ 200 {"token":"…","expiresAt":"…","user":{"id":1,"name":"Alex Chen","role":"admin",…}}
```
Send `Authorization: Bearer <token>` on every other call. `POST /api/auth/logout` revokes the token. The SSE stream accepts `?token=` because `EventSource` cannot set headers.

## Errors
```json
{ "error": { "status": 422, "message": "Validation failed", "details": { "sku": "is required" } } }
```
| Status | Meaning |
|---|---|
| 400 | Malformed JSON / unusable request (e.g. no change) |
| 401 | Missing/expired token, wrong credentials |
| 403 | Role lacks the permission |
| 404 | Unknown record or endpoint |
| 409 | Business rule conflict (insufficient stock, capacity exceeded, illegal status change, duplicate unique value, still referenced) — the message says exactly why |
| 413 / 415 | Body too large / wrong image type |
| 422 | Field validation failed; `details` maps field → message |
| 429 | Too many failed logins |

## Conventions
Lists: `{ "items": [...] }` (+ `total` for products/orders). Filters via query string (`/orders?status=Pending&q=acme`). Creation → `201`. Names are camelCase. Deleting records that have history **archives** them and returns `{ "deleted": true, "mode": "archived" }`.

## Examples
```bash
TOKEN=$(curl -s localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@waretrack.local","password":"Admin@123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
H="authorization: Bearer $TOKEN"

curl -s localhost:3000/api/products?status=low -H "$H"                      # low-stock products
curl -s localhost:3000/api/inventory/receive -H "$H" -H 'content-type: application/json' \
  -d '{"productId":3,"rackId":5,"quantity":50,"batchNo":"B-2611-01"}'        # book stock into a rack
curl -s localhost:3000/api/orders -H "$H" -H 'content-type: application/json' \
  -d '{"customerName":"ACME","city":"Boston","deliveryAddress":"1 Main St","items":[{"productId":3,"quantity":5}]}'
curl -s localhost:3000/api/orders/90/status -H "$H" -H 'content-type: application/json' -d '{"status":"Processing"}'
curl -s localhost:3000/api/deliveries -H "$H" -H 'content-type: application/json' -d '{"vehicleId":1,"orderIds":[90]}'
curl -s -X POST localhost:3000/api/deliveries/3/dispatch -H "$H"            # truck leaves; stock deducted once
curl -N "localhost:3000/api/events?token=$TOKEN"                            # live events
```

## Important workflows
| Goal | Calls |
|---|---|
| Ship an order | `POST /orders` → `POST /orders/:id/status` {Processing} → {Packed} → {Ready for Dispatch} → `POST /deliveries` (vehicle + orderIds) → `POST /deliveries/:id/dispatch` → `POST /orders/:id/status` {Delivered} (or `POST /deliveries/:id/complete`) |
| Receive goods | `POST /shipments` → `/shipments/:id/arrive` → `/shipments/:id/receive` (optional `lines:[{itemId,quantity,rackId}]`) |
| Move stock | `/inventory/transfer` · `/inventory/adjust` (recorded as ADJUST with reason) · `/inventory/issue` |
| Inspect history | `GET /stock-movements?productId=&type=` · `GET /activity` |
| 3D data | `GET /scene` (racks with pallets, docks, vehicles with deliveries, inbound shipments, workers with tasks, KPIs, sync status) |
| Analytics | `GET /dashboard` (KPIs, 14-day inbound/outbound/stock level, orders by status, section utilization, category stock, top products, low stock, recent activity) |

## Real-time events (SSE `GET /api/events`)
`hello` (on connect) · `changed` `{scopes:[…]}` after any mutation · `notification` `{notification}` · `sync` `{syncedAt}`.
