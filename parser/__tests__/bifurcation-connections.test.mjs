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
});
