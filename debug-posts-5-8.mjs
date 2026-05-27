/**
 * Investigate posts 5–8: 4→5 label, split-region K, anchor-page chords.
 */
import { readFileSync, existsSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { associateDistances } from "./parser/distance-associator.js";
import { assignPolesGloballyByLabels } from "./parser/post-positioning.js";
import {
  computeScaleFactor,
  haversineMeters,
} from "./parser/geo/utm-calibrator.js";
import { fillAdjacentMissingDistances } from "./parser/geo/label-lsq-calibrator.js";

function loadPostsFromDebugResults() {
  const text = readFileSync("debug_results.txt", "utf8");
  const dumpIdx = text.indexOf("PARSE DEBUG DUMP");
  const block =
    dumpIdx >= 0
      ? text.slice(dumpIdx, text.indexOf("\nPage dimensions", dumpIdx))
      : text;
  const byNum = new Map();
  for (const line of block.split("\n")) {
    const m = line.match(
      /Post\s+(\d+):\s+page=(\d+)\s+x=([\d.]+)\s+y=([\d.]+)/,
    );
    if (m && !byNum.has(+m[1])) {
      byNum.set(+m[1], {
        number: +m[1],
        pageNum: +m[2],
        x: +m[3],
        y: +m[4],
      });
    }
  }
  return [...byNum.values()].sort((a, b) => a.number - b.number);
}

function loadRef() {
  const refs = [];
  for (const line of readFileSync(
    "./coordenadas postes rua joao born.txt",
    "utf8",
  ).split("\n")) {
    const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
    if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
  }
  return refs;
}

const posts = loadPostsFromDebugResults();
const buf = readFileSync(
  "./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf",
);
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
const os = computeScaleFactor(parsed.utmGridPathsPerPage?.get(2) ?? [], []);
const pps = (pn) =>
  computeScaleFactor(parsed.utmGridPathsPerPage?.get(pn) ?? [], []) ?? os;
const { distances: assoc } = associateDistances(
  posts,
  parsed.distanceLabelItems,
  [],
  { perPageScale: pps },
);
const distMap = new Map();
for (const d of assoc) {
  if (d.meters > 0) {
    distMap.set(`${d.from}->${d.to}`, d.meters);
    distMap.set(`${d.to}->${d.from}`, d.meters);
  }
}
const { map: withGaps, filled } = fillAdjacentMissingDistances(posts, distMap);
console.log("\n=== 4→5 label ===");
console.log("  raw assoc:", distMap.get("4->5"), distMap.get("5->4"));
console.log("  after gap fill:", withGaps.get("4->5"), `(filled ${filled})`);
for (let n = 3; n <= 7; n++) {
  const a = posts.find((p) => p.number === n);
  const b = posts.find((p) => p.number === n + 1);
  if (!a || !b) continue;
  const pdfPt = Math.hypot(b.x - a.x, b.y - a.y);
  const label = withGaps.get(`${n}->${n + 1}`);
  console.log(
    `  ${n}→${n + 1}: label=${label?.toFixed(2) ?? "—"}m  pdfChord=${pdfPt.toFixed(1)}pt  ratio=${label ? (pdfPt / label).toFixed(3) : "—"}`,
  );
}

assignPolesGloballyByLabels(
  posts,
  parsed.posteRawCentroids,
  parsed.cablePaths,
  assoc,
  [],
  { postByNum: new Map(posts.map((p) => [p.number, p])), perPageScale: pps },
);

const ref = loadRef();
const r1 = ref.find((r) => r.num === 1);
const warnings = [];
const { posts: out, warnings: w2 } = calculateCoordinates(
  posts,
  assoc,
  r1.lat,
  r1.lon,
  parsed.cableSegments ?? [],
  {
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
    viewportBoxes: parsed.viewportBoxes,
    pageDimensions: parsed.pageDimensions,
  },
);
const allW = [...warnings, ...w2];
console.log("\n=== Refinement (anchor/split/distortion) ===");
for (const w of allW.filter((x) =>
  /\[split|\[anchor-refit|\[distortion/.test(x),
)) {
  console.log(" ", w);
}
console.log("\n=== Errors posts 4–11 ===");
for (let n = 4; n <= 11; n++) {
  const p = out.find((x) => x.number === n);
  const r = ref.find((x) => x.num === n);
  if (p?.lat && r) {
    const e = haversineMeters(p.lat, p.lon, r.lat, r.lon);
    console.log(
      `  Post ${n}: ${e.toFixed(2)}m  pdf=(${p.x.toFixed(0)},${p.y.toFixed(0)})`,
    );
  }
}
