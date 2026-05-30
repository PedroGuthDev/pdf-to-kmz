// Simulate what distortion-zone bias would do for post 2 with scale-corrected backward chain
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

// After anchor refit and the rest of pipeline. Use harness final lat/lon for post 2.
// Current err = 9.46m (we know post 2 is at... let me compute final lat/lon manually)
// Actually, we want the SAME-LIKE bias: walk backward from post 14 GPS by label distances, scale-corrected.

// Forward from post 1 walk:
const sfChain = 0.354610;
const p1Gps = { lat: -27.641966601540403, lon: -48.66305968585957 };
const p1U = latLonToUtm(p1Gps.lat, p1Gps.lon);
const p14Gps = { lat: -27.641104447026464, lon: -48.65993156346553 };
const p14U = latLonToUtm(p14Gps.lat, p14Gps.lon);

const labels = {
  '1->2': 22.7, '2->3': 37.4, '3->4': 38.9, '4->5': 13.35,
  '5->6': 25.2, '6->7': 28.5, '7->8': 34.8, '8->9': 34.0,
  '9->10': 17.8, '10->11': 14.1, '11->12': 10.9, '12->13': 27.6, '13->14': 36,
};
const posts = [
  { num: 1, x: 272.66, y: 444.30 },
  { num: 2, x: 342.38, y: 428.82 },
  { num: 3, x: 436.82, y: 396.78 },
  { num: 4, x: 500.42, y: 356.94 },
  { num: 5, x: 528.38, y: 321.90 },
  { num: 6, x: 597.38, y: 305.82 },
  { num: 7, x: 668.54, y: 261.54 },
  { num: 8, x: 752.54, y: 236.94 },
  { num: 9, x: 849.50, y: 214.98 },
  { num: 10, x: 883.10, y: 201.42 },
  { num: 11, x: 939.50, y: 189.30 },
  { num: 12, x: 986.18, y: 179.34 },
  { num: 13, x: 1048.10, y: 160.86 },
  { num: 14, x: 1139.66, y: 136.38 },
];
// Compute PDF chord lengths between consecutive posts
const refs = [
  { num: 1, lat: -27.641966601540403, lon: -48.66305968585957 },
  { num: 2, lat: -27.64189640868478, lon: -48.66274618461442 },
  { num: 3, lat: -27.641835371382406, lon: -48.66249641713888 },
];
const ref2U = latLonToUtm(refs[1].lat, refs[1].lon);

// Walk forward: at each step, walk by label_seg * (label_seg / pdf_chord)^0.68
// First, compute PDF chord scaled
function pdfChord(i) {
  const dx = posts[i+1].x - posts[i].x;
  const dy = posts[i+1].y - posts[i].y;
  return Math.hypot(dx, dy) * sfChain;
}
function pdfDir(i) {
  // PDF direction in UTM space (treating +y as south)
  const dx = posts[i+1].x - posts[i].x;
  const dy = posts[i+1].y - posts[i].y;
  const len = Math.hypot(dx, dy);
  return { ex: dx / len, en: -dy / len };
}

// Forward chain (with scale corr)
let e = p1U.easting, n = p1U.northing;
const fwd = new Map();
fwd.set(1, { e, n });
for (let i = 0; i < posts.length - 1; i++) {
  const lbl = labels[`${posts[i].num}->${posts[i+1].num}`];
  const chord = pdfChord(i);
  const dir = pdfDir(i);
  // scale-corrected walk: stepLen = lbl * (lbl/chord)^expWAIT(I think it's actually: lbl uses ratio)
  // From label-lsq-calibrator walkAnchorPageLabelChain: actually let me just step by chord (which is the scale*PDF chord).
  // For comparison: plain forward = step by lbl; scale-corr = step by lbl*(chord/lbl)^exp = chord^exp * lbl^(1-exp)?
  // Reading the code: "0" gets plain label walk; SEG_SCALE_CORR_EXP=0.68 hits the corrected version
  // The correction effectively biases between label-distance and chord-distance
  // I'll just do: step = lbl * (chord/lbl)^0.68 = chord^0.68 * lbl^0.32
  const exp = 0.68;
  const step = (chord > 0 && lbl > 0) ? Math.pow(chord, exp) * Math.pow(lbl, 1 - exp) : lbl;
  e += dir.ex * step;
  n += dir.en * step;
  fwd.set(posts[i+1].num, { e, n });
}

// Backward chain from post 14
e = p14U.easting; n = p14U.northing;
const back = new Map();
back.set(14, { e, n });
for (let i = posts.length - 2; i >= 0; i--) {
  const lbl = labels[`${posts[i].num}->${posts[i+1].num}`];
  const chord = pdfChord(i);
  const dir = pdfDir(i);
  const exp = 0.68;
  const step = (chord > 0 && lbl > 0) ? Math.pow(chord, exp) * Math.pow(lbl, 1 - exp) : lbl;
  e -= dir.ex * step;
  n -= dir.en * step;
  back.set(posts[i].num, { e, n });
}

console.log("Forward chain (scale-corr from post 1):");
for (const p of posts) {
  const f = fwd.get(p.num);
  const ref = latLonToUtm(p.num === 1 ? p1Gps.lat : (p.num === 2 ? refs[1].lat : (p.num === 14 ? p14Gps.lat : 0)), p.num === 1 ? p1Gps.lon : (p.num === 2 ? refs[1].lon : (p.num === 14 ? p14Gps.lon : 0)));
  if (ref.easting) console.log(`  post ${p.num}: fwd (${f.e.toFixed(2)}, ${f.n.toFixed(2)}) ref (${ref.easting.toFixed(2)}, ${ref.northing.toFixed(2)}) err=${Math.hypot(f.e - ref.easting, f.n - ref.northing).toFixed(2)}m`);
}

console.log("\nBackward chain (scale-corr from post 14):");
for (const p of posts) {
  const b = back.get(p.num);
  if (!b) continue;
  if (p.num === 2) console.log(`  post ${p.num}: back (${b.e.toFixed(2)}, ${b.n.toFixed(2)}) err=${Math.hypot(b.e - ref2U.easting, b.n - ref2U.northing).toFixed(2)}m`);
}
