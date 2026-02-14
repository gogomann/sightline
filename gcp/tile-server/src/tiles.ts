// ============================================================
// EcoAtlas Tile Server – MVT Generator
// GeoJSON Features → Mapbox Vector Tiles (protobuf)
// ============================================================

import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import type { EmitterFeature, CommunityFeature, TileBounds } from './bigquery';

// ----------------------------------------------------------------
// GeoJSON Feature-Collections bauen
// ----------------------------------------------------------------

export function emittersToGeoJSON(features: EmitterFeature[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map(f => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [f.lng, f.lat],
      },
      properties: {
        emitter_id:          f.emitter_id,
        name:                f.name,
        emitter_type:        f.emitter_type,
        description:         f.description ?? '',
        responsible_entity:  f.responsible_entity ?? '',
        active_from:         f.active_from ?? '',
        active_to:           f.active_to ?? '',
        is_active:           f.is_active ? 1 : 0,
        is_locked:           f.is_locked ? 1 : 0,
        has_area:            f.has_area ? 1 : 0,
        wiki_url:            f.wiki_url ?? '',
        source_url:          f.source_url ?? '',
        // Layer-Identifier für MapLibre Filter
        layer_source:        'eco_core',
      },
    })),
  };
}

export function communityToGeoJSON(features: CommunityFeature[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map(f => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [f.lng, f.lat],
      },
      properties: {
        submission_id:       f.submission_id,
        name:                f.proposed_name ?? 'Unbekannt',
        emitter_type:        f.proposed_type ?? 'other',
        status:              f.status,
        upvotes:             f.upvotes,
        downvotes:           f.downvotes,
        vote_score:          f.upvotes - f.downvotes,
        created_at:          f.created_at,
        user_display_name:   f.user_display_name ?? '',
        // Layer-Identifier für MapLibre Filter
        layer_source:        'eco_community',
      },
    })),
  };
}

// ----------------------------------------------------------------
// GeoJSON → MVT Buffer
// ----------------------------------------------------------------

interface TileIndex {
  getTile: (z: number, x: number, y: number) => object | null;
}

const GEOJSONVT_OPTIONS = {
  maxZoom: 18,
  indexMaxZoom: 12,
  indexMaxPoints: 200,
  tolerance: 3,
  extent: 4096,
  buffer: 64,
};

/**
 * Konvertiert zwei GeoJSON-Collections (core + community) in einen
 * einzigen MVT-Buffer mit zwei Named Layers.
 */
export function buildMvtTile(
  z: number,
  x: number,
  y: number,
  coreFeatures: EmitterFeature[],
  communityFeatures: CommunityFeature[]
): Buffer {
  const layers: Record<string, object> = {};

  // eco_core Layer
  if (coreFeatures.length > 0) {
    const coreGeoJSON = emittersToGeoJSON(coreFeatures);
    const coreIndex: TileIndex = geojsonvt(coreGeoJSON, GEOJSONVT_OPTIONS);
    const coreTile = coreIndex.getTile(z, x, y);
    if (coreTile) {
      layers['eco_core'] = coreTile;
    }
  }

  // eco_community Layer
  if (communityFeatures.length > 0) {
    const communityGeoJSON = communityToGeoJSON(communityFeatures);
    const communityIndex: TileIndex = geojsonvt(communityGeoJSON, GEOJSONVT_OPTIONS);
    const communityTile = communityIndex.getTile(z, x, y);
    if (communityTile) {
      layers['eco_community'] = communityTile;
    }
  }

  // Leeren Buffer wenn keine Features
  if (Object.keys(layers).length === 0) {
    return Buffer.alloc(0);
  }

  return Buffer.from(vtpbf.fromGeojsonVt(layers));
}

// ----------------------------------------------------------------
// Cache-Control Header je nach Layer-Typ
// ----------------------------------------------------------------
export function getCacheHeader(includeCommunity: boolean): string {
  // Community-Daten: 5 Minuten
  // Nur Core:        1 Stunde
  const ttl = includeCommunity ? 300 : 3600;
  return `public, max-age=${ttl}, s-maxage=${ttl}`;
}

// ----------------------------------------------------------------
// Zoom-Level Logik
// Unter z5: nur eco_core anzeigen (zu viele Community-Pins)
// Unter z3: gar nichts (zu weit rausgezoomt)
// ----------------------------------------------------------------
export function shouldIncludeCommunity(z: number): boolean {
  return z >= 7;
}

export function shouldRenderTile(z: number): boolean {
  return z >= 3;
}
