"use strict";
// ============================================================
// EcoAtlas Tile Server – MVT Generator
// GeoJSON Features → Mapbox Vector Tiles (protobuf)
// ============================================================
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emittersToGeoJSON = emittersToGeoJSON;
exports.communityToGeoJSON = communityToGeoJSON;
exports.buildMvtTile = buildMvtTile;
exports.getCacheHeader = getCacheHeader;
exports.shouldIncludeCommunity = shouldIncludeCommunity;
exports.shouldRenderTile = shouldRenderTile;
const geojson_vt_1 = __importDefault(require("geojson-vt"));
const vtpbf = __importStar(require("vt-pbf"));
// ----------------------------------------------------------------
// GeoJSON Feature-Collections bauen
// ----------------------------------------------------------------
function emittersToGeoJSON(features) {
    return {
        type: 'FeatureCollection',
        features: features.map((f) => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [f.lng, f.lat],
            },
            properties: {
                emitter_id: f.emitter_id,
                name: f.name,
                emitter_type: f.emitter_type,
                description: f.description ?? '',
                responsible_entity: f.responsible_entity ?? '',
                active_from: f.active_from ?? '',
                active_to: f.active_to ?? '',
                is_active: f.is_active ? 1 : 0,
                is_locked: f.is_locked ? 1 : 0,
                has_area: f.has_area ? 1 : 0,
                wiki_url: f.wiki_url ?? '',
                source_url: f.source_url ?? '',
                layer_source: 'eco_core',
            },
        })),
    };
}
function communityToGeoJSON(features) {
    return {
        type: 'FeatureCollection',
        features: features.map((f) => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [f.lng, f.lat],
            },
            properties: {
                submission_id: f.submission_id,
                name: f.proposed_name ?? 'Unbekannt',
                emitter_type: f.proposed_type ?? 'other',
                status: f.status,
                upvotes: f.upvotes,
                downvotes: f.downvotes,
                vote_score: f.upvotes - f.downvotes,
                created_at: f.created_at,
                user_display_name: f.user_display_name ?? '',
                layer_source: 'eco_community',
            },
        })),
    };
}
// ----------------------------------------------------------------
// GeoJSON → MVT Buffer
// ----------------------------------------------------------------
const GEOJSONVT_OPTIONS = {
    maxZoom: 18,
    indexMaxZoom: 12,
    indexMaxPoints: 200,
    tolerance: 3,
    extent: 4096,
    buffer: 64,
};
function buildMvtTile(z, x, y, coreFeatures, communityFeatures) {
    const layers = {};
    if (coreFeatures.length > 0) {
        const tile = (0, geojson_vt_1.default)(emittersToGeoJSON(coreFeatures), GEOJSONVT_OPTIONS).getTile(z, x, y);
        if (tile)
            layers['eco_core'] = tile;
    }
    if (communityFeatures.length > 0) {
        const tile = (0, geojson_vt_1.default)(communityToGeoJSON(communityFeatures), GEOJSONVT_OPTIONS).getTile(z, x, y);
        if (tile)
            layers['eco_community'] = tile;
    }
    if (Object.keys(layers).length === 0) {
        return Buffer.alloc(0);
    }
    return Buffer.from(vtpbf.fromGeojsonVt(layers));
}
// ----------------------------------------------------------------
// Cache-Control Header
// ----------------------------------------------------------------
function getCacheHeader(includeCommunity) {
    const ttl = includeCommunity ? 300 : 3600;
    return `public, max-age=${ttl}, s-maxage=${ttl}`;
}
function shouldIncludeCommunity(z) {
    return z >= 7;
}
function shouldRenderTile(z) {
    return z >= 3;
}
