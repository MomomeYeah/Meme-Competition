import { Router } from "express";
import multer from "multer";
import { CompetitionController } from "../controllers/CompetitionController";
import { authMiddleware } from "../middleware/auth";

// multer setup for memory storage
const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

router.post("/", authMiddleware, CompetitionController.createCompetition);
router.get("/", authMiddleware, CompetitionController.getUserCompetitions);
router.get("/:id", authMiddleware, CompetitionController.getCompetitionById);
router.post("/:id/join", authMiddleware, CompetitionController.joinCompetition);
router.delete("/:id", authMiddleware, CompetitionController.deleteCompetition);
router.post("/:id/relinquish", authMiddleware, CompetitionController.relinquishOwnership);
router.post("/:id/claim", authMiddleware, CompetitionController.claimOwnership);

// list files uploaded by current user
router.get("/:id/files", authMiddleware, CompetitionController.listFiles);

// upload arbitrary file for competition members (multipart/form-data)
router.post("/:id/files", authMiddleware, upload.single("file"), CompetitionController.uploadFile);

// delete a file belonging to current user
// fileId is the full S3 key (URL-encoded)
router.delete("/:id/files/:fileId", authMiddleware, CompetitionController.deleteUserFile);

export default router;
