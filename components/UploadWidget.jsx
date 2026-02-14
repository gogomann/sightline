import { useState, useCallback, useRef } from "react";

const TILE_SERVER = process.env.NEXT_PUBLIC_TILE_SERVER_URL ?? "http://localhost:8080";

const MIME_LABELS = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "application/pdf": "PDF",
  "video/mp4": "MP4",
  "application/geo+json": "GeoJSON",
  "application/vnd.google-earth.kml+xml": "KML",
};

const EXT_MAP = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
  mp4: "video/mp4",
  geojson: "application/geo+json",
  kml: "application/vnd.google-earth.kml+xml",
};

const MAX_MB = {
  "image/jpeg": 20,
  "image/png": 20,
  "application/pdf": 50,
  "video/mp4": 500,
  "application/geo+json": 5,
  "application/vnd.google-earth.kml+xml": 5,
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ mime }) {
  const icons = {
    "image/jpeg": "🖼",
    "image/png": "🖼",
    "application/pdf": "📄",
    "video/mp4": "🎥",
    "application/geo+json": "🗺",
    "application/vnd.google-earth.kml+xml": "🗺",
  };
  return <span style={{ fontSize: 20 }}>{icons[mime] ?? "📎"}</span>;
}

// einzelner Upload-Job
async function uploadFile(file, submissionId, onProgress) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = EXT_MAP[ext];
  if (!contentType) throw new Error(`Dateityp .${ext} nicht erlaubt`);

  const maxBytes = MAX_MB[contentType] * 1024 * 1024;
  if (file.size > maxBytes) throw new Error(`Datei zu groß (max ${MAX_MB[contentType]} MB)`);

  // 1. Presign-URL holen
  onProgress(5, "URL anfordern…");
  const presignRes = await fetch(`${TILE_SERVER}/upload/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType, submissionId }),
  });
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}));
    throw new Error(err.error ?? `Presign fehlgeschlagen (${presignRes.status})`);
  }
  const { uploadUrl, objectPath, maxBytes: serverMax } = await presignRes.json();

  // 2. Direkt zu GCS hochladen (XHR für Fortschritt)
  onProgress(10, "Hochladen…");
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = 10 + Math.round((e.loaded / e.total) * 80);
        onProgress(pct, `${Math.round((e.loaded / e.total) * 100)}%`);
      }
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`GCS Upload ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Netzwerkfehler beim Upload"));
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.send(file);
  });

  // 3. Bestätigen
  onProgress(95, "Bestätigen…");
  const confirmRes = await fetch(`${TILE_SERVER}/upload/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectPath, submissionId }),
  });
  if (!confirmRes.ok) {
    const err = await confirmRes.json().catch(() => ({}));
    throw new Error(err.error ?? "Bestätigung fehlgeschlagen");
  }
  const confirmed = await confirmRes.json();
  onProgress(100, "Fertig");
  return { objectPath, confirmed };
}

// ─────────────────────────────────────────────
// Haupt-Komponente
// ─────────────────────────────────────────────
export default function UploadWidget({ submissionId = null, onUploadsChange }) {
  const [files, setFiles] = useState([]); // { id, file, status, progress, label, objectPath, error }
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const addFiles = useCallback((incoming) => {
    const newEntries = Array.from(incoming).map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      status: "pending", // pending | uploading | done | error
      progress: 0,
      label: "Warten…",
      objectPath: null,
      error: null,
    }));
    setFiles((prev) => [...prev, ...newEntries]);
    // sofort starten
    newEntries.forEach((entry) => startUpload(entry));
  }, [submissionId]);

  const startUpload = (entry) => {
    setFiles((prev) =>
      prev.map((f) => f.id === entry.id ? { ...f, status: "uploading" } : f)
    );

    uploadFile(
      entry.file,
      submissionId,
      (progress, label) => {
        setFiles((prev) =>
          prev.map((f) => f.id === entry.id ? { ...f, progress, label } : f)
        );
      }
    )
      .then(({ objectPath }) => {
        setFiles((prev) => {
          const updated = prev.map((f) =>
            f.id === entry.id
              ? { ...f, status: "done", progress: 100, label: "Fertig", objectPath }
              : f
          );
          onUploadsChange?.(updated.filter((f) => f.status === "done").map((f) => f.objectPath));
          return updated;
        });
      })
      .catch((err) => {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === entry.id
              ? { ...f, status: "error", label: "Fehler", error: err.message }
              : f
          )
        );
      });
  };

  const remove = (id) => {
    setFiles((prev) => {
      const updated = prev.filter((f) => f.id !== id);
      onUploadsChange?.(updated.filter((f) => f.status === "done").map((f) => f.objectPath));
      return updated;
    });
  };

  const retry = (entry) => {
    setFiles((prev) =>
      prev.map((f) => f.id === entry.id ? { ...f, status: "pending", progress: 0, label: "Warten…", error: null } : f)
    );
    startUpload({ ...entry, status: "pending" });
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  return (
    <div style={styles.wrapper}>
      {/* Drop-Zone */}
      <div
        style={{ ...styles.dropzone, ...(dragging ? styles.dropzoneDragging : {}) }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.pdf,.mp4,.geojson,.kml"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.length && addFiles(e.target.files)}
        />
        <span style={styles.dropIcon}>⬆</span>
        <span style={styles.dropText}>
          {dragging ? "Loslassen zum Hochladen" : "Dateien hier ablegen oder klicken"}
        </span>
        <span style={styles.dropHint}>
          JPG · PNG · PDF · MP4 · GeoJSON · KML &nbsp;·&nbsp; Anonym erlaubt
        </span>
      </div>

      {/* Dateiliste */}
      {files.length > 0 && (
        <ul style={styles.list}>
          {files.map((entry) => {
            const mime = EXT_MAP[entry.file.name.split(".").pop()?.toLowerCase()] ?? "";
            return (
              <li key={entry.id} style={styles.item}>
                <div style={styles.itemLeft}>
                  <FileIcon mime={mime} />
                  <div style={styles.itemMeta}>
                    <span style={styles.fileName}>{entry.file.name}</span>
                    <span style={styles.fileSub}>
                      {formatBytes(entry.file.size)} · {MIME_LABELS[mime] ?? ""}
                    </span>
                  </div>
                </div>

                <div style={styles.itemRight}>
                  {entry.status === "uploading" && (
                    <div style={styles.progressWrap}>
                      <div style={{ ...styles.progressBar, width: `${entry.progress}%` }} />
                      <span style={styles.progressLabel}>{entry.label}</span>
                    </div>
                  )}
                  {entry.status === "done" && (
                    <span style={styles.badgeDone}>✓ Hochgeladen</span>
                  )}
                  {entry.status === "error" && (
                    <div style={styles.errorRow}>
                      <span style={styles.badgeError} title={entry.error}>✗ Fehler</span>
                      <button style={styles.retryBtn} onClick={() => retry(entry)}>↺</button>
                    </div>
                  )}
                  {entry.status === "pending" && (
                    <span style={styles.badgePending}>…</span>
                  )}
                  <button
                    style={styles.removeBtn}
                    onClick={() => remove(entry.id)}
                    title="Entfernen"
                  >✕</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Hinweis */}
      <p style={styles.hint}>
        Dateien werden nach dem Upload auf Viren geprüft und dann unter "Anhänge" der Meldung sichtbar.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────
// Styles (inline, kein Tailwind nötig)
// ─────────────────────────────────────────────
const styles = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  dropzone: {
    border: "1.5px dashed #3a5a3a",
    borderRadius: 6,
    background: "#0d1a0d",
    padding: "24px 16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    transition: "border-color 0.15s, background 0.15s",
  },
  dropzoneDragging: {
    borderColor: "#4caf50",
    background: "#0f2b0f",
  },
  dropIcon: {
    fontSize: 28,
    color: "#4caf50",
    lineHeight: 1,
  },
  dropText: {
    color: "#c8e6c9",
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "0.02em",
  },
  dropHint: {
    color: "#558b55",
    fontSize: 11,
    letterSpacing: "0.04em",
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  item: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#111d11",
    border: "1px solid #1e3a1e",
    borderRadius: 5,
    padding: "8px 10px",
    gap: 10,
  },
  itemLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    flex: 1,
  },
  itemMeta: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  fileName: {
    color: "#e8f5e9",
    fontSize: 12,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 220,
  },
  fileSub: {
    color: "#558b55",
    fontSize: 10,
    marginTop: 2,
  },
  itemRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  progressWrap: {
    position: "relative",
    width: 100,
    height: 16,
    background: "#1e3a1e",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBar: {
    position: "absolute",
    top: 0,
    left: 0,
    height: "100%",
    background: "#4caf50",
    transition: "width 0.2s",
  },
  progressLabel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 9,
    color: "#e8f5e9",
    fontWeight: 700,
    letterSpacing: "0.05em",
  },
  badgeDone: {
    color: "#81c784",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
  },
  badgeError: {
    color: "#ef9a9a",
    fontSize: 11,
    fontWeight: 700,
    cursor: "help",
  },
  badgePending: {
    color: "#558b55",
    fontSize: 11,
  },
  errorRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  retryBtn: {
    background: "none",
    border: "1px solid #3a5a3a",
    borderRadius: 3,
    color: "#81c784",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
    padding: "2px 6px",
  },
  removeBtn: {
    background: "none",
    border: "none",
    color: "#3a5a3a",
    cursor: "pointer",
    fontSize: 12,
    padding: "2px 4px",
    lineHeight: 1,
    transition: "color 0.15s",
  },
  hint: {
    color: "#3a5a3a",
    fontSize: 10,
    margin: 0,
    letterSpacing: "0.03em",
    lineHeight: 1.5,
  },
};