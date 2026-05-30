import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const labels = {
  '1->2': 22.7, '2->3': 37.4, '3->4': 38.9, '4->5': 13.35,
  '5->6': 25.2, '6->7': 28.5, '7->8': 34.8, '8->9': 34.0,
  '9->10': 17.8, '10->11': 14.1, '11->12': 10.9, '12->13': 27.6, '13->14': 36,
};
const refs = [
  { num: 1, lat: -27.641966601540403, lon: -48.66305968585957 },
  { num: 2, lat: -27.64189640868478, lon: -48.66274618461442 },
  { num: 3, lat: -27.641835371382406, lon: -48.66249641713888 },
  { num: 4, lat: -27.641759074706567, lon: -48.66222253418295 },
  { num: 5, lat: -27.641675148301676, lon: -48.66218636096236 },
  { num: 6, lat: -27.641601903383663, lon: -48.661914200524336 },
  { num: 7, lat: -27.64153171029405, lon: -48.661650652774284 },
  { num: 8, lat: -27.641455413406426, lon: -48.661290643102646 },
  { num: 9, lat: -27.641418790876976, lon: -48.661149395264694 },
  { num: 10, lat: -27.641369960824633, lon: -48.66099092210781 },
  { num: 11, lat: -27.64134096797074, lon: -48.66080661093625 },
  { num: 12, lat: -27.64127382659538, lon: -48.66056201106366 },
  { num: 13, lat: -27.641203633295277, lon: -48.660295018244994 },
  { num: 14, lat: -27.641104447026464, lon: -48.65993156346553 },
];
for (const r of refs) {
  const u = latLonToUtm(r.lat, r.lon);
  r.e = u.easting; r.n = u.northing;
}
console.log("Segment | Label | Reference | Δ");
for (let i = 0; i < refs.length - 1; i++) {
  const lbl = labels[`${refs[i].num}->${refs[i+1].num}`];
  const trueDist = Math.hypot(refs[i+1].e - refs[i].e, refs[i+1].n - refs[i].n);
  const delta = trueDist - lbl;
  console.log(`  ${refs[i].num}->${refs[i+1].num}: ${lbl}m | ${trueDist.toFixed(2)}m | Δ=${delta.toFixed(2)}m ${Math.abs(delta) > 3 ? '*** WRONG' : ''}`);
}
