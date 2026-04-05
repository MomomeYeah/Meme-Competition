import { type Request, type Response } from 'express';
import { type ApiResponse } from '../models/types';
import { battleManager } from '../services/BattleManager';
import { AppError } from '../utils/errors';

export class BattleController {
    static startBattle(req: Request, res: Response): void {
        try {
            const userId = req.user!.userId;
            const competitionId = req.params.id as string;

            const competition = battleManager.startBattle(competitionId, userId);

            const response: ApiResponse = { success: true, data: competition };
            res.status(200).json(response);
        } catch (error) {
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, error: error.message });
            } else {
                console.error('Unexpected error in startBattle:', error);
                res.status(500).json({ success: false, error: 'Internal server error' });
            }
        }
    }
}
