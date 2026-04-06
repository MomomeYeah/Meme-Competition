import { type Competition, type CompetitionFile } from '../models/types';
import { competitionsCollection } from '../db/collections';
import { ValidationError, NotFoundError } from '../utils/errors';
import { generateId } from '../utils/generate-id';
import { VoteService } from './VoteService';
import { battleManager } from './BattleManager';

export class CompetitionService {
    static async createCompetition(title: string, ownerId: string): Promise<Competition> {
        if (!title || title.trim().length === 0) {
            throw new ValidationError('Title is required');
        }

        const id = generateId();
        const doc = {
            _id: id,
            id,
            title: title.trim(),
            owner: ownerId,
            createdAt: new Date().toISOString(),
            members: [ownerId],
            files: [] as CompetitionFile[],
            battle: null,
        };

        await competitionsCollection().insertOne(doc);
        return doc;
    }

    static async getCompetitionById(id: string): Promise<Competition> {
        const competition = await competitionsCollection().findOne({ _id: id });

        if (!competition) {
            throw new NotFoundError('Competition not found');
        }

        return competition;
    }

    static async getCompetitionsByMember(userId: string): Promise<Competition[]> {
        return competitionsCollection().find({ members: userId }).toArray();
    }

    static async joinCompetition(competitionId: string, userId: string): Promise<Competition> {
        const competition = await competitionsCollection().findOneAndUpdate(
            { _id: competitionId },
            { $addToSet: { members: userId } },
            { returnDocument: 'after' },
        );

        if (!competition) {
            throw new NotFoundError('Competition not found');
        }

        return competition;
    }

    static readonly MAX_ENTRIES_PER_USER = 3;

    static async addFileToCompetition(competitionId: string, file: CompetitionFile): Promise<Competition> {
        // Check per-user entry limit before attempting the update.
        const existing = await competitionsCollection().findOne({ _id: competitionId });
        if (!existing) throw new NotFoundError('Competition not found');

        const userFileCount = existing.files.filter(f => f.uploaderId === file.uploaderId).length;
        if (userFileCount >= CompetitionService.MAX_ENTRIES_PER_USER) {
            throw new ValidationError(`You have reached the maximum of ${CompetitionService.MAX_ENTRIES_PER_USER} entries. Remove one or more submissions to upload more.`);
        }

        // Combine the existence + battle-status guard with the update atomically so
        // a concurrent startBattle cannot slip through between the two operations.
        const competition = await competitionsCollection().findOneAndUpdate(
            {
                _id: competitionId,
                'battle.status': { $nin: ['active', 'complete'] },
                $expr: {
                    $lt: [
                        { $size: { $filter: { input: '$files', as: 'f', cond: { $eq: ['$$f.uploaderId', file.uploaderId] } } } },
                        CompetitionService.MAX_ENTRIES_PER_USER,
                    ],
                },
            },
            { $push: { files: file } },
            { returnDocument: 'after' },
        );

        if (!competition) {
            const latest = await competitionsCollection().findOne({ _id: competitionId });
            if (!latest) throw new NotFoundError('Competition not found');
            const latestUserCount = latest.files.filter(f => f.uploaderId === file.uploaderId).length;
            if (latestUserCount >= CompetitionService.MAX_ENTRIES_PER_USER) {
                throw new ValidationError(`You have reached the maximum of ${CompetitionService.MAX_ENTRIES_PER_USER} entries. Remove one or more submissions to upload more.`);
            }
            throw new ValidationError('Cannot upload entries once the battle has started');
        }

        return competition;
    }

    static async removeFileFromCompetition(competitionId: string, fileId: string): Promise<Competition> {
        const competition = await competitionsCollection().findOneAndUpdate(
            { _id: competitionId },
            { $pull: { files: { id: fileId } } },
            { returnDocument: 'after' },
        );

        if (!competition) {
            throw new NotFoundError('Competition not found');
        }

        return competition;
    }

    static async deleteCompetition(competitionId: string, requesterId: string): Promise<void> {
        const competition = await competitionsCollection().findOne({ _id: competitionId });

        if (!competition) {
            throw new NotFoundError('Competition not found');
        }

        if (competition.owner !== requesterId) {
            throw new ValidationError('Only the owner can delete this competition');
        }

        // Cancel any active battle timer before removing the document so the
        // in-memory timer map does not leak for the lifetime of the process.
        if (competition.battle?.status === 'active') {
            battleManager.cancelBattle(competitionId);
        }

        await competitionsCollection().deleteOne({ _id: competitionId });
        await VoteService.deleteVotes(competitionId);
    }

    static async relinquishOwnership(competitionId: string, requesterId: string): Promise<Competition> {
        const updated = await competitionsCollection().findOneAndUpdate(
            { _id: competitionId, owner: requesterId, 'battle.status': { $nin: ['active', 'complete'] } },
            { $set: { owner: null } },
            { returnDocument: 'after' },
        );

        if (!updated) {
            const competition = await competitionsCollection().findOne({ _id: competitionId });
            if (!competition) throw new NotFoundError('Competition not found');
            if (competition.owner !== requesterId) throw new ValidationError('Only the owner can relinquish ownership');
            throw new ValidationError('Cannot relinquish ownership once the battle has started');
        }

        return updated;
    }

    static async claimOwnership(competitionId: string, userId: string): Promise<Competition> {
        const updated = await competitionsCollection().findOneAndUpdate(
            { _id: competitionId, owner: null, members: userId, 'battle.status': { $nin: ['active', 'complete'] } },
            { $set: { owner: userId } },
            { returnDocument: 'after' },
        );

        if (!updated) {
            const competition = await competitionsCollection().findOne({ _id: competitionId });
            if (!competition) throw new NotFoundError('Competition not found');
            if (competition.owner !== null) throw new ValidationError('Competition already has an owner');
            if (!competition.members.includes(userId)) throw new ValidationError('Only a member can claim ownership');
            throw new ValidationError('Cannot claim ownership once the battle has started');
        }

        return updated;
    }
}
