// Check the labelled distance 1→2 vs PDF chord vs reference UTM chord
import { parsePdf } from "./parser/pdf-parser.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);

const p1 = parsed.posts.find(p => p.number === 1);
const p2 = parsed.posts.find(p => p.number === 2);
const p3 = parsed.posts.find(p => p.number === 3);
console.log("post1:", { x: p1.x, y: p1.y, page: p1.pageNum, anchorX: p1.anchorX, anchorY: p1.anchorY });
console.log("post2:", { x: p2.x, y: p2.y, page: p2.pageNum, anchorX: p2.anchorX, anchorY: p2.anchorY });
console.log("post3:", { x: p3.x, y: p3.y, page: p3.pageNum, anchorX: p3.anchorX, anchorY: p3.anchorY });

const dist12 = parsed.distances?.find(d => (d.from === 1 && d.to === 2) || (d.from === 2 && d.to === 1));
const dist23 = parsed.distances?.find(d => (d.from === 2 && d.to === 3) || (d.from === 3 && d.to === 2));
const dist13 = parsed.distances?.find(d => (d.from === 1 && d.to === 3) || (d.from === 3 && d.to === 1));
console.log("dist 1->2:", dist12);
console.log("dist 2->3:", dist23);
console.log("dist 1->3:", dist13);

// chord lengths
const sf = 0.354610;
const c12 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
const c23 = Math.hypot(p3.x - p2.x, p3.y - p2.y);
const c13 = Math.hypot(p3.x - p1.x, p3.y - p1.y);
console.log(`pdf chord 1->2: ${c12.toFixed(2)}pt = ${(c12 * sf).toFixed(2)}m`);
console.log(`pdf chord 2->3: ${c23.toFixed(2)}pt = ${(c23 * sf).toFixed(2)}m`);
console.log(`pdf chord 1->3: ${c13.toFixed(2)}pt = ${(c13 * sf).toFixed(2)}m`);

// Reference distances on the ground
function meters(lat1, lon1, lat2, lon2) {
  const R = 6378137;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlmb = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlmb / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const ref1 = { lat: -27.641966601540403, lon: -48.66305968585957 };
const ref2 = { lat: -27.64189640868478, lon: -48.66274618461442 };
const ref3 = { lat: -27.641835371382406, lon: -48.66249641713888 };
console.log(`ref 1->2 ground: ${meters(ref1.lat, ref1.lon, ref2.lat, ref2.lon).toFixed(2)}m`);
console.log(`ref 2->3 ground: ${meters(ref2.lat, ref2.lon, ref3.lat, ref3.lon).toFixed(2)}m`);
console.log(`ref 1->3 ground: ${meters(ref1.lat, ref1.lon, ref3.lat, ref3.lon).toFixed(2)}m`);
