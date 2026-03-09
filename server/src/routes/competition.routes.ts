import { Router } from "express";
import { CompetitionController } from "../controllers/CompetitionController";
import { authMiddleware } from "../middleware/auth";

const router = Router();

router.post("/", authMiddleware, CompetitionController.createCompetition);
router.get("/", authMiddleware, CompetitionController.getUserCompetitions);
router.get("/:id", authMiddleware, CompetitionController.getCompetitionById);
router.post("/:id/join", authMiddleware, CompetitionController.joinCompetition);
router.delete("/:id", authMiddleware, CompetitionController.deleteCompetition);
router.post("/:id/relinquish", authMiddleware, CompetitionController.relinquishOwnership);
router.post("/:id/claim", authMiddleware, CompetitionController.claimOwnership);

export default router;
