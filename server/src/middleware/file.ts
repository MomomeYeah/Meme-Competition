import { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { ValidationError } from "../utils/errors";
import { validateImageFile } from "../utils/file-validation";

// multer setup for memory storage
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB
const ALLOWED_IMAGE_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/bmp",
];

export const fileUploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
            cb(new ValidationError("Invalid file type. Only common image formats are allowed."));
        }

        cb(null, true);
    },
});

export function fileValidationMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!req || !req.file || !req.file.buffer) {
        throw new ValidationError("No file uploaded");
    }

    const buffer = req.file.buffer;
    if (buffer.length === 0) {
        throw new ValidationError("File is empty");
    }

    if (buffer.length < 12) {
        throw new ValidationError("File is too small to be a valid image");
    }

    // Validate that the file is actually a valid image by checking magic bytes
    if (!validateImageFile(buffer)) {
        throw new ValidationError("File content does not match any supported image format");
    }

    next();
}
