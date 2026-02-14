/**
 * Cloud Function: virusScanOnUpload
 * Trigger: GCS Finalize (neues Objekt in tmp/)
 * 
 * Scannt jede neue Datei mit ClamAV via gcf-scanner Pattern.
 * Sauber → nach verified/ verschieben
 * Infiziert → löschen + ins Audit-Log schreiben
 */

import { Storage } from '@google-cloud/storage';
import { CloudEvent } from '@google-cloud/functions-framework';
import { BigQuery } from '@google-cloud/bigquery';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);
const storage = new Storage();
const bigquery = new BigQuery({ projectId: 'online-add-testen' });
const BUCKET = 'ecoatlas-uploads-online-add-testen';

interface GCSEvent {
  bucket: string;
  name: string;
  contentType: string;
  size: string;
  metadata?: Record<string, string>;
}

export async function virusScanOnUpload(event: CloudEvent<GCSEvent>): Promise<void> {
  const data = event.data;
  if (!data) return;

  const { bucket, name: objectPath } = data;

  // Nur tmp/ Objekte scannen
  if (!objectPath.startsWith('tmp/')) {
    console.log(`[scan] Skip: ${objectPath} ist nicht in tmp/`);
    return;
  }

  console.log(`[scan] Start: gs://${bucket}/${objectPath}`);

  // Datei temporär herunterladen
  const tmpFile = path.join(os.tmpdir(), `scan_${Date.now()}_${path.basename(objectPath)}`);
  try {
    await storage.bucket(bucket).file(objectPath).download({ destination: tmpFile });

    // ClamAV Scan
    let scanResult: 'clean' | 'infected' | 'error' = 'error';
    let scanDetails = '';

    try {
      await execAsync(`clamscan --no-summary ${tmpFile}`);
      scanResult = 'clean';
      console.log(`[scan] CLEAN: ${objectPath}`);
    } catch (clamErr: unknown) {
      const err = clamErr as { code?: number; stderr?: string; stdout?: string };
      if (err.code === 1) {
        // Exit 1 = Virus gefunden
        scanResult = 'infected';
        scanDetails = err.stdout ?? '';
        console.warn(`[scan] INFECTED: ${objectPath} — ${scanDetails}`);
      } else {
        // Exit 2 = Scan-Fehler
        scanResult = 'error';
        scanDetails = err.stderr ?? '';
        console.error(`[scan] ERROR: ${objectPath} — ${scanDetails}`);
      }
    }

    if (scanResult === 'clean') {
      // Nach verified/ verschieben
      const verifiedPath = objectPath.replace(/^tmp\//, 'verified/');
      await storage.bucket(bucket).file(objectPath).copy(
        storage.bucket(bucket).file(verifiedPath)
      );
      await storage.bucket(bucket).file(objectPath).delete();

      // Metadata setzen
      await storage.bucket(bucket).file(verifiedPath).setMetadata({
        metadata: {
          'virus-scan-status': 'clean',
          'verified-at': new Date().toISOString(),
        },
      });

      await logScanResult(objectPath, verifiedPath, 'clean', data.metadata);
      console.log(`[scan] Verschoben zu: ${verifiedPath}`);

    } else if (scanResult === 'infected') {
      // Datei löschen
      await storage.bucket(bucket).file(objectPath).delete();
      await logScanResult(objectPath, null, 'infected', data.metadata, scanDetails);
      console.warn(`[scan] Gelöscht (infiziert): ${objectPath}`);

    } else {
      // Bei Scan-Fehler: Metadata setzen und manuell prüfen lassen
      await storage.bucket(bucket).file(objectPath).setMetadata({
        metadata: { 'virus-scan-status': 'scan-error' },
      });
      await logScanResult(objectPath, null, 'scan-error', data.metadata, scanDetails);
    }

  } finally {
    // Temp-Datei immer aufräumen
    await fs.unlink(tmpFile).catch(() => {});
  }
}

async function logScanResult(
  originalPath: string,
  verifiedPath: string | null,
  result: 'clean' | 'infected' | 'scan-error',
  metadata?: Record<string, string>,
  details?: string
): Promise<void> {
  try {
    await bigquery.dataset('eco_audit').table('scan_log').insert([{
      scanned_at:      new Date().toISOString(),
      original_path:   originalPath,
      verified_path:   verifiedPath,
      scan_result:     result,
      submission_id:   metadata?.['submission-id'] ?? null,
      uploaded_by_ip:  metadata?.['uploaded-by-ip'] ?? null,
      uploaded_at:     metadata?.['uploaded-at'] ?? null,
      details:         details ?? null,
    }]);
  } catch (err) {
    // Log-Fehler nicht weitermelden — Scan-Ergebnis ist wichtiger
    console.error('[scan] BigQuery log error:', err);
  }
}
