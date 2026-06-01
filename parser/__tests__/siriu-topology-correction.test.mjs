import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { buildKml } from "../kml-builder.js";
import { applyTopologyCorrections } from "../dwg/topology-corrections.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Ground-truth regression for the Siriu cable route. The fixture is the real
 * calculateCoordinatesWithDwg(Siriu PDF + siriu.dxf) output — the connections that
 * reach buildKml in production. applyTopologyCorrections fixes the wrong/missing
 * branch edges the numbering-driven associator emits; this test locks the corrected
 * route the field reviewer verified (2026-06-01).
 */
const fixture = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures", "siriu-dwg-kmz.json"), "utf8"),
);

function renderedEdges(posts, connections) {
  const { kml } = buildKml(posts, connections, {});
  const coordKey = (p) =>
    `${Number(p.lon).toFixed(7)},${Number(p.lat).toFixed(7)},0`;
  const byCoord = new Map();
  for (const p of posts) {
    if (p.lat != null && p.lon != null) byCoord.set(coordKey(p), p.number);
  }
  const edges = new Set();
  const seqs = [];
  for (const m of kml.matchAll(
    /<LineString>[\s\S]*?<coordinates>([^<]+)<\/coordinates>/g,
  )) {
    const seq = m[1].trim().split(/\s+/).map((c) => byCoord.get(c) ?? null);
    seqs.push(seq);
    for (let i = 0; i + 1 < seq.length; i++) {
      if (seq[i] != null && seq[i + 1] != null) {
        edges.add(`${Math.min(seq[i], seq[i + 1])}-${Math.max(seq[i], seq[i + 1])}`);
      }
    }
  }
  return { edges, seqs };
}

describe("Siriu topology correction", () => {
  const { connections: corrected, applied } = applyTopologyCorrections(
    fixture.connections,
    fixture.posts,
  );

  it("signature matches the Siriu drawing", () => {
    assert.equal(applied, "siriu");
  });

  it("does NOT fire on a non-matching network", () => {
    const other = applyTopologyCorrections(
      [{ from: 1, to: 2 }, { from: 2, to: 3 }],
      [{ number: 1 }, { number: 2 }, { number: 3 }],
    );
    assert.equal(other.applied, null);
  });

  const { edges } = renderedEdges(fixture.posts, corrected);
  const has = (a, b) => edges.has(`${Math.min(a, b)}-${Math.max(a, b)}`);

  it("adds the spine edges the parser had suppressed/missing", () => {
    for (const [a, b] of [
      [18, 19], // jumpback-suppressed spine
      [38, 39], // jumpback-suppressed branch start
      [42, 43], // bifurcation-cleared
      [65, 66], // bifurcation-cleared
      [66, 67], // jumpback-suppressed
      [36, 46], // spine jump (no label)
      [60, 69], // branch off 60
      [70, 74], // second arm of 70
      [62, 81], // branch off 62
    ]) {
      assert.ok(has(a, b), `expected cable edge ${a}-${b}`);
    }
  });

  it("removes the edges the cable does not actually run", () => {
    for (const [a, b] of [
      [38, 42],
      [45, 46],
      [64, 66],
      [68, 69],
      [80, 81],
    ]) {
      assert.ok(!has(a, b), `edge ${a}-${b} must not be drawn`);
    }
  });

  it("renders the 36 branch as a contiguous run 36-38-…-45", () => {
    for (const [a, b] of [
      [36, 38],
      [38, 39],
      [39, 40],
      [40, 41],
      [41, 42],
      [42, 43],
      [43, 44],
      [44, 45],
    ]) {
      assert.ok(has(a, b), `36-branch must include ${a}-${b}`);
    }
  });

  it("connects the 64 branch 64-65-66-67-68", () => {
    for (const [a, b] of [
      [64, 65],
      [65, 66],
      [66, 67],
      [67, 68],
    ]) {
      assert.ok(has(a, b), `64-branch must include ${a}-${b}`);
    }
  });

  it("post 80 is a route end (no 80→81)", () => {
    assert.ok(!has(80, 81));
    assert.ok(has(79, 80));
  });
});
