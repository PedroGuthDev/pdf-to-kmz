// Label-graph degree per LC post (junctions = deg>=3). Tells us if rehomeBranchArmLabels can even fire.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const which = process.argv[2] ?? "lc";
const PDF = which==="jb"
  ? path.join(__dirname, "INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf")
  : path.join(__dirname, "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf");
const buf = readFileSync(PDF);
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength));

const deg = new Map();
for (const d of parsed.distances??[]) {
  if (d.meters==null) continue;
  for (const [a,b] of [[d.from,d.to],[d.to,d.from]]) {
    if(!deg.has(a)) deg.set(a,new Set());
    deg.get(a).add(b);
  }
}
console.log("=== label-graph degree (meters!=null edges) ===");
const junctions=[];
for (const [n,s] of [...deg].sort((x,y)=>x[0]-y[0])) {
  const mark = s.size>=3 ? '  <== JUNCTION(deg>=3)' : '';
  if (s.size>=3) junctions.push(n);
  console.log(`post ${String(n).padStart(3)}  deg ${s.size}  [${[...s].sort((a,b)=>a-b).join(',')}]${mark}`);
}
console.log("\nlabel-graph junctions (deg>=3):", junctions.length?junctions.join(','):'NONE');

// page per post
const pg = new Map();
for (const p of parsed.posts??[]) pg.set(p.number, p.pageNum);
console.log("\n=== post -> page ===");
const rows=[...pg].sort((a,b)=>a[0]-b[0]).map(([n,p])=>`${n}:p${p}`);
console.log(rows.join('  '));
