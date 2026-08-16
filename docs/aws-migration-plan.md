# Roadmap: Deploying Meme-Competition to AWS (Serverless + Aurora Serverless v2)

> **Revision 3.** Persistence is Aurora Serverless v2 PostgreSQL via the RDS Data API, with one
> small DynamoDB table for ephemeral real-time state. Delivered as a **single pass** — there is no
> production deployment, so no phased rollout and no data migration. SVG upload support is removed.
> GitHub Actions OIDC setup is codified in CDK. See [§0](#0-revision-history) for what changed.

## Context

Meme-Competition is a hobby-scale but production-minded app — Vue 3 SPA + Bun/Express/WS backend
+ MongoDB + S3. Today it assumes a single always-running Node process: in-memory `Map`s hold
WebSocket clients, a 50-message chat ring buffer, 3-second presence debounce timers, and
`setTimeout`-driven 8-second battle ticks that get rehydrated from Mongo on startup
(`server/src/services/BattleManager.ts`).

The goal is a production-grade AWS deployment that **scales to near-zero** when idle (≈$4–9/month),
uses AWS-native services where sensible, follows commercial-grade IaC and CI/CD practice, and
preserves a fast local dev loop with HMR. IaC is **AWS CDK v2 in TypeScript**. CI/CD is **GitHub
Actions with OIDC**, solo-main-branch CD.

Two decisions carry most of the weight:

1. **One CloudFront distribution** at `app.example.com` with path-based origins (`/` → S3 frontend,
   `/api/*` → HTTP API, `/ws` → WebSocket API, `/cdn/*` → memes bucket). This eliminates CORS, keeps
   the JWT cookie as a plain same-site cookie, and gives one ACM cert + one DNS record to manage.
2. **Aurora Serverless v2 PostgreSQL reached over the RDS Data API, not a TCP connection.** This is
   what allows the Lambdas to stay *outside* any VPC. Direct Postgres connections would force the
   Lambdas into the VPC, which costs $32–45/month in NAT Gateway or interface endpoints and
   destroys the cost target. Everything else in this plan depends on getting this right.

### Confirmed scope

**There is no deployed environment.** The database starts empty. There is **no data migration**,
no dual-write window, no cutover rehearsal, and no need for incrementally shippable stages. The
work is a single pass: the app runs on MongoDB locally today, and lands on Postgres + AWS at the
end. §13 orders the work by dependency, not by shippable increments.

---

## 0. Revision history

**Revision 3** (this document):

| Change | Detail |
|---|---|
| **SVG support removed** | `image/svg+xml` drops out of the upload allowlist and the `<svg` branch leaves `validateImageFile`. This closes the stored-XSS exposure that same-origin `/cdn/*` would otherwise create, with no CSP/response-header workaround needed. |
| **Single pass, no phases** | §13 is a dependency-ordered work breakdown, not a sequence of shippable phases. No feature flags for migration, no per-phase ship gates, no rollback-to-Mongo path. |
| **No data migration** | Confirmed: nothing to migrate. |
| **OIDC setup codified** | New `infra/bootstrap/` CDK app creates the GitHub OIDC provider and deploy roles (§10.1). Answers "can this be automated" — yes, apart from one unavoidable local bootstrap step. |
| **Local dev divergence collapsed** | Earlier revisions reimplemented `ConnectionRegistry`, `ChatStore`, and `TimerScheduler` in memory for local dev, then proposed scaffolding (a chaos backend, a dual-run contract suite) to make those reimplementations trustworthy. Only `WsTransport` genuinely cannot run locally. The other three now run **production code against local endpoints** — DynamoDB Local and a real dev SQS queue. Three implementations deleted; two Docker services and a dev poller added (§3.4, §7). |
| **Local upload path fixed** | As previously specified, a local upload wrote its DB row to dev Aurora while the local server used Docker Postgres. Now resolved by a client callback invoking the same `validateMeme` handler in-process (§3.6). |
| **Developer README** | New `README.md` at the repo root — local setup, one-time AWS org/account standup, and production deployment (§7.4). |
| **Region fixed: `ap-southeast-2`** | Sydney. ACM for a custom domain still has to be us-east-1 if and when one is added. |
| **Custom domain deferred** | None owned yet, and none needed: the single-distribution design works unchanged on the default `d….cloudfront.net` name with an AWS-provided cert. `CertStack` and Route 53 become optional block J (§4). |
| **Zero local implementations** | The last one (`LocalWsTransport`) is replaced by a local `@connections` HTTP shim that the *real* `ApiGwWsTransport` talks to via `WS_CALLBACK_URL`. `battleWs.ts` becomes an event-shape adapter calling the real handler exports (§3.4). |
| **Four production-only bugs closed** | No WebSocket reconnect logic (§3.3); floating promises silently dropping fanouts under Lambda freeze/thaw (§5); SES sandbox silently swallowing alarm mail (§6); local Postgres major not pinned to Aurora's (§2.1). |
| **Test tiers added** | Concurrency tests at the seam/handler level, and CDK template assertions over IAM policies — the two largest gaps tier 1 could not reach (§7.3). |
| **Decisions closed** | Drizzle as the query builder; Docker bundling for argon2 (free now that Docker is required anyway); migration down-paths and `db:seed` as first-class scripts. |
| **Auth hardening for going public** | The app has only ever run on localhost. Cookie `Secure` flag inverted to fail-secure (it silently evaluated `false` under Lambda); password minimum raised from 4 to 8 (§5). |
| **Root user security** | MFA on the management account root before anything is created; member-account root credentials removed via centralised root access, or recovered and MFA-protected (§6 steps 0 and 2a). Previously absent entirely. |
| **Block 0: a one-day spike** | Four assumptions carry the plan and cannot be settled by reading — Aurora min-0 + Data API auto-pause behaviour above all. Falsify them in a throwaway stack before writing code against them (§13). |
| **Rate limiting explicitly deferred** | Not built. Folded into the WAF decision in §5, together with the design constraints — why API Gateway throttling and `express-rate-limit` are both non-answers — so the choice can be made quickly if abuse ever materialises. |

**Revision 2** replaced the original all-DynamoDB design:

| Area | Original | Revision 2 | Why |
|---|---|---|---|
| Primary datastore | DynamoDB single-table | **Aurora Serverless v2 PostgreSQL** | Three correctness defects in the DDB model (mutable-vote aggregation, username/email uniqueness, per-user entry limit) all vanish under relational constraints. No single-table lock-in as access patterns evolve. |
| DB access path | N/A | **RDS Data API over HTTPS** | Keeps Lambdas out of the VPC; removes connection exhaustion without RDS Proxy (~$22/mo, and it prevents auto-pause). |
| Ephemeral state | DynamoDB `meme-state` | **Unchanged** | Free at idle, no VPC, built-in TTL, trivial key design. |
| Battle state | `meme-state` (TTL table) | **Postgres `battles` table** | `status='complete'` is a permanent gate on uploads and ownership; durable state must not live behind a TTL. |
| Battle 8s ticks | EventBridge Scheduler one-shots | **SQS delay queue** | Scheduler's granularity and jitter are a poor fit for an 8s tick, and it needed per-tick create/delete churn plus explicit cleanup on competition deletion. SQS `DelaySeconds` gives 1-second granularity; the conditional update already makes stale ticks no-ops. |
| Presence | DDB TTL + Streams `REMOVE` | **`$disconnect` + 3s SQS delay-queue debounce** | TTL deletion lags minutes to hours — a regression from today's 3s debounce. |
| Secrets | SSM only | SSM **+ Secrets Manager** for the DB credential | Data API requires it. |
| Local dev data | Hybrid against dev-account DDB | **Docker Postgres locally** | Faster loop, no SSO expiry mid-session, no tunnel into a private VPC. |
| Lambda runtime | Node 20 | **Node 22** | Node 20 hits Lambda deprecation within this plan's lifetime. |

Revision 2 also fixed: the Lambda Web Adapter usage (the original described the
`serverless-express` pattern, which is the opposite of what LWA needs), `@node-rs/argon2` native
bundling (a hard blocker), and the WebSocket route-selection mismatch against the existing client
protocol.

---

## 1. AWS Service Map

| Concern | Service | Rationale (cost-at-idle + learning value) |
|---|---|---|
| REST API | **API Gateway HTTP API v2** + Lambda | ~70% cheaper than REST API v1 ($1/M vs $3.50/M), scale-to-zero |
| WebSocket API | **API Gateway WebSocket API** + Lambda | Only AWS-native serverless WS option; $1/M msgs + $0.25/M connection-minutes |
| Frontend hosting | **S3 (private) + CloudFront + OAC** | OAC is current best practice; bucket stays private; CloudFront gives TLS + caching |
| Image CDN | **Same CloudFront distribution**, memes bucket as a second origin at `/cdn/*` | One distro = one cert = cheaper |
| Image uploads | **S3 presigned PUT** from browser + async validation Lambda on `s3:ObjectCreated` (via EventBridge) | Bypasses Lambda's 6MB sync payload limit; browser → S3 direct |
| Application data (users, competitions, memberships, files, votes, battles) | **Aurora Serverless v2 PostgreSQL**, min 0 ACU + auto-pause, **accessed via RDS Data API** | Relational integrity for the constraints this app actually needs; scale-to-zero; HTTPS access keeps Lambdas out of a VPC |
| Real-time state (WS connections, chat, idempotency) | **DynamoDB on-demand**, one table, TTL enabled | $0 at idle, no VPC, native TTL, IAM-scoped |
| Battle 8-second ticks + presence debounce | **SQS delay queues** (`DelaySeconds`) | 1-second granularity, no schedule churn, DLQ support built in |
| Secrets | **SSM Parameter Store (Standard)** for app secrets; **Secrets Manager** for the DB credential (Data API requirement) | SSM is free; one Secrets Manager secret ≈ $0.40/mo |
| Email (alarms only) | **SES** | Cheap, AWS-native |
| Monitoring | **CloudWatch Logs + Metrics + Alarms + X-Ray** + AWS Lambda Powertools (TypeScript) | Native + free tier + great learning value |
| DNS / TLS | **Route 53** (~$0.50/mo) + **ACM in us-east-1** (free, auto-renew) | ACM must be us-east-1 for CloudFront |
| WAF / login rate limiting | **Skip both** for hobby (WAF is $5/mo base + $1/rule); revisit if abused — §5 records the options | — |
| Auth provider | **Keep Argon2 + JWT** (current impl) | Cognito adds learning tax that doesn't fit the rest of the stack |

> **Note on the HTTP API JWT authoriser.** API Gateway's built-in JWT authoriser only accepts
> OIDC/JWKS issuers. This app signs its own HS256 tokens and stores them in an HttpOnly cookie, so
> the authoriser is *not* usable — authentication stays in the existing Express middleware. This
> does not change the decision to use HTTP API v2, but don't count it as a benefit.

---

## 2. Data Layer

### 2.1 Aurora Serverless v2 configuration

- Engine: **Aurora PostgreSQL**. **Pin the major version explicitly, and pin the local Docker image
  to the same major** (§7.1). Aurora lags community PostgreSQL by a release or two, so
  `postgres:latest` locally will not match. Check
  `aws rds describe-db-engine-versions --engine aurora-postgresql --region ap-southeast-2` and use
  the highest available major in both places. **Treat the two as a coupled pair** — bumping one
  without the other silently reintroduces the drift that using real Postgres locally was meant to
  eliminate.
- **`serverlessV2MinCapacity: 0`** with auto-pause enabled, **`serverlessV2MaxCapacity: 1`** (2 for
  prod if you want headroom). Max capacity is a cost ceiling as much as a performance one.
- **Auto-pause window: 1 hour**, not the 5-minute minimum. See the cold-resume discussion below.
- **Data API enabled** (`enableDataApi: true`). This is load-bearing, not optional.
- **Block 0 (§13) verifies that min-0 plus Data API actually pauses, and how it resumes.** The cost
  model and the no-VPC decision both rest on this combination behaving as described. Treat the
  numbers below as assumptions until the spike replaces them with measurements.
- Storage encrypted at rest with the AWS-managed `aws/rds` key — **must be set at creation**;
  adding it later requires a snapshot-and-restore. (A customer-managed KMS key costs ~$1/mo and
  buys nothing here.)
- `deletionProtection: true` on prod. PITR/automated backups at 7 days (dev) / 14 days (prod).
- Single writer instance, no reader. No Multi-AZ for dev; prod can stay single-AZ at hobby scale —
  Aurora storage is already replicated across three AZs.

**The cluster lives in a VPC. The Lambdas do not.** DataStack creates a minimal VPC with *isolated*
subnets only — **no NAT Gateway, no internet gateway, no interface endpoints**. A VPC with no egress
components is free. The Lambdas reach the database through the Data API's public HTTPS endpoint,
authorised by IAM. This is the single structural difference from a conventional RDS setup and the
reason the cost target survives.

**Cold resume.** A paused cluster takes roughly 10–15 seconds to resume — *expected*, pending the
block 0 measurement. Consequences:

- The first API call of a session (almost always login) pays it.
- Set **Lambda timeouts to at least 30s** on any function that touches the database, or resumes
  will surface as spurious errors in the DLQ.
- By the time a user starts a battle the cluster is warm, and the 8-second ticks keep it warm for
  the battle's duration. The 1-hour auto-pause window means a whole play session stays warm; the
  ACU-seconds cost of that idle hour is a few cents at most.
- Do **not** add a "warmer" ping on a schedule. That defeats scale-to-zero entirely.

### 2.2 PostgreSQL schema

Ported directly from the existing Mongo model in `server/src/models/types.ts`. IDs stay `text` to
preserve the current `generateId()` values and avoid a gratuitous change.

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
    -- NULL owner = competition is open for claim (matches current `owner: string | null`)
    owner_id   text        REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE competition_members (
    competition_id text        NOT NULL REFERENCES competitions (id) ON DELETE CASCADE,
    user_id        text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    joined_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (competition_id, user_id)
);
-- Dashboard: "all competitions for a user"
CREATE INDEX competition_members_user_idx ON competition_members (user_id);

CREATE TABLE competition_files (
    id             text PRIMARY KEY,
    competition_id text        NOT NULL REFERENCES competitions (id) ON DELETE CASCADE,
    uploader_id    text        NOT NULL REFERENCES users (id),
    name           text        NOT NULL,
    s3_key         text        NOT NULL,
    -- Final average, written once at battle completion. NULL until then.
    rating         numeric(3, 2),
    uploaded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX competition_files_competition_idx ON competition_files (competition_id);

CREATE TABLE battles (
    competition_id    text PRIMARY KEY REFERENCES competitions (id) ON DELETE CASCADE,
    status            text        NOT NULL CHECK (status IN ('active', 'complete')),
    shuffled_file_ids text[]      NOT NULL,
    current_index     int         NOT NULL DEFAULT 0,
    entry_started_at  timestamptz NOT NULL,
    entry_duration_ms int         NOT NULL DEFAULT 8000
);

CREATE TABLE votes (
    competition_id text        NOT NULL REFERENCES competitions (id) ON DELETE CASCADE,
    file_id        text        NOT NULL REFERENCES competition_files (id) ON DELETE CASCADE,
    user_id        text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    rating         smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (competition_id, file_id, user_id)
);
```

Note the absence of a `battle` column on `competitions`: battle state is a separate row, absent
until a battle starts. "Uploads allowed" is therefore `NOT EXISTS (SELECT 1 FROM battles WHERE
competition_id = $1)`, which is exactly the current `battle.status NOT IN ('active','complete')`
guard in `CompetitionService`.

### 2.3 The three constraints that the DynamoDB design got wrong

**Mutable votes.** Users can change a vote — `VoteService.setVote` is an upsert today, and the
client restores `myVote` on refresh precisely because re-voting is supported. The original
"conditional write + atomic `ADD` on a running total" broke both. In SQL:

```sql
INSERT INTO votes (competition_id, file_id, user_id, rating)
VALUES ($1, $2, $3, $4)
ON CONFLICT (competition_id, file_id, user_id)
DO UPDATE SET rating = EXCLUDED.rating, updated_at = now();
```

Averages are computed on demand — no running totals, no delta arithmetic, no drift:

```sql
SELECT file_id, AVG(rating)::numeric(3,2) AS avg_rating
FROM votes WHERE competition_id = $1 GROUP BY file_id;
```

**Username *and* email uniqueness.** Both are enforced today by unique Mongo indexes; the DynamoDB
design provided a sentinel item for username only, and proposed a GSI for email — but a GSI cannot
enforce uniqueness. Two `UNIQUE` constraints handle it. Note also that **login is by username, not
email** (`UserService.login`), which the "GSI1 = email lookup for auth" design got wrong; here both
are just indexed columns.

**Per-user entry limit (3).** Today this is one atomic Mongo `$expr` conditional update combining
the count check and the battle-status guard. In Postgres, one transaction:

```sql
BEGIN;
  -- Serialises concurrent uploads for this competition
  SELECT 1 FROM competitions WHERE id = $1 FOR UPDATE;

  -- Both guards, evaluated inside the lock
  SELECT
    (SELECT count(*) FROM competition_files
      WHERE competition_id = $1 AND uploader_id = $2) AS user_file_count,
    EXISTS (SELECT 1 FROM battles WHERE competition_id = $1) AS battle_started;

  -- App code raises ValidationError on either guard, else:
  INSERT INTO competition_files (...) VALUES (...);
COMMIT;
```

Via the Data API this is `BeginTransaction` → `ExecuteStatement`(×n, passing `transactionId`) →
`CommitTransaction`. More ceremony than a local `pg` transaction; wrap it in a helper once.

### 2.4 DynamoDB `meme-state`

One on-demand table, TTL attribute `expiresAt`, **no Streams needed**.

| Entity | PK | SK | Notes |
|---|---|---|---|
| Connection (by id) | `CONN#<connId>` | `META` | userId, username, competitionId; TTL 24h as a leak backstop |
| Connection (by competition, for fanout) | `COMP#<compId>` | `CONN#<connId>` | Query `begins_with(SK, 'CONN#')` to fan out; TTL 24h |
| Chat message | `CHAT#<compId>` | `<ulid>` | TTL 1h. Read with `Limit=50, ScanIndexForward=false` |
| Idempotency (Powertools) | Powertools-managed | — | Own TTL attribute — **set it, or the table grows forever** |

Presence is **derived from connection rows**, not stored separately. There is no `PRES#` entity and
no Streams consumer.

### 2.5 Battle ticks and presence via SQS delay queues

Two standard SQS queues, each with a DLQ (14-day retention) and a Lambda event source mapping.

**`battle-ticks` queue.** When a round starts or advances, enqueue
`{ competitionId, expectedIndex }` with `DelaySeconds: 8`. The `advanceBattle` Lambda:

1. `UPDATE battles SET current_index = current_index + 1, entry_started_at = now()
   WHERE competition_id = $1 AND current_index = $2 AND status = 'active'` — the `current_index`
   predicate makes it idempotent and makes stale ticks no-ops.
2. If zero rows updated → the battle was deleted, completed, or already advanced. Return. **No
   cleanup required** — this is why the delay queue beats one-shot schedules: there is nothing to
   delete when a competition is removed.
3. If the new index is past the end of `shuffled_file_ids` → write final averages into
   `competition_files.rating`, set `status = 'complete'`, broadcast `BATTLE_COMPLETE`.
4. Otherwise broadcast `ENTRY_ADVANCE` and enqueue the next tick.

**`presence-leave` queue.** Preserves today's 3-second leave debounce (which exists so a page
refresh doesn't produce a spurious "X has left" / "X has entered" pair in chat). On `$disconnect`,
delete the connection rows and enqueue `{ competitionId, userId, username }` with
`DelaySeconds: 3`. The `presenceLeave` Lambda re-queries `COMP#<compId>` for any remaining
connection with that `userId`; if one exists the user reconnected or has another tab open — drop
the message. Otherwise broadcast `USER_LEFT`.

> **Rejected alternative: EventBridge Scheduler.** The original plan used one-shot schedules for the
> 8s tick. Its practical delivery granularity and jitter are a poor fit for sub-minute precision, it
> required creating and deleting a schedule every 8 seconds per battle against a regional quota, it
> made `ActionAfterCompletion: DELETE` a footgun, and it needed explicit `DeleteSchedule` cleanup
> when a competition was deleted (which the original omitted). It also cannot express a 3-second
> presence debounce at all.

> **Idle SQS polling cost.** A Lambda event source mapping long-polls continuously even when the
> queue is empty — roughly 650k `ReceiveMessage` requests/month per queue. Two queues is ~1.3M/mo,
> just over the 1M free tier, so budget ~$0.30–0.50/mo. If that bothers you, merge both into one
> `meme-timers` queue with a message-type discriminator and halve it.

---

## 3. Backend Rearchitecture

### 3.1 Lambda runtime and Express adapter

- **AWS Lambda Web Adapter (LWA)** as a layer, **Node 22.x**, ARM64. The existing Express app runs
  unmodified locally *and* in Lambda — zero adapter-library imports in code.
- **LWA runs your real HTTP server.** `server.ts` must keep calling `.listen()`. Set
  `AWS_LWA_PORT` (default 8080) and `AWS_LWA_READINESS_CHECK_PATH=/api/health`.
  *(The original plan said to "split app construction from `.listen()`" — that describes
  `@vendia/serverless-express` and is exactly wrong for LWA.)*
- What `server.ts` actually loses: `connectDb`, `createIndexes`, and `battleManager.rehydrate()`.
  Rehydration is obsolete — in-flight ticks now live in SQS, not in process memory.
- Set `AWS_LWA_ENABLE_COMPRESSION` off and confirm `Set-Cookie` passes through correctly (see §5).
- CDK construct: `aws-cdk-lib/aws-lambda-nodejs.NodejsFunction` with esbuild bundling.

**`@node-rs/argon2` is a native N-API module and will not bundle with plain esbuild.** Use **Docker
bundling**: `bundling: { nodeModules: ['@node-rs/argon2'], forceDockerBundling: true }`.

This was previously an open choice against a pure-WASM alternative, on the grounds that Docker was
an unwanted dependency on Windows. It no longer is — §7.1 makes Docker a hard requirement of the
dev loop regardless (Postgres and DynamoDB Local), so Docker bundling now costs nothing marginal
and keeps local and Lambda code byte-identical. **Decision made; don't revisit it.**

**Memory sizing.** Argon2 is deliberately memory-hard and single-threaded. At 128MB (~0.08 vCPU) a
login takes *seconds*. Give the HTTP API Lambda **1024MB**. It's still a rounding error on cost,
and higher memory means proportionally more CPU, so wall-clock cost often *drops*.

### 3.2 WebSocket API: routes and the client protocol

Set the API's **`routeSelectionExpression` to `$request.body.type`**, not the default
`$request.body.action`. The existing client already sends `{ type: 'SUBSCRIBE' | 'VOTE' | 'CHAT' }`
(`app/src/composables/useBattleSocket.ts`); matching the route key to it avoids rewriting the wire
protocol on both sides.

| Route | Handler | Responsibility |
|---|---|---|
| `$connect` | `wsConnect` | Verify JWT cookie from upgrade headers; write `CONN#<id>/META` |
| `$disconnect` | `wsDisconnect` | Delete both connection rows; enqueue presence-leave. Must be idempotent |
| `SUBSCRIBE` | `wsSubscribe` | Check membership in Postgres; write `COMP#<id>/CONN#<id>`; send `PRESENCE_STATE`, chat history, and `BATTLE_STATE` |
| `VOTE` | `wsVote` | Validate + upsert vote; reply `VOTE_ACK` / `VOTE_REJECTED` |
| `CHAT` | `wsChat` | Rate-limit, append to chat store, fan out |
| `$default` | `wsDefault` | `ping` → `pong`; anything else → `ERROR` |

**Per-connection state moves to the connection row.** Today `ws.competitionId` and `ws.lastChatAt`
live on the socket object. In the split-Lambda model both must be attributes on `CONN#<id>/META`,
re-read on every message. The chat rate limit (`lastChatAt`, 1s) becomes a conditional update on
that row. This is a real refactor, not a mechanical port.

**Fanout.** Query `PK = COMP#<compId>`, `begins_with(SK, 'CONN#')`, then
`ApiGatewayManagementApi.postToConnection` per connection. A `410 GoneException` means the
connection is dead: delete both rows. Both `$disconnect` and the 410 path must be safe to run twice.

### 3.3 Connection keepalive **and reconnection**

API Gateway closes WebSocket connections after **10 minutes of inactivity** (hard platform limit).
During active battles the 8-second ticks are a natural keepalive; in a quiet lobby they are not.
Add a client-side `{ type: 'ping' }` every **5 minutes** in `useBattleSocket.ts` when no server
message has arrived recently; `$default` replies `pong`.

**`useBattleSocket.ts` has no reconnection logic at all**, and this is the most likely production
bug in the plan. [`ws.onclose`](app/src/composables/useBattleSocket.ts:223) sets
`connected.value = false` and stops. Against `localhost` a socket essentially never drops, so this
has never mattered; in production connections drop routinely — the 10-minute idle timeout, any
network blip, every deploy that replaces the Lambda. Today's behaviour on a drop is that the user
is silently disconnected mid-battle with no indication and no recovery until they navigate away
and back.

A keepalive ping without a reconnect path makes this **worse**, not better: it keeps a half-open
socket looking healthy indefinitely. Required client-side changes:

1. **Pong deadline.** After sending a ping, expect a `pong` within ~10s. On timeout, treat the
   socket as dead and close it explicitly.
2. **Reconnect with exponential backoff and jitter** — ~1s initial, capped around 30s, and stop
   after the component unmounts.
3. **Re-`SUBSCRIBE` on reopen.** `handleSubscribe` already re-sends `PRESENCE_STATE`, chat history,
   and `BATTLE_STATE`, so state recovery is automatic once the subscribe lands.
4. **Surface the state in the UI.** `connected` is already exposed; a "reconnecting…" indicator
   during an active battle is the difference between a visible hiccup and an app that looks broken.

Server-side changes: none. This is entirely a client gap.

*(There is no 10-second presence heartbeat. The original plan specified both a 10s heartbeat and a
5-minute keepalive ping, which contradicted each other. Presence is driven by `$disconnect`, so
neither is needed for correctness and only the cheap 5-minute ping remains.)*

### 3.4 Interface extraction — one implementation of everything

Inside `server/src/services/BattleManager.ts`, extract four seams. **Every one has a single
implementation**, run locally against a local endpoint:

| Seam | Implementation | How local differs |
|---|---|---|
| `ConnectionRegistry` — `add / remove / listByCompetition / listByUser` | DynamoDB | `DDB_ENDPOINT` → DynamoDB Local |
| `ChatStore` — `append / recent(limit)` | DynamoDB | Same endpoint switch |
| `TimerScheduler` — `scheduleOnce(delaySeconds, payload)` | SQS | Real dev-account queue + a local poller |
| `WsTransport` — `send(connId, msg) / broadcast(competitionId, msg)` | `ApiGatewayManagementApiClient` | `WS_CALLBACK_URL` → a local `@connections` shim |

The seams exist for **encapsulation and testability, not polymorphism** — they keep DynamoDB key
construction and SQS message shapes out of the business logic, and give unit tests something to
stub. **None of them is a local/production switch.** If local behaviour needs to differ, that is a
configuration problem (endpoint, table name), not an implementation problem.

`STATE_BACKEND=memory|aws` does not exist. What remains is endpoint configuration — `DDB_ENDPOINT`,
`SQS_QUEUE_URL`, `WS_CALLBACK_URL` — which the AWS SDK clients already accept.

**The local `@connections` shim.** `ApiGatewayManagementApiClient` is an ordinary AWS SDK client
that accepts an `endpoint`, and `postToConnection` is just `POST /@connections/{connectionId}`
(`deleteConnection` is `DELETE` on the same path). So run a small local HTTP server — roughly fifty
lines — implementing those two routes and forwarding to in-process `ws` sockets, and point the
**real, unmodified** `ApiGwWsTransport` at it with `WS_CALLBACK_URL=http://localhost:3002`. It can
ignore SigV4.

Two properties make this worth doing over a hand-written local transport:

- **The shim must return `410 Gone` for a closed socket.** That exercises the production
  dead-connection cleanup path (§3.2) locally, which no local transport implementation would.
- It is the same trick as `DDB_ENDPOINT` — configuration rather than reimplementation — which is
  why there is now **no local implementation of anything** in the system.

**The WebSocket entry layer shares a core, structurally.** `battleWs.ts` should construct real
`APIGatewayProxyWebsocketEventV2` objects from incoming `ws` messages and invoke the **actual
handler exports** used by Lambda. That makes it a pure event-shape adapter rather than a parallel
dispatch path, exercises the `$connect`/`$disconnect` contract locally, and turns "both entry
points must call the same handler bodies" from a convention someone has to remember into something
the code enforces.

There is no `PresenceTracker` interface — presence is a derived query over `ConnectionRegistry`
plus a `TimerScheduler` message, not its own subsystem. Decisions like "is this the user's last
connection in this room?" belong in shared code operating on a returned list, never inside a seam
implementation.

### 3.5 Repository layer and the two database drivers

Local dev runs Postgres in Docker over TCP; Lambda uses the Data API over HTTPS. To avoid drift,
put both behind one repository layer and one schema definition:

- **Use Drizzle** — `drizzle-orm/node-postgres` locally and `drizzle-orm/aws-data-api/pg` in Lambda.
  Same schema definition, same migrations, driver chosen by `DB_DRIVER=pg|data-api`. Kysely has
  equivalent dialects and would also work; Drizzle wins on first-party migration tooling
  (`drizzle-kit`) and a better-documented Data API driver. **Verify the current state of both Data
  API drivers before committing** — this is the one decision here worth ten minutes of checking,
  because it is expensive to reverse once the repository layer is written.
- Raw `pg` + hand-written SQL also works but means maintaining two execution paths by hand.
- **Parameterised queries only.** SQL injection is a live threat class here that did not exist with
  the DynamoDB DocumentClient. Add an ESLint rule banning template-literal SQL.
- **Migrations need a down path.** §10.3 mandates expand-then-contract, which limits how often
  rollback is needed, but "we never wrote one" is not a rollback story. Every migration gets a
  reversal, and `db:rollback` is a first-class script alongside `db:migrate`.

Data API constraints to design around: ~10–20ms per-call overhead, result-set size limits (paginate
anything unbounded), and **no `LISTEN`/`NOTIFY`** — WebSocket fanout goes through
`postToConnection`, never through Postgres notifications.

### 3.6 Image uploads → presigned S3 PUT

1. `POST /api/uploads/sign` → Lambda returns a presigned URL (5-min expiry) with `ChecksumSHA256`
   and a content-length constraint
2. Browser `PUT`s directly to S3
3. S3 → EventBridge → `validateMeme` Lambda: magic-byte check, `CopyObject` to the served prefix on
   success, `DeleteObject` on failure, `INSERT INTO competition_files`, push via WS
4. Client receives the WS push (or polls) for completion

**Accepted formats: JPEG, PNG, GIF, WebP, BMP. SVG is not supported** — see §5.

Gotchas:

- Bucket policy condition `NumericLessThan: { s3:content-length: 1048576 }` caps abuse of signed
  URLs. **Keep the existing 1MB limit** — the current UI says "File size exceeds 1MB limit"
  (`server/server.ts`). The original plan silently raised it to 5MB; if you want that, change the
  message too, deliberately.
- S3 CORS for `PUT` from the frontend origin only.
- Memes are served via CloudFront `/cdn/<key>`; the bucket stays private behind OAC. `getFileUrl`
  in `server/src/utils/s3-client.ts` must return the `/cdn/` path, **not** the direct bucket URL it
  returns today.
- The per-user entry limit must be re-checked in `validateMeme` (§2.3), not only at presign time —
  a client could request several signed URLs before uploading any.
- Set `Content-Type` from the *validated* magic bytes when copying to the served prefix, not from
  the client-supplied value.

**Locally, the EventBridge trigger cannot fire into your laptop.** If the browser PUTs to the dev
bucket and the deployed `validateMeme` Lambda handles the event, it writes to *dev Aurora* while
your local server is on Docker Postgres — the row lands in the wrong database. Resolve it without
introducing a third upload path:

- The local server signs URLs for a **dev bucket prefix with event notifications disabled**
  (`local/<devUser>/…`).
- The client calls back to the local server on PUT completion.
- That callback invokes the **same** `validateMeme` handler function in-process, against local
  Postgres.

Everything except the EventBridge trigger itself is then genuinely shared code. Do **not** keep the
Multer path alive for local development — that would be a third implementation of uploads existing
nowhere in production, and the worst available option.

---

## 4. Frontend Deployment

> **No custom domain is required to build or validate any of this.** A CloudFront distribution
> comes with a working `https://d….cloudfront.net` name and an AWS-provided certificate. Because
> the whole design routes through **one** distribution, the same-origin cookie story, the absence
> of CORS, and all four path behaviours work identically on the default name. **`CertStack`,
> Route 53, and the ACM certificate are therefore optional and deferrable**, and the dev account
> never needs a domain at all.
>
> A custom domain buys a stable, memorable URL and nothing else architecturally. Register one when
> convenient (Route 53 domain registration is the least fiddly path since it creates the hosted zone
> and handles ACM DNS validation records for you), then add `CertStack` + the Route 53 alias as a
> small, self-contained change. Until then, treat `app.example.com` throughout this document as
> "whatever the distribution's domain name is". Note the ACM certificate must still be in
> **us-east-1** when you do add it, even though everything else is in ap-southeast-2.

- **S3 bucket** `meme-frontend-{stage}`, private, OAC policy granting `s3:GetObject` only to the
  CloudFront distribution
- **Single CloudFront distribution** with behaviours:
  - `/` default → S3 frontend bucket (OAC)
  - `/api/*` → HTTP API origin (cache disabled, `AllViewerExceptHostHeader` origin request policy)
  - `/ws` → WebSocket API origin (cache disabled). **Needs an origin request policy forwarding
    `Cookie` and the `Sec-WebSocket-*` headers** — `$connect` authentication depends on the cookie
    arriving — plus an origin path mapping `/ws` onto the WebSocket API's stage
  - `/cdn/*` → S3 memes bucket (OAC)
- **SPA fallback**: CloudFront Function on viewer-request rewriting any extension-less path to
  `/index.html`. Do **not** use the `customErrorResponses` 404→200 trick (pollutes error metrics).
- **Cache policies**: `/assets/*` (Vite-hashed) → `CachingOptimized` (1yr immutable).
  `/index.html` → `CachingDisabled` or 60s TTL.
- **ACM cert in us-east-1** for `app.example.com`; Route 53 alias A/AAAA → distribution.
- **Build-time env** via GH Actions: `VITE_API_BASE=/api`, `VITE_WS_URL=wss://app.example.com`.
  Same-origin URLs → zero CORS.
  - `useBattleSocket.ts` **already appends `/ws`** to `VITE_WS_URL`, so the value must not include
    it. (The original plan got this backwards.)
  - `app/src/api/client.ts` currently **hardcodes** `http://localhost:3000/api`. There is no env var
    to wire — one has to be introduced. This is a code change, not config.

---

## 5. Security

- **VPC**: the Aurora cluster sits in isolated subnets with no NAT and no internet gateway.
  **Lambdas stay outside the VPC entirely** and reach the database through the Data API's IAM-
  authorised HTTPS endpoint. Putting Lambdas in the VPC would require a NAT Gateway (~$32/mo) or
  4–6 interface endpoints (~$7–8/mo each) to reach `execute-api`, SQS, SSM, SES, and CloudWatch —
  for no security benefit here.
- **Database network posture**: `publiclyAccessible: false`, security group with no ingress from
  anywhere except (if you ever add one) a bastion. **Never enable public accessibility for local
  dev convenience** — this is the single most common serious mistake in this migration. Local dev
  uses Docker Postgres instead (§7).
- **Database credentials**: the Data API takes a **Secrets Manager** secret ARN; the Lambda's IAM
  role gets `rds-data:*` on the cluster ARN plus `secretsmanager:GetSecretValue` on that one secret.
  No password ever reaches application code or a Lambda env var. Enable rotation if you like — it's
  free to schedule and the Data API picks up the new value transparently.
- **Loss of per-Lambda data scoping — accept knowingly.** With DynamoDB you could scope `wsConnect`
  to connection rows only. With one Postgres role, every Lambda holding the Data API permission can
  read every table. Restoring that property means per-function Postgres roles and `GRANT`s. At this
  scale, one app role is the right call — but it is a property the all-DynamoDB design had and this
  one drops, so record it rather than discover it later.
- **SQL injection**: see §3.5. Parameterised statements only.
- **No floating promises in handlers.** Lambda freezes the execution environment the instant a
  handler resolves. An un-awaited `postToConnection` — a fire-and-forget fanout in `wsChat`, say —
  delivers every time locally and **silently vanishes in production**, then resumes mid-flight on
  the next invocation of that container. This class of bug is invisible to the local loop by
  construction, so it has to be caught statically: enable
  `@typescript-eslint/no-floating-promises` (requires type-aware linting) for `server/`, and make
  "does this handler await its entire fanout?" a review question.
- **TLS**: the Data API is plain HTTPS, so there's no `sslmode` to get wrong in Lambda. For local
  Docker Postgres it doesn't matter. If you ever add a direct-connection path, enforce
  `rds.force_ssl=1` and `sslmode=verify-full` with the RDS CA bundle — never
  `rejectUnauthorized: false`.
- **IAM**: one role per Lambda (CDK `NodejsFunction` default). Least privilege per action — e.g.
  `wsConnect` writes only connection rows; `advanceBattle` holds `execute-api:ManageConnections` on
  the WS API ARN.
- **App secrets**: SSM Parameter Store paths `/meme/{stage}/{name}`. Fetch at cold start with the
  **Lambda Powertools Parameters** utility (caches in module scope). Never Lambda env vars for
  secrets.
- **Cookies**: the single-CloudFront-distribution design means the JWT cookie is plain
  `HttpOnly; Secure; SameSite=Lax; Path=/` on `app.example.com`. No `SameSite=None`, no cross-site
  cookies, no CORS preflights.
- **The `Secure` flag must default on.** [`AuthController.setJWTCookie`](server/src/controllers/AuthController.ts:9)
  currently sets `secure: process.env.NODE_ENV === "production"`. **Lambda does not set
  `NODE_ENV`**, so as written this evaluates `false` in production and the JWT cookie ships without
  `Secure`. Invert it to fail-secure:
  ```typescript
  secure: process.env.NODE_ENV !== "development",
  ```
  Unset environment now yields the safe value. (`localhost` is a trustworthy origin in Chrome and
  Firefox, so `Secure` cookies work over plain HTTP locally anyway; the explicit dev opt-out just
  removes any doubt about other browsers.)

  The identical fail-open pattern appears at [`s3-client.ts:27`](server/src/utils/s3-client.ts:27),
  where an unset `NODE_ENV` selects the dev branch and its hardcoded `"test"` credentials. That
  file is deleted in block E so it resolves itself — but **audit for the pattern rather than the
  two known instances**, and prefer `STAGE` (already a Lambda env var, §9) over `NODE_ENV` for any
  new environment branching.
- **Password policy**: minimum length **8**, enforced in
  [`validatePassword`](server/src/utils/password.ts:12) (currently 4) with the error message
  updated to match, and mirrored client-side in `Login.vue` for UX. The database starts empty, so
  there are no legacy hashes to grandfather. Deliberately kept to a length rule — no composition
  requirements, no breach-list check — on the grounds that this is a hobby app going public, not a
  credential store worth attacking.

### 5.1 SVG support is removed

`middleware/file.ts` currently allows `image/svg+xml`, and `utils/file-validation.ts` accepts any
buffer whose first 100 bytes contain `<svg`. Under the single-distribution design, `/cdn/*` is
served from `app.example.com` — the **same origin as the app**. An uploaded SVG containing an
inline `<script>` would therefore execute with full same-origin access and could call `/api/*` with
the victim's HttpOnly cookie automatically attached. That is stored XSS with session-riding, not a
theoretical concern.

**Decision: drop SVG.** Remove `image/svg+xml` from `ALLOWED_IMAGE_MIME_TYPES` and delete the
`<svg` branch from `validateImageFile`. Accepted formats become JPEG, PNG, GIF, WebP, and BMP — all
of which are validated by true binary magic bytes rather than a substring search, so the validator
also gets strictly harder to fool.

Consequences to handle:

- The frontend uploader's `accept` attribute and any user-facing copy listing supported formats
  must be updated to match.
- The `<svg` substring check was the only reason `validateImageFile` inspected file *text*. With it
  gone, the function is purely a magic-byte comparison — simpler and with no encoding edge cases.
- If SVG is ever reinstated, it needs **both** a real XML-parsing sanitiser (not a substring check)
  **and** a CloudFront response-headers policy on `/cdn/*` setting
  `Content-Security-Policy: default-src 'none'; sandbox` plus `Content-Disposition: attachment`.
  Do not reinstate it with only one of those.

Other security items:

- **Throttling**: HTTP API v2 per-route stage throttling, WS stage throttling per connection. This
  is a **cost and volumetric control** (§11.1), not an authentication defence — see the next bullet.
- **Idempotency**: every async handler uses Powertools `@idempotent` against the `meme-state`
  table. Essential for `advanceBattle` (`competitionId#index`), `validateMeme` (S3 object version
  id), and `$disconnect` cleanup.
- **WAF and login rate limiting: both deliberately out of scope.** Neither is built now; both are
  responses to abuse that has not happened. Recorded here so the reasoning survives:
  - **API Gateway stage throttling is not a substitute.** It is per-stage/per-route, not per-IP, so
    it stops volumetric floods and does nothing against someone slowly grinding one account. Do not
    mistake §11.1 for brute-force protection.
  - **`express-rate-limit` with its default memory store would not work** if reached for in a
    hurry. Each concurrent Lambda has its own memory and containers recycle, so the counter is
    meaningless. Any real implementation needs shared state.
  - **If abuse materialises**, the two viable responses are AWS WAF rate-based rules on the
    distribution (~$5/mo base + $1/rule — the proper answer, and a large fraction of the §12
    budget), or application-level throttling in Express backed by the existing `meme-state` table
    (atomic `ADD` on `RATE#IP#<ip>` / `RATE#USER#<name>` items with TTL). If choosing the latter:
    limit **both** dimensions, count **failures only**, and **throttle rather than lock accounts** —
    account lockout lets anyone deny service to any user by spamming failures at their username.
    Note that obtaining a trustworthy client IP behind CloudFront requires forwarding
    `CloudFront-Viewer-Address` via a custom origin request policy; raw `X-Forwarded-For` is
    client-spoofable.
  - The same mechanism would cover registration spam on `/api/auth/register`.

---

## 6. IaC — CDK v2 in TypeScript

### Account structure (AWS Organizations)

```
Management account  (existing account — billing only, no workloads)
├── meme-dev        (member account — all dev CDK deployments)
└── meme-prod       (member account — all prod CDK deployments)
```

**One-time setup, in order.** Steps 1–3 are irreducibly manual (console + email verification);
steps 4–6 are scripted or codified.

0. **Secure the management account root user before anything else** — hardware or virtual MFA
   enabled, no root access keys, and a password manager entry. Everything below inherits from this
   account; a compromised root is the one AWS failure with no recovery path and no blast-radius
   limit.
1. Enable **AWS Organizations** in the existing account (it becomes the management account). Free.
2. Create two member accounts (`meme-dev`, `meme-prod`) with their own root emails
   (e.g. `yourname+aws-meme-dev@gmail.com`). Enable **Consolidated Billing**.
2a. **Deal with the member accounts' root users.** Organizations creates each member account with a
   root user and no password set — an unsecured credential attached to an email address you
   control. Two options, best first:
   - **Centralised root access management** (Organizations feature): removes root credentials from
     member accounts entirely, so there is no root user to secure. Preferred — it eliminates the
     problem rather than guarding it. Verify availability in your Organization.
   - Otherwise: recover each member account's root password via the sign-in page's password-reset
     flow, enable **MFA**, confirm **no root access keys** exist, then never use root again. Day-to-day
     access is via IAM Identity Center (step 3).
3. Enable **IAM Identity Center** in the management account. Account-level opt-in, console only.
   Once enabled, the *permission sets* can be codified (`aws-cdk-lib/aws-sso.CfnPermissionSet`) if
   you want them under version control.
4. **CDK bootstrap** each member account: `cdk bootstrap aws://ACCOUNT_ID/REGION --profile meme-dev`
   (and `meme-prod`).
5. **Deploy the OIDC bootstrap stack** to each account — see §10.1. One local `cdk deploy` per
   account, from an SSO admin session.
6. **Verify the alarm recipient address in SES**, in each account. New SES accounts are in
   **sandbox mode** and can only send to *verified* addresses — the alarm pipeline in §8 will
   deploy cleanly and then silently deliver nothing. One console click plus a confirmation email
   per account. (Full production access is only needed if you ever email users, which this app
   does not.)
7. Set an **AWS Budget** on each member account (§11) — deployed by `ObservabilityStack`.
8. *(Deferrable — see §4.)* Register a domain and create the Route 53 hosted zone in `meme-prod`
   only. Not required to build, deploy, or validate anything.

> ⚠️ **Free-tier caveat.** Free tier benefits are shared across an AWS Organization under
> consolidated billing, not granted per member account — and newer accounts fall under AWS's
> credit-based free plan rather than the classic 12-month tier. **Do not budget on `meme-dev` and
> `meme-prod` each having their own free tier.** Verify current terms before relying on any
> free-tier line in §12.

**SCPs**: optional org-level guardrails. A useful starter for both member accounts: deny any action
outside your chosen region, so nothing is accidentally created in us-east-1 (except the ACM cert
stack, which must be — carve out `acm`, `cloudfront`, and `route53` if you apply this).

**Tagging** — complementary to account isolation, not a replacement:

```typescript
Tags.of(app).add('Project', 'meme-competition');
Tags.of(app).add('Environment', props.stage); // 'dev' | 'prod'
```

Enable tag cost allocation in the Billing console once after setup.

**CDK environments** (account IDs are not secrets — security comes from IAM, not obscurity):

```typescript
// infra/bin/app.ts
const devEnv  = { account: '111111111111', region: 'ap-southeast-2' };
const prodEnv = { account: '222222222222', region: 'ap-southeast-2' };

new AppStack(app, 'meme-app-dev',  { env: devEnv,  stage: 'dev'  });
new AppStack(app, 'meme-app-prod', { env: prodEnv, stage: 'prod' });
```

### Stack layout

**`infra/bootstrap/` — a separate CDK app, deployed only from a laptop:**

- **GitHubOidcStack** — OIDC identity provider + the GitHub Actions deploy role (§10.1)

**`infra/` — the main app, deployed by CI:**

- **CertStack** — ACM cert, **us-east-1** (cross-region; `crossRegionReferences: true`)
- **DataStack** — isolated-subnet VPC (no NAT/IGW), Aurora Serverless v2 cluster + Data API +
  Secrets Manager secret, DynamoDB `meme-state` table, SQS queues + DLQs, S3 buckets (frontend,
  memes), SSM parameters
- **AppStack** — HTTP API, WebSocket API, Lambdas, CloudFront distribution, Route 53 records
- **ObservabilityStack** — alarms, SNS topic, dashboard, log-retention policies, AWS Budget,
  kill-switch Lambda, Cost Anomaly Detection monitor

> **The separation is a security boundary, not just tidiness.** If CI could deploy the stack that
> defines CI's own IAM role, a merged pull request could widen its own trust policy or attach
> `AdministratorAccess` to itself. Keeping `infra/bootstrap/` as a distinct CDK app means
> `cdk deploy --all` in the workflow cannot see it.

### Key CDK constructs

- `aws-cdk-lib/aws-rds.DatabaseCluster` with `DatabaseClusterEngine.auroraPostgres(...)`,
  `ClusterInstance.serverlessV2('writer')`, `serverlessV2MinCapacity: 0`, `enableDataApi: true`,
  plus the auto-pause duration property — **check the property name against the `aws-cdk-lib`
  version you pin**, as scale-to-zero support is relatively recent
- `aws-cdk-lib/aws-iam.OpenIdConnectProvider` + `iam.WebIdentityPrincipal` (§10.1)
- `aws-cdk-lib/aws-apigatewayv2.HttpApi` + `HttpLambdaIntegration`
- `aws-cdk-lib/aws-apigatewayv2.WebSocketApi` (with `routeSelectionExpression`) +
  `WebSocketLambdaIntegration` + `WebSocketStage`
- `aws-cdk-lib/aws-lambda-nodejs.NodejsFunction` (esbuild, ARM64, Node 22)
- `aws-cdk-lib/aws-dynamodb.TableV2` (on-demand, TTL attribute)
- `aws-cdk-lib/aws-sqs.Queue` with `deadLetterQueue` + `SqsEventSource`
- `aws-cdk-lib/aws-cloudfront.Distribution` with `S3BucketOrigin.withOriginAccessControl()`

---

## 7. Local Development

**Two tiers.** The fast tier runs real implementations against local containers for sub-second
iteration. The faithful tier deploys to the dev account for the class of behaviour no laptop can
reproduce. Both are required — the fast tier is not sufficient on its own, and §7.2 says exactly why.

The guiding rule is in §3.4: **there is no local implementation of anything.** Every seam runs
production code against a different endpoint. Divergence you can delete is divergence you should
delete.

### 7.1 Tier 1 — the fast loop

| Component | Local | Notes |
|---|---|---|
| Frontend | `vite` on `:3001`, HMR | `VITE_API_BASE=http://localhost:3000/api`, `VITE_WS_URL=ws://localhost:3000` |
| Backend HTTP | `bun --hot server.ts` on `:3000` | The same Express app LWA wraps in prod |
| Postgres | Docker, **pinned to Aurora's major version** (§2.1), `DB_DRIVER=pg` | Not an emulator — the same engine |
| DynamoDB | Docker `amazon/dynamodb-local`, `DDB_ENDPOINT=http://localhost:8000` | AWS's own implementation. Production `ConnectionRegistry` / `ChatStore` code, unmodified |
| SQS | **Real dev-account queue** + a dev-only poller in the local server | Real `DelaySeconds`, real at-least-once redelivery |
| WebSocket transport | Local `@connections` shim on `:3002`, `WS_CALLBACK_URL=http://localhost:3002` | The **real** `ApiGwWsTransport`, unmodified (§3.4) |
| WebSocket entry | `ws` server building `APIGatewayProxyWebsocketEventV2` objects, invoking the real handler exports | Event-shape adapter, not a parallel dispatch path |
| Uploads | Presign against a dev bucket prefix with notifications disabled; client callback invokes `validateMeme` in-process (§3.6) | Shares the handler with production |

**`amazon/dynamodb-local` is not LocalStack.** It is a first-party AWS image, public, with no
signup and no API key — none of the objections in §7.2 to LocalStack apply to it. It handles
conditional writes, `begins_with` queries, transactions, and TTL faithfully, which is the whole of
what `meme-state` needs.

**Using real SQS rather than an emulator is deliberate.** It is free at development volume, and it
means the local loop exercises genuine at-least-once delivery — so idempotency bugs in
`advanceBattle` and `presenceLeave` surface on your laptop rather than in production. The dev-only
poller consumes the queue and dispatches to the same in-process handler the Lambda calls.

Add jitter and fanout reordering **inside the `@connections` shim**, not in application code.
Ordering is the one property a single-process `ws` server preserves for free and API Gateway does
not; jitter is a two-line way to stop code quietly depending on it. Have the shim **return `410
Gone` for closed sockets** so the production dead-connection cleanup path is exercised locally.

**Setup for a new developer (one-off):**

1. Enable IAM Identity Center access for the developer from the management account
2. `aws configure sso` — writes named profiles into `~/.aws/config`:
   ```ini
   [profile meme-dev]
   sso_start_url  = https://your-sso-url.awsapps.com/start
   sso_account_id = 111111111111
   sso_role_name  = MemeDeveloper
   region         = ap-southeast-2

   [profile meme-prod]
   sso_start_url  = https://your-sso-url.awsapps.com/start
   sso_account_id = 222222222222
   sso_role_name  = MemeReadOnly   # prod is read-only for humans; CI deploys
   region         = ap-southeast-2
   ```
3. Daily: `aws sso login --profile meme-dev` — one browser click, token valid 8 hours
4. `bun install` (root workspace), `docker compose up -d`, `bun run db:migrate`
5. `bun run dev`

`docker-compose.yml` replaces `mongo:8` with two services: version-pinned `postgres` and
`amazon/dynamodb-local`. Docker becomes a hard dependency of the dev loop, not just of the argon2
bundling step (§3.1) — which is what makes the argon2 decision free.

Add a `db:seed` script creating a test user and a competition with a few entries. Without one,
every developer builds the same fixture by hand through the UI on every `docker compose down -v`.

### 7.2 Tier 2 — `cdk watch` against the dev account

`cdk watch meme-app-dev` deploys diffs in ~10s. Run the Vite dev server against the deployed dev
stack (`VITE_API_BASE`/`VITE_WS_URL` pointed at it) to keep frontend HMR while the backend is real.

**This tier is not optional.** The table below is the full enumeration of what tier 1 cannot reach.
Zero drift is not attainable — Lambda's execution model (N concurrent, frozen-and-thawed processes
behind a managed gateway) has no laptop equivalent. The goal is that the residual is *known, small,
and covered here.*

| Gap | Why tier 1 can't reach it | Partial mitigation |
|---|---|---|
| **Concurrency** | One event loop locally vs. N Lambdas | **Largely testable — see §7.3.** Both DynamoDB Local and Docker Postgres enforce conditional writes and `FOR UPDATE` correctly; what's missing is only the parallel *caller*, which tests can supply |
| **IAM correctness** | DynamoDB Local accepts any credentials | CDK template assertions (§7.3) catch most regressions without deploying |
| **Freeze/thaw, 6MB payload cap, module-scope caching** | Lambda runtime semantics | `no-floating-promises` (§5); optionally the RIE tier below |
| **API Gateway WS behaviours** — 10-min idle timeout, route selection, `$connect` header shape, 128KB frame limit | Managed platform | Tier 2 only. (`410 Gone` *is* covered locally by the shim) |
| **CloudFront routing, SPA fallback, cache headers, `/ws` cookie forwarding** | No CloudFront locally | The SPA-fallback CloudFront Function is pure JS — unit test it. The rest is tier 2 |
| **Aurora cold resume, ACU scaling, Data API marshalling** (`numeric` as string, timestamp formats, NULL edges) | Docker Postgres has none of it | Run the local server with `DB_DRIVER=data-api` against the dev cluster **periodically**, not once before go-live |
| **`bun --hot` hides module-scope leaks** | Local reloads constantly; a warm Lambda persists for minutes | Awareness only |

**Optional third tier: the Lambda Runtime Interface Emulator.** Running the built function under
RIE in Docker exercises the real Lambda invoke contract — LWA's `Set-Cookie` handling, payload
shapes, module-scope lifetime. It is fiddlier for zip-based functions than for container images, so
it is not worth standing up for everything. It *is* worth it for the auth path, where a broken
`Set-Cookie` means nobody can log in and the local loop will never tell you.

*Why not LocalStack for any of this:* the free tier does not emulate API Gateway WebSocket (a Pro
feature), and its IAM emulation drifts from production — which is precisely the category of bug
tier 2 exists to catch.

### 7.3 Test tiers beyond unit tests

**Contract tests** — one suite, run against both configurations of each seam that has one:

- The repository layer against `DB_DRIVER=pg` **and** `DB_DRIVER=data-api`
- `ConnectionRegistry` / `ChatStore` against DynamoDB Local **and** real DynamoDB

**Concurrency tests** — the largest remaining drift class, and currently the plan's biggest test
gap. Fire N parallel calls **at the seams and handlers directly**, not through the HTTP server —
the single-process server is what prevents concurrency, not the datastores. Both local datastores
enforce the real primitives, so these genuinely fail when the guard is wrong. Minimum coverage:

- N concurrent `wsChat` calls for one connection → exactly one passes the 1s rate limit
- N concurrent uploads by one user → the 3-entry limit holds (§2.3 `FOR UPDATE`)
- N concurrent `advanceBattle` invocations at the same `expectedIndex` → exactly one advances
- Concurrent `$disconnect` + `SUBSCRIBE` for one user → presence ends in the correct state

**CDK template assertions** — `aws-cdk-lib/assertions` unit tests over the synthesised template,
asserting each Lambda role's policy: `wsConnect` has no write access to application tables,
`advanceBattle`'s `execute-api:ManageConnections` is scoped to the WS API ARN, no role carries a
wildcard resource. This is the only cheap counter to DynamoDB Local's blindness to IAM.

**When a bug is found in any configuration, add a test at the appropriate tier before fixing it.**
That is the process answer to "fixed in one, not the other."

### 7.4 Developer README (to be written)

Add a `README.md` at the repo root. **Keep it short** — it is a runbook, not documentation. Anything
that needs explaining rather than doing belongs in this plan, linked from the README.

It must cover, in this order:

1. **Prerequisites** — Bun, Docker, AWS CLI v2, `gh` CLI
2. **Local setup** — clone, `bun install`, `docker compose up -d`, `bun run db:migrate`,
   `bun run db:seed`, `bun run dev`. Include the URLs the app comes up on and the seeded login
3. **One-time AWS setup** (§6, §10.1) — enable Organizations; create the `meme-dev` and `meme-prod`
   member accounts; enable Consolidated Billing; enable IAM Identity Center; `cdk bootstrap` each
   account; `cdk deploy` the `infra/bootstrap/` OIDC stack in each account; push the resulting role
   ARNs to GitHub with `gh secret set`; **verify the SES alarm recipient in each account**. Mark
   clearly which of these are console-only and which are scripted
4. **Per-developer AWS setup** — `aws configure sso`, the two profiles, the daily
   `aws sso login`
5. **Deploying to dev** — `cdk deploy --all --profile meme-dev`, and `cdk watch` for the tier-2 loop
6. **Deploying to production** — that CI does it on merge to `main`, plus the manual break-glass
   command and when it is appropriate
7. **Adding a custom domain** (deferred, §4) — register, create the hosted zone, deploy `CertStack`
   in us-east-1, add the Route 53 alias. Explicitly note this is optional and that everything works
   on the default CloudFront domain until then
8. **Troubleshooting** — the four things that will actually bite: the ~15s Aurora cold resume, an
   expired SSO token, Docker not running, and a `db:migrate` run against the wrong `DB_DRIVER`

Every command should be copy-pasteable. State explicitly which steps are one-time-per-organisation,
one-time-per-account, one-time-per-developer, and routine.

### 7.5 Dev-account cost

~$2–3/mo — Aurora storage while paused, plus the Secrets Manager secret. Skip the dev Route 53 zone
to save $0.50. The dev SQS queue and S3 usage are effectively free at development volume.

---

## 8. Observability

- **Logging**: `pino` JSON to stdout. CloudWatch Logs Insights for queries.
- **AWS Lambda Powertools (TypeScript)** on every Lambda — `Logger`, `Tracer`
  (`@tracer.captureLambdaHandler()`, X-Ray), `Metrics` (EMF — no extra API call cost)
- **X-Ray** on all Lambdas and the HTTP API stage → full `CloudFront → API GW → Lambda → Aurora/S3`
  traces
- **DLQs** (SQS) on every async-invoked Lambda (`advanceBattle`, `presenceLeave`, `validateMeme`)
  with 14-day retention
- **Alarms** → SNS → SES email. **The recipient address must be verified in SES first** (§6 step 6)
  or nothing is delivered and the failure is silent:
  - Any Lambda `Errors > 0` over 5min
  - Any DLQ `ApproximateNumberOfMessagesVisible > 0`
  - HTTP API `5xx > 1%` over 5min
  - HTTP API `p99 latency > 2s` over 5min — **widen this for the first weeks**, since cold-resume
    will trip it legitimately
  - Aurora `ServerlessDatabaseCapacity` sustained at max ACU over 15min (runaway query detector)
  - Aurora `DatabaseConnections` unexpectedly non-zero for long periods (blocks auto-pause)
- **One CloudWatch dashboard**: API RPS, Lambda duration p50/p99, WS connections, Aurora ACU + query
  latency, DDB consumed capacity, SQS queue depth, S3 4xx/5xx
- **Log retention = 14 days** on every log group (default is forever — silent cost leak)

---

## 9. Environment & Secrets

- **Secrets Manager**: one secret per stage, created by CDK alongside the cluster, holding the
  Aurora master credential. Referenced by ARN in Lambda env; never read into app code directly.
- **SSM paths**: `/meme/{stage}/JWT_SECRET`, `/meme/{stage}/SES_FROM_ADDR` (`stage` ∈ `dev`,
  `prod`). *(The original plan listed an `ARGON2_PEPPER` — `utils/password.ts` uses default
  parameters with no pepper, so that parameter is fictional. Add it only if you add the pepper.)*
- **Lambda env vars** (non-secret only): `STAGE`, `DB_CLUSTER_ARN`, `DB_SECRET_ARN`, `DB_NAME`,
  `DB_DRIVER`, `STATE_TABLE_NAME`, `MEMES_BUCKET`, `WS_CALLBACK_URL`, `BATTLE_QUEUE_URL`,
  `PRESENCE_QUEUE_URL`, `WS_CALLBACK_URL`, `LOG_LEVEL`
- **Local-only env vars**: `DDB_ENDPOINT=http://localhost:8000` (DynamoDB Local), `DATABASE_URL`
  (Docker Postgres), `WS_CALLBACK_URL=http://localhost:3002` (the `@connections` shim). These are
  *endpoint configuration only* — the same client code runs either way, and there is no backend
  switch anywhere in the system (§3.4)
- **Cold-start fetch** via `@aws-lambda-powertools/parameters/ssm` (module-scope cached)
- **Frontend build vars** from GH Actions: `VITE_API_BASE`, `VITE_WS_URL`
- **Local dev**: `.envrc` (direnv) loading `.env.local`, gitignored; never commit AWS keys

---

## 10. CI/CD — GitHub Actions with OIDC (multi-account)

GitHub Actions uses **OIDC federation** to assume IAM roles in each account — no long-lived AWS
keys in GitHub secrets.

### 10.1 OIDC setup — codified in CDK

**Yes, this is automatable.** The OIDC identity provider and the deploy roles are ordinary IAM
resources and are fully expressible in CDK. What cannot be automated away is the *bootstrap
ordering*: the role that lets CI deploy CDK stacks cannot itself be created by CI. Something has to
run once from a laptop with admin credentials.

That is not a real cost, because `cdk bootstrap` is already a mandatory one-time local step per
account (§6 step 4). Deploying one more stack immediately after it adds seconds, and buys a
version-controlled, reviewable, reproducible definition instead of console clicking.

**`infra/bootstrap/lib/github-oidc-stack.ts`:**

```typescript
interface GitHubOidcStackProps extends StackProps {
  readonly githubOrg: string;
  readonly repo: string;
  readonly stage: 'dev' | 'prod';
  /** Pass when the account already has a GitHub OIDC provider — only one is allowed per account. */
  readonly existingProviderArn?: string;
}

export class GitHubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: GitHubOidcStackProps) {
    super(scope, id, props);

    const provider = props.existingProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this, 'GitHubOidc', props.existingProviderArn)
      : new iam.OpenIdConnectProvider(this, 'GitHubOidc', {
          url: 'https://token.actions.githubusercontent.com',
          clientIds: ['sts.amazonaws.com'],
        });

    // dev: any branch may deploy. prod: main only — a PR branch cannot reach prod
    // even if someone edits the workflow file.
    const subject = `repo:${props.githubOrg}/${props.repo}`;
    const conditions: iam.Conditions =
      props.stage === 'prod'
        ? { StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              'token.actions.githubusercontent.com:sub': `${subject}:ref:refs/heads/main`,
          } }
        : { StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
            StringLike:   { 'token.actions.githubusercontent.com:sub': `${subject}:*` } };

    const role = new iam.Role(this, 'GitHubActionsRole', {
      roleName: `gh-actions-meme-${props.stage}`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(
        provider.openIdConnectProviderArn, conditions),
    });

    // The role is a key to the door, nothing more: real permissions live on the
    // CDK bootstrap roles, which are scoped to CloudFormation.
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
    }));

    // Plus what the migration step needs directly (§10.2).
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['rds-data:ExecuteStatement', 'rds-data:BeginTransaction',
                'rds-data:CommitTransaction', 'rds-data:RollbackTransaction'],
      resources: [`arn:aws:rds:${this.region}:${this.account}:cluster:meme-*`],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:meme-db-*`],
    }));

    new CfnOutput(this, 'RoleArn', { value: role.roleArn });
  }
}
```

**Run once per account:**

```bash
cd infra/bootstrap && bunx cdk deploy meme-github-oidc-dev --profile meme-dev
```

Then push the role ARN into GitHub with the `gh` CLI rather than copying it by hand:

```bash
gh secret set AWS_DEV_ROLE_ARN --body "$(aws cloudformation describe-stacks --stack-name meme-github-oidc-dev --query 'Stacks[0].Outputs[?OutputKey==`RoleArn`].OutputValue' --output text --profile meme-dev)"
```

**Three things to know:**

- **Only one GitHub OIDC provider is allowed per AWS account.** If `meme-dev` or `meme-prod` ever
  hosts another project that created one, the second `new OpenIdConnectProvider(...)` fails with an
  `EntityAlreadyExists` error. That is what `existingProviderArn` is for — import instead of create.
  Worth anticipating given the Organization is meant to host other projects.
- **Thumbprints are no longer security-critical** for GitHub's endpoint — AWS validates it against
  trusted root CAs. Older guides insist on hardcoding a thumbprint that has since rotated and broken
  people's pipelines; don't copy those. If the CDK construct version you pin still requires the
  field, supply it, but don't treat it as a control.
- **Never let CI deploy this stack.** See the security note in §6's stack layout. Keeping it in a
  separate CDK app is what makes that structural rather than a convention someone forgets.

**What stays manual overall:** enabling Organizations, creating the two member accounts (email
verification), enabling IAM Identity Center, `cdk bootstrap`, and the two `cdk deploy` commands
above. Roughly 15 minutes per account, once, and none of it recurs.

### 10.2 Workflow (`.github/workflows/deploy.yml`)

```yaml
name: CI / CD
on:
  push:         { branches: [main] }
  pull_request: { branches: [main] }

permissions:
  id-token: write        # required for OIDC
  contents: read
  pull-requests: write   # for posting cdk diff comment

jobs:
  # ── Runs on every PR and on pushes to main ──────────────────────────
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
      - run: bun run db:migrate          # against the service container
      - run: bun run test                # includes the §7.3 contract suite
      - run: bun run --cwd infra cdk synth

  # ── PRs only — cdk diff against dev, posted as a comment ────────────
  preview:
    needs: check
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
      - name: CDK diff
        run: bun run --cwd infra cdk diff --all 2>&1 | tee /tmp/diff.txt
      - uses: actions/github-script@v7
        with:
          script: |
            const diff = require('fs').readFileSync('/tmp/diff.txt', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner, repo: context.repo.repo,
              body: '### CDK diff (dev)\n```\n' + diff.slice(0, 65000) + '\n```'
            });

  # ── Push to main only — deploy to prod ──────────────────────────────
  deploy:
    needs: check
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production   # optional manual approval gate
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_PROD_ROLE_ARN }}
          aws-region: ap-southeast-2
      # --all sees only the main infra app; infra/bootstrap is a separate CDK app
      # and is deliberately unreachable from CI (§6).
      - run: bun run --cwd infra cdk deploy --all --require-approval never --concurrency 4
      # Migrations run AFTER infra (the cluster must exist) and BEFORE the smoke test.
      # Data API is reachable from the runner over HTTPS — no VPC access needed.
      - name: Run database migrations
        run: bun run db:migrate
        env:
          DB_DRIVER: data-api
          DB_CLUSTER_ARN: ${{ vars.PROD_DB_CLUSTER_ARN }}
          DB_SECRET_ARN:  ${{ vars.PROD_DB_SECRET_ARN }}
      - name: Smoke test
        run: curl --fail --max-time 45 "${{ vars.PROD_APP_URL }}/api/health"
```

### 10.3 Key points

- **No AWS keys in GitHub secrets** — only role ARNs, which are not sensitive.
- **Prod role is locked to `main`** via the OIDC trust condition — a PR branch cannot deploy to
  prod even if someone edits the workflow.
- **Migrations run over the Data API from the runner.** This is the practical payoff of the
  no-VPC decision: with a conventional VPC-private Postgres, the runner could not reach the
  database and you would need a migration Lambda or an in-VPC CodeBuild project.
- **Migrations must be backward-compatible with the currently-deployed code**, because they run
  after the new Lambda code is live. Expand-then-contract: add columns nullable, backfill, drop in
  a later deploy. Never rename or drop in the same release that stops using a column. (This applies
  from the *second* deploy onward — the first one has no live code to be compatible with.)
- **The smoke test needs a generous timeout** (45s) — it may be the request that resumes a paused
  cluster.
- **`cdk diff` on PRs** — reviewers see infrastructure changes before merging.
- **Separate `check` job** gates both preview and deploy, so a failing test never reaches AWS.

---

## 11. Cost Protection & Spend Caps

AWS has **no hard spending cap**. Protection comes from layering resource-level caps with
budget-triggered automation.

### 11.1 Resource-level throttles (first line — instant, free)

| Service | Cap mechanism | Default value |
|---|---|---|
| Lambda (HTTP API) | `reservedConcurrentExecutions` | **25** — at 20 RPS and ~200ms/request you need ~4 concurrent before argon2; 5 is too tight |
| Lambda (WS + async) | `reservedConcurrentExecutions` | **10** each |
| API Gateway HTTP API | Stage throttle | **50 burst / 20 RPS** |
| API Gateway WebSocket | Stage throttle | **50 burst / 20 RPS** |
| **Aurora Serverless v2** | **`serverlessV2MaxCapacity`** | **1 ACU** (dev) / **2 ACU** (prod) — a hard ceiling on database spend |
| DynamoDB | On-demand, shielded by API GW throttle | On-demand |
| S3 uploads | Presigned URL content-length condition | **1 MB** |
| SQS | Max receive count → DLQ | 3 |

API Gateway throttling is the **outer wall**: if requests are rejected at 20 RPS, nothing downstream
can run away. `serverlessV2MaxCapacity` is the equivalent wall for the database — unlike DynamoDB
on-demand, Aurora has a genuine, configurable hard ceiling.

### 11.2 AWS Budget + automated kill switch (second line — 6–24h lag)

Via CDK (`aws-cdk-lib/aws-budgets.CfnBudget`):

1. **AWS Budget at $15/month** (a $10 budget would alert on normal operation, since the Aurora
   floor is real)
   - **80% ($12)** → SNS → SES email alert
   - **100% ($15)** → SNS → **kill-switch Lambda**
2. The kill switch sets `reservedConcurrentExecutions: 0` on all application Lambdas. No Lambda
   executes, API Gateway returns 500s, WebSocket connections fail, queued messages go nowhere. The
   SPA still loads from CloudFront but can't do anything. **The Aurora cluster then goes idle and
   auto-pauses on its own**, dropping to storage-only cost — a genuine advantage over an always-on
   RDS instance, which would keep billing after the kill switch fired.
3. Recovery is manual: restore concurrency via the console or a CDK deploy.

**Caveat**: billing data lags 6–24 hours, so spend could reach ~$20–25 before the switch fires.
This prevents a $100+ runaway, not a $15.01 overshoot.

### 11.3 Cost Anomaly Detection (third line — free, faster than Budgets)

Enable **AWS Cost Anomaly Detection** and point it at the same SNS topic. It flags unusual patterns
within hours — e.g. a bug driving sustained Aurora ACU — that a fixed monthly threshold would miss
until the total rose.

### 11.4 Worst case at sustained max throughput

Assumes the throttle defaults above are hit continuously for a month (20 RPS, 24/7 = ~52M requests).

| Service | $/mo |
|---|---|
| API Gateway HTTP API (52M × $1.00/M) | $52 |
| API Gateway WebSocket | $55–60 |
| Lambda (HTTP + WS + async) | $10–16 |
| **Aurora Serverless v2 pinned at max 2 ACU** | **$85–90** (2 ACU × ~$0.12/ACU-hr × 730) |
| DynamoDB on-demand | $10–20 |
| SQS | $5–10 |
| CloudWatch Logs | $2–3 |
| S3 + CloudFront | $1–2 |
| **Total (no kill switch)** | **~$220–250 / mo** |

**With the kill switch at $15**: at ~$8/day burn, the switch fires around **$15–25 of actual
spend**, Lambdas go to zero, and Aurora auto-pauses shortly after. **Realistic worst case: $25–35
total** before the app goes dark. Normal hobby use never approaches the throttle limits.

---

## 12. Cost Estimate (idle / light hobby use)

| Item | $/mo |
|---|---|
| Route 53 hosted zone | $0.50 |
| ACM cert | $0 |
| **Aurora Serverless v2 — storage while paused (~10GB)** | **$1.00** |
| **Aurora Serverless v2 — ACU-seconds, light use** | **$1.00 – $4.00** |
| **Secrets Manager (1 secret)** | **$0.40** |
| DynamoDB on-demand (idle) | $0 |
| SQS (idle event-source polling, 2 queues) | $0 – $0.50 |
| Lambda | $0 – $0.50 |
| API Gateway HTTP API | $0 – $0.50 |
| API Gateway WebSocket (light use) | $0 – $0.50 |
| CloudFront + S3 | $0 – $0.50 |
| SSM Parameter Store (Standard) | $0 |
| CloudWatch Logs (14-day retention) | $0 – $0.50 |
| X-Ray (100k traces free) | $0 |
| SES | $0 |
| **Total** | **~$4 – $9 / mo** |

Roughly 2× the all-DynamoDB estimate. That premium buys relational integrity, far lower
implementation risk, and the freedom to add query patterns without a GSI backfill.

The dominant variable is **Aurora ACU-hours**, driven by how much of the month the cluster is
awake, not by request count. The 1-hour auto-pause window is the main lever — shortening it saves
money at the cost of more cold resumes. Watch `ServerlessDatabaseCapacity` for the first month and
tune. Also verify the free-tier caveat in §6 before trusting the `$0` lines.

---

## 13. Implementation Plan (single pass)

No production deployment exists, so there is no incremental rollout, no dual-write window, and no
rollback-to-Mongo path. The work below is ordered by **dependency**, not by shippable increments —
but the ordering still matters. In particular, **get the app fully working locally on Postgres
before starting any CDK work.** Debugging a new data layer and new infrastructure simultaneously is
where single-pass migrations go wrong.

Items marked ∥ can proceed in parallel with the block above them.

### 0. Spike — falsify the load-bearing assumptions (one day, throwaway)

Four assumptions carry this plan and cannot be settled by reading. Prove them before writing 42
items of code against them. **The purpose is falsification, not construction** — you are buying an
answer, not a foundation.

**Rules:**

- **Throwaway.** Separate `spike/` directory, its own CDK app, its own stack name. Never merged;
  `cdk destroy` and delete when done. The classic failure is letting a spike become the real thing:
  code written to answer a question has none of the properties of code written to be maintained,
  but it looks close enough to keep.
- **Time-boxed to one day.** If a question isn't answered in a day, that *is* the finding — the
  assumption is harder than believed, which is exactly what you needed to learn.
- **Every question gets a number or a yes/no, written down.** "Seemed to work" is not a result.
- **Fallbacks decided before starting**, so a red result produces a decision rather than a stall.

**Order:**

0.1 **`@connections` endpoint override** — *one hour, purely local, no AWS.* Start an HTTP server on
    `:3002` that logs requests. Instantiate
    `ApiGatewayManagementApiClient({ endpoint: 'http://localhost:3002' })` and call
    `postToConnection`. Confirm it issues `POST /@connections/<id>` with the payload as the body,
    raises no SigV4 or TLS objection, and that a `410` response surfaces as `GoneException`.
    First because it is free, fast, and gates much of §3.4 and §7.

0.2 **§6 steps 0–4** — root MFA, Organizations, member accounts, Identity Center, `cdk bootstrap`.
    ~1 hour, required regardless, not wasted if the spike goes badly. Skip the OIDC stack; the
    spike deploys from a laptop.

0.3 **One stack covering the remaining three**, since they compose: a minimal Express app that
    hashes a password with `@node-rs/argon2`, sets a cookie, and reads from Aurora via the Data
    API — behind LWA, behind HTTP API, behind CloudFront.
    - **Aurora min-0 + Data API**: `serverlessV2MinCapacity: 0`, max 1, `enableDataApi: true`,
      auto-pause at the **5-minute minimum** (not the plan's 1 hour — you want to observe pausing
      quickly). Create a table via `aws rds-data execute-statement`, wait out the window, watch
      `ServerlessDatabaseCapacity` reach 0, then time a call. Repeat 3–5 times.
    - **`Set-Cookie` through LWA**: inspect the header via the API Gateway URL, then via CloudFront.
      Confirm `Secure`, `HttpOnly`, and `SameSite` survive and the cookie returns on the next request.
    - **argon2**: if it deploys ARM64 from Windows via Docker bundling and the hash route runs, done.

**The measurement that matters most.** Record whether it paused, time-to-pause, and resume latency
(min/median/max). But the highest-value observation is subtler: **does the first call after a pause
*block* until resume, or *fail fast*?** This plan assumes it blocks for ~15s, which needs nothing
but a generous Lambda timeout (§2.1). If it instead returns something like
`DatabaseResumingException`, then **every database-touching path needs retry-with-backoff in the
repository layer** — a real code change that appears nowhere in this plan and would be miserable to
discover at item 25.

**Fallbacks:**

| Red result | Consequence |
|---|---|
| No pause, or min capacity floors at 0.5 ACU | ~$43/mo floor. Cost target dead; reopens the datastore decision entirely |
| Fails fast rather than blocking on resume | Retry logic in the repository layer; a plan amendment, not a redesign |
| `Set-Cookie` doesn't survive LWA | `@vendia/serverless-express`; §3.1's "unmodified Express app" story changes |
| argon2 won't bundle | `hash-wasm` (the option §3.1 closed on the assumption Docker works) |
| `@connections` endpoint override rejected | Hand-written `LocalWsTransport`; §3.4 and §7 revert to one local implementation |

**Output:** `docs/spike-findings.md` with the measured numbers, plus amendments to whichever
sections moved — most likely §2.1 (resume latency, any retry requirement), §3.1, and §12 if ACU
behaviour differs. Then destroy the stack and delete the directory.

**What not to spike:** the WebSocket API, CloudFront path routing, SQS delay queues. Well-trodden,
low-risk, and spiking them only delays the real work. The four above are either genuinely novel
(min-0 Aurora with Data API is a recent combination) or environment-specific (Windows + Docker +
ARM64 native modules).

### A. Repo foundations

The CI workflow in §10.2 assumes a root workspace and a test suite. Neither exists: there is no root
`package.json`, `app/` and `server/` are independent Bun projects with separate lockfiles,
`typecheck` doesn't exist (app has `type-check`, server has neither), the server has no ESLint
config, and **the repo contains zero tests**.

1. Root `package.json` with Bun workspaces covering `app`, `server`, `infra`. Unify scripts:
   `typecheck`, `lint`, `test`, `db:migrate`, `db:rollback`, `db:seed`.
2. ESLint for `server/` with **type-aware linting**: the rule banning template-literal SQL (§3.5)
   and `@typescript-eslint/no-floating-promises` (§5).
3. `bun test` wired up, with a Postgres + DynamoDB Local test harness (Docker locally, service
   containers in CI).
4. `docker-compose.yml`: replace `mongo:8` with version-pinned `postgres` **and**
   `amazon/dynamodb-local`. Pin Postgres to Aurora's major version (§2.1).

> **On testing under a single pass.** A phased plan would write tests against the MongoDB
> implementation first, as a baseline to verify the port against. That option is gone — the services
> are rewritten in one go, so there is nothing to diff behaviour against. Tests are therefore
> written *alongside* the new services in block C, and the §16 acceptance checks carry more weight
> than they otherwise would. The three constraints in §2.3 are the highest-value things to cover,
> because they are exactly what a from-scratch rewrite is most likely to get subtly wrong.

### B. Data layer

5. Confirm Drizzle's Data API driver is current, then commit to it (§3.5).
6. Schema from §2.2 as the first migration, **with a down migration**; `db:migrate` /
   `db:rollback` run against local Docker Postgres. Add `db:seed`.
7. Repository layer with both drivers (`pg`, `data-api`) behind one interface.

### C. Service rewrite (depends on B)

8. `UserService` — unique constraints replace the manual `findOne` existence checks.
8a. Auth hardening while in these files (§5): invert the cookie `Secure` default in
    `AuthController`, raise the password minimum to 8 in `validatePassword` and mirror it in
    `Login.vue`. Both are small, unrelated to the data-layer work, and independently mergeable.
9. `CompetitionService` — the entry-limit + battle-status guard becomes one transaction (§2.3).
10. `VoteService` — `ON CONFLICT DO UPDATE` + `AVG()` group-by.
11. Battle persistence in `BattleManager` moves to the `battles` table.
12. Delete `server/src/db/client.ts` and `server/src/db/collections.ts`; drop the `mongodb`
    dependency.
13. Tests for all of the above, especially the §2.3 constraints.

**Checkpoint: the app runs end-to-end locally on Postgres, with MongoDB fully removed.** Do not
start block E before this holds.

### D. Real-time refactor (depends on C for the membership check) ∥

14. Extract the four seams in §3.4. Delete today's `Map`s — they do not become a memory backend.
15. `DdbConnectionRegistry`, `DdbChatStore`, `SqsTimerScheduler`, `ApiGwWsTransport` — **one
    implementation each**, pointed at local endpoints in development.
16. The local `@connections` shim (§3.4): `POST`/`DELETE /@connections/{id}` → in-process `ws`
    sockets, `410 Gone` for closed ones, plus send jitter and fanout reordering.
17. The dev-only SQS poller in the local server (§7.1).
18. Move per-connection state (`competitionId`, `lastChatAt`) onto the connection row (§3.2).
19. Rewrite `battleWs.ts` as an event-shape adapter: build `APIGatewayProxyWebsocketEventV2`
    objects and invoke the **real handler exports** (§3.4). No parallel dispatch path.
20. Contract suite + **concurrency suite** + CDK template assertions (§7.3).

### E. Uploads and SVG removal ∥ (independent of B–D)

21. Remove `image/svg+xml` from `ALLOWED_IMAGE_MIME_TYPES`; delete the `<svg` branch from
    `validateImageFile`; update the frontend `accept` attribute and any supported-formats copy (§5.1).
22. `signUpload` handler + `validateMeme` handler; delete the Multer route. Wire the local
    upload-callback path so `validateMeme` runs in-process against local Postgres (§3.6) — do not
    keep Multer alive for dev.
23. Rewrite `server/src/utils/s3-client.ts`: **delete the module-scope `CreateBucketCommand` behind
    a top-level `await`** (no error handling; throws `BucketAlreadyOwnedByYou` on every cold start in
    ap-southeast-2), drop credential handling, `getFileUrl` returns `/cdn/<key>`.

### F. Infrastructure

24. `infra/bootstrap/` CDK app + one local `cdk deploy` per account; push role ARNs to GitHub
    (§10.1). The account structure itself already exists from block 0.2 — this adds the OIDC
    provider and deploy roles, which the spike deliberately skipped.
25. `CertStack` (us-east-1), `DataStack`, `AppStack`, `ObservabilityStack` (§6).
26. Resolve the `@node-rs/argon2` bundling question (§3.1) — it surfaces on the first real deploy.
27. Deploy to `meme-dev`; validate against the dev account before touching prod. This is also when
    the tier-2 loop (§7.2) becomes available — use it for the IAM and API Gateway behaviours that
    tier 1 cannot reach.

### G. Frontend (depends on F for the endpoint URLs)

28. `app/src/api/client.ts` — replace the hardcoded URL with `VITE_API_BASE`.
29. `useBattleSocket.ts` — 5-minute keepalive ping, **pong deadline, reconnect with backoff,
    re-`SUBSCRIBE` on reopen, and a reconnecting indicator** (§3.3). Do not ship the ping without
    the reconnect.
30. Unit-test the SPA-fallback CloudFront Function (pure JS, §7.2).
31. GH Actions builds, syncs to S3, invalidates `/index.html`; wire single-distro path routing
    including the `/ws` origin request policy. **No custom domain needed** — the distribution's
    default name works (§4).

### H. Observability ∥ (can trail F slightly)

32. Powertools into every Lambda; alarms, dashboard, log retention.
33. **Verify the SES alarm recipient address** in each account (§6 step 6) *before* testing the
    alarm flow — otherwise the test fails for a reason unrelated to the alarms.
34. Verify the alarm-email flow with a synthetic error; tune the p99 alarm against real cold-resume
    data.

### I. Go live

35. Write the developer `README.md` (§7.4). Do this **before** the prod standup, not after — the
    one-time account steps are far easier to write down while you are performing them than to
    reconstruct from memory afterwards.
36. Work through §16 in full against `meme-dev`.
37. Deploy to `meme-prod`. The app is live on the distribution's default CloudFront domain.
38. Set the real `JWT_SECRET` in SSM (not the placeholder used in dev).
39. Verify the README by following it start to finish on a clean checkout — ideally on a second
    machine, or at minimum after `docker compose down -v` and clearing `~/.aws/config`.

### J. Custom domain (deferred, optional — §4)

40. Register a domain; create the Route 53 hosted zone in `meme-prod`.
41. `CertStack` in **us-east-1**; add the alias records and the distribution alternate domain name.
42. Update `VITE_API_BASE` / `VITE_WS_URL` build vars and redeploy the frontend.

---

## 14. Critical Gotchas

**Database:**

- **Aurora auto-pause resume is ~10–15s.** Lambda timeouts ≥30s on anything touching the DB; the
  CI smoke test needs a generous `--max-time`; expect the p99 latency alarm to trip until tuned.
- **Anything holding an open connection prevents auto-pause.** This is why RDS Proxy is not in this
  plan (it also costs ~$22/mo with a 2-vCPU floor, more than the database). Don't add a monitoring
  agent that maintains a session either. Alarm on non-zero `DatabaseConnections`.
- **`enableDataApi: true` is load-bearing.** Without it, Lambdas must join the VPC and the cost
  model collapses. Treat it as a tripwire in code review.
- **Data API is not the Postgres wire protocol.** Plain `pg`, Prisma, and vanilla Drizzle/Kysely
  don't work against it — use the Data API driver variants. No `LISTEN`/`NOTIFY`.
- **Storage encryption and `deletionProtection` must be set at cluster creation.**
- **Migrations run after code deploys** — expand-then-contract from the second release onward.
- **Parameterised queries only** — SQL injection is a live threat class now.
- **Aurora's PostgreSQL major must match the local Docker image** (§2.1). They are a coupled pair;
  bumping one alone silently reintroduces the drift Docker Postgres was chosen to avoid.

**Lambda:**

- **`@node-rs/argon2` is native** — esbuild alone will not bundle it (§3.1).
- **Argon2 at 128MB is unusably slow** — 1024MB for the auth Lambda.
- **LWA runs your real HTTP server** — keep `.listen()`. Verify `Set-Cookie` survives the adapter;
  test login end-to-end on the first dev deploy, not at the end.
- **Lambda 6MB sync payload** — never proxy uploads through Lambda. Presigned PUT only.

**Real-time:**

- **API Gateway WS 10-min idle timeout** — 8s battle ticks are a natural keepalive; the 5-minute
  client ping covers idle lobbies.
- **WS disconnect cleanup must be idempotent** — both `$disconnect` and a `postToConnection` 410
  `GoneException` delete the connection rows; both must be safe to run twice.
- **Powertools idempotency DynamoDB table needs its own TTL attribute** or it grows forever. Its
  persistence layer expects its own key attribute names — configure them explicitly against the
  `meme-state` PK/SK schema rather than relying on defaults.
- **There is no local implementation of any seam — keep it that way.** The moment one sprouts a
  local variant, the drift problem is back. Differences belong in configuration (§3.4).
- **No floating promises in handlers.** Lambda freezes on handler resolution; an un-awaited fanout
  delivers locally and silently vanishes in production (§5).
- **`useBattleSocket.ts` must reconnect.** Shipping the keepalive ping without a pong deadline and
  backoff reconnect makes dropped connections *harder* to detect, not easier (§3.3).
- **DynamoDB Local accepts any credentials**, so IAM policy errors are invisible in tier 1. CDK
  template assertions (§7.3) plus a dev-account deploy are the only catches.
- **`bun --hot` clears module scope constantly; a warm Lambda holds it for minutes.** Stale-cache
  and module-scope leak bugs are therefore *hidden* locally, not exposed.
- **`battleWs.ts` must build real API Gateway event objects and call the real handler exports.** A
  dispatch difference is fine; a parallel dispatch path is the bug this design exists to prevent.

**Edge and delivery:**

- **ACM cert for CloudFront must be in us-east-1** — use a cross-region CDK stack.
- **Cookie `SameSite` pain is avoided only by the single-CloudFront-distribution pattern.** Do not
  deploy the frontend and API on split domains.
- **OAC vs OAI** — start with OAC; migrating later requires distribution recreation.
- **SVG stays unsupported.** Reinstating it needs a real XML sanitiser *and* a sandbox CSP on
  `/cdn/*` — not one or the other (§5.1).

**Accounts and CI:**

- **Root users are the one unrecoverable mistake.** MFA on the management account root before
  creating anything; remove or secure the member accounts' root users immediately after creation
  (§6 steps 0 and 2a). A member account root with a resettable password and no MFA is a live
  credential sitting behind an email inbox.
- **Only one GitHub OIDC provider per AWS account** — import rather than create if one exists
  (§10.1).
- **Never let CI deploy `infra/bootstrap/`** — that is CI's own trust policy (§6).
- **Free tier is shared across the Organization**, not per member account (§6).
- **SES starts in sandbox mode** — alarm emails go nowhere until the recipient address is verified,
  and the failure is silent (§6 step 6).
- **LocalStack free tier does not include API Gateway WebSocket** (Pro feature).

---

## 15. Critical Files to Modify

**Existing (refactor targets):**

- `server/server.ts` — drop `connectDb` / `createIndexes` / `rehydrate` from startup; **keep
  `.listen()`** (LWA needs it)
- `server/src/services/BattleManager.ts` — extract interfaces; move battle persistence to Postgres;
  the biggest single refactor
- `server/src/services/UserService.ts` — rewrite against the repository layer
- `server/src/controllers/AuthController.ts` — invert the cookie `Secure` default to fail-secure
  (§5); Lambda does not set `NODE_ENV`
- `server/src/utils/password.ts` — raise the minimum password length from 4 to 8, update the error
  message
- `app/src/pages/Login.vue` — mirror the 8-character rule client-side (currently checks presence
  only)
- `server/src/services/CompetitionService.ts` — rewrite; entry-limit + battle-status guard becomes
  one transaction (§2.3)
- `server/src/services/VoteService.ts` — rewrite; `ON CONFLICT DO UPDATE` + `AVG()` group-by
- `server/src/ws/battleWs.ts` — split into per-route handlers; per-connection state moves to DDB
- `server/src/middleware/file.ts` — remove `image/svg+xml`; replace Multer with presign + async
  validation
- `server/src/utils/file-validation.ts` — **delete the `<svg` branch**; the function becomes a pure
  magic-byte comparison
- `server/src/utils/s3-client.ts` — **delete the module-scope `CreateBucketCommand`**; drop
  credential handling; `getFileUrl` returns `/cdn/<key>`
- `server/src/controllers/CompetitionController.ts` — the direct `usersCollection()` query for
  member usernames becomes a join
- `app/src/api/client.ts` — replace the hardcoded `http://localhost:3000/api` with `VITE_API_BASE`
- `app/src/composables/useBattleSocket.ts` — 5-minute ping **plus pong deadline, backoff reconnect,
  re-`SUBSCRIBE`, and a reconnecting indicator** (§3.3); note it already appends `/ws`, so
  `VITE_WS_URL` must not include it
- `app/src/pages/CompetitionDetail.vue` (and any other uploader UI) — update the `accept` attribute
  and supported-formats copy to drop SVG
- `docker-compose.yml` — replace `mongo:8` with version-pinned `postgres` (matching Aurora's major,
  §2.1) **and** `amazon/dynamodb-local`
- `server/.env.example` — replace `MONGODB_*` and the LocalStack S3 block; add `DDB_ENDPOINT`,
  `DATABASE_URL`, `WS_CALLBACK_URL`

**Delete entirely:**

- `server/src/db/client.ts` — MongoDB client
- `server/src/db/collections.ts` — collection helpers + index creation; replaced by SQL migrations

**New:**

- `README.md` (root) — the concise developer runbook specified in §7.4
- `package.json` (root) — Bun workspace + unified scripts
- `server/src/db/schema.ts` + `server/src/db/migrations/` — schema definition and migrations
- `server/src/db/repository/*` — driver-agnostic data access (§3.5)
- `server/src/state/*` — the §3.4 seams: `DdbConnectionRegistry`, `DdbChatStore`,
  `SqsTimerScheduler`, `ApiGwWsTransport`. **One implementation each**
- `server/src/dev/connections-shim.ts` — local `@connections` HTTP server (§3.4)
- `server/src/dev/sqs-poller.ts` — dev-only queue consumer (§7.1)
- `server/src/db/seed.ts` — local fixture data (§7.1)
- `infra/test/*` — CDK template assertions over IAM policies (§7.3)
- `server/src/handlers/ws/*` — `$connect`, `$disconnect`, `subscribe`, `vote`, `chat`, `$default`
- `server/src/handlers/async/*` — `advance-battle`, `presence-leave`, `validate-meme`, `sign-upload`
- `infra/bootstrap/` — GitHub OIDC CDK app, deployed locally only (§10.1)
- `infra/` — main CDK workspace (`bin/`, `lib/cert-stack.ts`, `lib/data-stack.ts`,
  `lib/app-stack.ts`, `lib/observability-stack.ts`)
- `.github/workflows/deploy.yml` — OIDC + PR checks + main-branch CD

---

## 16. Acceptance Checks

Run the whole list against `meme-dev` before deploying to prod. Grouped by area, not by phase —
there are no phase gates.

**Test suite**

- `bun run typecheck && bun run lint && bun run test` pass at the repo root
- The tests genuinely fail when a service is broken — mutate one deliberately and confirm
- The contract suite (§7.3) passes against **both** DB drivers and against **both** DynamoDB Local
  and real DynamoDB
- The concurrency suite passes, and **fails when a guard is removed** — delete the `FOR UPDATE` and
  confirm the 3-entry test goes red
- CDK template assertions pass, and fail when a role is over-granted

**Developer README** (§7.4)

- A clean checkout plus the README alone gets a developer to a running local app — verified by
  actually following it, not by reading it
- The one-time AWS steps are labelled by scope (per-organisation / per-account / per-developer)

**Data constraints** (the highest-risk area of a from-scratch rewrite)

- Change a vote twice on the same entry; the computed average is correct both times
- Duplicate username registration is rejected; duplicate email registration is rejected
- A 4th upload by the same user in one competition is rejected
- Uploading after a battle has started is rejected
- Deleting a competition cascades to members, files, and votes with no orphans

**Auth**

- Login works end-to-end against dev Aurora; the JWT cookie survives LWA
- **Inspect the actual `Set-Cookie` header on the deployed environment** and confirm `Secure` is
  present. Do not infer it from the source — the whole point of §5's fix is that the previous
  expression silently evaluated false in Lambda
- A 7-character password is rejected at registration, both client-side and by the API directly
  (bypass the UI — the server rule is the one that matters)
- Cold-resume latency measured and recorded; login timeout comfortably exceeds it

**Real-time**

- Two browser tabs: chat, presence, and battle advancement all work
- Close one tab → the other sees the leave in ~3s
- **Refresh** one tab → *no* leave/join flicker in chat (the debounce working)
- An idle lobby survives past 10 minutes (the 5-minute ping)
- **Kill the connection mid-battle** (devtools offline toggle, or a `cdk deploy` that replaces the
  Lambda) → the client reconnects, re-subscribes, and resumes at the correct entry with the correct
  countdown. This is the §3.3 gap and it must be tested deliberately, because it never occurs
  locally by accident
- Kill and restart the server mid-battle → ticks continue and state stays consistent (SQS, not
  process memory)
- A chat fanout to several connections delivers to **all** of them — the floating-promise check
  (§5). Verify against a deployed Lambda, not tier 1
- A full battle runs to completion and final ratings land in `competition_files.rating`

**Uploads**

- A valid PNG/JPEG/GIF/WebP/BMP near 1MB uploads and appears in the competition
- An `.exe` renamed to `.png` is deleted within seconds
- A 2MB file is rejected at S3 by the bucket policy
- **An SVG is rejected** — both by MIME type and, if the type is spoofed, by magic-byte validation
- Requesting 4 presigned URLs as one user and uploading all → the 4th is rejected at validation

**Routing and CDN**

- The dev distribution's default CloudFront domain serves the SPA; deep links work (SPA fallback)
- `/api/*` reaches the API; `/ws` upgrades successfully **with the cookie forwarded**
- `/cdn/*` serves memes; the bucket is not publicly reachable directly

**Observability and cost**

- The SES alarm recipient is verified in the account (checked *before* the next item)
- Force a Lambda error → alarm fires → email arrives within ~5min
- The Aurora max-ACU alarm fires under synthetic load
- Log groups all show 14-day retention
- The cluster actually auto-pauses after the idle window — confirm on the
  `ServerlessDatabaseCapacity` metric, not by assumption

---

## 17. Open Items to Revisit Later

- **Per-Lambda database least privilege** — Postgres roles + `GRANT`s if the single app role ever
  becomes uncomfortable (§5)
- **RDS Proxy** — only if you ever move off Data API to direct connections, and only accepting the
  ~$22/mo and the loss of auto-pause
- **Aurora DSQL** — genuinely scale-to-zero and no VPC, but no foreign keys, no extensions, no
  sequences. Revisit only if Aurora ACU cost becomes the dominant line item and you're willing to
  give up the relational features this plan actively uses
- **WAF and login/registration rate limiting** — both deferred together; §5 records the options and
  the design constraints so the decision can be made quickly if abuse materialises
- **Ephemeral PR preview environments** — wire once the solo workflow is stable
- **Multi-region** — unnecessary at hobby scale; CloudFront already handles global static delivery
- **Cognito / federated auth** — revisit if you want Google/GitHub sign-in
- **Read replica** — unnecessary until read load is measurably a problem
- **SVG support** — only with a real XML sanitiser *and* a sandbox CSP on `/cdn/*` (§5.1)
- **Custom domain** — deferred by choice, not blocked (§4, block J)
- **Chat TTL of 1 hour** — a session running longer loses history that today's in-process ring
  buffer would keep. An unexamined default; revisit if it bites
- **Lambda RIE as a third local tier** — worth it for the auth/`Set-Cookie` path if that ever
  breaks in a way tier 1 missed (§7.2)

### Verify before starting

Both of these are answered by **block 0** (§13), which is why it exists:

- The **CDK auto-pause property name** for Aurora Serverless v2 scale-to-zero, against the
  `aws-cdk-lib` version you pin (§6)
- The **highest Aurora PostgreSQL major available in ap-southeast-2**, which then pins the local
  Docker image too (§2.1)

Also worth confirming during block 0.2, while the console is already open: whether **centralised
root access management** is available in your Organization (§6 step 2a).
