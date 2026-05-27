// Check what's the projected GPS for post 2 right after coord calc, and where it would be if we moved its PDF position
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);

const result = calculateCoordinates(parsed.posts, parsed.distances, [], parsed.viewportBoxes, parsed.pageDimensions, parsed.utmGridPathsPerPage, parsed.cablePaths || []);

const ref = { lat: -27.64189640868478, lon: -48.66274618461442 }; // post 2
const p2 = result.find(p => p.number === 2);
console.log("post 2 final:", { lat: p2.lat, lon: p2.lon });
function meters(a, b) {
  const R = 6378137;
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dphi = ((b.lat - a.lat) * Math.PI) / 180;
  const dlmb = ((b.lon - a.lon) * Math.PI) / 180;
  const aa = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlmb / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(aa));
}
console.log(`err: ${meters(p2, ref).toFixed(2)}m`);

// Now move post 2 to PDF (359.04, 419.29) — where label-walking 31.89m from post 1 lands
const parsed2 = await parsePdf(pdfBytes.buffer);
const p2b = parsed2.posts.find(p => p.number === 2);
p2b.x = 359.04;
p2b.y = 419.29;
p2b.anchorX = 359.04;
p2b.anchorY = 419.29;
const result2 = calculateCoordinates(parsed2.posts, parsed2.distances, [], parsed2.viewportBoxes, parsed2.pageDimensions, parsed2.utmGridPathsPerPage, parsed2.cablePaths || []);
const p2c = result2.find(p => p.number === 2);
console.log("post 2 (relocated) final:", { lat: p2c.lat, lon: p2c.lon });
console.log(`relocated err: ${meters(p2c, ref).toFixed(2)}m`);

// And the rest of page 3?
for (let i = 1; i <= 14; i++) {
  const p = result2.find(p => p.number === i);
  if (!p) continue;
}
