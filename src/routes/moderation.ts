// =============================================================================
// Graphene: Moderation Routes
// =============================================================================

import { Router, type Request, Response } from 'express';
import { requireAuth, requireModerator, type AuthenticatedRequest } from '../middleware/auth-middleware.js';
import {
    blockInstance,
    unblockInstance,
    getBlockedInstances,
    getSyncRejectionLogs
} from '../services/moderation.js';
import { getRetryQueue } from '../services/retry.js';
import { SubscriptionService } from '../services/subscription.js';
import type {
    BlockInstanceRequest,
    BlockInstanceResponse,
    ListBlockedInstancesResponse,
    SyncQueueResponse
} from '../types/moderation-api.js';

const router = Router();

/**
 * POST /moderation/subscriptions
 * Subscribe to a topic from a peer (requires moderator role).
 */
router.post('/subscriptions', requireAuth, requireModerator, async (req: Request, res: Response) => {
    try {
        const { instance_url, topic } = req.body;

        if (!instance_url || !topic) {
            res.status(400).json({
                code: 'INVALID_REQUEST',
                message: 'instance_url and topic are required'
            });
            return;
        }

        await SubscriptionService.subscribeToTopic(instance_url, topic);

        res.status(201).json({
            success: true,
            message: `Subscribed to ${topic} from ${instance_url}`
        });
    } catch (error: any) {
        console.error('Subscribe error:', error);
        res.status(500).json({
            code: 'INTERNAL_ERROR',
            message: 'Failed to subscribe to topic'
        });
    }
});

/**
 * DELETE /moderation/subscriptions
 * Unsubscribe from a topic (requires moderator role).
 */
router.delete('/subscriptions', requireAuth, requireModerator, async (req: Request, res: Response) => {
    try {
        const { instance_url, topic } = req.body;

        if (!instance_url || !topic) {
            res.status(400).json({
                code: 'INVALID_REQUEST',
                message: 'instance_url and topic are required'
            });
            return;
        }

        await SubscriptionService.unsubscribeFromTopic(instance_url, topic);

        res.status(200).json({
            success: true,
            message: `Unsubscribed from ${topic} from ${instance_url}`
        });
    } catch (error: any) {
        console.error('Unsubscribe error:', error);
        res.status(500).json({
            code: 'INTERNAL_ERROR',
            message: 'Failed to unsubscribe'
        });
    }
});

/**
 * GET /moderation/subscriptions/:instance_url
 * List all subscriptions for a specific instance.
 */
router.get('/subscriptions/:instance_url', requireAuth, requireModerator, async (req: Request, res: Response) => {
    try {
        const instanceUrl = decodeURIComponent(req.params.instance_url);
        const subscriptions = await SubscriptionService.getInstanceSubscriptions(instanceUrl);

        res.status(200).json({
            instance_url: instanceUrl,
            subscriptions,
            total: subscriptions.length
        });
    } catch (error: any) {
        console.error('List subscriptions error:', error);
        res.status(500).json({
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch subscriptions'
        });
    }
});

/**
 * POST /moderation/blocks
 * Block an instance (requires moderator role).
 */
router.post('/blocks', requireAuth, requireModerator, async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const { instance_url, reason } = req.body as BlockInstanceRequest;

        // Validation
        if (!instance_url || !reason) {
            res.status(400).json({
                code: 'INVALID_REQUEST',
                message: 'instance_url and reason are required'
            });
            return;
        }

        // URL validation
        try {
            new URL(instance_url);
        } catch {
            res.status(400).json({
                code: 'INVALID_URL',
                message: 'instance_url must be a valid URL'
            });
            return;
        }

        const blocked = await blockInstance(
            instance_url,
            reason,
            authReq.user!.did
        );

        const response: BlockInstanceResponse = {
            id: blocked.id,
            instance_url: blocked.instance_url,
            blocked_at: blocked.blocked_at
        };

        res.status(201).json(response);
    } catch (error: any) {
        console.error('Block instance error:', error);

        if (error.message === 'Instance is already blocked') {
            res.status(409).json({
                code: 'ALREADY_BLOCKED',
                message: error.message
            });
            return;
        }

        res.status(500).json({
            code: 'INTERNAL_ERROR',
            message: 'Failed to block instance'
        });
    }
});

/**
 * DELETE /moderation/blocks/:instance_url
 * Unblock an instance (requires moderator role).
 */
router.delete('/blocks/:instance_url', requireAuth, requireModerator, async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const instanceUrl = decodeURIComponent(req.params.instance_url);

        await unblockInstance(instanceUrl, authReq.user!.did);

        res.status(200).json({
            success: true,
            message: 'Instance unblocked successfully'
        });
    } catch (error: any) {
        console.error('Unblock instance error:', error);
        res.status(500).json({
            code: 'INTERNAL_ERROR',
            message: 'Failed to unblock instance'
        });
    }
});

/**
 * GET /moderation/blocks
 * List all blocked instances (requires moderator role).
 */
router.get('/blocks', requireAuth, requireModerator, async (req: Request, res: Response) => {
    try {
        const instances = await getBlockedInstances();

        const response: ListBlockedInstancesResponse = {
            instances,
            total: instances.length
        };

        res.status(200).json(response);
    } catch (error: any) {
        console.error('Get blocked instances error:', error);
        res.status(500).json({
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch blocked instances'
        });
    }
});

/**
 * GET /moderation/sync-queue
 * Monitor the status of the sync retry queue (requires moderator role).
 */
router.get('/sync-queue', requireAuth, requireModerator, async (req: Request, res: Response) => {
    try {
        const status = req.query.status as any;
        const queue = await getRetryQueue(status);

        const response: SyncQueueResponse = {
            success: true,
            queue,
            total: queue.length
        };

        res.status(200).json(response);
    } catch (error: any) {
        console.error('Get retry queue error:', error);
        res.status(500).json({
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch retry queue'
        });
    }
});

/**
 * GET /moderation/logs/rejections
 * View sync rejection audit logs (requires moderator role).
 */
router.get('/logs/rejections', requireAuth, requireModerator, async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 100;
        const logs = await getSyncRejectionLogs(limit);

        res.status(200).json({
            logs,
            total: logs.length
        });
    } catch (error: any) {
        console.error('Get rejection logs error:', error);
        res.status(500).json({
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch rejection logs'
        });
    }
});

export { router as moderationRouter };

