import { type Competition } from "../models/types";
import { findById, filterByProperty, create, updateById, deleteById } from "../utils/json-db";
import { ValidationError, NotFoundError } from "../utils/errors";
import { generateId } from "../utils/generate-id";

const COMPETITIONS_FILE = "competitions.json";

export class CompetitionService {
    static createCompetition(title: string, ownerId: string): Competition {
        if (!title || title.trim().length === 0) {
            throw new ValidationError("Title is required");
        }

        const competition: Competition = {
            id: generateId(),
            title: title.trim(),
            owner: ownerId,
            createdAt: new Date().toISOString(),
            members: [ownerId],
        };

        return create(COMPETITIONS_FILE, competition);
    }

    static getCompetitionById(id: string): Competition {
        const competition = findById<Competition>(COMPETITIONS_FILE, id);

        if (!competition) {
            throw new NotFoundError("Competition not found");
        }

        return competition;
    }

    static getCompetitionsByMember(userId: string): Competition[] {
        return filterByProperty(COMPETITIONS_FILE, "members", userId);
    }

    static joinCompetition(competitionId: string, userId: string): Competition {
        const competition = findById<Competition>(COMPETITIONS_FILE, competitionId);

        if (!competition) {
            throw new NotFoundError("Competition not found");
        }

        if (!competition.members.includes(userId)) {
            competition.members.push(userId);
            updateById<Competition>(COMPETITIONS_FILE, competitionId, {
                members: competition.members,
            });
        }

        return competition;
    }

    static deleteCompetition(competitionId: string, requesterId: string): void {
        const competition = findById<Competition>(COMPETITIONS_FILE, competitionId);

        if (!competition) {
            throw new NotFoundError("Competition not found");
        }

        if (competition.owner !== requesterId) {
            throw new ValidationError("Only the owner can delete this competition");
        }

        deleteById<Competition>(COMPETITIONS_FILE, competitionId);
    }
}
