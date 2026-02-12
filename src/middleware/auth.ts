
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export interface AuthRequest extends Request {
    user?: {
        sub: string; // DID
        username: string;
        role: string;
    };
}

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: { message: 'Authentication token required' } });
    }

    jwt.verify(token, config.jwt.secret, (err: any, user: any) => {
        if (err) {
            return res.status(403).json({ error: { message: 'Invalid or expired token' } });
        }
        (req as AuthRequest).user = user;
        next();
    });
}
