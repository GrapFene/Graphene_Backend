import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
app.use(apiRouter); // Fallback: handle routes without /api prefix (for Caddy compatibility)

// Serve Frontend Static Files
// Assumes the frontend is built and located at ../../frontend/dist relative to this file's dist location
// Or ../frontend/dist relative to the root during development with tsx
const frontendPath = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

// Health check
app.get('/health', (_, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Catch-all route for SPA (React Router)
app.get('*', (req, res) => {
    // Only handle if it's not an API call (API calls should have matched the /api router above)
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(frontendPath, 'index.html'));
    } else {
        res.status(404).json({ error: 'API route not found' });
    }
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
