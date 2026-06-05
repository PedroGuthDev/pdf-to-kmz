import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeResiduals,
  computeAnchorGap,
  applyResidualGate,
} from "../dwg/residual-gate.js";

/**
 * Pure-unit tests for the truth-free residual gate. They lock the four
 * load-bearing contracts of Phase 05 Plan 01:
 *   1. route shape aggregate is the MEDIAN, not the mean (a single outlier edge
 *      must not blow up the route score — the Siriu 60.5% mean / 0.3% median
 *      problem),
 *   2. invalid edges (meters null / 0) are skipped and empty input is null, not NaN,
 *   3. computeAnchorGap reproduces the haversine gap (post 1 ~0, downstream ~180 m),
 *   4. the two-gate decision is "trust" only when BOTH pass, "fail" when the
 *      ANCHOR sub-score alone exceeds its hard threshold (the LC rigid-offset
 *      mechanism), and a post with no edge and no anchor is UNRESOLVABLE.
 * No route fixture is loaded — route-level CI assertions live in Plan 02.
 */

// Helper coords near Santa Catarina (~ -27.6, -48.6). 0.0016° of latitude ≈ 178 m.
const LAT0 = -27.6;
const LON0 = -48.6;

describe("computeResiduals — MEDIAN aggregation, not mean", () => {
  it("a single 10x-error outlier does not dominate the median", () => {
    // Build coords + distances such that one edge has ~1000% relError and the
    // rest are ~0. We place posts on a line and lie about one printed distance.
    const coords = [
      { postNumber: 1, lat: LAT0, lon: LON0 },
      { postNumber: 2, lat: LAT0 + 0.0009, lon: LON0 }, // ~100 m north of 1
      { postNumber: 3, lat: LAT0 + 0.0018, lon: LON0 }, // ~100 m north of 2
      { postNumber: 4, lat: LAT0 + 0.0027, lon: LON0 }, // ~100 m north of 3
      { postNumber: 5, lat: LAT0 + 0.0036, lon: LON0 }, // ~100 m north of 4
    ];
    // Compute the true haversine for each consecutive pair to set near-zero-error labels.
    const hav = (a, b) =>
      computeResiduals([a, b], [{ from: a.postNumber, to: b.postNumber, meters: 1 }])
        .perEdge[0].hav;
    const d12 = hav(coords[0], coords[1]);
    const d23 = hav(coords[1], coords[2]);
    const d34 = hav(coords[2], coords[3]);
    const d45 = hav(coords[3], coords[4]);
    const distances = [
      { from: 1, to: 2, meters: d12, source: "label" }, // ~0 relError
      { from: 2, to: 3, meters: d23, source: "label" }, // ~0 relError
      { from: 3, to: 4, meters: d34, source: "label" }, // ~0 relError
      { from: 4, to: 5, meters: d45 / 11, source: "label" }, // printed 11x too small → ~1000% relError
    ];
    const r = computeResiduals(coords, distances);
    assert.equal(r.edgeCount, 4);

    // MEDIAN stays small despite the outlier.
    assert.ok(r.medianRelError < 0.05, `median ${r.medianRelError} should be < 0.05`);

    // The equivalent MEAN would be dominated by the outlier (> 0.5).
    const mean =
      r.perEdge.reduce((s, e) => s + e.relError, 0) / r.perEdge.length;
    assert.ok(mean > 0.5, `inline mean ${mean} should be > 0.5 (proves median != mean)`);
  });
});

describe("computeResiduals — guards on invalid / empty input", () => {
  it("skips edges with meters null or 0 and counts only valid edges", () => {
    const coords = [
      { postNumber: 1, lat: LAT0, lon: LON0 },
      { postNumber: 2, lat: LAT0 + 0.0009, lon: LON0 },
      { postNumber: 3, lat: LAT0 + 0.0018, lon: LON0 },
    ];
    const valid = computeResiduals(
      [coords[0], coords[1]],
      [{ from: 1, to: 2, meters: 1 }],
    ).perEdge[0].hav;
    const distances = [
      { from: 1, to: 2, meters: null, source: "blocked" }, // skipped
      { from: 2, to: 3, meters: 0, source: "blocked" }, // skipped
      { from: 1, to: 2, meters: valid, source: "label" }, // kept
    ];
    const r = computeResiduals(coords, distances);
    assert.equal(r.edgeCount, 1);
  });

  it("empty input returns null aggregates and does not throw", () => {
    const r = computeResiduals([], []);
    assert.equal(r.medianRelError, null);
    assert.equal(r.p95RelError, null);
    assert.equal(r.edgeCount, 0);
    assert.deepEqual(r.perEdge, []);
  });

  it("skips edges whose endpoint has no paired coord", () => {
    const coords = [{ postNumber: 1, lat: LAT0, lon: LON0 }]; // post 2 missing
    const r = computeResiduals(coords, [{ from: 1, to: 2, meters: 100 }]);
    assert.equal(r.edgeCount, 0);
    assert.equal(r.medianRelError, null);
  });
});

describe("computeAnchorGap — DWG-vs-PDF per-post gap", () => {
  it("post 1 with identical dwg/pdf coords gaps ~0; downstream offset ~180 m", () => {
    const coords = [
      { postNumber: 1, lat: LAT0, lon: LON0 },
      { postNumber: 2, lat: LAT0 + 0.0016, lon: LON0 }, // DWG places post 2 ~178 m north
    ];
    const gpsByPostNumber = new Map([
      [1, { lat: LAT0, lon: LON0 }], // PDF anchor identical to DWG → ~0
      [2, { lat: LAT0, lon: LON0 }], // PDF places post 2 at the anchor → ~178 m gap
    ]);
    const r = computeAnchorGap(coords, gpsByPostNumber);
    const g1 = r.perPost.find((p) => p.postNumber === 1).gapM;
    const g2 = r.perPost.find((p) => p.postNumber === 2).gapM;
    assert.ok(g1 < 1, `post 1 gap ${g1} should be ~0`);
    assert.ok(g2 > 150 && g2 < 220, `post 2 gap ${g2} should be 150-220 m`);
  });

  it("skips posts with null lat or no PDF entry; empty → null aggregates", () => {
    const coords = [
      { postNumber: 1, lat: null, lon: null }, // skipped (null lat)
      { postNumber: 2, lat: LAT0, lon: LON0 }, // no PDF entry → skipped
    ];
    const r = computeAnchorGap(coords, new Map());
    assert.equal(r.meanGapM, null);
    assert.equal(r.p95GapM, null);
    assert.deepEqual(r.perPost, []);
  });
});

describe("applyResidualGate — two-gate decision + per-post tiers", () => {
  it("trust only when BOTH shape and anchor pass", () => {
    const r = applyResidualGate(
      { medianRelError: 0.003, perEdge: [] },
      { p95GapM: 10, perPost: [] },
    );
    assert.equal(r.gateDecision, "trust");
  });

  it("fail on the ANCHOR sub-score even when shape passes (ACC-03 / LC mechanism)", () => {
    const r = applyResidualGate(
      { medianRelError: 0.03, perEdge: [] }, // shape passes its trust/fallback bands
      { p95GapM: 200, perPost: [] }, // anchor exceeds ANCHOR_FAIL_M
    );
    assert.equal(r.gateDecision, "fail");
  });

  it("fallback in the middle band (neither hard-fails, not both pass)", () => {
    const r = applyResidualGate(
      { medianRelError: 0.1, perEdge: [] }, // shape between trust (5%) and fallback (15%) → not pass, not fail
      { p95GapM: 10, perPost: [] }, // anchor passes
    );
    assert.equal(r.gateDecision, "fallback");
  });

  it("post with no incident edge and no anchor entry → UNRESOLVABLE", () => {
    const r = applyResidualGate(
      { medianRelError: 0.003, perEdge: [{ from: 1, to: 2, relError: 0.01 }] },
      {
        p95GapM: 10,
        perPost: [
          { postNumber: 1, gapM: 5 },
          { postNumber: 2, gapM: 8 },
        ],
      },
      { allPostNumbers: [1, 2, 99] }, // post 99 is declared but unscored
    );
    const t99 = r.postTiers.find((t) => t.postNumber === 99);
    assert.ok(t99, "post 99 must be present (never dropped)");
    assert.equal(t99.tier, "UNRESOLVABLE");
  });

  it("per-post tiers carry tier-label fields only — no numeric percentage", () => {
    const r = applyResidualGate(
      { medianRelError: 0.003, perEdge: [{ from: 1, to: 2, relError: 0.01 }] },
      { p95GapM: 10, perPost: [{ postNumber: 1, gapM: 5 }, { postNumber: 2, gapM: 8 }] },
    );
    assert.ok(r.postTiers.length > 0);
    for (const t of r.postTiers) {
      assert.deepEqual(Object.keys(t).sort(), ["postNumber", "tier"]);
      assert.ok(
        ["HIGH", "MED", "LOW", "UNRESOLVABLE"].includes(t.tier),
        `tier ${t.tier} must be a label`,
      );
    }
  });

  it("HIGH only when both per-post sub-scores pass; a single bad edge forces away from HIGH", () => {
    const r = applyResidualGate(
      {
        medianRelError: 0.2,
        perEdge: [
          { from: 1, to: 2, relError: 0.01 }, // post 1 good edge
          { from: 2, to: 3, relError: 0.9 }, // post 2's worst edge is bad → not HIGH
        ],
      },
      {
        p95GapM: 10,
        perPost: [
          { postNumber: 1, gapM: 5 },
          { postNumber: 2, gapM: 5 },
          { postNumber: 3, gapM: 5 },
        ],
      },
    );
    const t1 = r.postTiers.find((t) => t.postNumber === 1);
    const t2 = r.postTiers.find((t) => t.postNumber === 2);
    assert.equal(t1.tier, "HIGH"); // best incident edge 0.01 < trust, anchor 5 < trust
    assert.equal(t2.tier, "LOW"); // worst incident edge 0.9 >= fallback → LOW
  });
});
