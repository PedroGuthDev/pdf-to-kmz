// Run full harness, but with a patch to dump all warnings.
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { associateDistances } from "./parser/distance-associator.js";
import { assignPolesGloballyByLabels } from "./parser/post-positioning.js";
import { buildCablesByPage } from "./parser/cable-builder.js";
import { prefillGapDistancesForPolePlacement } from "./parser/geo/label-lsq-calibrator.js";
import { computeScaleFactor } from "./parser/geo/utm-calibrator.js";
import { readFileSync, existsSync } from "fs";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// Load debug_results.txt posts
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
  if (paths?.length) {
    const sf = computeScaleFactor(paths, []);
    if (sf != null) return sf;
  }
  return overviewScaleForAssoc;
};

const { distances: assoc } = associateDistances(parserPosts, parsed.distanceLabelItems, [], { perPageScale });
const distances = assoc;

// N3
const cablesForPrefill = parsed.cableSegments?.length ? buildCablesByPage(parsed.cableSegments) : buildCablesByPage(parsed.cablePaths);
prefillGapDistancesForPolePlacement(parserPosts, distances, cablesForPrefill);
const n3Warnings = [];
assignPolesGloballyByLabels(parserPosts, parsed.posteRawCentroids, parsed.cablePaths, distances, n3Warnings, {
  postByNum: new Map(parserPosts.map(p => [p.number, p])),
  perPageScale,
});

// Refresh label associations after N3
const { distances: assoc2 } = associateDistances(parserPosts, parsed.distanceLabelItems, [], { perPageScale });
for (const d of distances) {
  const d2 = assoc2.find(x => x.from === d.from && x.to === d.to);
  if (d2 && d2.meters != null) d.meters = d2.meters;
}

const ref1 = { lat: -27.641966601540403, lon: -48.66305968585957 };
const { posts: outPosts, warnings: outWarnings } = calculateCoordinates(parserPosts, distances, ref1.lat, ref1.lon, parsed.cableSegments ?? [], {
  utmGridPathsPerPage: parsed.utmGridPathsPerPage,
  viewportBoxes: parsed.viewportBoxes,
  pageDimensions: parsed.pageDimensions,
  posteRawCentroids: parsed.posteRawCentroids,
  distanceLabelItems: parsed.distanceLabelItems,
});

console.log(`\nAll ${outWarnings.length} warnings:`);
for (const w of outWarnings) console.log("  ", w);
