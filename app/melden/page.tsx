"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import UploadWidget from "@/components/UploadWidget";

// ─── Typen ───────────────────────────────────────────────────────
type Step = "ort" | "was" | "belege" | "absenden";

interface FormState {
  // Ort
  lat: number | null;
  lng: number | null;
  ortLabel: string;
  radius: number; // meter
  // Was
  name: string;
  typ: string;
  beschreibung: string;
  vonDatum: string;
  bisDatum: string;
  quelle: string;
  verantwortlicher: string;
  // Messungen
  emissionTyp: string;
  emissionWert: string;
  emissionEinheit: string;
  // Belege
  attachments: string[];
}

const EMISSION_TYPEN = [
  "CO₂", "CH₄", "NOₓ", "SO₂", "PM2.5", "PM10",
  "Abwasser", "Schwermetalle", "PFAS", "Lärm", "Sonstiges",
];

const STANDORT_TYPEN = [
  "Deponie", "Industrieanlage", "Kraftwerk", "Kläranlage",
  "Bergbau", "Landwirtschaft", "Verkehr", "Illegale Entsorgung", "Sonstiges",
];

const EINHEITEN = ["t/Jahr", "kg/h", "mg/m³", "μg/m³", "dB", "m³/Tag", "Bq/m³"];

const STEPS: { id: Step; label: string; icon: string }[] = [
  { id: "ort",      label: "Standort",  icon: "◎" },
  { id: "was",      label: "Angaben",   icon: "≡" },
  { id: "belege",   label: "Belege",    icon: "⬆" },
  { id: "absenden", label: "Absenden",  icon: "→" },
];

// ─── Koordinaten-Suche (Nominatim) ───────────────────────────────
async function searchLocation(query: string) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=de,at,ch`,
    { headers: { "Accept-Language": "de" } }
  );
  return res.json();
}

// ─── Haupt-Komponente ─────────────────────────────────────────────
export default function MeldenPage() {
  const [step, setStep] = useState<Step>("ort");
  const [form, setForm] = useState<FormState>({
    lat: null, lng: null, ortLabel: "", radius: 100,
    name: "", typ: "", beschreibung: "", vonDatum: "", bisDatum: "",
    quelle: "", verantwortlicher: "",
    emissionTyp: "", emissionWert: "", emissionEinheit: "t/Jahr",
    attachments: [],
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionId] = useState(() => `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  const set = (key: keyof FormState, val: any) =>
    setForm((f) => ({ ...f, [key]: val }));

  // MapLibre laden sobald Schritt "ort" aktiv
  useEffect(() => {
    if (step !== "ort" || !mapRef.current || mapInstanceRef.current) return;

    import("maplibre-gl").then(({ default: maplibregl }) => {
      const map = new maplibregl.Map({
        container: mapRef.current!,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
            },
          },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
        center: [10.45, 51.16],
        zoom: 5,
      });

      map.on("click", (e) => {
        const { lng, lat } = e.lngLat;
        set("lat", parseFloat(lat.toFixed(6)));
        set("lng", parseFloat(lng.toFixed(6)));
        set("ortLabel", `${lat.toFixed(5)}, ${lng.toFixed(5)}`);

        if (markerRef.current) markerRef.current.remove();
        const el = document.createElement("div");
        el.style.cssText = `
          width:18px;height:18px;border-radius:50%;
          background:#4caf50;border:2px solid #e8f5e9;
          box-shadow:0 0 0 4px rgba(76,175,80,0.25);
        `;
        markerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);
      });

      mapInstanceRef.current = map;
    });

    return () => {
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, [step]);

  // Ortssuche
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await searchLocation(searchQuery);
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const selectResult = (r: any) => {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    set("lat", lat);
    set("lng", lng);
    set("ortLabel", r.display_name);
    setSearchResults([]);
    setSearchQuery(r.display_name.split(",")[0]);
    mapInstanceRef.current?.flyTo({ center: [lng, lat], zoom: 13 });
    if (markerRef.current) markerRef.current.remove();
    import("maplibre-gl").then(({ default: maplibregl }) => {
      const el = document.createElement("div");
      el.style.cssText = `
        width:18px;height:18px;border-radius:50%;
        background:#4caf50;border:2px solid #e8f5e9;
        box-shadow:0 0 0 4px rgba(76,175,80,0.25);
      `;
      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(mapInstanceRef.current);
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload = {
        submission_id: submissionId,
        submission_type: "new_emitter",
        proposed_name: form.name,
        proposed_type: form.typ,
        proposed_description: form.beschreibung,
        proposed_geo_point: form.lat && form.lng
          ? { lat: form.lat, lng: form.lng }
          : null,
        proposed_emission_type: form.emissionTyp,
        proposed_value: form.emissionWert ? parseFloat(form.emissionWert) : null,
        proposed_unit: form.emissionEinheit,
        proposed_active_from: form.vonDatum || null,
        proposed_active_to: form.bisDatum || null,
        proposed_source_url: form.quelle || null,
        proposed_responsible: form.verantwortlicher || null,
        attachments: form.attachments,
        user_id: "anonymous",
        status: "pending",
      };

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_TILE_SERVER_URL ?? "http://localhost:8080"}/api/community/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) throw new Error(`Fehler ${res.status}`);
      setSubmitted(true);
    } catch (err) {
      console.error(err);
      alert("Fehler beim Absenden. Bitte erneut versuchen.");
    } finally {
      setSubmitting(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const canNext = () => {
    if (step === "ort") return form.lat !== null && form.lng !== null;
    if (step === "was") return form.name.trim().length > 0 && form.typ.length > 0;
    return true;
  };

  // ─── Erfolgsseite ─────────────────────────────────────────────
  if (submitted) {
    return (
      <div style={s.page}>
        <div style={s.successBox}>
          <div style={s.successIcon}>✓</div>
          <h2 style={s.successTitle}>Meldung eingegangen</h2>
          <p style={s.successText}>
            Deine Meldung wurde als Quarantäne-Eintrag gespeichert und ist sofort
            auf der Karte sichtbar. Community-Votes und Moderator-Prüfung entscheiden
            über die Übernahme in den verifizierten Datensatz.
          </p>
          <div style={s.successId}>ID: {submissionId}</div>
          <a href="/" style={s.successLink}>← Zurück zur Karte</a>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      {/* Header */}
      <header style={s.header}>
        <a href="/" style={s.backLink}>← Karte</a>
        <span style={s.headerTitle}>Umweltproblem melden</span>
        <span style={s.anonBadge}>anonym möglich</span>
      </header>

      {/* Stepper */}
      <nav style={s.stepper}>
        {STEPS.map((st, i) => (
          <div
            key={st.id}
            style={{
              ...s.stepItem,
              ...(st.id === step ? s.stepActive : {}),
              ...(i < stepIndex ? s.stepDone : {}),
              cursor: i < stepIndex ? "pointer" : "default",
            }}
            onClick={() => i < stepIndex && setStep(st.id)}
          >
            <span style={s.stepIcon}>{i < stepIndex ? "✓" : st.icon}</span>
            <span style={s.stepLabel}>{st.label}</span>
          </div>
        ))}
      </nav>

      {/* Inhalt */}
      <main style={s.main}>

        {/* ── Schritt 1: Standort ── */}
        {step === "ort" && (
          <div style={s.card}>
            <h3 style={s.cardTitle}>Wo befindet sich der Standort?</h3>

            {/* Suche */}
            <div style={s.searchRow}>
              <input
                style={s.input}
                placeholder="Ort, Adresse oder Name suchen…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <button style={s.searchBtn} onClick={handleSearch} disabled={searching}>
                {searching ? "…" : "Suchen"}
              </button>
            </div>

            {searchResults.length > 0 && (
              <ul style={s.searchResults}>
                {searchResults.map((r, i) => (
                  <li key={i} style={s.searchResult} onClick={() => selectResult(r)}>
                    <span style={s.resultName}>{r.display_name.split(",")[0]}</span>
                    <span style={s.resultSub}>{r.display_name.split(",").slice(1, 3).join(",")}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Karte */}
            <div style={s.mapWrap}>
              <div ref={mapRef} style={s.map} />
              {!form.lat && (
                <div style={s.mapHint}>Auf der Karte klicken oder oben suchen</div>
              )}
            </div>

            {form.lat && (
              <div style={s.coordRow}>
                <span style={s.coordLabel}>Koordinaten</span>
                <span style={s.coordVal}>{form.lat}, {form.lng}</span>
                <button style={s.clearBtn} onClick={() => { set("lat", null); set("lng", null); }}>
                  ✕
                </button>
              </div>
            )}

            <div style={s.fieldRow}>
              <label style={s.label}>Genauigkeit / Radius</label>
              <select style={s.select} value={form.radius} onChange={(e) => set("radius", Number(e.target.value))}>
                <option value={10}>Punkt (~10 m)</option>
                <option value={100}>Nahbereich (~100 m)</option>
                <option value={500}>Gebiet (~500 m)</option>
                <option value={2000}>Großgebiet (~2 km)</option>
              </select>
            </div>
          </div>
        )}

        {/* ── Schritt 2: Angaben ── */}
        {step === "was" && (
          <div style={s.card}>
            <h3 style={s.cardTitle}>Was wird gemeldet?</h3>

            <div style={s.fieldRow}>
              <label style={s.label}>Name / Bezeichnung *</label>
              <input
                style={s.input}
                placeholder="z.B. Deponie Nordring, Werk Bitterfeld-Nord"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>

            <div style={s.fieldRow}>
              <label style={s.label}>Typ *</label>
              <select style={s.select} value={form.typ} onChange={(e) => set("typ", e.target.value)}>
                <option value="">— bitte wählen —</option>
                {STANDORT_TYPEN.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>

            <div style={s.fieldRow}>
              <label style={s.label}>Beschreibung</label>
              <textarea
                style={s.textarea}
                rows={3}
                placeholder="Was wurde beobachtet? Geruch, Farbe, Häufigkeit…"
                value={form.beschreibung}
                onChange={(e) => set("beschreibung", e.target.value)}
              />
            </div>

            <div style={s.twoCol}>
              <div style={s.fieldRow}>
                <label style={s.label}>Aktiv seit</label>
                <input style={s.input} type="date" value={form.vonDatum} onChange={(e) => set("vonDatum", e.target.value)} />
              </div>
              <div style={s.fieldRow}>
                <label style={s.label}>Aktiv bis</label>
                <input style={s.input} type="date" value={form.bisDatum} onChange={(e) => set("bisDatum", e.target.value)} />
              </div>
            </div>

            <div style={s.fieldRow}>
              <label style={s.label}>Verantwortlicher / Betreiber</label>
              <input
                style={s.input}
                placeholder="Firmenname, Behörde…"
                value={form.verantwortlicher}
                onChange={(e) => set("verantwortlicher", e.target.value)}
              />
            </div>

            <div style={s.fieldRow}>
              <label style={s.label}>Quelle / Link</label>
              <input
                style={s.input}
                placeholder="https://… oder Wikipedia-Seite"
                value={form.quelle}
                onChange={(e) => set("quelle", e.target.value)}
              />
            </div>

            <div style={{ ...s.fieldRow, borderTop: "1px solid #1e3a1e", paddingTop: 16, marginTop: 8 }}>
              <label style={s.label}>Emission / Messwert (optional)</label>
              <div style={s.twoCol}>
                <select style={s.select} value={form.emissionTyp} onChange={(e) => set("emissionTyp", e.target.value)}>
                  <option value="">— Typ —</option>
                  {EMISSION_TYPEN.map((t) => <option key={t}>{t}</option>)}
                </select>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    style={{ ...s.input, width: "60%" }}
                    placeholder="Wert"
                    type="number"
                    value={form.emissionWert}
                    onChange={(e) => set("emissionWert", e.target.value)}
                  />
                  <select style={{ ...s.select, width: "40%" }} value={form.emissionEinheit} onChange={(e) => set("emissionEinheit", e.target.value)}>
                    {EINHEITEN.map((e) => <option key={e}>{e}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Schritt 3: Belege ── */}
        {step === "belege" && (
          <div style={s.card}>
            <h3 style={s.cardTitle}>Belege hochladen</h3>
            <p style={s.cardHint}>
              Fotos, PDFs, Videos oder Geodaten stärken die Glaubwürdigkeit
              deiner Meldung. Alle Dateien werden auf Viren geprüft.
            </p>
            <UploadWidget
              submissionId={submissionId}
              onUploadsChange={(paths: string[]) => set("attachments", paths)}
            />
          </div>
        )}

        {/* ── Schritt 4: Zusammenfassung ── */}
        {step === "absenden" && (
          <div style={s.card}>
            <h3 style={s.cardTitle}>Zusammenfassung</h3>

            <div style={s.summaryGrid}>
              <div style={s.summaryRow}>
                <span style={s.summaryKey}>Standort</span>
                <span style={s.summaryVal}>{form.ortLabel || `${form.lat}, ${form.lng}`}</span>
              </div>
              <div style={s.summaryRow}>
                <span style={s.summaryKey}>Name</span>
                <span style={s.summaryVal}>{form.name}</span>
              </div>
              <div style={s.summaryRow}>
                <span style={s.summaryKey}>Typ</span>
                <span style={s.summaryVal}>{form.typ}</span>
              </div>
              {form.beschreibung && (
                <div style={s.summaryRow}>
                  <span style={s.summaryKey}>Beschreibung</span>
                  <span style={s.summaryVal}>{form.beschreibung}</span>
                </div>
              )}
              {form.vonDatum && (
                <div style={s.summaryRow}>
                  <span style={s.summaryKey}>Zeitraum</span>
                  <span style={s.summaryVal}>{form.vonDatum}{form.bisDatum ? ` — ${form.bisDatum}` : " — heute"}</span>
                </div>
              )}
              {form.emissionTyp && (
                <div style={s.summaryRow}>
                  <span style={s.summaryKey}>Emission</span>
                  <span style={s.summaryVal}>{form.emissionTyp} {form.emissionWert} {form.emissionEinheit}</span>
                </div>
              )}
              {form.verantwortlicher && (
                <div style={s.summaryRow}>
                  <span style={s.summaryKey}>Betreiber</span>
                  <span style={s.summaryVal}>{form.verantwortlicher}</span>
                </div>
              )}
              {form.quelle && (
                <div style={s.summaryRow}>
                  <span style={s.summaryKey}>Quelle</span>
                  <span style={s.summaryVal}>{form.quelle}</span>
                </div>
              )}
              <div style={s.summaryRow}>
                <span style={s.summaryKey}>Anhänge</span>
                <span style={s.summaryVal}>{form.attachments.length} Datei(en)</span>
              </div>
            </div>

            <div style={s.quarantineNote}>
              <span style={s.quarantineIcon}>⚠</span>
              <span>
                Diese Meldung erscheint zunächst als <strong>Quarantäne-Eintrag</strong> mit
                orangenem Badge auf der Karte. Nach Community-Votes und Moderator-Prüfung
                wird sie in den verifizierten Datensatz übernommen.
              </span>
            </div>

            <button
              style={{ ...s.nextBtn, background: submitting ? "#2a4a2a" : "#4caf50", width: "100%", marginTop: 16 }}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Wird gesendet…" : "Meldung abschicken →"}
            </button>
          </div>
        )}

        {/* Navigation */}
        {step !== "absenden" && (
          <div style={s.navRow}>
            {stepIndex > 0 && (
              <button style={s.backBtn} onClick={() => setStep(STEPS[stepIndex - 1].id)}>
                ← Zurück
              </button>
            )}
            <button
              style={{ ...s.nextBtn, opacity: canNext() ? 1 : 0.4 }}
              disabled={!canNext()}
              onClick={() => setStep(STEPS[stepIndex + 1].id)}
            >
              Weiter →
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#080f08",
    color: "#c8e6c9",
    fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  header: {
    width: "100%",
    maxWidth: 720,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: "1px solid #1e3a1e",
  },
  backLink: {
    color: "#558b55",
    textDecoration: "none",
    fontSize: 12,
    letterSpacing: "0.05em",
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "#81c784",
    textTransform: "uppercase",
  },
  anonBadge: {
    fontSize: 10,
    color: "#4caf50",
    border: "1px solid #2a5a2a",
    borderRadius: 3,
    padding: "2px 7px",
    letterSpacing: "0.05em",
  },
  stepper: {
    width: "100%",
    maxWidth: 720,
    display: "flex",
    padding: "12px 20px",
    gap: 4,
    borderBottom: "1px solid #1e3a1e",
  },
  stepItem: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    padding: "8px 4px",
    borderRadius: 4,
    opacity: 0.35,
    transition: "opacity 0.2s",
  },
  stepActive: {
    opacity: 1,
    background: "#0d1a0d",
  },
  stepDone: {
    opacity: 0.7,
  },
  stepIcon: {
    fontSize: 16,
    color: "#4caf50",
    lineHeight: 1,
  },
  stepLabel: {
    fontSize: 9,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#81c784",
  },
  main: {
    width: "100%",
    maxWidth: 720,
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  card: {
    background: "#0a150a",
    border: "1px solid #1e3a1e",
    borderRadius: 8,
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "#e8f5e9",
    margin: 0,
    textTransform: "uppercase",
  },
  cardHint: {
    fontSize: 11,
    color: "#558b55",
    margin: 0,
    lineHeight: 1.6,
  },
  searchRow: {
    display: "flex",
    gap: 8,
  },
  input: {
    flex: 1,
    background: "#0d1a0d",
    border: "1px solid #2a4a2a",
    borderRadius: 4,
    color: "#c8e6c9",
    fontFamily: "inherit",
    fontSize: 12,
    padding: "8px 10px",
    outline: "none",
  },
  searchBtn: {
    background: "#1a3a1a",
    border: "1px solid #3a6a3a",
    borderRadius: 4,
    color: "#81c784",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    padding: "8px 16px",
    whiteSpace: "nowrap" as const,
  },
  searchResults: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    background: "#0d1a0d",
    border: "1px solid #1e3a1e",
    borderRadius: 4,
    overflow: "hidden",
  },
  searchResult: {
    padding: "8px 12px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    borderBottom: "1px solid #1a2e1a",
  },
  resultName: { fontSize: 12, color: "#c8e6c9", fontWeight: 600 },
  resultSub: { fontSize: 10, color: "#558b55" },
  mapWrap: {
    position: "relative" as const,
    borderRadius: 6,
    overflow: "hidden",
    border: "1px solid #1e3a1e",
  },
  map: { width: "100%", height: 280 },
  mapHint: {
    position: "absolute" as const,
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    color: "#558b55",
    pointerEvents: "none" as const,
    background: "rgba(8,15,8,0.5)",
  },
  coordRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#0d1a0d",
    border: "1px solid #1e3a1e",
    borderRadius: 4,
    padding: "6px 10px",
  },
  coordLabel: { fontSize: 10, color: "#558b55", letterSpacing: "0.05em" },
  coordVal: { fontSize: 12, color: "#81c784", flex: 1 },
  clearBtn: {
    background: "none",
    border: "none",
    color: "#3a5a3a",
    cursor: "pointer",
    fontSize: 12,
    padding: "0 4px",
  },
  fieldRow: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  label: {
    fontSize: 10,
    color: "#558b55",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
  },
  select: {
    background: "#0d1a0d",
    border: "1px solid #2a4a2a",
    borderRadius: 4,
    color: "#c8e6c9",
    fontFamily: "inherit",
    fontSize: 12,
    padding: "8px 10px",
  },
  textarea: {
    background: "#0d1a0d",
    border: "1px solid #2a4a2a",
    borderRadius: 4,
    color: "#c8e6c9",
    fontFamily: "inherit",
    fontSize: 12,
    padding: "8px 10px",
    resize: "vertical" as const,
    outline: "none",
  },
  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  summaryGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  summaryRow: {
    display: "flex",
    gap: 12,
    borderBottom: "1px solid #0f200f",
    paddingBottom: 8,
  },
  summaryKey: {
    fontSize: 10,
    color: "#558b55",
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    minWidth: 100,
    paddingTop: 2,
  },
  summaryVal: {
    fontSize: 12,
    color: "#c8e6c9",
    flex: 1,
    wordBreak: "break-word" as const,
  },
  quarantineNote: {
    display: "flex",
    gap: 10,
    background: "#1a1200",
    border: "1px solid #3a3000",
    borderRadius: 5,
    padding: "12px 14px",
    fontSize: 11,
    color: "#c8b560",
    lineHeight: 1.6,
    alignItems: "flex-start",
  },
  quarantineIcon: { fontSize: 16, flexShrink: 0, marginTop: 1 },
  navRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
  },
  backBtn: {
    background: "none",
    border: "1px solid #2a4a2a",
    borderRadius: 4,
    color: "#558b55",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    padding: "10px 20px",
    letterSpacing: "0.05em",
  },
  nextBtn: {
    background: "#4caf50",
    border: "none",
    borderRadius: 4,
    color: "#080f08",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 700,
    padding: "10px 24px",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    transition: "background 0.15s",
  },
  successBox: {
    maxWidth: 480,
    margin: "80px auto",
    textAlign: "center" as const,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 16,
    padding: 32,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "#1a3a1a",
    border: "2px solid #4caf50",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    color: "#4caf50",
  },
  successTitle: { fontSize: 18, color: "#e8f5e9", margin: 0, fontWeight: 700 },
  successText: { fontSize: 12, color: "#81c784", lineHeight: 1.7, margin: 0 },
  successId: { fontSize: 10, color: "#3a5a3a", letterSpacing: "0.05em" },
  successLink: {
    fontSize: 12,
    color: "#4caf50",
    textDecoration: "none",
    border: "1px solid #2a5a2a",
    borderRadius: 4,
    padding: "8px 20px",
    marginTop: 8,
  },
};