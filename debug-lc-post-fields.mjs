// Dump full post fields (raw + deduped) to find why LC posts collapse to (305,302).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";
import { deduplicatePostsPreferLowerPage } from "./parser/post-assembler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.join(__dirname, "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf");
const buf = readFileSync(PDF);
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const rawPosts = parsed.posts ?? [];
const deduped = deduplicatePostsPreferLowerPage(rawPosts);

const fmt = (p) =>
  `n=${String(p.number).padStart(2)} pg=${p.pageNum ?? "?"} ` +
  `x=${(p.x ?? NaN).toFixed(0).padStart(5)} y=${(p.y ?? NaN).toFixed(0).padStart(5)} ` +
  `ax=${p.anchorX != null ? p.anchorX.toFixed(0).padStart(5) : "  -  "} ` +
  `ay=${p.anchorY != null ? p.anchorY.toFixed(0).padStart(5) : "  -  "} ` +
  `type=${p.postType ?? "-"}`;

console.log("=== RAW parsed.posts (all entries for nums 6..12,22,23) ===");
for (const p of rawPosts.filter((q) => [6,7,8,9,10,11,12,22,23].includes(q.number)).sort((a,b)=>a.number-b.number||((a.pageNum??0)-(b.pageNum??0)))) {
  console.log("  " + fmt(p));
}
console.log(`\nraw count=${rawPosts.length}  deduped count=${deduped.length}`);

console.log("\n=== DEDUPED posts (parsed.posts is post-pipeline; show 6..12,22,23) ===");
for (const p of deduped.filter((q) => [6,7,8,9,10,11,12,22,23].includes(q.number)).sort((a,b)=>a.number-b.number)) {
  console.log("  " + fmt(p));
}

// How many posts share x,y == (305,302) (±1)?
const collapsed = (parsed.posts ?? []).filter((p) => Math.abs((p.x??0)-305)<1.5 && Math.abs((p.y??0)-302)<1.5);
console.log(`\nposts with x,y ≈ (305,302): ${collapsed.map((p)=>p.number).sort((a,b)=>a-b).join(", ")}`);
