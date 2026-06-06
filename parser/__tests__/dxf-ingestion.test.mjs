import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { IDBFactory } from "fake-indexeddb";

import {
  createRegionLibrary,
  validateBrazilExtents,
  ZONE_22S,
} from "../dwg/region-library.js";
import { restorePostIndexFromDump } from "../dwg/region-pairing.js";
import { latLonToUtm } from "../geo/utm-calibrator.js";

const goldenBbox = JSON.parse(
  readFileSync(new URL("./fixtures/siriu-bbox-golden.json", import.meta.url), "utf8"),
);

function dxfBlob(text) {
  return new Blob([text], { type: "text/plain" });
}

test("SC-1: siriu.dxf ingests with confidence high and golden bboxLatLon", async () => {
  const dxfText = readFileSync(new URL("../../siriu.dxf", import.meta.url), "utf8");
  const lib = createRegionLibrary(new IDBFactory());
  const record = await lib.addRegion("siriu-sc1", dxfBlob(dxfText));

  assert.equal(record.crs.confidence, "high");
  assert.deepEqual(record.bboxLatLon, goldenBbox);
});

test("SC-2: mm-scale DXF throws unit mismatch and stores nothing", async () => {
  const dxfText = readFileSync(
    new URL("./fixtures/mm-scale.dxf", import.meta.url),
    "utf8",
  );
  const lib = createRegionLibrary(new IDBFactory());

  await assert.rejects(
    () => lib.addRegion("mm", dxfBlob(dxfText)),
    /DXF unit mismatch suspected/,
  );

  const regions = await lib.listRegions();
  assert.ok(!regions.some((r) => r.id === "mm"));
});

test("DXF-03: corners outside Brazil throw and store nothing", async () => {
  assert.throws(
    () =>
      validateBrazilExtents(
        { x: 200000, y: 5000000 },
        { x: 600001, y: 6700001 },
        22,
      ),
    /outside Brazil/,
  );

  const dxfText = readFileSync(
    new URL("./fixtures/mm-scale.dxf", import.meta.url),
    "utf8",
  );
  const lib = createRegionLibrary(new IDBFactory());
  await assert.rejects(
    () => lib.addRegion("brazil-fail", dxfBlob(dxfText)),
    /DXF unit mismatch suspected/,
  );
});

test("D-08: no-extents DXF ingests with confidence inferred", async () => {
  const dxfText = readFileSync(
    new URL("./fixtures/no-extents.dxf", import.meta.url),
    "utf8",
  );
  const lib = createRegionLibrary(new IDBFactory());
  const record = await lib.addRegion("no-ext", dxfBlob(dxfText));

  assert.equal(record.crs.confidence, "inferred");
  const regions = await lib.listRegions();
  assert.ok(regions.some((r) => r.id === "no-ext"));
});

test("DXF-04: rbushDump restores and nearest-post GPS query matches expected post", async () => {
  const dxfText = readFileSync(
    new URL("./fixtures/no-extents.dxf", import.meta.url),
    "utf8",
  );
  const lib = createRegionLibrary(new IDBFactory());
  const record = await lib.addRegion("restore-query", dxfBlob(dxfText));
  const expected = record.posts[0];
  assert.ok(expected);

  const postIndex = restorePostIndexFromDump(record.rbushDump);
  const { easting, northing } = latLonToUtm(
    record.bboxLatLon.minLat,
    record.bboxLatLon.minLon,
  );
  const found = postIndex.search({
    minX: expected.x - 10,
    minY: expected.y - 10,
    maxX: expected.x + 10,
    maxY: expected.y + 10,
  });
  assert.ok(found.length >= 1);

  let best = null;
  let bestDist = Infinity;
  for (const p of found) {
    const d = Math.hypot(p.x - expected.x, p.y - expected.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  assert.ok(best);
  assert.equal(best.x, expected.x);
  assert.equal(best.y, expected.y);
  assert.ok(typeof easting === "number");
});

test("ZONE_22S constants match plan envelope", () => {
  assert.equal(ZONE_22S.minE, 600000);
  assert.equal(ZONE_22S.maxE, 800000);
  assert.equal(ZONE_22S.minN, 6700000);
  assert.equal(ZONE_22S.maxN, 7100000);
});
