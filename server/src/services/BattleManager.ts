import { readFileSync } from 'fs';
import { join } from 'path';
import { type WebSocket } from 'ws';
import { type Competition, type BattleState } from '../models/types';
import { findById, updateById } from '../utils/json-db';
import { getFileUrl } from '../utils/s3-client';
import { VoteService } from './VoteService';
import { NotFoundError, ValidationError } from '../utils/errors';

const COMPETITIONS_FILE = 'competitions.json';
const DEFAULT_ENTRY_DURATION_MS = 5000;

export interface AuthenticatedWS extends WebSocket {
    userId: string;
    username: string;
    competitionId?: string;
}

// Server → Client message types
export type ServerMessage =
    | { type: 'BATTLE_STATE'; payload: BattleStatePayload }
    | { type: 'ENTRY_ADVANCE'; payload: EntryAdvancePayload }
    | { type: 'VOTE_ACK'; payload: VoteAckPayload }
    | { type: 'BATTLE_COMPLETE'; payload: BattleCompletePayload }
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
}

export interface EntryAdvancePayload {
    currentIndex: number;
    totalEntries: number;
    fileId: string;
    fileUrl: string;
    uploaderId: string;
    entryStartedAt: string;
    entryDurationMs: number;
}

export interface VoteAckPayload {
    fileId: string;
    rating: number;
}

export interface BattleCompletePayload {
    finalRatings: { fileId: string; averageRating: number }[];
}

class BattleManager {
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private clients = new Map<string, Set<AuthenticatedWS>>();

    registerClient(competitionId: string, ws: AuthenticatedWS): void {
        if (!this.clients.has(competitionId)) {
            this.clients.set(competitionId, new Set());
        }
        this.clients.get(competitionId)!.add(ws);
    }

    removeClient(competitionId: string, ws: AuthenticatedWS): void {
        this.clients.get(competitionId)?.delete(ws);
    }

    broadcast(competitionId: string, message: ServerMessage): void {
        const room = this.clients.get(competitionId);
        if (!room) return;
        const payload = JSON.stringify(message);
        for (const client of room) {
            if (client.readyState === 1 /* OPEN */) {
                client.send(payload);
            }
        }
    }

    send(ws: WebSocket, message: ServerMessage): void {
        if (ws.readyState === 1 /* OPEN */) {
            ws.send(JSON.stringify(message));
        }
    }

    startBattle(competitionId: string, requesterId: string): Competition {
        const competition = findById<Competition>(COMPETITIONS_FILE, competitionId);
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

        const updated = updateById<Competition>(COMPETITIONS_FILE, competitionId, { battle })!;
        this.scheduleAdvance(competitionId, DEFAULT_ENTRY_DURATION_MS);
        this.broadcastEntryAdvance(updated, 0);
        return updated;
    }

    private scheduleAdvance(competitionId: string, delayMs: number): void {
        const existing = this.timers.get(competitionId);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            this.advanceEntry(competitionId);
        }, delayMs);
        this.timers.set(competitionId, timer);
    }

    private advanceEntry(competitionId: string): void {
        const competition = findById<Competition>(COMPETITIONS_FILE, competitionId);
        if (!competition?.battle || competition.battle.status !== 'active') return;

        const nextIndex = competition.battle.currentIndex + 1;

        if (nextIndex >= competition.battle.shuffledFileIds.length) {
            this.completeBattle(competition);
            return;
        }

        const now = new Date().toISOString();
        const updatedBattle: BattleState = {
            ...competition.battle,
            currentIndex: nextIndex,
            entryStartedAt: now,
        };

        const updated = updateById<Competition>(COMPETITIONS_FILE, competitionId, { battle: updatedBattle })!;
        this.scheduleAdvance(competitionId, updatedBattle.entryDurationMs);
        this.broadcastEntryAdvance(updated, nextIndex);
    }

    private completeBattle(competition: Competition): void {
        const completedBattle: BattleState = {
            ...competition.battle!,
            status: 'complete',
        };

        // Write average ratings back to files
        const averages = VoteService.getAverages(competition.id);
        const updatedFiles = competition.files.map((f) => ({
            ...f,
            rating: averages[f.id] ?? null,
        }));

        updateById<Competition>(COMPETITIONS_FILE, competition.id, {
            battle: completedBattle,
            files: updatedFiles,
        });

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
        };

        this.broadcast(competition.id, { type: 'ENTRY_ADVANCE', payload });
    }

    /** Send the current battle state to a single newly-connected client */
    sendCurrentState(ws: AuthenticatedWS, competition: Competition): void {
        const battle = competition.battle;
        if (!battle || battle.status === 'complete') return;

        const fileId = battle.shuffledFileIds[battle.currentIndex] as string | undefined;
        if (!fileId) return;
        const file = competition.files.find((f) => f.id === fileId);
        if (!file) return;

        const payload: BattleStatePayload = {
            status: battle.status,
            currentIndex: battle.currentIndex,
            totalEntries: battle.shuffledFileIds.length,
            fileId,
            fileUrl: getFileUrl(file.s3Key),
            uploaderId: file.uploaderId,
            entryStartedAt: battle.entryStartedAt,
            entryDurationMs: battle.entryDurationMs,
        };

        this.send(ws, { type: 'BATTLE_STATE', payload });
    }

    /** Called at server startup to re-arm timers for any battles that were active */
    rehydrate(): void {
        let competitions: Competition[] = [];
        try {
            const raw = readFileSync(join(process.cwd(), 'data', 'competitions.json'), 'utf-8');
            competitions = JSON.parse(raw);
        } catch {
            return;
        }

        for (const competition of competitions) {
            if (competition.battle?.status === 'active') {
                const { entryStartedAt, entryDurationMs } = competition.battle;
                const elapsed = Date.now() - Date.parse(entryStartedAt);
                const remaining = Math.max(0, entryDurationMs - elapsed);
                console.log(
                    `Rehydrating battle for competition ${competition.id}: ${remaining}ms remaining on current entry`,
                );
                this.scheduleAdvance(competition.id, remaining);
            }
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
