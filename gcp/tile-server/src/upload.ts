import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response } from 'express';

// -------------------------------------------------------
// Konfiguration
// -------------------------------------------------------
const BUCKET_NAME = process.env.GCS_BUCKET ?? 'ecoatlas-uploads-online-add-testen';
const SIGNED_URL_EXPIRES_MINUTES = 15;
const MAX_FILE_SIZE_BYTES = {
  'image/jpeg':      20 * 1024 * 1024,  // 20 MB
  'image/png':       20 * 1024 * 1024,  // 20 MB
  'application/pdf': 50 * 1024 * 1024,  // 50 MB
  'video/mp4':      500 * 1024 * 1024,  // 500 MB
  'application/geo+json':  5 * 1024 * 1024,  //  5 MB
  'application/vnd.google-earth.kml+xml': 5 * 1024 * 1024, // 5 MB
} as const;

type AllowedMime = keyof typeof MAX_FILE_SIZE_BYTES;
const ALLOWED_MIMES = Object.keys(MAX_FILE_SIZE_BYTES) as AllowedMime[];

// Dateiendungen → MIME (Sicherheitscheck)
const EXT_TO_MIME: Record<string, AllowedMime> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.pdf':  'application/pdf',
  '.mp4':  'video/mp4',
  '.geojson': 'application/geo+json',
  '.kml':  'application/vnd.google-earth.kml+xml',
};

// -------------------------------------------------------
// Rate Limiting (In-Memory, reicht für MVP)
// Produktion: Redis stattdessen
// -------------------------------------------------------
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 Stunde
  const maxRequests = 10;           // 10 Uploads/Stunde/IP anonym

  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { allowed: true };
}

// Cleanup alle 30 Minuten
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) rateLimitStore.delete(ip);
  }
}, 30 * 60 * 1000);

// -------------------------------------------------------
// GCS Storage Client
// -------------------------------------------------------
const storage = new Storage();

// -------------------------------------------------------
// Hilfsfunktionen
// -------------------------------------------------------
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

function sanitizeFilename(original: string): string {
  return original
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .substring(0, 100);
}

function getFilePrefix(mime: AllowedMime): string {
  if (mime.startsWith('image/')) return 'photos';
  if (mime === 'application/pdf') return 'documents';
  if (mime === 'video/mp4') return 'videos';
  return 'geodata';
}

// -------------------------------------------------------
// POST /upload/presign
// Body: { filename: string, contentType: string, submissionId?: string }
// Response: { uploadUrl: string, objectPath: string, expiresAt: string }
// -------------------------------------------------------
export async function handlePresignRequest(req: Request, res: Response): Promise<void> {
  const ip = getClientIp(req);

  // Rate Limit prüfen
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    res.status(429).json({
      error: 'Zu viele Upload-Anfragen. Bitte warte eine Stunde.',
      retryAfter: rateCheck.retryAfter,
    });
    return;
  }

  const { filename, contentType, submissionId } = req.body as {
    filename?: string;
    contentType?: string;
    submissionId?: string;
  };

  // Eingaben validieren
  if (!filename || typeof filename !== 'string') {
    res.status(400).json({ error: 'filename fehlt' });
    return;
  }
  if (!contentType || !ALLOWED_MIMES.includes(contentType as AllowedMime)) {
    res.status(400).json({
      error: 'contentType nicht erlaubt',
      allowed: ALLOWED_MIMES,
    });
    return;
  }

  // Dateiendung gegen MIME prüfen (Spoofing-Schutz)
  const ext = ('.' + filename.split('.').pop()?.toLowerCase()) as string;
  const expectedMime = EXT_TO_MIME[ext];
  if (expectedMime !== contentType) {
    res.status(400).json({
      error: `Dateiendung ${ext} passt nicht zu contentType ${contentType}`,
    });
    return;
  }

  const mime = contentType as AllowedMime;
  const maxSize = MAX_FILE_SIZE_BYTES[mime];
  const fileId = uuidv4();
  const safeName = sanitizeFilename(filename);
  const prefix = getFilePrefix(mime);

  // Pfad: tmp/ → nach Virus-Scan wird zu verified/ oder deleted
  const objectPath = `tmp/${prefix}/${fileId}/${safeName}`;

  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(objectPath);

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + SIGNED_URL_EXPIRES_MINUTES * 60 * 1000,
      contentType: mime,
      extensionHeaders: {
        // Maximale Dateigröße über Custom Header erzwingen
        'x-goog-meta-max-size': String(maxSize),
        'x-goog-meta-submission-id': submissionId ?? 'standalone',
        'x-goog-meta-uploaded-by-ip': ip,
        'x-goog-meta-uploaded-at': new Date().toISOString(),
      },
    });

    const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRES_MINUTES * 60 * 1000).toISOString();

    console.log(`[upload] presign OK ip=${ip} file=${objectPath} mime=${mime}`);

    res.json({
      uploadUrl,
      objectPath,
      expiresAt,
      maxBytes: maxSize,
      instructions: {
        method: 'PUT',
        headers: {
          'Content-Type': mime,
        },
        note: `Upload muss innerhalb von ${SIGNED_URL_EXPIRES_MINUTES} Minuten abgeschlossen sein.`,
      },
    });
  } catch (err) {
    console.error('[upload] presign error', err);
    res.status(500).json({ error: 'Konnte Upload-URL nicht erstellen' });
  }
}

// -------------------------------------------------------
// POST /upload/confirm
// Wird nach erfolgreichem Upload aufgerufen
// Speichert objectPath in BigQuery community_submissions
// -------------------------------------------------------
export async function handleUploadConfirm(req: Request, res: Response): Promise<void> {
  const { objectPath, submissionId } = req.body as {
    objectPath?: string;
    submissionId?: string;
  };

  if (!objectPath || !objectPath.startsWith('tmp/')) {
    res.status(400).json({ error: 'Ungültiger objectPath' });
    return;
  }

  // Prüfen ob Datei tatsächlich in GCS existiert
  try {
    const [exists] = await storage.bucket(BUCKET_NAME).file(objectPath).exists();
    if (!exists) {
      res.status(404).json({ error: 'Datei nicht in GCS gefunden — Upload fehlgeschlagen?' });
      return;
    }

    const [metadata] = await storage.bucket(BUCKET_NAME).file(objectPath).getMetadata();
    const fileSize = Number(metadata.size ?? 0);
    const mime = metadata.contentType ?? 'unknown';
    const maxSize = MAX_FILE_SIZE_BYTES[mime as AllowedMime] ?? 0;

    if (fileSize > maxSize) {
      // Datei löschen und ablehnen
      await storage.bucket(BUCKET_NAME).file(objectPath).delete();
      res.status(400).json({ error: `Datei überschreitet Limit (${fileSize} > ${maxSize} bytes). Wurde gelöscht.` });
      return;
    }

    // TODO: BigQuery UPDATE eco_community.submissions SET attachments = ARRAY_CONCAT(...)
    // Das wird in der nächsten Iteration mit dem BigQuery-Client verknüpft

    console.log(`[upload] confirmed path=${objectPath} size=${fileSize} mime=${mime} submission=${submissionId}`);

    res.json({
      confirmed: true,
      objectPath,
      publicPath: `gs://${BUCKET_NAME}/${objectPath}`,
      fileSize,
      mime,
      note: 'Datei wartet auf Virus-Scan. Wird nach Prüfung nach verified/ verschoben.',
    });
  } catch (err) {
    console.error('[upload] confirm error', err);
    res.status(500).json({ error: 'Fehler beim Bestätigen des Uploads' });
  }
}

// -------------------------------------------------------
// GET /upload/status/:objectPath
// Admin: Scan-Status einer Datei abfragen
// -------------------------------------------------------
export async function handleUploadStatus(req: Request, res: Response): Promise<void> {
  const rawPath = decodeURIComponent(req.params[0] ?? '');
  if (!rawPath) {
    res.status(400).json({ error: 'objectPath fehlt' });
    return;
  }

  try {
    const [exists] = await storage.bucket(BUCKET_NAME).file(rawPath).exists();
    if (!exists) {
      res.json({ status: 'not_found', objectPath: rawPath });
      return;
    }

    const [metadata] = await storage.bucket(BUCKET_NAME).file(rawPath).getMetadata();
    const scanStatus = (metadata.metadata?.['virus-scan-status'] as string) ?? 'pending';
    const inVerified = rawPath.startsWith('verified/');

    res.json({
      objectPath: rawPath,
      status: inVerified ? 'clean' : scanStatus,
      contentType: metadata.contentType,
      size: metadata.size,
      uploadedAt: metadata.metadata?.['uploaded-at'],
      submissionId: metadata.metadata?.['submission-id'],
    });
  } catch (err) {
    console.error('[upload] status error', err);
    res.status(500).json({ error: 'Fehler beim Abrufen des Status' });
  }
}
