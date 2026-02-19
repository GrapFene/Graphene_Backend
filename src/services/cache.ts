import NodeCache from 'node-cache';

class CacheService {
    private cache: NodeCache;

    constructor(ttlSeconds = 60) {
        this.cache = new NodeCache({ stdTTL: ttlSeconds, checkperiod: ttlSeconds * 0.2 });
    }

    get<T>(key: string): T | undefined {
        return this.cache.get<T>(key);
    }

    set<T>(key: string, value: T, ttl?: number): boolean {
        if (ttl) {
            return this.cache.set(key, value, ttl);
        }
        return this.cache.set(key, value);
    }

    del(keys: string | string[]): number {
        return this.cache.del(keys);
    }

    flush(): void {
        this.cache.flushAll();
    }

    // Helper to get or set if missing
    async getOrSet<T>(key: string, fetchFn: () => Promise<T>, ttl?: number): Promise<T> {
        const cached = this.get<T>(key);
        if (cached !== undefined) {
            return cached;
        }

        const value = await fetchFn();
        this.set(key, value, ttl);
        return value;
    }
}

// Export a singleton instance with default 60s TTL
export const cacheService = new CacheService(60);
