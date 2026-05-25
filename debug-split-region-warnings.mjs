/**
 * Dump anchor-refit and split-region warnings from calculateCoordinates (João Born).
 */
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { associateDistances } from "./parser/distance-associator.js";
import { assignPolesGloballyByLabels } from "./parser/post-positioning.js";
import { computeScaleFactor, haversineMeters } from "./parser/geo/utm-calibrator.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

const text = readFileSync("./debug_results.txt", "utf8");
const dumpIdx = text.indexOf("PARSE DEBUG DUMP");
const block =
  dumpIdx >= 0
    ? text.slice(dumpIdx, text.indexOf("\nPage dimensions", dumpIdx))
    : text;
const byNum = new Map();
for (const line of block.split("\n")) {
  if (line.includes("lat=") || line.includes("lon=")) continue;
  const m = line.match(/Post\s+(\d+):\s+page=(\d+)\s+x=([\d.]+)\s+y=([\d.]+)/);
  if (!m) continue;
  const number = parseInt(m[1], 10);
  if (!byNum.has(number)) {
    const post = {
      number,
      pageNum: parseInt(m[2], 10),
      x: parseFloat(m[3]),
      y: parseFloat(m[4]),
    };
    const am = line.match(/anchor=\(([\d.]+)\s*,\s*([\d.]+)\)/);
    if (am) {
      post.anchorX = parseFloat(am[1]);
      post.anchorY = parseFloat(am[2]);
    }
    byNum.set(number, post);
  }
}
let parserPosts = [...byNum.values()].sort((a, b) => a.number - b.number);

const refText = readFileSync("./coordenadas postes rua joao born.txt", "utf8");
const refs = [];
for (const line of refText.split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (!m) continue;
  refs.push({
    num: parseInt(m[1], 10),
    lat: parseFloat(m[2]),
    lon: parseFloat(m[3]),
  });
}
refs.sort((a, b) => a.num - b.num);
const start = refs[0];

let overviewScale = computeScaleFactor(parsed.utmGridPathsPerPage?.get(2) ?? [], []);
if (overviewScale == null) {
  for (const [pn, paths] of parsed.utmGridPathsPerPage ?? []) {
    if (pn === 2) continue;
    overviewScale = computeScaleFactor(paths, []);
    if (overviewScale != null) break;
  }
}
const perPageScale = (pn) => {
  const paths = parsed.utmGridPathsPerPage?.get(pn);
  if (paths?.length) {
    const sf = computeScaleFactor(paths, []);
    if (sf != null) return sf;
  }
  return overviewScale ?? null;
};

let distances = parsed.distances ?? [];
if (parsed.distanceLabelItems?.length) {
  const { distances: assoc } = associateDistances(
    parserPosts,
    parsed.distanceLabelItems,
    [],
    { perPageScale },
  );
  const labeled = assoc.filter((d) => d.meters != null && d.meters > 0).length;
  if (labeled >= 3) distances = assoc;
}

const n3Warnings = [];
assignPolesGloballyByLabels(
  parserPosts,
  parsed.posteRawCentroids,
  parsed.cablePaths,
  distances,
  n3Warnings,
  {
    postByNum: new Map(parserPosts.map((p) => [p.number, p])),
    perPageScale,
  },
);

const { posts, warnings } = calculateCoordinates(
  parserPosts,
  distances,
  start.lat,
  start.lon,
  parsed.cableSegments ?? [],
  {
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
    viewportBoxes: parsed.viewportBoxes,
    pageDimensions: parsed.pageDimensions,
  },
);

console.log("\n=== Calibration warnings ===");
for (const w of warnings) {
  if (w.includes("split-region") || w.includes("anchor-refit")) {
    console.log(w);
  }
}

console.log("\n=== Posts 9-11 errors ===");
for (const n of [9, 10, 11]) {
  const ref = refs.find((r) => r.num === n);
  const p = posts.find((x) => x.number === n);
  const err =
    ref && p?.lat != null
      ? haversineMeters(ref.lat, ref.lon, p.lat, p.lon)
      : NaN;
  console.log(`  Post ${n}: ${err.toFixed(2)}m`);
}

let maxErr = 0;
let under5 = 0;
for (const ref of refs) {
  const p = posts.find((x) => x.number === ref.num);
  const err =
    p?.lat != null ? haversineMeters(ref.lat, ref.lon, p.lat, p.lon) : Infinity;
  maxErr = Math.max(maxErr, err);
  if (err < 5) under5++;
}
console.log(`\nMax: ${maxErr.toFixed(2)}m  <5m: ${under5}/${refs.length}`);
