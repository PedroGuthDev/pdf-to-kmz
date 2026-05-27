import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { haversineMeters } from "./parser/geo/utm-calibrator.js";

const refs = [];
for (const line of readFileSync("./coordenadas postes rua joao born.txt", "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
}
const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
const p26 = parsed.posts.find((p) => p.number === 26);
console.log("parse post 26", p26?.x?.toFixed(1), "25→26", parsed.distances.find((d) => d.from === 25)?.meters);
const r1 = refs.find((r) => r.num === 1);
const postsCopy = JSON.parse(JSON.stringify(parsed.posts));
const r = calculateCoordinates(
  postsCopy,
  parsed.distances,
  r1.lat,
  r1.lon,
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
  if (g.num >= 24) console.log(`Post ${g.num}: ${e.toFixed(2)}m`);
}
console.log("<5m", ok, "/34");
console.log(
  r.warnings.filter((w) => /sheet entry|boundary-locked|25→26|mirrored route/.test(w)).slice(0, 5),
);
