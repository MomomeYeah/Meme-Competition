import { type Competition, type CompetitionFile } from '../models/types';
import { competitionsCollection } from '../db/collections';
import { ValidationError, NotFoundError } from '../utils/errors';
import { generateId } from '../utils/generate-id';
import { VoteService } from './VoteService';

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

    static async addFileToCompetition(competitionId: string, file: CompetitionFile): Promise<Competition> {
        const existing = await competitionsCollection().findOne({ _id: competitionId });
        if (!existing) {
            throw new NotFoundError('Competition not found');
        }
        if (existing.battle?.status === 'active' || existing.battle?.status === 'complete') {
            throw new ValidationError('Cannot upload entries once the battle has started');
        }

        const competition = await competitionsCollection().findOneAndUpdate(
            { _id: competitionId },
            { $push: { files: file } },
            { returnDocument: 'after' },
        );

        return competition!;
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

        await competitionsCollection().deleteOne({ _id: competitionId });
        await VoteService.deleteVotes(competitionId);
    }

    static async relinquishOwnership(competitionId: string, requesterId: string): Promise<Competition> {
        const competition = await competitionsCollection().findOne({ _id: competitionId });
        if (!competition) {
            throw new NotFoundError('Competition not found');
        }
        if (competition.owner !== requesterId) {
            throw new ValidationError('Only the owner can relinquish ownership');
        }
        if (competition.battle?.status === 'active' || competition.battle?.status === 'complete') {
            throw new ValidationError('Cannot relinquish ownership once the battle has started');
        }

        const updated = await competitionsCollection().findOneAndUpdate(
            { _id: competitionId },
            { $set: { owner: null } },
            { returnDocument: 'after' },
        );

        return updated!;
    }

    static async claimOwnership(competitionId: string, userId: string): Promise<Competition> {
        const competition = await competitionsCollection().findOne({ _id: competitionId });
        if (!competition) {
            throw new NotFoundError('Competition not found');
        }
        if (competition.owner !== null) {
            throw new ValidationError('Competition already has an owner');
        }
        if (!competition.members.includes(userId)) {
            throw new ValidationError('Only a member can claim ownership');
        }
        if (competition.battle?.status === 'active' || competition.battle?.status === 'complete') {
            throw new ValidationError('Cannot claim ownership once the battle has started');
        }

        const updated = await competitionsCollection().findOneAndUpdate(
            { _id: competitionId },
            { $set: { owner: userId } },
            { returnDocument: 'after' },
        );

        return updated!;
    }
}
