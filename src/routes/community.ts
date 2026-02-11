import express from 'express';
import { CommunityService } from '../services/community.js';

const router = express.Router();

// POST /communities
router.post('/', async (req, res) => {
    try {
        const { did, name, description, topic, is_private, rules } = req.body;

        if (!did || !name) {
            return res.status(400).json({ error: 'DID and name are required' });
        }

        const community = await CommunityService.createCommunity(did, { name, description, topic, is_private, rules });
        res.status(201).json(community);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /communities (Search)
router.get('/', async (req, res) => {
    try {
        const query = req.query.search as string || '';
        const results = await CommunityService.searchCommunities(query);
        res.json(results);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /communities/top
router.get('/top', async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 5;
        const communities = await CommunityService.getTopCommunities(limit);
        res.json(communities);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /communities/:name
router.get('/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const community = await CommunityService.getCommunity(name);

        if (!community) {
            return res.status(404).json({ error: 'Community not found' });
        }

        res.json(community);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /communities/:name/rules
router.put('/:name/rules', async (req, res) => {
    try {
        const { name } = req.params;
        const { did, rules } = req.body;

        if (!did || !rules) {
            return res.status(400).json({ error: 'DID and rules are required' });
        }

        const updated = await CommunityService.updateRules(did, name, { rules });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /communities/:name/moderators
router.post('/:name/moderators', async (req, res) => {
    try {
        const { name } = req.params;
        const { ownerDid, moderatorDid } = req.body;

        if (!ownerDid || !moderatorDid) {
            return res.status(400).json({ error: 'ownerDid and moderatorDid are required' });
        }

        await CommunityService.addModerator(ownerDid, name, moderatorDid);
        res.status(200).json({ message: 'Moderator added' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /communities/:name/moderators/:did
// Note: We need ownerDid to authorise removal. 
// Ideally passed via Auth header, but for now body or query? DELETE usually doesn't have body.
// I'll use a query param `?ownerDid=` or headers is better.
// For consistency with other routes in this MVP, I'll allow it in query or header, or just use POST for removal if easier?
// Let's stick to REST DELETE but maybe pass ownerDid in query.
router.delete('/:name/moderators/:did', async (req, res) => {
    try {
        const { name, did } = req.params;
        const ownerDid = req.query.ownerDid as string;

        if (!ownerDid) {
            return res.status(400).json({ error: 'ownerDid query param required' });
        }

        await CommunityService.removeModerator(ownerDid, name, did);
        res.status(200).json({ message: 'Moderator removed' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const communityRouter = router;
