/**
 * Export Siriu PDF topology + DWG region for CI regression gate (no PDF/DXF needed in CI).
 *
 * Requires locally (gitignored): INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf, siriu.dxf
 *
 * Run: node tools/export-siriu-regression-fixtures.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { parsePdf } from "../parser/pdf-parser.js";
import { createRegionLibrary } from "../parser/dwg/region-library.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

const PDF = path.join(
  ROOT,
  "INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf",
);
const DXF = path.join(ROOT, "siriu.dxf");

function mapToObject(m) {
  if (m == null) return null;
  if (!(m instanceof Map)) return m;
  const o = {};
  for (const [k, v] of m) o[String(k)] = v;
  return o;
}

function serializeTopology(parsed) {
  return {
    posts: parsed.posts ?? [],
    distances: parsed.distances ?? [],
    cableSegments: parsed.cableSegments ?? [],
    pageDimensions: mapToObject(parsed.pageDimensions),
    viewportBoxes: parsed.viewportBoxes ?? [],
    utmGridPathsPerPage: mapToObject(parsed.utmGridPathsPerPage),
    distanceLabelItems: parsed.distanceLabelItems ?? [],
  };
}

async function main() {
  if (!existsSync(PDF)) {
    console.error(`Missing PDF: ${PDF}`);
    process.exit(1);
  }
  if (!existsSync(DXF)) {
    console.error(`Missing DXF: ${DXF}`);
    process.exit(1);
  }

  console.log("Parsing PDF…");
  const pdfBuf = readFileSync(PDF);
  const parsed = await parsePdf(
    pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
  );
  if (parsed.error) {
    console.error("parsePdf failed:", parsed.error);
    process.exit(1);
  }

  const topoPath = path.join(FIXTURES, "siriu-topology.json");
  writeFileSync(
    topoPath,
    JSON.stringify(serializeTopology(parsed), null, 2) + "\n",
    "utf8",
  );
  console.log(
    `Wrote ${topoPath} (${parsed.posts?.length ?? 0} posts, ${parsed.distances?.length ?? 0} distance edges)`,
  );

  console.log("Loading DXF region…");
  const lib = createRegionLibrary(globalThis.indexedDB);
  await lib.addRegion(
    "siriu",
    new Blob([readFileSync(DXF, "utf8")], { type: "text/plain" }),
  );
  const region = await lib.getRegionWithIndex("siriu");

  const dwgPath = path.join(FIXTURES, "siriu-dwg-region.json");
  writeFileSync(
    dwgPath,
    JSON.stringify(
      {
        posts: region.posts ?? [],
        cableEdges: region.cableEdges ?? [],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(
    `Wrote ${dwgPath} (${region.posts?.length ?? 0} INSERTs, ${region.cableEdges?.length ?? 0} cable edges)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
