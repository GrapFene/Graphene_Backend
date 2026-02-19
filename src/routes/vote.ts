import express from 'express';
import { VoteService } from '../services/vote.js';
import { PostService } from '../services/post.js';

const router = express.Router();

// POST /votes
router.post('/', async (req, res) => {
    try {
        const { did, postId, voteType } = req.body;

        if (!did || !postId || voteType === undefined) {
            return res.status(400).json({ error: 'DID, postId, and voteType are required' });
        }

        const result = await VoteService.voteOnPost(did, postId, voteType);
        res.status(201).json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const voteRouter = router;
