import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { buildKml } from "../kml-builder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Golden test for the REAL DWG production path. The fixture captures
 * calculateCoordinatesWithDwg(real Siriu PDF + siriu.dxf).connections — the exact
 * finalized connections (with real GPS geometry) that reach buildKml in the browser.
 * Before the render-boundary normalization this produced 25 lines including split
 * taps (14-16-17 + 14-15-16), detached spurs (05-06 + 06-09), and ~12 spurious
 * 2-point "Poste X → Poste Y" stubs. This guards that production output stays clean.
 */
const fixture = JSON.parse(
  readFileSync(
    path.join(__dirname, "fixtures", "siriu-dwg-kmz.json"),
    "utf8",
  ),
);

/** Decode each rendered LineString back to its post-number sequence. */
function decodePolylines(kml, posts) {
  const coordKey = (p) =>
    `${Number(p.lon).toFixed(7)},${Number(p.lat).toFixed(7)},0`;
  const byCoord = new Map();
  for (const p of posts) {
    if (p.lat != null && p.lon != null) byCoord.set(coordKey(p), p.number);
  }
  const seqs = [];
  for (const m of kml.matchAll(
    /<LineString>[\s\S]*?<coordinates>([^<]+)<\/coordinates>/g,
  )) {
    seqs.push(
      m[1]
        .trim()
        .split(/\s+/)
        .map((c) => byCoord.get(c) ?? null),
    );
  }
  return seqs;
}

describe("buildKml — Siriu DWG-path golden", () => {
  const { kml } = buildKml(fixture.posts, fixture.connections, {});
  const seqs = decodePolylines(kml, fixture.posts);
  const joined = seqs.map((s) => s.join(",")).sort();
  const has = (seq) => joined.includes(seq.join(","));

  it("fixture is the real DWG production capture", () => {
    assert.equal(fixture.dwgStatus, "dwg-graph-walk");
    assert.ok(fixture.connections.length > 80);
  });

  it("junction 14 tap is one polyline (no 14→16 split)", () => {
    assert.ok(has([14, 15, 16, 17]), `expected 14-15-16-17 — got ${joined.join("|")}`);
    assert.ok(!has([14, 16, 17]), "spurious 14-16-17 split must be gone");
    assert.ok(!has([14, 15, 16]), "spurious 14-15-16 fragment must be gone");
  });

  it("spur off post 5 stays attached to its junction", () => {
    assert.ok(has([5, 6, 7, 8, 9]), `expected 5-6-7-8-9 — got ${joined.join("|")}`);
    assert.ok(!has([5, 6]), "detached 05-06 stub must be gone");
    assert.ok(!has([6, 7, 8, 9]), "orphaned 06-09 spur must be gone");
  });

  it("trunk follows the source-tagged main jumps", () => {
    const trunk = seqs.find((s) => s[0] === 1);
    assert.ok(trunk, "a trunk starting at post 1 must exist");
    // 5→10, 11→13, 14→18 are inferred-label mains and must be preserved in order
    for (const [a, b] of [
      [5, 10],
      [11, 13],
      [14, 18],
    ]) {
      const ia = trunk.indexOf(a);
      assert.ok(ia >= 0 && trunk[ia + 1] === b, `trunk must step ${a}→${b}`);
    }
  });

  it("single-post taps off sourced junctions are suppressed", () => {
    for (const tap of [
      [64, 65],
      [23, 24],
      [32, 33],
      [36, 37],
      [41, 42],
      [57, 58],
      [11, 12],
    ]) {
      assert.ok(!has(tap), `single-post tap ${tap.join("-")} must be suppressed`);
    }
  });

  it("redundant gap-bridges are dropped", () => {
    for (const bridge of [
      [51, 54],
      [62, 66],
      [71, 74],
    ]) {
      assert.ok(!has(bridge), `gap-bridge ${bridge.join("-")} must be dropped`);
    }
  });

  it("no spurious 2-point noise lines remain", () => {
    const twoPt = seqs.filter((s) => s.length === 2);
    assert.equal(
      twoPt.length,
      0,
      `expected no 2-point lines — got ${twoPt.map((s) => s.join("-")).join("|")}`,
    );
  });

  it("every rendered post resolves (no unmapped coordinates)", () => {
    for (const s of seqs) {
      assert.ok(!s.includes(null), "all line coordinates must map to a post");
    }
  });
});
