import { latLonToUtm, utmToLatLon } from "./parser/geo/utm-calibrator.js";

const p1 = { lat: -27.64196661, lon: -48.66306017 };
const p2 = { lat: -27.64191762, lon: -48.66283923 };  // current projected
const p3 = { lat: -27.64183691, lon: -48.66247521 };
const ref2 = { lat: -27.64189640868478, lon: -48.66274618461442 };

const u1 = latLonToUtm(p1.lat, p1.lon);
const u2 = latLonToUtm(p2.lat, p2.lon);
const u3 = latLonToUtm(p3.lat, p3.lon);
const refU = latLonToUtm(ref2.lat, ref2.lon);

console.log(`current post 2 UTM: (${u2.easting.toFixed(2)}, ${u2.northing.toFixed(2)}) err=${Math.hypot(u2.easting - refU.easting, u2.northing - refU.northing).toFixed(2)}m`);
console.log(`projected post 1: (${u1.easting.toFixed(2)}, ${u1.northing.toFixed(2)}) — ref=(730565.50, 6940275.50)`);
console.log(`projected post 3: (${u3.easting.toFixed(2)}, ${u3.northing.toFixed(2)}) — ref=(730621.37, 6940288.99)`);
console.log(`ref post 2: (${refU.easting.toFixed(2)}, ${refU.northing.toFixed(2)})`);

// What's the optimal interpolation between projected p1 and p3 to land at ref2?
// p1 + t*(p3 - p1) = ref2
// t_e = (refU.e - u1.e) / (u3.e - u1.e); t_n = (refU.n - u1.n) / (u3.n - u1.n)
const t_e = (refU.easting - u1.easting) / (u3.easting - u1.easting);
const t_n = (refU.northing - u1.northing) / (u3.northing - u1.northing);
console.log(`optimal t (E): ${t_e.toFixed(3)}, optimal t (N): ${t_n.toFixed(3)}`);

// Try different t values
for (const t of [0.378, 0.418, 0.5, 0.555]) {
  const e = u1.easting + t * (u3.easting - u1.easting);
  const n = u1.northing + t * (u3.northing - u1.northing);
  const err = Math.hypot(e - refU.easting, n - refU.northing);
  console.log(`  t=${t}: → UTM (${e.toFixed(2)}, ${n.toFixed(2)}) err=${err.toFixed(2)}m`);
}
