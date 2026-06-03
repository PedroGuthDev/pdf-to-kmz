// Compare associator consecutive edges vs ground-truth consecutive step distances (LC).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";
import { haversineMeters } from "./parser/geo/utm-calibrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.join(__dirname, "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf");
const GT = path.join(__dirname, "parser/__tests__/fixtures/luizcarolino-ground-truth.json");

const truth = JSON.parse(readFileSync(GT, "utf8"));
const byNum = new Map(truth.map(g => [g.number, g]));
const buf = readFileSync(PDF);
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const edge = (a,b) => (parsed.distances??[]).find(d => (d.from===a&&d.to===b)||(d.from===b&&d.to===a));

console.log("=== consecutive step: truth meters vs associator edge (posts 1..31) ===");
console.log("step    truthM   edgeM   src                   delta");
for (let n=1; n<=30; n++){
  const a=byNum.get(n), b=byNum.get(n+1);
  if(!a||!b) continue;
  const tm = haversineMeters(a.lat,a.lon,b.lat,b.lon);
  const e = edge(n, n+1);
  const em = e ? e.meters : null;
  const src = e ? (e.source ?? '') : 'MISSING';
  const delta = em!=null ? (em - tm) : null;
  const flag = (em==null || Math.abs(delta)>6) ? '  <==' : '';
  console.log(`${String(n).padStart(2)}->${String(n+1).padStart(2)}  ${tm.toFixed(1).padStart(6)}  ${em==null?'  null':em.toFixed(1).padStart(6)}  ${String(src).padEnd(20)}  ${delta==null?'   -':delta.toFixed(1).padStart(6)}${flag}`);
}

// also list any NON-consecutive (branch) edges present
console.log("\n=== non-consecutive edges (|from-to|>1) ===");
for (const d of (parsed.distances??[]).sort((x,y)=>Math.min(x.from,x.to)-Math.min(y.from,y.to))){
  if (Math.abs(d.from-d.to) > 1) console.log(`  ${d.from}->${d.to}  ${d.meters==null?'null':d.meters}  ${d.source??''}`);
}
