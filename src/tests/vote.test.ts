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
        getOrSet: vi.fn(async (key, fetchFn) => await fetchFn()), // Pass through
    }
}));

// Mock Supabase Query Builder
const mockQueryBuilder: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    upsert: vi.fn(),
    delete: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
};

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

        // Reset query builder methods to return promise-like results where needed
        // upsert -> returns Promise-like (since it's awaited directly in my code)
        mockQueryBuilder.upsert.mockResolvedValue({ error: null, data: [] });

        // delete -> returns builder for chaining
        mockQueryBuilder.delete.mockReturnValue(mockQueryBuilder);

        // Make the builder awaitable for the end of the chain
        mockQueryBuilder.then = vi.fn((callback) => {
            return Promise.resolve({ error: null, data: [] }).then(callback);
        });

        // select by default setup for count
        // When counting upvotes/downvotes, it returns { count, error }
        // mockQueryBuilder.select is called. 
        // We need to implement specific behavior for different calls if we want to test getPostScore logic fully.
        // For now, let's spy on getPostScore to isolate voteOnPost testing.
    });

    it('should use upsert when casting a vote (voteType 1)', async () => {
        // Mock getPostScore to avoid DB calls during score refetch
        const getScoreSpy = vi.spyOn(VoteService, 'getPostScore').mockResolvedValue(10);
        // Mock checking user vote at the end
        mockQueryBuilder.maybeSingle.mockResolvedValue({ data: { vote_type: 1 }, error: null });

        const result = await VoteService.voteOnPost('did:123', 'post:456', 1);

        // Verify correct table selected
        expect(mockSupabase.from).toHaveBeenCalledWith('post_votes');

        // Verify upsert call
        expect(mockQueryBuilder.upsert).toHaveBeenCalledWith({
            post_id: 'post:456',
            voter_did: 'did:123',
            vote_type: 1
        }, { onConflict: 'post_id,voter_did' });

        // Verify cache invalidation
        expect(cacheService.del).toHaveBeenCalledWith('post_score:post:456');

        // Verify return value
        expect(result).toEqual({ score: 10, userVote: 1 });
    });

    it('should use upsert when casting a vote (voteType -1)', async () => {
        const getScoreSpy = vi.spyOn(VoteService, 'getPostScore').mockResolvedValue(-5);
        mockQueryBuilder.maybeSingle.mockResolvedValue({ data: { vote_type: -1 }, error: null });

        const result = await VoteService.voteOnPost('did:123', 'post:456', -1);

        expect(mockQueryBuilder.upsert).toHaveBeenCalledWith({
            post_id: 'post:456',
            voter_did: 'did:123',
            vote_type: -1
        }, { onConflict: 'post_id,voter_did' });

        expect(result).toEqual({ score: -5, userVote: -1 });
    });

    it('should use delete when removing a vote (voteType 0)', async () => {
        const getScoreSpy = vi.spyOn(VoteService, 'getPostScore').mockResolvedValue(0);
        mockQueryBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

        const result = await VoteService.voteOnPost('did:123', 'post:456', 0);

        expect(mockQueryBuilder.delete).toHaveBeenCalled();
        expect(mockQueryBuilder.eq).toHaveBeenCalledWith('post_id', 'post:456');
        expect(mockQueryBuilder.eq).toHaveBeenCalledWith('voter_did', 'did:123');

        expect(cacheService.del).toHaveBeenCalledWith('post_score:post:456');
        expect(result).toEqual({ score: 0, userVote: null });
    });
});
