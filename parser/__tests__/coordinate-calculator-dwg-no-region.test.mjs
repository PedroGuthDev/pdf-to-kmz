import test from "node:test";
import assert from "node:assert/strict";

import { calculateCoordinatesWithDwg } from "../dwg/coordinate-calculator-dwg.js";

const SEEDED_REGION = {
  id: "floripa-seed",
  name: "Florianópolis test",
  bboxLatLon: { minLat: -27.3, maxLat: -27.1, minLon: -48.7, maxLon: -48.5 },
};

test("WR-06: cascade miss path attaches dwgNoRegion when lookupByGps returns null", async () => {
  const regionLibrary = {
    async lookupByGps() {
      return null;
    },
    async listRegions() {
      return [SEEDED_REGION];
    },
  };

  const result = await calculateCoordinatesWithDwg(
    [{ number: 1, page: 1, x: 100, y: 200 }],
    [],
    -23.5,
    -46.6,
    [],
    {},
    regionLibrary,
  );

  assert.equal(result.dwgStatus, "pdf-fallback");
  assert.ok(result.dwgNoRegion);
  assert.equal(result.dwgNoRegion.code, "NO_REGION");
  assert.ok(result.dwgNoRegion.nearest);
  assert.ok(Number.isFinite(result.dwgNoRegion.nearest.distanceKm));
  assert.ok(result.dwgNoRegion.nearest.distanceKm > 0);
});

test("WR-06: lookup throw path attaches dwgNoRegion (WR-05)", async () => {
  const regionLibrary = {
    async lookupByGps() {
      throw new Error("IndexedDB read failed");
    },
    async listRegions() {
      return [SEEDED_REGION];
    },
  };

  const result = await calculateCoordinatesWithDwg(
    [{ number: 1, page: 1, x: 100, y: 200 }],
    [],
    -23.5,
    -46.6,
    [],
    {},
    regionLibrary,
  );

  assert.equal(result.dwgStatus, "pdf-fallback");
  assert.ok(result.dwgNoRegion);
  assert.equal(result.dwgNoRegion.code, "NO_REGION");
  assert.ok(Number.isFinite(result.dwgNoRegion.nearest.distanceKm));
});
