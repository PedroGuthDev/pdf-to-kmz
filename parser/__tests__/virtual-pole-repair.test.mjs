/**
 * Virtual-pole repair (Bibi Ferreira class): a projected route pole exists
 * only as a Cabo Projetado bend in the PDF — never in the DXF base — and the
 * accepted global solve shoehorned the printed-span chain onto wrong poles.
 *
 * Synthetic fixture reproduces the real Bibi junction shape (page-3 viewport
 * coords + Palhoça-like UTM frame, theta 0):
 *
 *   route 1→2→3→4→5→6; printed 42.8 / 12.5 / 6.6 / 20.4 / 31.2
 *   true: post 3 = pole E, post 4 = cable corner (NO DXF pole there)
 *   solved (wrong): post 3 = pole D (across the street), post 4 = pole E
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import RBush from "rbush";

import { repairMissingPoles } from "../dwg/virtual-pole-repair.js";
import { utmToLatLon, latLonToUtm } from "../geo/utm-calibrator.js";

const ZONE = 22;
const SF = 0.3546099290780142;
const TRANSFORM = {
  origin_e: 725188.5832306825,
  origin_n: 6938021.718545247,
  x_scale_sf: SF,
  y_scale_sf: SF,
  theta: 0,
  zone: ZONE,
};

// DXF poles (UTM) — Palhoça junction extract
const POLES = {
  P1: { x: 725426.3, y: 6937839.9 }, // post 1 (anchor)
  B: { x: 725433.6, y: 6937882.1 }, // post 2
  D: { x: 725429.2, y: 6937888.8 }, // spurious neighbor across the street
  E: { x: 725438.1, y: 6937896.1 }, // TRUE post 3
  G: { x: 725427.3, y: 6937906.8 },
  H: { x: 725438.7, y: 6937911.3 },
  F: { x: 725459.6, y: 6937900.9 }, // post 5
  P6: { x: 725493.0, y: 6937904.9 }, // post 6
};
const TRUE_CORNER = { x: 725441.2, y: 6937901.4 }; // post 4 — absent from DXF

function buildPostIndex(poles) {
  const tree = new RBush();
  tree.load(
    Object.values(poles).map((p) => ({
      ...p,
      minX: p.x,
      minY: p.y,
      maxX: p.x,
      maxY: p.y,
      block: "pole",
    })),
  );
  return tree;
}

function coordOf(postNumber, utm) {
  const { lat, lon } = utmToLatLon(utm.x, utm.y, ZONE);
  return { postNumber, lat, lon, source: "dwg" };
}

// Cabo Projetado page-3 ops (clean polyline; stroke triangles are exercised by
// the live Bibi run — here the extractor's plain-path branch is enough).
const CABLE_OPS = [
  { type: "M", x: 704.6, y: 514.32 },
  { type: "L", x: 710.0, y: 499.56 },
  { type: "L", x: 727.4, y: 399.8 },
  { type: "L", x: 737.0, y: 343.2 }, // the corner — post 4's pole
  { type: "L", x: 787.5, y: 352.4 },
  { type: "L", x: 874.5, y: 366.0 },
];

const ROUTE_POSTS = [
  { number: 1, x: 670.1, y: 512.7, pageNum: 3 },
  { number: 2, x: 689.3, y: 407.8, pageNum: 3 },
  { number: 3, x: 722.2, y: 283.5, pageNum: 3 }, // circle anchor far from pole
  { number: 4, x: 697.7, y: 328.1, pageNum: 3 },
  { number: 5, x: 778.5, y: 321.9, pageNum: 3 },
  { number: 6, x: 883.0, y: 333.4, pageNum: 3 },
];

const DISTANCES = [
  { from: 1, to: 2, meters: 42.8, source: "jumpback-refill" }, // invented refill
  { from: 2, to: 3, meters: 12.5, source: "legacy-midpoint" },
  { from: 3, to: 4, meters: 6.6, source: "legacy-midpoint" },
  { from: 4, to: 5, meters: 20.4, source: "legacy-midpoint" },
  { from: 5, to: 6, meters: 31.2, source: "legacy-midpoint" },
  { from: 2, to: 5, meters: 23.3, source: "inferred-label" }, // extra junction label
];
const INVENTED = new Set(["jumpback-refill", "inferred-label", "window-refine-duplicate"]);

function runRepair(coords, overrides = {}) {
  const warnings = [];
  const res = repairMissingPoles({
    coords,
    distances: DISTANCES,
    inventedSources: INVENTED,
    routePosts: ROUTE_POSTS,
    pageTransforms: new Map([[3, TRANSFORM]]),
    cablePaths: [{ pageNum: 3, ops: CABLE_OPS }],
    postIndex: buildPostIndex(POLES),
    zone: ZONE,
    warnings,
    ...overrides,
  });
  return { ...res, warnings };
}

test("repairs the missing-pole junction: post 3 → pole E, post 4 → virtual corner", () => {
  const wrong = [
    coordOf(1, POLES.P1),
    coordOf(2, POLES.B),
    coordOf(3, POLES.D), // shoehorned
    coordOf(4, POLES.E), // stole post 3's pole
    coordOf(5, POLES.F),
    coordOf(6, POLES.P6),
  ];
  const { coords, changed, warnings } = runRepair(wrong);
  assert.equal(changed, true);

  const utm = new Map(
    coords.map((c) => {
      const u = latLonToUtm(c.lat, c.lon);
      return [c.postNumber, { x: u.easting, y: u.northing }];
    }),
  );
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // post 3 lands on its true pole E
  assert.ok(
    dist(utm.get(3), POLES.E) < 1,
    `post 3 should be pole E, got ${JSON.stringify(utm.get(3))}`,
  );
  // post 4 lands at the cable corner (virtual pole), within survey tolerance
  assert.ok(
    dist(utm.get(4), TRUE_CORNER) < 4,
    `post 4 should be the cable corner, got ${JSON.stringify(utm.get(4))}`,
  );
  const c4 = coords.find((c) => c.postNumber === 4);
  assert.equal(c4.dwg_block, "virtual-pole");

  // untouched posts stay put
  assert.ok(dist(utm.get(2), POLES.B) < 0.1);
  assert.ok(dist(utm.get(5), POLES.F) < 0.1);

  const w = warnings.find((x) => x?.kind === "dwg-virtual-pole-repair");
  assert.ok(w, "repair warning emitted");
  assert.deepEqual(w.virtual_posts, [4]);

  // inputs not mutated
  assert.notEqual(coords, wrong);
  const origU = latLonToUtm(wrong[2].lat, wrong[2].lon);
  assert.ok(Math.hypot(origU.easting - POLES.D.x, origU.northing - POLES.D.y) < 0.1);
});

test("no-op on a clean solve (printed spans already fit)", () => {
  // place post 3 on E and post 4 at the true corner: spans ≈ printed
  const clean = [
    coordOf(1, POLES.P1),
    coordOf(2, POLES.B),
    coordOf(3, POLES.E),
    coordOf(4, TRUE_CORNER),
    coordOf(5, POLES.F),
    coordOf(6, POLES.P6),
  ];
  const { changed, warnings } = runRepair(clean);
  assert.equal(changed, false);
  assert.equal(warnings.length, 0);
});

test("no-op when cable paths or transforms are missing", () => {
  const wrong = [
    coordOf(1, POLES.P1),
    coordOf(2, POLES.B),
    coordOf(3, POLES.D),
    coordOf(4, POLES.E),
    coordOf(5, POLES.F),
    coordOf(6, POLES.P6),
  ];
  assert.equal(runRepair(wrong, { cablePaths: undefined }).changed, false);
  assert.equal(runRepair(wrong, { pageTransforms: undefined }).changed, false);
  assert.equal(runRepair(wrong, { postIndex: undefined }).changed, false);
});

test("label noise without a better pole is left untouched (improvement bar)", () => {
  // Perturb only one edge mildly: post 3 on E but printed 2→3 exaggerated so
  // the edge is "bad" — yet no alternative assignment fixes it, so no change.
  const clean = [
    coordOf(1, POLES.P1),
    coordOf(2, POLES.B),
    coordOf(3, POLES.E),
    coordOf(4, TRUE_CORNER),
    coordOf(5, POLES.F),
    coordOf(6, POLES.P6),
  ];
  const noisy = DISTANCES.map((d) =>
    d.from === 2 && d.to === 3 ? { ...d, meters: 21 } : d,
  );
  const { changed } = runRepair(clean, { distances: noisy });
  assert.equal(changed, false);
});
