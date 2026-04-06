import { type Collection, type ObjectId } from 'mongodb';
import { type User, type Competition } from '../models/types';
import { getDb } from './client';

// MongoDB document types — string _id replaces the default ObjectId
export type UserDoc = User & { _id: string };
export type CompetitionDoc = Competition & { _id: string };

export interface VoteDoc {
    _id?: ObjectId;
    competitionId: string;
    fileId: string;
    userId: string;
    rating: number;
    createdAt: Date;
}

export function usersCollection(): Collection<UserDoc> {
    return getDb().collection<UserDoc>('users');
}

export function competitionsCollection(): Collection<CompetitionDoc> {
    return getDb().collection<CompetitionDoc>('competitions');
}

export function votesCollection(): Collection<VoteDoc> {
    return getDb().collection<VoteDoc>('votes');
}

export async function createIndexes(): Promise<void> {
    const users = usersCollection();
    const competitions = competitionsCollection();
    const votes = votesCollection();

    await Promise.all([
        users.createIndex({ username: 1 }, { unique: true }),
        users.createIndex({ email: 1 }, { unique: true }),

        competitions.createIndex({ members: 1 }),
        competitions.createIndex({ 'battle.status': 1 }),

        votes.createIndex({ competitionId: 1, fileId: 1, userId: 1 }, { unique: true }),
        votes.createIndex({ competitionId: 1 }),
    ]);

    console.log('MongoDB indexes ensured');
}
