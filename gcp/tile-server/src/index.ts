// ============================================================
// EcoAtlas Tile Server – Express App
// Cloud Run | Port 8080 | Projekt: online-add-testen
// ============================================================

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';

import {
  tileToBounds,
  queryEmitters,
  queryCommunitySubmissions,
  queryEmitterDetail,
  querySubmissionDetail,
} from './bigquery';

import {
  buildMvtTile,
  getCacheHeader,
  shouldIncludeCommunity,
  shouldRenderTile,
} from './tiles';

import {
  tileCache,
  apiCache,
  TTL,
  tileCacheKey,
  emitterCacheKey,
  submissionCacheKey,
} from './cache';
import { handlePresignRequest, handleUploadConfirm, handleUploadStatus } from './upload';


const app = express();
const PORT = parseInt(process.env.PORT ?? '8080', 10);

// ----------------------------------------------------------------
// Middleware
// ----------------------------------------------------------------
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
  methods: ['GET', 'POST'],
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..'))); 

// ----------------------------------------------------------------
// Health Check (Cloud Run Liveness Probe)
// ----------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ecoatlas-tile-server', ts: new Date().toISOString() });
});

// ----------------------------------------------------------------
// MVT Tiles: /tiles/{z}/{x}/{y}.mvt
// ----------------------------------------------------------------
app.get('/tiles/:z/:x/:y.mvt', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const z = parseInt(req.params.z, 10);
    const x = parseInt(req.params.x, 10);
    const y = parseInt(req.params.y, 10);

    if (isNaN(z) || isNaN(x) || isNaN(y)) {
      res.status(400).json({ error: 'Ungültige Tile-Koordinaten' });
      return;
    }

    if (!shouldRenderTile(z)) {
      res.status(204).end();
      return;
    }

    const community = shouldIncludeCommunity(z);
    const cacheKey  = tileCacheKey(z, x, y, community);

    // Cache-Hit
    const cached = tileCache.get(cacheKey);
    if (cached) {
      res.set('Content-Type', 'application/x-protobuf');
      res.set('Cache-Control', getCacheHeader(community));
      res.set('X-Cache', 'HIT');
      res.send(cached);
      return;
    }

    // BigQuery abfragen
    const bounds = tileToBounds(z, x, y);
    const [coreFeatures, communityFeatures] = await Promise.all([
      queryEmitters(bounds),
      community ? queryCommunitySubmissions(bounds) : Promise.resolve([]),
    ]);

    const mvt = buildMvtTile(z, x, y, coreFeatures, communityFeatures);

    // Leere Tiles nicht cachen
    if (mvt.length > 0) {
      const ttl = community ? TTL.TILE_COMMUNITY : TTL.TILE_CORE;
      tileCache.set(cacheKey, mvt, ttl);
    }

    res.set('Content-Type', 'application/x-protobuf');
    res.set('Cache-Control', getCacheHeader(community));
    res.set('X-Cache', 'MISS');
    res.send(mvt);

  } catch (err) {
    next(err);
  }
});

app.post('/upload/presign', handlePresignRequest);
app.post('/upload/confirm', handleUploadConfirm);
app.get('/upload/status/*', handleUploadStatus);


// ----------------------------------------------------------------
// Emitter Detail: /api/emitter/{id}
// ----------------------------------------------------------------
app.get('/api/emitter/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const cacheKey = emitterCacheKey(id);

    const cached = apiCache.get(cacheKey);
    if (cached) {
      res.set('Cache-Control', `public, max-age=${TTL.API_EMITTER / 1000}`);
      res.set('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    const detail = await queryEmitterDetail(id);

    if (!detail) {
      res.status(404).json({ error: 'Emitter nicht gefunden' });
      return;
    }

    apiCache.set(cacheKey, detail, TTL.API_EMITTER);

    res.set('Cache-Control', `public, max-age=${TTL.API_EMITTER / 1000}`);
    res.set('X-Cache', 'MISS');
    res.json(detail);

  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------
// Community Submission Detail: /api/community/submission/{id}
// ----------------------------------------------------------------
app.get('/api/community/submission/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const cacheKey = submissionCacheKey(id);

    const cached = apiCache.get(cacheKey);
    if (cached) {
      res.set('Cache-Control', `public, max-age=${TTL.API_SUBMISSION / 1000}`);
      res.set('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    const detail = await querySubmissionDetail(id);

    if (!detail) {
      res.status(404).json({ error: 'Submission nicht gefunden' });
      return;
    }

    apiCache.set(cacheKey, detail, TTL.API_SUBMISSION);

    res.set('Cache-Control', `public, max-age=${TTL.API_SUBMISSION / 1000}`);
    res.set('X-Cache', 'MISS');
    res.json(detail);

  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------
// Cache Stats (intern – nicht öffentlich exponieren)
// ----------------------------------------------------------------
app.get('/internal/cache-stats', (_req, res) => {
  res.json({
    tiles:  tileCache.stats(),
    api:    apiCache.stats(),
  });
});

// ----------------------------------------------------------------
// Fehler-Handler
// ----------------------------------------------------------------
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
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

export default app;
