import { votesCollection } from '../db/collections';

export class VoteService {
    static async setVote(competitionId: string, fileId: string, userId: string, rating: number): Promise<void> {
        await votesCollection().updateOne(
            { competitionId, fileId, userId },
            { $set: { rating, createdAt: new Date() } },
            { upsert: true },
        );
    }

    static async getVotesForFile(competitionId: string, fileId: string): Promise<Record<string, number>> {
        const docs = await votesCollection().find({ competitionId, fileId }).toArray();
        const result: Record<string, number> = {};
        for (const doc of docs) {
            result[doc.userId] = doc.rating;
        }
        return result;
    }

    static async deleteVotes(competitionId: string): Promise<void> {
        await votesCollection().deleteMany({ competitionId });
    }

    /** Returns a map of fileId → average rating (only for files that have votes) */
    static async getAverages(competitionId: string): Promise<Record<string, number>> {
        const pipeline = [
            { $match: { competitionId } },
            { $group: { _id: '$fileId', avg: { $avg: '$rating' } } },
        ];
        const results = await votesCollection().aggregate<{ _id: string; avg: number }>(pipeline).toArray();
        const averages: Record<string, number> = {};
        for (const { _id, avg } of results) {
            averages[_id] = avg;
        }
        return averages;
    }
}
