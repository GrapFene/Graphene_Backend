import express from 'express';
import { VoteService } from '../services/vote.js';
import { PostService } from '../services/post.js';
import { FederationDispatcher } from '../lib/federation/dispatcher.js';

const router = express.Router();

// POST /votes
router.post('/', async (req, res) => {
    try {
        const { did, postId, voteType } = req.body;

        if (!did || !postId || voteType === undefined) {
            return res.status(400).json({ error: 'DID, postId, and voteType are required' });
        }

        const result = await VoteService.voteOnPost(did, postId, voteType);

        // Fire-and-forget federation broadcast.
        // Votes are eventually-consistent across instances — we do NOT await this
        // so federation latency never blocks the 201 response to the local client.
        // Failed deliveries are queued internally by the dispatcher for retry.
        FederationDispatcher.broadcastVote({
            post_id:   postId,
            voter_did: did,
            vote_type: voteType as 1 | -1 | 0,
        }).catch((err) =>
            console.error('[vote route] Federation broadcast failed:', err)
        );

        res.status(201).json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const voteRouter = router;
