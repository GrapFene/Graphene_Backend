
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
    // -------------------------------------------------------------------------
    // Federation-forwarded requests: a trusted peer instance is forwarding a
    // user action on behalf of a user from another server.
    // We trust the X-Author-Did header and let it through directly.
    // -------------------------------------------------------------------------
    const isFederationForward = req.headers['x-federation-forward'] === 'true';
    if (isFederationForward) {
        const authorDid = req.headers['x-author-did'] as string;
        if (!authorDid) {
            return res.status(401).json({ error: { message: 'Missing X-Author-Did header' } });
        }
        (req as AuthRequest).user = { sub: authorDid, username: authorDid, role: 'user' };
        return next();
    }

    // -------------------------------------------------------------------------
    // Normal JWT auth
    // -------------------------------------------------------------------------
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
