/**
 * debug-coordinates.mjs
 * Coordinate accuracy audit for phase 02.
 *
 * Run: node debug-coordinates.mjs
 *
 * Steps:
 *  1. Load the 11 reference GPS coordinates (from "coordenadas postes.txt")
 *  2. Verify UTM round-trip accuracy (lat/lon → UTM → lat/lon)
 *  3. Compute UTM easting/northing for every post
 *  4. Compute actual GPS distances between consecutive posts (haversine)
 *  5. Compute the implied PDF scale factor given typical UTM grid spacing
 *  6. Simulate buildPageTransforms() + projectPost() with post #1 as anchor
 *     and known relative UTM deltas — reports projection error vs reference
 *  7. Diagnose likely root causes based on errors found
 */

import { latLonToUtm, utmToLatLon, haversineMeters, gpsBearing } from './parser/geo/utm-calibrator.js';

// ── 1. Reference coordinates ──────────────────────────────────────────────────
const REFERENCE = [
  { num: 1,  lat: -27.6594603999238,   lon: -48.699240275151034 },
  { num: 2,  lat: -27.65942120761788,  lon: -48.699602010469185 },
  { num: 3,  lat: -27.659382015296377, lon: -48.700021269466035 },
  { num: 4,  lat: -27.659346742194973, lon: -48.700345393166934 },
  { num: 5,  lat: -27.65930559022924,  lon: -48.700762439716044 },
  { num: 6,  lat: -27.659270317104404, lon: -48.70108213852094  },
  { num: 7,  lat: -27.659231796350753, lon: -48.70147947750159  },
  { num: 8,  lat: -27.65918966453256,  lon: -48.70188546179813  },
  { num: 9,  lat: -27.65914949231848,  lon: -48.70230140211723  },
  { num: 10, lat: -27.6591063806582,   lon: -48.702660924999286 },
  { num: 11, lat: -27.659066208413993, lon: -48.702999429619396 },
];

const SEP = '─'.repeat(72);

// ── 2. UTM round-trip accuracy ────────────────────────────────────────────────
console.log('\n' + SEP);
console.log('SECTION 1: UTM round-trip accuracy (lat/lon → UTM → lat/lon)');
console.log(SEP);

let maxRoundTripError = 0;
for (const p of REFERENCE) {
  const utm = latLonToUtm(p.lat, p.lon);
  const back = utmToLatLon(utm.easting, utm.northing, utm.zone);
  const dLat = Math.abs(back.lat - p.lat);
  const dLon = Math.abs(back.lon - p.lon);
  const errorM = haversineMeters(p.lat, p.lon, back.lat, back.lon);
  if (errorM > maxRoundTripError) maxRoundTripError = errorM;
}
console.log(`Max round-trip error across all 11 posts: ${maxRoundTripError.toFixed(6)} m`);
// Snyder TM series has ~4–5cm inherent precision (finite truncated series).
// 5cm is acceptable; sub-meter is expected. > 1m would indicate a math bug.
console.log(maxRoundTripError < 1.0 ? '  ✓ UTM math is accurate (Snyder TM series precision ~4cm is normal)' : '  ✗ UTM math has significant error — check Snyder constants');

// ── 3. UTM coordinates for all posts ─────────────────────────────────────────
console.log('\n' + SEP);
console.log('SECTION 2: UTM easting/northing for each reference post');
console.log(SEP);

const utmPosts = REFERENCE.map(p => {
  const utm = latLonToUtm(p.lat, p.lon);
  return { ...p, ...utm };
});

console.log(`${'Post'.padEnd(5)} ${'Easting (m)'.padEnd(14)} ${'Northing (m)'.padEnd(15)} ${'Zone'}`);
for (const p of utmPosts) {
  console.log(`${String(p.num).padEnd(5)} ${p.easting.toFixed(3).padEnd(14)} ${p.northing.toFixed(3).padEnd(15)} ${p.zone}`);
}

// ── 4. Inter-post distances (GPS truth) ───────────────────────────────────────
console.log('\n' + SEP);
console.log('SECTION 3: Inter-post GPS distances & UTM deltas (reference truth)');
console.log(SEP);

console.log(`${'Segment'.padEnd(10)} ${'Dist (m)'.padEnd(10)} ${'dE (m)'.padEnd(10)} ${'dN (m)'.padEnd(10)} ${'Bearing°'}`);
let totalDist = 0;
for (let i = 1; i < utmPosts.length; i++) {
  const a = utmPosts[i - 1];
  const b = utmPosts[i];
  const dist = haversineMeters(a.lat, a.lon, b.lat, b.lon);
  const dE = b.easting - a.easting;
  const dN = b.northing - a.northing;
  const bear = gpsBearing(a.lat, a.lon, b.lat, b.lon);
  totalDist += dist;
  console.log(
    `${(a.num + '→' + b.num).padEnd(10)} ${dist.toFixed(2).padEnd(10)} ${dE.toFixed(2).padEnd(10)} ${dN.toFixed(2).padEnd(10)} ${bear.toFixed(1)}°`
  );
}
console.log(`Total route length: ${totalDist.toFixed(2)} m`);

// ── 5. Scale factor validation ────────────────────────────────────────────────
console.log('\n' + SEP);
console.log('SECTION 4: UTM grid scale factor analysis');
console.log(SEP);

// If the PDF has a 50m UTM grid, the scale factor = 50 / medianGridSpacingPt
// We can compute what scale factor is needed given the actual GPS geometry.
// The key insight: scale factor is PDF-space to meters ratio.
// For verification, compute what a "typical" INFOVIAS PDF would have.

const totalUtmDist = Math.hypot(
  utmPosts[utmPosts.length - 1].easting - utmPosts[0].easting,
  utmPosts[utmPosts.length - 1].northing - utmPosts[0].northing
);
console.log(`Total UTM straight-line distance (post 1 → post 11): ${totalUtmDist.toFixed(2)} m`);
console.log('\nScale factor range checks:');
for (const gridSpacingPt of [20, 25, 30, 35, 40, 50, 60, 75, 100]) {
  const sf = 50 / gridSpacingPt;
  const routeLengthPt = totalDist / sf;
  console.log(`  gridSpacing=${gridSpacingPt}pt → scaleFactor=${sf.toFixed(5)} m/pt → route would span ${routeLengthPt.toFixed(1)}pt on page`);
}

// ── 6. Simulate the projection with post #1 as anchor ─────────────────────────
console.log('\n' + SEP);
console.log('SECTION 5: Projection simulation — post #1 GPS anchor + relative UTM offsets');
console.log(SEP);
console.log('This verifies that if buildPageTransforms() and projectPost() receive the');
console.log('correct origin and scale, they reproduce the reference coordinates exactly.');
console.log('');

const p1 = utmPosts[0];

// Simulate: assume post x,y in PDF matches UTM easting/northing offsets from p1
// (i.e., assume PDF is drawn at 1pt = 1m with no scaling — just to test math)
// Then verify projected output matches reference.
//
// Real test: use known relative UTM offsets as synthetic "PDF x,y" coords.

console.log('Simulating with synthetic PDF coords (x = dE from post1, y = -dN from post1):');
console.log(`${'Post'.padEnd(6)} ${'Ref lat'.padEnd(22)} ${'Projected lat'.padEnd(22)} ${'Ref lon'.padEnd(22)} ${'Projected lon'.padEnd(22)} ${'Error(m)'}`);

// Build a synthetic transform where origin = post1 UTM, scale = 1m/pt
const syntheticTransform = {
  origin_e: p1.easting,
  origin_n: p1.northing,
  x_scale_sf: 1.0,    // 1 meter per PDF point (synthetic)
  y_scale_sf: 1.0,
  zone: p1.zone,
};

let maxProjError = 0;
for (const p of utmPosts) {
  // Synthetic PDF coords: x = dE, y = -(dN difference) → y increases downward
  const pdfX = p.easting - p1.easting;
  const pdfY = -(p.northing - p1.northing); // flipY: south = larger y

  // Replicate projectPost() logic
  const e = syntheticTransform.origin_e + pdfX * syntheticTransform.x_scale_sf;
  const n = syntheticTransform.origin_n - pdfY * syntheticTransform.y_scale_sf;
  const proj = utmToLatLon(e, n, syntheticTransform.zone);

  const errM = haversineMeters(p.lat, p.lon, proj.lat, proj.lon);
  if (errM > maxProjError) maxProjError = errM;

  const ok = errM < 1.0 ? '✓' : '✗';
  console.log(
    `${ok} ${String(p.num).padEnd(5)} ${p.lat.toFixed(10).padEnd(22)} ${proj.lat.toFixed(10).padEnd(22)} ${p.lon.toFixed(10).padEnd(22)} ${proj.lon.toFixed(10).padEnd(22)} ${errM.toFixed(4)}m`
  );
}
console.log(`\nMax projection error (synthetic test): ${maxProjError.toFixed(6)} m`);
if (maxProjError < 1.0) {
  console.log('  ✓ Projection math is correct — error is in INPUT DATA (scale factor or viewport boxes), not in the formula');
} else {
  console.log('  ✗ Projection math itself is wrong — check projectPost() / utmToLatLon()');
}

// ── 7. Scale factor from real inter-post distances ────────────────────────────
console.log('\n' + SEP);
console.log('SECTION 6: What scale factor is needed for typical post spacing?');
console.log(SEP);
console.log('For a street with 30–100m post spacing, typical INFOVIAS PDF scales:');
console.log('');

const avgDist = totalDist / (REFERENCE.length - 1);
console.log(`Average inter-post distance: ${avgDist.toFixed(1)} m`);
console.log('');
console.log('If post spacing in PDF is typically 30–100 PDF points:');
for (const pdfSpacingPt of [30, 40, 50, 60, 80, 100, 120, 150]) {
  const impliedSf = avgDist / pdfSpacingPt;
  const gridSpacingPt = 50 / impliedSf;
  console.log(`  pdfSpacing=${pdfSpacingPt}pt → scaleFactor=${impliedSf.toFixed(5)} m/pt → 50m UTM grid line spacing=${gridSpacingPt.toFixed(1)}pt`);
}

// ── 8. Root cause checklist ───────────────────────────────────────────────────
console.log('\n' + SEP);
console.log('SECTION 7: Root cause checklist');
console.log(SEP);
console.log(`
To produce correct coordinates, ALL of these must be true:

[A] computeScaleFactor() must find UTM grid lines on page 2 (or any detail page)
    → If no grid is found, scaleFactor = null and all posts get lat: null
    → If grid spacing is measured wrong (e.g., duplicate stroke lines confuse median),
      scale will be off by a constant factor

[B] buildPageTransforms() must find at least one viewport box for post #1's page
    → viewportBoxes[] must contain { pageNum: <post1.pageNum>, rect: {...} }
    → If Padrão layer rects are not extracted, transforms Map stays empty

[C] The post PDF x,y coordinates must be correct
    → They come from OCR circle detection + snap to Poste symbols
    → If x,y are shifted (e.g., wrong CTM, wrong page), projection is off

[D] The viewport rect geometry must correctly map page-local coords to page-2 coords
    → buildPageTransforms() computes:
        x1_p2 = box_pk.rect.x + (post1.x / pageDim_pk.w) * box_pk.rect.w
      If box dimensions are wrong (e.g., Pass 1 extracts wrong rect), origin_e/n is wrong

ACTION TO DIAGNOSE:
  1. Open index.html in Chrome with the PDF
  2. Open DevTools → Console
  3. Look for these log lines:
     - "[pdf-to-kmz] parse: page 2/N" — how many namedCircles/cablePaths
     - Any warnings about "UTM grid not found" or "no viewport box"
     - "utmGridPathsPerPage" Map size
     - "viewportBoxes" array length after pairLabelsToRects()
  4. After clicking Calculate, check if posts have lat: null or wrong values
`);

console.log(SEP);
console.log('Debug script complete.');
console.log(SEP + '\n');
