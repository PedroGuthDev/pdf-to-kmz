import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

// With anchor refit (sf=0.348182, theta=-3.25°)
const sf = 0.348182;
const theta = -3.25 * Math.PI / 180;
const refU1 = latLonToUtm(-27.641966601540403, -48.66305968585957);
const p1 = { x: 272.66, y: 444.30 };
const origin_e = refU1.easting - sf * (Math.cos(theta) * p1.x + Math.sin(theta) * p1.y);
const origin_n = refU1.northing - sf * (Math.sin(theta) * p1.x - Math.cos(theta) * p1.y);

function proj(x, y) {
  const e = origin_e + sf * (Math.cos(theta) * x + Math.sin(theta) * y);
  const n = origin_n + sf * (Math.sin(theta) * x - Math.cos(theta) * y);
  return { e, n };
}

const refU12 = latLonToUtm(-27.64127382659538, -48.66056201106366);

// Current PDF post 12: (986.18, 179.34)
const cur = proj(986.18, 179.34);
console.log(`Current PDF (986.18, 179.34) → UTM (${cur.e.toFixed(2)}, ${cur.n.toFixed(2)}) err=${Math.hypot(cur.e - refU12.easting, cur.n - refU12.northing).toFixed(2)}m`);

// Snap to fraction 0.338 (current snap) along 11-13:
const p11 = { x: 939.5, y: 189.3 };
const p13 = { x: 1048.1, y: 160.86 };
const snap1 = { x: p11.x + 0.338 * (p13.x - p11.x), y: p11.y + 0.338 * (p13.y - p11.y) };
const snap1p = proj(snap1.x, snap1.y);
console.log(`Snap to current frac 0.338 (PDF ${snap1.x.toFixed(2)}, ${snap1.y.toFixed(2)}) → err=${Math.hypot(snap1p.e - refU12.easting, snap1p.n - refU12.northing).toFixed(2)}m`);

// Snap to corrected fraction 10.9/(10.9+27.6) = 0.283:
const snap2 = { x: p11.x + 0.283 * (p13.x - p11.x), y: p11.y + 0.283 * (p13.y - p11.y) };
const snap2p = proj(snap2.x, snap2.y);
console.log(`Snap to corrected frac 0.283 (PDF ${snap2.x.toFixed(2)}, ${snap2.y.toFixed(2)}) → err=${Math.hypot(snap2p.e - refU12.easting, snap2p.n - refU12.northing).toFixed(2)}m`);

// What's the ideal PDF position?
const a = (refU12.easting - origin_e) / sf;
const b = (refU12.northing - origin_n) / sf;
const cos = Math.cos(theta), sin = Math.sin(theta);
const ix = a * cos + b * sin;
const iy = a * sin - b * cos;
console.log(`Ideal PDF for post 12: (${ix.toFixed(2)}, ${iy.toFixed(2)})`);
