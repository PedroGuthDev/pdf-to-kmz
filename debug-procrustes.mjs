import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

// Free-origin Procrustes on page 3 posts 1-14
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

// Procrustes: find s, theta, tx, ty minimizing sum((s*R*[x,-y] + [tx,ty] - [e,n])²)
// Note: PDF y goes down, UTM north goes up. We use (x, -y).
const N = refs.length;
let pxSum = 0, pySum = 0, eSum = 0, nSum = 0;
for (const r of refs) {
  pxSum += r.x;
  pySum += -r.y; // flip y
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
// scale * R: best s*[c -s; s c] such that for each point [px, py], s*R*[px;py] = [de; dn]
// Minimize Sum |s*R*p - d|^2 => s*cos = (Sxe + Syn) / Spp, s*sin = (Sxn - Sye) / Spp
const A = (Sxe + Syn) / Spp;
const B = (Sxn - Sye) / Spp;
const s = Math.hypot(A, B);
const theta = Math.atan2(B, A);
const tx = eBar - s * (Math.cos(theta) * pxBar - Math.sin(theta) * pyBar);
const ty = nBar - s * (Math.sin(theta) * pxBar + Math.cos(theta) * pyBar);
console.log(`Procrustes: s=${s.toFixed(6)} theta=${(theta * 180/Math.PI).toFixed(3)}° tx=${tx.toFixed(2)} ty=${ty.toFixed(2)}`);

// Compute residuals
let maxErr = 0;
let rmse = 0;
for (const r of refs) {
  const px = r.x;
  const py = -r.y;
  const e = s * (Math.cos(theta) * px - Math.sin(theta) * py) + tx;
  const n = s * (Math.sin(theta) * px + Math.cos(theta) * py) + ty;
  const err = Math.hypot(e - r.e, n - r.n);
  rmse += err * err;
  maxErr = Math.max(maxErr, err);
  console.log(`  post ${r.num}: err=${err.toFixed(2)}m`);
}
rmse = Math.sqrt(rmse / N);
console.log(`\nMax: ${maxErr.toFixed(2)}m, RMSE: ${rmse.toFixed(2)}m`);

// Now pin post 1
console.log("\n=== Anchored at post 1 ===");
// post 1 at PDF (272.66, -444.30) must map to UTM (e1, n1)
// We solve: pin scale & theta from optimization, then compute origin so post 1 is exact.
// Free-anchor Procrustes minimizes over all params except origin; we just shift.
const p1 = refs[0];
const px1 = p1.x;
const py1 = -p1.y;
const e1_proj = s * (Math.cos(theta) * px1 - Math.sin(theta) * py1) + tx;
const n1_proj = s * (Math.sin(theta) * px1 + Math.cos(theta) * py1) + ty;
const tx2 = tx + (p1.e - e1_proj);
const ty2 = ty + (p1.n - n1_proj);
let maxErr2 = 0;
let rmse2 = 0;
for (const r of refs) {
  const px = r.x;
  const py = -r.y;
  const e = s * (Math.cos(theta) * px - Math.sin(theta) * py) + tx2;
  const n = s * (Math.sin(theta) * px + Math.cos(theta) * py) + ty2;
  const err = Math.hypot(e - r.e, n - r.n);
  rmse2 += err * err;
  maxErr2 = Math.max(maxErr2, err);
  console.log(`  post ${r.num}: err=${err.toFixed(2)}m`);
}
rmse2 = Math.sqrt(rmse2 / N);
console.log(`\nAnchored max: ${maxErr2.toFixed(2)}m, RMSE: ${rmse2.toFixed(2)}m`);
