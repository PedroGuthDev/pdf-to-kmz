#!/usr/bin/env node
/**
 * Dump LC parsed distances vs ground-truth span lengths to spot split-label
 * crossings (span printed as two partial labels via a mid-cable crossing point).
 *
 * Run: node tools/debug-lc-distances.mjs [lc|jb|siriu|valmor]
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { parsePdf } from "../parser/pdf-parser.js";
import { latLonToUtm } from "../parser/geo/utm-calibrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

const ROUTES = {
  lc: {
    pdfPath: path.join(
      ROOT,
      "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf",
    ),
    groundTruthPath: path.join(FIXTURES, "luizcarolino-ground-truth.json"),
  },
  jb: {
    pdfPath: path.join(ROOT, "INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf"),
    groundTruthPath: path.join(FIXTURES, "joaoborn-ground-truth.json"),
  },
};

async function main() {
  const route = ROUTES[process.argv[2] ?? "lc"];
  const groundTruth = JSON.parse(readFileSync(route.groundTruthPath, "utf8"));
  const gtUtm = new Map(
    groundTruth.map((g) => {
      const u = latLonToUtm(g.lat, g.lon);
      return [g.number, { x: u.easting, y: u.northing }];
    }),
  );

  const pdfBuf = readFileSync(route.pdfPath);
  const parsed = await parsePdf(
    pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
  );
  if (parsed.error) throw new Error(`parsePdf: ${parsed.error}`);

  console.log("\nfrom→to  printed(m)  GT(m)   Δ(m)    source");
  const seen = [];
  for (const d of parsed.distances ?? []) {
    const a = gtUtm.get(d.from);
    const b = gtUtm.get(d.to);
    const gt = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : null;
    const delta = gt != null && d.meters > 0 ? d.meters - gt : null;
    seen.push({ from: d.from, to: d.to });
    console.log(
      `${String(d.from).padStart(4)}→${String(d.to).padEnd(4)} ${String(d.meters ?? "—").padStart(8)} ${gt == null ? "    n/a" : gt.toFixed(1).padStart(7)} ${delta == null ? "    n/a" : delta.toFixed(1).padStart(7)}    ${d.source ?? "?"}`,
    );
  }

  // consecutive GT spans with no distance entry at all
  const pairSet = new Set(seen.map((s) => `${Math.min(s.from, s.to)}-${Math.max(s.from, s.to)}`));
  const nums = groundTruth.map((g) => g.number).sort((a, b) => a - b);
  const missing = [];
  for (let i = 0; i + 1 < nums.length; i++) {
    const key = `${nums[i]}-${nums[i + 1]}`;
    if (!pairSet.has(key)) missing.push(key);
  }
  console.log(`\nconsecutive GT pairs with NO distance entry: ${missing.join(", ") || "none"}`);

  // raw label items near route (count only)
  console.log(`distanceLabelItems: ${(parsed.distanceLabelItems ?? []).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
