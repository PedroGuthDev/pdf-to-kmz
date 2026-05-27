import RBush from "rbush";
import { latLonToUtm, utmToLatLon } from "../geo/utm-calibrator.js";

export const DEFAULT_TOLERANCE_M = 15;
export const GAP_TOLERANCE_M = 25;
export const ADJACENCY_SNAP_M = 3;

class PostIndex extends RBush {
  toBBox(post) {
    return { minX: post.x, minY: post.y, maxX: post.x, maxY: post.y };
  }
  compareMinX(a, b) {
    return a.x - b.x;
  }
  compareMinY(a, b) {
    return a.y - b.y;
  }
}

export function buildPostIndex(posts) {
  const tree = new PostIndex();
  if (!Array.isArray(posts) || posts.length === 0) return tree;
  return tree.load(posts);
}

function nearestPostIndexWithin(posts, x, y, tol) {
  let bestIdx = -1;
  let bestD = Infinity;
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= tol && d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function buildAdjacencyGraph(posts, cableEdges) {
  const adjacency = new Map();
  if (!Array.isArray(posts) || posts.length === 0) return adjacency;

  const ensure = (idx) => {
    let s = adjacency.get(idx);
    if (!s) {
      s = new Set();
      adjacency.set(idx, s);
    }
    return s;
  };

  for (const e of cableEdges ?? []) {
    const a = e?.a;
    const b = e?.b;
    if (!a || !b) continue;
    if (typeof a.x !== "number" || typeof a.y !== "number") continue;
    if (typeof b.x !== "number" || typeof b.y !== "number") continue;

    const iA = nearestPostIndexWithin(posts, a.x, a.y, ADJACENCY_SNAP_M);
    const iB = nearestPostIndexWithin(posts, b.x, b.y, ADJACENCY_SNAP_M);
    if (iA < 0 || iB < 0 || iA === iB) continue;
    ensure(iA).add(iB);
    ensure(iB).add(iA);
  }

  return adjacency;
}

function pdfBearingDeg(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Convention used by coordinate-calculator.js: atan2(dx, dy) so 0° = north (+y).
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

function buildDistanceMap(distances) {
  const m = new Map();
  for (const d of distances ?? []) {
    if (!d) continue;
    if (typeof d.from !== "number" || typeof d.to !== "number") continue;
    if (typeof d.meters !== "number") continue;
    m.set(`${d.from}->${d.to}`, d.meters);
  }
  return m;
}

function buildOutgoingConnections(connections) {
  const out = new Map();
  for (const c of connections ?? []) {
    if (!c) continue;
    const from = c.from;
    const to = c.to;
    if (typeof from !== "number" || typeof to !== "number") continue;
    if (!out.has(from)) out.set(from, []);
    out.get(from).push({
      from,
      to,
      gap: Boolean(c.gap),
      cross_page: Boolean(c.cross_page),
    });
  }
  for (const [k, arr] of out.entries()) {
    arr.sort((a, b) => a.to - b.to);
    out.set(k, arr);
  }
  return out;
}

function buildPostByNumber(posts) {
  const m = new Map();
  for (const p of posts ?? []) {
    if (p && typeof p.number === "number") m.set(p.number, p);
  }
  return m;
}

function closestCandidate(candidates, predE, predN, fromIdx, adjacencyGraph, postToIndex) {
  let best = null;
  let bestScore = Infinity;
  let bestRawDist = Infinity;

  const neighbours = fromIdx != null ? adjacencyGraph?.get(fromIdx) : null;

  for (const c of candidates) {
    const rawDist = Math.hypot(c.x - predE, c.y - predN);
    const cIdx = postToIndex.get(c);
    const isNeighbour = neighbours && cIdx != null ? neighbours.has(cIdx) : false;
    const score = isNeighbour ? rawDist * 0.5 : rawDist;
    if (score < bestScore) {
      best = c;
      bestScore = score;
      bestRawDist = rawDist;
    }
  }

  return { best, bestRawDist };
}

export function pairPostsAgainstRegion({
  posts,
  distances,
  connections,
  startLat,
  startLon,
  region,
  postIndex,
  adjacencyGraph,
  warnings,
}) {
  const warn = (w) => {
    if (Array.isArray(warnings)) warnings.push(w);
  };

  if (!Array.isArray(posts) || posts.length === 0) {
    return { ok: true, coords: [] };
  }

  const zoneExpected = region?.crs?.zone ?? 22;
  const anchorUtm = latLonToUtm(startLat, startLon);
  if (anchorUtm.zone !== zoneExpected) {
    warn({ kind: "dwg-zone-mismatch", expected: zoneExpected, got: anchorUtm.zone });
    return { ok: false, failedAt: posts[0].number, nearestDistance: null };
  }

  const regionPosts = region?.posts ?? [];
  const tree = postIndex ?? buildPostIndex(regionPosts);

  const anchorCandidates = tree.search({
    minX: anchorUtm.easting - DEFAULT_TOLERANCE_M,
    minY: anchorUtm.northing - DEFAULT_TOLERANCE_M,
    maxX: anchorUtm.easting + DEFAULT_TOLERANCE_M,
    maxY: anchorUtm.northing + DEFAULT_TOLERANCE_M,
  });

  if (!anchorCandidates.length) {
    warn({
      kind: "dwg-pair-fail",
      at_post: posts[0].number,
      predicted: { lat: startLat, lon: startLon },
      nearest_dwg_distance_m: null,
      tolerance_m: DEFAULT_TOLERANCE_M,
    });
    return { ok: false, failedAt: posts[0].number, nearestDistance: null };
  }

  let anchorBest = null;
  let anchorDist = Infinity;
  for (const c of anchorCandidates) {
    const d = Math.hypot(c.x - anchorUtm.easting, c.y - anchorUtm.northing);
    if (d < anchorDist) {
      anchorDist = d;
      anchorBest = c;
    }
  }

  if (!anchorBest || anchorDist > DEFAULT_TOLERANCE_M) {
    warn({
      kind: "dwg-pair-fail",
      at_post: posts[0].number,
      predicted: { lat: startLat, lon: startLon },
      nearest_dwg_distance_m: Number.isFinite(anchorDist) ? anchorDist : null,
      tolerance_m: DEFAULT_TOLERANCE_M,
    });
    return { ok: false, failedAt: posts[0].number, nearestDistance: Number.isFinite(anchorDist) ? anchorDist : null };
  }

  const postToIndex = new Map();
  for (let i = 0; i < regionPosts.length; i++) postToIndex.set(regionPosts[i], i);
  const claimed = new Set();

  const dwgByPostNumber = new Map();
  dwgByPostNumber.set(posts[0].number, anchorBest);
  const anchorIdx = postToIndex.get(anchorBest);
  if (anchorIdx != null) claimed.add(anchorIdx);

  const postByNumber = buildPostByNumber(posts);
  const distMap = buildDistanceMap(distances);
  const outgoing = buildOutgoingConnections(connections);

  const visitEdge = (edge) => {
    const fromNum = edge.from;
    const toNum = edge.to;
    const fromPdf = postByNumber.get(fromNum);
    const toPdf = postByNumber.get(toNum);
    if (!fromPdf || !toPdf) return true; // ignore edges we can't evaluate

    const meters =
      distMap.get(`${fromNum}->${toNum}`) ?? distMap.get(`${toNum}->${fromNum}`);
    if (meters == null || !(meters > 0)) {
      warn({ kind: "dwg-missing-distance", from: fromNum, to: toNum });
      return true; // can't predict; don't fail strict pairing on missing label
    }

    const fromDwg = dwgByPostNumber.get(fromNum);
    if (!fromDwg) return true;

    const bearingDeg = pdfBearingDeg(fromPdf, toPdf);
    const bearingRad = (bearingDeg * Math.PI) / 180;
    const dE = meters * Math.sin(bearingRad);
    const dN = meters * Math.cos(bearingRad);
    const predE = fromDwg.x + dE;
    const predN = fromDwg.y + dN;

    const tol = edge.gap ? GAP_TOLERANCE_M : DEFAULT_TOLERANCE_M;
    const candidates = tree.search({
      minX: predE - tol,
      minY: predN - tol,
      maxX: predE + tol,
      maxY: predN + tol,
    });

    if (!candidates.length) {
      warn({
        kind: "dwg-pair-fail",
        at_post: toNum,
        predicted: { easting: predE, northing: predN },
        nearest_dwg_distance_m: null,
        tolerance_m: tol,
      });
      return { ok: false, failedAt: toNum, nearestDistance: null };
    }

    const fromIdx = postToIndex.get(fromDwg);
    const { best, bestRawDist } = closestCandidate(
      candidates,
      predE,
      predN,
      fromIdx,
      adjacencyGraph,
      postToIndex,
    );

    if (!best || bestRawDist > tol) {
      warn({
        kind: "dwg-pair-fail",
        at_post: toNum,
        predicted: { easting: predE, northing: predN },
        nearest_dwg_distance_m: Number.isFinite(bestRawDist) ? bestRawDist : null,
        tolerance_m: tol,
      });
      return { ok: false, failedAt: toNum, nearestDistance: Number.isFinite(bestRawDist) ? bestRawDist : null };
    }

    const bestIdx = postToIndex.get(best);
    if (bestIdx != null && claimed.has(bestIdx)) {
      warn({ kind: "dwg-pair-collision", at_post: toNum });
      return { ok: false, failedAt: toNum, nearestDistance: 0 };
    }

    dwgByPostNumber.set(toNum, best);
    if (bestIdx != null) claimed.add(bestIdx);
    return true;
  };

  const visitedEdges = new Set();
  const walkFrom = (fromNum) => {
    const edges = outgoing.get(fromNum) ?? [];
    for (const e of edges) {
      const key = `${e.from}->${e.to}`;
      if (visitedEdges.has(key)) continue;
      visitedEdges.add(key);

      const res = visitEdge(e);
      if (res && typeof res === "object" && res.ok === false) return res;
      if (res === false) return { ok: false, failedAt: e.to, nearestDistance: null };

      const sub = walkFrom(e.to);
      if (sub && sub.ok === false) return sub;
    }
    return null;
  };

  const startNum = posts[0].number;
  const walkRes = walkFrom(startNum);
  if (walkRes && walkRes.ok === false) return walkRes;

  // Ensure all posts referenced in the PDF input are paired. (Strict pairing: all-or-nothing.)
  for (const p of posts) {
    if (!dwgByPostNumber.has(p.number)) {
      warn({ kind: "dwg-pair-fail", at_post: p.number, predicted: null, nearest_dwg_distance_m: null, tolerance_m: DEFAULT_TOLERANCE_M });
      return { ok: false, failedAt: p.number, nearestDistance: null };
    }
  }

  const coords = posts.map((p) => {
    const dwg = dwgByPostNumber.get(p.number);
    const { lat, lon } = utmToLatLon(dwg.x, dwg.y, zoneExpected);
    return { postNumber: p.number, lat, lon, source: "dwg", dwg_block: dwg.block };
  });

  return { ok: true, coords };
}

