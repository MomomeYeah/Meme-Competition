import { type Competition, type CompetitionFile } from "../models/types";
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
            files: [],
        };

        return create(COMPETITIONS_FILE, competition);
    }

    static addFileToCompetition(competitionId: string, file: CompetitionFile): Competition {
        const competition = findById<Competition>(COMPETITIONS_FILE, competitionId);
        if (!competition) {
            throw new NotFoundError("Competition not found");
        }

        const files = competition.files ?? [];
        files.push(file);
        return updateById<Competition>(COMPETITIONS_FILE, competitionId, { files })!;
    }

    static removeFileFromCompetition(competitionId: string, fileId: string): Competition {
        const competition = findById<Competition>(COMPETITIONS_FILE, competitionId);
        if (!competition) {
            throw new NotFoundError("Competition not found");
        }

        const files = competition.files ?? [];
        const updatedFiles = files.filter((file) => file.id !== fileId);

        return updateById<Competition>(COMPETITIONS_FILE, competitionId, { files: updatedFiles })!;
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

    static relinquishOwnership(competitionId: string, requesterId: string): Competition {
        const competition = findById<Competition>(COMPETITIONS_FILE, competitionId);
        if (!competition) {
            throw new NotFoundError("Competition not found");
        }
        if (competition.owner !== requesterId) {
            throw new ValidationError("Only the owner can relinquish ownership");
        }
        competition.owner = null;
        updateById<Competition>(COMPETITIONS_FILE, competitionId, {
            owner: null,
        });
        return competition;
    }

    static claimOwnership(competitionId: string, userId: string): Competition {
        const competition = findById<Competition>(COMPETITIONS_FILE, competitionId);
        if (!competition) {
            throw new NotFoundError("Competition not found");
        }
        if (competition.owner !== null) {
            throw new ValidationError("Competition already has an owner");
        }
        if (!competition.members.includes(userId)) {
            throw new ValidationError("Only a member can claim ownership");
        }
        competition.owner = userId;
        updateById<Competition>(COMPETITIONS_FILE, competitionId, {
            owner: userId,
        });
        return competition;
    }
}
