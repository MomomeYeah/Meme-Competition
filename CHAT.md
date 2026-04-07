# Real-Time Chat for Competition Lobby

## Context
Users participate in meme battles in the competition lobby and need a way to communicate in real time. A persistent WebSocket connection already exists per lobby, so chat is purely additive — new message types layered on top of the existing battle protocol. Chat is available in all lobby states (idle, active, complete). Messages do not persist across refreshes; an in-memory ring buffer of the last 50 messages per competition is kept on the server so late joiners get recent context.

---

## Files Modified

| File | Change |
|---|---|
| `server/src/services/BattleManager.ts` | New message types, presence/chat infrastructure |
| `server/src/ws/battleWs.ts` | CHAT handler, rate limiting, presence broadcasts |
| `app/src/composables/useBattleSocket.ts` | New message handlers, `chatMessages`, `onlineUserIds`, `sendChatMessage` |
| `app/src/components/BattleChat.vue` | New component |
| `app/src/pages/CompetitionDetail.vue` | Wire chat, participant presence styling |

---

## WebSocket Message Types

### Client → Server
```typescript
{ type: 'CHAT'; payload: { text: string } }  // competitionId inferred from authWs.competitionId
```

### Server → Client (new additions to `ServerMessage` union)
```typescript
{ type: 'CHAT_MESSAGE';   payload: { messageId: string; userId: string; username: string; text: string; sentAt: string } }
{ type: 'USER_JOINED';    payload: { userId: string; username: string; joinedAt: string } }
{ type: 'USER_LEFT';      payload: { userId: string; username: string; leftAt: string } }
{ type: 'PRESENCE_STATE'; payload: { userIds: string[] } }
```

`PRESENCE_STATE` is sent only to the connecting client on subscribe so they know which users are already in the lobby.

---

## Server: `BattleManager.ts`

**New fields on `AuthenticatedWS`:** `lastChatAt?: number` for rate limiting.

**New `ServerMessage` union members:** `CHAT_MESSAGE`, `USER_JOINED`, `USER_LEFT`, `PRESENCE_STATE`.

**New payload interfaces:** `ChatMessagePayload`, `UserPresencePayload`, `PresenceStatePayload`.

**New private fields:**
- `presenceTimers: Map<string, Map<string, ReturnType<typeof setTimeout>>>` — competitionId → userId → pending-leave timer
- `chatHistory: Map<string, ChatMessagePayload[]>` — in-memory ring buffer, max 50 entries per competition

**`registerClientWithPresence(competitionId, ws)`** replaces `registerClient` in the WS handler:
1. Check *before* adding whether this `userId` already has another socket in the room (`alreadyPresent`)
2. Call `registerClient` to add the socket
3. Send `PRESENCE_STATE` (current unique userIds) to the joiner only
4. Replay the last 50 messages from `chatHistory` to the joiner only
5. Check for a pending leave timer for this `userId`:
   - **Pending timer exists** → cancel it, no announcement (page refresh within debounce window)
   - **No timer, not already present** → broadcast `USER_JOINED` to all
   - **No timer, already present** → do nothing (second tab opened, no announcement)

**`scheduleLeave(competitionId, ws)`** replaces `removeClient` in the WS handler:
1. Call `removeClient` (immediately stops broadcasts to the departing socket)
2. Check if any other socket for the same `userId` remains in the room — if so, return (user still present in another tab)
3. Start a 3-second timer that broadcasts `USER_LEFT` on expiry; store in `presenceTimers`

**`getOnlineUserIds(competitionId)`:** Returns deduplicated `userId` values from the room's client set.

**`appendChatHistory(competitionId, msg)`:** Pushes to ring buffer, `shift()`s if over 50.

**`cancelBattle` updated:** Clears `presenceTimers` and `chatHistory` entries for the competition.

---

## Server: `battleWs.ts`

**New `ChatMessage` client message type** added to the `ClientMessage` union.

**`case 'CHAT'`** routes to `handleChat(authWs, msg, manager)`.

**`handleChat`:**
- Rejects if `ws.competitionId` not set → `ERROR { code: 'NOT_SUBSCRIBED' }`
- Rejects if text is empty after trimming → `ERROR { code: 'INVALID_CHAT' }`
- Rate limits to 1 msg/sec via `ws.lastChatAt` → `ERROR { code: 'RATE_LIMITED' }` (not a silent drop)
- Caps text at 200 chars after trimming
- Generates `messageId` via `crypto.randomUUID()`
- Calls `manager.appendChatHistory(...)` then `manager.broadcast(...)`

**`handleSubscribe`:** Uses `manager.registerClientWithPresence(...)` instead of `manager.registerClient(...)`.

**`ws.on('close')` and `ws.on('error')`:** Use `manager.scheduleLeave(...)` instead of `manager.removeClient(...)`.

---

## Client: `useBattleSocket.ts`

**New exported types:** `ChatMessage`, `SystemMessage`, `ChatEntry` (discriminated union on `type: 'chat' | 'system'`).

**New reactive state:**
- `chatMessages: Ref<ChatEntry[]>` — capped at 200 entries client-side
- `onlineUserIds: Ref<Set<string>>` — tracks who is currently in the lobby

**New switch cases in `handleMessage`:**
- `PRESENCE_STATE` → replace `onlineUserIds` with a new `Set` from `payload.userIds`
- `CHAT_MESSAGE` → push `ChatMessage` entry (cap with `shift()` at 200)
- `USER_JOINED` → add `userId` to `onlineUserIds`; push system message `"${username} has entered the battle"`
- `USER_LEFT` → remove `userId` from `onlineUserIds`; push system message `"${username} has left the battle"`

**`sendChatMessage(text)`:** Trims, skips if empty or over 200 chars, sends `{ type: 'CHAT', payload: { text } }`.

**`disconnect`:** Clears `chatMessages` and resets `onlineUserIds` to empty `Set`.

**Exports:** `chatMessages`, `onlineUserIds`, `sendChatMessage` added to return object.

---

## Client: `BattleChat.vue` (new component)

**Props:** `messages: ChatEntry[]`, `currentUserId: string`

**Emits:** `send: [text: string]`

### Behaviour
- Collapses to header-only via `.chat-root--collapsed` which sets `flex: none !important; height: auto !important`, defeating any parent-imposed `flex` or `height`
- Defaults to collapsed on mobile (`window.innerWidth <= 900` on mount)
- Expanding scrolls to bottom with `behavior: 'instant'`
- New messages auto-scroll with `behavior: 'smooth'` (skipped when collapsed)
- Message grouping: `showMeta(index)` returns `true` (showing username + timestamp header) only when: first message, previous entry is a system message, different sender, or same sender but >60 seconds elapsed — avatar is shown on every message regardless
- Input is a `<textarea rows="1">` that auto-resizes up to `max-height: 80px`
- `@keydown.enter.exact.prevent` submits; Shift+Enter inserts a newline
- `white-space: pre-wrap` on `.bubble-text` renders newlines in received messages

### Layout
```
.chat-root (flex column)
  .chat-header        — "LIVE CHAT", dot, collapse toggle
  .chat-messages      — flex:1, min-height:0, overflow-y:auto, aria-live="polite"
    [v-for each entry]
    .chat-system      — centered italic muted (role="status")
    .chat-row         — left by default; .chat-row-own flips to row-reverse
      .chat-avatar    — height matches single-line bubble: calc(0.8125rem * 1.4 + 0.375rem * 2 + 2px)
      .chat-bubble
        .bubble-meta  — shown only when showMeta() is true; right-aligned for own
        .bubble-text  — cyan-tinted for own messages; pre-wrap for newlines
    div ref="bottomRef"  — scroll sentinel
  .chat-input-bar     — align-items:flex-end (send btn pins to bottom as textarea grows)
    textarea.chat-input  — maxlength="200", rows="1", auto-resize
    button.chat-send-btn
```

### Avatar sizing
`height: calc(0.8125rem * 1.4 + 0.375rem * 2 + 2px)` — matches the rendered height of a single-line bubble (font-size × line-height + top/bottom padding + 2px border).

---

## Client: `CompetitionDetail.vue`

**Import:** `BattleChat` from `../components/BattleChat.vue`

**Participant presence:** `.participant-offline` class added when `!battle.onlineUserIds.value.has(member.id)`:
```css
.participant-offline { opacity: 0.38; filter: grayscale(0.6); }
```

**BattleChat wired** as last child of `<aside class="side-panel">`, before `.side-back`:
```html
<BattleChat
    class="side-chat"
    :messages="battle.chatMessages.value"
    :current-user-id="authStore.user?.id ?? ''"
    @send="battle.sendChatMessage"
/>
```

**CSS additions:**
```css
/* Desktop */
.side-panel  { overflow: hidden; }          /* was overflow-y: auto */
.side-section { flex-shrink: 0; }           /* prevents sections squeezing out chat */
.side-chat   { flex: 1; overflow: hidden; } /* no min-height — collapsed state drives height */

/* Mobile (max-width: 900px) */
.side-chat   { height: 320px; max-height: 320px; } /* cap prevents infinite growth */
```

`min-height: 0` on `.chat-messages` (inside BattleChat) ensures `overflow-y: auto` works within both bounded desktop and mobile layouts.

---

## Verification
1. Two browser tabs, different users — "X has entered the battle" appears for each; participant cards show online (full opacity)
2. Open a second tab for the same user — no second join message; participant card remains online
3. Send messages in tab A — right-aligned/cyan in A, left-aligned with avatar+username in B
4. Consecutive messages from the same user within 60s — only first shows the username/timestamp header
5. Send 5 messages rapidly — rate limit error returned after first; no silent drops
6. Refresh tab A — no join/leave messages appear in tab B during the 3s debounce window
7. Close tab A — "X has left the battle" appears in tab B after ~3s; participant card becomes muted
8. Open a fresh tab — `PRESENCE_STATE` sets correct online indicators immediately; last 50 chat messages replay
9. Shift+Enter in chat input → newline rendered; Enter alone → submits
10. Mobile viewport — chat collapses by default; expanding scrolls to bottom; chat capped at 320px with scrollbar
11. Desktop viewport — chat collapses to header only with no grey box below
