/**
 * Build Luiz Carolino fixtures:
 *   1. Convert ground-truth txt -> JSON (parser/__tests__/fixtures/luizcarolino-ground-truth.json)
 *   2. Region-extract Luiz Carolino route from Palhoca.dxf
 *      -> parser/__tests__/fixtures/luizcarolino-dwg-region.json
 *
 * Requires locally (gitignored): Palhoca.dxf
 *
 * Run: node tools/build-luizcarolino-fixtures.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDxfText } from "../parser/dwg/dxf-loader.js";
import { latLonToUtm } from "../parser/geo/utm-calibrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

const GT_TXT = path.join(ROOT, "coordenadas postes rua luiz carolino pereira..txt");
const GT_JSON = path.join(FIXTURES, "luizcarolino-ground-truth.json");
const DXF = path.join(ROOT, "Palhoca.dxf");
const DWG_REGION_JSON = path.join(FIXTURES, "luizcarolino-dwg-region.json");

// ─── Step 1: Parse ground-truth txt ──────────────────────────────────────────

if (!existsSync(GT_TXT)) {
  console.error(`Missing ground-truth file: ${GT_TXT}`);
  process.exit(1);
}

const gtRaw = readFileSync(GT_TXT, "utf8");
const groundTruth = [];

for (const line of gtRaw.split(/\r?\n/)) {
  const m = line.match(/Poste\s+(\d+);\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (m) {
    groundTruth.push({
      number: parseInt(m[1], 10), // strip leading zeros (Poste 01 -> 1)
      lat: parseFloat(m[2]),
      lon: parseFloat(m[3]),
    });
  }
}

groundTruth.sort((a, b) => a.number - b.number);

console.log(`Parsed ${groundTruth.length} posts from ground-truth txt.`);

writeFileSync(GT_JSON, JSON.stringify(groundTruth, null, 2) + "\n", "utf8");
console.log(`Wrote ${GT_JSON}`);

// ─── Step 2: Region-extract from Palhoca.dxf ─────────────────────────────────

if (!existsSync(DXF)) {
  console.error(`Missing DXF file: ${DXF}`);
  console.error("Cannot build DWG region fixture. Ground-truth JSON was still written.");
  process.exit(1);
}

console.log("Loading Palhoca.dxf (this may take a moment — 134 MB)…");
const dxfText = readFileSync(DXF, "latin1");
const { posts: allPosts, cableEdges: allEdges } = parseDxfText(dxfText);
console.log(`Loaded ${allPosts.length} Poste INSERTs.`);

// Derive crop bbox from GT coords — compute at build time, NOT stored in any
// runtime parser file.
const MARGIN_M = 50; // padding on each side of the GT bounding box
const gtUtm = groundTruth.map((g) => latLonToUtm(g.lat, g.lon));
const minX = Math.min(...gtUtm.map((u) => u.easting)) - MARGIN_M;
const maxX = Math.max(...gtUtm.map((u) => u.easting)) + MARGIN_M;
const minY = Math.min(...gtUtm.map((u) => u.northing)) - MARGIN_M;
const maxY = Math.max(...gtUtm.map((u) => u.northing)) + MARGIN_M;

console.log(
  `Crop bbox (from GT + ${MARGIN_M} m margin): x[${minX.toFixed(0)}..${maxX.toFixed(0)}] y[${minY.toFixed(0)}..${maxY.toFixed(0)}]`,
);

// Keep only Poste INSERTs within bbox
const regionPosts = allPosts.filter(
  (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY,
);
console.log(`Cropped to ${regionPosts.length} posts within bbox.`);

if (regionPosts.length < 20) {
  console.error(
    `ERROR: crop produced only ${regionPosts.length} posts — crop likely failed. Expected ~31-80. STOP.`,
  );
  process.exit(1);
}
if (regionPosts.length > 500) {
  console.error(
    `ERROR: crop produced ${regionPosts.length} posts — too large, crop likely failed. Expected ~31-80. STOP.`,
  );
  process.exit(1);
}

// Keep only cable edges fully within bbox (both endpoints inside)
const regionEdges = (allEdges ?? []).filter((e) => {
  const [x1, y1] = [e.x1 ?? e.startX, e.y1 ?? e.startY];
  const [x2, y2] = [e.x2 ?? e.endX, e.y2 ?? e.endY];
  if (x1 == null || y1 == null || x2 == null || y2 == null) return false;
  return x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY &&
         x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY;
});
console.log(`Cropped to ${regionEdges.length} cable edges within bbox.`);

writeFileSync(
  DWG_REGION_JSON,
  JSON.stringify({ posts: regionPosts, cableEdges: regionEdges }, null, 2) + "\n",
  "utf8",
);
console.log(`Wrote ${DWG_REGION_JSON}`);
