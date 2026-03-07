import { type Request, type Response, type NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { AuthError } from '../utils/errors';
import { type JwtPayload } from '../models/types';

declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    try {
        let token: string | undefined;

        // If no header, look for the httpOnly cookie
        if (req.cookies && typeof req.cookies.jwt === 'string') {
            token = req.cookies.jwt;
        }

        if (!token) {
            throw new AuthError('Missing authorization token');
        }

        const payload = verifyToken(token);
        req.user = payload;
        next();
    } catch (error) {
        if (error instanceof AuthError) {
            res.status(401).json({ success: false, error: error.message });
        } else {
            res.status(401).json({ success: false, error: 'Unauthorized' });
        }
    }
}