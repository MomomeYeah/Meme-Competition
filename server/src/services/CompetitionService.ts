import { type Competition } from '../models/types';
import { readJsonFile, writeJsonFile, findById, filterByProperty } from '../utils/json-db';
import { ValidationError, NotFoundError } from '../utils/errors';
import { generateId } from '../utils/generate-id';

const COMPETITIONS_FILE = 'competitions.json';

export class CompetitionService {
    static createCompetition(title: string, ownerId: string): Competition {
        if (!title || title.trim().length === 0) {
            throw new ValidationError('Title is required');
        }
        
        const competitions = readJsonFile<Competition>(COMPETITIONS_FILE);
        
        const competition: Competition = {
            id: generateId(),
            title: title.trim(),
            owner: ownerId,
            createdAt: new Date().toISOString(),
            members: [ownerId],
        };
        
        competitions.push(competition);
        writeJsonFile(COMPETITIONS_FILE, competitions);
        
        return competition;
    }
    
    static getCompetitionById(id: string): Competition {
        const competitions = readJsonFile<Competition>(COMPETITIONS_FILE);
        const competition = findById(competitions, id);
        
        if (!competition) {
            throw new NotFoundError('Competition not found');
        }
        
        return competition;
    }
    
    static getCompetitionsByOwner(ownerId: string): Competition[] {
        const competitions = readJsonFile<Competition>(COMPETITIONS_FILE);
        return filterByProperty(competitions, 'owner', ownerId);
    }
    
    static getCompetitionsByMember(userId: string): Competition[] {
        const competitions = readJsonFile<Competition>(COMPETITIONS_FILE);
        return competitions.filter((c) => c.members.includes(userId));
    }
    
    static getAllCompetitions(): Competition[] {
        return readJsonFile<Competition>(COMPETITIONS_FILE);
    }
    
    static joinCompetition(competitionId: string, userId: string): Competition {
        const competitions = readJsonFile<Competition>(COMPETITIONS_FILE);
        const competition = findById(competitions, competitionId);
        
        if (!competition) {
            throw new NotFoundError('Competition not found');
        }
        
        if (competition.members.includes(userId)) {
            throw new ValidationError('Already a member of this competition');
        }
        
        competition.members.push(userId);
        writeJsonFile(COMPETITIONS_FILE, competitions);
        
        return competition;
    }
}
