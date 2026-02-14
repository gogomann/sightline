#!/bin/bash
# ============================================================
# EcoAtlas Tile Server – Cloud Run Deployment
# Projekt: online-add-testen | Region: europe-west1
# ============================================================

set -e

PROJECT_ID="online-add-testen"
REGION="europe-west1"
SERVICE_NAME="ecoatlas-tile-server"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "▶ Baue Docker Image..."
gcloud builds submit \
  --tag "${IMAGE}" \
  --project "${PROJECT_ID}"

echo "▶ Deploye auf Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --platform managed \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --concurrency 80 \
  --timeout 30 \
  --set-env-vars "GCP_PROJECT_ID=${PROJECT_ID},NODE_ENV=production" \
  --service-account "tile-server@${PROJECT_ID}.iam.gserviceaccount.com"

echo "✅ Deployment fertig."
echo "URL: $(gcloud run services describe ${SERVICE_NAME} --region ${REGION} --project ${PROJECT_ID} --format 'value(status.url)')"
