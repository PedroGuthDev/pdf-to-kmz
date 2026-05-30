import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildKml, buildRoutePolylines } from "../kml-builder.js";

describe("buildRoutePolylines", () => {
  it("merges a simple chain into one polyline", () => {
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
    ];
    const lines = buildRoutePolylines(connections);
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].postNumbers, [1, 2, 3, 4]);
  });

  it("splits at bifurcation into main run and branch", () => {
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 2, to: 4 },
    ];
    const branchStarts = new Set([4]);
    const lines = buildRoutePolylines(connections, branchStarts);
    assert.equal(lines.length, 2);
    const sorted = lines
      .map((l) => l.postNumbers.join(","))
      .sort()
      .join("|");
    assert.match(sorted, /1,2,3/);
    assert.match(sorted, /2,4/);
  });

  it("branch return at junction prefers main rejoin over tap leg", () => {
    const connections = [
      { from: 3, to: 4 },
      { from: 4, to: 5 },
      { from: 5, to: 6 },
      { from: 5, to: 10 },
      { from: 6, to: 7 },
      { from: 7, to: 8 },
      { from: 8, to: 9 },
      { from: 10, to: 11 },
    ];
    const lines = buildRoutePolylines(connections);
    assert.equal(lines.length, 2);
    const paths = lines.map((l) => l.postNumbers.join(",")).sort();
    assert.equal(paths[0], "3,4,5,10,11");
    assert.equal(paths[1], "5,6,7,8,9");
  });

  it("splits on gap edges", () => {
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3, gap: true },
      { from: 3, to: 4 },
    ];
    const lines = buildRoutePolylines(connections);
    assert.equal(lines.length, 3);
    assert.deepEqual(lines.find((l) => l.gap)?.postNumbers, [2, 3]);
    assert.deepEqual(
      lines.find((l) => !l.gap && l.postNumbers[0] === 1)?.postNumbers,
      [1, 2],
    );
    assert.deepEqual(
      lines.find((l) => !l.gap && l.postNumbers[0] === 3)?.postNumbers,
      [3, 4],
    );
  });

  it("source-tagged main wins when the jump target has no consecutive continuation (junction 64)", () => {
    // 64→65 tap (leaf), 64→66 main tagged; 66 continues but NOT via 66→67
    // (jumpback-suppressed). The pre-fix heuristic fell back to the 65 tap as main.
    const connections = [
      { from: 63, to: 64 },
      { from: 64, to: 65 },
      { from: 64, to: 66, source: "bifurcation-main" },
      { from: 66, to: 67 },
      { from: 67, to: 68 },
    ];
    const lines = buildRoutePolylines(connections);
    const paths = lines.map((l) => l.postNumbers.join(",")).sort();
    // main trunk extends through the tagged edge into 66→67→68
    assert.ok(
      paths.includes("63,64,66,67,68"),
      `main trunk should pass through 64,66,67,68 — got ${paths.join("|")}`,
    );
    // tap 64→65 is its own polyline, not merged into the trunk
    assert.ok(
      paths.includes("64,65"),
      `tap 64→65 should be a separate polyline — got ${paths.join("|")}`,
    );
    // main edge must NOT be demoted to an isolated 2-pt stub
    assert.ok(
      !paths.includes("64,66"),
      `64,66 must not be an isolated 2-pt stub — got ${paths.join("|")}`,
    );
  });

  it("inferred-label main wins over consecutive tap (junction 14)", () => {
    const connections = [
      { from: 13, to: 14 },
      { from: 14, to: 15 },
      { from: 14, to: 18, source: "inferred-label" },
      { from: 18, to: 19 },
    ];
    const lines = buildRoutePolylines(connections);
    const paths = lines.map((l) => l.postNumbers.join(",")).sort();
    assert.ok(
      paths.includes("13,14,18,19"),
      `main trunk should pass through 14,18,19 — got ${paths.join("|")}`,
    );
    assert.ok(
      paths.includes("14,15"),
      `tap 14→15 should be a separate polyline — got ${paths.join("|")}`,
    );
  });

  it("source-less non-continuing jump beats consecutive tap when its target has outgoing edges (Part B)", () => {
    // No source tags. 36→37 tap (leaf), 36→38 jump; 38 has 38→… outgoing but no
    // 38→39 continuation. The jump is the bifurcation rejoin and must win.
    const connections = [
      { from: 35, to: 36 },
      { from: 36, to: 37 },
      { from: 36, to: 38 },
      { from: 38, to: 50 },
    ];
    const lines = buildRoutePolylines(connections);
    const paths = lines.map((l) => l.postNumbers.join(",")).sort();
    assert.ok(
      paths.includes("35,36,38,50"),
      `source-less jump should be main — got ${paths.join("|")}`,
    );
    assert.ok(
      paths.includes("36,37"),
      `tap 36→37 should be a separate polyline — got ${paths.join("|")}`,
    );
  });

  it("source-less jump to a bare leaf stays a spur (does not override consecutive)", () => {
    // Guards Part B: 2→4 jumps to a leaf (no outgoing edges) → genuine spur, the
    // consecutive 2→3 through-route must remain main.
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 2, to: 4 },
    ];
    const lines = buildRoutePolylines(connections);
    const paths = lines.map((l) => l.postNumbers.join(",")).sort();
    assert.ok(
      paths.includes("1,2,3"),
      `consecutive through-route should be main — got ${paths.join("|")}`,
    );
    assert.ok(
      paths.includes("2,4"),
      `leaf jump 2→4 should be a separate spur — got ${paths.join("|")}`,
    );
  });
});

describe("buildKml", () => {
  it("builds placemarks and one merged line for a simple route", () => {
    const posts = [
      { number: 1, lat: -27.65, lon: -48.69 },
      { number: 2, lat: -27.66, lon: -48.7 },
      { number: 3, lat: -27.67, lon: -48.71 },
    ];
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
    ];
    const { kml, stats } = buildKml(posts, connections, {});
    assert.equal(stats.placemarkCount, 3);
    assert.equal(stats.lineCount, 1);
    const lineStrings = kml.match(/<LineString>/g) || [];
    assert.equal(lineStrings.length, 1);
    const routeCoords = kml.match(
      /<LineString>[\s\S]*?<coordinates>([^<]+)<\/coordinates>/,
    )?.[1];
    assert.ok(routeCoords?.trim().split(/\s+/).length >= 3);
    assert.match(kml, /Route 01–03/);
  });

  it("draws two cable runs at a branch (not one line per edge)", () => {
    const posts = [
      { number: 1, lat: 1, lon: 1 },
      { number: 2, lat: 2, lon: 2 },
      { number: 3, lat: 3, lon: 3 },
      { number: 4, lat: 4, lon: 4 },
    ];
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 2, to: 4 },
    ];
    const { stats } = buildKml(posts, connections, {});
    assert.equal(stats.placemarkCount, 4);
    assert.equal(stats.lineCount, 2);
  });

  it("omits posts without GPS and counts them", () => {
    const posts = [
      { number: 1, lat: 1, lon: 1 },
      { number: 3, lat: null, lon: null },
    ];
    const { kml, stats } = buildKml(posts, [], {});
    assert.equal(stats.omittedNoGps, 1);
    assert.equal(stats.placemarkCount, 1);
    assert.doesNotMatch(kml, /<name>Poste 03<\/name>/);
  });

  it("escapes line description in XML", () => {
    const posts = [
      { number: 1, lat: 1, lon: 1 },
      { number: 2, lat: 2, lon: 2 },
    ];
    const { kml } = buildKml(posts, [{ from: 1, to: 2 }], {
      lineDescription: "Cable <A>&B",
    });
    assert.match(kml, /Cable &lt;A&gt;&amp;B/);
  });

  it("returns valid empty document", () => {
    const { kml, stats } = buildKml([], [], {});
    assert.equal(stats.placemarkCount, 0);
    assert.match(kml, /<Document>/);
    assert.ok(Array.isArray(stats.warnings));
  });
});
