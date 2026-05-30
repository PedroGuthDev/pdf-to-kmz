import { latLonToUtm } from "./parser/geo/utm-calibrator.js";
const u1 = latLonToUtm(-27.641966601540403, -48.66305968585957);
const u14 = latLonToUtm(-27.641104447026464, -48.65993156346553);
console.log(`1->14 UTM: dE=${(u14.easting - u1.easting).toFixed(2)} dN=${(u14.northing - u1.northing).toFixed(2)} dist=${Math.hypot(u14.easting - u1.easting, u14.northing - u1.northing).toFixed(2)}m`);

// PDF chord
const dx = 1139.66 - 272.66, dy = 136.38 - 444.30;
const pdf_chord = Math.hypot(dx, dy);
console.log(`PDF chord 1->14: ${pdf_chord.toFixed(2)}pt = ${(pdf_chord * 0.354610).toFixed(2)}m`);
console.log(`Optimal sf to match: ${(Math.hypot(u14.easting - u1.easting, u14.northing - u1.northing) / pdf_chord).toFixed(6)}`);
