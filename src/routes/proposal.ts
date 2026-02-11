import express from 'express';
import { ProposalService } from '../services/proposal.js';

const router = express.Router();

// POST /proposals
router.post('/', async (req, res) => {
    try {
        const { did, communityName, title, description, options, deadline } = req.body;

        if (!did || !communityName || !title || !options || !deadline) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const proposal = await ProposalService.createProposal(did, {
            communityName, title, description, options, deadline
        });
        res.status(201).json(proposal);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /proposals/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const proposal = await ProposalService.getProposal(id);

        // Also get results
        const results = await ProposalService.getResults(id);

        res.json({ proposal, results });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /proposals/:id/vote
router.post('/:id/vote', async (req, res) => {
    try {
        const { id } = req.params;
        const { did, optionIndex } = req.body;

        if (!did || optionIndex === undefined) {
            return res.status(400).json({ error: 'DID and optionIndex are required' });
        }

        const vote = await ProposalService.vote(did, id, optionIndex);
        res.status(201).json(vote);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const proposalRouter = router;
