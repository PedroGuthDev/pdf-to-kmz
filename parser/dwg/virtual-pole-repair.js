/**
 * Virtual-pole repair for accepted global solves (Bibi Ferreira class).
 *
 * A projected route may attach to a NEW pole that does not exist in the DXF
 * utility base (on the drawing it is only a bend in the Cabo Projetado
 * polyline). The Hungarian/Viterbi solver must place every post on an existing
 * DXF node, so it shoehorns the printed-span chain onto wrong poles around the
 * missing one (Bibi: post 4's pole is absent → post 3 jumped across the street
 * to a spurious pole and post 4 stole post 3's pole; spans 12.5/6.6 m solved as
 * 8.0/11.5 m).
 *
 * This pass runs AFTER an accepted solve and only where the solve is grossly
 * inconsistent with the printed labels (both rel + abs misfit). The repair is
 * geometry-driven and route-agnostic:
 *
 *   1. find maximal runs of consecutive bad route edges, bounded by posts whose
 *      other edge fits (those boundary poles are trusted and stay fixed);
 *   2. read the projected-cable polyline between the boundary posts from the
 *      PDF; interior bend points (kinks) are pole attachments by construction;
 *   3. transfer kinks into the DXF frame with the LOCAL offset measured at the
 *      boundary posts (solved pole − raw PDF projection), immune to the global
 *      PDF deformation;
 *   4. match kinks to interior posts by printed-label arc length; a matched
 *      post is placed on a real DXF pole if one sits at the kink, otherwise on
 *      the kink itself (virtual pole, dwg_block "virtual-pole");
 *   5. remaining interior posts are re-assigned by enumerating nearby DXF
 *      poles against the printed-span chain;
 *   6. the new assignment is applied only when it removes most of the misfit
 *      (cost < IMPROVE_RATIO × old) — label noise without a better pole is
 *      left untouched.
 *
 * Pure module: never mutates its inputs; returns fresh coords when changed.
 */

import { latLonToUtm, utmToLatLon, utmFromPdfPoint } from "../geo/utm-calibrator.js";
import { buildCablesByPage } from "../cable-builder.js";

const BAD_EDGE_REL = 0.25; // rel misfit above this marks a route edge bad…
const BAD_EDGE_ABS_M = 3; // …when the absolute misfit also clears this
const MIN_OLD_COST_M = 2; // don't churn on near-clean windows
const IMPROVE_RATIO = 0.6; // new cost must drop below 60% of old
const MAX_INTERIOR = 3; // enumeration guard
const MAX_CANDS_PER_POST = 10;
const CANDIDATE_RADIUS_M = 25;
const POLE_NEAR_KINK_M = 5; // real pole this close to a kink competes with virtual
const KINK_MIN_ANGLE_DEG = 20; // bend below this is a straight-run artifact
const KINK_DEDUPE_UNITS = 2.0; // stroke-outline twin-vertex merge (page units)
const KINK_ARC_MATCH_M = 4; // |cable arc − printed cum| for kink→post match
const SAME_NODE_M = 0.5; // two posts may not share a pole

const VPR_DEBUG =
  typeof process !== "undefined" && process?.env?.VPR_DEBUG === "1";
const dbg = (...a) => {
  if (VPR_DEBUG) console.error("[vpr]", ...a);
};

const INVENTED_EDGE_W = 0.5; // heuristic refills score at half weight

function edgeCost(spanM, printedEntry) {
  if (!printedEntry) return 0;
  const tol = Math.max(0.5, 0.05 * printedEntry.m);
  const c = Math.max(0, Math.abs(spanM - printedEntry.m) - tol);
  return printedEntry.invented ? INVENTED_EDGE_W * c : c;
}

/**
 * Printed meters for consecutive route pairs only (a chain view). Invented
 * sources (jumpback-refill etc.) keep their value — the chain needs every
 * span — but are flagged: they never mark an edge bad, never anchor a
 * trilateration, and score at half weight.
 */
function buildChainPrinted(distances, inventedSources) {
  const printed = new Map();
  for (const d of distances ?? []) {
    if (!(d?.meters > 0)) continue;
    if (Math.abs(d.from - d.to) !== 1) continue;
    const lo = Math.min(d.from, d.to);
    const invented = inventedSources?.has(d.source) ?? false;
    const prev = printed.get(lo);
    if (!prev || (prev.invented && !invented)) {
      printed.set(lo, { m: d.meters, invented });
    }
  }
  return printed; // key = lower post number of the (n, n+1) edge
}

/** Post numbers appearing in any TRUSTED non-consecutive edge (branch arms). */
function buildBranchPostSet(distances, inventedSources) {
  const out = new Set();
  for (const d of distances ?? []) {
    if (!(d?.meters > 0)) continue;
    if (inventedSources?.has(d.source)) continue;
    if (Math.abs(d.from - d.to) > 1) {
      out.add(d.from);
      out.add(d.to);
    }
  }
  return out;
}

/**
 * Clean per-page polylines from Cabo Projetado ops. The parser emits the thick
 * stroke as overlapping vertex triplets (M a, L b, L c, Z, M b, L c, L d, …);
 * appending points farther than KINK_DEDUPE_M (in meters) from the last few
 * recovers the underlying polyline.
 */
function extractPolylines(ops) {
  const dedupeUnits = KINK_DEDUPE_UNITS;
  const polylines = [];
  let poly = [];
  const flush = () => {
    if (poly.length >= 2) polylines.push(poly);
    poly = [];
  };
  const push = (p) => {
    for (let k = Math.max(0, poly.length - 3); k < poly.length; k++) {
      if (Math.hypot(poly[k].x - p.x, poly[k].y - p.y) < dedupeUnits) return;
    }
    poly.push({ x: p.x, y: p.y });
  };
  for (const op of ops ?? []) {
    if (op.type === "M") {
      // Stroke triangles restart at the previous vertex — treat M as a
      // continuation when it lands on an already-collected point.
      if (poly.length === 0) push(op);
      else {
        const near = poly
          .slice(-3)
          .some((q) => Math.hypot(q.x - op.x, q.y - op.y) < dedupeUnits);
        if (!near) {
          flush();
          push(op);
        }
      }
    } else if (op.type === "L") {
      push(op);
    }
    // Z: stroke-triangle close — not a polyline break.
  }
  flush();
  return polylines;
}

/**
 * Two-circle intersection: position a virtual pole at printed distances r1/r2
 * from its solved neighbors, on the side nearest the kink estimate `est`.
 * Degenerate configurations fall back to the a→b line (the leftover misfit
 * then surfaces in the edge costs).
 */
function trilaterate(a, r1, b, r2, est) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return { x: a.x + r1, y: a.y };
  if (d >= r1 + r2 || d <= Math.abs(r1 - r2)) {
    const t = d >= r1 + r2 ? r1 / (r1 + r2) : r1 / d;
    return { x: a.x + t * dx, y: a.y + t * dy };
  }
  const along = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - along * along));
  const ux = dx / d;
  const uy = dy / d;
  const fx = a.x + along * ux;
  const fy = a.y + along * uy;
  const p1 = { x: fx - h * uy, y: fy + h * ux };
  const p2 = { x: fx + h * uy, y: fy - h * ux };
  const d1 = Math.hypot(p1.x - est.x, p1.y - est.y);
  const d2 = Math.hypot(p2.x - est.x, p2.y - est.y);
  return d1 <= d2 ? p1 : p2;
}

function projectOntoPolyline(poly, px, py) {
  let best = null;
  let arcBase = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const segLen = Math.sqrt(len2);
    let t = len2 > 0 ? ((px - a.x) * vx + (py - a.y) * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = a.x + t * vx;
    const qy = a.y + t * vy;
    const d = Math.hypot(px - qx, py - qy);
    if (!best || d < best.d) {
      best = { d, arc: arcBase + t * segLen, x: qx, y: qy };
    }
    arcBase += segLen;
  }
  return best;
}

function polylineKinks(poly) {
  const kinks = [];
  let arc = 0;
  for (let i = 1; i + 1 < poly.length; i++) {
    arc += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
    const ax = poly[i].x - poly[i - 1].x;
    const ay = poly[i].y - poly[i - 1].y;
    const bx = poly[i + 1].x - poly[i].x;
    const by = poly[i + 1].y - poly[i].y;
    const na = Math.hypot(ax, ay);
    const nb = Math.hypot(bx, by);
    if (na === 0 || nb === 0) continue;
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (na * nb)));
    const angleDeg = (Math.acos(cos) * 180) / Math.PI;
    if (angleDeg >= KINK_MIN_ANGLE_DEG) {
      kinks.push({ x: poly[i].x, y: poly[i].y, arc, angleDeg });
    }
  }
  return kinks;
}

/**
 * @param {{
 *   coords: Array<{ postNumber: number, lat: number, lon: number, source?: string, dwg_block?: string }>,
 *   distances: Array<{ from: number, to: number, meters: number|null, source?: string }>,
 *   routePosts: Array<{ number: number, x: number, y: number, pageNum?: number }>,
 *   pageTransforms?: Map<number, object>,
 *   cablePaths?: Array<{ pageNum?: number, ops?: Array }>,
 *   postIndex?: { search: (box: object) => Array<{ x: number, y: number, block?: string }> },
 *   zone?: number,
 *   warnings?: Array,
 * }} params
 * @returns {{ coords: Array, changed: boolean }}
 */
export function repairMissingPoles({
  coords,
  distances,
  inventedSources,
  routePosts,
  pageTransforms,
  cablePaths,
  postIndex,
  zone = 22,
  warnings,
}) {
  const noop = { coords, changed: false };
  if (!Array.isArray(coords) || coords.length < 4) return noop;
  if (!pageTransforms?.size || !Array.isArray(cablePaths) || !postIndex) return noop;

  const printed = buildChainPrinted(distances, inventedSources);
  if (printed.size === 0) return noop;
  const branchPosts = buildBranchPostSet(distances, inventedSources);

  const utmByPost = new Map();
  for (const c of coords) {
    if (c?.lat == null || c?.lon == null) continue;
    const u = latLonToUtm(c.lat, c.lon);
    utmByPost.set(c.postNumber, { x: u.easting, y: u.northing });
  }
  const pdfPostByNum = new Map();
  for (const p of routePosts ?? []) {
    if (p?.number != null && p.x != null && p.y != null) pdfPostByNum.set(p.number, p);
  }

  const numbers = coords
    .map((c) => c.postNumber)
    .filter((n) => utmByPost.has(n))
    .sort((a, b) => a - b);

  // ── 1. bad consecutive edges (trusted labels only) ───────────────────────
  const badLo = new Set();
  for (const n of numbers) {
    const p = printed.get(n);
    if (p == null || p.invented) continue;
    if (!utmByPost.has(n) || !utmByPost.has(n + 1)) continue;
    const a = utmByPost.get(n);
    const b = utmByPost.get(n + 1);
    const span = Math.hypot(a.x - b.x, a.y - b.y);
    const miss = Math.abs(span - p.m);
    if (miss / p.m > BAD_EDGE_REL && miss > BAD_EDGE_ABS_M) badLo.add(n);
  }
  if (badLo.size === 0) return noop;

  const isBadIncident = (n) => badLo.has(n) || badLo.has(n - 1);

  // maximal runs of consecutive bad edges
  const los = [...badLo].sort((a, b) => a - b);
  const runs = [];
  for (const lo of los) {
    const last = runs[runs.length - 1];
    if (last && lo === last.hi) last.hi = lo + 1;
    else runs.push({ lo, hi: lo + 1 });
  }

  const cablesByPage = buildCablesByPage(cablePaths);
  let outCoords = coords;
  let changed = false;

  for (const run of runs) {
    // boundary = nearest post on each side with no bad incident edge
    let bl = run.lo;
    while (isBadIncident(bl) && bl > numbers[0]) bl--;
    let br = run.hi;
    while (isBadIncident(br) && br < numbers[numbers.length - 1]) br++;
    dbg("run", run, "bl", bl, "br", br);
    if (isBadIncident(bl) || isBadIncident(br)) {
      dbg("bail: run touches route end");
      continue;
    }
    const interior = [];
    for (let n = bl + 1; n < br; n++) interior.push(n);
    if (interior.length === 0 || interior.length > MAX_INTERIOR) {
      dbg("bail: interior size", interior.length);
      continue;
    }
    if (interior.some((n) => branchPosts.has(n))) {
      dbg("bail: branch post in interior", interior);
      continue;
    }
    if (![bl, br, ...interior].every((n) => utmByPost.has(n) && pdfPostByNum.get(n))) {
      dbg("bail: missing utm/pdf post");
      continue;
    }

    // v1: single-page windows only (kinks live on one sheet)
    const pageNum = pdfPostByNum.get(interior[0]).pageNum ?? 1;
    if (![bl, br, ...interior].every((n) => (pdfPostByNum.get(n).pageNum ?? 1) === pageNum)) {
      dbg("bail: multi-page window");
      continue;
    }
    const transform = pageTransforms.get(pageNum);
    const paths = cablesByPage.get(pageNum);
    if (!transform || !paths?.length) {
      dbg("bail: no transform/paths for page", pageNum);
      continue;
    }
    const metersPerUnit = Math.abs(transform.x_scale_sf ?? 0);
    if (!(metersPerUnit > 0)) continue;

    // ── 2. cable polyline + window kinks (page units) ───────────────────────
    const blPdf = pdfPostByNum.get(bl);
    const brPdf = pdfPostByNum.get(br);
    let bestPoly = null;
    let blHit = null;
    let brHit = null;
    for (const ops of paths) {
      for (const poly of extractPolylines(ops)) {
        const ha = projectOntoPolyline(poly, blPdf.x, blPdf.y);
        const hb = projectOntoPolyline(poly, brPdf.x, brPdf.y);
        if (!ha || !hb) continue;
        const score = ha.d + hb.d;
        if (!bestPoly || score < blHit.d + brHit.d) {
          bestPoly = poly;
          blHit = ha;
          brHit = hb;
        }
      }
    }
    if (!bestPoly) {
      dbg("bail: no polyline");
      continue;
    }
    dbg("poly pts", bestPoly.length, "blHit", blHit, "brHit", brHit);
    // both boundary posts must actually sit near this cable (≤ 60 page units)
    if (blHit.d > 60 || brHit.d > 60) {
      dbg("bail: boundary far from cable");
      continue;
    }
    const arcLo = Math.min(blHit.arc, brHit.arc);
    const arcHi = Math.max(blHit.arc, brHit.arc);
    const forward = brHit.arc >= blHit.arc;
    const windowKinks = polylineKinks(bestPoly).filter(
      (k) => k.arc > arcLo + 1 && k.arc < arcHi - 1,
    );

    // ── 3. local PDF→DXF offset from the trusted boundary poles ─────────────
    // Reference = the boundary posts' CABLE PROJECTIONS, not their anchors:
    // anchors are numbered circles drawn meters away from the pole, while the
    // cable attaches at the pole — and its constant lateral drawing offset
    // cancels between the boundary projections and the kink.
    const offsets = [
      { hit: blHit, n: bl },
      { hit: brHit, n: br },
    ].map(({ hit, n }) => {
      const raw = utmFromPdfPoint(hit.x, hit.y, transform);
      const solved = utmByPost.get(n);
      return { dx: solved.x - raw.easting, dy: solved.y - raw.northing };
    });
    const off = {
      dx: (offsets[0].dx + offsets[1].dx) / 2,
      dy: (offsets[0].dy + offsets[1].dy) / 2,
    };
    // boundary offsets must agree — disagreement means the boundaries are not
    // a rigid local frame and the kink transfer would be unreliable
    dbg("kinks", windowKinks, "offsets", offsets);
    // The offset is only an ESTIMATE (each boundary term carries junk from the
    // post circle's slide along the cable and the pole-to-cable drawing gap).
    // It is used for kink matching, snap search and trilateration side-picking
    // — never as the final position — so the agreement gate is a loose sanity
    // check, not a precision requirement.
    if (Math.hypot(offsets[0].dx - offsets[1].dx, offsets[0].dy - offsets[1].dy) > 12) {
      dbg("bail: offset disagreement");
      continue;
    }
    const kinkToUtm = (k) => {
      const u = utmFromPdfPoint(k.x, k.y, transform);
      return { x: u.easting + off.dx, y: u.northing + off.dy };
    };

    // ── 4. printed cumulative arcs from boundaryL, kink→post matching ───────
    const cums = new Map();
    let acc = 0;
    let ok = true;
    for (let n = bl; n < br; n++) {
      const p = printed.get(n);
      if (p == null) {
        ok = false;
        break;
      }
      acc += p.m;
      cums.set(n + 1, acc);
    }
    if (!ok) {
      dbg("bail: chain gap (missing printed span)");
      continue;
    }
    const totalPrinted = acc;

    const arcFromBl = (k) => (forward ? k.arc - blHit.arc : blHit.arc - k.arc);
    const kinkAssign = new Map(); // post → kink
    let ambiguous = false;
    for (const k of windowKinks) {
      const aM = arcFromBl(k) * metersPerUnit;
      let bestPost = null;
      let bestDiff = Infinity;
      let secondDiff = Infinity;
      for (const n of interior) {
        const diff = Math.abs(cums.get(n) - aM);
        if (diff < bestDiff) {
          secondDiff = bestDiff;
          bestDiff = diff;
          bestPost = n;
        } else if (diff < secondDiff) {
          secondDiff = diff;
        }
      }
      if (bestPost == null || bestDiff > KINK_ARC_MATCH_M) continue;
      if (secondDiff < bestDiff * 2 + 2) {
        ambiguous = true;
        break;
      }
      if (kinkAssign.has(bestPost)) {
        ambiguous = true;
        break;
      }
      kinkAssign.set(bestPost, k);
    }
    if (ambiguous) {
      dbg("bail: ambiguous kink match");
      continue;
    }
    dbg("kinkAssign", [...kinkAssign.keys()], "cums", [...cums]);

    // ── 5. candidates per interior post ──────────────────────────────────────
    const blUtm = utmByPost.get(bl);
    const brUtm = utmByPost.get(br);
    const usedOutside = [];
    for (const [n, u] of utmByPost) {
      if (n < bl || n > br) usedOutside.push(u);
    }
    const tooClose = (pos, others) =>
      others.some((o) => Math.hypot(o.x - pos.x, o.y - pos.y) < SAME_NODE_M);

    const candidatesByPost = new Map();
    for (const n of interior) {
      const kink = kinkAssign.get(n);
      if (kink) {
        // Offer nearby real poles ALONGSIDE the virtual placeholder and let the
        // printed-span scoring decide. The placeholder carries the kink
        // estimate; its final position is trilaterated from its neighbors.
        const ku = kinkToUtm(kink);
        const cands = postIndex
          .search({
            minX: ku.x - POLE_NEAR_KINK_M,
            minY: ku.y - POLE_NEAR_KINK_M,
            maxX: ku.x + POLE_NEAR_KINK_M,
            maxY: ku.y + POLE_NEAR_KINK_M,
          })
          .filter((p) => Math.hypot(p.x - ku.x, p.y - ku.y) <= POLE_NEAR_KINK_M)
          .filter((p) => !tooClose(p, usedOutside))
          .map((p) => ({ x: p.x, y: p.y, block: p.block }));
        cands.push({ x: ku.x, y: ku.y, virtual: true });
        candidatesByPost.set(n, cands);
        continue;
      }
      // chain-interpolated position along boundaryL → kinks → boundaryR
      const stations = [
        { m: 0, x: blUtm.x, y: blUtm.y },
        ...[...kinkAssign.entries()]
          .map(([kn, k]) => {
            const ku = kinkToUtm(k);
            return { m: cums.get(kn), x: ku.x, y: ku.y };
          })
          .sort((a, b) => a.m - b.m),
        { m: totalPrinted, x: brUtm.x, y: brUtm.y },
      ];
      const target = cums.get(n);
      let guess = { x: brUtm.x, y: brUtm.y };
      for (let i = 0; i + 1 < stations.length; i++) {
        if (target >= stations[i].m && target <= stations[i + 1].m) {
          const span = stations[i + 1].m - stations[i].m;
          const t = span > 0 ? (target - stations[i].m) / span : 0;
          guess = {
            x: stations[i].x + t * (stations[i + 1].x - stations[i].x),
            y: stations[i].y + t * (stations[i + 1].y - stations[i].y),
          };
          break;
        }
      }
      const raw = postIndex.search({
        minX: guess.x - CANDIDATE_RADIUS_M,
        minY: guess.y - CANDIDATE_RADIUS_M,
        maxX: guess.x + CANDIDATE_RADIUS_M,
        maxY: guess.y + CANDIDATE_RADIUS_M,
      });
      const cands = raw
        .map((p) => ({
          x: p.x,
          y: p.y,
          block: p.block,
          d: Math.hypot(p.x - guess.x, p.y - guess.y),
        }))
        .filter((p) => !tooClose(p, usedOutside))
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_CANDS_PER_POST);
      const cur = utmByPost.get(n);
      if (!cands.some((p) => Math.hypot(p.x - cur.x, p.y - cur.y) < SAME_NODE_M)) {
        cands.push({ x: cur.x, y: cur.y, keep: true });
      }
      if (cands.length === 0) {
        ok = false;
        break;
      }
      candidatesByPost.set(n, cands);
    }
    if (!ok) continue;

    // ── 6. enumerate, score, accept on strong improvement ───────────────────
    const windowEdges = [];
    for (let n = bl; n < br; n++) windowEdges.push(n);
    // Virtual placeholders get their true position lazily: trilaterated from
    // both neighbors' chosen positions + printed spans (adjacent virtuals are
    // unresolvable → reject the combo).
    const resolveVirtuals = (posByNum) => {
      const out = new Map(posByNum);
      for (const [n, p] of posByNum) {
        if (!p?.virtual) continue;
        const a = posByNum.get(n - 1);
        const b = posByNum.get(n + 1);
        const r1 = printed.get(n - 1);
        const r2 = printed.get(n);
        // Trilateration anchors must be TRUSTED labels — a heuristic refill
        // must never decide where a virtual pole lands.
        if (!a || !b || a.virtual || b.virtual) return null;
        if (r1 == null || r2 == null || r1.invented || r2.invented) return null;
        out.set(n, { ...trilaterate(a, r1.m, b, r2.m, p), virtual: true });
      }
      return out;
    };
    const costOf = (posByNum) => {
      const resolved = resolveVirtuals(posByNum);
      if (!resolved) return Infinity;
      let sum = 0;
      for (const lo of windowEdges) {
        const a = resolved.get(lo);
        const b = resolved.get(lo + 1);
        sum += edgeCost(Math.hypot(a.x - b.x, a.y - b.y), printed.get(lo));
      }
      return sum;
    };
    const currentPos = new Map(
      [bl, ...interior, br].map((n) => [n, utmByPost.get(n)]),
    );
    const oldCost = costOf(currentPos);
    if (oldCost < MIN_OLD_COST_M) {
      dbg("bail: oldCost too small", oldCost);
      continue;
    }

    let best = null;
    const choice = new Map([[bl, blUtm], [br, brUtm]]);
    const recurse = (idx) => {
      if (idx === interior.length) {
        const cost = costOf(choice);
        if (!best || cost < best.cost) {
          best = { cost, picks: new Map(interior.map((n) => [n, choice.get(n)])) };
        }
        return;
      }
      const n = interior[idx];
      for (const cand of candidatesByPost.get(n)) {
        const chosen = [...choice.values()];
        if (!cand.virtual && tooClose(cand, chosen)) continue;
        choice.set(n, cand);
        recurse(idx + 1);
        choice.delete(n);
      }
    };
    recurse(0);

    dbg("oldCost", oldCost, "best", best?.cost, "picks", best && [...best.picks]);
    if (!best || best.cost >= IMPROVE_RATIO * oldCost) {
      dbg("bail: improvement bar");
      continue;
    }

    // apply (placeholders resolved to their trilaterated positions)
    const finalPos = resolveVirtuals(
      new Map([[bl, blUtm], ...best.picks, [br, brUtm]]),
    );
    if (!finalPos) continue;
    if (outCoords === coords) outCoords = coords.map((c) => ({ ...c }));
    for (const n of interior) {
      const pick = finalPos.get(n);
      if (!pick) continue;
      const idx = outCoords.findIndex((c) => c.postNumber === n);
      if (idx < 0) continue;
      const { lat, lon } = utmToLatLon(pick.x, pick.y, zone);
      outCoords[idx] = {
        ...outCoords[idx],
        lat,
        lon,
        dwg_block: pick.virtual ? "virtual-pole" : pick.block,
      };
      utmByPost.set(n, { x: pick.x, y: pick.y });
    }
    changed = true;
    warnings?.push({
      kind: "dwg-virtual-pole-repair",
      posts: interior,
      virtual_posts: interior.filter((n) => best.picks.get(n)?.virtual),
      cost_before_m: Number(oldCost.toFixed(1)),
      cost_after_m: Number(best.cost.toFixed(1)),
    });
  }

  return { coords: outCoords, changed };
}
