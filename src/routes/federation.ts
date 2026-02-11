// =============================================================================
// Graphene: Federation Routes
// =============================================================================

import { Router, type Request, Response } from 'express';
import { handleSyncInitiation } from '../services/federation.js';
import type { SyncInitiationRequest } from '../types/moderation-api.js';

const router = Router();

/**
 * POST /federation/sync
 * Initiate federation synchronization.
 * This endpoint validates the source instance against the denylist.
 */
router.post('/sync', async (req: Request, res: Response) => {
    try {
        const request = req.body as SyncInitiationRequest;

        // Validation
        if (!request.source_instance_url || !request.sync_type) {
            res.status(400).json({
                code: 'INVALID_REQUEST',
                message: 'source_instance_url and sync_type are required'
            });
            return;
        }

        // URL validation
        try {
            new URL(request.source_instance_url);
        } catch {
            res.status(400).json({
                code: 'INVALID_URL',
                message: 'source_instance_url must be a valid URL'
            });
            return;
        }

        // Handle sync with blocking enforcement
        await handleSyncInitiation(request);

        res.status(200).json({
            success: true,
            message: 'Sync request accepted'
        });
    } catch (error: any) {
        console.error('Sync initiation error:', error);

        // Check if rejection was due to blocking
        if (error.message?.includes('blocked') || error.message?.includes('rejected')) {
            res.status(403).json({
                code: 'SYNC_BLOCKED',
                message: error.message
            });
            return;
        }

        res.status(500).json({
            code: 'INTERNAL_ERROR',
            message: 'Failed to process sync request'
        });
    }
});

export { router as federationRouter };
