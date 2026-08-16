# Meme-Competition: AWS Deployment Plan

> Current working plan. Supersedes `aws-migration-plan.md`, which is retained for the reasoning
> behind decisions recorded here as settled.

## Context

Meme-Competition is a hobby-scale but production-minded app — Vue 3 SPA + Bun/Express/WS backend
+ MongoDB + S3. Today it assumes a single always-running Node process: in-memory `Map`s hold
WebSocket clients, a 50-message chat ring buffer, 3-second presence debounce timers, and
`setTimeout`-driven 8-second battle ticks rehydrated from Mongo on startup.

The goal is a production-grade AWS deployment in **ap-southeast-2** that scales to near-zero when
idle (≈$5–11/month), uses AWS-native services where sensible, follows commercial-grade IaC and
CI/CD practice, and keeps local development faithful to production. IaC is **AWS CDK v2 in
TypeScript**. CI/CD is **GitHub Actions with OIDC**, solo-main-branch CD.

**There is no deployed environment.** The database starts empty. There is no data migration, no
dual-write window, and no need for incrementally shippable stages. Delivery is a single pass; §14
orders the work by dependency.

Three decisions carry most of the weight:

1. **One CloudFront distribution** with path-based origins (`/` → S3 frontend, `/api/*` → HTTP API,
   `/ws` → WebSocket API, `/cdn/*` → memes bucket). Eliminates CORS, keeps the JWT cookie same-site,
   and gives one certificate and one DNS record to manage.
2. **Aurora Serverless v2 PostgreSQL reached over the RDS Data API, not TCP.** This keeps the
   Lambdas outside any VPC. Direct connections would force them in, costing $32–45/month in NAT or
   interface endpoints.
3. **Local development runs production code against different endpoints.** There is no local
   reimplementation of any component. Developers are assumed online with a valid SSO session.

---

## 1. AWS Service Map

| Concern | Service | Rationale |
|---|---|---|
| REST API | **API Gateway HTTP API v2** + Lambda | ~70% cheaper than REST v1 ($1/M vs $3.50/M), scale-to-zero |
| WebSocket API | **API Gateway WebSocket API** + Lambda | Only AWS-native serverless WS option |
| Frontend hosting | **S3 (private) + CloudFront + OAC** | Bucket stays private; CloudFront gives TLS + caching |
| Image CDN | Same CloudFront distribution, memes bucket at `/cdn/*` | One distribution = one certificate |
| Image uploads | **S3 presigned PUT** + async validation Lambda via EventBridge | Bypasses Lambda's 6MB sync payload limit |
| Application data | **Aurora Serverless v2 PostgreSQL**, min 0 ACU + auto-pause, **via RDS Data API** | Relational integrity; scale-to-zero; HTTPS access keeps Lambdas out of a VPC |
| Real-time state (WS connections, chat, idempotency) | **DynamoDB on-demand**, one table, TTL | $0 at idle, no VPC, native TTL |
| Battle ticks + presence debounce | **SQS delay queues** (`DelaySeconds`) | 1-second granularity, DLQ support, no schedule churn |
| Secrets | **Secrets Manager** (DB credential + `JWT_SECRET`); SSM Parameter Store for non-secrets | CloudFormation cannot create SSM `SecureString` — see §10 |
| Email (alarms only) | **SES** | Cheap, AWS-native |
| Monitoring | **CloudWatch + X-Ray** + AWS Lambda Powertools | Native, free tier, good learning value |
| DNS / TLS | **Deferred** — the default CloudFront domain works (§5) | Route 53 + ACM (us-east-1) added later if wanted |
| WAF / login rate limiting | **Skip both** — revisit if abused (§6.9) | WAF is ~$6/mo against a $5–11/mo budget |
| Auth provider | **Keep Argon2 + JWT** | Cognito doesn't fit the rest of the stack |

> API Gateway's built-in JWT authoriser accepts only OIDC/JWKS issuers. This app signs its own HS256
> tokens into an HttpOnly cookie, so authentication stays in Express middleware. Not a reason
> against HTTP API v2, but don't count it as a benefit.

---

## 2. Data Layer — Aurora Serverless v2

### 2.1 Cluster configuration

- Engine **Aurora PostgreSQL**, major version pinned. Scale-to-zero requires **≥ 16.3 / 15.7 /
  14.12 / 13.15** — confirm the highest major available in ap-southeast-2 satisfies this
  (`aws rds describe-db-engine-versions --engine aurora-postgresql --region ap-southeast-2`).
- **`serverlessV2MinCapacity: 0`**, max **1 ACU** (dev) / **2 ACU** (prod). Max capacity is a cost
  ceiling as much as a performance one.
- **`SecondsUntilAutoPause`: start at 900** (valid range 300–86400) and tune upward from
  `ServerlessDatabaseCapacity` data. Aurora holds its last capacity right up to the pause rather
  than tapering, so every session carries a full-capacity tail for the whole window.
- **`enableDataApi: true`.** Load-bearing, not optional.
- Storage encrypted at rest with the AWS-managed `aws/rds` key — **must be set at creation**.
- `deletionProtection: true` on prod. PITR at 7 days (dev) / 14 days (prod).
- Single writer, no reader. Nothing that blocks auto-pause: no RDS Proxy, no logical replication,
  no global database, no zero-ETL, no Babelfish.

**The cluster lives in a VPC; the Lambdas do not.** DataStack creates a VPC with *isolated* subnets
only — no NAT gateway, no internet gateway, no interface endpoints. A VPC with no egress components
is free. Lambdas reach the database over the Data API's public HTTPS endpoint, authorised by IAM.

### 2.2 Resume behaviour — the constraint that shapes the API

There are **two resume regimes**, and the second one is the normal case for this app:

| Regime | Trigger | Latency |
|---|---|---|
| Warm resume | Paused < 24 h | ~10–15 s |
| **Deep sleep** | **Paused > 24 h** | **30 s or longer — roughly a reboot** |

For an app idle most of the week, the first login after a quiet weekend hits deep sleep. That is
the ordinary path, not an edge case.

**Blocking through the resume is not an option**, because the user-visible ceiling is not the Lambda
timeout:

- API Gateway HTTP API caps integration timeout at **30 s** and it is not raisable.
- CloudFront's origin response timeout defaults to **30 s**.

Whichever fires first returns **504** to the browser while the Lambda runs on happily. Raising the
Lambda timeout achieves nothing.

**Required design:**

1. **Wake early.** The SPA fires `GET /api/health?db=1` on application load — while the user is
   still typing their password. That trivial query starts the resume.
2. **Fail fast, don't block.** The repository layer wraps Data API calls with a short client-side
   timeout (~5 s) and catches resume-related errors. Handlers return
   **`503 {code:'DB_RESUMING'}` with `Retry-After`**, never a hung request.
3. **Retry visibly.** The client retries with backoff behind a "waking up…" state, so a 40-second
   deep-sleep resume is a progress indicator rather than a failure.
4. **Raise CloudFront's origin response timeout** explicitly anyway, for the non-database paths.
5. **The CI smoke test must tolerate this** — `--max-time 45` does not help when CloudFront 504s at
   30 s. Point it at `/api/health` without `?db=1`, or retry on 503.

**Retry logic in the repository layer is unconditional**, not contingent on measurement. AWS
documents that a resuming instance receiving many connection requests may fail some of them.

### 2.3 Schema

```sql
CREATE TABLE users (
    id            text PRIMARY KEY,
    username      text        NOT NULL UNIQUE,
    email         text        NOT NULL UNIQUE,
    password_hash text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE competitions (
    id         text PRIMARY KEY,
    title      text        NOT NULL,
    -- NULL owner = open for claim (matches today's `owner: string | null`)
    owner_id   text        REFERENCES users (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE competition_members (
    competition_id text        NOT NULL REFERENCES competitions (id) ON DELETE CASCADE,
    user_id        text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    joined_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (competition_id, user_id)
);
CREATE INDEX competition_members_user_idx ON competition_members (user_id);

CREATE TABLE competition_files (
    id             text PRIMARY KEY,
    competition_id text        NOT NULL REFERENCES competitions (id) ON DELETE CASCADE,
    uploader_id    text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    name           text        NOT NULL,
    s3_key         text        NOT NULL,
    -- 'pending' from presign until validateMeme accepts the object (§4.6)
    status         text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'ready')),
    -- Final average, written once at battle completion. NULL until then.
    rating         numeric(3, 2),
    uploaded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX competition_files_competition_idx ON competition_files (competition_id);

-- One battle per competition, forever. A completed battle is terminal by design —
-- there is no rematch, now or planned. Do not "fix" this into a one-to-many.
CREATE TABLE battles (
    competition_id    text PRIMARY KEY REFERENCES competitions (id) ON DELETE CASCADE,
    status            text        NOT NULL CHECK (status IN ('active', 'complete')),
    current_index     int         NOT NULL DEFAULT 0,
    entry_started_at  timestamptz NOT NULL,
    entry_duration_ms int         NOT NULL DEFAULT 8000
);

-- Replaces a `shuffled_file_ids text[]` column: gives referential integrity, and
-- avoids Data API array marshalling, which is one of its rougher edges.
CREATE TABLE battle_entries (
    competition_id text NOT NULL REFERENCES battles (competition_id) ON DELETE CASCADE,
    position       int  NOT NULL,
    -- RESTRICT is the guard: a file in a battle cannot be deleted (§2.4)
    file_id        text NOT NULL REFERENCES competition_files (id) ON DELETE RESTRICT,
    PRIMARY KEY (competition_id, position)
);

CREATE TABLE votes (
    competition_id text        NOT NULL REFERENCES competitions (id) ON DELETE CASCADE,
    file_id        text        NOT NULL REFERENCES competition_files (id) ON DELETE CASCADE,
    user_id        text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    rating         smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (competition_id, file_id, user_id)
);
```

**User deletion is unsupported.** All `users` references are `ON DELETE RESTRICT` so the rules are
at least consistent; there is no delete-user feature and adding one is a separate design exercise.

There is no `battle` column on `competitions`. "Uploads allowed" is
`NOT EXISTS (SELECT 1 FROM battles WHERE competition_id = $1)`.

### 2.4 Constraints that must survive the rewrite

**Votes are mutable.** Users change votes; the client restores `myVote` on refresh because of it.

```sql
INSERT INTO votes (competition_id, file_id, user_id, rating)
VALUES ($1, $2, $3, $4)
ON CONFLICT (competition_id, file_id, user_id)
DO UPDATE SET rating = EXCLUDED.rating, updated_at = now();
```

Averages are computed on read — no running totals, no delta arithmetic, no drift:

```sql
SELECT file_id, AVG(rating)::numeric(3,2) AS avg_rating
FROM votes WHERE competition_id = $1 GROUP BY file_id;
```

**Username and email are both unique.** Two `UNIQUE` constraints. Note that **login is by username,
not email**.

**Three operations share the "battle has not started" guard**, not just uploads — it is easy to lose
one in the rewrite:

| Operation | Guard |
|---|---|
| Add entry | `NOT EXISTS (SELECT 1 FROM battles …)` **and** per-user count < 3 |
| `relinquishOwnership` | `NOT EXISTS (SELECT 1 FROM battles …)` **and** caller is owner |
| `claimOwnership` | `NOT EXISTS (SELECT 1 FROM battles …)` **and** owner IS NULL **and** caller is a member |

**Per-user entry limit (3)** is enforced once, at presign, inside one transaction:

```sql
BEGIN;
  SELECT 1 FROM competitions WHERE id = $1 FOR UPDATE;   -- serialise this competition
  SELECT
    (SELECT count(*) FROM competition_files
      WHERE competition_id = $1 AND uploader_id = $2)          AS user_file_count,
    EXISTS (SELECT 1 FROM battles WHERE competition_id = $1)   AS battle_started;
  -- app raises ValidationError on either guard, else:
  INSERT INTO competition_files (…, status) VALUES (…, 'pending');
COMMIT;
```

Pending rows count toward the limit. That is deliberate: it prevents presign spam, and abandoned
uploads self-limit rather than becoming a hole.

**Deleting an entry that is in a battle** is prevented by `battle_entries.file_id ON DELETE
RESTRICT` — the database enforces it, so the guard cannot be forgotten in a service method.

Via the Data API, transactions are `BeginTransaction` → `ExecuteStatement`(×n with `transactionId`)
→ `CommitTransaction`. Wrap that in a helper once.

---

## 3. Real-time State

### 3.1 DynamoDB `meme-state`

One on-demand table, TTL attribute `expiresAt`, no Streams.

| Entity | PK | SK | Notes |
|---|---|---|---|
| Connection (by id) | `CONN#<connId>` | `META` | userId, username, competitionId, lastChatAt; TTL 24 h backstop |
| Connection (by competition) | `COMP#<compId>` | `CONN#<connId>` | Fanout query, `begins_with(SK,'CONN#')`; TTL 24 h |
| Chat message | `CHAT#<compId>` | `<ulid>` | TTL 1 h |
| Refresh marker | `RECONN#<compId>#<userId>` | `META` | Written on `$disconnect`, TTL ~10 s (§3.3) |
| Idempotency (Powertools) | Powertools-managed | — | Needs its own TTL attribute and explicit key-attribute config against this PK/SK schema |

Presence is derived from connection rows. There is no `PRES#` entity.

### 3.2 Battle ticks — SQS delay queue, with self-heal

When a round starts or advances, enqueue `{ competitionId, expectedIndex }` with `DelaySeconds: 8`.
`advanceBattle`:

1. `UPDATE battles SET current_index = current_index + 1, entry_started_at = now()
   WHERE competition_id = $1 AND current_index = $2 AND status = 'active'`
2. **One row updated** → if past the last `battle_entries.position`, write final averages into
   `competition_files.rating`, set `status='complete'`, broadcast `BATTLE_COMPLETE`. Otherwise
   broadcast `ENTRY_ADVANCE` and enqueue the next tick.
3. **Zero rows updated** → **do not simply return.** Re-read the battle:
   - Not found, or `status='complete'` → genuinely stale, drop.
   - `status='active'` **and** `entry_started_at + entry_duration_ms` is well in the past (say
     > 2× the duration) → **the chain is broken; re-enqueue for the current index.**

Step 3 is not optional. If the Lambda dies after the `UPDATE` commits but before the enqueue — a
throttle, a timeout, a Data API blip — the redelivered message fails the `current_index` guard and,
without the self-heal, **the battle stalls permanently with no recovery path.** Today
`battleManager.rehydrate()` re-arms timers on restart; this plan deletes it and must replace it.

**Do not put Powertools `@idempotent` on `advanceBattle`.** The conditional `UPDATE` *is* the
idempotency mechanism. A result cache on top adds nothing and actively defeats the self-heal by
returning a cached response without re-reading.

`SUBSCRIBE` performs the same stall check — cheap, and it makes recovery invisible to users.

### 3.3 Presence — `$disconnect` plus a 3-second debounce

Today's behaviour, which must be preserved: `USER_JOINED` broadcasts on genuine arrival, and is
suppressed both for a second tab and for a page refresh (via a 3-second leave debounce).

- **`$disconnect`**: delete both connection rows; write `RECONN#<compId>#<userId>` with a ~10 s TTL;
  enqueue `{ competitionId, userId, username }` to `presence-leave` with `DelaySeconds: 3`.
- **`presenceLeave`**: re-query `COMP#<compId>` for any remaining connection with that `userId`. If
  one exists, the user reconnected or has another tab — drop the message. Otherwise broadcast
  `USER_LEFT`.
- **`SUBSCRIBE`**: conditionally `DeleteItem` the `RECONN#` marker.
  - Marker existed → this is a refresh. **Suppress `USER_JOINED`.**
  - Another connection already exists for this user → second tab. **Suppress.**
  - Otherwise → genuine arrival. **Broadcast `USER_JOINED`.**

Without the marker, a refresh produces "X has entered the battle" with no matching "left" — the
leave is correctly dropped, but the join is not.

### 3.4 Idle SQS polling cost

A Lambda event source mapping long-polls even when empty — roughly 650k `ReceiveMessage`
requests/month per queue. Two queues ≈ 1.3M/mo, just over the free tier, so budget ~$0.30–0.50/mo.
Merging both into one `meme-timers` queue with a type discriminator halves it.

---

## 4. Backend

### 4.1 Runtime and Express adapter

- **AWS Lambda Web Adapter (LWA)** as a layer, **Node 22.x**, ARM64. The Express app runs unmodified.
- **LWA runs your real HTTP server** — `server.ts` keeps calling `.listen()`. Set `AWS_LWA_PORT` and
  `AWS_LWA_READINESS_CHECK_PATH=/api/health`.
- `server.ts` loses `connectDb`, `createIndexes`, and `battleManager.rehydrate()`.
- **`@node-rs/argon2` is a native module**; bundle with
  `bundling: { nodeModules: ['@node-rs/argon2'], forceDockerBundling: true }`.
- **Memory: 1024 MB** for the HTTP Lambda. Argon2 is memory-hard and single-threaded; at 128 MB a
  login takes seconds.
- **Timeout: 30 s**, matching API Gateway's ceiling — but see §2.2: the answer to resume is a fast
  503, not a long timeout.

### 4.2 WebSocket API

Set **`routeSelectionExpression: '$request.body.type'`**, matching the client's existing
`{ type: 'SUBSCRIBE' | 'VOTE' | 'CHAT' }` protocol.

| Route | Handler | Responsibility |
|---|---|---|
| `$connect` | `wsConnect` | **Check `Origin` against an allowlist**; verify the JWT cookie; write `CONN#<id>/META` |
| `$disconnect` | `wsDisconnect` | Delete connection rows; write `RECONN#`; enqueue presence-leave. Idempotent |
| `SUBSCRIBE` | `wsSubscribe` | Membership check; write `COMP#/CONN#`; run the §3.2 stall check; send `PRESENCE_STATE`, chat history, `BATTLE_STATE`; broadcast `USER_JOINED` unless suppressed (§3.3) |
| `VOTE` | `wsVote` | Validate, upsert, reply `VOTE_ACK` / `VOTE_REJECTED` |
| `CHAT` | `wsChat` | Rate-limit, append, fan out |
| `$default` | `wsDefault` | `ping` → `pong`; anything else → `ERROR` |

**`BATTLE_STATE` must include `myVote`** — the client depends on it to restore the star state after
a refresh mid-entry.

**Chat history is read newest-first** (`Limit=50, ScanIndexForward=false`) and **must be reversed**
before sending, or history renders backwards.

**Per-connection state** (`competitionId`, `lastChatAt`) moves onto `CONN#<id>/META`, re-read per
message. The chat rate limit becomes a conditional update on that row.

**Fanout**: query `COMP#<compId>`, then `postToConnection` per connection. A `410 GoneException`
means the connection is dead — delete both rows. Idempotent on both paths.

### 4.3 Keepalive and reconnection

API Gateway closes WebSocket connections after **10 minutes of inactivity**. Battle ticks are a
natural keepalive; a quiet lobby is not. Send `{ type: 'ping' }` every 5 minutes when no server
message has arrived recently.

**`useBattleSocket.ts` has no reconnection logic**, which is the most likely production bug in this
plan. Against `localhost` a socket never drops; in production they drop routinely — idle timeout,
network blip, every deploy. Today the user is silently disconnected mid-battle with no recovery.

A ping without a reconnect path makes this **worse**, keeping a half-open socket looking healthy.
Required:

1. **Pong deadline** — expect `pong` within ~10 s; on timeout, close and treat as dead.
2. **Reconnect with exponential backoff and jitter** — ~1 s initial, capped ~30 s, stop on unmount.
3. **Re-`SUBSCRIBE` on reopen.** State recovery is then automatic.
4. **Surface it in the UI** — a "reconnecting…" indicator during a battle.

### 4.4 Seams — one implementation each

| Seam | Implementation | How local differs |
|---|---|---|
| `ConnectionRegistry` | DynamoDB | `DDB_ENDPOINT` → DynamoDB Local |
| `ChatStore` | DynamoDB | Same |
| `TimerScheduler` | SQS | Per-developer queue URL |
| `WsTransport` | `ApiGatewayManagementApiClient` | `WS_CALLBACK_URL` → local `@connections` shim |

**There is no local implementation of anything.** The seams exist for encapsulation and
testability, not polymorphism. Differences belong in configuration — endpoint, table name, queue
URL — never in a second implementation.

**The local `@connections` shim**: `ApiGatewayManagementApiClient` accepts an `endpoint`, and
`postToConnection` is `POST /@connections/{connectionId}` (`deleteConnection` is `DELETE`). A ~50-line
local HTTP server implementing those two routes, forwarding to in-process `ws` sockets, lets the
**real, unmodified** `ApiGwWsTransport` run locally. It must **return `410 Gone` for closed sockets**
so the production cleanup path is exercised, and should add send jitter and fanout reordering —
ordering is the one property a single-process server preserves for free and API Gateway does not.

**`battleWs.ts` is an event-shape adapter**: it builds real `APIGatewayProxyWebsocketEventV2`
objects and invokes the **actual handler exports**, rather than being a parallel dispatch path. It
also applies the same `Origin` allowlist as `$connect`, so that check is exercised locally.

### 4.5 Repository layer

- **Drizzle** — `drizzle-orm/node-postgres` and `drizzle-orm/aws-data-api/pg`. Same schema, same
  migrations, driver by `DB_DRIVER=pg|data-api`. Confirm the Data API driver's current state before
  committing; check `numeric`, `timestamptz`, and NULL marshalling specifically.
- **Parameterised queries only.** ESLint rule banning template-literal SQL.
- **Resume-aware retry** wrapping every Data API call (§2.2), surfacing `DbResumingError` that the
  Express error handler maps to `503 {code:'DB_RESUMING'}`.
- **Every migration has a down path**, and `db:rollback` is a first-class script.
- No `LISTEN`/`NOTIFY` — fanout goes through `postToConnection`.

### 4.6 Uploads

**Presign writes a pending row.** This is what makes the rest coherent: it puts `name`,
`uploader_id`, and `competition_id` in the database rather than in user-controlled S3 metadata,
enforces the entry limit exactly once (§2.4), and gives the validation Lambda an idempotency key
that needs no bucket versioning.

1. **`POST /api/uploads/sign`** — the §2.4 transaction inserts `competition_files` with
   `status='pending'` and returns `{ fileId, url }`. The object key is
   `pending/<competitionId>/<fileId>` — derived, never client-supplied.
2. **Browser `PUT`s directly to S3.** 5-minute expiry, `ChecksumSHA256`, content-length constraint.
3. **S3 → EventBridge → `validateMeme`**, idempotency keyed on the **S3 object key** (unique per
   upload — no dependency on object versioning being enabled).
4. **Accept**: magic-byte check passes → `CopyObject` to `memes/<competitionId>/<fileId>` with
   `Content-Type` from the *validated* bytes, delete the pending object, `UPDATE status='ready'`,
   push **`UPLOAD_READY`** over WS.
5. **Reject**: delete the object, delete the row, push **`UPLOAD_REJECTED { fileId, reason }`**.

**The rejection path is not optional.** Today the client awaits the POST and renders the server's
message into `uploadError`. Moving validation off the request path deletes that contract unless it
is replaced. `CompetitionDetail.vue` needs a state machine — `uploading → validating →
ready | rejected` — and a **polling fallback** (`GET /:id/files`) for when the socket is not open.

**Accepted formats: JPEG, PNG, GIF, WebP, BMP.** SVG is removed (§6.7). The three format lists are
currently inconsistent — `isImage()` lists `avif` (never uploadable) and omits `bmp` (server-side
allowed). Reconcile all three to one source of truth.

**S3 deletion must be preserved.** `ON DELETE CASCADE` cleans rows, not objects:

- Delete competition → delete objects under **both** `pending/<id>/` and `memes/<id>/`.
- Delete a user's file → delete the served object, and the pending object if `status='pending'`.

Bucket policy caps signed uploads at **1 MB**, matching the existing UI message. Memes are served
via CloudFront `/cdn/<key>`; the bucket stays private behind OAC, so `getFileUrl` returns the
`/cdn/` path.

---

## 5. Frontend and CloudFront

> **No custom domain is required.** A CloudFront distribution ships with a working
> `https://d….cloudfront.net` name and an AWS certificate. Because everything routes through one
> distribution, the same-origin cookie story and all four path behaviours work identically on the
> default name. Route 53 and ACM are deferred (§14 block J). Note ACM must be in **us-east-1** when
> a domain is eventually added, even though everything else is ap-southeast-2.

### 5.1 Origin path mapping — get this right first

An API Gateway WebSocket API is reachable **only** at
`wss://{id}.execute-api.{region}.amazonaws.com/{stage}`. Any extra path segment returns 403.
CloudFront's origin path *prepends*, so a `/ws` behaviour with origin path `/prod` sends `/prod/ws`
→ 403. Most published guidance reaches for Lambda@Edge to rewrite it.

**The clean way out, with no rewrite anywhere:**

- **Name the WebSocket stage `ws`** and leave the origin path empty. CloudFront forwards `/ws`;
  API Gateway receives exactly its stage URL.
- **Use the `$default` stage on the HTTP API** so there is no stage prefix and `/api/*` passes
  through untouched.

This is proven in block 0 (§14), not discovered at item 31.

### 5.2 Distribution

- **Default `/`** → S3 frontend bucket (OAC)
- **`/api/*`** → HTTP API origin, caching disabled, `AllViewerExceptHostHeader`
- **`/ws`** → WebSocket API origin, caching disabled. Origin request policy must forward `Cookie`
  **and** `Sec-WebSocket-Key`, `Sec-WebSocket-Version`, `Sec-WebSocket-Protocol`,
  `Sec-WebSocket-Extensions`. Missing one is a silent handshake failure.
- **`/cdn/*`** → S3 memes bucket (OAC)
- **SPA fallback**: a CloudFront Function on viewer-request rewriting extension-less paths to
  `/index.html`, **attached to the default behaviour only** — attached globally it would swallow
  `/ws` and `/api/health`. It is pure JS: unit test it.
- **Cache policies**: `/assets/*` → `CachingOptimized` (1 yr immutable); `/index.html` →
  `CachingDisabled`.
- **Origin response timeout** raised explicitly (§2.2).

### 5.3 Response headers policy

Cheap and currently absent. On the default behaviour: HSTS, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`, and a starter CSP.
**`nosniff` matters most on `/cdn/*`** — polyglot images are the residual risk once SVG is gone.

### 5.4 Same-origin everywhere, including locally

Vite proxies `/api` and `/ws` to `localhost:3000`, making **local same-origin too**. This is about
ten lines and buys more parity than anything else in the plan:

- `VITE_API_BASE=/api` is identical in both environments.
- **`VITE_WS_URL` disappears** — the client derives
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`.
- **The `cors` package is deleted entirely**, rather than surviving as production-dead code.
- Cookie, `SameSite`, and `Origin`-check behaviour are exercised locally exactly as shipped.

`app/src/api/client.ts` currently hardcodes `http://localhost:3000/api`; the env var has to be
introduced.

### 5.5 Deploy ordering

Sync hashed `/assets/*` **first**, then `index.html`, then invalidate. The reverse order leaves a
window where users get an `index.html` referencing assets that have not uploaded — a classic
self-inflicted outage.

---

## 6. Security

### 6.1 Network and credentials

- Aurora in isolated subnets, `publiclyAccessible: false`. **Never enable public accessibility for
  local convenience** — the Data API is the supported path.
- Lambdas outside the VPC; Data API authorised by IAM.
- **DB credential and `JWT_SECRET` both live in Secrets Manager** (§10). Lambda roles get
  `rds-data:*` on the cluster ARN and `secretsmanager:GetSecretValue` on those secrets only.
- **One Postgres role for all Lambdas.** Per-function `GRANT`s would restore the per-Lambda scoping
  DynamoDB gave for free. Not worth it at this scale — but record it as knowingly dropped.

### 6.2 `JWT_SECRET` must not have a fallback

`server/src/utils/jwt.ts:5` reads:

```typescript
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
```

That fallback string is in this repository's public history. If the real value is ever missing —
a failed Secrets Manager fetch, a misconfigured stage, a forgotten step — production silently signs
tokens with a publicly known key. Full auth bypass, no error, no alarm.

**Throw at module load unless `STAGE === 'local'`.** Fail to start rather than start insecure.

### 6.3 Cookies

- `HttpOnly; Secure; SameSite=Strict; Path=/`.
- **`Secure` must default on.** `secure: process.env.NODE_ENV === "production"` evaluates **false**
  in Lambda, which does not set `NODE_ENV`. Invert it:
  ```typescript
  secure: process.env.NODE_ENV !== "development",
  ```
  Prefer `STAGE` over `NODE_ENV` for any new branching — the same fail-open pattern appears at
  `s3-client.ts:27`, so audit for the *pattern*, not the two known instances.
- **`clearCookie` must carry matching attributes.** `res.clearCookie("jwt")` with no options will
  not clear a `Secure; SameSite=Strict; Path=/` cookie — logout ships as "the button does nothing",
  discoverable only in production. Same file, same edit.
- **`SameSite=Strict` is viable here**, and is the recorded CSRF position. There is no
  server-rendered route that depends on the cookie: a cold invite-link click fetches static
  `index.html` (no auth needed), and the subsequent XHR from that document is same-site and carries
  the cookie normally. All mutations are POST/DELETE, so `Strict` plus same-origin is the whole
  defence, deliberately — no CSRF tokens.

### 6.4 WebSocket `Origin` allowlist

`battleWs.ts` accepts any origin today, and `$connect` as specified only verifies the cookie.
Cross-site WebSocket hijacking does not require reading the token — only riding it. A hostile page
could open a socket, `SUBSCRIBE`, vote and chat as the victim.

Modern browsers do apply `SameSite` to WS handshakes, so this is defence in depth rather than an
open hole — but an `Origin` allowlist is the standard, cheap, explicit mitigation and should not be
skipped on the strength of cookie policy alone. Apply it in `$connect` **and** in the local `ws`
server so tier 1 exercises it.

### 6.5 Passwords

Minimum length **8** (currently 4), enforced in `validatePassword` with the message updated and
mirrored in `Login.vue`. Deliberately a length rule only — no composition requirements, no breach
lists.

### 6.6 No floating promises

Lambda freezes the execution environment the instant a handler resolves. An un-awaited
`postToConnection` delivers every time locally and **silently vanishes in production**, resuming
mid-flight on the next invocation. Invisible to local testing by construction, so it must be caught
statically: `@typescript-eslint/no-floating-promises` with type-aware linting.

### 6.7 SVG removed

`image/svg+xml` leaves `ALLOWED_IMAGE_MIME_TYPES` and the `<svg` branch leaves `validateImageFile`.
Under one distribution, `/cdn/*` is same-origin with the app, so an uploaded SVG containing inline
script would execute with full access to `/api/*` carrying the victim's cookie. Removing it also
makes the validator purely magic-byte based.

Reinstating it would need a real XML sanitiser **and** a sandbox CSP on `/cdn/*` — not one or the
other. Also remove `svg` from `isImage()` in `CompetitionDetail.vue:509`.

### 6.8 Data retention

`RemovalPolicy.RETAIN` on the **prod** memes bucket and DynamoDB table, plus `deletionProtection` on
Aurora. A stack replacement or a mistaken `cdk destroy` otherwise deletes every uploaded meme.
Dev gets `RemovalPolicy.DESTROY` — you will destroy and recreate dev repeatedly and should not have
to fight your own guardrails.

### 6.9 WAF and login rate limiting — both deliberately out of scope

Neither is built. Recorded so the reasoning survives:

- **API Gateway stage throttling is not a substitute.** It is per-stage/per-route, not per-IP: it
  stops volumetric floods and does nothing against a slow grind on one account. §12.1 is a cost
  control, not an authentication defence.
- **`express-rate-limit` with its memory store would not work.** Each concurrent Lambda has its own
  memory and containers recycle.
- **If abuse materialises**, either AWS WAF rate-based rules on the distribution (~$6/mo — a large
  fraction of the §13 budget) or application-level throttling backed by `meme-state` (atomic `ADD`
  on `RATE#IP#…` / `RATE#USER#…` with TTL). If the latter: limit **both** dimensions, count
  **failures only**, and **throttle rather than lock accounts** — lockout lets anyone deny service
  to any user. A trustworthy client IP behind CloudFront requires forwarding
  `CloudFront-Viewer-Address`; raw `X-Forwarded-For` is spoofable.
- The same mechanism would cover registration spam.

### 6.10 Idempotency

Powertools `@idempotent` on `validateMeme` (keyed on the S3 object key) and `$disconnect` cleanup.
**Not** on `advanceBattle` — see §3.2.

---

## 7. Accounts and IaC

### 7.1 Organisation

```
Management account  (existing — billing only, no workloads)
├── meme-dev
└── meme-prod
```

One dev account is enough. Per-developer accounts are a legitimate pattern but multiply Aurora
clusters, secrets, bootstraps, permission sets, budgets and SES verifications — and would not solve
the queue-collision problem that usually motivates them (§8.3). Revisit if a second developer
appears.

**One-time setup, in order:**

0. **Secure the management account root user** — MFA, no access keys, password manager entry.
   Everything below inherits from it; this is the one AWS failure with no recovery path.
1. Enable **AWS Organizations**. Free.
2. Create `meme-dev` and `meme-prod` with their own root emails. Enable **Consolidated Billing**.
3. **Deal with the member accounts' root users.** Organizations creates each with a root user and no
   password — an unsecured credential behind an email inbox. Preferred: **centralised root access
   management**, which removes root credentials from member accounts entirely. Otherwise: recover
   each password, enable MFA, confirm no access keys, never use root again.
4. Enable **IAM Identity Center** in the management account.
5. **`cdk bootstrap`** each member account.
6. **Deploy `infra/bootstrap/`** (§11.1) to each account — one local `cdk deploy` from an SSO admin
   session.
7. **Verify the alarm recipient address in SES**, in each account. New accounts are in **sandbox
   mode** and can only send to verified addresses; the alarm pipeline deploys cleanly and then
   silently delivers nothing.
8. Set an **AWS Budget** per account (§12) — deployed by `ObservabilityStack`.

> **Free tier is shared across the Organization**, not granted per member account, and newer
> accounts fall under a credit-based plan. Do not budget on `meme-dev` and `meme-prod` each having
> their own.

**SCPs** are optional: a region-deny for both member accounts is a useful starter, carving out
`acm`, `cloudfront`, and `route53` if a custom domain is added.

**Tagging** — `Tags.of(app).add('Project', …)` / `('Environment', props.stage)`, with tag cost
allocation enabled once in Billing.

### 7.2 Stacks

**`infra/bootstrap/` — a separate CDK app, deployed only from a laptop:**

- **GitHubOidcStack** — OIDC provider + GitHub Actions deploy role

> **This separation is a security boundary.** If CI could deploy the stack defining CI's own IAM
> role, a merged PR could widen its own trust policy or grant itself `AdministratorAccess`. A
> distinct app means `cdk deploy --all` cannot see it.

**`infra/` — deployed by CI:**

- **DataStack** — isolated VPC, Aurora + Data API + Secrets Manager, DynamoDB, SQS + DLQs, S3
  buckets, SSM parameters
- **AppStack** — HTTP API (`$default` stage), WebSocket API (stage named `ws`), Lambdas, CloudFront,
  response headers policy
- **ObservabilityStack** — alarms, SNS, dashboard, log retention, Budget, kill switch, Cost Anomaly
  Detection
- **CertStack** (deferred, us-east-1) — only when a custom domain is added

Key constructs: `aws-rds.DatabaseCluster` with `ClusterInstance.serverlessV2`,
`aws-apigatewayv2.HttpApi` / `WebSocketApi`, `aws-lambda-nodejs.NodejsFunction` (esbuild, ARM64,
Node 22), `aws-dynamodb.TableV2`, `aws-sqs.Queue` + `SqsEventSource`,
`aws-cloudfront.Distribution` with `S3BucketOrigin.withOriginAccessControl()`,
`aws-iam.OpenIdConnectProvider`. **Verify the auto-pause property name against the `aws-cdk-lib`
version you pin.**

---

## 8. Local Development

**Developers are assumed online with a valid SSO session.** That assumption is what lets local
development run production code paths rather than approximations.

### 8.1 Tier 1 — the fast loop

| Component | Local | Notes |
|---|---|---|
| Frontend | `vite` on `:3001`, HMR, **proxying `/api` and `/ws`** | Same-origin, as production (§5.4) |
| Backend HTTP | `bun --hot server.ts` on `:3000` | Same Express app LWA wraps |
| **Database** | **dev Aurora via `DB_DRIVER=data-api`** | The production code path, exercised continuously |
| DynamoDB | Docker `amazon/dynamodb-local`, `DDB_ENDPOINT` | Real DynamoDB wire protocol, first-party |
| SQS | **Real per-developer queues** (`meme-battle-ticks-<dev>`, `meme-presence-leave-<dev>`) + local poller | Real `DelaySeconds` and at-least-once |
| WS transport | Local `@connections` shim on `:3002`, `WS_CALLBACK_URL` | Real `ApiGwWsTransport`, unmodified |
| WS entry | `ws` server building `APIGatewayProxyWebsocketEventV2`, invoking real handlers | Event-shape adapter |
| Uploads | Presign into `pending/local/<dev>/…`; client callback invokes `validateMeme` in-process | Shares the handler with production |

**Why the dev server uses Aurora, not Docker Postgres.** The three local stand-ins are not
equivalent:

| Stand-in | What it emulates | Residual divergence |
|---|---|---|
| DynamoDB Local | Real DynamoDB wire protocol, first-party | ≈ 0, except IAM |
| Real SQS | Nothing — it *is* the service | 0 |
| Docker Postgres + `pg` | Right engine, **wrong protocol** | The entire Data API layer |

Docker Postgres was chosen when RDS was assumed to be VPC-private and unreachable from a laptop.
The Data API removed that constraint and the decision was not revisited. Using it for the dev server
swaps out precisely the layer with the known rough edges — marshalling, `numeric`-as-string,
transaction ceremony, resume behaviour. Pointing the dev server at dev Aurora also means **you feel
cold resume while developing**, which matters now that §2.2 makes it a designed UX concern.

Costs, honestly: ~10–30 ms per query to Sydney (a page load doing eight queries gains ~150 ms), a
resume at session start, and no offline work. **`DB_DRIVER=pg` against a Docker Postgres remains a
documented escape hatch** for offline or fast iteration — it costs nothing, since that driver exists
for the tests regardless.

**Per-developer SQS queues are required**, not a nicety. The deployed dev stack has its own event
source mapping on the shared queue, so a locally-produced tick would frequently be consumed by the
deployed Lambda — which would then act against dev Aurora with no local `ws` connection to broadcast
to. Separate queues with **no event source mapping** avoid this entirely. Create them with a
documented `aws sqs create-queue` one-liner in the README.

**Docker services**: `amazon/dynamodb-local`, plus a version-pinned `postgres` used by the test
suite and the offline escape hatch. Add a `db:seed` script — otherwise everyone rebuilds the same
fixture by hand after each `docker compose down -v`.

### 8.2 Tier 2 — `cdk watch` against the dev account

`cdk watch meme-app-dev` deploys diffs in ~10 s; point Vite at the deployed stack to keep frontend
HMR while the backend is real.

**Not optional.** Zero drift is unattainable — Lambda's execution model has no laptop equivalent.
This is the enumeration of what tier 1 cannot reach:

| Gap | Why | Mitigation |
|---|---|---|
| **Concurrency** | One event loop locally vs N Lambdas | Largely testable — see §8.3 |
| **IAM correctness** | DynamoDB Local accepts any credentials | CDK template assertions (§8.3) |
| **Freeze/thaw, 6 MB payload, module-scope caching** | Lambda runtime semantics | `no-floating-promises`; optionally RIE |
| **API Gateway WS behaviours** — idle timeout, route selection, `$connect` header shape, 128 KB frames | Managed platform | Tier 2 only (`410 Gone` *is* covered by the shim) |
| **CloudFront routing, SPA fallback, cache headers, `/ws` cookie forwarding** | No CloudFront locally | Unit-test the CloudFront Function; rest is tier 2 |
| **Deep-sleep resume** | Requires >24 h idle | Tier 2, deliberately |
| **`bun --hot` clears module scope; a warm Lambda holds it for minutes** | Runtime lifetime | Awareness |

**Optional third tier**: the Lambda Runtime Interface Emulator, worth standing up for the auth path
specifically, where a broken `Set-Cookie` means nobody can log in.

### 8.3 Test tiers

- **Unit and service tests** — against **Docker Postgres with `DB_DRIVER=pg`**. Fast, isolated,
  destructive setup/teardown, no credentials needed in CI. This is what keeps Docker Postgres in the
  stack.
- **Contract tests** — the repository layer against **both** drivers; `ConnectionRegistry` /
  `ChatStore` against DynamoDB Local **and** real DynamoDB.
- **Concurrency tests** — fire N parallel calls **at the seams and handlers directly**, not through
  the HTTP server (the single-process server is what prevents concurrency, not the datastores).
  Minimum coverage: N concurrent `wsChat` for one connection → exactly one passes the rate limit;
  N concurrent uploads by one user → the 3-entry limit holds; N concurrent `advanceBattle` at the
  same index → exactly one advances; concurrent `$disconnect` + `SUBSCRIBE` → correct presence.
- **CDK template assertions** — `aws-cdk-lib/assertions` over each Lambda role: `wsConnect` has no
  write access to application tables, `advanceBattle`'s `execute-api:ManageConnections` is scoped to
  the WS API ARN, no wildcard resources. The only cheap counter to DynamoDB Local's IAM blindness.

**When a bug is found in any configuration, add a test at the appropriate tier before fixing it.**

### 8.4 Bun and Node

Local runs **Bun**; Lambda runs **Node 22**. Bun and Node differ in Express edge cases, streams and
`Buffer`, `crypto`, and native module loading — `@node-rs/argon2` above all, the one dependency
already flagged as fragile.

**CI runs the full test suite on Node 22** in addition to Bun, so tested code executes on the
production runtime. Bun stays for the local dev server and package management. The divergence is
accepted and documented rather than implicit.

### 8.5 Developer README

Add a `README.md` at the repo root. **Keep it short** — a runbook, not documentation. Anything
needing explanation belongs in this plan, linked.

1. **Prerequisites** — Bun, Docker, AWS CLI v2, `gh` CLI
2. **Local setup** — clone, `bun install`, `docker compose up -d`, `aws sso login`,
   `bun run db:migrate`, `bun run db:seed`, `bun run dev`. Include URLs and the seeded login
3. **One-time AWS setup** (§7.1) — all eight steps, each labelled console-only or scripted
4. **Per-developer setup** — `aws configure sso`, the two profiles, the daily `aws sso login`,
   creating your personal SQS queues
5. **Deploying to dev** — `cdk deploy --all --profile meme-dev`, and `cdk watch`
6. **Deploying to production** — CI does it on merge to `main`; the break-glass command and when
   it applies
7. **Adding a custom domain** (deferred, §5)
8. **Troubleshooting** — Aurora cold resume, expired SSO token, Docker not running, `db:migrate`
   against the wrong `DB_DRIVER`

Label every step one-time-per-organisation, one-time-per-account, one-time-per-developer, or
routine.

### 8.6 Dev-account cost

~$3–5/mo — Aurora storage plus the ACU-hours from daily development, the Secrets Manager secrets,
and negligible SQS and S3.

---

## 9. Observability

- **Logging**: `pino` JSON to stdout; CloudWatch Logs Insights for queries.
- **Powertools** on every Lambda — `Logger`, `Tracer` (X-Ray), `Metrics` (EMF).
- **DLQs** on every async-invoked Lambda, 14-day retention.
- **Alarms** → SNS → SES (recipient verified first, §7.1 step 7):
  - Any Lambda `Errors > 0` over 5 min
  - Any DLQ `ApproximateNumberOfMessagesVisible > 0`
  - HTTP API `5xx > 1%` over 5 min
  - HTTP API `p99 > 2 s` over 5 min — widen initially; cold resume trips it legitimately
  - Aurora `ServerlessDatabaseCapacity` at max ACU for 15 min (runaway query)
  - Aurora `DatabaseConnections` non-zero for long periods (blocks auto-pause)
- **`treatMissingData: notBreaching` explicitly on every alarm.** A paused instance emits only
  `CPUUtilization`, `ACUUtilization` and `ServerlessDatabaseCapacity`; an idle app produces no API
  metrics. Without this, most alarms sit in `INSUFFICIENT_DATA` for most of the month and the alarm
  mail becomes noise you learn to ignore.
- **One dashboard**: API RPS, Lambda duration p50/p99, WS connections, Aurora ACU and query latency,
  DDB capacity, SQS depth, S3 4xx/5xx.
- **Log retention 14 days** on every log group.

---

## 10. Environment and Secrets

**CloudFormation cannot create SSM `SecureString` parameters** — it never has. So secrets go to
Secrets Manager, which is already in the stack for the Data API:

- **Secrets Manager**, per stage: the Aurora credential, and **`JWT_SECRET`**. Both created by CDK,
  referenced by ARN, never read into env vars. This deletes what would otherwise be a manual
  out-of-band step at the end of the project.
- **SSM Parameter Store** (plain strings only): `/meme/{stage}/SES_FROM_ADDR` and similar
  non-secrets.
- **Lambda env vars** (non-secret): `STAGE`, `DB_CLUSTER_ARN`, `DB_SECRET_ARN`, `DB_NAME`,
  `DB_DRIVER`, `JWT_SECRET_ARN`, `STATE_TABLE_NAME`, `MEMES_BUCKET`, `WS_CALLBACK_URL`,
  `BATTLE_QUEUE_URL`, `PRESENCE_QUEUE_URL`, `ALLOWED_ORIGINS`, `LOG_LEVEL`.
- **Local-only**: `DDB_ENDPOINT`, `WS_CALLBACK_URL=http://localhost:3002`, personal queue URLs, and
  `DATABASE_URL` for the `pg` escape hatch. Endpoint configuration only — no backend switch exists.
- **Cold-start fetch** via `@aws-lambda-powertools/parameters` (module-scope cached).
- **Frontend build var**: `VITE_API_BASE=/api`. `VITE_WS_URL` does not exist (§5.4).

---

## 11. CI/CD — GitHub Actions with OIDC

### 11.1 OIDC setup, codified

The provider and roles are ordinary IAM resources, fully expressible in CDK. The only irreducible
constraint is ordering: the role that lets CI deploy cannot itself be created by CI. One local
`cdk deploy` per account, immediately after `cdk bootstrap`, which is already mandatory.

```typescript
const provider = props.existingProviderArn
  ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, 'GitHubOidc', props.existingProviderArn)
  : new iam.OpenIdConnectProvider(this, 'GitHubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

// dev: any branch. prod: main only — a PR branch cannot reach prod even by editing the workflow.
const subject = `repo:${props.githubOrg}/${props.repo}`;
const conditions: iam.Conditions = props.stage === 'prod'
  ? { StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        'token.actions.githubusercontent.com:sub': `${subject}:ref:refs/heads/main`,
    } }
  : { StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
      StringLike:   { 'token.actions.githubusercontent.com:sub': `${subject}:*` } };

const role = new iam.Role(this, 'GitHubActionsRole', {
  roleName: `gh-actions-meme-${props.stage}`,
  maxSessionDuration: Duration.hours(1),
  assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, conditions),
});

// A key to the door: real permissions live on the CDK bootstrap roles.
role.addToPolicy(new iam.PolicyStatement({
  actions: ['sts:AssumeRole'],
  resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
}));
// Plus what the migration step needs directly.
role.addToPolicy(new iam.PolicyStatement({
  actions: ['rds-data:ExecuteStatement', 'rds-data:BeginTransaction',
            'rds-data:CommitTransaction', 'rds-data:RollbackTransaction'],
  resources: [`arn:aws:rds:${this.region}:${this.account}:cluster:meme-*`],
}));
role.addToPolicy(new iam.PolicyStatement({
  actions: ['secretsmanager:GetSecretValue'],
  resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:meme-*`],
}));
```

Push the ARN to GitHub rather than copying it:

```bash
gh secret set AWS_DEV_ROLE_ARN --body "$(aws cloudformation describe-stacks --stack-name meme-github-oidc-dev --query 'Stacks[0].Outputs[?OutputKey==`RoleArn`].OutputValue' --output text --profile meme-dev)"
```

**Three things to know:** only **one GitHub OIDC provider is allowed per AWS account** (hence
`existingProviderArn` — import rather than create); **thumbprints are no longer security-critical**
for GitHub's endpoint, and older guides hardcode ones that have since rotated; and **CI must never
deploy this stack** (§7.2).

### 11.2 Workflow

```yaml
name: CI / CD
on:
  push:         { branches: [main] }
  pull_request: { branches: [main] }

permissions:
  id-token: write
  contents: read
  pull-requests: write

jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16          # must match Aurora's major version (§2.1)
        env: { POSTGRES_PASSWORD: postgres }
        options: >-
          --health-cmd pg_isready --health-interval 5s
          --health-timeout 5s --health-retries 5
        ports: ['5432:5432']
      dynamodb:
        image: amazon/dynamodb-local
        ports: ['8000:8000']
    env:
      DB_DRIVER: pg
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/postgres'
      DDB_ENDPOINT: 'http://localhost:8000'
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run lint
      - run: bun run db:migrate
      - run: bun run test           # contract, concurrency, CDK assertions
      - run: bun run --cwd infra cdk synth

  # Production runs Node 22, so tested code must execute on it (§8.4).
  test-node:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres }
        options: >-
          --health-cmd pg_isready --health-interval 5s
          --health-timeout 5s --health-retries 5
        ports: ['5432:5432']
      dynamodb:
        image: amazon/dynamodb-local
        ports: ['8000:8000']
    env:
      DB_DRIVER: pg
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/postgres'
      DDB_ENDPOINT: 'http://localhost:8000'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run db:migrate
      - run: npm run test           # same suite, Node runtime

  preview:
    needs: [check, test-node]
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEV_ROLE_ARN }}
          aws-region: ap-southeast-2
      - run: bun run --cwd infra cdk diff --all 2>&1 | tee /tmp/diff.txt
      - uses: actions/github-script@v7
        with:
          script: |
            const diff = require('fs').readFileSync('/tmp/diff.txt', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner, repo: context.repo.repo,
              body: '### CDK diff (dev)\n```\n' + diff.slice(0, 65000) + '\n```'
            });

  # Dev is a non-optional test tier (§8.2), so it must not drift behind main.
  deploy-dev:
    needs: [check, test-node]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEV_ROLE_ARN }}
          aws-region: ap-southeast-2
      - run: bun run --cwd infra cdk deploy --all --require-approval never --concurrency 4
      - run: bun run db:migrate
        env:
          DB_DRIVER: data-api
          DB_CLUSTER_ARN: ${{ vars.DEV_DB_CLUSTER_ARN }}
          DB_SECRET_ARN:  ${{ vars.DEV_DB_SECRET_ARN }}

  deploy-prod:
    needs: deploy-dev
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production        # manual approval gate
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_PROD_ROLE_ARN }}
          aws-region: ap-southeast-2
      # --all sees only the main app; infra/bootstrap is a separate CDK app (§7.2)
      - run: bun run --cwd infra cdk deploy --all --require-approval never --concurrency 4
      - run: bun run db:migrate
        env:
          DB_DRIVER: data-api
          DB_CLUSTER_ARN: ${{ vars.PROD_DB_CLUSTER_ARN }}
          DB_SECRET_ARN:  ${{ vars.PROD_DB_SECRET_ARN }}
      # Assets before index.html, then invalidate (§5.5)
      - run: |
          aws s3 sync app/dist s3://$BUCKET --exclude index.html --cache-control 'max-age=31536000,immutable'
          aws s3 cp app/dist/index.html s3://$BUCKET/index.html --cache-control 'no-cache'
          aws cloudfront create-invalidation --distribution-id $DIST --paths /index.html
      # Not ?db=1 — a deep-sleep resume would exceed CloudFront's 30s ceiling (§2.2)
      - run: curl --fail --max-time 30 "${{ vars.PROD_APP_URL }}/api/health"
```

### 11.3 Key points

- **No AWS keys in GitHub secrets** — only role ARNs, which are not sensitive.
- **Prod is locked to `main`** by the OIDC trust condition, not by workflow logic.
- **Migrations run over the Data API from the runner** — the practical payoff of the no-VPC
  decision. With a VPC-private database this would need a migration Lambda or in-VPC CodeBuild.
- **Migrations must be backward-compatible with deployed code**, since they run after it.
  Expand-then-contract, from the second release onward.
- **Dev deploys on every merge**, so the tier-2 environment stays current.

---

## 12. Cost Protection

### 12.1 Resource-level throttles

| Service | Mechanism | Value |
|---|---|---|
| Lambda (HTTP) | `reservedConcurrentExecutions` | **25** |
| Lambda (WS + async) | `reservedConcurrentExecutions` | **10** each |
| API Gateway HTTP / WS | Stage throttle | **50 burst / 20 RPS** |
| **Aurora** | **`serverlessV2MaxCapacity`** | **1 ACU** dev / **2 ACU** prod — a genuine hard ceiling |
| DynamoDB | On-demand, shielded by the API throttle | — |
| S3 uploads | Presigned content-length condition | **1 MB** |
| SQS | Max receive count → DLQ | 3 |

### 12.2 Budget and kill switch

1. **AWS Budget at $15/month** — 80% → email; 100% → kill-switch Lambda.
2. The kill switch sets `reservedConcurrentExecutions: 0` on all application Lambdas. It **must
   exclude itself**, and needs `lambda:PutFunctionConcurrency` scoped to the app functions only.
   Aurora then goes idle and auto-pauses on its own — a real advantage over an always-on instance,
   which would keep billing after the switch fired.
3. **Recovery is not automatic, and the next CI deploy will silently undo it.** A merge to `main`
   redeploys the CDK template, restoring concurrency and re-opening the tap. The runbook is:
   investigate the cause first, and either pause the deploy workflow or fix the root cause **before**
   merging anything.

**Caveat**: billing data lags 6–24 h, so spend may reach ~$20–25 before the switch fires. This
prevents a $100+ runaway, not a $15.01 overshoot.

### 12.3 Cost Anomaly Detection

Free; alerts within hours on unusual patterns — e.g. a bug driving sustained ACU — that a monthly
threshold would miss.

### 12.4 Worst case at sustained throttle limits

~52M requests/month: API Gateway HTTP $52, WebSocket $55–60, Lambda $10–16, **Aurora pinned at
2 ACU ~$85–90**, DynamoDB $10–20, SQS $5–10, logs $2–3, S3/CloudFront $1–2 — **~$220–250/mo**
unchecked. With the kill switch at ~$8/day burn: **$25–35 total** before the app goes dark.

---

## 13. Cost Estimate (idle / light use)

| Item | $/mo |
|---|---|
| Aurora Serverless v2 — storage while paused (~10 GB) | $1.00 |
| Aurora Serverless v2 — ACU-seconds, light use | $1.00 – $4.00 |
| Secrets Manager (2 secrets) | $0.80 |
| RDS Data API requests | $0 – $0.20 |
| DynamoDB on-demand (idle) | $0 |
| SQS (idle event-source polling, 2 queues) | $0 – $0.50 |
| Lambda | $0 – $0.50 |
| API Gateway HTTP + WebSocket | $0 – $1.00 |
| CloudFront + S3 (frontend + memes) | $0 – $0.75 |
| CloudWatch — logs, alarms past the free 10, X-Ray | $0.50 – $1.50 |
| SSM Parameter Store, SES | $0 |
| Route 53 (deferred — no domain yet) | $0 |
| **Total** | **~$5 – $11 / mo** |

The dominant variable is **Aurora ACU-hours**, driven by how much of the month the cluster is awake
rather than by request count. `SecondsUntilAutoPause` is the main lever. Adding a custom domain
later adds $0.50. Verify the free-tier caveat in §7.1 before trusting any `$0` line.

---

## 14. Implementation Plan

Ordered by dependency, not by shippable increments. Items marked ∥ can run in parallel with the
block above. Single-pass *delivery* does not require a single long-lived branch — blocks 0, A and E
are independently mergeable, and B+C merge together once the app runs on Postgres.

### Block 0 — Spike (one day, throwaway)

Prove what cannot be settled by reading. **Falsification, not construction**: separate `spike/`
directory, own CDK app, never merged, `cdk destroy` at the end. Time-boxed to a day — if a question
survives a day, that *is* the finding. Every answer is a number or a yes/no, written down.

1. **`@connections` endpoint override** — *one hour, local, no AWS.* An HTTP server on `:3002`;
   `ApiGatewayManagementApiClient({ endpoint })`; confirm `POST /@connections/<id>` with the payload
   as body, no SigV4 complaint, and `410` surfacing as `GoneException`. Gates §4.4.
2. **§7.1 steps 0–5** — root MFA, Organizations, accounts, Identity Center, bootstrap. Needed
   regardless. Confirm the highest Aurora PostgreSQL major in ap-southeast-2 satisfies the
   scale-to-zero minimum, and whether centralised root access is available.
3. **`/ws` and `/api/*` through CloudFront** — the §5.1 stage-naming approach: WebSocket stage named
   `ws` with empty origin path, HTTP API on `$default`. Cheap to prove, expensive to discover at
   item 31.
4. **One stack for the rest** — a minimal Express app hashing with `@node-rs/argon2`, setting a
   cookie, reading Aurora via the Data API, behind LWA → HTTP API → CloudFront. Confirms
   `Set-Cookie` survives (via API Gateway *and* CloudFront) and that argon2 bundles ARM64 from
   Windows.
5. **Measure resume.** Set `SecondsUntilAutoPause` to the 300 s minimum for the warm case. **Then
   leave it paused for more than 24 hours and measure again** — deep sleep is the number that
   drives §2.2's design, and it is the one genuinely unmeasured quantity. Record end-to-end latency
   through CloudFront + API Gateway, not just the Data API call.

*Not* in the spike: the "does it block or fail fast?" question (documented: a Data API request
resumes the writer and then processes — and retry logic is unconditional either way), SQS delay
queues, DynamoDB.

**Output**: `docs/spike-findings.md` with measurements, plus amendments to §2.1, §2.2, §4.1 and §13
as needed.

### Block A — Repo foundations

1. Root `package.json` with Bun workspaces (`app`, `server`, `infra`). Scripts: `typecheck`, `lint`,
   `test`, `db:migrate`, `db:rollback`, `db:seed`.
2. ESLint for `server/` with **type-aware linting**: no template-literal SQL, and
   `@typescript-eslint/no-floating-promises`.
3. `bun test` with a Postgres + DynamoDB Local harness. Node 22 CI job (§8.4).
4. `docker-compose.yml`: replace `mongo:8` with version-pinned `postgres` and
   `amazon/dynamodb-local`.
5. **Delete one of `app/bun.lock` / `app/pnpm-lock.yaml`** — both exist today.

### Block B — Data layer

6. Confirm Drizzle's Data API driver, then commit (§4.5).
7. §2.3 schema as the first migration, **with a down path**. Add `db:seed`.
8. Repository layer with both drivers, plus the resume-aware retry wrapper (§2.2).

### Block C — Services

9. `UserService` — unique constraints replace manual existence checks.
10. **Auth hardening** (§6.2, §6.3, §6.5): `JWT_SECRET` throws without a value; cookie `Secure`
    defaults on; `clearCookie` carries matching attributes; `SameSite=Strict`; password minimum 8,
    mirrored in `Login.vue`.
11. `CompetitionService` — the §2.4 transaction, and **all three** battle-status guards.
12. `VoteService` — `ON CONFLICT DO UPDATE` + `AVG()`.
13. Battle persistence → `battles` + `battle_entries`.
14. Delete `db/client.ts` and `db/collections.ts`; drop `mongodb`.
15. Tests, especially the §2.4 constraints.

**Checkpoint: the app runs end-to-end locally with MongoDB fully removed.** Do not start block F
before this holds.

### Block D — Real-time ∥

16. Extract the four seams (§4.4). Delete today's `Map`s.
17. `DdbConnectionRegistry`, `DdbChatStore`, `SqsTimerScheduler`, `ApiGwWsTransport` — one
    implementation each.
18. Local `@connections` shim with `410`, jitter, and fanout reordering.
19. Dev-only SQS poller against personal queues.
20. Per-connection state onto the connection row; `Origin` allowlist in both entry paths.
21. **`advanceBattle` self-heal** (§3.2) and **presence/refresh suppression** (§3.3).
22. `battleWs.ts` as an event-shape adapter calling real handler exports.
23. Contract, concurrency, and CDK-assertion suites (§8.3).

### Block E — Uploads and SVG removal ∥

24. Remove `image/svg+xml` and the `<svg` branch; reconcile the three format lists including
    `isImage()` (§4.6).
25. `signUpload` writing the pending row; `validateMeme` with accept/reject paths and
    `UPLOAD_READY` / `UPLOAD_REJECTED`.
26. **`CompetitionDetail.vue` upload state machine** with polling fallback.
27. S3 deletion for both prefixes on competition and file delete.
28. Rewrite `s3-client.ts`: **delete the module-scope `CreateBucketCommand`** (unguarded top-level
    `await`, throws `BucketAlreadyOwnedByYou` on every cold start), drop credential handling,
    `getFileUrl` returns `/cdn/<key>`.

### Block F — Infrastructure

29. `infra/bootstrap/` + one local deploy per account; role ARNs to GitHub (§11.1).
30. `DataStack`, `AppStack`, `ObservabilityStack` (§7.2), including the response headers policy and
    raised origin response timeout.
31. Deploy to `meme-dev`; tier 2 becomes available.

### Block G — Frontend

32. Vite proxy for `/api` and `/ws`; `VITE_API_BASE=/api`; derive the WS URL from `location`; **delete
    `cors`** (§5.4).
33. `useBattleSocket.ts` — ping, **pong deadline, backoff reconnect, re-`SUBSCRIBE`, reconnecting
    indicator** (§4.3).
34. Wake-on-load `GET /api/health?db=1` and the "waking up…" retry state (§2.2).
35. Unit-test the SPA-fallback CloudFront Function.
36. GH Actions build and sync, **assets before `index.html`** (§5.5).

### Block H — Observability ∥

37. Powertools everywhere; alarms with `treatMissingData: notBreaching`; dashboard; retention.
38. Verify the SES recipient, then verify the alarm-email flow with a synthetic error.

### Block I — Go live

39. Write the developer `README.md` (§8.5) — **before** the prod standup, while the one-time steps
    are fresh.
40. Work through §17 in full against `meme-dev`.
41. Deploy to `meme-prod`. The app is live on the default CloudFront domain.
42. Verify the README on a clean checkout — ideally a second machine.

### Block J — Custom domain (deferred, optional)

43. Register a domain; hosted zone in `meme-prod`.
44. `CertStack` in **us-east-1**; alias records; distribution alternate domain name.
45. Update `VITE_API_BASE` if needed and redeploy the frontend.

---

## 15. Critical Gotchas

**Database**

- **Two resume regimes**: ~15 s warm, **30 s+ after 24 h idle**. API Gateway caps integration
  timeout at 30 s and CloudFront's origin response timeout defaults to 30 s, so blocking returns a
  504 while the Lambda runs on. Fast 503 + client retry, not longer timeouts (§2.2).
- **Retry logic is unconditional**, not contingent on measurement.
- **Anything holding a connection prevents auto-pause** — no RDS Proxy (also ~$22/mo, more than the
  database), no persistent monitoring session.
- **`enableDataApi: true` is load-bearing.** Without it, Lambdas must join the VPC and the cost
  model collapses.
- **Data API is not the Postgres wire protocol.** Use the Data API driver variants. No
  `LISTEN`/`NOTIFY`. Array marshalling is rough — hence `battle_entries` rather than `text[]`.
- **Storage encryption and `deletionProtection` are creation-time only.**
- **Migrations run after code deploys** — expand-then-contract from the second release.

**Correctness**

- **`advanceBattle` must self-heal on zero rows** or a battle stalls permanently. `rehydrate()` was
  the old safety net and is being deleted (§3.2).
- **No Powertools idempotency on `advanceBattle`** — it defeats the self-heal.
- **A refresh must not announce a join** — hence the `RECONN#` marker (§3.3).
- **Upload rejections need a delivery path** — async validation deletes the synchronous error
  contract (§4.6).
- **Chat history is read newest-first and must be reversed.**
- **`BATTLE_STATE.myVote` must survive the port**, or refreshing mid-entry loses the star state.

**Lambda**

- **`@node-rs/argon2` is native** — esbuild alone will not bundle it.
- **Argon2 at 128 MB is unusably slow** — 1024 MB.
- **LWA runs your real server** — keep `.listen()`. Verify `Set-Cookie` survives early.
- **No floating promises** — Lambda freezes on resolution and the fanout silently vanishes (§6.6).
- **6 MB sync payload** — never proxy uploads through Lambda.

**Edge**

- **API Gateway WS is reachable only at its exact stage URL** — any extra segment is a 403. Name the
  stage `ws` and use `$default` on the HTTP API (§5.1).
- **The `/ws` origin request policy needs all four `Sec-WebSocket-*` headers**, not just `Cookie`.
- **Scope the SPA-fallback function to the default behaviour**, or it swallows `/ws` and
  `/api/health`.
- **Sync assets before `index.html`.**
- **ACM must be us-east-1** if a domain is added.
- **OAC not OAI** — migrating later requires distribution recreation.

**Local**

- **There is no local implementation of anything — keep it that way.** Differences belong in
  configuration.
- **Per-developer SQS queues are required**, or the deployed dev Lambda steals local ticks (§8.1).
- **DynamoDB Local accepts any credentials** — IAM errors are invisible in tier 1.
- **Bun locally, Node 22 in Lambda** — CI must run the suite on Node (§8.4).
- **`bun --hot` clears module scope constantly; a warm Lambda holds it for minutes**, so
  stale-cache bugs are *hidden* locally.

**Accounts and CI**

- **Root users are the unrecoverable mistake** — MFA on management root first; remove or secure
  member roots immediately (§7.1).
- **CloudFormation cannot create SSM `SecureString`** — secrets go to Secrets Manager (§10).
- **SES starts in sandbox mode** — alarms silently deliver nothing until the recipient is verified.
- **Only one GitHub OIDC provider per account** — import if one exists.
- **Never let CI deploy `infra/bootstrap/`.**
- **A CI deploy silently restores kill-switched concurrency** (§12.2).
- **Free tier is shared across the Organization**, not per account.

---

## 16. Files

**Refactor:**

- `server/server.ts` — drop `connectDb` / `createIndexes` / `rehydrate`; **keep `.listen()`**
- `server/src/services/BattleManager.ts` — extract seams; battle persistence to Postgres; self-heal
- `server/src/services/UserService.ts` — repository layer; unique constraints
- `server/src/services/CompetitionService.ts` — §2.4 transaction; all three battle guards
- `server/src/services/VoteService.ts` — `ON CONFLICT DO UPDATE` + `AVG()`
- `server/src/controllers/AuthController.ts` — cookie `Secure` default, `clearCookie` attributes,
  `SameSite=Strict`
- `server/src/utils/jwt.ts` — **remove the hardcoded fallback; throw instead**
- `server/src/utils/password.ts` — minimum length 8
- `server/src/ws/battleWs.ts` — event-shape adapter; `Origin` allowlist
- `server/src/middleware/file.ts` — remove `image/svg+xml`; replace Multer with presign
- `server/src/utils/file-validation.ts` — delete the `<svg` branch
- `server/src/utils/s3-client.ts` — delete the module-scope `CreateBucketCommand`; drop credentials;
  `getFileUrl` → `/cdn/<key>`; keep and adapt the deletion helpers
- `server/src/controllers/CompetitionController.ts` — member usernames become a join; S3 deletion for
  both prefixes
- `app/src/api/client.ts` — `VITE_API_BASE`
- `app/src/composables/useBattleSocket.ts` — reconnect, ping/pong, derive the WS URL from `location`
- `app/src/pages/CompetitionDetail.vue` — upload state machine; `isImage()` format list; `accept`
- `app/src/pages/Login.vue` — mirror the 8-character rule
- `app/vite.config.mts` — proxy `/api` and `/ws`
- `docker-compose.yml` — `postgres` (version-pinned) + `amazon/dynamodb-local`
- `server/.env.example` — replace `MONGODB_*` and the LocalStack block

**Delete:** `server/src/db/client.ts`, `server/src/db/collections.ts`, the `cors` dependency, one of
`app/bun.lock` / `app/pnpm-lock.yaml`

**New:** root `package.json`; `README.md`; `server/src/db/{schema,migrations,seed}`;
`server/src/db/repository/*`; `server/src/state/*`; `server/src/dev/{connections-shim,sqs-poller}.ts`;
`server/src/handlers/{ws,async}/*`; `infra/`; `infra/bootstrap/`; `infra/test/*`;
`.github/workflows/deploy.yml`

---

## 17. Acceptance Checks

Run against `meme-dev` before prod.

**Tests**

- `typecheck`, `lint`, `test` pass under **both** Bun and Node 22
- Tests fail when a service is deliberately broken
- Contract suite passes against both DB drivers and both DynamoDB targets
- Concurrency suite fails when a guard is removed — delete the `FOR UPDATE` and confirm red
- CDK assertions fail when a role is over-granted

**Data constraints**

- Change a vote twice → the average is correct both times
- Duplicate username rejected; duplicate email rejected
- A 4th upload by one user rejected; upload after battle start rejected
- **`relinquishOwnership` and `claimOwnership` both rejected after a battle starts**
- **Deleting a file that is in a battle is refused by the database**
- Deleting a competition cascades rows **and removes S3 objects under both prefixes**

**Auth**

- **Inspect the deployed `Set-Cookie` header** and confirm `Secure` and `SameSite=Strict` — do not
  infer from source
- **Logout actually clears the cookie** in the deployed environment
- A 7-character password is rejected by the API directly, bypassing the UI
- **Starting a Lambda without `JWT_SECRET` fails to start** rather than serving
- A WebSocket handshake from a disallowed `Origin` is refused

**Resume**

- Cold-resume latency recorded for both regimes
- After >24 h idle, the first request returns `503 DB_RESUMING` promptly and the SPA shows "waking
  up…" then recovers — **it must not 504**

**Real-time**

- Two tabs: chat, presence, battle advancement
- Close one tab → the other sees the leave in ~3 s
- **Refresh one tab → no leave/join flicker** (the `RECONN#` marker)
- Idle lobby survives past 10 minutes
- **Kill the connection mid-battle** (devtools offline, or a deploy) → the client reconnects,
  re-subscribes, resumes at the right entry and countdown
- **Kill `advanceBattle` between the UPDATE and the enqueue** → the next `SUBSCRIBE` or redelivery
  self-heals and the battle continues
- A chat fanout reaches **all** connections — verify against a deployed Lambda
- A battle runs to completion; final ratings land in `competition_files.rating`

**Uploads**

- A valid PNG/JPEG/GIF/WebP/BMP near 1 MB appears in the competition
- An `.exe` renamed to `.png` is deleted within seconds **and the client shows the rejection**
- An SVG is rejected by MIME type and by magic bytes
- A 2 MB file is rejected at S3
- Four presigned URLs requested, all uploaded → the 4th rejected
- **With the socket closed, the client still learns the outcome** via polling

**Routing**

- The default CloudFront domain serves the SPA; deep links work
- `/api/*` reaches the API; **`/ws` upgrades with the cookie forwarded**
- `/cdn/*` serves memes; the bucket is not directly reachable; `nosniff` present

**Observability and cost**

- SES recipient verified, then a forced error produces mail within ~5 min
- Alarms sit in `OK`, not `INSUFFICIENT_DATA`, while the app is idle
- Log groups show 14-day retention
- The cluster actually auto-pauses — confirm on `ServerlessDatabaseCapacity`

---

## 18. Open Items

- **Abandoned pending upload rows** count toward the entry limit by design. A sweeper is optional;
  revisit if it annoys anyone.
- **Per-Lambda database least privilege** — Postgres roles and `GRANT`s (§6.1)
- **RDS Proxy** — only if abandoning the Data API, accepting ~$22/mo and the loss of auto-pause
- **Aurora DSQL** — scale-to-zero with no VPC, but no foreign keys, extensions or sequences. Only if
  ACU cost dominates and you'd give up what §2.3 uses
- **WAF and login/registration rate limiting** — deferred together (§6.9)
- **Custom domain** — deferred by choice, not blocked (block J)
- **PR preview environments** — once the solo workflow is stable
- **Multi-region, Cognito, read replicas** — not at this scale
- **User deletion** — unsupported; the FK rules are consistent but no feature exists
- **SVG support** — only with a real XML sanitiser *and* a sandbox CSP
- **Lambda RIE as a third local tier** — worth it for the auth path if `Set-Cookie` ever breaks in a
  way tier 1 missed
- **Chat TTL of 1 hour** — a longer session loses history the old ring buffer would have kept
