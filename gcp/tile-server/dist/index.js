"use strict";
// ============================================================
// EcoAtlas Tile Server – Express App
// Cloud Run | Port 8080 | Projekt: online-add-testen
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const bigquery_1 = require("./bigquery");
const tiles_1 = require("./tiles");
const cache_1 = require("./cache");
const upload_1 = require("./upload");
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT ?? '8080', 10);
// ----------------------------------------------------------------
// Middleware
// ----------------------------------------------------------------
app.use((0, cors_1.default)({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    methods: ['GET', 'POST'],
}));
app.use(express_1.default.json());
// ----------------------------------------------------------------
// Health Check (Cloud Run Liveness Probe)
// ----------------------------------------------------------------
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ecoatlas-tile-server', ts: new Date().toISOString() });
});
// ----------------------------------------------------------------
// MVT Tiles: /tiles/{z}/{x}/{y}.mvt
// ----------------------------------------------------------------
app.get('/tiles/:z/:x/:y.mvt', async (req, res, next) => {
    try {
        const z = parseInt(req.params.z, 10);
        const x = parseInt(req.params.x, 10);
        const y = parseInt(req.params.y, 10);
        if (isNaN(z) || isNaN(x) || isNaN(y)) {
            res.status(400).json({ error: 'Ungültige Tile-Koordinaten' });
            return;
        }
        if (!(0, tiles_1.shouldRenderTile)(z)) {
            res.status(204).end();
            return;
        }
        const community = (0, tiles_1.shouldIncludeCommunity)(z);
        const cacheKey = (0, cache_1.tileCacheKey)(z, x, y, community);
        // Cache-Hit
        const cached = cache_1.tileCache.get(cacheKey);
        if (cached) {
            res.set('Content-Type', 'application/x-protobuf');
            res.set('Cache-Control', (0, tiles_1.getCacheHeader)(community));
            res.set('X-Cache', 'HIT');
            res.send(cached);
            return;
        }
        // BigQuery abfragen
        const bounds = (0, bigquery_1.tileToBounds)(z, x, y);
        const [coreFeatures, communityFeatures] = await Promise.all([
            (0, bigquery_1.queryEmitters)(bounds),
            community ? (0, bigquery_1.queryCommunitySubmissions)(bounds) : Promise.resolve([]),
        ]);
        const mvt = (0, tiles_1.buildMvtTile)(z, x, y, coreFeatures, communityFeatures);
        // Leere Tiles nicht cachen
        if (mvt.length > 0) {
            const ttl = community ? cache_1.TTL.TILE_COMMUNITY : cache_1.TTL.TILE_CORE;
            cache_1.tileCache.set(cacheKey, mvt, ttl);
        }
        res.set('Content-Type', 'application/x-protobuf');
        res.set('Cache-Control', (0, tiles_1.getCacheHeader)(community));
        res.set('X-Cache', 'MISS');
        res.send(mvt);
    }
    catch (err) {
        next(err);
    }
});
app.post('/upload/presign', upload_1.handlePresignRequest);
app.post('/upload/confirm', upload_1.handleUploadConfirm);
app.get('/upload/status/*', upload_1.handleUploadStatus);
// ----------------------------------------------------------------
// Emitter Detail: /api/emitter/{id}
// ----------------------------------------------------------------
app.get('/api/emitter/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const cacheKey = (0, cache_1.emitterCacheKey)(id);
        const cached = cache_1.apiCache.get(cacheKey);
        if (cached) {
            res.set('Cache-Control', `public, max-age=${cache_1.TTL.API_EMITTER / 1000}`);
            res.set('X-Cache', 'HIT');
            res.json(cached);
            return;
        }
        const detail = await (0, bigquery_1.queryEmitterDetail)(id);
        if (!detail) {
            res.status(404).json({ error: 'Emitter nicht gefunden' });
            return;
        }
        cache_1.apiCache.set(cacheKey, detail, cache_1.TTL.API_EMITTER);
        res.set('Cache-Control', `public, max-age=${cache_1.TTL.API_EMITTER / 1000}`);
        res.set('X-Cache', 'MISS');
        res.json(detail);
    }
    catch (err) {
        next(err);
    }
});
// ----------------------------------------------------------------
// Community Submission Detail: /api/community/submission/{id}
// ----------------------------------------------------------------
app.get('/api/community/submission/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const cacheKey = (0, cache_1.submissionCacheKey)(id);
        const cached = cache_1.apiCache.get(cacheKey);
        if (cached) {
            res.set('Cache-Control', `public, max-age=${cache_1.TTL.API_SUBMISSION / 1000}`);
            res.set('X-Cache', 'HIT');
            res.json(cached);
            return;
        }
        const detail = await (0, bigquery_1.querySubmissionDetail)(id);
        if (!detail) {
            res.status(404).json({ error: 'Submission nicht gefunden' });
            return;
        }
        cache_1.apiCache.set(cacheKey, detail, cache_1.TTL.API_SUBMISSION);
        res.set('Cache-Control', `public, max-age=${cache_1.TTL.API_SUBMISSION / 1000}`);
        res.set('X-Cache', 'MISS');
        res.json(detail);
    }
    catch (err) {
        next(err);
    }
});
// ----------------------------------------------------------------
// Cache Stats (intern – nicht öffentlich exponieren)
// ----------------------------------------------------------------
app.get('/internal/cache-stats', (_req, res) => {
    res.json({
        tiles: cache_1.tileCache.stats(),
        api: cache_1.apiCache.stats(),
    });
});
// ----------------------------------------------------------------
// Fehler-Handler
// ----------------------------------------------------------------
app.use((err, _req, res, _next) => {
    console.error('[TileServer Error]', err.message, err.stack);
    res.status(500).json({
        error: 'Interner Server-Fehler',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
});
// ----------------------------------------------------------------
// Start
// ----------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`EcoAtlas Tile Server läuft auf Port ${PORT}`);
    console.log(`GCP Projekt: ${process.env.GCP_PROJECT_ID ?? 'online-add-testen'}`);
});
exports.default = app;
