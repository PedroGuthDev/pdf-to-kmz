// Does the LC PDF carry per-page UTM grid references (absolute anchors) that the
// calibrator could use instead of accumulating label-chain drift across pages?
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { parsePdf } from "./parser/pdf-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.join(__dirname, "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf");

const buf = readFileSync(PDF);
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const grid = parsed.utmGridPathsPerPage ?? {};
const keys = grid instanceof Map ? [...grid.keys()] : Object.keys(grid);
console.log("=== utmGridPathsPerPage ===");
console.log("pages with grid data:", keys);
for (const k of keys) {
  const v = grid instanceof Map ? grid.get(k) : grid[k];
  const n = Array.isArray(v) ? v.length : (v?.length ?? "?");
  console.log(`  page ${k}: ${n} grid path(s)/labels`);
}

// post -> page
const pages = {};
for (const p of parsed.posts ?? []) {
  const pg = p.pageNum ?? "?";
  (pages[pg] ??= []).push(p.number);
}
console.log("=== post pages ===");
for (const pg of Object.keys(pages)) console.log(`  page ${pg}: posts ${pages[pg].join(",")}`);

console.log("=== viewportBoxes ===", (parsed.viewportBoxes ?? []).length);
console.log("=== pageDimensions keys ===", parsed.pageDimensions instanceof Map ? [...parsed.pageDimensions.keys()] : Object.keys(parsed.pageDimensions ?? {}));
