// Diagnostic: does the branch-arm rehome fire on the LC PDF? Dump assoc edges 1-20.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const which = process.argv[2] ?? "lc";
const PDF = which === "jb"
  ? path.join(__dirname, "INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf")
  : path.join(__dirname, "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf");

const buf = readFileSync(PDF);
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
if (parsed.error) { console.error("parse error", parsed.error); process.exit(1); }

console.log("=== PDF:", path.basename(PDF));
console.log("posts:", parsed.posts?.length, "distances:", parsed.distances?.length,
  "cableSegments:", parsed.cableSegments?.length);
console.log("viewportBoxes:", parsed.viewportBoxes?.length,
  "=> multiSheetRoute(>=3):", (parsed.viewportBoxes?.length ?? 0) >= 3);
const pages = new Set((parsed.posts ?? []).map(p => p.pageNum));
console.log("distinct post pages:", [...pages].sort((a,b)=>a-b));

// rehome-related warnings
const w = parsed.warnings ?? [];
const rehomeW = w.filter(s => /rehome|branch-arm|Sheet-break bifurcation|bifurcation|seam-lock|multi-sheet|swap|phantom/i.test(s));
console.log("\n=== rehome/bifurcation/seam warnings (" + rehomeW.length + ") ===");
for (const s of rehomeW) console.log("  ", s);

// dump edges sources around 1-31
console.log("\n=== distance edges (from<=32) ===");
const ds = (parsed.distances ?? [])
  .filter(d => Math.min(d.from, d.to) <= 32)
  .sort((a,b)=> (Math.min(a.from,a.to))-(Math.min(b.from,b.to)) || a.from-b.from);
for (const d of ds) {
  console.log(`  ${String(d.from).padStart(3)}->${String(d.to).padStart(3)}  ${d.meters==null?'null':String(d.meters).padStart(6)}  ${d.source ?? ''}`);
}

// count source types
const bySrc = new Map();
for (const d of parsed.distances ?? []) bySrc.set(d.source ?? 'none', (bySrc.get(d.source ?? 'none')||0)+1);
console.log("\n=== edge source histogram ===");
for (const [s,c] of [...bySrc].sort((a,b)=>b[1]-a[1])) console.log(`  ${c}  ${s}`);
