// Detailed vector analysis: where do calc'd posts land vs the reference, and what's the relation to the chord?
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { haversineMeters, latLonToUtm } from "./parser/geo/utm-calibrator.js";

const refs = [];
for (const line of readFileSync("./coordenadas postes rua joao born.txt", "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
}
const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
const r1 = refs.find((r) => r.num === 1);
const postsCopy = JSON.parse(JSON.stringify(parsed.posts));
const r = calculateCoordinates(
  postsCopy,
  parsed.distances,
  r1.lat,
  r1.lon,
  parsed.cableSegments,
  {
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
    viewportBoxes: parsed.viewportBoxes,
    pageDimensions: parsed.pageDimensions,
    distanceLabelItems: parsed.distanceLabelItems,
    posteRawCentroids: parsed.posteRawCentroids,
  },
);

const u1 = latLonToUtm(r1.lat, r1.lon);
const u14ref = latLonToUtm(refs.find(x=>x.num===14).lat, refs.find(x=>x.num===14).lon);
const chordE = u14ref.easting - u1.easting;
const chordN = u14ref.northing - u1.northing;
const chordLen = Math.hypot(chordE, chordN);
const chordBrg = (Math.atan2(chordE, chordN) * 180 / Math.PI + 360) % 360;
console.log(`Chord 1->14 (ref): bearing ${chordBrg.toFixed(2)}°, length ${chordLen.toFixed(2)}m`);
const chordUnitE = chordE / chordLen;
const chordUnitN = chordN / chordLen;
// Perpendicular: rotate chord 90° CCW = (-chordUnitN, chordUnitE) for left side
const perpUnitE = -chordUnitN;
const perpUnitN = chordUnitE;

console.log("\n=== Post errors decomposed: calc - ref in (along-chord, perp-chord) where chord is post1->post14 ===");
console.log("along+ = toward post 14, perp+ = left of chord");
for (let n = 1; n <= 14; n++) {
  const g = refs.find(x => x.num === n);
  const c = r.posts.find(x => x.number === n);
  if (!g || !c) continue;
  const ug = latLonToUtm(g.lat, g.lon);
  const uc = latLonToUtm(c.lat, c.lon);
  const dE = uc.easting - ug.easting;
  const dN = uc.northing - ug.northing;
  // Project (dE, dN) on chord direction
  const along = dE * chordUnitE + dN * chordUnitN;
  const perp = dE * perpUnitE + dN * perpUnitN;
  const err = Math.hypot(dE, dN);
  console.log(`  Post ${n.toString().padStart(2)}: err=${err.toFixed(2).padStart(6)}m  dE=${dE.toFixed(2).padStart(7)} dN=${dN.toFixed(2).padStart(7)}  along=${along.toFixed(2).padStart(7)} perp=${perp.toFixed(2).padStart(7)}`);
}

// What's the post 6 expected PDF position given its reference UTM and the page 3 transform that's currently applied?
// Use post 1's UTM and post 14's UTM to derive a transform — see what (e6_ref, n6_ref) maps to in PDF.
// But better: under the current page-3 transform, where DO posts 6 and 7 land in UTM vs reference?
console.log("\n=== Post 6 and 7 in detail ===");
const p6 = r.posts.find(x=>x.number===6);
const r6 = refs.find(x=>x.num===6);
const uc6 = latLonToUtm(p6.lat, p6.lon);
const ug6 = latLonToUtm(r6.lat, r6.lon);
console.log(`  Post 6: calc UTM (${uc6.easting.toFixed(2)}, ${uc6.northing.toFixed(2)})  ref UTM (${ug6.easting.toFixed(2)}, ${ug6.northing.toFixed(2)})  dE=${(uc6.easting-ug6.easting).toFixed(2)} dN=${(uc6.northing-ug6.northing).toFixed(2)}`);
// What's the reference UTM bearing post1->post6 vs PDF bearing post1->post6?
const u6ref = latLonToUtm(refs.find(x=>x.num===6).lat, refs.find(x=>x.num===6).lon);
const dE1_6 = u6ref.easting - u1.easting;
const dN1_6 = u6ref.northing - u1.northing;
const refBrg1_6 = (Math.atan2(dE1_6, dN1_6) * 180 / Math.PI + 360) % 360;
const refDist1_6 = Math.hypot(dE1_6, dN1_6);
const post1Pdf = parsed.posts.find(x=>x.number===1);
const post6Pdf = parsed.posts.find(x=>x.number===6);
const pdfDx = post6Pdf.x - post1Pdf.x;
const pdfDy = post6Pdf.y - post1Pdf.y;
const pdfBrg1_6 = (Math.atan2(pdfDx, -pdfDy) * 180 / Math.PI + 360) % 360;
const pdfDist1_6 = Math.hypot(pdfDx, pdfDy) * 0.354610;
console.log(`  Post 1 -> Post 6: ref UTM bearing ${refBrg1_6.toFixed(2)}° dist ${refDist1_6.toFixed(2)}m;  PDF chord bearing ${pdfBrg1_6.toFixed(2)}° dist ${pdfDist1_6.toFixed(2)}m`);
console.log(`  Bearing diff (PDF - UTM): ${(pdfBrg1_6 - refBrg1_6).toFixed(2)}°`);
console.log(`  Scale: PDF / UTM = ${(pdfDist1_6/refDist1_6).toFixed(4)}`);

// Try multiple chord endpoints to see how the refit varies
for (const K of [6, 7, 8, 10, 12, 14]) {
  const pKref = refs.find(x=>x.num===K);
  const uK = latLonToUtm(pKref.lat, pKref.lon);
  const dE1_K = uK.easting - u1.easting;
  const dN1_K = uK.northing - u1.northing;
  const postKPdf = parsed.posts.find(x=>x.number===K);
  const dxPK = postKPdf.x - post1Pdf.x;
  const dyPK = postKPdf.y - post1Pdf.y;
  const det = dxPK * dxPK + dyPK * dyPK;
  const u_ = (dxPK * dE1_K - dyPK * dN1_K) / det;
  const v_ = (dyPK * dE1_K + dxPK * dN1_K) / det;
  const refit_s = Math.hypot(u_, v_);
  const refit_t = Math.atan2(v_, u_);
  console.log(`  Refit-via-1->${K}: scale ${refit_s.toFixed(6)}, theta ${(refit_t*180/Math.PI).toFixed(3)}°`);
}

// Use 1->14 for downstream tests
const p14ref = refs.find(x=>x.num===14);
const u14 = latLonToUtm(p14ref.lat, p14ref.lon);
const dE1_14 = u14.easting - u1.easting;
const dN1_14 = u14.northing - u1.northing;
const post14Pdf = parsed.posts.find(x=>x.number===14);
const dxPK = post14Pdf.x - post1Pdf.x;
const dyPK = post14Pdf.y - post1Pdf.y;
const det = dxPK * dxPK + dyPK * dyPK;
const u = (dxPK * dE1_14 - dyPK * dN1_14) / det;
const v = (dyPK * dE1_14 + dxPK * dN1_14) / det;
const refit_s = Math.hypot(u, v);
const refit_t = Math.atan2(v, u);
console.log(`\n  Refit-via-1-14 transform: scale ${refit_s.toFixed(6)}, theta ${(refit_t*180/Math.PI).toFixed(3)}°`);

// Now apply the refit-via-1-14 to ALL posts 2-13 and see how the errors look
console.log("\n  Applying refit-via-1-14 to posts 2-13:");
for (let n = 2; n <= 14; n++) {
  const refN = refs.find(x=>x.num===n);
  if (!refN) continue;
  const postN = parsed.posts.find(x=>x.number===n);
  if (!postN) continue;
  const uN = latLonToUtm(refN.lat, refN.lon);
  const dxN = postN.x - post1Pdf.x;
  const dyN = postN.y - post1Pdf.y;
  const cosT = Math.cos(refit_t); const sinT = Math.sin(refit_t);
  const eN_refit = u1.easting + refit_s * (cosT * dxN + sinT * dyN);
  const nN_refit = u1.northing - refit_s * (-sinT * dxN + cosT * dyN);
  const err = Math.hypot(eN_refit - uN.easting, nN_refit - uN.northing);
  console.log(`    Post ${n.toString().padStart(2)}: refit UTM dE=${(eN_refit-uN.easting).toFixed(2).padStart(7)} dN=${(nN_refit-uN.northing).toFixed(2).padStart(7)} err=${err.toFixed(2)}m`);
}

// Apply this transform to post 6 PDF, get UTM, compare with ref
const dx6 = post6Pdf.x - post1Pdf.x;
const dy6 = post6Pdf.y - post1Pdf.y;
const c = Math.cos(refit_t); const ss = Math.sin(refit_t);
const e6_refit = u1.easting + refit_s * (c * dx6 + ss * dy6);
const n6_refit = u1.northing - refit_s * (-ss * dx6 + c * dy6);
const e6_ref = u6ref.easting;
const n6_ref = u6ref.northing;
console.log(`  Post 6 under refit transform: UTM (${e6_refit.toFixed(2)}, ${n6_refit.toFixed(2)})  ref (${e6_ref.toFixed(2)}, ${n6_ref.toFixed(2)})  err=${Math.hypot(e6_refit-e6_ref, n6_refit-n6_ref).toFixed(2)}m`);
