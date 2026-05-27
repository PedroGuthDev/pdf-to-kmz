// Compare warnings between baseline and post-7-override
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { haversineMeters } from "./parser/geo/utm-calibrator.js";

const refs = [];
for (const line of readFileSync("./coordenadas postes rua joao born.txt", "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
}

async function run(overrides) {
  const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
  const parsed = await parsePdf(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  for (const o of overrides) {
    const p = parsed.posts.find(x => x.number === o.num);
    p.x = o.x; p.y = o.y;
    p.anchorX = o.x; p.anchorY = o.y;
  }
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
  return r;
}

const base = await run([]);
const r7 = await run([{ num: 7, x: 674.54, y: 283.74 }]);

console.log("=== BASELINE warnings (filtered for refit/zone/lsq) ===");
for (const w of base.warnings) {
  if (/anchor-refit|distortion-zone|label-lsq|split-region|cable-arc-placer/i.test(w)) {
    console.log(" ", w);
  }
}

console.log("\n=== POST 7 OVERRIDE warnings (filtered) ===");
for (const w of r7.warnings) {
  if (/anchor-refit|distortion-zone|label-lsq|split-region|cable-arc-placer/i.test(w)) {
    console.log(" ", w);
  }
}
