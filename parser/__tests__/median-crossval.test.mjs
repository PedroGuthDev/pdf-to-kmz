import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  medianCrossValidate,
  AGREEMENT_FACTOR,
  SPAN_TOL_FRAC,
  CANDIDATE_WINDOW_MULT,
} from "../dwg/median-crossval.js";

/** Build planar UTM cable edges with uniform span length (meters). */
function edgesWithSpan(spanM, count = 5) {
  const edges = [];
  for (let i = 0; i < count; i++) {
    edges.push({
      a: { x: i * spanM, y: 0 },
      b: { x: (i + 1) * spanM, y: 0 },
    });
  }
  return edges;
}

describe("medianCrossValidate — D-08 PDF vs DXF scale guard", () => {
  it("agreeing medians → ok:true with scale-derived tolerances", () => {
    const medianPDF = 40;
    const distances = [
      { from: 1, to: 2, meters: 38 },
      { from: 2, to: 3, meters: 40 },
      { from: 3, to: 4, meters: 42 },
    ];
    const regionEdges = edgesWithSpan(medianPDF);

    const r = medianCrossValidate({ distances, regionEdges });

    assert.equal(r.ok, true);
    assert.equal(r.medianPDF, medianPDF);
    assert.equal(r.medianDXF, medianPDF);
    assert.ok(r.ratio >= 1 / AGREEMENT_FACTOR && r.ratio <= AGREEMENT_FACTOR);
    assert.equal(r.tolerances.spanTolM, SPAN_TOL_FRAC * medianPDF);
    assert.equal(r.tolerances.candidateWindowM, CANDIDATE_WINDOW_MULT * medianPDF);
  });

  it("mm-scale DXF spans (~1000× PDF) → reason scale-mismatch", () => {
    const distances = [
      { from: 1, to: 2, meters: 40 },
      { from: 2, to: 3, meters: 40 },
    ];
    const regionEdges = edgesWithSpan(40 * 1000);

    const r = medianCrossValidate({ distances, regionEdges });

    assert.equal(r.ok, false);
    assert.equal(r.reason, "scale-mismatch");
    assert.equal(r.medianPDF, 40);
    assert.equal(r.medianDXF, 40 * 1000);
    assert.ok(r.ratio < 1 / AGREEMENT_FACTOR || r.ratio > AGREEMENT_FACTOR);
  });

  it("empty DXF edges → reason insufficient-data", () => {
    const r = medianCrossValidate({
      distances: [{ from: 1, to: 2, meters: 40 }],
      regionEdges: [],
    });

    assert.equal(r.ok, false);
    assert.equal(r.reason, "insufficient-data");
  });

  it("skips null/zero PDF distances and null DXF coords (no NaN)", () => {
    const r = medianCrossValidate({
      distances: [
        { from: 1, to: 2, meters: null },
        { from: 2, to: 3, meters: 0 },
        { from: 3, to: 4, meters: 36 },
        { from: 4, to: 5, meters: 44 },
      ],
      regionEdges: [
        { a: { x: 0, y: 0 }, b: { x: 40, y: 0 } },
        { a: null, b: { x: 80, y: 0 } },
      ],
    });

    assert.equal(r.ok, true);
    assert.equal(r.medianPDF, 40);
    assert.equal(r.medianDXF, 40);
  });
});
