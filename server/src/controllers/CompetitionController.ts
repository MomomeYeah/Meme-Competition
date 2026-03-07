import { type Request, type Response } from 'express';
import { CompetitionService } from '../services/CompetitionService';
import { type ApiResponse } from '../models/types';

export class CompetitionController {
    static async createCompetition(req: Request, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, error: 'Not authenticated' });
                return;
            }
            
            const { title } = req.body;
            const competition = CompetitionService.createCompetition(title, req.user.userId);
            
            const response: ApiResponse = {
                success: true,
                data: competition,
            };
            
            res.status(201).json(response);
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }
    
    static async getCompetitionById(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            if (!id) {
                res.status(400).json({ success: false, error: 'Competition ID is required' });
                return;
            }
            if (typeof id !== 'string' || id.trim().length === 0) {
                res.status(400).json({ success: false, error: 'Invalid competition ID' });
                return;
            }
            const competition = CompetitionService.getCompetitionById(id);
            
            res.json({ success: true, data: competition });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }
    
    static async getAllCompetitions(req: Request, res: Response): Promise<void> {
        try {
            const competitions = CompetitionService.getAllCompetitions();
            res.json({ success: true, data: competitions });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }
    
    static async getUserCompetitions(req: Request, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, error: 'Not authenticated' });
                return;
            }
            
            const { userId } = req.params;
            if (!userId) {
                res.status(400).json({ success: false, error: 'User ID is required' });
                return;
            }
            if (typeof userId !== 'string' || userId.trim().length === 0) {
                res.status(400).json({ success: false, error: 'Invalid user ID' });
                return;
            }
            const owned = CompetitionService.getCompetitionsByOwner(userId);
            const joined = CompetitionService.getCompetitionsByMember(userId);
            
            res.json({
                success: true,
                data: {
                    owned,
                    joined: joined.filter((c) => c.owner !== userId), // Remove competitions they own
                },
            });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }
    
    static async joinCompetition(req: Request, res: Response): Promise<void> {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, error: 'Not authenticated' });
                return;
            }
            
            const { id } = req.params;
            if (!id) {
                res.status(400).json({ success: false, error: 'Competition ID is required' });
                return;
            }
            if (typeof id !== 'string' || id.trim().length === 0) {
                res.status(400).json({ success: false, error: 'Invalid competition ID' });
                return;
            }
            const competition = CompetitionService.joinCompetition(id, req.user.userId);
            
            res.json({ success: true, data: competition });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }
    
    private static handleError(error: any, res: Response): void {
        if (error.statusCode) {
            res.status(error.statusCode).json({ success: false, error: error.message });
        } else {
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }
}
