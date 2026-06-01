import { latLonToUtm } from "../geo/utm-calibrator.js";

/**
 * UTM bounding box around route GPS with margin (meters).
 * @param {Array<{ lat?: number|null, lon?: number|null }>} routePosts
 * @param {number} zone
 * @param {number} marginM
 */
export function routeUtmBbox(routePosts, zone, marginM = 200) {
  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  let n = 0;

  for (const p of routePosts ?? []) {
    if (p?.lat == null || p?.lon == null) continue;
    const u = latLonToUtm(p.lat, p.lon, zone);
    minE = Math.min(minE, u.easting);
    maxE = Math.max(maxE, u.easting);
    minN = Math.min(minN, u.northing);
    maxN = Math.max(maxN, u.northing);
    n++;
  }

  if (!n) return null;

  return {
    minE: minE - marginM,
    maxE: maxE + marginM,
    minN: minN - marginM,
    maxN: maxN + marginM,
  };
}

function pointInBbox(x, y, b) {
  return x >= b.minE && x <= b.maxE && y >= b.minN && y <= b.maxN;
}

/**
 * Keep only DWG posts and cable edges inside a UTM bbox (route-sized subset).
 */
export function cropRegionToBbox(region, bbox) {
  if (!bbox) return region;

  const posts = (region?.posts ?? []).filter((p) =>
    pointInBbox(p.x, p.y, bbox),
  );

  const edgeIn = (e) => {
    const a = e?.a;
    const b = e?.b;
    if (!a || !b) return false;
    return (
      pointInBbox(a.x, a.y, bbox) &&
      pointInBbox(b.x, b.y, bbox)
    );
  };

  const cableEdges = (region?.cableEdges ?? []).filter(edgeIn);
  const primaryCableEdges = (region?.primaryCableEdges ?? []).filter(edgeIn);

  return {
    ...region,
    posts,
    cableEdges,
    primaryCableEdges,
    bboxUtm: bbox,
  };
}
