const { Storage } = require('@google-cloud/storage');
const { BigQuery } = require('@google-cloud/bigquery');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const storage = new Storage();
const bigquery = new BigQuery({ projectId: 'online-add-testen' });
const BUCKET = 'ecoatlas-uploads-online-add-testen';

exports.virusScanOnUpload = async (event) => {
  const objectPath = event.name;
  const bucket = event.bucket;

  if (!objectPath.startsWith('tmp/')) {
    console.log(`Skip: ${objectPath} nicht in tmp/`);
    return;
  }

  console.log(`Scan start: gs://${bucket}/${objectPath}`);
  const tmpFile = path.join(os.tmpdir(), `scan_${Date.now()}_${path.basename(objectPath)}`);

  try {
    await storage.bucket(bucket).file(objectPath).download({ destination: tmpFile });

    let scanResult = 'error';
    let scanDetails = '';

    try {
      execSync(`clamscan --no-summary ${tmpFile}`);
      scanResult = 'clean';
    } catch (err) {
      if (err.status === 1) {
        scanResult = 'infected';
        scanDetails = err.stdout?.toString() ?? '';
      } else {
        scanResult = 'scan-error';
        scanDetails = err.stderr?.toString() ?? '';
      }
    }

    const [meta] = await storage.bucket(bucket).file(objectPath).getMetadata();
    const metadata = meta.metadata ?? {};

    if (scanResult === 'clean') {
      const verifiedPath = objectPath.replace(/^tmp\//, 'verified/');
      await storage.bucket(bucket).file(objectPath).copy(storage.bucket(bucket).file(verifiedPath));
      await storage.bucket(bucket).file(objectPath).delete();
      await storage.bucket(bucket).file(verifiedPath).setMetadata({
        metadata: { 'virus-scan-status': 'clean', 'verified-at': new Date().toISOString() }
      });
      console.log(`Clean → verschoben zu: ${verifiedPath}`);
    } else if (scanResult === 'infected') {
      await storage.bucket(bucket).file(objectPath).delete();
      console.warn(`Infiziert → gelöscht: ${objectPath}`);
    } else {
      await storage.bucket(bucket).file(objectPath).setMetadata({
        metadata: { 'virus-scan-status': 'scan-error' }
      });
    }

    await bigquery.dataset('eco_audit').table('scan_log').insert([{
      scanned_at:     new Date(),
      original_path:  objectPath,
      verified_path:  scanResult === 'clean' ? objectPath.replace(/^tmp\//, 'verified/') : null,
      scan_result:    scanResult,
      submission_id:  metadata['submission-id'] ?? null,
      uploaded_by_ip: metadata['uploaded-by-ip'] ?? null,
      uploaded_at:    metadata['uploaded-at'] ? new Date(metadata['uploaded-at']) : null,
      details:        scanDetails || null,
    }]);

  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
};