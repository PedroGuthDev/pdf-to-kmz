import { openDB } from "idb";

import { parseDxfText } from "./dxf-loader.js";
import { buildAdjacencyGraph, buildPostIndex, restorePostIndexFromDump } from "./region-pairing.js";
import { utmToLatLon } from "../geo/utm-calibrator.js";

export const DB_NAME = "pdf-to-kmz-dwg-library";
export const DB_VERSION = 1;

const PARSER_VERSION = "dxf-parser@1.2.0-primarycable";
const DEFAULT_CRS = { datum: "SIRGAS-2000", zone: 22, hemisphere: "S" };

async function openRegionsDb(idbFactory) {
  // `idb` doesn't have a stable, documented "inject factory" signature across versions.
  // For Node tests/harness we accept an `idbFactory` (fake-indexeddb's IDBFactory) and
  // temporarily set it as globalThis.indexedDB so `openDB` uses it.
  const prev = globalThis.indexedDB;
  if (idbFactory) globalThis.indexedDB = idbFactory;
  try {
    return await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("regions")) {
          db.createObjectStore("regions", { keyPath: "id" });
        }
      },
    });
  } finally {
    if (idbFactory) globalThis.indexedDB = prev;
  }
}

function bboxArea(b) {
  if (!b) return Infinity;
  const dLat = Math.max(0, (b.maxLat ?? 0) - (b.minLat ?? 0));
  const dLon = Math.max(0, (b.maxLon ?? 0) - (b.minLon ?? 0));
  return dLat * dLon;
}

function normalizeBboxLatLon(a, b) {
  return {
    minLat: Math.min(a.lat, b.lat),
    maxLat: Math.max(a.lat, b.lat),
    minLon: Math.min(a.lon, b.lon),
    maxLon: Math.max(a.lon, b.lon),
  };
}

export function createRegionLibrary(idbFactory = null) {
  return {
    async addRegion(name, dxfBlob) {
      if (!name || typeof name !== "string") throw new Error("Region name is required.");
      if (!dxfBlob || typeof dxfBlob.text !== "function") {
        throw new Error("DXF file is required.");
      }

      const dxfText = await dxfBlob.text();
      const { posts, cableEdges, primaryCableEdges, extmin, extmax } =
        parseDxfText(dxfText);

      const crs = { ...DEFAULT_CRS };
      const bboxUtm = { minE: extmin.x, maxE: extmax.x, minN: extmin.y, maxN: extmax.y };

      const ll0 = utmToLatLon(extmin.x, extmin.y, crs.zone);
      const ll1 = utmToLatLon(extmax.x, extmax.y, crs.zone);
      const bboxLatLon = normalizeBboxLatLon(ll0, ll1);

      const postIndex = buildPostIndex(posts);
      const rbushDump = postIndex.toJSON();

      const record = {
        id: name,
        name,
        uploadedAt: Date.now(),
        crs,
        bboxUtm,
        bboxLatLon,
        posts,
        cableEdges,
        primaryCableEdges,
        rbushDump,
        sourceDxf: dxfBlob,
        parserVersion: PARSER_VERSION,
      };

      const db = await openRegionsDb(idbFactory);
      await db.put("regions", record);
      db.close?.();
      return record;
    },

    async listRegions() {
      const db = await openRegionsDb(idbFactory);
      const all = await db.getAll("regions");
      db.close?.();
      return (all ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        uploadedAt: r.uploadedAt,
        bboxLatLon: r.bboxLatLon,
        crs: r.crs,
      }));
    },

    async lookupByGps(lat, lon) {
      const db = await openRegionsDb(idbFactory);
      const all = await db.getAll("regions");
      db.close?.();

      const hits = (all ?? []).filter((r) => {
        const b = r?.bboxLatLon;
        if (!b) return false;
        return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
      });

      if (!hits.length) return null;
      hits.sort((r1, r2) => bboxArea(r1.bboxLatLon) - bboxArea(r2.bboxLatLon));
      return hits[0];
    },

    async getRegionWithIndex(id) {
      const db = await openRegionsDb(idbFactory);
      const region = await db.get("regions", id);
      db.close?.();
      if (!region) return null;

      const postIndex = restorePostIndexFromDump(region.rbushDump);
      // Defer full-city adjacency (O(edges) RBush queries) — coordinate-calculator-dwg
      // crops to the route bbox and rebuilds on the small subset.
      const LARGE_REGION_POSTS = 8000;
      const adjacencyGraph =
        (region.posts?.length ?? 0) <= LARGE_REGION_POSTS
          ? buildAdjacencyGraph(region.posts, region.cableEdges, { postIndex })
          : null;
      return { ...region, postIndex, adjacencyGraph };
    },

    async importRegionFromManifest(manifest, sourceDxf = null) {
      if (!manifest?.id) throw new Error("Manifest id is required.");
      const postIndex = restorePostIndexFromDump(manifest.rbushDump);
      const record = {
        id: manifest.id,
        name: manifest.name ?? manifest.id,
        uploadedAt: manifest.uploadedAt ?? Date.now(),
        crs: manifest.crs ?? { ...DEFAULT_CRS },
        bboxUtm: manifest.bboxUtm ?? null,
        bboxLatLon: manifest.bboxLatLon ?? null,
        posts: manifest.posts ?? [],
        cableEdges: manifest.cableEdges ?? [],
        primaryCableEdges: manifest.primaryCableEdges ?? [],
        rbushDump: manifest.rbushDump ?? postIndex.toJSON(),
        sourceDxf: sourceDxf,
        parserVersion: manifest.parserVersion ?? PARSER_VERSION,
      };

      const db = await openRegionsDb(idbFactory);
      await db.put("regions", record);
      db.close?.();
      return record;
    },

    async deleteRegion(name) {
      const db = await openRegionsDb(idbFactory);
      await db.delete("regions", name);
      db.close?.();
    },
  };
}

