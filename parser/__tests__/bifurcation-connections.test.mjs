import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateCoordinates } from "../coordinate-calculator.js";
import { buildRoutePolylines } from "../kml-builder.js";

describe("bifurcation-aware route connections", () => {
  it("Siriu posts 3–11: main 5→10 and branch 5→9, no 9→10 or 4→6 chords", () => {
    const fx = JSON.parse(
      readFileSync(
        new URL("./fixtures/siriu-topology.json", import.meta.url),
        "utf8",
      ),
    );
    const posts = fx.posts
      .filter((p) => p.number >= 3 && p.number <= 11)
      .map((p) => ({
        ...p,
        lat: -27.65 - p.number * 0.001,
        lon: -48.69 + p.number * 0.001,
      }));
    const distances = fx.distances.filter((d) => {
      const lo = Math.min(d.from, d.to);
      const hi = Math.max(d.from, d.to);
      return (
        (lo >= 3 && hi <= 11) ||
        (d.from === 5 && d.to === 10) ||
        (d.from === 4 && d.to === 6) ||
        (d.from === 4 && d.to === 10) ||
        (d.from === 9 && d.to === 6)
      );
    });

    const { connections } = calculateCoordinates(
      posts,
      distances,
      -27.65,
      -48.69,
      [],
      null,
    );
    const keys = new Set(connections.map((c) => `${c.from}->${c.to}`));

    assert.ok(keys.has("5->10"), "main rejoin 5→10");
    assert.ok(keys.has("5->6"), "branch tap 5→6");
    assert.ok(!keys.has("9->10"), "no bogus branch tip→rejoin");
    assert.ok(!keys.has("4->6"), "no redundant inferred chord 4→6");
    assert.ok(!keys.has("4->10"), "no redundant inferred chord 4→10");

    const drawable = connections.filter((c) => c.gap !== true);
    const polylines = buildRoutePolylines(drawable).map((l) =>
      l.postNumbers.join(","),
    );
    assert.deepEqual(polylines.sort(), ["3,4,5,10,11", "5,6,7,8,9"].sort());
  });

  it("Siriu junctions 14/36/64: main trunk passes through 18/38/66, taps stay separate, mains are not 2-pt stubs", () => {
    const fx = JSON.parse(
      readFileSync(
        new URL("./fixtures/siriu-topology.json", import.meta.url),
        "utf8",
      ),
    );
    const posts = fx.posts.map((p) => ({
      ...p,
      lat: -27.65 - p.number * 0.001,
      lon: -48.69 + p.number * 0.001,
    }));

    const { connections } = calculateCoordinates(
      posts,
      fx.distances,
      -27.65,
      -48.69,
      [],
      null,
    );

    // The non-continuing junction main edges must be tagged as main, not the taps.
    const sourceOf = (from, to) =>
      connections.find((c) => c.from === from && c.to === to)?.source;
    assert.equal(sourceOf(14, 18), "inferred-label", "14→18 tagged main");
    assert.equal(sourceOf(36, 38), "inferred-label", "36→38 tagged main");
    assert.equal(sourceOf(64, 66), "inferred-label", "64→66 tagged main");

    const drawable = connections.filter((c) => c.gap !== true);
    const polylines = buildRoutePolylines(drawable).map((l) =>
      l.postNumbers.join(","),
    );
    const has = (s) => polylines.includes(s);
    const trunk = (mid) =>
      polylines.find((p) => {
        const nums = p.split(",").map(Number);
        return nums.includes(mid) && nums.length > 2;
      });

    // Main trunk passes THROUGH the junction main targets (not demoted to 2-pt stubs).
    assert.ok(trunk(18), `trunk should pass through 18 — got ${polylines.join("|")}`);
    assert.ok(trunk(38), `trunk should pass through 38 — got ${polylines.join("|")}`);
    assert.ok(trunk(66), `trunk should pass through 66 — got ${polylines.join("|")}`);

    // No junction main edge is an isolated 2-point line.
    assert.ok(!has("14,18"), "14,18 must not be a standalone 2-pt stub");
    assert.ok(!has("36,38"), "36,38 must not be a standalone 2-pt stub");
    assert.ok(!has("64,66"), "64,66 must not be a standalone 2-pt stub");

    // Tap spurs start their own polylines and are NOT merged into the trunk.
    assert.ok(has("14,15,16,17"), `tap 14→15→16→17 should be a separate polyline — got ${polylines.join("|")}`);
    assert.ok(has("36,37"), `tap 36→37 should be a separate polyline — got ${polylines.join("|")}`);
    assert.ok(has("64,65"), `tap 64→65 should be a separate polyline — got ${polylines.join("|")}`);

    // The trunk through junction 14 must NOT swallow the 15,16,17 tap.
    const trunk14 = trunk(18).split(",").map(Number);
    assert.ok(
      !trunk14.includes(15) && !trunk14.includes(16) && !trunk14.includes(17),
      `trunk through 18 must not absorb tap posts 15/16/17 — got ${trunk(18)}`,
    );

    // Regression guard: the 7 already-correct junctions still produce their spurs.
    assert.ok(has("5,6,7,8,9"), "junction 5 spur unchanged");
    assert.ok(has("48,49,50,51,52,53"), "junction 48 spur unchanged");
  });
});
