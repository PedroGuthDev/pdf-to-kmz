import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates, CALC_PIPELINE_ID } from "./parser/coordinate-calculator.js";
import { haversineMeters } from "./parser/geo/utm-calibrator.js";

function loadRef() {
  const refs = [];
  for (const line of readFileSync("./coordenadas postes rua joao born.txt", "utf8").split("\n")) {
    const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
    if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
  }
  return refs;
}

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
const posts = JSON.parse(JSON.stringify(parsed.posts));
const w5 = parsed.pageDimensions.get(5)?.w ?? 1191;
for (const p of posts) {
  if (p.pageNum === 5) {
    p.x = w5 - p.x;
    if (p.anchorX != null) p.anchorX = w5 - p.anchorX;
  }
}
const ref1 = loadRef().find((r) => r.num === 1);
const r = calculateCoordinates(
  posts,
  parsed.distances,
  ref1.lat,
  ref1.lon,
  parsed.cableSegments,
  {
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
    viewportBoxes: parsed.viewportBoxes,
    pageDimensions: parsed.pageDimensions,
    distanceLabelItems: parsed.distanceLabelItems,
    posteRawCentroids: parsed.posteRawCentroids,
  },
);
const ref = loadRef();
for (const n of [24, 25, 26, 27, 34]) {
  const p = r.posts.find((x) => x.number === n);
  const g = ref.find((x) => x.num === n);
  const e = haversineMeters(g.lat, g.lon, p.lat, p.lon);
  console.log(`Post ${n}: err=${e.toFixed(2)}m x=${p.x.toFixed(1)}`);
}
console.log("Pipeline:", CALC_PIPELINE_ID);
