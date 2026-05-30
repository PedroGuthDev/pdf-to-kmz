import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const sf = 0.348182;
const theta = -3.25 * Math.PI / 180;
const refU1 = latLonToUtm(-27.641966601540403, -48.66305968585957);
const p1 = { x: 272.66, y: 444.30 };
const origin_e = refU1.easting - sf * (Math.cos(theta) * p1.x + Math.sin(theta) * p1.y);
const origin_n = refU1.northing - sf * (Math.sin(theta) * p1.x - Math.cos(theta) * p1.y);

// Project post 2 corner (326.2, 397.3)
const x = 326.2, y = 397.3;
const e = origin_e + sf * (Math.cos(theta) * x + Math.sin(theta) * y);
const n = origin_n + sf * (Math.sin(theta) * x - Math.cos(theta) * y);
const refU2 = latLonToUtm(-27.64189640868478, -48.66274618461442);
console.log(`post 2 cable corner (326.2, 397.3) → UTM (${e.toFixed(2)}, ${n.toFixed(2)}) err=${Math.hypot(e - refU2.easting, n - refU2.northing).toFixed(2)}m`);

// What about the midpoint of corners 1 and 3?
// post 1 corner: (268.4, 414.1)
// post 3 corner: (427.9, 366.0)
// Mid: (348.15, 390.05)
const mx = (268.4 + 427.9) / 2;
const my = (414.1 + 366.0) / 2;
console.log(`midpoint of corners 1,3 = (${mx}, ${my})`);
const e_mid = origin_e + sf * (Math.cos(theta) * mx + Math.sin(theta) * my);
const n_mid = origin_n + sf * (Math.sin(theta) * mx - Math.cos(theta) * my);
console.log(`mid-corner → UTM (${e_mid.toFixed(2)}, ${n_mid.toFixed(2)}) err=${Math.hypot(e_mid - refU2.easting, n_mid - refU2.northing).toFixed(2)}m`);

// And current PDF mid-position (342.38, 428.82) without snap
const x_cur = 342.38, y_cur = 428.82;
const e_cur = origin_e + sf * (Math.cos(theta) * x_cur + Math.sin(theta) * y_cur);
const n_cur = origin_n + sf * (Math.sin(theta) * x_cur - Math.cos(theta) * y_cur);
console.log(`current PDF (342.38, 428.82) → UTM (${e_cur.toFixed(2)}, ${n_cur.toFixed(2)}) err=${Math.hypot(e_cur - refU2.easting, n_cur - refU2.northing).toFixed(2)}m`);
