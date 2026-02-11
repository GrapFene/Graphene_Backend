import express from 'express';
import { BlockService } from '../services/block.js';

const router = express.Router();

// GET /blocks - Get blocked communities
router.get('/', async (req, res) => {
    try {
        const { did } = req.query;
        if (!did) return res.status(400).json({ error: 'DID is required' });

        const blocked = await BlockService.getBlockedCommunities(did as string);
        res.json(blocked);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /blocks - Block a community
router.post('/', async (req, res) => {
    try {
        const { did, communityName } = req.body;
        if (!did || !communityName) return res.status(400).json({ error: 'DID and communityName are required' });

        await BlockService.blockCommunity(did, communityName);
        res.status(201).json({ message: 'Community blocked' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /blocks/:communityName - Unblock
router.delete('/:communityName', async (req, res) => {
    try {
        const { communityName } = req.params;
        const { did } = req.query;

        if (!did) return res.status(400).json({ error: 'DID is required' });

        await BlockService.unblockCommunity(did as string, communityName);
        res.status(200).json({ message: 'Community unblocked' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const blockRouter = router;
