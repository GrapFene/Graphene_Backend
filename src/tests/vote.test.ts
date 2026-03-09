import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoteService } from '../services/vote.js';
import { cacheService } from '../services/cache.js';

// --- Mocks ---

// Mock CacheService
vi.mock('../services/cache.js', () => ({
    cacheService: {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        getOrSet: vi.fn(async (_key: string, fetchFn: () => Promise<unknown>) => await fetchFn()),
    }
}));

// Mock Supabase Query Builder
//
// VoteService uses a batching architecture:
//   voteOnPost()  → queues to pendingVotes (returns optimistic result immediately)
//   processPendingVotes() → calls persistVote() which does the real DB write:
//       voteType 0   → .delete().eq().eq()
//       new vote     → .insert({...})
//       update vote  → .update({...}).eq('id', existing.id)
//
// The query builder must be fully chainable AND awaitable at every point
// because persistVote awaits sub-chains like:
//   await supabase.from(...).delete().eq(...).eq(...)
//   await supabase.from(...).select(...).eq(...).eq(...).maybeSingle()
//   await supabase.from(...).insert({...})

const makeChainablePromise = (resolveValue: unknown) => {
    // Returns an object that is both chainable (.eq, .select, etc.) AND thenable
    const obj: any = {};
    const thenHandler = (cb: (v: unknown) => unknown) =>
        Promise.resolve(resolveValue).then(cb);

    obj.select = vi.fn(() => obj);
    obj.eq = vi.fn(() => obj);
    obj.in = vi.fn(() => obj);
    obj.delete = vi.fn(() => obj);
    obj.insert = vi.fn(() => obj);
    obj.update = vi.fn(() => obj);
    obj.upsert = vi.fn(() => obj);
    obj.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
    obj.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
    obj.then = thenHandler;
    return obj;
};

let mockQueryBuilder: ReturnType<typeof makeChainablePromise>;

const mockSupabase = {
    from: vi.fn(() => mockQueryBuilder),
};

// Mock getSupabase
vi.mock('../services/supabase.js', () => ({
    getSupabase: () => mockSupabase
}));

describe('VoteService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Fresh chainable builder for each test
        mockQueryBuilder = makeChainablePromise({ error: null, data: [], count: 0 });
        mockSupabase.from.mockReturnValue(mockQueryBuilder);

        // Clear the internal batch queue and score cache between tests so
        // they don't bleed into each other.
        (VoteService as any).pendingVotes.clear();
        (VoteService as any).scoreCache.clear();
        if ((VoteService as any).batchTimer) {
            clearInterval((VoteService as any).batchTimer);
            (VoteService as any).batchTimer = null;
        }
    });

    it('should return optimistic score and userVote 1 when casting an upvote', async () => {
        // No pre-existing vote, score cache starts empty → score from DB = 0
        // After an upvote the optimistic score becomes 0 + 1 = 1
        mockQueryBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

        const result = await VoteService.voteOnPost('did:123', 'post:456', 1);

        expect(result.userVote).toBe(1);
        expect(typeof result.score).toBe('number');
    });

    it('should return optimistic score and userVote -1 when casting a downvote', async () => {
        mockQueryBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

        const result = await VoteService.voteOnPost('did:123', 'post:456', -1);

        expect(result.userVote).toBe(-1);
        expect(typeof result.score).toBe('number');
    });

    it('should return userVote null when removing a vote (voteType 0)', async () => {
        // Pre-existing upvote so the removal actually changes the score
        mockQueryBuilder.maybeSingle.mockResolvedValue({ data: { vote_type: 1 }, error: null });

        const result = await VoteService.voteOnPost('did:123', 'post:456', 0);

        expect(result.userVote).toBeNull();
        expect(typeof result.score).toBe('number');
    });

    it('should persist a new upvote via insert when processPendingVotes runs', async () => {
        // No pre-existing vote
        mockQueryBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

        await VoteService.voteOnPost('did:123', 'post:456', 1);

        // Manually flush the batch queue (normally runs via setInterval)
        await (VoteService as any).processPendingVotes();

        // persistVote calls: select→eq→eq→maybeSingle (to check existing), then insert
        expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
            post_id: 'post:456',
            voter_did: 'did:123',
            vote_type: 1
        });
    });

    it('should persist a vote removal via delete when processPendingVotes runs', async () => {
        // Pre-existing vote so maybeSingle check in voteOnPost returns something
        mockQueryBuilder.maybeSingle.mockResolvedValue({ data: { vote_type: 1, id: 'vote-id-1' }, error: null });

        await VoteService.voteOnPost('did:123', 'post:456', 0);

        await (VoteService as any).processPendingVotes();

        // persistVote for voteType 0 calls .delete().eq().eq()
        expect(mockQueryBuilder.delete).toHaveBeenCalled();
        expect(mockQueryBuilder.eq).toHaveBeenCalledWith('post_id', 'post:456');
        expect(mockQueryBuilder.eq).toHaveBeenCalledWith('voter_did', 'did:123');
    });

    it('should throw on an invalid voteType', async () => {
        await expect(VoteService.voteOnPost('did:123', 'post:456', 99)).rejects.toThrow(
            'Invalid vote type'
        );
    });
});
