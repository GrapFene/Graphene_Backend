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
    messageRouter,
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
const apiRouter = express.Router();
apiRouter.use('/auth', authRouter);
apiRouter.use('/posts', postRouter);
apiRouter.use('/subscriptions', subscriptionRouter);
apiRouter.use('/communities', communityRouter);
apiRouter.use('/votes', voteRouter);
apiRouter.use('/proposals', proposalRouter);
apiRouter.use('/blocks', blockRouter);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/comments', commentRouter);
apiRouter.use('/moderation', moderationRouter);
apiRouter.use('/federation', federationRouter);
apiRouter.use('/recovery', recoveryRouter);
apiRouter.use('/upload', uploadRouter);
apiRouter.use('/messages', messageRouter);

app.use('/api', apiRouter);

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
