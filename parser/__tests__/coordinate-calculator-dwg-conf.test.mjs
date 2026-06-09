import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  formatDwgWarning,
  calculateCoordinatesWithDwg,
} from "../dwg/coordinate-calculator-dwg.js";

/**
 * Phase 09 Plan 01 Task 2 — confidence-surfacing additions at the calculator:
 *   D-09: a new Portuguese `diverged-at-post` warning kind (meters, never %).
 *   D-12/D-13: an explicit `hardBlock` boolean at every result exit so the UI
 *              never has to string-sniff `dwgStatus`. true on no-region / unit
 *              misses; false on matched-region degradation and success.
 *
 * The full async DWG cascade needs real region geometry, so the block-vs-flag
 * policy is exercised here via the no-region path (stubbed regionLibrary) which
 * is the canonical HARD-BLOCK exit; the flag exits are asserted structurally
 * (hardBlock literal present) by the source grep in the plan's acceptance.
 */

describe("formatDwgWarning — diverged-at-post (D-09)", () => {
  it("renders a Portuguese diverged-at-post reason with post + residual meters and no %", () => {
    const s = formatDwgWarning({
      kind: "diverged-at-post",
      at_post: 7,
      residual_m: 179.04,
    });
    assert.ok(s.includes("poste 7"), `expected "poste 7" in: ${s}`);
    assert.ok(s.includes("179.0"), `expected "179.0" (1 decimal) in: ${s}`);
    assert.ok(!s.includes("%"), `must not contain a percentage: ${s}`);
  });

  it("formats the residual to exactly one decimal place", () => {
    const s = formatDwgWarning({
      kind: "diverged-at-post",
      at_post: 21,
      residual_m: 15,
    });
    assert.ok(s.includes("15.0"), `expected "15.0" in: ${s}`);
    assert.ok(!s.includes("%"));
  });
});

describe("hardBlock at result exits (D-12/D-13)", () => {
  // A regionLibrary stub whose GPS lookup finds nothing → the `if (!region)`
  // no-region miss exit, which is the canonical HARD BLOCK.
  function noRegionLibrary() {
    return {
      async lookupByGps() {
        return null;
      },
      async listRegions() {
        return [
          {
            name: "alguma-regiao",
            bboxLatLon: { minLat: -27, maxLat: -26, minLon: -49, maxLon: -48 },
          },
        ];
      },
    };
  }

  it("no-region miss carries hardBlock:true alongside dwgNoRegion", async () => {
    const posts = [{ number: 1, lat: -23.5, lon: -46.6 }];
    const distances = [];
    const result = await calculateCoordinatesWithDwg(
      posts,
      distances,
      -23.5,
      -46.6,
      [],
      {},
      noRegionLibrary(),
    );
    assert.equal(result.hardBlock, true);
    assert.ok(result.dwgNoRegion, "no-region miss carries dwgNoRegion");
    assert.equal(result.dwgStatus, "pdf-fallback");
  });
});
