// Throwaway probe: does Palhoca.dxf contain the Luiz Carolino route?
// Compares Poste-layer INSERT UTM bounds vs ground-truth coords (converted to UTM).
import { readFileSync } from "node:fs";
import { parseDxfText } from "./parser/dwg/dxf-loader.js";
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const dxfText = readFileSync("Palhoca.dxf", "latin1");
console.log(`DXF bytes: ${dxfText.length}`);
const { posts, extmin, extmax } = parseDxfText(dxfText);
console.log(`Poste INSERTs: ${posts.length}`);
if (posts.length) {
  const xs = posts.map((p) => p.x), ys = posts.map((p) => p.y);
  console.log(`Poste UTM bounds: x[${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)}] y[${Math.min(...ys).toFixed(0)}..${Math.max(...ys).toFixed(0)}]`);
}
console.log(`EXTMIN/MAX: x[${extmin.x.toFixed(0)}..${extmax.x.toFixed(0)}] y[${extmin.y.toFixed(0)}..${extmax.y.toFixed(0)}]`);

// Ground truth -> UTM
const gtRaw = readFileSync("coordenadas postes rua luiz carolino pereira..txt", "utf8");
const gt = [];
for (const line of gtRaw.split(/\r?\n/)) {
  const m = line.match(/Poste\s+(\d+);\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (m) gt.push({ n: +m[1], lat: +m[2], lon: +m[3] });
}
console.log(`\nGround-truth posts: ${gt.length}`);
const gtUtm = gt.map((g) => ({ ...g, ...latLonToUtm(g.lat, g.lon) }));
const gxs = gtUtm.map((g) => g.easting), gys = gtUtm.map((g) => g.northing);
console.log(`GT UTM bounds:    x[${Math.min(...gxs).toFixed(0)}..${Math.max(...gxs).toFixed(0)}] y[${Math.min(...gys).toFixed(0)}..${Math.max(...gys).toFixed(0)}]`);

// For each GT post, nearest Poste INSERT distance
let within5 = 0, within20 = 0, sum = 0;
for (const g of gtUtm) {
  let best = Infinity;
  for (const p of posts) {
    const d = Math.hypot(p.x - g.easting, p.y - g.northing);
    if (d < best) best = d;
  }
  sum += best;
  if (best <= 5) within5++;
  if (best <= 20) within20++;
}
console.log(`\nNearest Poste-INSERT to each GT post:`);
console.log(`  within 5m:  ${within5}/${gt.length}`);
console.log(`  within 20m: ${within20}/${gt.length}`);
console.log(`  mean nearest: ${(sum / gt.length).toFixed(1)} m`);
console.log(within20 >= gt.length * 0.8 ? "\n=> MATCH: Palhoca.dxf contains the Luiz Carolino route." : "\n=> NO MATCH (or different georef): route not clearly present.");
