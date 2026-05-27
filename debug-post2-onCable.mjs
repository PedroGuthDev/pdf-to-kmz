// Where would post 2's REF position project to in PDF space?
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const sf = 0.354610;
const origin_e = 730468.812;
const origin_n = 6940433.057;
const refs = [
  { num: 1, lat: -27.641966601540403, lon: -48.66305968585957 },
  { num: 2, lat: -27.64189640868478, lon: -48.66274618461442 },
  { num: 3, lat: -27.641835371382406, lon: -48.66249641713888 },
  { num: 4, lat: -27.641759074706567, lon: -48.66222253418295 },
  { num: 5, lat: -27.641675148301676, lon: -48.66218636096236 },
];
for (const r of refs) {
  const u = latLonToUtm(r.lat, r.lon);
  // Inverse transform: pdf x,y from UTM
  const x_pdf = (u.easting - origin_e) / sf;
  const y_pdf = (origin_n - u.northing) / sf;
  console.log(`post ${r.num}: ref → PDF (${x_pdf.toFixed(2)}, ${y_pdf.toFixed(2)})`);
}
console.log("\nCurrent PDF post positions:");
const posts = [
  { num: 1, x: 272.66, y: 444.30 },
  { num: 2, x: 342.38, y: 428.82 },
  { num: 3, x: 436.82, y: 396.78 },
  { num: 4, x: 500.42, y: 356.94 },
  { num: 5, x: 528.38, y: 321.90 },
];
for (const p of posts) console.log(`post ${p.num}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
