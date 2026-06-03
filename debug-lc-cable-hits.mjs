// Probe: how do LC posts 8-12 snap to the page-4 cable paths? (pathIndex, t, d)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";
import { buildCablesByPage, nearestCableHitOnPage } from "./parser/cable-builder.js";
import { deduplicatePostsPreferLowerPage } from "./parser/post-assembler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.join(__dirname, "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf");
const buf = readFileSync(PDF);
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const posts = deduplicatePostsPreferLowerPage(parsed.posts ?? []);
const cbp = buildCablesByPage(parsed.cablePaths ?? parsed.allCablePaths ?? []);

console.log("cablePaths total:", (parsed.cablePaths ?? []).length, " pages:", [...cbp.keys()]);
for (const [pg, paths] of cbp) console.log(`  page ${pg}: ${paths.length} path(s)`);
console.log("\nnum page  x      y      pathIdx   t        d(pt)");
for (const n of [6,7,8,9,10,11,12,22,23]) {
  const p = posts.find((q) => q.number === n);
  if (!p) { console.log(`${n}: (not found)`); continue; }
  const pg = p.pageNum ?? 1;
  const ax = p.anchorX ?? p.x, ay = p.anchorY ?? p.y;
  const h = nearestCableHitOnPage(ax, ay, pg, cbp);
  console.log(
    `${String(n).padStart(2)}  p${String(pg).padStart(2)}  ${ax.toFixed(0).padStart(5)}  ${ay.toFixed(0).padStart(5)}  ` +
    `${String(h.pathIndex).padStart(5)}   ${h.t.toFixed(1).padStart(7)}  ${h.d.toFixed(1).padStart(6)}`,
  );
}
