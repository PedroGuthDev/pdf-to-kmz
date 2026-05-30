// Procrustes with cable-corner-based PDF positions instead of label-centroid PDF positions
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

// Cable corner positions for each post (from corners analysis)
// Post 1 corner = (268.4, 414.1)
// Post 2 corner = (326.2, 397.3)
// Post 3 corner = (427.9, 366.0)
// Post 4 corner = ? Currently nearest=(530.5, 327.8) but that's far. Let me use (530.5, 327.8) as a guess.
// Wait — looking at the long segments, the corners are at the endpoints between segments.
// Segment endpoints we have:
// (268.4, 414.1), (326.2, 397.3), (326.6, 398.4), (427.9, 366.0), (428.2, 367.1), (530.5, 327.8), (530.8, 328.9), (599.0, 311.9), (599.2, 313.1), (676.2, 289.8), (676.5, 290.9), (770.5, 263.6), (770.8, 264.7), (864.0, 243.4), (864.3, 244.4), (909.1, 218.4), (909.3, 219.6), (951.1, 219.5), (951.2, 220.7), (981.6, 215.6)
// The corners come in pairs (1pt apart) from the dashed-ribbon dual-edge.
// So unique corners:
// 268.4, 326.2, 427.9, 530.5, 599.0, 676.2, 770.5, 864.0, 909.1, 951.1, 981.6 — and beyond
// Pattern: each post i has one corner pair. Let me try:
// post 1 = corner 1 = (268.4, 414.1)
// post 2 = corner 2 = (326.2, 397.3)
// post 3 = corner 3 = (427.9, 366.0)
// post 4 = ??? - maybe between (530.5, 327.8) and the next? But post 4 is "N tem cabo" (aux)
// post 5 = (530.5, 327.8) — matches current PDF (528.4, 321.9) ← close!
// post 6 = (599.0, 311.9) — close to current (597.4, 305.8)
// post 7 = (676.2, 289.8) — current (668.5, 261.5) is 28pt off
// post 8 = (770.5, 263.6)
// post 9 = (864.0, 243.4)
// post 10 = ?
// post 11 = (909.1, 218.4)
// post 12 = (951.1, 219.5)
// post 13 = (981.6, 215.6) — current (1048, 161) is 84pt off — doesn't match
// post 14 = ?

// Hmm — there are 13 long-segment endpoints but 14 posts. Post 4 (auxiliary) might not have a corner.

// Let me just try a "label - 30pt north" correction first and see
const refs = [
  { num: 1, lat: -27.641966601540403, lon: -48.66305968585957, x: 272.66, y: 444.30 },
  { num: 2, lat: -27.64189640868478, lon: -48.66274618461442, x: 342.38, y: 428.82 },
  { num: 3, lat: -27.641835371382406, lon: -48.66249641713888, x: 436.82, y: 396.78 },
  { num: 4, lat: -27.641759074706567, lon: -48.66222253418295, x: 500.42, y: 356.94 },
  { num: 5, lat: -27.641675148301676, lon: -48.66218636096236, x: 528.38, y: 321.90 },
  { num: 6, lat: -27.641601903383663, lon: -48.661914200524336, x: 597.38, y: 305.82 },
  { num: 7, lat: -27.64153171029405, lon: -48.661650652774284, x: 668.54, y: 261.54 },
  { num: 8, lat: -27.641455413406426, lon: -48.661290643102646, x: 752.54, y: 236.94 },
  { num: 9, lat: -27.641418790876976, lon: -48.661149395264694, x: 849.50, y: 214.98 },
  { num: 10, lat: -27.641369960824633, lon: -48.66099092210781, x: 883.10, y: 201.42 },
  { num: 11, lat: -27.64134096797074, lon: -48.66080661093625, x: 939.50, y: 189.30 },
  { num: 12, lat: -27.64127382659538, lon: -48.66056201106366, x: 986.18, y: 179.34 },
  { num: 13, lat: -27.641203633295277, lon: -48.660295018244994, x: 1048.10, y: 160.86 },
  { num: 14, lat: -27.641104447026464, lon: -48.65993156346553, x: 1139.66, y: 136.38 },
];

// Compute UTM for refs
for (const r of refs) {
  const u = latLonToUtm(r.lat, r.lon);
  r.e = u.easting;
  r.n = u.northing;
}

// Procrustes function
function procrustes(refs) {
  const N = refs.length;
  let pxSum = 0, pySum = 0, eSum = 0, nSum = 0;
  for (const r of refs) {
    pxSum += r.x;
    pySum += -r.y;
    eSum += r.e;
    nSum += r.n;
  }
  const pxBar = pxSum / N, pyBar = pySum / N, eBar = eSum / N, nBar = nSum / N;
  let Sxe = 0, Sxn = 0, Sye = 0, Syn = 0, Spp = 0;
  for (const r of refs) {
    const px = r.x - pxBar;
    const py = -r.y - pyBar;
    const de = r.e - eBar;
    const dn = r.n - nBar;
    Sxe += px * de;
    Sxn += px * dn;
    Sye += py * de;
    Syn += py * dn;
    Spp += px * px + py * py;
  }
  const A = (Sxe + Syn) / Spp;
  const B = (Sxn - Sye) / Spp;
  const s = Math.hypot(A, B);
  const theta = Math.atan2(B, A);
  const tx = eBar - s * (Math.cos(theta) * pxBar - Math.sin(theta) * pyBar);
  const ty = nBar - s * (Math.sin(theta) * pxBar + Math.cos(theta) * pyBar);

  // Anchor at post 1
  const p1 = refs[0];
  const e1_proj = s * (Math.cos(theta) * p1.x - Math.sin(theta) * (-p1.y)) + tx;
  const n1_proj = s * (Math.sin(theta) * p1.x + Math.cos(theta) * (-p1.y)) + ty;
  const tx2 = tx + (p1.e - e1_proj);
  const ty2 = ty + (p1.n - n1_proj);

  let maxErr = 0;
  let rmse = 0;
  const errs = [];
  for (const r of refs) {
    const e = s * (Math.cos(theta) * r.x - Math.sin(theta) * (-r.y)) + tx2;
    const n = s * (Math.sin(theta) * r.x + Math.cos(theta) * (-r.y)) + ty2;
    const err = Math.hypot(e - r.e, n - r.n);
    rmse += err * err;
    maxErr = Math.max(maxErr, err);
    errs.push({ num: r.num, err });
  }
  rmse = Math.sqrt(rmse / N);
  return { s, theta, tx: tx2, ty: ty2, maxErr, rmse, errs };
}

const p = procrustes(refs);
console.log(`Original labels: scale=${p.s.toFixed(6)} θ=${(p.theta * 180/Math.PI).toFixed(2)}° max=${p.maxErr.toFixed(2)}m rmse=${p.rmse.toFixed(2)}m`);
console.log("per-post errs:", p.errs.map(e => `${e.num}:${e.err.toFixed(1)}`).join(' '));

// Now try shifting post 2 to (360.33, 424.02) — the ideal ref-position
const refs2 = refs.map(r => r.num === 2 ? { ...r, x: 360.33, y: 424.02 } : r);
const p2 = procrustes(refs2);
console.log(`\nWith post 2 at IDEAL: scale=${p2.s.toFixed(6)} θ=${(p2.theta * 180/Math.PI).toFixed(2)}° max=${p2.maxErr.toFixed(2)}m rmse=${p2.rmse.toFixed(2)}m`);
console.log("per-post errs:", p2.errs.map(e => `${e.num}:${e.err.toFixed(1)}`).join(' '));
