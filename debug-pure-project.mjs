// What's post 2's err if we just use the page-3 transform (with anchor refit) directly?
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const sf = 0.348182;
const theta = -3.25 * Math.PI / 180;
const refU1 = latLonToUtm(-27.641966601540403, -48.66305968585957);
const p1 = { x: 272.66, y: 444.30 };
const origin_e = refU1.easting - sf * (Math.cos(theta) * p1.x + Math.sin(theta) * p1.y);
const origin_n = refU1.northing - sf * (Math.sin(theta) * p1.x - Math.cos(theta) * p1.y);

// Project post 2 at (342.38, 428.82)
const x = 342.38, y = 428.82;
const e = origin_e + sf * (Math.cos(theta) * x + Math.sin(theta) * y);
const n = origin_n + sf * (Math.sin(theta) * x - Math.cos(theta) * y);
const ref2 = latLonToUtm(-27.64189640868478, -48.66274618461442);
const err = Math.hypot(e - ref2.easting, n - ref2.northing);
console.log(`Pure projection (anchor refit): UTM (${e.toFixed(2)}, ${n.toFixed(2)}) err=${err.toFixed(2)}m`);

// Without anchor refit:
const sf2 = 0.354610;
const origin_e2 = 730468.812, origin_n2 = 6940433.057;
const e2 = origin_e2 + x * sf2;
const n2 = origin_n2 - y * sf2;
const err2 = Math.hypot(e2 - ref2.easting, n2 - ref2.northing);
console.log(`Pure projection (no refit, theta=0): UTM (${e2.toFixed(2)}, ${n2.toFixed(2)}) err=${err2.toFixed(2)}m`);
