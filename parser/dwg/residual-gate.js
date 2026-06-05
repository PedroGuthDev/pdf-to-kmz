import { haversineMeters } from "../geo/utm-calibrator.js";

// ── Threshold constants (D-05) ──────────────────────────────────────────────
//
// Shape-fidelity bands are median relative error: < SHAPE_TRUST is a clean
// route ("trust"), >= SHAPE_FALLBACK is a failed shape. Seeds are the research
// estimates (5% trust / 15% fallback) and are considered final for shape.
//
// Anchor bands are p95/per-post gap in metres. The seed values below are
// PLACEHOLDERS — LOCKED in Plan 02 against real Siriu/Valmor/João Born output.
// The hard constraint is ANCHOR_FAIL_M < 202 m (the Luiz Carolino mean anchor
// gap, ~179 m on posts 21–31) so the LC rigid offset MUST fail while known-good
// routes pass. Do NOT treat these as calibrated until Plan 02 replaces them.
const SHAPE_TRUST = 0.05;       // median relError < 5% → shape passes (trust)
const SHAPE_FALLBACK = 0.15;    // median relError >= 15% → shape fails
const ANCHOR_TRUST_M = 50;      // placeholder — LOCKED in Plan 02
const ANCHOR_FALLBACK_M = 100;  // placeholder — LOCKED in Plan 02
const ANCHOR_FAIL_M = 150;      // placeholder — LOCKED in Plan 02; must stay < 202m (LC anchor gap)

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

/**
 * Two-gate route decision + per-post confidence tiers.
 *
 * Route decision (HIGH-only-when-BOTH-pass, the Pitfall-1 rule that catches the
 * LC rigid offset a shape-only gate would miss):
 *   - "trust"    : shape median < SHAPE_TRUST AND anchor p95 < ANCHOR_TRUST_M
 *   - "fail"     : shape median >= SHAPE_FALLBACK OR anchor p95 >= ANCHOR_FAIL_M
 *   - "fallback" : the middle band (one sub-score in its grey zone, neither
 *                  hard-failing). This phase only LABELS — no downstream
 *                  behavior change (D-01).
 *
 * Per post (D-04, fail-loud):
 *   - A post with NO incident labelled edge AND NO anchor entry → "UNRESOLVABLE"
 *     (flagged, never dropped).
 *   - Otherwise shapeScore = MAX relError over the post's incident edges (the
 *     worst edge, so a single bad edge cannot hide behind good neighbours);
 *     anchorScore = the post's gap (or null). Tier bands:
 *       HIGH = shapeScore < SHAPE_TRUST AND anchorScore < ANCHOR_TRUST_M
 *       LOW  = shapeScore >= SHAPE_FALLBACK OR anchorScore >= ANCHOR_FALLBACK_M
 *       MED  = everything in between (single MED/LOW boundary — Claude's
 *              discretion D-05: the FALLBACK thresholds double as the MED/LOW
 *              cut so there is exactly one intermediate band).
 *     A missing sub-score (null) is treated as "does not pass" for HIGH and
 *     "does not hard-fail" for LOW, so a post with only one available signal can
 *     still land in MED rather than being forced to UNRESOLVABLE.
 *
 * Output is TIER LABELS ONLY (HIGH/MED/LOW/UNRESOLVABLE) — never a numeric
 * percentage field (D-07). The raw `shapeFidelity` / `anchorGap` sub-score
 * objects are carried through for diagnostics only.
 *
 * @param {{ medianRelError: number|null, p95RelError: number|null,
 *           edgeCount: number, perEdge: Array<{from:number,to:number,relError:number}> }} shape
 *   Output of `computeResiduals`.
 * @param {{ meanGapM: number|null, p95GapM: number|null,
 *           perPost: Array<{ postNumber: number, gapM: number }> }} anchor
 *   Output of `computeAnchorGap`.
 * @param {{ allPostNumbers?: Iterable<number> }} [thresholds] Optional caller
 *   hints. Numeric thresholds live as named constants per D-05; the only
 *   honoured field today is `allPostNumbers` — the full post universe. Any post
 *   listed there that has neither an incident edge nor an anchor entry is
 *   reported as UNRESOLVABLE (fail-loud: a post the route declares but the gate
 *   cannot score is flagged, never silently omitted — RESEARCH Pattern 3,
 *   "0 paired coord → UNRESOLVABLE").
 * @returns {{
 *   gateDecision: "trust"|"fallback"|"fail",
 *   shapeFidelity: object,
 *   anchorGap: object,
 *   postTiers: Array<{ postNumber: number, tier: "HIGH"|"MED"|"LOW"|"UNRESOLVABLE" }>
 * }}
 */
export function applyResidualGate(shape, anchor, thresholds = {}) {
  const median = shape?.medianRelError;
  const p95Gap = anchor?.p95GapM;

  const shapePasses = median != null && median < SHAPE_TRUST;
  const anchorPasses = p95Gap != null && p95Gap < ANCHOR_TRUST_M;
  const shapeFails = median != null && median >= SHAPE_FALLBACK;
  const anchorFails = p95Gap != null && p95Gap >= ANCHOR_FAIL_M;

  const gateDecision = (shapePasses && anchorPasses)
    ? "trust"
    : (shapeFails || anchorFails)
      ? "fail"
      : "fallback";

  // Per-post incident-edge index: a post is incident on an edge as EITHER endpoint.
  const incidentRel = new Map();   // postNumber → max incident relError
  for (const e of shape?.perEdge ?? []) {
    for (const n of [e.from, e.to]) {
      const prev = incidentRel.get(n);
      if (prev == null || e.relError > prev) incidentRel.set(n, e.relError);
    }
  }
  // Per-post anchor index.
  const anchorByPost = new Map();
  for (const p of anchor?.perPost ?? []) anchorByPost.set(p.postNumber, p.gapM);

  const allPosts = new Set([
    ...incidentRel.keys(),
    ...anchorByPost.keys(),
    ...(thresholds.allPostNumbers ?? []),   // declared-but-unscored posts → UNRESOLVABLE
  ]);
  const postTiers = [];
  for (const postNumber of allPosts) {
    const hasEdge = incidentRel.has(postNumber);
    const hasAnchor = anchorByPost.has(postNumber);
    let tier;
    if (!hasEdge && !hasAnchor) {
      tier = "UNRESOLVABLE";
    } else {
      const shapeScore = hasEdge ? incidentRel.get(postNumber) : null;
      const anchorScore = hasAnchor ? anchorByPost.get(postNumber) : null;
      const high = (shapeScore != null && shapeScore < SHAPE_TRUST)
        && (anchorScore != null && anchorScore < ANCHOR_TRUST_M);
      const low = (shapeScore != null && shapeScore >= SHAPE_FALLBACK)
        || (anchorScore != null && anchorScore >= ANCHOR_FALLBACK_M);
      tier = high ? "HIGH" : low ? "LOW" : "MED";
    }
    postTiers.push({ postNumber, tier });
  }
  postTiers.sort((a, b) => a.postNumber - b.postNumber);

  return { gateDecision, shapeFidelity: shape, anchorGap: anchor, postTiers };
}
