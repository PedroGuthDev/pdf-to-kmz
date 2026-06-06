import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";

import { createRegionLibrary } from "../dwg/region-library.js";
import { createHybridRegionLibrary } from "../dwg/region-library-hybrid.js";
import { noRegionError } from "../dwg/coordinate-calculator-dwg.js";
import { buildPostIndex } from "../dwg/region-pairing.js";

const FLORIANOPOLIS_BBOX = {
  minLat: -27.3,
  maxLat: -27.1,
  minLon: -48.7,
  maxLon: -48.5,
};

const SEED_POSTS = [
  { x: 700000, y: 6900000, block: "pod_con_dtt" },
  { x: 700050, y: 6900050, block: "pod_con_dtt" },
];

function seedManifest(id = "floripa-seed") {
  const rbushDump = buildPostIndex(SEED_POSTS).toJSON();
  return {
    id,
    name: "Florianópolis test",
    crs: { datum: "SIRGAS-2000", zone: 22, hemisphere: "S", confidence: "high" },
    bboxLatLon: FLORIANOPOLIS_BBOX,
    bboxUtm: { minE: 699900, maxE: 700200, minN: 6899900, maxN: 6900100 },
    posts: SEED_POSTS,
    cableEdges: [],
    primaryCableEdges: [],
    rbushDump,
  };
}

test("leaf lookupByGps returns null for out-of-bbox GPS", async () => {
  const lib = createRegionLibrary(new IDBFactory());
  await lib.importRegionFromManifest(seedManifest());

  const hit = await lib.lookupByGps(-23.5, -46.6);
  assert.equal(hit, null);
});

test("DXF-04 positive: lookupByGps returns covering region for in-bbox GPS", async () => {
  const lib = createRegionLibrary(new IDBFactory());
  const manifest = seedManifest("floripa-positive");
  await lib.importRegionFromManifest(manifest);

  const lat = (FLORIANOPOLIS_BBOX.minLat + FLORIANOPOLIS_BBOX.maxLat) / 2;
  const lon = (FLORIANOPOLIS_BBOX.minLon + FLORIANOPOLIS_BBOX.maxLon) / 2;
  const hit = await lib.lookupByGps(lat, lon);

  assert.ok(hit);
  assert.equal(hit.id, "floripa-positive");
  assert.equal(hit.name, manifest.name);
});

test("hybrid lookupByGps returns null for out-of-bbox GPS (cloud fallback preserved)", async () => {
  const local = createRegionLibrary(new IDBFactory());
  await local.importRegionFromManifest(seedManifest("floripa-hybrid"));
  const hybrid = createHybridRegionLibrary(local, null);

  const hit = await hybrid.lookupByGps(-23.5, -46.6);
  assert.equal(hit, null);
});

test("NO_REGION structured error with haversine nearest region", () => {
  const regions = [
    {
      id: "near",
      name: "Near region",
      bboxLatLon: { minLat: -27.0, maxLat: -26.8, minLon: -48.5, maxLon: -48.3 },
    },
    {
      id: "far",
      name: "Far region",
      bboxLatLon: { minLat: -30.0, maxLat: -29.8, minLon: -51.0, maxLon: -50.8 },
    },
  ];

  const result = noRegionError(-23.5, -46.6, regions);
  assert.equal(result.code, "NO_REGION");
  assert.ok(result.nearest);
  assert.equal(result.nearest.name, "Near region");
  assert.ok(result.nearest.distanceKm > 0);
  assert.ok(Number.isFinite(result.nearest.distanceKm));
});
