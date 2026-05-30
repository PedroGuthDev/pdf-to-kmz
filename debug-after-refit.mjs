import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const sf_refit = 0.348182;
const theta = -3.25 * Math.PI / 180;
// Origin is set so post 1 maps exactly to ref 1
const refU1 = latLonToUtm(-27.641966601540403, -48.66305968585957);
const p1 = { x: 272.66, y: 444.30 };
// proj_e = origin_e + sf*(cos(theta)*x + sin(theta)*y); but page y is downward.
// Wait the canonical transform: e = origin_e + sf*(x*cos(t) + y*sin(t))?
// Let me check the actual code...

// For now, use the inverse: origin = ref - proj_of_post1
const origin_e = refU1.easting - sf_refit * (Math.cos(theta) * p1.x + Math.sin(theta) * p1.y);
const origin_n = refU1.northing - sf_refit * (Math.sin(theta) * p1.x - Math.cos(theta) * p1.y);

console.log(`origin: (${origin_e.toFixed(2)}, ${origin_n.toFixed(2)})`);

// Project posts 1-5
const posts = [
  { num: 1, lat: -27.641966601540403, lon: -48.66305968585957, x: 272.66, y: 444.30 },
  { num: 2, lat: -27.64189640868478, lon: -48.66274618461442, x: 342.38, y: 428.82 },
  { num: 3, lat: -27.641835371382406, lon: -48.66249641713888, x: 436.82, y: 396.78 },
  { num: 4, lat: -27.641759074706567, lon: -48.66222253418295, x: 500.42, y: 356.94 },
  { num: 5, lat: -27.641675148301676, lon: -48.66218636096236, x: 528.38, y: 321.90 },
  { num: 9, lat: -27.641418790876976, lon: -48.661149395264694, x: 849.50, y: 214.98 },
  { num: 14, lat: -27.641104447026464, lon: -48.65993156346553, x: 1139.66, y: 136.38 },
];

console.log("After refit (scale=0.348182, theta=-3.25°):");
for (const p of posts) {
  const e = origin_e + sf_refit * (Math.cos(theta) * p.x + Math.sin(theta) * p.y);
  const n = origin_n + sf_refit * (Math.sin(theta) * p.x - Math.cos(theta) * p.y);
  const ref = latLonToUtm(p.lat, p.lon);
  const err = Math.hypot(e - ref.easting, n - ref.northing);
  console.log(`  post ${p.num}: err=${err.toFixed(2)}m`);
}
