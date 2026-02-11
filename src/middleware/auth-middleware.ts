// =============================================================================
// Graphene: Authentication and Authorization Middleware
// =============================================================================

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import type { JWTPayload } from '../types/api.js';
import { getSupabase } from '../services/supabase.js';

/**
 * Extended Express Request with authenticated user info.
 */
export interface AuthenticatedRequest extends Request {
    user?: {
        did: string;
        username: string;
        roles: string[];
    };
}

/**
 * Middleware to verify JWT token and attach user info to request.
 */
export async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({
                code: 'UNAUTHORIZED',
                message: 'Missing or invalid authorization header'
            });
            return;
        }

        const token = authHeader.substring(7);

        // Verify JWT
        const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;

        // Fetch user identity with roles from database
        const supabase = getSupabase();
        const { data: identity, error } = await supabase
            .from('identities')
            .select('did, username, roles')
            .eq('did', decoded.sub)
            .single();

        if (error || !identity) {
            res.status(401).json({
                code: 'UNAUTHORIZED',
                message: 'Invalid token or user not found'
            });
            return;
        }

        // Attach user info to request
        (req as AuthenticatedRequest).user = {
            did: identity.did,
            username: identity.username,
            roles: identity.roles || ['user']
        };

        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            res.status(401).json({
                code: 'INVALID_TOKEN',
                message: 'Invalid or expired token'
            });
            return;
        }

        console.error('Auth middleware error:', error);
        res.status(500).json({
            code: 'INTERNAL_ERROR',
            message: 'Authentication failed'
        });
    }
}

/**
 * Middleware to ensure user has moderator or admin role.
 */
export function requireModerator(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user) {
        res.status(401).json({
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
        });
        return;
    }

    const roles = authReq.user.roles;
    const hasModerator = roles.includes('moderator') || roles.includes('admin');

    if (!hasModerator) {
        res.status(403).json({
            code: 'FORBIDDEN',
            message: 'Moderator privileges required'
        });
        return;
    }

    next();
}

/**
 * Middleware to ensure user has admin role.
 */
export function requireAdmin(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user) {
        res.status(401).json({
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
        });
        return;
    }

    const roles = authReq.user.roles;

    if (!roles.includes('admin')) {
        res.status(403).json({
            code: 'FORBIDDEN',
            message: 'Admin privileges required'
        });
        return;
    }

    next();
}
