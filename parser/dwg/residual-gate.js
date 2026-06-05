import { haversineMeters } from "../geo/utm-calibrator.js";

/**
 * Truth-free residual gate — a pure-math quality judge for paired-coordinate
 * results. It rates any route using TWO independent sub-scores and assigns
 * per-post confidence tiers, WITHOUT any GPS ground-truth fixture in the live
 * path:
 *
 *   1. Shape-fidelity (`computeResiduals`): how well the paired inter-post
 *      geometry reproduces the printed distance labels. Aggregated as the
 *      MEDIAN relative error over labelled edges — NOT the mean. (Mean is
 *      dominated by a handful of label/pairing outliers: on Siriu the mean
 *      relative error is 60.5% while the median is 0.3%. Using the mean here
 *      would false-fail a known-good route and break ACC-04.)
 *
 *   2. Absolute-anchor (`computeAnchorGap`): how far the DWG-paired route
 *      geometry sits from where the user-anchored PDF path places the SAME
 *      posts. The first post is pinned to the user GPS by construction, so its
 *      gap is ~0 by design; downstream posts diverge when the route is rigidly
 *      offset (the canonical Luiz Carolino posts 21–31 ~179 m offset that the
 *      shape sub-score alone cannot catch — D-03).
 *
 * `applyResidualGate` combines the two: a route is rated "trust" ONLY when BOTH
 * sub-scores pass; either failing alone fails/downgrades the route. Per post it
 * emits a HIGH/MED/LOW/UNRESOLVABLE tier (D-04) — labels only, never a numeric
 * percentage (D-07). This phase MEASURES; it never changes pipeline output (D-01).
 *
 * Pure module: no I/O, no new npm dependency, reuses the in-house haversine.
 */

/**
 * Shape-fidelity sub-score: per-edge relative error between the paired
 * inter-post haversine distance and the printed distance label, aggregated as
 * the MEDIAN (route-level) plus a p95 tail.
 *
 * Guards: distances with `meters <= 0` / null / NaN are skipped (cleared or
 * blocked edges), as are edges whose endpoints have no non-null paired coord.
 * On an empty / no-valid-edge input the aggregates are `null` (no NaN, no
 * divide-by-zero).
 *
 * @param {Array<{ postNumber: number, lat: number|null, lon: number|null }>} coords
 *   DWG-paired post coordinates.
 * @param {Array<{ from: number, to: number, meters: number|null, source?: string }>} distances
 *   Labelled inter-post distances.
 * @returns {{
 *   medianRelError: number|null,
 *   p95RelError: number|null,
 *   edgeCount: number,
 *   perEdge: Array<{ from: number, to: number, printed: number, hav: number,
 *                    relError: number, residualM: number, source?: string }>
 * }}
 */
export function computeResiduals(coords, distances) {
  // coords: [{ postNumber, lat, lon }] ; distances: [{ from, to, meters, source }]
  const byNum = new Map(coords.filter(c => c.lat != null).map(c => [c.postNumber, c]));
  const perEdge = [];
  for (const d of distances) {
    if (!(d.meters > 0)) continue;           // skip cleared/blocked edges (meters null) — V5 input-validation
    const A = byNum.get(d.from), B = byNum.get(d.to);
    if (!A || !B) continue;                   // endpoint unpaired → not a shape edge
    const hav = haversineMeters(A.lat, A.lon, B.lat, B.lon);
    const relError = Math.abs(hav - d.meters) / d.meters;
    perEdge.push({ from: d.from, to: d.to, printed: d.meters, hav, relError,
                   residualM: Math.abs(hav - d.meters), source: d.source });
  }
  const rels = perEdge.map(e => e.relError).sort((a, b) => a - b);
  const median = rels.length ? rels[Math.floor(rels.length / 2)] : null;
  const p95 = rels.length ? rels[Math.floor(rels.length * 0.95)] : null;
  return { medianRelError: median, p95RelError: p95, edgeCount: perEdge.length, perEdge };
}

/**
 * Absolute-anchor sub-score (D-03): per-post gap between the DWG-paired
 * coordinate and the user-anchored PDF-path coordinate for the same post. Post
 * 1 is the shared anchor and reads ~0 by construction; downstream posts diverge
 * under a rigid offset.
 *
 * Guards: posts with a null paired lat, or with no matching entry in
 * `gpsByPostNumber`, are skipped. On an empty set the aggregates are `null`.
 *
 * @param {Array<{ postNumber: number, lat: number|null, lon: number|null }>} coords
 *   DWG-paired post coordinates.
 * @param {Map<number, { lat: number, lon: number }>} gpsByPostNumber
 *   User-anchored PDF positions, keyed by post number.
 * @returns {{
 *   meanGapM: number|null,
 *   p95GapM: number|null,
 *   perPost: Array<{ postNumber: number, gapM: number }>
 * }}
 */
export function computeAnchorGap(coords, gpsByPostNumber) {
  // coords: DWG-paired [{ postNumber, lat, lon }]; gpsByPostNumber: Map<postNumber,{lat,lon}> (user-anchored PDF)
  const perPost = [];
  for (const c of coords) {
    if (c.lat == null) continue;
    const pdf = gpsByPostNumber.get(c.postNumber);
    if (!pdf) continue;                       // unpaired in PDF path → skip (post-1 pinned ⇒ ~0 by design)
    perPost.push({ postNumber: c.postNumber, gapM: haversineMeters(c.lat, c.lon, pdf.lat, pdf.lon) });
  }
  const gaps = perPost.map(p => p.gapM).sort((a, b) => a - b);
  const mean = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;
  const p95 = gaps.length ? gaps[Math.floor(gaps.length * 0.95)] : null;
  return { meanGapM: mean, p95GapM: p95, perPost };
}
