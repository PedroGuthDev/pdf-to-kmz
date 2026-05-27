// Confirm what positions parsePdf actually produces (browser path)
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

console.log("All parsed.posts on pages 3, 4, 5:");
for (const p of parsed.posts.sort((a,b)=>a.number-b.number)) {
  if (p.pageNum >= 3 && p.pageNum <= 5) {
    console.log(`  Post ${String(p.number).padStart(2)}: page=${p.pageNum} x=${p.x.toFixed(1)} y=${p.y.toFixed(1)}`);
  }
}

console.log("\nDistances on page 3:");
for (const d of parsed.distances) {
  if (d.from >= 1 && d.from <= 14) {
    console.log(`  ${d.from}->${d.to}: ${d.meters}m`);
  }
}

console.log("\nWarnings filtered (N3, prefill, post-positioning):");
for (const w of parsed.warnings) {
  if (/N3|prefill|post-positioning|pole/i.test(w)) {
    console.log("  " + w);
  }
}
