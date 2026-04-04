import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { type BattleVotes } from '../models/types';

const VOTES_FILE = join(process.cwd(), 'data', 'votes.json');

function readVotes(): BattleVotes[] {
    try {
        const content = readFileSync(VOTES_FILE, 'utf-8');
        return JSON.parse(content);
    } catch {
        return [];
    }
}

function writeVotes(data: BattleVotes[]): void {
    writeFileSync(VOTES_FILE, JSON.stringify(data, null, 2));
}

function getOrCreate(competitionId: string): { record: BattleVotes; all: BattleVotes[] } {
    const all = readVotes();
    let record = all.find((v) => v.competitionId === competitionId);
    if (!record) {
        record = { competitionId, votes: {} };
        all.push(record);
    }
    return { record, all };
}

export class VoteService {
    static setVote(competitionId: string, fileId: string, userId: string, rating: number): void {
        const { record, all } = getOrCreate(competitionId);
        if (!record.votes[fileId]) {
            record.votes[fileId] = {};
        }
        record.votes[fileId][userId] = rating;
        writeVotes(all);
    }

    static removeVote(competitionId: string, fileId: string, userId: string): void {
        const { record, all } = getOrCreate(competitionId);
        if (record.votes[fileId]) {
            delete record.votes[fileId][userId];
        }
        writeVotes(all);
    }

    static getVotesForFile(competitionId: string, fileId: string): Record<string, number> {
        const { record } = getOrCreate(competitionId);
        return record.votes[fileId] ?? {};
    }

    /** Returns a map of fileId → average rating (only for files that have votes) */
    static getAverages(competitionId: string): Record<string, number> {
        const { record } = getOrCreate(competitionId);
        const averages: Record<string, number> = {};
        for (const [fileId, userVotes] of Object.entries(record.votes)) {
            const values = Object.values(userVotes);
            if (values.length > 0) {
                averages[fileId] = values.reduce((sum, v) => sum + v, 0) / values.length;
            }
        }
        return averages;
    }
}
