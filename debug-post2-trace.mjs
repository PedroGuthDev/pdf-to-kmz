// Trace: is post 2 considered for label-bracket snap?
import { parsePdf } from "./parser/pdf-parser.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);

// Post 2 is between 1 and 3. Both 1 and 3 need to be on-cable.
// Post 1 is the anchor; post 3 is on-cable post.
// Let's also check what auxiliary check returns for posts 1, 2, 3.
import { buildCablesByPage } from "./parser/cable-builder.js";

const cablesByPage = buildCablesByPage(parsed.cableSegments || parsed.cablePaths || []);
console.log("Cables built");

// Check if post 1 and 3 are on-cable (geometric)
const p1 = parsed.posts.find(p => p.number === 1);
const p2 = parsed.posts.find(p => p.number === 2);
const p3 = parsed.posts.find(p => p.number === 3);

console.log(`post 1: (${p1.x.toFixed(2)}, ${p1.y.toFixed(2)})`);
console.log(`post 2: (${p2.x.toFixed(2)}, ${p2.y.toFixed(2)})`);
console.log(`post 3: (${p3.x.toFixed(2)}, ${p3.y.toFixed(2)})`);

// Page 3 cables
const cables = cablesByPage.get(3) || [];
console.log(`Cable segments on page 3: ${cables.length}`);

// For each post, find nearest cable point and the perpendicular distance
function nearestOnCable(post, cables) {
  let best = Infinity;
  let bestPt = null;
  for (const cable of cables) {
    const pts = cable.points || cable;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-9) continue;
      const t = Math.max(0, Math.min(1, ((post.x - a.x) * dx + (post.y - a.y) * dy) / len2));
      const px = a.x + t * dx, py = a.y + t * dy;
      const d = Math.hypot(post.x - px, post.y - py);
      if (d < best) {
        best = d;
        bestPt = { x: px, y: py };
      }
    }
  }
  return { dist: best, pt: bestPt };
}

for (const p of [p1, p2, p3]) {
  const r = nearestOnCable(p, cables);
  console.log(`  post ${p.number}: nearest cable pt = ${r.pt ? `(${r.pt.x.toFixed(1)}, ${r.pt.y.toFixed(1)})` : 'none'} dist=${r.dist.toFixed(2)}pt = ${(r.dist * 0.3546).toFixed(2)}m`);
}
