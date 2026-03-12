import { type Request, type Response } from "express";
import { CompetitionService } from "../services/CompetitionService";
import { type ApiResponse } from "../models/types";
import * as s3 from "../utils/s3-client";

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

            await s3.deleteFilesWithPrefix(id);
            CompetitionService.deleteCompetition(id, userId);
            res.status(204).send();
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    static async relinquishOwnership(req: Request, res: Response): Promise<void> {
        try {
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

            const comp = CompetitionService.relinquishOwnership(id, userId);
            res.json({ success: true, data: comp });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    static async claimOwnership(req: Request, res: Response): Promise<void> {
        try {
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

            const comp = CompetitionService.claimOwnership(id, userId);
            res.json({ success: true, data: comp });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    // allow members of a competition to upload a file to S3
    // TODO: what metadata do we need to keep per file?
    //  - ID
    //  - filename
    //  - file type
    //  - S3 key
    //  - uploader user ID
    //  - competition ID
    //  - upload timestamp
    //  - rating
    static async uploadFile(req: Request, res: Response): Promise<void> {
        try {
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
            if (!competition.members.includes(userId)) {
                res.status(403).json({ success: false, error: "Access denied" });
                return;
            }

            // multer should have populated req.file
            const file: Express.Multer.File | undefined = req.file;
            if (!file) {
                res.status(400).json({ success: false, error: "No file uploaded" });
                return;
            }

            const buffer = file.buffer as Buffer;
            // prefix with competition id and user id to help organization
            const key = await s3.uploadFile(`${id}/${userId}/`, buffer);

            res.json({ success: true, data: { key } });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    // return list of files uploaded by the current user for a competition
    static async listFiles(req: Request, res: Response): Promise<void> {
        try {
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
            if (!competition.members.includes(userId)) {
                res.status(403).json({ success: false, error: "Access denied" });
                return;
            }

            const prefix = `${id}/${userId}`;
            const response = await s3.getFilesWithPrefix(prefix);
            const keys: string[] = [];
            if (response.Contents) {
                for (const obj of response.Contents) {
                    if (obj.Key) keys.push(obj.Key);
                }
            }

            res.json({ success: true, data: { keys } });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    // delete a previously uploaded file for the current user
    static async deleteUserFile(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id, fileId } = req.params;

            if (!id) {
                res.status(400).json({ success: false, error: "Competition ID is required" });
                return;
            }
            if (typeof id !== "string" || id.trim().length === 0) {
                res.status(400).json({ success: false, error: "Invalid competition ID" });
                return;
            }
            if (!fileId || typeof fileId !== "string") {
                res.status(400).json({ success: false, error: "File ID is required" });
                return;
            }

            const competition = CompetitionService.getCompetitionById(id);
            if (!competition.members.includes(userId)) {
                res.status(403).json({ success: false, error: "Access denied" });
                return;
            }

            const decodedKey = decodeURIComponent(fileId);
            const prefix = `${id}/${userId}`;
            if (!decodedKey.startsWith(prefix)) {
                res.status(403).json({ success: false, error: "Cannot delete file you do not own" });
                return;
            }

            await s3.deleteFile(decodedKey);
            res.json({ success: true });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    private static handleError(error: any, res: Response): void {
        if (error.statusCode) {
            res.status(error.statusCode).json({ success: false, error: error.message });
        } else {
            console.log("Unexpected error:", error);
            res.status(500).json({ success: false, error: "Internal server error" });
        }
    }
}
