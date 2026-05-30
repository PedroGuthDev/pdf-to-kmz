// Where would post 2 fall if we walked the CABLE PATH from post 1?
import { parsePdf } from "./parser/pdf-parser.js";
import { buildCablesByPage } from "./parser/cable-builder.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);
const cablesByPage = buildCablesByPage(parsed.cableSegments || parsed.cablePaths || []);
const cable = cablesByPage.get(3)[0];

// cable is an array of {type, x, y} ops. The path on page 3 goes ~265 → 1140 in x.
// Find the closest point on the cable polyline to post 1 (272.66, 444.30) and post 3 (436.82, 396.78)
// Then compute the arc length between those two points.

const ops = cable;
// Build polyline points
const pts = [];
for (const op of ops) {
  if (op.type === 'M' || op.type === 'L') pts.push({ x: op.x, y: op.y });
}
console.log(`Cable has ${pts.length} polyline points`);

// Find closest point on polyline (parametric t along total arc) to a given (px, py)
function closestParametric(pts, px, py) {
  let bestArc = 0, bestDist2 = Infinity, bestPt = null;
  let accArc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i+1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (segLen * segLen)));
    const ex = a.x + t * dx, ey = a.y + t * dy;
    const d2 = (px - ex) ** 2 + (py - ey) ** 2;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      bestArc = accArc + t * segLen;
      bestPt = { x: ex, y: ey };
    }
    accArc += segLen;
  }
  return { arcLen: bestArc, dist: Math.sqrt(bestDist2), pt: bestPt, totalArc: accArc };
}

const c1 = closestParametric(pts, 272.66, 444.30);
const c2 = closestParametric(pts, 342.38, 428.82);
const c3 = closestParametric(pts, 436.82, 396.78);
console.log(`closest to post 1: arc=${c1.arcLen.toFixed(2)}pt at (${c1.pt.x.toFixed(2)}, ${c1.pt.y.toFixed(2)}) dist=${c1.dist.toFixed(2)}pt`);
console.log(`closest to post 2: arc=${c2.arcLen.toFixed(2)}pt at (${c2.pt.x.toFixed(2)}, ${c2.pt.y.toFixed(2)}) dist=${c2.dist.toFixed(2)}pt`);
console.log(`closest to post 3: arc=${c3.arcLen.toFixed(2)}pt at (${c3.pt.x.toFixed(2)}, ${c3.pt.y.toFixed(2)}) dist=${c3.dist.toFixed(2)}pt`);

// Frac of post 2 along cable arc from post 1 to post 3:
const cableFrac = (c2.arcLen - c1.arcLen) / (c3.arcLen - c1.arcLen);
console.log(`Cable arc fraction 1->2 / 1->3 = ${cableFrac.toFixed(3)}`);
console.log(`Cable arc length 1->3: ${(c3.arcLen - c1.arcLen).toFixed(2)}pt = ${((c3.arcLen - c1.arcLen) * 0.354610).toFixed(2)}m`);
