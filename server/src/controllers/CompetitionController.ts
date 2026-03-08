import { type Request, type Response } from "express";
import { CompetitionService } from "../services/CompetitionService";
import { type ApiResponse } from "../models/types";

export class CompetitionController {
    static async createCompetition(req: Request, res: Response): Promise<void> {
        try {
            // user is guaranteed to exist because of authMiddleware
            const userId = req.user!.userId;

            const { title } = req.body;
            const competition = CompetitionService.createCompetition(title, userId);

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
            // user is guaranteed to exist because of authMiddleware
            const userId = req.user!.userId;

            const { id } = req.params;
            if (!id) {
                res.status(400).json({ success: false, error: "Competition ID is required" });
                return;
            }
            if (typeof id !== "string" || id.trim().length === 0) {
                res.status(400).json({ success: false, error: "Invalid competition ID" });
                return;
            }
            const competition = CompetitionService.getCompetitionById(id);

            // ensure the requesting user is a member
            if (!competition.members.includes(userId)) {
                res.status(403).json({ success: false, error: "Access denied" });
                return;
            }

            res.json({ success: true, data: competition });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    static async getUserCompetitions(req: Request, res: Response): Promise<void> {
        try {
            // user is guaranteed to exist because of authMiddleware
            const userId = req.user!.userId;
            const competitions = CompetitionService.getCompetitionsByMember(userId);

            res.json({
                success: true,
                data: {
                    competitions: competitions,
                },
            });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    static async joinCompetition(req: Request, res: Response): Promise<void> {
        try {
            // user is guaranteed to exist because of authMiddleware
            const userId = req.user!.userId;

            const { id } = req.params;
            if (!id) {
                res.status(400).json({ success: false, error: "Competition ID is required" });
                return;
            }
            if (typeof id !== "string" || id.trim().length === 0) {
                res.status(400).json({ success: false, error: "Invalid competition ID" });
                return;
            }
            const competition = CompetitionService.joinCompetition(id, userId);

            res.json({ success: true, data: competition });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    static async deleteCompetition(req: Request, res: Response): Promise<void> {
        try {
            // user is guaranteed to exist because of authMiddleware
            const userId = req.user!.userId;

            const { id } = req.params;
            if (!id) {
                res.status(400).json({ success: false, error: "Competition ID is required" });
                return;
            }
            if (typeof id !== "string" || id.trim().length === 0) {
                res.status(400).json({ success: false, error: "Invalid competition ID" });
                return;
            }

            CompetitionService.deleteCompetition(id, userId);
            res.status(204).send();
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    private static handleError(error: any, res: Response): void {
        if (error.statusCode) {
            res.status(error.statusCode).json({ success: false, error: error.message });
        } else {
            res.status(500).json({ success: false, error: "Internal server error" });
        }
    }
}
