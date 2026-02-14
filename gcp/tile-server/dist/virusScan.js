"use strict";
/**
 * Cloud Function: virusScanOnUpload
 * Trigger: GCS Finalize (neues Objekt in tmp/)
 *
 * Scannt jede neue Datei mit ClamAV via gcf-scanner Pattern.
 * Sauber → nach verified/ verschieben
 * Infiziert → löschen + ins Audit-Log schreiben
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.virusScanOnUpload = virusScanOnUpload;
const storage_1 = require("@google-cloud/storage");
const bigquery_1 = require("@google-cloud/bigquery");
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs/promises"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const storage = new storage_1.Storage();
const bigquery = new bigquery_1.BigQuery({ projectId: 'online-add-testen' });
const BUCKET = 'ecoatlas-uploads-online-add-testen';
async function virusScanOnUpload(event) {
    const data = event.data;
    if (!data)
        return;
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
        let scanResult = 'error';
        let scanDetails = '';
        try {
            await execAsync(`clamscan --no-summary ${tmpFile}`);
            scanResult = 'clean';
            console.log(`[scan] CLEAN: ${objectPath}`);
        }
        catch (clamErr) {
            const err = clamErr;
            if (err.code === 1) {
                // Exit 1 = Virus gefunden
                scanResult = 'infected';
                scanDetails = err.stdout ?? '';
                console.warn(`[scan] INFECTED: ${objectPath} — ${scanDetails}`);
            }
            else {
                // Exit 2 = Scan-Fehler
                scanResult = 'error';
                scanDetails = err.stderr ?? '';
                console.error(`[scan] ERROR: ${objectPath} — ${scanDetails}`);
            }
        }
        if (scanResult === 'clean') {
            // Nach verified/ verschieben
            const verifiedPath = objectPath.replace(/^tmp\//, 'verified/');
            await storage.bucket(bucket).file(objectPath).copy(storage.bucket(bucket).file(verifiedPath));
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
        }
        else if (scanResult === 'infected') {
            // Datei löschen
            await storage.bucket(bucket).file(objectPath).delete();
            await logScanResult(objectPath, null, 'infected', data.metadata, scanDetails);
            console.warn(`[scan] Gelöscht (infiziert): ${objectPath}`);
        }
        else {
            // Bei Scan-Fehler: Metadata setzen und manuell prüfen lassen
            await storage.bucket(bucket).file(objectPath).setMetadata({
                metadata: { 'virus-scan-status': 'scan-error' },
            });
            await logScanResult(objectPath, null, 'scan-error', data.metadata, scanDetails);
        }
    }
    finally {
        // Temp-Datei immer aufräumen
        await fs.unlink(tmpFile).catch(() => { });
    }
}
async function logScanResult(originalPath, verifiedPath, result, metadata, details) {
    try {
        await bigquery.dataset('eco_audit').table('scan_log').insert([{
                scanned_at: new Date().toISOString(),
                original_path: originalPath,
                verified_path: verifiedPath,
                scan_result: result,
                submission_id: metadata?.['submission-id'] ?? null,
                uploaded_by_ip: metadata?.['uploaded-by-ip'] ?? null,
                uploaded_at: metadata?.['uploaded-at'] ?? null,
                details: details ?? null,
            }]);
    }
    catch (err) {
        // Log-Fehler nicht weitermelden — Scan-Ergebnis ist wichtiger
        console.error('[scan] BigQuery log error:', err);
    }
}
