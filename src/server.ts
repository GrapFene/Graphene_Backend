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
    federationRouter
} from './routes/index.js';

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

// Health check
app.get('/health', (_, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(config.server.port, () => {
    console.log(`🚀 Graphene server running on port ${config.server.port}`);
});

export default app;
