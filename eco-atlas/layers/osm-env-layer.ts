// ============================================================
// EcoAtlas – OSM Overpass Layer
// Lädt Umwelt-relevante Standorte direkt aus OpenStreetMap
// als ständig aktualisierten Basis-Layer
// ============================================================

import type { OsmEnvFeature, OsmEnvType, EmitterType, GeoPoint, GeoPolygon } from '../types/eco-types';

// ----------------------------------------------------------------
// OSM Tag-Definitionen → EcoAtlas Kategorien
// ----------------------------------------------------------------
interface OsmEnvQuery {
  osmEnvType: OsmEnvType;
  ecoCategory: EmitterType;
  label: string;
  // Overpass filter tags
  filters: Array<{
    key: string;
    value: string;
    nodeWayRel: ('node' | 'way' | 'relation')[];
  }>;
}

export const OSM_ENV_QUERIES: OsmEnvQuery[] = [
  {
    osmEnvType: 'landuse_landfill',
    ecoCategory: 'landfill',
    label: 'Deponie / Mülldeponie',
    filters: [
      { key: 'landuse',    value: 'landfill',            nodeWayRel: ['way', 'relation'] },
      { key: 'amenity',    value: 'waste_disposal',       nodeWayRel: ['node', 'way'] },
    ],
  },
  {
    osmEnvType: 'wastewater_plant',
    ecoCategory: 'wastewater',
    label: 'Kläranlage',
    filters: [
      { key: 'man_made',   value: 'wastewater_plant',    nodeWayRel: ['node', 'way', 'relation'] },
      { key: 'man_made',   value: 'sewage_treatment',    nodeWayRel: ['node', 'way'] },
    ],
  },
  {
    osmEnvType: 'chimney',
    ecoCategory: 'chimney',
    label: 'Industrieschornstein',
    filters: [
      { key: 'man_made',   value: 'chimney',             nodeWayRel: ['node', 'way'] },
    ],
  },
  {
    osmEnvType: 'refinery',
    ecoCategory: 'refinery',
    label: 'Raffinerie',
    filters: [
      { key: 'industrial', value: 'refinery',            nodeWayRel: ['node', 'way', 'relation'] },
      { key: 'man_made',   value: 'petroleum_well',      nodeWayRel: ['node'] },
    ],
  },
  {
    osmEnvType: 'power_plant',
    ecoCategory: 'power_plant',
    label: 'Kraftwerk',
    filters: [
      { key: 'power',      value: 'plant',               nodeWayRel: ['node', 'way', 'relation'] },
    ],
  },
  {
    osmEnvType: 'mine_quarry',
    ecoCategory: 'mine',
    label: 'Bergwerk / Steinbruch',
    filters: [
      { key: 'landuse',    value: 'quarry',              nodeWayRel: ['way', 'relation'] },
      { key: 'industrial', value: 'mine',                nodeWayRel: ['node', 'way', 'relation'] },
    ],
  },
  {
    osmEnvType: 'nuclear_plant',
    ecoCategory: 'nuclear',
    label: 'Kernkraftwerk / Nuklearanlage',
    filters: [
      { key: 'power',      value: 'nuclear',             nodeWayRel: ['node', 'way', 'relation'] },
      { key: 'landuse',    value: 'nuclear',             nodeWayRel: ['way', 'relation'] },
    ],
  },
  {
    osmEnvType: 'chemical_plant',
    ecoCategory: 'chemical_plant',
    label: 'Chemiewerk',
    filters: [
      { key: 'industrial', value: 'chemical',            nodeWayRel: ['node', 'way', 'relation'] },
      { key: 'industrial', value: 'chemical_plant',      nodeWayRel: ['node', 'way', 'relation'] },
    ],
  },
  {
    osmEnvType: 'pipeline',
    ecoCategory: 'pipeline',
    label: 'Pipeline',
    filters: [
      { key: 'man_made',   value: 'pipeline',            nodeWayRel: ['way'] },
    ],
  },
  {
    osmEnvType: 'waste_disposal',
    ecoCategory: 'waste_disposal',
    label: 'Entsorgungsanlage',
    filters: [
      { key: 'landuse',    value: 'industrial',          nodeWayRel: ['way', 'relation'] },
      { key: 'amenity',    value: 'recycling',           nodeWayRel: ['node', 'way'] },
    ],
  },
];

// ----------------------------------------------------------------
// Overpass QL Query Builder
// Baut eine einzige gebündelte Query für alle Umwelt-Typen
// ----------------------------------------------------------------

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Baut eine Overpass QL Query für alle Umwelt-Typen in einer BBox.
 * Gibt GeoJSON-kompatible Ausgabe zurück (out center für Ways/Relations).
 */
export function buildOsmEnvQuery(bbox: BoundingBox, types?: OsmEnvType[]): string {
  const { south, west, north, east } = bbox;
  const bboxStr = `${south},${west},${north},${east}`;

  const activeQueries = types
    ? OSM_ENV_QUERIES.filter(q => types.includes(q.osmEnvType))
    : OSM_ENV_QUERIES;

  const unionParts: string[] = [];

  for (const q of activeQueries) {
    for (const f of q.filters) {
      for (const geomType of f.nodeWayRel) {
        // Pipelines ohne BBox – zu viele lineare Features
        if (q.osmEnvType === 'pipeline' && geomType === 'way') {
          unionParts.push(`  way["${f.key}"="${f.value}"](${bboxStr});`);
        } else {
          unionParts.push(`  ${geomType}["${f.key}"="${f.value}"](${bboxStr});`);
        }
      }
    }
  }

  return `
[out:json][timeout:30];
(
${unionParts.join('\n')}
);
out center tags;
`.trim();
}

// ----------------------------------------------------------------
// Overpass API Abruf
// ----------------------------------------------------------------
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export interface OverpassResponse {
  elements: OverpassElement[];
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>;
}

/**
 * Holt Umwelt-Standorte aus Overpass API.
 * Fallback auf zweiten Endpoint wenn erster fehlschlägt.
 */
export async function fetchOsmEnvFeatures(
  bbox: BoundingBox,
  types?: OsmEnvType[]
): Promise<OsmEnvFeature[]> {
  const query = buildOsmEnvQuery(bbox, types);

  let response: Response | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(35_000),
      });
      if (response.ok) break;
    } catch {
      continue;
    }
  }

  if (!response || !response.ok) {
    throw new Error('Overpass API nicht erreichbar');
  }

  const data: OverpassResponse = await response.json();
  return data.elements.map(parseOverpassElement).filter(Boolean) as OsmEnvFeature[];
}

// ----------------------------------------------------------------
// Overpass Element → OsmEnvFeature
// ----------------------------------------------------------------
function parseOverpassElement(el: OverpassElement): OsmEnvFeature | null {
  const tags = el.tags ?? {};

  // Koordinaten ermitteln (node → direkt, way/relation → center)
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;

  if (!lat || !lon) return null;

  const osmEnvType = detectOsmEnvType(tags);
  if (!osmEnvType) return null;

  const ecoCategory = getEcoCategory(osmEnvType);

  const geo_point: GeoPoint = {
    type: 'Point',
    coordinates: [lon, lat],
  };

  return {
    osm_id: el.id,
    osm_type: el.type,
    osm_env_type: osmEnvType,
    name: tags.name ?? tags['name:de'] ?? tags['name:en'],
    operator: tags.operator,
    geo_point,
    tags,
    eco_category: ecoCategory,
  };
}

/**
 * Erkennt den OsmEnvType anhand der OSM Tags.
 */
function detectOsmEnvType(tags: Record<string, string>): OsmEnvType | null {
  for (const q of OSM_ENV_QUERIES) {
    for (const f of q.filters) {
      if (tags[f.key] === f.value) {
        return q.osmEnvType;
      }
    }
  }
  return null;
}

function getEcoCategory(osmEnvType: OsmEnvType): EmitterType {
  return OSM_ENV_QUERIES.find(q => q.osmEnvType === osmEnvType)?.ecoCategory ?? 'other';
}

// ----------------------------------------------------------------
// BBox aus MapLibre Viewport berechnen
// ----------------------------------------------------------------
export function viewportToBBox(bounds: {
  _sw: { lat: number; lng: number };
  _ne: { lat: number; lng: number };
}): BoundingBox {
  return {
    south: bounds._sw.lat,
    west: bounds._sw.lng,
    north: bounds._ne.lat,
    east: bounds._ne.lng,
  };
}

// ----------------------------------------------------------------
// Cache  (verhindert zu viele Overpass-Requests)
// Schlüssel = BBox-gerundet auf 0.5° + aktive Typen
// ----------------------------------------------------------------
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 Minuten

interface CacheEntry {
  features: OsmEnvFeature[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

export function cacheKey(bbox: BoundingBox, types?: OsmEnvType[]): string {
  const round = (n: number) => Math.round(n * 2) / 2; // 0.5° Raster
  const b = `${round(bbox.south)},${round(bbox.west)},${round(bbox.north)},${round(bbox.east)}`;
  const t = types ? types.sort().join(',') : 'all';
  return `${b}|${t}`;
}

export async function fetchOsmEnvCached(
  bbox: BoundingBox,
  types?: OsmEnvType[]
): Promise<OsmEnvFeature[]> {
  const key = cacheKey(bbox, types);
  const cached = cache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.features;
  }

  const features = await fetchOsmEnvFeatures(bbox, types);
  cache.set(key, { features, timestamp: Date.now() });
  return features;
}
