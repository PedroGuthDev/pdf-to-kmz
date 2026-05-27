import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const sf = 0.354610;
const origin_e = 730468.812;
const origin_n = 6940433.057;

const refs = [
  { num: 1, lat: -27.641966601540403, lon: -48.66305968585957, x: 272.66, y: 444.30 },
  { num: 2, lat: -27.64189640868478, lon: -48.66274618461442, x: 342.38, y: 428.82 },
  { num: 3, lat: -27.641835371382406, lon: -48.66249641713888, x: 436.82, y: 396.78 },
];

for (const r of refs) {
  const u = latLonToUtm(r.lat, r.lon);
  const proj_e = origin_e + r.x * sf;
  const proj_n = origin_n - r.y * sf;
  const de = proj_e - u.easting;
  const dn = proj_n - u.northing;
  console.log(`post ${r.num}: proj UTM (${proj_e.toFixed(2)}, ${proj_n.toFixed(2)}) ref UTM (${u.easting.toFixed(2)}, ${u.northing.toFixed(2)}) Δ(${de.toFixed(2)}, ${dn.toFixed(2)}) mag=${Math.hypot(de, dn).toFixed(2)}m`);
}

// UTM-grid chord from ref 1 to ref 3
const u1 = latLonToUtm(refs[0].lat, refs[0].lon);
const u2 = latLonToUtm(refs[1].lat, refs[1].lon);
const u3 = latLonToUtm(refs[2].lat, refs[2].lon);
console.log(`\nUTM 1->2: dE=${(u2.easting - u1.easting).toFixed(2)} dN=${(u2.northing - u1.northing).toFixed(2)} bearing=${(Math.atan2(u2.easting - u1.easting, u2.northing - u1.northing) * 180 / Math.PI).toFixed(2)}° dist=${Math.hypot(u2.easting - u1.easting, u2.northing - u1.northing).toFixed(2)}m`);
console.log(`UTM 2->3: dE=${(u3.easting - u2.easting).toFixed(2)} dN=${(u3.northing - u2.northing).toFixed(2)} bearing=${(Math.atan2(u3.easting - u2.easting, u3.northing - u2.northing) * 180 / Math.PI).toFixed(2)}° dist=${Math.hypot(u3.easting - u2.easting, u3.northing - u2.northing).toFixed(2)}m`);
console.log(`UTM 1->3: dE=${(u3.easting - u1.easting).toFixed(2)} dN=${(u3.northing - u1.northing).toFixed(2)} bearing=${(Math.atan2(u3.easting - u1.easting, u3.northing - u1.northing) * 180 / Math.PI).toFixed(2)}° dist=${Math.hypot(u3.easting - u1.easting, u3.northing - u1.northing).toFixed(2)}m`);

// PDF 1->2 with theta=0 (y flipped):
const dx12 = refs[1].x - refs[0].x;
const dy12 = refs[1].y - refs[0].y;
console.log(`\nPDF 1->2: dx=${dx12.toFixed(2)} dy=${dy12.toFixed(2)} (scaled UTM dE=${(dx12 * sf).toFixed(2)} dN=${(-dy12 * sf).toFixed(2)}) PDF-bearing(dx,-dy)=${(Math.atan2(dx12, -dy12) * 180 / Math.PI).toFixed(2)}° dist=${(Math.hypot(dx12, dy12) * sf).toFixed(2)}m`);
const dx23 = refs[2].x - refs[1].x;
const dy23 = refs[2].y - refs[1].y;
console.log(`PDF 2->3: dx=${dx23.toFixed(2)} dy=${dy23.toFixed(2)} (scaled UTM dE=${(dx23 * sf).toFixed(2)} dN=${(-dy23 * sf).toFixed(2)}) PDF-bearing(dx,-dy)=${(Math.atan2(dx23, -dy23) * 180 / Math.PI).toFixed(2)}° dist=${(Math.hypot(dx23, dy23) * sf).toFixed(2)}m`);
const dx13 = refs[2].x - refs[0].x;
const dy13 = refs[2].y - refs[0].y;
console.log(`PDF 1->3: dx=${dx13.toFixed(2)} dy=${dy13.toFixed(2)} (scaled UTM dE=${(dx13 * sf).toFixed(2)} dN=${(-dy13 * sf).toFixed(2)}) PDF-bearing(dx,-dy)=${(Math.atan2(dx13, -dy13) * 180 / Math.PI).toFixed(2)}° dist=${(Math.hypot(dx13, dy13) * sf).toFixed(2)}m`);
