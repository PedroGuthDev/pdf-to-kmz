// Dump all LC posts: x,y vs anchorX,anchorY + divergence, to seed the per-post
// position truth fixture. Anchor = Numero_Poste label position (independent of
// the pole-symbol assignment), so |xy - anchor| flags the placement collapse.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.join(__dirname, "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf");
const buf = readFileSync(PDF);
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const posts = [...(parsed.posts ?? [])].sort((a, b) => a.number - b.number);
console.log("num pg    x     y    | ax    ay   | |xy-anchor|");
const truth = [];
for (const p of posts) {
  const ax = p.anchorX ?? p.x, ay = p.anchorY ?? p.y;
  const div = Math.hypot((p.x ?? ax) - ax, (p.y ?? ay) - ay);
  truth.push({ number: p.number, pageNum: p.pageNum ?? 1, x: Math.round(ax), y: Math.round(ay) });
  console.log(
    `${String(p.number).padStart(2)} p${String(p.pageNum ?? "?").padStart(2)} ` +
    `${(p.x ?? NaN).toFixed(0).padStart(5)} ${(p.y ?? NaN).toFixed(0).padStart(5)} | ` +
    `${ax.toFixed(0).padStart(5)} ${ay.toFixed(0).padStart(5)} | ${div.toFixed(0).padStart(5)}` +
    (div > 60 ? "  <== DIVERGED" : ""),
  );
}
console.log("\nTRUTH_JSON_START");
console.log(JSON.stringify(truth));
console.log("TRUTH_JSON_END");
