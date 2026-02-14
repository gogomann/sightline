terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = "online-add-testen"
  region  = "europe-west1"
}

# -------------------------------------------------------
# GCS Bucket
# -------------------------------------------------------
resource "google_storage_bucket" "uploads" {
  name                        = "ecoatlas-uploads-online-add-testen"
  location                    = "EUROPE-WEST1"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  force_destroy               = false

  # Anonyme Uploads landen direkt im Papierkorb nach 7 Tagen
  # wenn sie nicht durch Cloud Function bestätigt wurden
  lifecycle_rule {
    condition {
      age            = 7
      matches_prefix = ["tmp/"]
    }
    action {
      type = "Delete"
    }
  }

  # Verifizierte Attachments: 10 Jahre Aufbewahrung
  lifecycle_rule {
    condition {
      age            = 3650
      matches_prefix = ["verified/"]
    }
    action {
      type = "Delete"
    }
  }

  # CORS für direkte Browser-Uploads via signed URL
  cors {
    origin          = ["https://ecoatlas.app", "http://localhost:3000"]
    method          = ["GET", "PUT", "OPTIONS"]
    response_header = ["Content-Type", "x-goog-meta-*"]
    max_age_seconds = 3600
  }

  versioning {
    enabled = false
  }
}

# -------------------------------------------------------
# Service Account für Tile-Server (signierte URLs erstellen)
# -------------------------------------------------------
resource "google_service_account" "upload_signer" {
  account_id   = "ecoatlas-upload-signer"
  display_name = "EcoAtlas Upload URL Signer"
}

resource "google_storage_bucket_iam_member" "signer_can_create_objects" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.upload_signer.email}"
}

# Für signedURL v4 braucht der SA sich selbst signieren dürfen
resource "google_service_account_iam_member" "signer_token_creator" {
  service_account_id = google_service_account.upload_signer.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.upload_signer.email}"
}

# -------------------------------------------------------
# Service Account für Cloud Run (Objekte lesen/löschen)
# -------------------------------------------------------
resource "google_service_account" "cloud_run_sa" {
  account_id   = "ecoatlas-cloud-run"
  display_name = "EcoAtlas Cloud Run Service"
}

resource "google_storage_bucket_iam_member" "cloud_run_object_admin" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# -------------------------------------------------------
# Outputs
# -------------------------------------------------------
output "bucket_name" {
  value = google_storage_bucket.uploads.name
}

output "upload_signer_email" {
  value = google_service_account.upload_signer.email
}

output "cloud_run_sa_email" {
  value = google_service_account.cloud_run_sa.email
}
