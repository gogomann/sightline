#!/usr/bin/env bash
# ============================================================
# EcoAtlas: GCS Upload-Infrastruktur deployen
# Projekt: online-add-testen | Region: europe-west1
# Ausführen: bash deploy_upload.sh
# ============================================================
set -euo pipefail

PROJECT="online-add-testen"
REGION="europe-west1"
BUCKET="ecoatlas-uploads-${PROJECT}"

echo "=== EcoAtlas Upload-Infrastruktur ==="
echo "Projekt : $PROJECT"
echo "Region  : $REGION"
echo "Bucket  : $BUCKET"
echo ""

# -------------------------------------------------------
# 1. Terraform: Bucket + Service Accounts
# -------------------------------------------------------
echo "--- [1/4] Terraform apply ---"
cd terraform
terraform init -upgrade
terraform apply -auto-approve \
  -var="project=${PROJECT}" \
  -var="region=${REGION}"
cd ..

SIGNER_SA=$(terraform -chdir=terraform output -raw upload_signer_email)
CLOUD_RUN_SA=$(terraform -chdir=terraform output -raw cloud_run_sa_email)
echo "Signer SA   : $SIGNER_SA"
echo "Cloud Run SA: $CLOUD_RUN_SA"

# -------------------------------------------------------
# 2. BigQuery Schema: scan_log Tabelle + attachments Spalte
# -------------------------------------------------------
echo ""
echo "--- [2/4] BigQuery Schema ---"

# scan_log Tabelle erstellen
bq query \
  --project_id="${PROJECT}" \
  --location="${REGION}" \
  --use_legacy_sql=false \
  < scripts/schema_upload.sql

# attachments Spalte zu eco_community.submissions hinzufügen
cat > /tmp/attachments_schema.json << 'EOF'
[
  {
    "name": "attachments",
    "type": "RECORD",
    "mode": "REPEATED",
    "fields": [
      {"name": "object_path",   "type": "STRING",    "mode": "NULLABLE"},
      {"name": "content_type",  "type": "STRING",    "mode": "NULLABLE"},
      {"name": "file_size",     "type": "INTEGER",   "mode": "NULLABLE"},
      {"name": "original_name", "type": "STRING",    "mode": "NULLABLE"},
      {"name": "uploaded_at",   "type": "TIMESTAMP", "mode": "NULLABLE"},
      {"name": "scan_status",   "type": "STRING",    "mode": "NULLABLE"}
    ]
  }
]
EOF

bq update \
  --project_id="${PROJECT}" \
  "${PROJECT}:eco_community.submissions" \
  /tmp/attachments_schema.json 2>/dev/null || echo "(attachments Spalte existiert bereits)"

echo "BigQuery Schema OK"

# -------------------------------------------------------
# 3. Cloud Function: Virus-Scan Trigger
# -------------------------------------------------------
echo ""
echo "--- [3/4] Cloud Function deployen ---"

gcloud functions deploy ecoatlas-virus-scan \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --gen2 \
  --runtime=nodejs20 \
  --entry-point=virusScanOnUpload \
  --trigger-event-filters="type=google.cloud.storage.object.v1.finalized" \
  --trigger-event-filters="bucket=${BUCKET}" \
  --service-account="${CLOUD_RUN_SA}" \
  --memory=512MB \
  --timeout=300s \
  --source=./src \
  --set-env-vars="GCP_PROJECT=${PROJECT},BUCKET_NAME=${BUCKET}" \
  --no-allow-unauthenticated

echo "Cloud Function OK"

# -------------------------------------------------------
# 4. Cloud Run: Upload-Endpoint (Tile-Server erweitern)
# -------------------------------------------------------
echo ""
echo "--- [4/4] Cloud Run Upload-Routes aktivieren ---"
echo "Füge Upload-Routen zum bestehenden Tile-Server hinzu..."

# Env-Vars für bestehenden Cloud Run Service aktualisieren
gcloud run services update ecoatlas-tiles \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --update-env-vars="GCS_BUCKET=${BUCKET},UPLOAD_SIGNER_SA=${SIGNER_SA}" \
  --service-account="${CLOUD_RUN_SA}"

echo ""
echo "=== Deployment abgeschlossen ==="
echo ""
echo "Nächste Schritte:"
echo "1. CORS-Origin in terraform/main.tf auf deine Domain anpassen"
echo "2. Rate-Limit (aktuell: 10/h/IP) in src/upload.ts anpassen"
echo "3. Frontend: Upload-Komponente einbauen (handlePresignRequest)"
echo ""
echo "Test-Upload:"
echo "  curl -X POST https://ecoatlas-tiles-xxx.run.app/upload/presign \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"filename\":\"test.jpg\",\"contentType\":\"image/jpeg\"}'"
