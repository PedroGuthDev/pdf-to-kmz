// JB front: DXF cable adjacency among true nodes of posts 1-13.
// Which poles are cable-connected, and what are the edge lengths?
import { readFileSync } from "node:fs";
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const FIX = "parser/__tests__/fixtures/";
const gt = JSON.parse(readFileSync(FIX + "joaoborn-ground-truth.json", "utf8"));
const raw = JSON.parse(readFileSync(FIX + "joaoborn-dwg-region.json", "utf8"));
const nodes = raw.posts;
const edges = raw.cableEdges ?? [];
console.log(`region: ${nodes.length} posts, ${edges.length} cable edges, sample edge:`, JSON.stringify(edges[0]));

const trueIdx = new Map();
for (const g of gt.filter((g) => g.number <= 13)) {
  const u = latLonToUtm(g.lat, g.lon);
  let bd = Infinity, bi = -1;
  for (let i = 0; i < nodes.length; i++) {
    const d = Math.hypot(nodes[i].x - u.easting, nodes[i].y - u.northing);
    if (d < bd) { bd = d; bi = i; }
  }
  trueIdx.set(g.number, { i: bi, d: bd });
}

// Build node adjacency from cable edges: edges may be coordinate pairs.
// Snap edge endpoints to nearest node within 1.5m.
function nearNode(x, y) {
  let bd = Infinity, bi = -1;
  for (let i = 0; i < nodes.length; i++) {
    const d = Math.hypot(nodes[i].x - x, nodes[i].y - y);
    if (d < bd) { bd = d; bi = i; }
  }
  return bd < 2 ? bi : -1;
}
const adj = new Map();
for (const e of edges) {
  const x1 = e.a?.x ?? e.x1, y1 = e.a?.y ?? e.y1;
  const x2 = e.b?.x ?? e.x2, y2 = e.b?.y ?? e.y2;
  if (x1 == null) continue;
  const a = nearNode(x1, y1), b = nearNode(x2, y2);
  if (a < 0 || b < 0 || a === b) continue;
  if (!adj.has(a)) adj.set(a, new Set());
  if (!adj.has(b)) adj.set(b, new Set());
  adj.get(a).add(b);
  adj.get(b).add(a);
}

const idxToPost = new Map();
for (const [num, { i }] of trueIdx) idxToPost.set(i, num);

console.log("\npost(node) -> cable neighbors (post# if a true node, else idx@dist):");
for (const [num, { i, d }] of [...trueIdx].sort((a, b) => a[0] - b[0])) {
  const nbs = [...(adj.get(i) ?? [])].map((j) => {
    const span = Math.hypot(nodes[j].x - nodes[i].x, nodes[j].y - nodes[i].y);
    const p = idxToPost.get(j);
    return p != null ? `P${p}(${span.toFixed(1)}m)` : `n${j}(${span.toFixed(1)}m)`;
  });
  console.log(`P${num} (gtdist ${d.toFixed(1)}): ${nbs.join(", ")}`);
}
