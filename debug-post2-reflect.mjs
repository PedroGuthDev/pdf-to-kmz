// Check the route-corridor reflection effect on post 2
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const sf = 0.354610;
const origin_e = 730468.812;
const origin_n = 6940433.057;

// Posts 1, 2, 3 PDF and refs
const p1 = { x: 272.66, y: 444.30 };
const p2 = { x: 342.38, y: 428.82 };
const p3 = { x: 436.82, y: 396.78 };
// after auxiliary-post-pdf snap: post 2 → fraction 0.378 along 1-3
const frac = 0.378;
const p2_snap = {
  x: p1.x + frac * (p3.x - p1.x),
  y: p1.y + frac * (p3.y - p1.y),
};
console.log(`post 2 after auxiliary-pdf snap: (${p2_snap.x.toFixed(2)}, ${p2_snap.y.toFixed(2)})`);

// Project to UTM
const p2_proj_e = origin_e + p2_snap.x * sf;
const p2_proj_n = origin_n - p2_snap.y * sf;

// Reference
const refUtm = latLonToUtm(-27.64189640868478, -48.66274618461442);
console.log(`projected: (${p2_proj_e.toFixed(2)}, ${p2_proj_n.toFixed(2)}) ref: (${refUtm.easting.toFixed(2)}, ${refUtm.northing.toFixed(2)})`);

const errPre = Math.hypot(p2_proj_e - refUtm.easting, p2_proj_n - refUtm.northing);
console.log(`pre-reflection err: ${errPre.toFixed(2)}m`);

// Reflect across 1-3 chord
// p1, p3 in UTM:
const p1u = { e: origin_e + p1.x * sf, n: origin_n - p1.y * sf };
const p3u = { e: origin_e + p3.x * sf, n: origin_n - p3.y * sf };
console.log(`p1u: (${p1u.e.toFixed(2)}, ${p1u.n.toFixed(2)})`);
console.log(`p3u: (${p3u.e.toFixed(2)}, ${p3u.n.toFixed(2)})`);

// Chord direction
const dx = p3u.e - p1u.e, dy = p3u.n - p1u.n;
const len = Math.hypot(dx, dy);
const ux = dx / len, uy = dy / len;
// Perp from p1 to projected p2
const proj_t = (p2_proj_e - p1u.e) * ux + (p2_proj_n - p1u.n) * uy;
const perp = (p2_proj_e - p1u.e) * (-uy) + (p2_proj_n - p1u.n) * ux;
console.log(`projected p2 along chord: t=${proj_t.toFixed(2)}m perp=${perp.toFixed(2)}m`);
// Where is ref p2 along chord?
const ref_t = (refUtm.easting - p1u.e) * ux + (refUtm.northing - p1u.n) * uy;
const ref_perp = (refUtm.easting - p1u.e) * (-uy) + (refUtm.northing - p1u.n) * ux;
console.log(`ref p2 along chord:        t=${ref_t.toFixed(2)}m perp=${ref_perp.toFixed(2)}m`);

// Reflect projected across the chord:
const refl_e = p2_proj_e - 2 * perp * (-uy);
const refl_n = p2_proj_n - 2 * perp * (ux);
console.log(`reflected: (${refl_e.toFixed(2)}, ${refl_n.toFixed(2)}) err vs ref: ${Math.hypot(refl_e - refUtm.easting, refl_n - refUtm.northing).toFixed(2)}m`);

// What's PDF post 2 perp side?
const pdf2_e = origin_e + p2.x * sf;
const pdf2_n = origin_n - p2.y * sf;
const pdf2_perp = (pdf2_e - p1u.e) * (-uy) + (pdf2_n - p1u.n) * ux;
console.log(`raw PDF post 2 perp (pre-snap): ${pdf2_perp.toFixed(2)}m`);

