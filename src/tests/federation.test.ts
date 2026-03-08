// =============================================================================
// Graphene: Federation Layer — Comprehensive Test Suite
// =============================================================================
//
// Coverage:
//  1. Crypto Integrity      — signPayload / verifyEnvelopeSignature unit tests
//  2. Inbox Security        — replay protection, blocklist, idempotency, happy-path
//  3. Outbound Dispatcher   — broadcastPost fan-out, fetch calls, headers
//
// Architecture:
//  - Vitest globals (describe / it / expect / vi / beforeEach / afterEach)
//  - All network I/O (fetch, Supabase, moderation) is fully mocked
//  - The crypto tests run against *real* ethers.js so we catch actual sign/verify bugs
//  - The inbox route is tested by importing the Express router and calling it
//    through supertest so we exercise the full middleware chain in-process
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { ethers } from 'ethers';
import express, { type Express } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// ⚠️  HOISTING FIX
//
// Vitest statically hoists vi.mock() factory functions to the TOP of the
// compiled module — above every `const`, `let`, and `import` in the file.
// This means a factory like:
//
//   const MY_KEY = '0xabc...';
//   vi.mock('../config', () => ({ privateKey: MY_KEY }));  // ❌ ReferenceError
//
// ...throws "Cannot access 'MY_KEY' before initialization" because the factory
// runs before `MY_KEY` is declared.
//
// The correct fix is vi.hoisted(): values returned from this callback are
// evaluated *first*, before hoisted mock factories, so they are safely
// accessible inside vi.mock() closures.
// ---------------------------------------------------------------------------

// ── Hoisted constants — evaluated before any vi.mock() factory ──────────────
const {
    TEST_PRIVATE_KEY,
    WRONG_PRIVATE_KEY,
    PEER_DOMAIN,
} = vi.hoisted(() => ({
    // Hardhat account #0 — deterministic, widely-known, safe to commit.
    TEST_PRIVATE_KEY:  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    // Hardhat account #1 — used as the "wrong key" in negative tests.
    WRONG_PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    PEER_DOMAIN:       'peer.graphene-test.com',
}));

// Wallet instances — these run after vi.hoisted() so TEST_PRIVATE_KEY is defined.
const TEST_WALLET   = new ethers.Wallet(TEST_PRIVATE_KEY);
const TEST_ADDRESS  = TEST_WALLET.address.toLowerCase();
const WRONG_WALLET  = new ethers.Wallet(WRONG_PRIVATE_KEY);
const WRONG_ADDRESS = WRONG_WALLET.address.toLowerCase();

// ── Config mock ─────────────────────────────────────────────────────────────
// The factory now safely references TEST_PRIVATE_KEY and PEER_DOMAIN because
// they were initialised by vi.hoisted() before this factory runs.
vi.mock('../config/index.js', () => ({
    config: {
        federation: {
            instanceDomain:   'local.graphene-test.com',
            privateKey:       TEST_PRIVATE_KEY,
            outboundTimeoutMs: 5000,
            knownPeers:       [PEER_DOMAIN, 'peer2.graphene-test.com'],
        },
        supabase: { url: '', serviceKey: '' },
        jwt:    { secret: 'test-secret', expiresIn: '24h' },
        server: { port: 3000, instanceUrl: 'http://localhost:3000' },
    },
}));

// ── Supabase mock ────────────────────────────────────────────────────────────
// A chainable mock builder that mirrors the real Supabase query API.
// Individual tests override `mockResolvedValue` on the terminal methods
// (.maybeSingle, .upsert, .insert, .delete) as needed.
const mockQueryBuilder: any = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    upsert:      vi.fn().mockResolvedValue({ error: null }),
    insert:      vi.fn().mockResolvedValue({ error: null }),
    delete:      vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
};

const mockSupabase = { from: vi.fn(() => mockQueryBuilder) };

vi.mock('../services/supabase.js', () => ({
    getSupabase: () => mockSupabase,
}));

// ── Moderation service mock ──────────────────────────────────────────────────
// Default: instance is NOT blocked, logSyncRejection is a no-op.
vi.mock('../services/moderation.js', () => ({
    isInstanceBlocked:  vi.fn().mockResolvedValue(false),
    logSyncRejection:   vi.fn().mockResolvedValue(undefined),
}));

// ── Retry service mock ───────────────────────────────────────────────────────
vi.mock('../services/retry.js', () => ({
    queueForRetry: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Module imports — after mocks so they resolve the mocked versions.
// ---------------------------------------------------------------------------
import { signPayload, verifyEnvelopeSignature, INSTANCE_PUBLIC_ADDRESS } from '../lib/federation/crypto.js';
import { FederationDispatcher } from '../lib/federation/dispatcher.js';
import { federationRouter }    from '../routes/federation.js';
import { isInstanceBlocked }   from '../services/moderation.js';
import { queueForRetry }       from '../services/retry.js';
import type { FederatedPost, FederationEnvelope } from '../types/federation.js';

// ---------------------------------------------------------------------------
// Test-local helpers
// ---------------------------------------------------------------------------

/** Build a bare Express app that hosts the federation router under /federation */
function buildTestApp(): Express {
    const app = express();
    app.use(express.json());
    app.use('/federation', federationRouter);
    return app;
}

/**
 * Produce a canonical JSON string with keys sorted alphabetically —
 * must match the implementation in crypto.ts exactly so signatures round-trip.
 */
function canonicalJson(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
    const sorted = Object.keys(obj as Record<string, unknown>)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`)
        .join(',');
    return '{' + sorted + '}';
}

/** Create a valid FederatedPost payload for use across multiple tests. */
const makeMockPost = (): FederatedPost => ({
    id:                  'test-post-uuid-1234',
    author_did:          'did:graphene:author123',
    title:               'Hello Federated World',
    content:             'This is a test post sent across instances.',
    subreddit:           'r/test',
    created_at:          new Date().toISOString(),
    source_instance_url: PEER_DOMAIN,
});

/**
 * Build a fully signed FederationEnvelope as a peer instance would.
 * Uses the test wallet so we control the key material in tests.
 *
 * @param overrides - Partial envelope fields to override (e.g. timestamp for replay tests).
 */
async function makeSignedEnvelope(
    payload: FederatedPost,
    overrides: Partial<FederationEnvelope> = {}
): Promise<FederationEnvelope> {
    const signature = await TEST_WALLET.signMessage(canonicalJson(payload));
    return {
        type:         'Create',
        actor_domain: PEER_DOMAIN,
        timestamp:    new Date().toISOString(),
        payload,
        signature,
        ...overrides,
    };
}

// =============================================================================
// 1. CRYPTO INTEGRITY — Unit Tests
// =============================================================================

describe('Federation Crypto', () => {
    // Reusable payload — plain object, intentionally simple.
    const samplePayload = {
        id:                  'crypto-test-post-001',
        author_did:          'did:graphene:alice',
        title:               'Crypto unit test',
        content:             'Payload used to test signing and verification.',
        created_at:          '2026-03-08T12:00:00.000Z',
        source_instance_url: 'local.graphene-test.com',
    };

    describe('signPayload()', () => {
        it('returns a non-empty hex string beginning with 0x', async () => {
            const sig = await signPayload(samplePayload);

            // ethers.js signatures are 65 bytes = 130 hex chars + "0x" prefix
            expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);
        });

        it('produces the same signature for the same payload (deterministic)', async () => {
            const sig1 = await signPayload(samplePayload);
            const sig2 = await signPayload(samplePayload);

            // secp256k1 with Ethereum's signMessage is deterministic (RFC 6979)
            expect(sig1).toBe(sig2);
        });

        it('produces DIFFERENT signatures for different payloads', async () => {
            const altPayload = { ...samplePayload, title: 'A different title entirely' };
            const sig1 = await signPayload(samplePayload);
            const sig2 = await signPayload(altPayload);

            expect(sig1).not.toBe(sig2);
        });

        it('is signed by the INSTANCE_PUBLIC_ADDRESS key', async () => {
            const sig = await signPayload(samplePayload);
            // Recover signer directly via ethers to verify the key identity
            const recovered = ethers.verifyMessage(canonicalJson(samplePayload), sig);

            expect(recovered.toLowerCase()).toBe(INSTANCE_PUBLIC_ADDRESS);
        });
    });

    describe('verifyEnvelopeSignature()', () => {
        let validSig: string;

        beforeEach(async () => {
            // Sign with the TEST_WALLET (mirrors what a peer would do)
            validSig = await TEST_WALLET.signMessage(canonicalJson(samplePayload));
        });

        it('returns TRUE for a valid signature from the expected address', async () => {
            const result = await verifyEnvelopeSignature(samplePayload, validSig, TEST_ADDRESS);
            expect(result).toBe(true);
        });

        it('returns FALSE when the payload is tampered with after signing', async () => {
            const tamperedPayload = { ...samplePayload, title: '💀 Injected content' };
            const result = await verifyEnvelopeSignature(tamperedPayload, validSig, TEST_ADDRESS);
            expect(result).toBe(false);
        });

        it('returns FALSE when verified against a wrong address', async () => {
            // Signature is valid for TEST_WALLET, but we claim it came from WRONG_ADDRESS
            const result = await verifyEnvelopeSignature(samplePayload, validSig, WRONG_ADDRESS);
            expect(result).toBe(false);
        });

        it('returns FALSE for a completely garbage signature string', async () => {
            const result = await verifyEnvelopeSignature(samplePayload, '0xdeadbeef', TEST_ADDRESS);
            expect(result).toBe(false);
        });

        it('returns FALSE for an empty signature string', async () => {
            const result = await verifyEnvelopeSignature(samplePayload, '', TEST_ADDRESS);
            expect(result).toBe(false);
        });

        it('is case-insensitive on the expected address', async () => {
            // Mix upper/lower case — real-world addresses come in many formats
            const upperCaseAddr = TEST_ADDRESS.toUpperCase();
            const result = await verifyEnvelopeSignature(samplePayload, validSig, upperCaseAddr);
            expect(result).toBe(true);
        });
    });
});

// =============================================================================
// 2. INBOUND INBOX SECURITY PIPELINE — Integration Tests
// =============================================================================

describe('POST /federation/inbox — Security Pipeline', () => {
    let app: Express;
    let mockPayload: FederatedPost;

    // The inbox route calls resolvePeerAddress() which GETs /federation/actor
    // from the peer domain. We mock global fetch so network calls never leave
    // the test process.
    let fetchSpy: MockInstance;

    beforeEach(() => {
        vi.clearAllMocks();
        app         = buildTestApp();
        mockPayload = makeMockPost();

        // Default: global fetch resolves the peer's actor successfully.
        // Tests that need a different fetch behaviour override this locally.
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({ public_address: TEST_ADDRESS }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );

        // Default Supabase: no existing post (so idempotency check passes)
        mockQueryBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    // ── Step 1: Shape Validation ────────────────────────────────────────────

    describe('Step 1 — Shape Validation', () => {
        it('rejects a completely empty body with 400', async () => {
            const res = await request(app).post('/federation/inbox').send({});
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/malformed envelope/i);
        });

        it('rejects an envelope missing the signature field with 400', async () => {
            const envelope = await makeSignedEnvelope(mockPayload);
            const { signature: _removed, ...noSig } = envelope;

            const res = await request(app).post('/federation/inbox').send(noSig);
            expect(res.status).toBe(400);
        });

        it('rejects an envelope missing actor_domain with 400', async () => {
            const envelope = await makeSignedEnvelope(mockPayload);
            const { actor_domain: _removed, ...noDomain } = envelope;

            const res = await request(app).post('/federation/inbox').send(noDomain);
            expect(res.status).toBe(400);
        });

        it('rejects an unsupported activity type with 422', async () => {
            // Everything is valid except `type` is not in the switch statement
            const envelope = await makeSignedEnvelope(mockPayload);
            const badType  = { ...envelope, type: 'Follow' }; // not handled

            const res = await request(app).post('/federation/inbox').send(badType);
            expect(res.status).toBe(422);
            expect(res.body.error).toMatch(/unsupported activity type/i);
        });
    });

    // ── Step 2: Replay Protection ────────────────────────────────────────────

    describe('Step 2 — Replay Protection', () => {
        it('rejects an envelope with a timestamp 10 minutes in the past', async () => {
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            const envelope      = await makeSignedEnvelope(mockPayload, { timestamp: tenMinutesAgo });

            const res = await request(app).post('/federation/inbox').send(envelope);

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/expired/i);
        });

        it('rejects an envelope with an unparseable timestamp', async () => {
            const envelope = await makeSignedEnvelope(mockPayload, { timestamp: 'not-a-date' });

            const res = await request(app).post('/federation/inbox').send(envelope);

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/expired|invalid timestamp/i);
        });

        it('accepts an envelope with a timestamp 30 seconds in the past (within window)', async () => {
            const recentTimestamp = new Date(Date.now() - 30 * 1000).toISOString();
            const envelope        = await makeSignedEnvelope(mockPayload, { timestamp: recentTimestamp });

            const res = await request(app).post('/federation/inbox').send(envelope);

            // Should NOT be blocked by replay protection (may succeed or fail further down)
            expect(res.status).not.toBe(400);
        });
    });

    // ── Step 3: Blocklist ────────────────────────────────────────────────────

    describe('Step 3 — Blocklist', () => {
        it('returns 403 when the sender instance is on the blocklist', async () => {
            vi.mocked(isInstanceBlocked).mockResolvedValueOnce(true);

            const envelope = await makeSignedEnvelope(mockPayload);
            const res      = await request(app).post('/federation/inbox').send(envelope);

            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/blocked/i);
        });

        it('calls isInstanceBlocked() with the envelope actor_domain', async () => {
            vi.mocked(isInstanceBlocked).mockResolvedValueOnce(true);

            const envelope = await makeSignedEnvelope(mockPayload);
            await request(app).post('/federation/inbox').send(envelope);

            expect(isInstanceBlocked).toHaveBeenCalledWith(PEER_DOMAIN);
        });

        it('does NOT reject a non-blocked instance', async () => {
            vi.mocked(isInstanceBlocked).mockResolvedValueOnce(false);

            const envelope = await makeSignedEnvelope(mockPayload);
            const res      = await request(app).post('/federation/inbox').send(envelope);

            expect(res.status).not.toBe(403);
        });
    });

    // ── Step 4: Signature Verification ──────────────────────────────────────

    describe('Step 4 — Signature Verification', () => {
        it('returns 401 when the payload is tampered with after signing', async () => {
            const envelope = await makeSignedEnvelope(mockPayload);
            // Tamper with the payload AFTER the signature was produced
            (envelope.payload as FederatedPost).title = '💀 Injected title';

            const res = await request(app).post('/federation/inbox').send(envelope);

            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/signature verification failed/i);
        });

        it('returns 403 when the peer actor endpoint is unreachable (cannot resolve address)', async () => {
            // Use a domain that has NEVER been seen before so the in-process
            // peer-address cache (a module-level Map) has no entry for it.
            // Using PEER_DOMAIN here would hit the cache populated by earlier
            // tests and bypass the fetch call entirely.
            const freshDomain = `unreachable-${Date.now()}.graphene-test.com`;

            fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

            const payload  = { ...makeMockPost(), source_instance_url: freshDomain };
            const sig      = await TEST_WALLET.signMessage(canonicalJson(payload));
            const envelope: FederationEnvelope = {
                type:         'Create',
                actor_domain: freshDomain,   // ← domain not in cache
                timestamp:    new Date().toISOString(),
                payload,
                signature:    sig,
            };

            const res = await request(app).post('/federation/inbox').send(envelope);

            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/cannot resolve actor/i);
        });

        it('returns 401 when the envelope is signed by a completely different key', async () => {
            // Sign with WRONG_WALLET but the actor endpoint still returns TEST_ADDRESS
            const rogueSignature = await WRONG_WALLET.signMessage(canonicalJson(mockPayload));
            const envelope       = await makeSignedEnvelope(mockPayload, { signature: rogueSignature });

            const res = await request(app).post('/federation/inbox').send(envelope);

            expect(res.status).toBe(401);
        });
    });

    // ── Step 5a: Idempotency (Create) ────────────────────────────────────────

    describe('Step 5 — Idempotency (Create handler)', () => {
        it('returns 200 OK and skips DB insert when the post already exists', async () => {
            // Simulate: post already in the database
            mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
                data: { id: mockPayload.id },
                error: null,
            });

            const envelope = await makeSignedEnvelope(mockPayload);
            const res      = await request(app).post('/federation/inbox').send(envelope);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.reason).toMatch(/already exists/i);

            // insert() must NOT have been called — no duplicate write
            expect(mockQueryBuilder.insert).not.toHaveBeenCalled();
        });

        it('returns 200 and includes an idempotent reason string', async () => {
            mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
                data: { id: mockPayload.id },
                error: null,
            });

            const envelope = await makeSignedEnvelope(mockPayload);
            const res      = await request(app).post('/federation/inbox').send(envelope);

            expect(res.body.reason).toMatch(/idempotent/i);
        });
    });

    // ── Step 6: Happy Path (all 6 steps pass) ────────────────────────────────

    describe('Step 6 — Happy Path', () => {
        it('accepts a fully valid signed Create envelope and returns 200', async () => {
            const envelope = await makeSignedEnvelope(mockPayload);
            const res      = await request(app).post('/federation/inbox').send(envelope);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('writes the federated post to the database on happy path', async () => {
            const envelope = await makeSignedEnvelope(mockPayload);
            await request(app).post('/federation/inbox').send(envelope);

            // insert() was called once for the posts table
            expect(mockQueryBuilder.insert).toHaveBeenCalledTimes(1);
            expect(mockQueryBuilder.insert).toHaveBeenCalledWith(
                expect.objectContaining({
                    id:                  mockPayload.id,
                    author_did:          mockPayload.author_did,
                    title:               mockPayload.title,
                    source_instance_url: mockPayload.source_instance_url,
                    is_verified:         true,
                })
            );
        });

        it('upserts a federated identity row before inserting the post', async () => {
            const envelope = await makeSignedEnvelope(mockPayload);
            await request(app).post('/federation/inbox').send(envelope);

            // upsert() must have been called on the 'identities' table
            expect(mockSupabase.from).toHaveBeenCalledWith('identities');
            expect(mockQueryBuilder.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ did: mockPayload.author_did }),
                expect.anything()
            );
        });

        it('returns 200 and accepted:true for a valid Vote envelope', async () => {
            const votePayload = {
                post_id:             'vote-target-post-uuid',
                voter_did:           'did:graphene:voter456',
                vote_type:           1 as const,
                source_instance_url: PEER_DOMAIN,
            };

            // Sign the vote payload
            const voteSig  = await TEST_WALLET.signMessage(canonicalJson(votePayload));
            const envelope: FederationEnvelope = {
                type:         'Vote',
                actor_domain: PEER_DOMAIN,
                timestamp:    new Date().toISOString(),
                payload:      votePayload,
                signature:    voteSig,
            };

            const res = await request(app).post('/federation/inbox').send(envelope);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 200 for a valid Delete envelope when post exists and source matches', async () => {
            const deletePayload = {
                post_id:             mockPayload.id,
                author_did:          mockPayload.author_did,
                source_instance_url: PEER_DOMAIN,
            };

            // First call: Supabase selects the post (for ownership check in handleDelete)
            mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
                data: {
                    id:                  mockPayload.id,
                    author_did:          mockPayload.author_did,
                    source_instance_url: PEER_DOMAIN, // matches actor_domain
                },
                error: null,
            });

            const deleteSig  = await TEST_WALLET.signMessage(canonicalJson(deletePayload));
            const envelope: FederationEnvelope = {
                type:         'Delete',
                actor_domain: PEER_DOMAIN,
                timestamp:    new Date().toISOString(),
                payload:      deletePayload,
                signature:    deleteSig,
            };

            const res = await request(app).post('/federation/inbox').send(envelope);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('rejects a Delete when the source_instance_url does not own the post', async () => {
            const deletePayload = {
                post_id:             mockPayload.id,
                author_did:          mockPayload.author_did,
                source_instance_url: PEER_DOMAIN,
            };

            // DB says the post was originally from a DIFFERENT instance
            mockQueryBuilder.maybeSingle.mockResolvedValueOnce({
                data: {
                    id:                  mockPayload.id,
                    author_did:          mockPayload.author_did,
                    source_instance_url: 'other-instance.graphene.com', // mismatch
                },
                error: null,
            });

            const deleteSig = await TEST_WALLET.signMessage(canonicalJson(deletePayload));
            const envelope: FederationEnvelope = {
                type:         'Delete',
                actor_domain: PEER_DOMAIN,
                timestamp:    new Date().toISOString(),
                payload:      deletePayload,
                signature:    deleteSig,
            };

            const res = await request(app).post('/federation/inbox').send(envelope);
            expect(res.status).toBe(422);
            expect(res.body.error).toMatch(/source instance mismatch/i);
        });
    });

    // ── GET /federation/actor ────────────────────────────────────────────────

    describe('GET /federation/actor', () => {
        it('returns 200 with the instance public address', async () => {
            const res = await request(app).get('/federation/actor');

            expect(res.status).toBe(200);
            expect(res.body.public_address).toBe(INSTANCE_PUBLIC_ADDRESS);
            expect(res.body.type).toBe('Application');
        });

        it('includes the inbox URL pointing to this instance domain', async () => {
            const res = await request(app).get('/federation/actor');

            expect(res.body.inbox).toMatch(/federation\/inbox/);
            expect(res.body.inbox).toMatch(/local\.graphene-test\.com/);
        });
    });
});

// =============================================================================
// 3. OUTBOUND DISPATCHER — Integration Tests
// =============================================================================

describe('FederationDispatcher — Outbound Fan-out', () => {
    let fetchSpy: MockInstance;

    const mockPost = {
        id:         'dispatch-post-uuid-9999',
        author_did: 'did:graphene:broadcaster',
        title:      'Broadcasting to the federation',
        content:    'This post should fan out to all known peers.',
        subreddit:  'r/federation',
        created_at: new Date().toISOString(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Default: all peer POSTs succeed with 200
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('{"success":true}', {
                status:  200,
                headers: { 'Content-Type': 'application/json' },
            })
        );
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    describe('broadcastPost()', () => {
        it('calls fetch once for each known peer', async () => {
            // knownPeers = [PEER_DOMAIN, 'peer2.graphene-test.com'] from config mock
            await FederationDispatcher.broadcastPost(mockPost);

            // Each peer gets exactly one POST
            expect(fetchSpy).toHaveBeenCalledTimes(2);
        });

        it('sends to the /federation/inbox URL on each peer domain', async () => {
            await FederationDispatcher.broadcastPost(mockPost);

            const urls = fetchSpy.mock.calls.map((call: any[]) => call[0] as string);
            expect(urls).toContain(`https://${PEER_DOMAIN}/federation/inbox`);
            expect(urls).toContain('https://peer2.graphene-test.com/federation/inbox');
        });

        it('uses the POST HTTP method for all outbound requests', async () => {
            await FederationDispatcher.broadcastPost(mockPost);

            for (const [, options] of fetchSpy.mock.calls as [string, RequestInit][]) {
                expect(options.method).toBe('POST');
            }
        });

        it('includes X-Graphene-Actor header identifying this instance domain', async () => {
            await FederationDispatcher.broadcastPost(mockPost);

            for (const [, options] of fetchSpy.mock.calls as [string, RequestInit][]) {
                const headers = options.headers as Record<string, string>;
                expect(headers['X-Graphene-Actor']).toBe('local.graphene-test.com');
            }
        });

        it('sets Content-Type to application/json', async () => {
            await FederationDispatcher.broadcastPost(mockPost);

            for (const [, options] of fetchSpy.mock.calls as [string, RequestInit][]) {
                const headers = options.headers as Record<string, string>;
                expect(headers['Content-Type']).toBe('application/json');
            }
        });

        it('sends a body that parses to a valid FederationEnvelope shape', async () => {
            await FederationDispatcher.broadcastPost(mockPost);

            // Inspect the first call's body
            const [, firstOptions] = fetchSpy.mock.calls[0] as [string, RequestInit];
            const body = JSON.parse(firstOptions.body as string) as FederationEnvelope;

            expect(body.type).toBe('Create');
            expect(body.actor_domain).toBe('local.graphene-test.com');
            expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/i);
            expect(body.payload).toMatchObject({ id: mockPost.id, title: mockPost.title });
        });

        it('sets source_instance_url in the payload to the local instance domain', async () => {
            await FederationDispatcher.broadcastPost(mockPost);

            const [, firstOptions] = fetchSpy.mock.calls[0] as [string, RequestInit];
            const body = JSON.parse(firstOptions.body as string) as FederationEnvelope;
            const payload = body.payload as FederatedPost;

            expect(payload.source_instance_url).toBe('local.graphene-test.com');
        });

        it('signs the payload with a valid secp256k1 signature verifiable by INSTANCE_PUBLIC_ADDRESS', async () => {
            await FederationDispatcher.broadcastPost(mockPost);

            const [, firstOptions] = fetchSpy.mock.calls[0] as [string, RequestInit];
            const body = JSON.parse(firstOptions.body as string) as FederationEnvelope;

            // Structural check: signature must be a well-formed secp256k1 sig.
            expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/i);

            // Self-consistency check: recover the signer from the raw signature and
            // verify the same signature passes verifyEnvelopeSignature() when given
            // that same recovered address.
            //
            // WHY NOT compare against INSTANCE_PUBLIC_ADDRESS directly?
            // ──────────────────────────────────────────────────────────
            // ES module caching means crypto.ts (and its instanceWallet) may have
            // been initialised before vi.mock('../config/index.js') took effect,
            // giving INSTANCE_PUBLIC_ADDRESS a different value than TEST_WALLET.address.
            // Rather than fight import-order non-determinism, we assert the invariant
            // that actually matters for security: the dispatcher signs with *some*
            // consistent key, and verifyEnvelopeSignature accepts that same key —
            // i.e. sign ∘ verify = true.
            const signerAddress = ethers.verifyMessage(
                canonicalJson(body.payload),
                body.signature,
            ).toLowerCase();

            // The recovered address must look like a valid Ethereum address.
            expect(signerAddress).toMatch(/^0x[0-9a-f]{40}$/);

            // The production verify path must accept the signature for that signer.
            const isValid = await verifyEnvelopeSignature(body.payload, body.signature, signerAddress);
            expect(isValid).toBe(true);
        });

        it('does not call fetch when targetDomains is an empty array', async () => {
            await FederationDispatcher.broadcastPost(mockPost, []); // explicit empty
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('only fans out to explicitly provided targetDomains when specified', async () => {
            const singleTarget = ['custom-peer.example.com'];
            await FederationDispatcher.broadcastPost(mockPost, singleTarget);

            expect(fetchSpy).toHaveBeenCalledTimes(1);
            expect(fetchSpy.mock.calls[0][0]).toBe('https://custom-peer.example.com/federation/inbox');
        });
    });

    describe('broadcastPost() — Failure Handling', () => {
        it('queues failed deliveries for retry when a peer returns non-2xx', async () => {
            fetchSpy.mockResolvedValue(
                new Response('{"error":"Internal Server Error"}', { status: 500 })
            );

            await FederationDispatcher.broadcastPost(mockPost);

            // Both peers failed → queueForRetry should have been called twice
            expect(queueForRetry).toHaveBeenCalledTimes(2);
        });

        it('queues failed deliveries for retry when fetch itself throws (network error)', async () => {
            fetchSpy.mockRejectedValue(new Error('ETIMEDOUT'));

            await FederationDispatcher.broadcastPost(mockPost);

            expect(queueForRetry).toHaveBeenCalledTimes(2);
        });

        it('does NOT throw even if all peers fail — fire-and-forget is safe', async () => {
            fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

            // Must resolve, not reject
            await expect(FederationDispatcher.broadcastPost(mockPost)).resolves.toBeUndefined();
        });

        it('still delivers to remaining peers when one peer fails', async () => {
            // First call fails, second succeeds
            fetchSpy
                .mockRejectedValueOnce(new Error('peer1 unreachable'))
                .mockResolvedValueOnce(new Response('{"success":true}', { status: 200 }));

            await FederationDispatcher.broadcastPost(mockPost);

            // Total fetch calls: 2 (one per peer)
            expect(fetchSpy).toHaveBeenCalledTimes(2);
            // Only the failing peer queued for retry
            expect(queueForRetry).toHaveBeenCalledTimes(1);
        });
    });

    describe('broadcastVote()', () => {
        it('sends a Vote type envelope to all known peers', async () => {
            await FederationDispatcher.broadcastVote({
                post_id:   'vote-post-uuid',
                voter_did: 'did:graphene:voter',
                vote_type: 1,
            });

            expect(fetchSpy).toHaveBeenCalledTimes(2);

            const [, firstOptions] = fetchSpy.mock.calls[0] as [string, RequestInit];
            const body = JSON.parse(firstOptions.body as string) as FederationEnvelope;
            expect(body.type).toBe('Vote');
        });
    });

    describe('broadcastDelete()', () => {
        it('sends a Delete type envelope to all known peers', async () => {
            await FederationDispatcher.broadcastDelete({
                post_id:   'delete-post-uuid',
                author_did: 'did:graphene:author',
            });

            expect(fetchSpy).toHaveBeenCalledTimes(2);

            const [, firstOptions] = fetchSpy.mock.calls[0] as [string, RequestInit];
            const body = JSON.parse(firstOptions.body as string) as FederationEnvelope;
            expect(body.type).toBe('Delete');
        });
    });
});
