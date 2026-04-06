# MongoDB Migration Plan

## Context

The app currently stores all data as flat JSON files read/written synchronously on every request. This works for a prototype but has no concurrency safety, no real querying, and all data must be loaded into memory to find a single record. The goal is to replace the JSON file layer with MongoDB, improving scalability, data integrity, and enabling proper queries and aggregations.

---

## Collections

### `users`
Mirror of the current `users.json` schema. No restructuring needed.

```ts
{
  _id: string,           // use existing string IDs (e.g. "user-1") as _id
  username: string,
  email: string,
  passwordHash: string,
  createdAt: Date
}
```

**Indexes:**
- `{ username: 1 }` — unique (used by login lookup)
- `{ email: 1 }` — unique (used by registration duplicate check)

---

### `competitions`
Keep `files[]` and `battle` embedded. Files are always loaded alongside their competition, never queried in isolation — embedding is the right call here.

```ts
{
  _id: string,           // existing string ID as _id
  title: string,
  owner: string | null,
  createdAt: Date,
  members: string[],     // array of userId strings
  files: CompetitionFile[],
  battle: BattleState | null
}
```

**Indexes:**
- `{ members: 1 }` — multikey index, supports `getCompetitionsByMember` (currently `filterByProperty("members", userId)`)
- `{ "battle.status": 1 }` — for `BattleManager.rehydrate()` to find active battles on startup without loading all competitions

---

### `votes`
**Restructured** — the current nested-map format (`votes[fileId][userId] = rating`) does not suit MongoDB well (dynamic keys can't be indexed). Replace with one document per individual vote:

```ts
{
  _id: ObjectId,         // auto-generated
  competitionId: string,
  fileId: string,
  userId: string,
  rating: number,        // 1–5
  createdAt: Date
}
```

**Indexes:**
- `{ competitionId: 1, fileId: 1, userId: 1 }` — **unique** compound index; supports atomic upserts for `setVote` and prefix queries on `{ competitionId, fileId }` (covers `getVotesForFile`)
- `{ competitionId: 1 }` — for `deleteVotes` and `getAverages` across an entire competition

Each vote is written to MongoDB immediately as it arrives (a single `updateOne` upsert on the compound index). No batching or flush step is needed.

`getAverages` becomes a `$group` aggregation (`$avg` of `rating` grouped by `fileId`) rather than in-memory computation.

---

## Library

Use the **native `mongodb` driver** (not Mongoose).

**Rationale:** The app already has full TypeScript types defined in `types.ts`. Mongoose adds schema enforcement that duplicates existing TS types, plus extra abstraction overhead. The native driver has excellent TypeScript generics support (`Collection<T>`), is lighter weight, and fits better with the app's existing patterns.

**Package to add:** `mongodb` (currently absent from `server/package.json`)

---

## Connection & Database Setup

### New file: `server/src/db/client.ts`
Exports a singleton `MongoClient` and a `getDb()` helper. Connect once on startup, reuse across requests.

```ts
// Pattern (not final code):
let client: MongoClient | null = null;

export async function connectDb(): Promise<void> { ... }
export function getDb(): Db { ... }  // throws if not connected
```

### New file: `server/src/db/collections.ts`
Typed accessors for each collection, created once after connection:

```ts
export function usersCollection(): Collection<UserDoc> { ... }
export function competitionsCollection(): Collection<CompetitionDoc> { ... }
export function votesCollection(): Collection<VoteDoc> { ... }
```

Indexes should be created here via `createIndex` / `createIndexes` calls, run at startup (MongoDB's `createIndex` is idempotent).

### `server/server.ts` changes
Call `connectDb()` before `app.listen()`. Call `battleManager.rehydrate()` after the connection is established (it currently reads the JSON file directly; it needs to be async and use MongoDB).

---

## Service Layer Changes

### `server/src/utils/json-db.ts`
Delete entirely. All callers replaced.

### `server/src/services/UserService.ts`
- `register`: `findOne({ username })`, `findOne({ email })`, `insertOne`
- `login`: `findOne({ username })`
- `getUserById`: `findOne({ _id: userId })`

### `server/src/ws/battleWs.ts`
- Replace both `findById` calls (in `handleSubscribe` and `handleVote`) with MongoDB lookups via `CompetitionService`
- Make `handleSubscribe` and `handleVote` async; update call sites in the `message` event handler accordingly
- `manager.sendCurrentState(ws, competition)` call in `handleSubscribe` must be `await`ed once it becomes async

### `server/src/services/CompetitionService.ts`
- `createCompetition`: `insertOne`
- `getCompetitionById`: `findOne({ _id: id })`
- `getCompetitionsByMember`: `find({ members: userId }).toArray()`
- `joinCompetition`: `updateOne` with `$addToSet: { members: userId }`
- `addFileToCompetition`: `updateOne` with `$push: { files: file }`
- `removeFileFromCompetition`: `updateOne` with `$pull: { files: { id: fileId } }`
- `deleteCompetition`: `deleteOne`, then `VoteService.deleteVotes`
- `relinquishOwnership` / `claimOwnership`: `updateOne` with `$set: { owner: ... }`
- All `updateById` returns must be replaced with `findOneAndUpdate` (with `returnDocument: 'after'`)

### `server/src/services/VoteService.ts`
Full rewrite around the new per-vote document model:
- `setVote`: `updateOne` with `upsert: true` (match on `{ competitionId, fileId, userId }`, set `rating`) — called directly on every incoming vote
- `getVotesForFile`: `find({ competitionId, fileId })` → transform to `Record<userId, rating>`
- `deleteVotes`: `deleteMany({ competitionId })`
- `getAverages`: aggregation pipeline — `$match { competitionId }`, `$group { _id: "$fileId", avg: { $avg: "$rating" } }`
- `flushVotes` and `removeVote` are removed entirely — `flushVotes` is no longer needed; `removeVote` has no call sites and is dead code

### `server/src/services/BattleManager.ts`
Remove the entire vote buffer subsystem:
- Delete `voteBuffer` map, `recordVote`, `getBufferedVote`, `flushVoteBuffer`
- `recordVote` (WebSocket path — see `battleWs.ts`) is replaced by a direct `await VoteService.setVote(...)` call
- `sendCurrentState` becomes `async`; replace buffer lookup with `await VoteService.getVotesForFile(competitionId, fileId)` and look up the user's entry
- `advanceEntry` becomes `async`; no longer needs to call `flushVoteBuffer` before proceeding
- `completeBattle` becomes `async`: `await VoteService.getAverages(competitionId)` → map files to apply ratings → `await findOneAndUpdate` on the competition
- `scheduleAdvance`'s timer callback must be `async` (`async () => { await this.advanceEntry(competitionId); }`) so that the returned promise is not silently unhandled
- `rehydrate()`: must become `async`. Replace direct `readFileSync` call with `find({ "battle.status": "active" }).toArray()`
- Note: `rehydrate()` is currently called synchronously at startup. Move the call to `server.ts` post-connect, awaited.

---

## Migrations

No data migration is needed — the existing JSON data will be discarded and the app will start from a fresh database. The JSON files in `data/` can be deleted immediately as part of the migration.

Index creation (`createIndex` / `createIndexes`) will run at startup via `server/src/db/collections.ts`, which is idempotent and serves as the only "schema setup" required.

---

## Environment Variables

Add to `server/.env` (and document in `server/.env.example`):

```
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=meme_competition
```

- `MONGODB_URI` is the full connection string. For Atlas, this will be `mongodb+srv://...`
- `MONGODB_DB_NAME` is kept separate so the URI stays clean and the DB name is easily overridden (e.g., `meme_competition_test` for tests)
- Load via the existing `dotenv` dependency (already in `package.json`)

---

## Additional Notes

### Password security
The current `passwordHash` field is base64-encoded plaintext — **not hashed**. This will be fixed as part of the migration using **argon2** with its default parameters (which are already tuned to OWASP recommendations: `argon2id` variant, memory 65536 KiB, iterations 3, parallelism 4).

**Changes:**
- Add `@node-rs/argon2` to `server/package.json` (native bindings, Bun-compatible, best performance)
- `server/src/utils/password.ts`: replace `hashPassword` with `async function hashPassword(password: string): Promise<string>` using `argon2.hash(password)`, and `verifyPassword` with `async function verifyPassword(password: string, hash: string): Promise<boolean>` using `argon2.verify(hash, password)`. `validatePassword` is unchanged.
- `UserService.register` and `UserService.login` must `await` the updated functions
- Since all existing users are discarded (fresh DB), no hash-upgrade migration is needed

### `_id` strategy
Use existing string IDs (e.g. `"user-1"`, `"comp-1"`) directly as MongoDB `_id`. This avoids changing any API response shapes or frontend types. New documents created after migration will use `crypto.randomUUID()` (already used via `generateId` in `generate-id.ts`) which is suitable as a string `_id`.

### Type updates
The `BattleVotes` interface in `types.ts` can be removed (replaced by the new per-vote `VoteDoc` type). `Competition` and `User` types remain structurally the same; add a `VoteDoc` type to `types.ts` or a new `db-types.ts`.

### `rehydrate()` async refactor
`BattleManager.rehydrate()` is currently synchronous and called implicitly. After the migration it must be `async` and explicitly awaited in `server.ts` after `connectDb()` completes. This is a small but load-bearing change.

---

## Files to Create

- `server/src/db/client.ts`
- `server/src/db/collections.ts`
- `server/.env.example` (add MongoDB vars)

## Files to Modify

- `server/package.json` — add `mongodb` and `@node-rs/argon2` dependencies
- `server/.env` — add `MONGODB_URI`, `MONGODB_DB_NAME`
- `server/server.ts` — await `connectDb()`, run index setup, await `rehydrate()`
- `server/src/models/types.ts` — add `VoteDoc`, remove `BattleVotes`
- `server/src/utils/password.ts` — replace `hashPassword`/`verifyPassword` with async argon2 equivalents
- `server/src/services/UserService.ts`
- `server/src/services/CompetitionService.ts`
- `server/src/services/VoteService.ts`
- `server/src/services/BattleManager.ts`
- `server/src/ws/battleWs.ts`

## Files to Delete

- `server/src/utils/json-db.ts`
- `server/data/` (entire directory — contains only the three JSON files)

---

## Verification

1. Run `bun install` to confirm `mongodb` and `@node-rs/argon2` resolve without issues under Bun
2. Start a local MongoDB instance (`mongod` or Docker: `docker run -p 27017:27017 mongo`)
3. Set `MONGODB_URI` and `MONGODB_DB_NAME` in `server/.env`
4. `bun run dev` — confirm startup logs show DB connected and indexes created
5. Register a new user, create a competition, upload files, start a battle, cast votes — verify data persists in MongoDB
6. Restart the server — verify `rehydrate()` re-arms the active battle timer correctly
7. Complete the battle — verify vote averages are written back to competition files
8. Delete a competition — verify cascade delete of votes works
