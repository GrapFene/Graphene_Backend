import express from 'express';
import cors from 'cors';
import { config, validateConfig } from './config/index.js';
import {
    authRouter,
    postRouter,
    subscriptionRouter,
    communityRouter,
    voteRouter,
    proposalRouter,
    blockRouter,
    profileRouter,
    commentRouter,
    moderationRouter,
    federationRouter,
    recoveryRouter,
    uploadRouter,
} from './routes/index.js';
import { startRetryWorker } from './services/retry.js';
import { startPeerHealthMonitor } from './services/peer-health.js';
import { announceToKnownPeers } from './services/announce.js';

// Validate environment before starting
validateConfig();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/auth', authRouter);
app.use('/posts', postRouter);
app.use('/subscriptions', subscriptionRouter);
app.use('/communities', communityRouter);
app.use('/votes', voteRouter);
app.use('/proposals', proposalRouter);
app.use('/blocks', blockRouter);
app.use('/profile', profileRouter);
app.use('/comments', commentRouter);
app.use('/moderation', moderationRouter);
app.use('/federation', federationRouter);
app.use('/recovery', recoveryRouter);
app.use('/upload', uploadRouter);

// Health check
app.get('/health', (_, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start retry worker
startRetryWorker();

// Start peer health monitor
startPeerHealthMonitor();

// Start server
app.listen(config.server.port, () => {
    console.log(`🚀 Graphene server running on port ${config.server.port}`);

    // Announce ourselves to all known peers after server is ready.
    // Fire-and-forget — failures logged but never crash startup.
    setTimeout(() => {
        announceToKnownPeers().catch(err =>
            console.error('[server] Startup announce failed:', err)
        );
    }, 3_000); // 3s delay so the server is fully ready before outbound calls
});

export default app;
