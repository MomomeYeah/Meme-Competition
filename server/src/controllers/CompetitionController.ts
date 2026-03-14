import { type Request, type Response } from "express";
import { CompetitionService } from "../services/CompetitionService";
import { type ApiResponse, type CompetitionUserFile } from "../models/types";
import { generateId } from "../utils/generate-id";
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
            const userId = req.user!.userId;
            const id = req.params.id as string;
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
            const id = req.params.id as string;
            const competition = CompetitionService.joinCompetition(id, userId);

            res.json({ success: true, data: competition });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    static async deleteCompetition(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const id = req.params.id as string;

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
            const id = req.params.id as string;

            const comp = CompetitionService.relinquishOwnership(id, userId);
            res.json({ success: true, data: comp });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    static async claimOwnership(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const id = req.params.id as string;

            const comp = CompetitionService.claimOwnership(id, userId);
            res.json({ success: true, data: comp });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    // TODO: lambda function to generate thumbnail images for UI
    static async uploadFile(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const id = req.params.id as string;

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

            // prefix with competition id and user id to help organization
            const key = await s3.uploadFile(`${id}/${userId}/`, file.buffer);

            const fileEntry = {
                id: generateId(),
                name: file.originalname,
                uploaderId: userId,
                uploadedAt: new Date().toISOString(),
                rating: null,
                s3Key: key,
            };
            CompetitionService.addFileToCompetition(id, fileEntry);

            res.json({ success: true, data: { file: fileEntry } });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    // return list of files uploaded by the current user for a competition
    static async listFiles(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const id = req.params.id as string;

            const competition = CompetitionService.getCompetitionById(id);
            if (!competition.members.includes(userId)) {
                res.status(403).json({ success: false, error: "Access denied" });
                return;
            }

            const userFiles: CompetitionUserFile[] = [];
            for (const file of competition.files ?? []) {
                if (file.uploaderId === userId) {
                    userFiles.push({
                        id: file.id,
                        name: file.name,
                        uploadedAt: file.uploadedAt,
                        rating: file.rating,
                        url: s3.getFileUrl(file.s3Key),
                    });
                }
            }

            res.json({ success: true, data: { files: userFiles } });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    // delete a previously uploaded file for the current user
    static async deleteUserFile(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const id = req.params.id as string;
            const fileId = req.params.fileId as string;

            const competition = CompetitionService.getCompetitionById(id);
            if (!competition.members.includes(userId)) {
                res.status(403).json({ success: false, error: "Access denied" });
                return;
            }

            const decodedFileId = decodeURIComponent(fileId);
            const file = competition.files.find((f) => f.id === decodedFileId);
            if (!file) {
                res.status(404).json({ success: false, error: "File not found" });
                return;
            }

            if (file.uploaderId !== userId) {
                res.status(403).json({
                    success: false,
                    error: "Cannot delete file you do not own",
                });
                return;
            }

            await s3.deleteFile(file.s3Key);
            CompetitionService.removeFileFromCompetition(id, fileId);
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
