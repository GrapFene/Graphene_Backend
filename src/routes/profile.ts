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

    let statusCode = 500;

    switch (result.error?.code) {
        case 'INVALID_SIGNATURE':
        case 'INVALID_REQUEST':
        case 'NO_KEYS':
        case 'INVALID_MNEMONIC':
        case 'INVALID_INDEX':
        case 'DB_ERROR': // Map DB error to 400 or 500? Let's keep it 500 default but at least we know.
            statusCode = 400;
            break;
        case 'IDENTITY_NOT_FOUND':
        case 'PROFILE_NOT_FOUND':
            statusCode = 404;
            break;
        default:
            statusCode = 500;
            console.error(`[PROFILE] Unmapped error code: ${result.error?.code}`);
    }

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
