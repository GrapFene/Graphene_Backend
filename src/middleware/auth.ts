
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { verifyEnvelopeSignature, resolvePeerAddress } from '../lib/federation/crypto.js';

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
    // user action (e.g. post creation) on behalf of a user from another server.
    // Verified by checking the federation signature against the peer's public key.
    // -------------------------------------------------------------------------
    const isFederationForward = req.headers['x-federation-forward'] === 'true';
    if (isFederationForward) {
        const senderDomain = req.headers['x-federation-domain'] as string;
        const signature    = req.headers['x-federation-signature'] as string;
        const authorDid    = req.headers['x-author-did'] as string;

        if (!senderDomain || !signature || !authorDid) {
            return res.status(401).json({ error: { message: 'Incomplete federation forward headers' } });
        }

        // Async: resolve peer address then verify signature
        resolvePeerAddress(senderDomain).then(async (peerAddress) => {
            if (!peerAddress) {
                return res.status(403).json({ error: { message: `Cannot resolve federation actor for: ${senderDomain}` } });
            }

            const bodyPayload = req.body;
            const valid = await verifyEnvelopeSignature(bodyPayload, signature, peerAddress);
            if (!valid) {
                return res.status(403).json({ error: { message: 'Federation forward signature invalid' } });
            }

            // Inject author DID as the authenticated user
            (req as AuthRequest).user = { sub: authorDid, username: authorDid, role: 'user' };
            next();
        }).catch(() => {
            return res.status(500).json({ error: { message: 'Federation forward verification error' } });
        });

        return; // wait for async resolution above
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
