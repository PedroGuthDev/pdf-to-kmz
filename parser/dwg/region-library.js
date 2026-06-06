import { openDB } from "idb";

import { utmToLatLon } from "../geo/utm-calibrator.js";
import { parseDxfText, MAX_SOURCE_DXF_STORE_BYTES } from "./dxf-loader.js";
import { buildAdjacencyGraph, buildPostIndex, restorePostIndexFromDump } from "./region-pairing.js";

export const DB_NAME = "pdf-to-kmz-dwg-library";
export const DB_VERSION = 1;

const PARSER_VERSION = "dxf-parser@1.2.0-primarycable";
const DEFAULT_CRS = { datum: "SIRGAS-2000", zone: 22, hemisphere: "S" };

export const ZONE_22S = {
  minE: 600000,
  maxE: 800000,
  minN: 6700000,
  maxN: 7100000,
};

const BRAZIL = {
  minLat: -33.8,
  maxLat: 5.3,
  minLon: -73.0,
  maxLon: -34.8,
};

export function inZone22S(e, n) {
  return (
    e >= ZONE_22S.minE &&
    e <= ZONE_22S.maxE &&
    n >= ZONE_22S.minN &&
    n <= ZONE_22S.maxN
  );
}

export function inBrazil(p) {
  return (
    p.lat >= BRAZIL.minLat &&
    p.lat <= BRAZIL.maxLat &&
    p.lon >= BRAZIL.minLon &&
    p.lon <= BRAZIL.maxLon
  );
}

function isAbsentOrZeroExtents(extmin, extmax) {
  if (!extmin || !extmax) return true;
  return (
    extmin.x === 0 &&
    extmin.y === 0 &&
    extmax.x === 0 &&
    extmax.y === 0
  );
}

function bboxFromPosts(posts) {
  if (!posts?.length) {
    return { minE: 0, maxE: 0, minN: 0, maxN: 0 };
  }
  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  for (const p of posts) {
    minE = Math.min(minE, p.x);
    maxE = Math.max(maxE, p.x);
    minN = Math.min(minN, p.y);
    maxN = Math.max(maxN, p.y);
  }
  return { minE, maxE, minN, maxN };
}

function scalePosts(posts, scale) {
  if (scale === 1) return posts;
  return posts.map((p) => ({ ...p, x: p.x * scale, y: p.y * scale }));
}

function scaleCableEdges(edges, scale) {
  if (scale === 1) return edges;
  return edges.map((e) => ({
    ...e,
    a: { x: e.a.x * scale, y: e.a.y * scale },
    b: { x: e.b.x * scale, y: e.b.y * scale },
  }));
}

function normalizeBboxLatLon(a, b) {
  return {
    minLat: Math.min(a.lat, b.lat),
    maxLat: Math.max(a.lat, b.lat),
    minLon: Math.min(a.lon, b.lon),
    maxLon: Math.max(a.lon, b.lon),
  };
}

/** @throws when scaled extmin/extmax corners fall outside Brazil (DXF-03). */
export function validateBrazilExtents(scaledExtmin, scaledExtmax, zone) {
  const ll0 = utmToLatLon(scaledExtmin.x, scaledExtmin.y, zone);
  const ll1 = utmToLatLon(scaledExtmax.x, scaledExtmax.y, zone);
  if (!inBrazil(ll0) || !inBrazil(ll1)) {
    throw new Error(
      "DXF coordinates outside Brazil - wrong UTM zone or datum suspected",
    );
  }
  return normalizeBboxLatLon(ll0, ll1);
}

function resolveGeoreference(extmin, extmax, posts, zone) {
  let scale = 1;
  let confidence = "high";
  let scaledExtmin = { x: extmin.x, y: extmin.y };
  let scaledExtmax = { x: extmax.x, y: extmax.y };

  if (isAbsentOrZeroExtents(extmin, extmax)) {
    confidence = "inferred";
    if (posts.length > 0) {
      const bb = bboxFromPosts(posts);
      scaledExtmin = { x: bb.minE, y: bb.minN };
      scaledExtmax = { x: bb.maxE, y: bb.maxN };
    }
    const ll0 = utmToLatLon(scaledExtmin.x, scaledExtmin.y, zone);
    const ll1 = utmToLatLon(scaledExtmax.x, scaledExtmax.y, zone);
    return {
      scale,
      confidence,
      scaledExtmin,
      scaledExtmax,
      bboxLatLon: normalizeBboxLatLon(ll0, ll1),
      skipBrazilCheck: true,
    };
  }

  if (!inZone22S(extmax.x, extmax.y)) {
    if (inZone22S(extmax.x / 1000, extmax.y / 1000)) {
      scale = 1 / 1000;
      confidence = "low";
    } else {
      throw new Error("DXF unit mismatch suspected");
    }
  }

  scaledExtmin = { x: extmin.x * scale, y: extmin.y * scale };
  scaledExtmax = { x: extmax.x * scale, y: extmax.y * scale };
  const bboxLatLon = validateBrazilExtents(scaledExtmin, scaledExtmax, zone);

  return {
    scale,
    confidence,
    scaledExtmin,
    scaledExtmax,
    bboxLatLon,
    skipBrazilCheck: false,
  };
}

export async function runParse(dxfText) {
  if (typeof Worker === "undefined") {
    const parsed = parseDxfText(dxfText);
    const rbushDump = buildPostIndex(parsed.posts).toJSON();
    return { ...parsed, rbushDump };
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./dxf-parse.worker.js", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (e) => {
      worker.terminate();
      const data = e.data;
      if (data?.ok === false) {
        reject(new Error(data.error ?? "DXF parse failed"));
        return;
      }
      if (data?.ok !== true) {
        reject(new Error("DXF parse failed"));
        return;
      }
      resolve({
        posts: data.posts,
        cableEdges: data.cableEdges,
        primaryCableEdges: data.primaryCableEdges,
        rbushDump: data.rbushDump,
        extmin: data.extmin,
        extmax: data.extmax,
      });
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err?.error ?? err);
    };

    worker.postMessage({ type: "PARSE_DXF", dxfText });
  });
}

async function openRegionsDb(idbFactory) {
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

export function createRegionLibrary(idbFactory = null) {
  return {
    async addRegion(name, dxfBlob) {
      if (!name || typeof name !== "string") throw new Error("Region name is required.");
      if (!dxfBlob || typeof dxfBlob.text !== "function") {
        throw new Error("DXF file is required.");
      }

      const dxfText = await dxfBlob.text();
      let { posts, cableEdges, primaryCableEdges, rbushDump, extmin, extmax } =
        await runParse(dxfText);

      const zone = DEFAULT_CRS.zone;
      const geo = resolveGeoreference(extmin, extmax, posts, zone);
      const { scale, confidence, scaledExtmin, scaledExtmax, bboxLatLon } = geo;

      if (scale !== 1) {
        posts = scalePosts(posts, scale);
        cableEdges = scaleCableEdges(cableEdges, scale);
        primaryCableEdges = scaleCableEdges(primaryCableEdges, scale);
        rbushDump = buildPostIndex(posts).toJSON();
      }

      const crs = { ...DEFAULT_CRS, confidence };
      const bboxUtm = {
        minE: scaledExtmin.x,
        maxE: scaledExtmax.x,
        minN: scaledExtmin.y,
        maxN: scaledExtmax.y,
      };

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
        sourceDxf: dxfText.length <= MAX_SOURCE_DXF_STORE_BYTES ? dxfBlob : null,
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
