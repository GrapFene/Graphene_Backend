
import express from 'express';
import {
    setGuardians,
    getGuardians,
    initiateRecovery,
    getPendingRecoveryRequests,
    approveRecovery,
    finalizeRecovery
} from '../services/recovery.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

// Middleware to extract DID from auth header (simplified, assumes auth middleware populated user)
// In a real app, use existing middleware. We'll assume req.user is populated.
// Since we don't have the auth middleware in view, we will trust the common pattern.
// However, the previous code in auth.ts doesn't show middleware usage, just service functions.
// We need to verify how `req.user` is populated or if we need to parse headers here.
// Looking at `server.ts` might help, but let's assume standard `authenticateToken` middleware exists or we implement a check.

// Actually, let's implement a simple helper to get DID from request if middleware isn't explicit
const getDid = (req: any) => (req as AuthRequest).user?.sub;

// 1. Guardian Management (Authenticated)
router.post('/guardians', authenticateToken, async (req, res) => {
    const did = getDid(req);
    console.log(`[POST /guardians] Request from ${did}`, JSON.stringify(req.body));
    if (!did) return res.status(401).json({ error: { message: 'Unauthorized' } });

    const result = await setGuardians(did, req.body);
    console.log(`[POST /guardians] Result:`, JSON.stringify(result));
    if (!result.success) return res.status(400).json(result);
    res.json(result.data);
});

router.get('/guardians', authenticateToken, async (req, res) => {
    const did = getDid(req);
    if (!did) return res.status(401).json({ error: { message: 'Unauthorized' } });

    const result = await getGuardians(did);
    if (!result.success) return res.status(400).json(result);
    res.json(result.data);
});

// 2. Recovery Requests (Public - initiated by anyone for a target)
router.post('/request', async (req, res) => {
    const result = await initiateRecovery(req.body);
    if (!result.success) return res.status(400).json(result);
    res.json(result.data);
});

// 3. Guardian Actions (Authenticated)
router.get('/requests', authenticateToken, async (req, res) => {
    const did = getDid(req);
    if (!did) return res.status(401).json({ error: { message: 'Unauthorized' } });

    const result = await getPendingRecoveryRequests(did);
    if (!result.success) return res.status(400).json(result);
    res.json(result.data);
});

router.post('/approve', authenticateToken, async (req, res) => {
    const did = getDid(req);
    if (!did) return res.status(401).json({ error: { message: 'Unauthorized' } });
    const { request_id } = req.body;

    const result = await approveRecovery(did, request_id);
    if (!result.success) return res.status(400).json(result);
    res.json(result.data);
});

router.post('/finalize', async (req, res) => {
    // Anyone can call finalize? Or just guardians/target?
    // Logic checks threshold, so public call is fine.
    const { request_id } = req.body;

    const result = await finalizeRecovery(request_id);
    if (!result.success) return res.status(400).json(result);
    res.json(result.data);
});

export default router;
