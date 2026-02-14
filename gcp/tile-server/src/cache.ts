// ============================================================
// EcoAtlas Tile Server – Cache
// In-Memory LRU-artiger Cache für Tiles + API-Responses
// ============================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TileCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;

  constructor(maxSize = 2000) {
    this.maxSize = maxSize;
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    // Älteste Einträge entfernen wenn Cache voll
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(prefix: string): number {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  stats() {
    return {
      size: this.store.size,
      maxSize: this.maxSize,
    };
  }
}

// ----------------------------------------------------------------
// TTL Konstanten
// ----------------------------------------------------------------
export const TTL = {
  TILE_CORE:        60 * 60 * 1000,   // 1 Stunde  (eco_core)
  TILE_COMMUNITY:    5 * 60 * 1000,   // 5 Minuten (eco_community)
  API_EMITTER:      30 * 60 * 1000,   // 30 Minuten
  API_SUBMISSION:    5 * 60 * 1000,   // 5 Minuten
};

// ----------------------------------------------------------------
// Cache-Instanzen
// ----------------------------------------------------------------
export const tileCache    = new TileCache<Buffer>(2000);
export const apiCache     = new TileCache<object>(500);

// ----------------------------------------------------------------
// Cache Keys
// ----------------------------------------------------------------
export function tileCacheKey(z: number, x: number, y: number, community: boolean): string {
  return `tile:${z}/${x}/${y}:${community ? 'c' : 'n'}`;
}

export function emitterCacheKey(emitterId: string): string {
  return `emitter:${emitterId}`;
}

export function submissionCacheKey(submissionId: string): string {
  return `submission:${submissionId}`;
}
