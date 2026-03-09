import express from 'express';
import { BlockService } from '../services/block.js';
import { FederationDispatcher } from '../lib/federation/dispatcher.js';
import { config } from '../config/index.js';

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

        // Propagate block to all active peers (fire-and-forget)
        FederationDispatcher.broadcastBlock(did, communityName, 'Block').catch(err =>
            console.error('[block route] Federation block broadcast failed:', err)
        );

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

        // Propagate unblock to all active peers (fire-and-forget)
        FederationDispatcher.broadcastBlock(did as string, communityName, 'Unblock').catch(err =>
            console.error('[block route] Federation unblock broadcast failed:', err)
        );

        res.status(200).json({ message: 'Community unblocked' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const blockRouter = router;
