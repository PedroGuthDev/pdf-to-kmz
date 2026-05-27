// Check which symbol gives lowest GPS error for post 2 by trial
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const sf = 0.354610;
const origin_e = 730468.812;
const origin_n = 6940433.057;
const refLatLon = { lat: -27.64189640868478, lon: -48.66274618461442 };
const refUtm = latLonToUtm(refLatLon.lat, refLatLon.lon);

// Symbols near post 2 area
const candidates = [
  { x: 342.38, y: 428.82, name: "CURRENT (anchor)" },
  { x: 330.14, y: 403.68, name: "alt 1" },
  { x: 352.46, y: 457.26, name: "alt 2 (south)" },
  { x: 390.50, y: 424.50, name: "alt 3" },
  { x: 268.80, y: 421.50, name: "alt 4 (west)" },
  { x: 359.04, y: 419.29, name: "label-walk 31.89m from p1" },
];

console.log(`Reference post 2 UTM: (${refUtm.easting.toFixed(2)}, ${refUtm.northing.toFixed(2)})`);
console.log("");
for (const c of candidates) {
  const e = origin_e + c.x * sf;
  const n = origin_n - c.y * sf;
  const err = Math.hypot(e - refUtm.easting, n - refUtm.northing);
  console.log(`  ${c.name}: (${c.x.toFixed(2)}, ${c.y.toFixed(2)}) → UTM (${e.toFixed(2)}, ${n.toFixed(2)}) err=${err.toFixed(2)}m`);
}
