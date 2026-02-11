import express from 'express';
import { SubscriptionService } from '../services/subscription.js';

const router = express.Router();

// POST /subscriptions/subscribe
router.post('/subscribe', async (req, res) => {
    try {
        const { did, subreddit } = req.body;

        if (!did || !subreddit) {
            return res.status(400).json({ error: 'DID and subreddit are required' });
        }

        const subscription = await SubscriptionService.subscribe(did, subreddit);
        res.status(201).json(subscription);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /subscriptions/unsubscribe
router.post('/unsubscribe', async (req, res) => {
    try {
        const { did, subreddit } = req.body;

        if (!did || !subreddit) {
            return res.status(400).json({ error: 'DID and subreddit are required' });
        }

        await SubscriptionService.unsubscribe(did, subreddit);
        res.status(200).json({ message: 'Unsubscribed successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /subscriptions/feed?did=...
router.get('/feed', async (req, res) => {
    try {
        const did = req.query.did as string;

        if (!did) {
            return res.status(400).json({ error: 'DID is required for personalized feed' });
        }

        const posts = await SubscriptionService.getPersonalizedFeed(did);
        res.json(posts);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /subscriptions/list?did=...
router.get('/list', async (req, res) => {
    try {
        const did = req.query.did as string;
        if (!did) {
            return res.status(400).json({ error: 'DID user parameter is required' });
        }
        const subs = await SubscriptionService.getSubscriptions(did);
        res.json(subs);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const subscriptionRouter = router;
