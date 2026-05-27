// Test: re-run N3 after re-associating distances
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { associateDistances } from "./parser/distance-associator.js";
import { assignPolesGloballyByLabels } from "./parser/post-positioning.js";
import { buildCablesByPage } from "./parser/cable-builder.js";
import { prefillGapDistancesForPolePlacement } from "./parser/geo/label-lsq-calibrator.js";
import { computeScaleFactor, haversineMeters } from "./parser/geo/utm-calibrator.js";

const refs = [];
for (const line of readFileSync("./coordenadas postes rua joao born.txt", "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
}
const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

// FIX:
//  1. Re-associate distances using post-N3 positions (anchorX may be different now)
//  2. Re-prefill gaps
//  3. Re-run N3 once more
const overviewScale = computeScaleFactor(parsed.utmGridPathsPerPage.get(2) ?? [], []);
const perPageScale = (pn) => {
  const paths = parsed.utmGridPathsPerPage.get(pn);
  if (paths?.length) { const sf = computeScaleFactor(paths, []); if (sf != null) return sf; }
  return overviewScale ?? null;
};

const postsCopy = JSON.parse(JSON.stringify(parsed.posts));

console.log("Posts 4-6 BEFORE second N3:");
for (const n of [4, 5, 6]) {
  const p = postsCopy.find(x => x.number === n);
  console.log(`  Post ${n}: x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} anchorX=${p.anchorX?.toFixed(2)} anchorY=${p.anchorY?.toFixed(2)}`);
}

// IMPORTANT: when associateDistances re-runs, it uses anchorX. Force anchorX = currentX
// to reflect the current post positions:
for (const p of postsCopy) {
  p.anchorX = p.x;
  p.anchorY = p.y;
}

const reassoc = associateDistances(postsCopy, parsed.distanceLabelItems ?? [], [], { perPageScale });
console.log("\nRe-associated 3->4:", reassoc.distances.find(d => d.from === 3 && d.to === 4)?.meters);
console.log("Re-associated 4->5:", reassoc.distances.find(d => d.from === 4 && d.to === 5)?.meters);

const cablesForPrefill = buildCablesByPage(parsed.cableSegments ?? parsed.cablePaths);
const prefilled = prefillGapDistancesForPolePlacement(postsCopy, reassoc.distances, cablesForPrefill);
console.log(`After prefill: ${prefilled} labels filled`);
console.log("After prefill 3->4:", reassoc.distances.find(d => d.from === 3 && d.to === 4)?.meters);
console.log("After prefill 4->5:", reassoc.distances.find(d => d.from === 4 && d.to === 5)?.meters);

// Re-run N3
const n3Warnings = [];
assignPolesGloballyByLabels(
  postsCopy,
  parsed.posteRawCentroids,
  parsed.cablePaths,
  reassoc.distances,
  n3Warnings,
  {
    postByNum: new Map(postsCopy.map(p => [p.number, p])),
    perPageScale,
  },
);

console.log("\nPosts 4-6 AFTER second N3:");
for (const n of [4, 5, 6]) {
  const p = postsCopy.find(x => x.number === n);
  console.log(`  Post ${n}: x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} anchorX=${p.anchorX?.toFixed(2)} anchorY=${p.anchorY?.toFixed(2)}`);
}

// Now run calculateCoordinates
const r1 = refs.find((r) => r.num === 1);
const r = calculateCoordinates(
  postsCopy,
  reassoc.distances,
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
let ok = 0;
const errs = [];
for (const g of refs) {
  const p = r.posts.find((x) => x.number === g.num);
  const e = haversineMeters(g.lat, g.lon, p.lat, p.lon);
  errs.push({num: g.num, err: e});
  if (e < 5) ok++;
}
console.log("\n=== Browser path errors ===");
for (const e of errs) {
  console.log(`  Post ${String(e.num).padStart(2)}: ${e.err.toFixed(2)}m`);
}
console.log(`\n<5m: ${ok}/34, max: ${Math.max(...errs.map(e => e.err)).toFixed(2)}m`);

console.log("\nKey warnings:");
for (const w of r.warnings) {
  if (/sheet entry|boundary-locked|label-lsq|seam-lock|cable-arc-placer/.test(w)) {
    console.log("  " + w);
  }
}
