// ============================================================
// EcoAtlas – Typen (abgeleitet aus BigQuery eco_core Schema)
// ============================================================

// ----------------------------------------------------------------
// eco_core.emitters
// ----------------------------------------------------------------
export interface EcoEmitter {
  emitter_id: string;
  name: string;
  emitter_type: EmitterType;
  description?: string;

  // Geografie – BigQuery GEOGRAPHY → im Frontend als GeoJSON
  geo_point?: GeoPoint;
  geo_area?: GeoPolygon;

  address?: string;
  country_code?: string;

  // Verantwortlichkeit
  responsible_entity?: string;
  responsible_contact?: string;
  wiki_url?: string;
  source_url?: string;
  source_type?: SourceType;

  // Zeitraum
  active_from?: string;   // ISO Date "YYYY-MM-DD"
  active_to?: string;     // ISO Date "YYYY-MM-DD"
  is_active?: boolean;

  // Sperren (nur Team kann ändern)
  is_locked?: boolean;
  locked_by?: string;
  locked_reason?: string;

  // Metadaten
  created_at?: string;
  updated_at?: string;
  created_by?: string;
}

// ----------------------------------------------------------------
// eco_core.measurements
// ----------------------------------------------------------------
export interface EcoMeasurement {
  measurement_id: string;
  emitter_id: string;
  emission_type_id: string;
  value: number;
  unit?: string;

  // Zeitpunkt / Zeitraum
  measured_at: string;      // ISO Timestamp
  period_start?: string;
  period_end?: string;

  measurement_method?: string;
  source_url?: string;
  source_type?: SourceType;
  confidence_level?: ConfidenceLevel;
  is_estimated?: boolean;

  created_at?: string;
  created_by?: string;
}

// ----------------------------------------------------------------
// eco_core.emission_types
// ----------------------------------------------------------------
export interface EcoEmissionType {
  emission_type_id: string;
  name: string;
  category: EmissionCategory;
  unit: string;
  description?: string;

  // Aggregatszustand
  is_gas?: boolean;
  is_liquid?: boolean;
  is_solid?: boolean;

  hazard_level?: HazardLevel;
  created_at?: string;
}

// ----------------------------------------------------------------
// eco_core.infrastructure
// ----------------------------------------------------------------
export interface EcoInfrastructure {
  infra_id: string;
  emitter_id: string;
  infra_type: InfraType;
  name?: string;
  description?: string;
  energy_consumption_kwh?: number;
  measurement_period?: string;
  status?: InfraStatus;
  installed_at?: string;
  decommissioned_at?: string;
  source_url?: string;
  created_at?: string;
}

// ----------------------------------------------------------------
// eco_community.submissions  (Quarantäne-Daten)
// ----------------------------------------------------------------
export interface EcoCommunitySubmission {
  submission_id: string;
  submitted_by: string;       // user_id
  submitted_at: string;
  status: SubmissionStatus;

  // Payload – gleiche Felder wie EcoEmitter
  payload: Partial<EcoEmitter>;

  // Voting
  vote_score?: number;
  vote_count?: number;
}

// ----------------------------------------------------------------
// eco_community.votes
// ----------------------------------------------------------------
export interface EcoCommunityVote {
  vote_id: string;
  submission_id: string;
  user_id: string;
  vote: 'up' | 'down';
  voted_at: string;
}

// ----------------------------------------------------------------
// eco_community.comments
// ----------------------------------------------------------------
export interface EcoCommunityComment {
  comment_id: string;
  submission_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at?: string;
}

// ----------------------------------------------------------------
// OSM Overpass Layer  (kein BigQuery – direkt von OSM)
// ----------------------------------------------------------------
export interface OsmEnvFeature {
  osm_id: number;
  osm_type: 'node' | 'way' | 'relation';
  osm_env_type: OsmEnvType;
  name?: string;
  operator?: string;
  geo_point?: GeoPoint;
  geo_area?: GeoPolygon;
  tags: Record<string, string>;

  // Mapping → EcoAtlas-Kategorie
  eco_category: EmitterType;
}

// ----------------------------------------------------------------
// Geo Primitiven
// ----------------------------------------------------------------
export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

export interface GeoPolygon {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

// ----------------------------------------------------------------
// Enum-ähnliche Typen
// ----------------------------------------------------------------

export type EmitterType =
  | 'landfill'
  | 'wastewater'
  | 'refinery'
  | 'power_plant'
  | 'chimney'
  | 'mine'
  | 'chemical_plant'
  | 'nuclear'
  | 'waste_disposal'
  | 'industrial'
  | 'pipeline'
  | 'other';

export type OsmEnvType =
  | 'landuse_landfill'
  | 'wastewater_plant'
  | 'chimney'
  | 'refinery'
  | 'power_plant'
  | 'mine_quarry'
  | 'waste_disposal'
  | 'nuclear_plant'
  | 'chemical_plant'
  | 'pipeline';

export type EmissionCategory =
  | 'gas'
  | 'liquid'
  | 'solid'
  | 'radiation'
  | 'noise'
  | 'heat'
  | 'light';

export type HazardLevel = 'low' | 'medium' | 'high' | 'critical';

export type ConfidenceLevel = 'low' | 'medium' | 'high' | 'verified';

export type SourceType =
  | 'official'
  | 'media'
  | 'community'
  | 'research'
  | 'osm'
  | 'unknown';

export type SubmissionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'needs_review';

export type InfraType =
  | 'pump'
  | 'filter'
  | 'chimney'
  | 'tank'
  | 'pipeline'
  | 'generator'
  | 'cooling_tower'
  | 'other';

export type InfraStatus = 'active' | 'inactive' | 'decommissioned' | 'unknown';

// ----------------------------------------------------------------
// Timeline  (für den Slider 1900–2026)
// ----------------------------------------------------------------
export interface TimelineRange {
  from: number;  // Jahr
  to: number;    // Jahr
}

export interface TimelineFilter {
  range: TimelineRange;
  showInactive: boolean;   // auch abgeschaltete Standorte zeigen
  showCommunity: boolean;  // Quarantäne-Daten einblenden
}

// ----------------------------------------------------------------
// Map Layer Konfiguration
// ----------------------------------------------------------------
export type LayerSource = 'osm' | 'eco_core' | 'eco_community';

export interface MapLayer {
  id: string;
  source: LayerSource;
  label: string;
  visible: boolean;
  color: string;
  minZoom?: number;
}

export const DEFAULT_LAYERS: MapLayer[] = [
  { id: 'osm-env',       source: 'osm',           label: 'OSM Umwelt',       visible: true,  color: '#4ade80', minZoom: 5  },
  { id: 'eco-verified',  source: 'eco_core',       label: 'Verifiziert',      visible: true,  color: '#60a5fa', minZoom: 3  },
  { id: 'eco-community', source: 'eco_community',  label: 'Community',        visible: false, color: '#f59e0b', minZoom: 7  },
];
