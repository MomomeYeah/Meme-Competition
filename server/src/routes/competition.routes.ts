import { Router } from 'express';
import { CompetitionController } from '../controllers/CompetitionController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/', authMiddleware, CompetitionController.createCompetition);
router.get('/', authMiddleware, CompetitionController.getAllCompetitions);
router.get('/:id', authMiddleware, CompetitionController.getCompetitionById);
router.get('/user/:userId', authMiddleware, CompetitionController.getUserCompetitions);
router.post('/:id/join', authMiddleware, CompetitionController.joinCompetition);

export default router;
