-- ============================================================
-- EcoAtlas: Schema-Erweiterungen für File-Upload
-- Projekt: online-add-testen | Region: europe-west1
-- ============================================================

-- ------------------------------------------------------------
-- 1. eco_audit.scan_log  (neu)
-- Protokolliert jeden Virus-Scan
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `online-add-testen.eco_audit.scan_log` (
  scanned_at      TIMESTAMP  NOT NULL,
  original_path   STRING     NOT NULL,   -- tmp/photos/uuid/file.jpg
  verified_path   STRING,                -- verified/photos/uuid/file.jpg  (NULL = gelöscht)
  scan_result     STRING     NOT NULL,   -- 'clean' | 'infected' | 'scan-error'
  submission_id   STRING,                -- Verknüpfung zur Meldung
  uploaded_by_ip  STRING,
  uploaded_at     TIMESTAMP,
  details         STRING                 -- ClamAV Output bei Fund
)
PARTITION BY DATE(scanned_at)
OPTIONS (
  description = 'Virus-Scan Protokoll für alle Datei-Uploads',
  partition_expiration_days = 1825  -- 5 Jahre
);

-- ------------------------------------------------------------
-- 2. eco_community.submissions: attachments Spalte hinzufügen
-- BigQuery kennt kein ALTER TABLE ADD COLUMN direkt in DDL,
-- deshalb hier als Migrations-Statement
-- ------------------------------------------------------------

-- Neue Spalten via DML-kompatiblem SELECT INTO neuer Tabelle:
-- (In der Praxis via BigQuery Console oder bq-CLI ausführen)

-- Struktur der attachments (ARRAY of STRUCT):
-- attachments: [
--   {
--     object_path:  "verified/photos/uuid/foto.jpg",
--     content_type: "image/jpeg",
--     file_size:    1234567,
--     original_name: "baustelle_nordring.jpg",
--     uploaded_at:  "2026-02-14T10:00:00Z",
--     scan_status:  "clean"
--   }
-- ]

-- BigQuery CLI Befehl zum Hinzufügen der Spalte:
-- bq update \
--   --project_id=online-add-testen \
--   online-add-testen:eco_community.submissions \
--   schema_update.json

-- schema_update.json Inhalt:
-- {
--   "name": "attachments",
--   "type": "RECORD",
--   "mode": "REPEATED",
--   "fields": [
--     {"name": "object_path",    "type": "STRING",    "mode": "NULLABLE"},
--     {"name": "content_type",   "type": "STRING",    "mode": "NULLABLE"},
--     {"name": "file_size",      "type": "INTEGER",   "mode": "NULLABLE"},
--     {"name": "original_name",  "type": "STRING",    "mode": "NULLABLE"},
--     {"name": "uploaded_at",    "type": "TIMESTAMP", "mode": "NULLABLE"},
--     {"name": "scan_status",    "type": "STRING",    "mode": "NULLABLE"}
--   ]
-- }

-- ------------------------------------------------------------
-- 3. Nützliche Views
-- ------------------------------------------------------------

-- Offene Scans (noch in tmp/, kein Ergebnis)
CREATE OR REPLACE VIEW `online-add-testen.eco_audit.v_pending_scans` AS
SELECT
  s.submission_id,
  s.submitted_at,
  s.status,
  a.object_path,
  a.content_type,
  a.file_size,
  a.original_name
FROM `online-add-testen.eco_community.submissions` s,
UNNEST(s.attachments) AS a
WHERE a.scan_status = 'pending'
  AND s.status = 'pending';

-- Infizierte Dateien (für Admin-Monitoring)
CREATE OR REPLACE VIEW `online-add-testen.eco_audit.v_infected_files` AS
SELECT
  scanned_at,
  original_path,
  uploaded_by_ip,
  uploaded_at,
  details
FROM `online-add-testen.eco_audit.scan_log`
WHERE scan_result = 'infected'
ORDER BY scanned_at DESC;

-- Upload-Statistik pro Tag
CREATE OR REPLACE VIEW `online-add-testen.eco_audit.v_upload_stats_daily` AS
SELECT
  DATE(scanned_at)   AS scan_date,
  COUNT(*)           AS total_scans,
  COUNTIF(scan_result = 'clean')      AS clean,
  COUNTIF(scan_result = 'infected')   AS infected,
  COUNTIF(scan_result = 'scan-error') AS errors
FROM `online-add-testen.eco_audit.scan_log`
GROUP BY 1
ORDER BY 1 DESC;
