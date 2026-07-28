// Lightweight in-memory TTL cache.
// Prevents re-issuing identical Threads read queries in a short window.

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * Cap on live entries. Values are rendered result blocks, not raw GraphQL
 * bodies, so they're small — but expiry only ever runs when the *same* key is
 * read again, so an agent looping over thousands of handles would grow this map
 * for the life of the process without ever revisiting a key to expire it.
 */
const MAX_ENTRIES = 500;

class Cache {
  private store = new Map<string, CacheEntry<unknown>>();
  private ttl: number;

  constructor(ttlMs?: number) {
    this.ttl = ttlMs ?? parseInt(process.env.CACHE_TTL_MS ?? '30000', 10);
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh insertion order so eviction sheds genuinely cold keys, not
    // whichever happened to be written first.
    this.store.delete(key);
    this.store.set(key, entry as CacheEntry<unknown>);
    return entry.data;
  }

  set<T>(key: string, data: T): void {
    this.store.delete(key);
    this.store.set(key, { data, expiresAt: Date.now() + this.ttl });
    while (this.store.size > MAX_ENTRIES) {
      // Map iterates in insertion order, so the first key is the least
      // recently set-or-read.
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }

  key(...parts: (string | number | boolean | undefined)[]): string {
    return parts.map(String).join(':');
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

export const cache = new Cache();

/**
 * Drop every cached read after a write.
 *
 * Deliberately a full flush rather than targeted invalidation. One write
 * perturbs more surfaces than it appears to: posting changes your profile *and*
 * your timeline; a like changes that post's counts everywhere it appears —
 * inline in a timeline entry, in a search result, as someone else's quoted
 * post. Enumerating those correctly is easy to get subtly wrong, and the payoff
 * would be keeping a handful of entries alive inside a 30s window. Serving a
 * stale count immediately after the user changed it is the worse failure.
 */
export function invalidateAfterWrite(): void {
  cache.clear();
}
