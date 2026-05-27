import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { associateDistances } from "./parser/distance-associator.js";
import { computeScaleFactor, haversineMeters } from "./parser/geo/utm-calibrator.js";

function alignSheetsAtCrossPageLabels(posts, distItems, pageDimensions) {
  const sorted = [...posts].sort((a, b) => a.number - b.number);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev.pageNum == null || curr.pageNum == null || prev.pageNum === curr.pageNum)
      continue;
    const w = pageDimensions.get(curr.pageNum)?.w;
    if (!w) continue;
    for (const dt of distItems ?? []) {
      if ((dt.pageNum ?? 1) !== curr.pageNum) continue;
      const norm = dt.str.trim().replace(",", ".");
      if (!/^\d+(\.\d+)?$/.test(norm)) continue;
      const lx = dt.x + (dt.width > 0 ? dt.width * 0.5 : 0);
      const toGap = Math.hypot(lx - curr.x, dt.y - curr.y);
      if (toGap < 150) continue;
      const labelLeft = lx < w * 0.45;
      const postRight = curr.x > w * 0.55;
      const labelRight = lx > w * 0.55;
      const postLeft = curr.x < w * 0.45;
      if ((labelLeft && postRight) || (labelRight && postLeft)) {
        for (const p of posts) {
          if (p.pageNum !== curr.pageNum) continue;
          p.x = w - p.x;
          if (p.anchorX != null) p.anchorX = w - p.anchorX;
        }
        break;
      }
    }
  }
}

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
const posts = JSON.parse(JSON.stringify(parsed.posts));
alignSheetsAtCrossPageLabels(
  posts,
  parsed.distanceLabelItems,
  parsed.pageDimensions,
);
let overviewScale = null;
for (const pn of [2, 3, 4, 5]) {
  const paths = parsed.utmGridPathsPerPage?.get(pn);
  if (paths?.length) {
    overviewScale = computeScaleFactor(paths, []);
    if (overviewScale != null) break;
  }
}
const perPageScale = (pn) => {
  const paths = parsed.utmGridPathsPerPage?.get(pn);
  if (paths?.length) {
    const sf = computeScaleFactor(paths, []);
    if (sf != null) return sf;
  }
  return overviewScale;
};
const { distances } = associateDistances(
  posts,
  parsed.distanceLabelItems,
  [],
  { perPageScale },
);
console.log("25→26", distances.find((d) => d.from === 25)?.meters);
const refs = [];
for (const line of readFileSync("./coordenadas postes rua joao born.txt", "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
}
const r = calculateCoordinates(
  posts,
  distances,
  refs.find((r) => r.num === 1).lat,
  refs.find((r) => r.num === 1).lon,
  parsed.cableSegments,
  {
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
    viewportBoxes: parsed.viewportBoxes,
    pageDimensions: parsed.pageDimensions,
    distanceLabelItems: parsed.distanceLabelItems,
    posteRawCentroids: parsed.posteRawCentroids,
  },
);
let ok = 0;
for (const g of refs) {
  const p = r.posts.find((x) => x.number === g.num);
  const e = haversineMeters(g.lat, g.lon, p.lat, p.lon);
  if (e < 5) ok++;
  if (g.num >= 24) console.log(`Post ${g.num} err ${e.toFixed(2)} x=${p.x.toFixed(0)}`);
}
console.log("<5m", ok, "/34");
