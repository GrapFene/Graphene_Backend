import { Router, Request, Response } from 'express';
import { createChallenge, verifyLogin, registerUser, initiateMnemonicLogin, verifyMnemonicLogin, getAuthCredentials } from '../services/index.js';
import type { LoginChallengeRequest, LoginVerifyRequest, RegisterRequest, MnemonicLoginInitRequest, MnemonicLoginVerifyRequest } from '../types/index.js';

const router = Router();

/**
 * POST /auth/challenge
 * Request a new authentication challenge for a DID.
 */
router.post('/challenge', async (req: Request, res: Response) => {
    const { did } = req.body as LoginChallengeRequest;

    if (!did) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'DID is required' } });
    }

    const result = await createChallenge(did);

    if (result.success) {
        return res.status(200).json(result.data);
    }

    const statusCode = result.error?.code === 'IDENTITY_NOT_FOUND' ? 404 : 500;
    return res.status(statusCode).json({ error: result.error });
});

/**
 * POST /auth/login
 * Verify a signed challenge and receive a JWT.
 */
router.post('/login', async (req: Request, res: Response) => {
    const request = req.body as LoginVerifyRequest;

    const result = await verifyLogin(request);

    if (result.success) {
        return res.status(200).json(result.data);
    }

    const statusCode =
        result.error?.code === 'INVALID_REQUEST' ? 400 :
            result.error?.code === 'INVALID_SIGNATURE' ? 401 :
                result.error?.code === 'IDENTITY_NOT_FOUND' ? 404 :
                    result.error?.code === 'INVALID_CHALLENGE' ? 401 : 500;

    return res.status(statusCode).json({ error: result.error });
});

// =============================================================================
// NEW: Username/Password + Mnemonic Challenge Routes
// =============================================================================

/**
 * POST /auth/register
 * Register a new user with username, password, and mnemonic hashes.
 */
router.post('/register', async (req: Request, res: Response) => {
    console.log('🌐 [ROUTE] POST /auth/register received');
    console.log('🌐 [ROUTE] Request body keys:', Object.keys(req.body));

    const request = req.body as RegisterRequest;

    const result = await registerUser(request);

    console.log('🌐 [ROUTE] Register result:', { success: result.success, error: result.error });

    if (result.success) {
        return res.status(201).json(result.data);
    }

    const statusCode =
        result.error?.code === 'INVALID_REQUEST' ? 400 :
            result.error?.code === 'USERNAME_EXISTS' ? 409 : 500;

    return res.status(statusCode).json({ error: result.error });
});

/**
 * POST /auth/login-init
 * Initiate login - verify password and get mnemonic challenge indices.
 */
router.post('/login-init', async (req: Request, res: Response) => {
    const request = req.body as MnemonicLoginInitRequest;

    const result = await initiateMnemonicLogin(request);

    if (result.success) {
        return res.status(200).json(result.data);
    }

    const statusCode =
        result.error?.code === 'INVALID_REQUEST' ? 400 :
            result.error?.code === 'IDENTITY_NOT_FOUND' ? 404 :
                result.error?.code === 'INVALID_PASSWORD' ? 401 : 500;

    return res.status(statusCode).json({ error: result.error });
});

/**
 * POST /auth/login-verify
 * Verify mnemonic words and receive JWT.
 */
router.post('/login-verify', async (req: Request, res: Response) => {
    const request = req.body as MnemonicLoginVerifyRequest;

    const result = await verifyMnemonicLogin(request);

    if (result.success) {
        return res.status(200).json(result.data);
    }

    const statusCode =
        result.error?.code === 'INVALID_REQUEST' ? 400 :
            result.error?.code === 'IDENTITY_NOT_FOUND' ? 404 :
                result.error?.code === 'INVALID_MNEMONIC' ? 401 : 500;

    return res.status(statusCode).json({ error: result.error });
});

/**
 * POST /auth/verify-challenge
 * Verify mnemonic words for CRUD operations (without returning JWT).
 */
router.post('/verify-challenge', async (req: Request, res: Response) => {
    const { did, word_hashes, indices } = req.body;

    console.log('🔐 [ROUTE] POST /auth/verify-challenge received');
    console.log('  - DID:', did);
    console.log('  - Indices:', indices);
    console.log('  - Word Hashes:', word_hashes);

    if (!did || !word_hashes || !indices || !Array.isArray(word_hashes) || !Array.isArray(indices)) {
        return res.status(400).json({ 
            error: { code: 'INVALID_REQUEST', message: 'DID, word_hashes, and indices are required' } 
        });
    }

    const result = await verifyMnemonicLogin({ did, word_hashes, indices });

    console.log('  - Verification Result:', result.success ? '✅ SUCCESS' : '❌ FAILED');
    if (!result.success) {
        console.log('  - Error:', result.error);
    }

    if (result.success) {
        return res.status(200).json({ success: true });
    }

    const statusCode =
        result.error?.code === 'INVALID_REQUEST' ? 400 :
            result.error?.code === 'IDENTITY_NOT_FOUND' ? 404 :
                result.error?.code === 'INVALID_MNEMONIC' ? 401 : 500;

    return res.status(statusCode).json({ success: false, error: result.error });
});

/**
 * POST /auth/get-salt
 * Get the salt for a user's DID to hash mnemonic words.
 */
router.post('/get-salt', async (req: Request, res: Response) => {
    const { did } = req.body;

    console.log('🔐 [ROUTE] POST /auth/get-salt received');
    console.log('  - DID:', did);

    if (!did) {
        return res.status(400).json({ 
            error: { code: 'INVALID_REQUEST', message: 'DID is required' } 
        });
    }

    try {
        const credentials = await getAuthCredentials(did);
        
        if (!credentials) {
            return res.status(404).json({ 
                error: { code: 'CREDENTIALS_NOT_FOUND', message: 'Credentials not found' } 
            });
        }

        console.log('  - Salt retrieved successfully');
        return res.status(200).json({ salt: credentials.salt });
    } catch (err) {
        console.error('  - Error fetching salt:', err);
        return res.status(500).json({ 
            error: { code: 'SERVER_ERROR', message: 'Failed to fetch salt' } 
        });
    }
});

export default router;

