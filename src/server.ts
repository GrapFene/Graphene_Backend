import express from 'express';
import cors from 'cors';
import { config, validateConfig } from './config/index.js';
import { authRouter } from './routes/index.js';

// Validate environment before starting
validateConfig();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/auth', authRouter);

// Health check
app.get('/health', (_, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(config.server.port, () => {
    console.log(`🚀 Graphene server running on port ${config.server.port}`);
});

export default app;
