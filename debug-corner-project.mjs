import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const sf = 0.354610;
const origin_e = 730468.812;
const origin_n = 6940433.057;
const ref2 = latLonToUtm(-27.64189640868478, -48.66274618461442);

// Without refit
const x = 326.2, y = 397.3;
const e = origin_e + x * sf;
const n = origin_n - y * sf;
const err = Math.hypot(e - ref2.easting, n - ref2.northing);
console.log(`post 2 corner @ (${x}, ${y}) → UTM (${e.toFixed(2)}, ${n.toFixed(2)}) err=${err.toFixed(2)}m`);

// With refit (scale=0.348182, theta=-3.25°, origin recomputed so post 1 is exact)
const sf_refit = 0.348182;
const theta = -3.25 * Math.PI / 180;
const refU1 = latLonToUtm(-27.641966601540403, -48.66305968585957);
// Use the standard transform: e = origin_e + sf*(x*cos(t) + y*sin(t))? But what's actually used?
// Let me check the code:

// From debug-after-refit earlier:
// origin_e = refU1.easting - sf_refit * (Math.cos(theta) * p1.x + Math.sin(theta) * p1.y)
// origin_n = refU1.northing - sf_refit * (Math.sin(theta) * p1.x - Math.cos(theta) * p1.y)
// and: e = origin_e + sf_refit * (cos(theta)*x + sin(theta)*y); n = origin_n + sf_refit * (sin(theta)*x - cos(theta)*y)

const p1 = { x: 272.66, y: 444.30 };
const origin_e2 = refU1.easting - sf_refit * (Math.cos(theta) * p1.x + Math.sin(theta) * p1.y);
const origin_n2 = refU1.northing - sf_refit * (Math.sin(theta) * p1.x - Math.cos(theta) * p1.y);
const e2 = origin_e2 + sf_refit * (Math.cos(theta) * x + Math.sin(theta) * y);
const n2 = origin_n2 + sf_refit * (Math.sin(theta) * x - Math.cos(theta) * y);
const err2 = Math.hypot(e2 - ref2.easting, n2 - ref2.northing);
console.log(`with refit: → UTM (${e2.toFixed(2)}, ${n2.toFixed(2)}) err=${err2.toFixed(2)}m`);

// And what about post 1 corner? Using corner (268.4, 414.1) instead of label centroid (272.66, 444.30):
const p1_corner = { x: 268.4, y: 414.1 };
const e_p1_corner = origin_e + p1_corner.x * sf;
const n_p1_corner = origin_n - p1_corner.y * sf;
console.log(`post 1 corner: ref UTM = (${refU1.easting.toFixed(2)}, ${refU1.northing.toFixed(2)}); corner projects to (${e_p1_corner.toFixed(2)}, ${n_p1_corner.toFixed(2)}) err=${Math.hypot(e_p1_corner - refU1.easting, n_p1_corner - refU1.northing).toFixed(2)}m`);
