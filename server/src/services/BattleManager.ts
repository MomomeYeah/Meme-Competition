import { WebSocket } from 'ws';
import { type Competition, type BattleState } from '../models/types';
import { competitionsCollection } from '../db/collections';
import { getFileUrl } from '../utils/s3-client';
import { VoteService } from './VoteService';
import { NotFoundError, ValidationError } from '../utils/errors';

const DEFAULT_ENTRY_DURATION_MS = 8000;

export interface AuthenticatedWS extends WebSocket {
    userId: string;
    username: string;
    competitionId?: string;
    lastChatAt?: number;
}

// Server → Client message types
export type ServerMessage =
    | { type: 'BATTLE_STATE'; payload: BattleStatePayload }
    | { type: 'ENTRY_ADVANCE'; payload: EntryAdvancePayload }
    | { type: 'VOTE_ACK'; payload: VoteAckPayload }
    | { type: 'VOTE_REJECTED'; payload: VoteRejectedPayload }
    | { type: 'BATTLE_COMPLETE'; payload: BattleCompletePayload }
    | { type: 'CHAT_MESSAGE'; payload: ChatMessagePayload }
    | { type: 'USER_JOINED'; payload: UserPresencePayload }
    | { type: 'USER_LEFT'; payload: UserPresencePayload }
    | { type: 'PRESENCE_STATE'; payload: PresenceStatePayload }
    | { type: 'ERROR'; payload: { code: string; message: string } };

export interface BattleStatePayload {
    status: BattleState['status'];
    currentIndex: number;
    totalEntries: number;
    fileId: string;
    fileUrl: string;
    uploaderId: string;
    entryStartedAt: string;
    entryDurationMs: number;
    /** ISO timestamp of the server at the moment this message was sent; used by
     *  clients to compute clock skew for an accurate countdown display. */
    serverTime: string;
    /** The authenticated user's existing vote for this entry, or null if none. */
    myVote: number | null;
}

export interface EntryAdvancePayload {
    currentIndex: number;
    totalEntries: number;
    fileId: string;
    fileUrl: string;
    uploaderId: string;
    entryStartedAt: string;
    entryDurationMs: number;
    /** ISO timestamp of the server at the moment this message was sent. */
    serverTime: string;
}

export interface VoteAckPayload {
    fileId: string;
    rating: number;
}

export interface VoteRejectedPayload {
    fileId: string;
    reason: string;
}

export interface BattleCompletePayload {
    finalRatings: { fileId: string; averageRating: number }[];
}

export interface ChatMessagePayload {
    messageId: string;
    userId: string;
    username: string;
    text: string;
    sentAt: string;
}

export interface UserPresencePayload {
    userId: string;
    username: string;
    joinedAt?: string;
    leftAt?: string;
}

export interface PresenceStatePayload {
    userIds: string[];
}

const CHAT_HISTORY_LIMIT = 50;
const LEAVE_DEBOUNCE_MS = 3000;

class BattleManager {
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private clients = new Map<string, Set<AuthenticatedWS>>();
    // competitionId → userId → pending-leave timer
    private presenceTimers = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();
    // competitionId → recent chat messages (ring buffer)
    private chatHistory = new Map<string, ChatMessagePayload[]>();

    // ── Client registry ──────────────────────────────────────────────────────

    registerClient(competitionId: string, ws: AuthenticatedWS): void {
        if (!this.clients.has(competitionId)) {
            this.clients.set(competitionId, new Set());
        }
        this.clients.get(competitionId)!.add(ws);
    }

    removeClient(competitionId: string, ws: AuthenticatedWS): void {
        this.clients.get(competitionId)?.delete(ws);
    }

    /** Register a client and handle presence: sends PRESENCE_STATE to the joiner,
     *  cancels any pending leave timer (page refresh), and broadcasts USER_JOINED
     *  only when the user is genuinely new to the room (first tab, not a refresh). */
    registerClientWithPresence(competitionId: string, ws: AuthenticatedWS): void {
        // Check before adding: does this user already have another socket in the room?
        const room = this.clients.get(competitionId);
        const alreadyPresent = room ? [...room].some((c) => c.userId === ws.userId) : false;

        this.registerClient(competitionId, ws);

        // Send current presence snapshot to the new joiner
        const onlineIds = this.getOnlineUserIds(competitionId);
        this.send(ws, { type: 'PRESENCE_STATE', payload: { userIds: onlineIds } });

        // Send recent chat history to the new joiner
        const history = this.chatHistory.get(competitionId) ?? [];
        for (const msg of history) {
            this.send(ws, { type: 'CHAT_MESSAGE', payload: msg });
        }

        const competitionPresence = this.presenceTimers.get(competitionId);
        const pendingTimer = competitionPresence?.get(ws.userId);

        if (pendingTimer !== undefined) {
            // User refreshed within the debounce window — cancel leave, no announcement
            clearTimeout(pendingTimer);
            competitionPresence!.delete(ws.userId);
        } else if (!alreadyPresent) {
            // Genuinely new to the room (first tab) — announce to all (including the joiner)
            this.broadcast(competitionId, {
                type: 'USER_JOINED',
                payload: { userId: ws.userId, username: ws.username, joinedAt: new Date().toISOString() },
            });
        }
        // If alreadyPresent and no pending timer: user opened a second tab — no announcement
    }

    /** Remove a client and schedule USER_LEFT after a debounce window.
     *  If the user still has another tab open, the leave is cancelled entirely. */
    scheduleLeave(competitionId: string, ws: AuthenticatedWS): void {
        this.removeClient(competitionId, ws);

        // Check if this user has other open sockets in the room
        const room = this.clients.get(competitionId);
        const stillPresent = room && [...room].some((c) => c.userId === ws.userId);
        if (stillPresent) return;

        // Debounce: wait before broadcasting USER_LEFT
        if (!this.presenceTimers.has(competitionId)) {
            this.presenceTimers.set(competitionId, new Map());
        }
        const competitionPresence = this.presenceTimers.get(competitionId)!;

        const timer = setTimeout(() => {
            competitionPresence.delete(ws.userId);
            this.broadcast(competitionId, {
                type: 'USER_LEFT',
                payload: { userId: ws.userId, username: ws.username, leftAt: new Date().toISOString() },
            });
        }, LEAVE_DEBOUNCE_MS);

        competitionPresence.set(ws.userId, timer);
    }

    /** Returns the deduplicated set of userIds currently connected to a competition. */
    getOnlineUserIds(competitionId: string): string[] {
        const room = this.clients.get(competitionId);
        if (!room) return [];
        const ids = new Set<string>();
        for (const ws of room) ids.add(ws.userId);
        return [...ids];
    }

    /** Append a chat message to the ring buffer for a competition. */
    appendChatHistory(competitionId: string, msg: ChatMessagePayload): void {
        if (!this.chatHistory.has(competitionId)) {
            this.chatHistory.set(competitionId, []);
        }
        const history = this.chatHistory.get(competitionId)!;
        history.push(msg);
        if (history.length > CHAT_HISTORY_LIMIT) {
            history.shift();
        }
    }

    /** Cancel an in-progress battle timer, e.g. when a competition is deleted. */
    cancelBattle(competitionId: string): void {
        const timer = this.timers.get(competitionId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(competitionId);
        }
        this.clients.delete(competitionId);

        // Clean up presence timers
        const competitionPresence = this.presenceTimers.get(competitionId);
        if (competitionPresence) {
            for (const t of competitionPresence.values()) clearTimeout(t);
            this.presenceTimers.delete(competitionId);
        }

        // Clean up chat history
        this.chatHistory.delete(competitionId);
    }

    // ── Messaging ────────────────────────────────────────────────────────────

    broadcast(competitionId: string, message: ServerMessage): void {
        const room = this.clients.get(competitionId);
        if (!room) return;
        const payload = JSON.stringify(message);
        for (const client of room) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }

    send(ws: WebSocket, message: ServerMessage): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    // ── Battle lifecycle ─────────────────────────────────────────────────────

    async startBattle(competitionId: string, requesterId: string): Promise<Competition> {
        const competition = await competitionsCollection().findOne({ _id: competitionId });
        if (!competition) throw new NotFoundError('Competition not found');
        if (competition.owner !== requesterId) throw new ValidationError('Only the owner can start the battle');
        if (competition.battle?.status === 'active') throw new ValidationError('Battle is already active');
        if (competition.battle?.status === 'complete') throw new ValidationError('Battle has already completed');

        const files = competition.files ?? [];
        if (files.length === 0) throw new ValidationError('No entries to battle with');

        const shuffledFileIds = fisherYatesShuffle(files.map((f) => f.id));
        const now = new Date().toISOString();

        const battle: BattleState = {
            status: 'active',
            shuffledFileIds,
            currentIndex: 0,
            entryStartedAt: now,
            entryDurationMs: DEFAULT_ENTRY_DURATION_MS,
        };

        const updated = await competitionsCollection().findOneAndUpdate(
            { _id: competitionId },
            { $set: { battle } },
            { returnDocument: 'after' },
        );

        this.scheduleAdvance(competitionId, DEFAULT_ENTRY_DURATION_MS);
        this.broadcastEntryAdvance(updated!, 0);
        return updated!;
    }

    private scheduleAdvance(competitionId: string, delayMs: number): void {
        const existing = this.timers.get(competitionId);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(async () => {
            await this.advanceEntry(competitionId);
        }, delayMs);
        this.timers.set(competitionId, timer);
    }

    private async advanceEntry(competitionId: string): Promise<void> {
        const competition = await competitionsCollection().findOne({ _id: competitionId });
        if (!competition?.battle || competition.battle.status !== 'active') return;

        const nextIndex = competition.battle.currentIndex + 1;

        if (nextIndex >= competition.battle.shuffledFileIds.length) {
            await this.completeBattle(competition);
            return;
        }

        const now = new Date().toISOString();
        const updatedBattle: BattleState = {
            ...competition.battle,
            currentIndex: nextIndex,
            entryStartedAt: now,
        };

        const updated = await competitionsCollection().findOneAndUpdate(
            { _id: competitionId },
            { $set: { battle: updatedBattle } },
            { returnDocument: 'after' },
        );

        this.scheduleAdvance(competitionId, updatedBattle.entryDurationMs);
        this.broadcastEntryAdvance(updated!, nextIndex);
    }

    private async completeBattle(competition: Competition): Promise<void> {
        const completedBattle: BattleState = {
            ...competition.battle!,
            status: 'complete',
        };

        const averages = await VoteService.getAverages(competition.id);
        const updatedFiles = competition.files.map((f) => ({
            ...f,
            rating: averages[f.id] ?? null,
        }));

        await competitionsCollection().updateOne(
            { _id: competition.id },
            { $set: { battle: completedBattle, files: updatedFiles } },
        );

        this.timers.delete(competition.id);

        const finalRatings = Object.entries(averages).map(([fileId, averageRating]) => ({
            fileId,
            averageRating,
        }));

        this.broadcast(competition.id, {
            type: 'BATTLE_COMPLETE',
            payload: { finalRatings },
        });
    }

    private broadcastEntryAdvance(competition: Competition, index: number): void {
        const fileId = competition.battle!.shuffledFileIds[index] as string | undefined;
        if (!fileId) return;
        const file = competition.files.find((f) => f.id === fileId);
        if (!file) return;

        const payload: EntryAdvancePayload = {
            currentIndex: index,
            totalEntries: competition.battle!.shuffledFileIds.length,
            fileId,
            fileUrl: getFileUrl(file.s3Key),
            uploaderId: file.uploaderId,
            entryStartedAt: competition.battle!.entryStartedAt,
            entryDurationMs: competition.battle!.entryDurationMs,
            serverTime: new Date().toISOString(),
        };

        this.broadcast(competition.id, { type: 'ENTRY_ADVANCE', payload });
    }

    /** Send the current battle state to a single newly-connected client, including
     *  their existing vote for the current entry if one exists. */
    async sendCurrentState(ws: AuthenticatedWS, competition: Competition): Promise<void> {
        const battle = competition.battle;
        if (!battle || battle.status === 'complete') return;

        const fileId = battle.shuffledFileIds[battle.currentIndex] as string | undefined;
        if (!fileId) return;
        const file = competition.files.find((f) => f.id === fileId);
        if (!file) return;

        const votes = await VoteService.getVotesForFile(competition.id, fileId);
        const myVote = votes[ws.userId] ?? null;

        const payload: BattleStatePayload = {
            status: battle.status,
            currentIndex: battle.currentIndex,
            totalEntries: battle.shuffledFileIds.length,
            fileId,
            fileUrl: getFileUrl(file.s3Key),
            uploaderId: file.uploaderId,
            entryStartedAt: battle.entryStartedAt,
            entryDurationMs: battle.entryDurationMs,
            serverTime: new Date().toISOString(),
            myVote,
        };

        this.send(ws, { type: 'BATTLE_STATE', payload });
    }

    /** Called at server startup to re-arm timers for any battles that were active. */
    async rehydrate(): Promise<void> {
        let competitions: Competition[] = [];
        try {
            competitions = await competitionsCollection()
                .find({ 'battle.status': 'active' })
                .toArray();
        } catch (error) {
            console.error('Failed to query active battles during rehydration:', error);
            return;
        }

        for (const competition of competitions) {
            const { entryStartedAt, entryDurationMs } = competition.battle!;
            const elapsed = Date.now() - Date.parse(entryStartedAt);
            const remaining = Math.max(0, entryDurationMs - elapsed);
            console.log(
                `Rehydrating battle for competition ${competition.id}: ${remaining}ms remaining on current entry`,
            );
            this.scheduleAdvance(competition.id, remaining);
        }
    }
}

function fisherYatesShuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i] as T;
        arr[i] = arr[j] as T;
        arr[j] = tmp;
    }
    return arr;
}

export const battleManager = new BattleManager();
