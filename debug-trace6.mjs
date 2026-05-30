// Add trace via a different mechanism: wrap exports at module load time
import { spawnSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";

// Use a wrapper module that imports and patches
const wrap = `
import * as m from "./parser/geo/label-lsq-calibrator.js";
const origSnap = m.refineAuxiliaryPostsPdfByLabelBracket;
const origSnap2 = m.snapOffCableAuxiliaryPostsByLabelBracket;
const origSnap3 = m.snapRoutePostsPdfByLabelBracket;
// nope can't override exports

// Instead, just look at the warning emission to confirm where it comes from
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { associateDistances } from "./parser/distance-associator.js";
import { assignPolesGloballyByLabels } from "./parser/post-positioning.js";
import { buildCablesByPage } from "./parser/cable-builder.js";
import { prefillGapDistancesForPolePlacement } from "./parser/geo/label-lsq-calibrator.js";
import { computeScaleFactor } from "./parser/geo/utm-calibrator.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const text = readFileSync("./debug_results.txt", "utf8");
const dumpIdx = text.indexOf("PARSE DEBUG DUMP");
const block = dumpIdx >= 0 ? text.slice(dumpIdx, text.indexOf("\nPage dimensions", dumpIdx)) : text;
const byNum = new Map();
for (const line of block.split("\n")) {
  const m = line.match(/Post\s+(\d+):\s+page=(\d+)\s+x=([\d.]+)\s+y=([\d.]+)/);
  if (!m) continue;
  const num = parseInt(m[1], 10);
  if (byNum.has(num)) continue;
  byNum.set(num, { number: num, pageNum: parseInt(m[2], 10), x: parseFloat(m[3]), y: parseFloat(m[4]) });
}
const parserPosts = [...byNum.values()].sort((a, b) => a.number - b.number);

const overviewScaleForAssoc = computeScaleFactor(parsed.utmGridPathsPerPage?.get(2) ?? [], []);
const perPageScale = (pageNum) => {
  const paths = parsed.utmGridPathsPerPage?.get(pageNum);
  if (paths?.length) { const sf = computeScaleFactor(paths, []); if (sf != null) return sf; }
  return overviewScaleForAssoc;
};
const { distances: assoc } = associateDistances(parserPosts, parsed.distanceLabelItems, [], { perPageScale });
const distances = assoc;

// Run N3 + 2nd pass
const cablesForPrefill = parsed.cableSegments?.length ? buildCablesByPage(parsed.cableSegments) : buildCablesByPage(parsed.cablePaths);
prefillGapDistancesForPolePlacement(parserPosts, distances, cablesForPrefill);
const n3Warnings = [];
assignPolesGloballyByLabels(parserPosts, parsed.posteRawCentroids, parsed.cablePaths, distances, n3Warnings, {
  postByNum: new Map(parserPosts.map(p => [p.number, p])), perPageScale,
});
const { distances: assoc2 } = associateDistances(parserPosts, parsed.distanceLabelItems, [], { perPageScale });
for (const d of distances) {
  const d2 = assoc2.find(x => x.from === d.from && x.to === d.to);
  if (d2 && d2.meters != null) d.meters = d2.meters;
}

console.log("Pre-calc: post 2 PDF = (" + parserPosts.find(p => p.number === 2).x.toFixed(2) + ", " + parserPosts.find(p => p.number === 2).y.toFixed(2) + ")");

const ref1 = { lat: -27.641966601540403, lon: -48.66305968585957 };
const { posts: outPosts, warnings: outWarnings } = calculateCoordinates(parserPosts, distances, ref1.lat, ref1.lon, parsed.cableSegments ?? [], {
  utmGridPathsPerPage: parsed.utmGridPathsPerPage,
  viewportBoxes: parsed.viewportBoxes,
  pageDimensions: parsed.pageDimensions,
  posteRawCentroids: parsed.posteRawCentroids,
  distanceLabelItems: parsed.distanceLabelItems,
});

console.log("Post-calc: post 2 PDF = (" + parserPosts.find(p => p.number === 2).x.toFixed(2) + ", " + parserPosts.find(p => p.number === 2).y.toFixed(2) + ")");
console.log("Post-calc: post 2 GPS = (" + outPosts.find(p => p.number === 2).lat.toFixed(8) + ", " + outPosts.find(p => p.number === 2).lon.toFixed(8) + ")");
const refP2 = { lat: -27.64189640868478, lon: -48.66274618461442 };
import { haversineMeters } from "./parser/geo/utm-calibrator.js";
const err = haversineMeters(refP2.lat, refP2.lon, outPosts.find(p => p.number === 2).lat, outPosts.find(p => p.number === 2).lon);
console.log("Post-calc: post 2 err = " + err.toFixed(2) + "m");

console.log("\nWarnings related to post 2:");
for (const w of outWarnings) if (/post 2(\s|:|,|$)/.test(w) || w.includes("post  2")) console.log("  ", w);
`;
writeFileSync("./debug-warn-post2.mjs", wrap);
const r = spawnSync("node", ["debug-warn-post2.mjs"], { encoding: "utf8" });
console.log(r.stdout);
console.log("STDERR:", r.stderr.slice(-500));
