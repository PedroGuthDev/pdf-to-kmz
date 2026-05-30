// What if the snap uses PDF-chord-fraction instead of label-fraction?
// For post 2: PDF chord frac 0.418 would land at (341.28, 424.44) — close to current (342.38, 428.82) anyway
// Effectively no snap. So PDF-frac snap would do nothing useful.

// Instead, can we use a DIFFERENT signal to bias post 2?
// Looking at the page-3 transform: scale=0.348182, theta=-3.25° after refit.
// The page transform is already optimized using all 14 posts (refineAnchorPageByDownstreamChord).
// Post 2 is at PDF chord position consistent with where the LABEL puts it.
// To improve post 2 GPS, we'd need to move its PDF position EAST.

// What is the relationship between current PDF post 2 and the ideal (ref-projected)?
// Current PDF: (342.38, 428.82)
// Ideal PDF: (360.33, 424.02)  [for sf=0.354610, theta=0]
// But with anchor refit (sf=0.348182, theta=-3.25°), the ideal PDF changes:
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const sf = 0.348182;
const theta = -3.25 * Math.PI / 180;
const refU1 = latLonToUtm(-27.641966601540403, -48.66305968585957);
const refU2 = latLonToUtm(-27.64189640868478, -48.66274618461442);
const p1 = { x: 272.66, y: 444.30 };
const origin_e = refU1.easting - sf * (Math.cos(theta) * p1.x + Math.sin(theta) * p1.y);
const origin_n = refU1.northing - sf * (Math.sin(theta) * p1.x - Math.cos(theta) * p1.y);

// Inverse: given (refU2.easting, refU2.northing), find x, y
// e = origin_e + sf*(cos*x + sin*y)
// n = origin_n + sf*(sin*x - cos*y)
// So: (e - origin_e) / sf = cos*x + sin*y
//     (n - origin_n) / sf = sin*x - cos*y
// Matrix [cos, sin; sin, -cos] * [x; y] = [(e-origin_e)/sf; (n-origin_n)/sf]
// Inverse of [cos, sin; sin, -cos] is [cos, sin; sin, -cos] / det, det = -cos² - sin² = -1
// So inverse = [-cos, -sin; -sin, cos]
const a = (refU2.easting - origin_e) / sf;
const b = (refU2.northing - origin_n) / sf;
const cos = Math.cos(theta), sin = Math.sin(theta);
// Solve: cos*x + sin*y = a; sin*x - cos*y = b
// x = (a*cos + b*sin); y = (a*sin - b*cos)
const x = a * cos + b * sin;
const y = a * sin - b * cos;
console.log(`Post 2 ideal PDF (with refit): (${x.toFixed(2)}, ${y.toFixed(2)})`);

// Current PDF position projects to:
const e_cur = origin_e + sf * (cos * 342.38 + sin * 428.82);
const n_cur = origin_n + sf * (sin * 342.38 - cos * 428.82);
console.log(`Current PDF (342.38, 428.82) projects to (${e_cur.toFixed(2)}, ${n_cur.toFixed(2)}) — ref (${refU2.easting.toFixed(2)}, ${refU2.northing.toFixed(2)})`);
console.log(`Err: ${Math.hypot(e_cur - refU2.easting, n_cur - refU2.northing).toFixed(2)}m`);
