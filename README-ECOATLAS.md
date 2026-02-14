# EcoAtlas – Erweiterung von Sightline

> Community-getriebenes Umwelt-Monitoring: Verschmutzungsstandorte, Emissionen und Umweltgefahren visualisiert auf einer Weltkarte.

---

## Repo-Struktur

```
gogomann/sightline/
│
├── app/                        # Sightline Original (Next.js Frontend)
│   └── api/search/             # OSM Suchendpunkt
│
├── components/                 # Sightline Original UI-Komponenten
│
├── eco-atlas/                  # EcoAtlas Erweiterung
│   ├── types/
│   │   └── eco-types.ts        # TypeScript Typen (aus BigQuery Schema)
│   ├── layers/
│   │   ├── osm-env-layer.ts    # OSM Overpass Live-Basislayer
│   │   ├── eco-core-layer.ts   # BigQuery verifizierte Daten (TODO)
│   │   └── eco-community-layer.ts  # BigQuery Community-Quarantäne (TODO)
│   └── components/
│       ├── TimelineSlider.tsx  # Jahresschieber 1900–2026 (TODO)
│       ├── EmitterPanel.tsx    # Detail-Panel für Standorte (TODO)
│       └── CommunityVote.tsx   # Up/Down-Vote + Kommentare (TODO)
│
└── gcp/                        # GCP Sub-Projekte
    ├── tile-server/            # Cloud Run – MVT Tile Server (TODO)
    ├── bigquery/               # Schema + Migrations
    │   ├── eco_core.sql
    │   ├── eco_community.sql
    │   └── eco_audit.sql
    └── auth/                   # Google OAuth (TODO)
```

---

## Datenschichten

### Layer 1 – OSM Overpass (Live, kein BigQuery)

Direkt von OpenStreetMap, ständig aktuell, kein eigener Datenpflegeaufwand.

| OSM Tag | EcoAtlas Kategorie |
|---|---|
| `landuse=landfill` | Deponie |
| `man_made=wastewater_plant` | Kläranlage |
| `man_made=chimney` | Industrieschornstein |
| `industrial=refinery` | Raffinerie |
| `power=plant` | Kraftwerk |
| `landuse=quarry` | Bergwerk / Steinbruch |
| `power=nuclear` | Kernkraftwerk |
| `industrial=chemical` | Chemiewerk |
| `man_made=pipeline` | Pipeline |

**Datei:** `eco-atlas/layers/osm-env-layer.ts`  
**Cache:** 5 Minuten client-seitig, BBox-gerundet auf 0.5°  
**Rate Limit:** Respektiert Overpass Fair-Use-Policy (kein Bulk)

---

### Layer 2 – eco_core (BigQuery, verifiziert)

Verifizierten, gesperrte Daten aus dem Team. Jeder Standort hat:

- Geopunkt oder Fläche (`GEOGRAPHY`)
- Zeitraum (`active_from` / `active_to`)
- Verantwortliche Person/Organisation
- Messreihen (`measurements` Tabelle)
- Infrastruktur-Details (Pumpen, Schornsteine, Stromverbrauch)

**Zugriff:** Cloud Run Tile-Server → BigQuery → MVT  
**Cache:** Cloud CDN, 1 Stunde

---

### Layer 3 – eco_community (BigQuery, Quarantäne)

User-eingereichte Daten. Erst nach Verifikation in eco_core übertragen.

- `status`: `pending` → `approved` / `rejected`
- Voting: `votes` Tabelle (up/down pro User)
- Kommentare: `comments` Tabelle
- Gesperrte Einträge (`is_locked=true`) sind nur vom Team änderbar

**Cache:** Cloud CDN, 5 Minuten

---

## GCP Projektstruktur

**Projekt:** `online-add-testen`  
**Region:** `europe-west1`

```
BigQuery Datasets:
├── eco_core        → emitters, measurements, emission_types, infrastructure
├── eco_community   → submissions, votes, comments, users
└── eco_audit       → change_log, access_log

Cloud Run (geplant):
└── tile-server     → /tiles/{z}/{x}/{y}.mvt
                    → /api/emitter/{id}
                    → /api/community/submit

Cloud CDN (geplant):
└── Cache vor Tile-Server
    ├── eco_core Tiles:      TTL 1h
    └── eco_community Tiles: TTL 5min
```

---

## Berechtigungsmodell

| Rolle | Kann | Nicht |
|---|---|---|
| Anonym | Karte ansehen, Layer wechseln | Nichts einreichen |
| User (Google Login) | Community-Daten einreichen, voten, kommentieren | Verifizierte Daten ändern |
| Verifier | Community → Core promoten | Gesperrte Einträge ändern |
| Team | Alles inkl. `is_locked=true` Einträge | — |

---

## Entwicklung

### Voraussetzungen

```bash
Node.js 18+
npm
gcloud CLI (für GCP-Zugriff)
```

### Setup

```bash
npm install
npm run dev
# → http://localhost:3000
```

### OSM Layer testen

```typescript
import { fetchOsmEnvCached } from './eco-atlas/layers/osm-env-layer';

const features = await fetchOsmEnvCached({
  south: 47.2,
  west: 5.9,
  north: 55.1,
  east: 15.0
});
// → Alle Umwelt-Standorte in Deutschland
```

---

## Roadmap

- [x] BigQuery Schema (eco_core, eco_community, eco_audit)
- [x] TypeScript Typen
- [x] OSM Overpass Basislayer
- [ ] Cloud Run Tile-Server
- [ ] MapLibre Integration mit Timeline-Slider
- [ ] Google OAuth Login
- [ ] Community Submit-Formular
- [ ] Voting + Kommentar-System
- [ ] Cloud CDN Caching

---

## Lizenz

MIT – Sightline Original von ni5arga  
EcoAtlas Erweiterung: Open Source
