import { Router, Request, Response } from 'express';
import { updateProfile, getProfile } from '../services/profile.js';
import type { ProfileUpdateRequest } from '../types/index.js';

const router = Router();

/**
 * POST /profile
 * Update user profile
 */
router.post('/', async (req: Request, res: Response) => {
    const request = req.body as ProfileUpdateRequest;
    const result = await updateProfile(request);

    if (result.success) {
        return res.status(200).json(result.data);
    }

    const statusCode = result.error?.code === 'INVALID_SIGNATURE' ? 401 : 500;
    return res.status(statusCode).json({ error: result.error });
});

/**
 * GET /profile/:did
 * Get user profile
 */
router.get('/:did', async (req: Request, res: Response) => {
    const { did } = req.params;
    const result = await getProfile(did);

    if (result.success) {
        return res.status(200).json(result.data);
    }

    return res.status(404).json({ error: result.error });
});

export default router;
