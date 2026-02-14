"use strict";
// ============================================================
// EcoAtlas Tile Server – BigQuery Client
// Projekt: online-add-testen | Region: europe-west1
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.tileToBounds = tileToBounds;
exports.queryEmitters = queryEmitters;
exports.queryEmitterDetail = queryEmitterDetail;
exports.queryCommunitySubmissions = queryCommunitySubmissions;
exports.querySubmissionDetail = querySubmissionDetail;
const bigquery_1 = require("@google-cloud/bigquery");
const bq = new bigquery_1.BigQuery({
    projectId: process.env.GCP_PROJECT_ID ?? 'online-add-testen',
    location: 'europe-west1',
});
function tileToBounds(z, x, y) {
    const n = Math.pow(2, z);
    const minLng = (x / n) * 360 - 180;
    const maxLng = ((x + 1) / n) * 360 - 180;
    const minLat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
    const maxLat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    return { minLng, minLat, maxLng, maxLat };
}
async function queryEmitters(bounds) {
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
    return rows;
}
async function queryEmitterDetail(emitterId) {
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
    if (!baseRows.length)
        return null;
    const base = baseRows[0];
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
        measurements: measRows,
        infrastructure: infraRows,
    };
}
async function queryCommunitySubmissions(bounds) {
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
    return rows;
}
async function querySubmissionDetail(submissionId) {
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
    if (!baseRows.length)
        return null;
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
        ...baseRows[0],
        comments: commentRows,
    };
}
