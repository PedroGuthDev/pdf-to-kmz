// What if post 2 GPS = midpoint of (projected p1, projected p3) ?
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const refU2 = latLonToUtm(-27.64189640868478, -48.66274618461442);
const refU1 = latLonToUtm(-27.641966601540403, -48.66305968585957);
const refU3 = latLonToUtm(-27.641835371382406, -48.66249641713888);
console.log(`ref1: ${refU1.easting.toFixed(2)}, ${refU1.northing.toFixed(2)}`);
console.log(`ref2: ${refU2.easting.toFixed(2)}, ${refU2.northing.toFixed(2)}`);
console.log(`ref3: ${refU3.easting.toFixed(2)}, ${refU3.northing.toFixed(2)}`);

// Midpoint between ref1 and ref3:
const mid = { e: (refU1.easting + refU3.easting) / 2, n: (refU1.northing + refU3.northing) / 2 };
console.log(`midpoint: ${mid.e.toFixed(2)}, ${mid.n.toFixed(2)}`);
console.log(`midpoint err: ${Math.hypot(mid.e - refU2.easting, mid.n - refU2.northing).toFixed(2)}m`);

// Using label fraction
const lbl12 = 22.7, lbl23 = 37.4;
const frac = lbl12 / (lbl12 + lbl23);
const lbl_p2 = { e: refU1.easting + frac * (refU3.easting - refU1.easting), n: refU1.northing + frac * (refU3.northing - refU1.northing) };
console.log(`label-frac midpoint: ${lbl_p2.e.toFixed(2)}, ${lbl_p2.n.toFixed(2)}`);
console.log(`label-frac err: ${Math.hypot(lbl_p2.e - refU2.easting, lbl_p2.n - refU2.northing).toFixed(2)}m`);

// Using current projected post 3 (~2.10m off ref3, but let's use ref3 as proxy for now)
// What's the harness final post 3 GPS? Let's compute from PDF:
const sf = 0.354610;
const origin_e = 730468.812;
const origin_n = 6940433.057;
// Note: actual harness uses anchor-refit transform, so origin shifts. Use post 3's PDF.
// But we want to test the IDEA: if post 1 and post 3 are well-projected, midpoint helps post 2.

// What if we use PDF chord fraction (1->2 / 1->3 in PDF)?
const pdf_chord12 = Math.hypot(342.38 - 272.66, 428.82 - 444.30);
const pdf_chord13 = Math.hypot(436.82 - 272.66, 396.78 - 444.30);
const pdf_frac = pdf_chord12 / pdf_chord13;
console.log(`PDF fraction 1->2 / 1->3 = ${pdf_frac.toFixed(3)}`);
const pdf_p2 = { e: refU1.easting + pdf_frac * (refU3.easting - refU1.easting), n: refU1.northing + pdf_frac * (refU3.northing - refU1.northing) };
console.log(`pdf-frac midpoint: ${pdf_p2.e.toFixed(2)}, ${pdf_p2.n.toFixed(2)}`);
console.log(`pdf-frac err: ${Math.hypot(pdf_p2.e - refU2.easting, pdf_p2.n - refU2.northing).toFixed(2)}m`);
