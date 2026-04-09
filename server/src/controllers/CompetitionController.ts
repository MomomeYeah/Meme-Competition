import { type Request, type Response } from "express";
import { CompetitionService } from "../services/CompetitionService";
import { type ApiResponse, type CompetitionUserFile } from "../models/types";
import { generateId } from "../utils/generate-id";
import * as s3 from "../utils/s3-client";
import { AppError } from "../utils/errors";
import { usersCollection } from "../db/collections";

export class CompetitionController {
    static async createCompetition(req: Request, res: Response): Promise<void> {
        try {
            // user is guaranteed to exist because of authMiddleware
            const userId = req.user!.userId;

            const { title } = req.body;
            const competition = await CompetitionService.createCompetition(title, userId);

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
            const competition = await CompetitionService.getCompetitionById(id);

            // ensure the requesting user is a member
            if (!competition.members.includes(userId)) {
                res.status(403).json({ success: false, error: "Access denied" });
                return;
            }

            // Augment files with public URLs for display
            const filesWithUrls = (competition.files ?? []).map((f) => ({
                ...f,
                url: s3.getFileUrl(f.s3Key),
            }));

            // Resolve member IDs to usernames for display in the lobby
            const memberDocs = await usersCollection()
                .find({ _id: { $in: competition.members } }, { projection: { _id: 1, username: 1 } })
                .toArray() as { _id: string; username: string }[];
            const memberDetails = competition.members.map((mid) => ({
                id: mid,
                username: memberDocs.find((u) => u._id === mid)?.username ?? mid,
            }));

            res.json({ success: true, data: { ...competition, files: filesWithUrls, memberDetails } });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    static async getUserCompetitions(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const competitions = await CompetitionService.getCompetitionsByMember(userId);

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
            const competition = await CompetitionService.joinCompetition(id, userId);

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
            await CompetitionService.deleteCompetition(id, userId);
            res.status(204).send();
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    static async relinquishOwnership(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const id = req.params.id as string;

            const comp = await CompetitionService.relinquishOwnership(id, userId);
            res.json({ success: true, data: comp });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    static async claimOwnership(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const id = req.params.id as string;

            const comp = await CompetitionService.claimOwnership(id, userId);
            res.json({ success: true, data: comp });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    static async uploadFile(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const id = req.params.id as string;

            const competition = await CompetitionService.getCompetitionById(id);
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
            await CompetitionService.addFileToCompetition(id, fileEntry);

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

            const competition = await CompetitionService.getCompetitionById(id);
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

            const competition = await CompetitionService.getCompetitionById(id);
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
            await CompetitionService.removeFileFromCompetition(id, fileId);
            res.json({ success: true });
        } catch (error) {
            CompetitionController.handleError(error, res);
        }
    }

    private static handleError(error: unknown, res: Response): void {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ success: false, error: error.message });
        } else {
            console.error("Unexpected error:", error);
            res.status(500).json({ success: false, error: "Internal server error" });
        }
    }
}
