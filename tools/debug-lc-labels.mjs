#!/usr/bin/env node
/**
 * Dump raw Distância_Poste label items + post anchor positions for chosen
 * post windows, to see crossing/split-span geometry in PDF page coords.
 *
 * Run: node tools/debug-lc-labels.mjs [route] [postMin] [postMax]
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { parsePdf } from "../parser/pdf-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const ROUTES = {
  lc: path.join(ROOT, "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf"),
  jb: path.join(ROOT, "INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf"),
};

async function main() {
  const routeKey = process.argv[2] ?? "lc";
  const lo = Number(process.argv[3] ?? 1);
  const hi = Number(process.argv[4] ?? 99);

  const pdfBuf = readFileSync(ROUTES[routeKey]);
  const parsed = await parsePdf(
    pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
  );
  if (parsed.error) throw new Error(parsed.error);

  const posts = (parsed.posts ?? [])
    .filter((p) => p.number >= lo && p.number <= hi)
    .sort((a, b) => a.number - b.number);

  console.log("\nposts (page coords):");
  for (const p of posts) {
    console.log(
      `  post ${String(p.number).padStart(3)}  page=${p.pageNum}  x=${(p.anchorX ?? p.x).toFixed(1)} y=${(p.anchorY ?? p.y).toFixed(1)}${p.anchorX != null ? ` (anchor; sym=${p.x.toFixed(1)},${p.y.toFixed(1)})` : ""}`,
    );
  }

  // labels near these posts (within 120pt of any)
  console.log("\nDistância_Poste labels within 120pt of those posts:");
  for (const dt of parsed.distanceLabelItems ?? []) {
    const w = typeof dt.width === "number" && dt.width > 0 ? dt.width : 0;
    const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
    const ly = dt.y;
    let nearest = null;
    let nd = Infinity;
    for (const p of posts) {
      if (dt.pageNum != null && p.pageNum != null && dt.pageNum !== p.pageNum) continue;
      const d = Math.hypot((p.anchorX ?? p.x) - lx, (p.anchorY ?? p.y) - ly);
      if (d < nd) {
        nd = d;
        nearest = p.number;
      }
    }
    if (nd <= 120) {
      console.log(
        `  "${dt.str.trim()}"  page=${dt.pageNum}  x=${lx.toFixed(1)} y=${ly.toFixed(1)}  nearest=post ${nearest} (${nd.toFixed(0)}pt)`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
