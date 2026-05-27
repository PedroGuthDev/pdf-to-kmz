// Check if there's a Poste graphic at the LABEL anchor position for posts 7, 8, 9
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

// All raw centroids on page 3
const page3Symbols = (parsed.posteRawCentroids ?? []).filter(c => c.pageNum === 3 || c.page === 3);
// Show ALL symbols (not deduped) — sometimes there are duplicates at same position
console.log(`Total raw symbols on page 3: ${page3Symbols.length}`);

// For each post 7, 8, 9: check if there's a symbol within 15pt of (post.x, post.y) — should be label anchor
for (const n of [7, 8, 9]) {
  const p = parsed.posts.find(x => x.number === n);
  console.log(`\nPost ${n}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
  const nearLabel = page3Symbols.filter(s => Math.hypot(s.x - p.x, s.y - p.y) < 30);
  console.log(`  ${nearLabel.length} symbols within 30pt of post position`);
  for (const s of nearLabel) {
    console.log(`    (${s.x.toFixed(2)}, ${s.y.toFixed(2)}) d=${Math.hypot(s.x - p.x, s.y - p.y).toFixed(2)}pt  layer=${s.layer ?? '?'}`);
  }
}
