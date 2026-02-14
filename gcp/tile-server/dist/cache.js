"use strict";
// ============================================================
// EcoAtlas Tile Server – Cache
// In-Memory LRU-artiger Cache für Tiles + API-Responses
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiCache = exports.tileCache = exports.TTL = void 0;
exports.tileCacheKey = tileCacheKey;
exports.emitterCacheKey = emitterCacheKey;
exports.submissionCacheKey = submissionCacheKey;
class TileCache {
    constructor(maxSize = 2000) {
        this.store = new Map();
        this.maxSize = maxSize;
    }
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }
    set(key, value, ttlMs) {
        // Älteste Einträge entfernen wenn Cache voll
        if (this.store.size >= this.maxSize) {
            const firstKey = this.store.keys().next().value;
            if (firstKey)
                this.store.delete(firstKey);
        }
        this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    }
    invalidate(prefix) {
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
exports.TTL = {
    TILE_CORE: 60 * 60 * 1000, // 1 Stunde  (eco_core)
    TILE_COMMUNITY: 5 * 60 * 1000, // 5 Minuten (eco_community)
    API_EMITTER: 30 * 60 * 1000, // 30 Minuten
    API_SUBMISSION: 5 * 60 * 1000, // 5 Minuten
};
// ----------------------------------------------------------------
// Cache-Instanzen
// ----------------------------------------------------------------
exports.tileCache = new TileCache(2000);
exports.apiCache = new TileCache(500);
// ----------------------------------------------------------------
// Cache Keys
// ----------------------------------------------------------------
function tileCacheKey(z, x, y, community) {
    return `tile:${z}/${x}/${y}:${community ? 'c' : 'n'}`;
}
function emitterCacheKey(emitterId) {
    return `emitter:${emitterId}`;
}
function submissionCacheKey(submissionId) {
    return `submission:${submissionId}`;
}
