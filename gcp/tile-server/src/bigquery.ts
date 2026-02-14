// ============================================================
// EcoAtlas Tile Server – BigQuery Client
// Projekt: online-add-testen | Region: europe-west1
// ============================================================

import { BigQuery } from '@google-cloud/bigquery';

const bq = new BigQuery({
  projectId: process.env.GCP_PROJECT_ID ?? 'online-add-testen',
  location: 'europe-west1',
});

// ----------------------------------------------------------------
// Tile BBox → Lat/Lng Grenzen
// ----------------------------------------------------------------
export interface TileBounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export function tileToBounds(z: number, x: number, y: number): TileBounds {
  const n = Math.pow(2, z);
  const minLng = (x / n) * 360 - 180;
  const maxLng = ((x + 1) / n) * 360 - 180;
  const minLat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  const maxLat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { minLng, minLat, maxLng, maxLat };
}

// ----------------------------------------------------------------
// eco_core.emitters – Verifizierte Standorte als GeoJSON
// ----------------------------------------------------------------
export interface EmitterFeature {
  emitter_id: string;
  name: string;
  emitter_type: string;
  description: string | null;
  lng: number;
  lat: number;
  has_area: boolean;
  responsible_entity: string | null;
  active_from: string | null;
  active_to: string | null;
  is_active: boolean;
  is_locked: boolean;
  wiki_url: string | null;
  source_url: string | null;
}

export async function queryEmitters(bounds: TileBounds): Promise<EmitterFeature[]> {
  const { minLng, minLat, maxLng, maxLat } = bounds;

  const query = `
    SELECT
      emitter_id,
      name,
      emitter_type,
      description,
      ST_X(geo_point) AS lng,
      ST_Y(geo_point) AS lat,
      geo_area IS NOT NULL AS has_area,
      responsible_entity,
      CAST(active_from AS STRING) AS active_from,
      CAST(active_to   AS STRING) AS active_to,
      COALESCE(is_active, TRUE)   AS is_active,
      COALESCE(is_locked, FALSE)  AS is_locked,
      wiki_url,
      source_url
    FROM \`online-add-testen.eco_core.emitters\`
    WHERE geo_point IS NOT NULL
      AND ST_Within(
        geo_point,
        ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat})
      )
    ORDER BY name
    LIMIT 2000
  `;

  const [rows] = await bq.query({ query, location: 'europe-west1' });
  return rows as EmitterFeature[];
}

// ----------------------------------------------------------------
// eco_core.emitters – Einzelner Emitter mit Messungen
// ----------------------------------------------------------------
export interface EmitterDetail extends EmitterFeature {
  address: string | null;
  country_code: string | null;
  responsible_contact: string | null;
  source_type: string | null;
  created_at: string | null;
  updated_at: string | null;
  measurements: MeasurementSummary[];
  infrastructure: InfraItem[];
}

export interface MeasurementSummary {
  emission_type_id: string;
  emission_name: string;
  unit: string;
  latest_value: number;
  latest_at: string;
  period_count: number;
  category: string;
  hazard_level: string | null;
}

export interface InfraItem {
  infra_type: string;
  name: string | null;
  status: string | null;
  energy_consumption_kwh: number | null;
  installed_at: string | null;
  decommissioned_at: string | null;
}

export async function queryEmitterDetail(emitterId: string): Promise<EmitterDetail | null> {
  // Basis-Daten
  const baseQuery = `
    SELECT
      emitter_id, name, emitter_type, description,
      ST_X(geo_point) AS lng,
      ST_Y(geo_point) AS lat,
      geo_area IS NOT NULL AS has_area,
      address, country_code,
      responsible_entity, responsible_contact,
      CAST(active_from AS STRING) AS active_from,
      CAST(active_to   AS STRING) AS active_to,
      COALESCE(is_active, TRUE)  AS is_active,
      COALESCE(is_locked, FALSE) AS is_locked,
      wiki_url, source_url, source_type,
      CAST(created_at AS STRING) AS created_at,
      CAST(updated_at AS STRING) AS updated_at
    FROM \`online-add-testen.eco_core.emitters\`
    WHERE emitter_id = @emitterId
    LIMIT 1
  `;

  const [baseRows] = await bq.query({
    query: baseQuery,
    params: { emitterId },
    location: 'europe-west1',
  });

  if (!baseRows.length) return null;
  const base = baseRows[0] as EmitterDetail;

  // Messungen (aggregiert nach Emissionstyp)
  const measQuery = `
    SELECT
      m.emission_type_id,
      et.name  AS emission_name,
      et.unit,
      et.category,
      et.hazard_level,
      MAX(m.value)                          AS latest_value,
      CAST(MAX(m.measured_at) AS STRING)    AS latest_at,
      COUNT(*)                              AS period_count
    FROM \`online-add-testen.eco_core.measurements\` m
    JOIN \`online-add-testen.eco_core.emission_types\` et
      ON et.emission_type_id = m.emission_type_id
    WHERE m.emitter_id = @emitterId
    GROUP BY m.emission_type_id, et.name, et.unit, et.category, et.hazard_level
    ORDER BY latest_at DESC
  `;

  const [measRows] = await bq.query({
    query: measQuery,
    params: { emitterId },
    location: 'europe-west1',
  });

  // Infrastruktur
  const infraQuery = `
    SELECT
      infra_type, name, status,
      energy_consumption_kwh,
      CAST(installed_at      AS STRING) AS installed_at,
      CAST(decommissioned_at AS STRING) AS decommissioned_at
    FROM \`online-add-testen.eco_core.infrastructure\`
    WHERE emitter_id = @emitterId
    ORDER BY installed_at DESC
  `;

  const [infraRows] = await bq.query({
    query: infraQuery,
    params: { emitterId },
    location: 'europe-west1',
  });

  return {
    ...base,
    measurements: measRows as MeasurementSummary[],
    infrastructure: infraRows as InfraItem[],
  };
}

// ----------------------------------------------------------------
// eco_community.submissions – Community Quarantäne-Layer
// ----------------------------------------------------------------
export interface CommunityFeature {
  submission_id: string;
  proposed_name: string | null;
  proposed_type: string | null;
  lng: number;
  lat: number;
  status: string;
  upvotes: number;
  downvotes: number;
  created_at: string;
  user_display_name: string | null;
}

export async function queryCommunitySubmissions(bounds: TileBounds): Promise<CommunityFeature[]> {
  const { minLng, minLat, maxLng, maxLat } = bounds;

  const query = `
    SELECT
      submission_id,
      proposed_name,
      proposed_type,
      ST_X(proposed_geo_point) AS lng,
      ST_Y(proposed_geo_point) AS lat,
      COALESCE(status, 'pending')   AS status,
      COALESCE(upvotes, 0)          AS upvotes,
      COALESCE(downvotes, 0)        AS downvotes,
      CAST(created_at AS STRING)    AS created_at,
      user_display_name
    FROM \`online-add-testen.eco_community.submissions\`
    WHERE proposed_geo_point IS NOT NULL
      AND promoted_to_core IS NOT TRUE
      AND ST_Within(
        proposed_geo_point,
        ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat})
      )
    ORDER BY created_at DESC
    LIMIT 500
  `;

  const [rows] = await bq.query({ query, location: 'europe-west1' });
  return rows as CommunityFeature[];
}

// ----------------------------------------------------------------
// eco_community – Einzel-Submission mit Kommentaren
// ----------------------------------------------------------------
export interface SubmissionDetail extends CommunityFeature {
  proposed_description: string | null;
  proposed_emission_type: string | null;
  proposed_value: number | null;
  proposed_unit: string | null;
  proposed_source_url: string | null;
  proposed_responsible: string | null;
  proposed_active_from: string | null;
  proposed_active_to: string | null;
  review_note: string | null;
  comments: CommentItem[];
}

export interface CommentItem {
  comment_id: string;
  user_display_name: string | null;
  content: string;
  parent_comment_id: string | null;
  created_at: string;
}

export async function querySubmissionDetail(submissionId: string): Promise<SubmissionDetail | null> {
  const baseQuery = `
    SELECT
      submission_id, proposed_name, proposed_type,
      proposed_description, proposed_emission_type,
      proposed_value, proposed_unit, proposed_source_url,
      proposed_responsible,
      CAST(proposed_active_from AS STRING) AS proposed_active_from,
      CAST(proposed_active_to   AS STRING) AS proposed_active_to,
      ST_X(proposed_geo_point) AS lng,
      ST_Y(proposed_geo_point) AS lat,
      COALESCE(status, 'pending') AS status,
      COALESCE(upvotes, 0)        AS upvotes,
      COALESCE(downvotes, 0)      AS downvotes,
      review_note,
      CAST(created_at AS STRING) AS created_at,
      user_display_name
    FROM \`online-add-testen.eco_community.submissions\`
    WHERE submission_id = @submissionId
    LIMIT 1
  `;

  const [baseRows] = await bq.query({
    query: baseQuery,
    params: { submissionId },
    location: 'europe-west1',
  });

  if (!baseRows.length) return null;

  const commentsQuery = `
    SELECT
      comment_id, user_display_name, content,
      parent_comment_id,
      CAST(created_at AS STRING) AS created_at
    FROM \`online-add-testen.eco_community.comments\`
    WHERE submission_id = @submissionId
      AND COALESCE(is_deleted, FALSE) = FALSE
    ORDER BY created_at ASC
  `;

  const [commentRows] = await bq.query({
    query: commentsQuery,
    params: { submissionId },
    location: 'europe-west1',
  });

  return {
    ...baseRows[0] as SubmissionDetail,
    comments: commentRows as CommentItem[],
  };
}
