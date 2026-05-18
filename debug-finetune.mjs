import { readFileSync } from 'fs';
import { parsePdf } from './parser/pdf-parser.js';
import { calculateCoordinates } from './parser/coordinate-calculator.js';
import { haversineMeters } from './parser/geo/utm-calibrator.js';
import { nearestPointOnCablesOnPage } from './parser/cable-builder.js';

const REF = [
  { n: 3, lat: -27.659382015296377, lon: -48.700021269466035 },
  { n: 4, lat: -27.659346742194973, lon: -48.700345393166934 },
  { n: 9, lat: -27.65914949231848, lon: -48.70230140211723 },
];

const buf = readFileSync('./INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf');
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

console.log('Parsed positions (posts 2-4, 8-10):');
for (const n of [2, 3, 4, 5, 8, 9, 10]) {
  const p = parsed.posts.find(x => x.number === n);
  console.log(`  ${n}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) page=${p.pageNum} anchor=(${p.anchorX?.toFixed(2)},${p.anchorY?.toFixed(2)})`);
}

const cablesByPage = new Map();
for (const seg of parsed.cableSegments ?? []) {
  const pg = seg.pageNum ?? 0;
  if (!cablesByPage.has(pg)) cablesByPage.set(pg, []);
  cablesByPage.get(pg).push(seg.ops);
}

for (const n of [3, 4, 9]) {
  const p = parsed.posts.find(x => x.number === n);
  const near = nearestPointOnCablesOnPage(p.anchorX ?? p.x, p.anchorY ?? p.y, p.pageNum, cablesByPage);
  console.log(`\nPost ${n}: circle→cable d=${near.d.toFixed(1)}pt nearest=(${near.x.toFixed(1)},${near.y.toFixed(1)})`);
}

// Grid search ±40pt around posts 3,4,9
for (const ref of REF) {
  const p0 = parsed.posts.find(x => x.number === ref.n);
  let best = { err: Infinity };
  for (let dx = -60; dx <= 60; dx += 2) {
    for (let dy = -60; dy <= 60; dy += 2) {
      const posts = parsed.posts.map(p =>
        p.number === ref.n ? { ...p, x: p0.x + dx, y: p0.y + dy } : { ...p }
      );
      const { posts: out } = calculateCoordinates(
        posts,
        parsed.distances,
        -27.6594603999238,
        -48.699240275151034,
        parsed.cableSegments,
        {
          utmGridPathsPerPage: parsed.utmGridPathsPerPage,
          viewportBoxes: parsed.viewportBoxes,
          pageDimensions: parsed.pageDimensions,
        }
      );
      const o = out.find(x => x.number === ref.n);
      const err = haversineMeters(ref.lat, ref.lon, o.lat, o.lon);
      if (err < best.err) best = { err, dx, dy, x: p0.x + dx, y: p0.y + dy };
    }
  }
  console.log(`\nPost ${ref.n} best grid: err=${best.err.toFixed(2)}m offset=(${best.dx},${best.dy}) pos=(${best.x.toFixed(1)},${best.y.toFixed(1)}) vs now=(${p0.x.toFixed(1)},${p0.y.toFixed(1)})`);
}
