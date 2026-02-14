// ============================================================
// EcoAtlas Tile Server – MVT Generator
// GeoJSON Features → Mapbox Vector Tiles (protobuf)
// ============================================================

import geojsonvt from 'geojson-vt';
import * as vtpbf from 'vt-pbf';
import type { Feature, FeatureCollection, Point } from 'geojson';
import type { EmitterFeature, CommunityFeature } from './bigquery';

// ----------------------------------------------------------------
// GeoJSON Feature-Collections bauen
// ----------------------------------------------------------------

export function emittersToGeoJSON(features: EmitterFeature[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: features.map((f): Feature<Point> => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [f.lng, f.lat],
      },
      properties: {
        emitter_id:         f.emitter_id,
        name:               f.name,
        emitter_type:       f.emitter_type,
        description:        f.description ?? '',
        responsible_entity: f.responsible_entity ?? '',
        active_from:        f.active_from ?? '',
        active_to:          f.active_to ?? '',
        is_active:          f.is_active ? 1 : 0,
        is_locked:          f.is_locked ? 1 : 0,
        has_area:           f.has_area ? 1 : 0,
        wiki_url:           f.wiki_url ?? '',
        source_url:         f.source_url ?? '',
        layer_source:       'eco_core',
      },
    })),
  };
}

export function communityToGeoJSON(features: CommunityFeature[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: features.map((f): Feature<Point> => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [f.lng, f.lat],
      },
      properties: {
        submission_id:     f.submission_id,
        name:              f.proposed_name ?? 'Unbekannt',
        emitter_type:      f.proposed_type ?? 'other',
        status:            f.status,
        upvotes:           f.upvotes,
        downvotes:         f.downvotes,
        vote_score:        f.upvotes - f.downvotes,
        created_at:        f.created_at,
        user_display_name: f.user_display_name ?? '',
        layer_source:      'eco_community',
      },
    })),
  };
}

// ----------------------------------------------------------------
// GeoJSON → MVT Buffer
// ----------------------------------------------------------------

const GEOJSONVT_OPTIONS = {
  maxZoom: 18,
  indexMaxZoom: 12,
  indexMaxPoints: 200,
  tolerance: 3,
  extent: 4096,
  buffer: 64,
};

export function buildMvtTile(
  z: number,
  x: number,
  y: number,
  coreFeatures: EmitterFeature[],
  communityFeatures: CommunityFeature[]
): Buffer {
  const layers: Record<string, ReturnType<ReturnType<typeof geojsonvt>['getTile']>> = {};

  if (coreFeatures.length > 0) {
    const tile = geojsonvt(emittersToGeoJSON(coreFeatures) as Parameters<typeof geojsonvt>[0], GEOJSONVT_OPTIONS).getTile(z, x, y);
    if (tile) layers['eco_core'] = tile;
  }

  if (communityFeatures.length > 0) {
    const tile = geojsonvt(communityToGeoJSON(communityFeatures) as Parameters<typeof geojsonvt>[0], GEOJSONVT_OPTIONS).getTile(z, x, y);
    if (tile) layers['eco_community'] = tile;
  }

  if (Object.keys(layers).length === 0) {
    return Buffer.alloc(0);
  }

  const cleanLayers = Object.fromEntries(
    Object.entries(layers).filter(([, v]) => v !== null)
  ) as unknown as Parameters<typeof vtpbf.fromGeojsonVt>[0];

  return Buffer.from(vtpbf.fromGeojsonVt(cleanLayers));

}

// ----------------------------------------------------------------
// Cache-Control Header
// ----------------------------------------------------------------
export function getCacheHeader(includeCommunity: boolean): string {
  const ttl = includeCommunity ? 300 : 3600;
  return `public, max-age=${ttl}, s-maxage=${ttl}`;
}

export function shouldIncludeCommunity(z: number): boolean {
  return z >= 7;
}

export function shouldRenderTile(z: number): boolean {
  return z >= 3;
}