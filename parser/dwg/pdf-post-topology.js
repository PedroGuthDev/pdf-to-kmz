import { latLonToUtm } from "../geo/utm-calibrator.js";
import { buildCableTopologyMaps } from "./cable-topology.js";

/**
 * Match numbered PDF posts (with GPS) to anonymous DWG region posts by nearest UTM
 * distance, then lift region cable-topology neighbors onto PDF post numbers.
 *
 * Generic — no post-number literals in the matching logic. Used to gate PDF-path
 * bifurcation detectors the same way as applyTopologyBranchArmRehome on DWG.
 *
 * @param {Array<{ number: number, lat?: number|null, lon?: number|null }>} pdfPosts
 * @param {{ posts: Array<{ x: number, y: number }>, cableEdges: Array }} regionData
 * @param {{ zone?: number, matchMaxM?: number }} [opts]
 * @returns {Map<number, Set<number>>|null}
 */
export function buildTopologyNeighborsByPdfPostNumber(
  pdfPosts,
  regionData,
  opts = {},
) {
  const zone = opts.zone ?? 22;
  const matchMaxM = opts.matchMaxM ?? 25;

  const regionPosts = regionData?.posts ?? [];
  const cableEdges = [
    ...(regionData?.cableEdges ?? []),
    ...(regionData?.primaryCableEdges ?? []),
  ];
  if (!regionPosts.length || !cableEdges.length) return null;

  const withGps = (pdfPosts ?? []).filter(
    (p) => p?.number != null && p.lat != null && p.lon != null,
  );
  if (withGps.length < 3) return null;

  const regionNumbered = regionPosts.map((rp, idx) => ({
    number: idx,
    lat: rp.y,
    lon: rp.x,
  }));

  const { neighborsByPost: regionNeighbors } = buildCableTopologyMaps(
    regionNumbered,
    cableEdges,
    { zone, coordsAreUtm: true },
  );
  if (!regionNeighbors?.size) return null;

  /** @type {Map<number, { e: number, n: number }>} */
  const pdfUtm = new Map();
  for (const p of withGps) {
    const u = latLonToUtm(p.lat, p.lon, zone);
    pdfUtm.set(p.number, { e: u.easting, n: u.northing });
  }

  /** @type {Map<number, number>} pdfNum -> regionIdx */
  const pdfToRegion = new Map();
  /** @type {Set<number>} */
  const usedRegion = new Set();

  const sortedPdf = [...withGps].sort((a, b) => a.number - b.number);
  for (const p of sortedPdf) {
    const u = pdfUtm.get(p.number);
    let bestIdx = -1;
    let bestD = Infinity;
    for (let ri = 0; ri < regionPosts.length; ri++) {
      if (usedRegion.has(ri)) continue;
      const rp = regionPosts[ri];
      const d = Math.hypot(u.e - rp.x, u.n - rp.y);
      if (d < bestD) {
        bestD = d;
        bestIdx = ri;
      }
    }
    if (bestIdx < 0 || bestD > matchMaxM) continue;
    usedRegion.add(bestIdx);
    pdfToRegion.set(p.number, bestIdx);
  }

  if (pdfToRegion.size < 3) return null;

  /** @type {Map<number, number>} regionIdx -> pdfNum */
  const regionToPdf = new Map();
  for (const [pdfNum, ri] of pdfToRegion) regionToPdf.set(ri, pdfNum);

  /** @type {Map<number, Set<number>>} */
  const neighborsByPost = new Map();
  for (const [pdfNum, ri] of pdfToRegion) {
    const regionN = regionNeighbors.get(ri);
    if (!regionN?.size) continue;
    const mapped = new Set();
    for (const rNb of regionN) {
      const pn = regionToPdf.get(rNb);
      if (pn != null && pn !== pdfNum) mapped.add(pn);
    }
    if (mapped.size) neighborsByPost.set(pdfNum, mapped);
  }

  return neighborsByPost.size ? neighborsByPost : null;
}
