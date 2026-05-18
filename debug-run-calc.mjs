/**
 * End-to-end coordinate check vs coordenadas postes.txt
 * Run: node debug-run-calc.mjs
 *
 * Parser x,y: reads PARSE DEBUG DUMP from debug_results.txt (browser UAT export).
 * Node OCR cannot render red rings — falls back to that file when parsePdf returns < 11 posts.
 */
import { readFileSync, existsSync } from 'fs';
import { parsePdf } from './parser/pdf-parser.js';
import { calculateCoordinates } from './parser/coordinate-calculator.js';
import { associateDistances } from './parser/distance-associator.js';
import { haversineMeters } from './parser/geo/utm-calibrator.js';

const REFERENCE = [
  { num: 1, lat: -27.6594603999238, lon: -48.699240275151034 },
  { num: 2, lat: -27.65942120761788, lon: -48.699602010469185 },
  { num: 3, lat: -27.659382015296377, lon: -48.700021269466035 },
  { num: 4, lat: -27.659346742194973, lon: -48.700345393166934 },
  { num: 5, lat: -27.65930559022924, lon: -48.700762439716044 },
  { num: 6, lat: -27.659270317104404, lon: -48.70108213852094 },
  { num: 7, lat: -27.659231796350753, lon: -48.70147947750159 },
  { num: 8, lat: -27.65918966453256, lon: -48.70188546179813 },
  { num: 9, lat: -27.65914949231848, lon: -48.70230140211723 },
  { num: 10, lat: -27.6591063806582, lon: -48.702660924999286 },
  { num: 11, lat: -27.659066208413993, lon: -48.702999429619396 },
];

/** @returns {Array<{ number: number, pageNum: number, x: number, y: number }> | null} */
function loadPostsFromDebugResults(path = './debug_results.txt') {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const posts = [];
  for (const line of text.split('\n')) {
    const m = line.match(/Post\s+(\d+):\s+page=(\d+)\s+x=([\d.]+)\s+y=([\d.]+)/);
    if (!m) continue;
    posts.push({
      number: parseInt(m[1], 10),
      pageNum: parseInt(m[2], 10),
      x: parseFloat(m[3]),
      y: parseFloat(m[4]),
    });
  }
  posts.sort((a, b) => a.number - b.number);
  return posts.length >= 11 ? posts : null;
}

const buf = readFileSync('./INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf');
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

if (parsed.error) {
  console.error('parsePdf failed:', parsed);
  process.exit(1);
}

console.log('Parsed posts (Node OCR):', parsed.posts.length);
for (const p of parsed.posts) {
  console.log(
    `  Post ${String(p.number).padStart(2)}: page=${p.pageNum}  x=${p.x.toFixed(2)}  y=${p.y.toFixed(2)}`
  );
}

const browserPosts = loadPostsFromDebugResults();
let parserPosts = parsed.posts;

if (parserPosts.length < 11) {
  if (browserPosts) {
    console.warn(
      `\nParser: ${parserPosts.length}/11 posts — using debug_results.txt (browser parse dump).\n`
    );
    parserPosts = browserPosts.map(p => ({ ...p }));
  } else {
    console.error('No posts from parser and no debug_results.txt parse dump.');
    process.exit(1);
  }
} else if (browserPosts) {
  console.log('\nBrowser debug_results.txt positions (comparison only — using parser positions):');
  for (const p of browserPosts) {
    console.log(
      `  Post ${String(p.number).padStart(2)}: page=${p.pageNum}  x=${p.x.toFixed(2)}  y=${p.y.toFixed(2)}`
    );
  }
  console.log('');
}

const start = REFERENCE[0];
let distances = parsed.distances ?? [];
if (browserPosts && parsed.distanceLabelItems?.length) {
  const { distances: assoc } = associateDistances(
    parserPosts,
    parsed.distanceLabelItems,
    []
  );
  const labeled = assoc.filter(d => d.meters != null && d.meters > 0).length;
  if (labeled >= 3) {
    distances = assoc;
    console.log(`\nDistância_Poste labels (${labeled} segments):`);
    for (const d of assoc) {
      if (d.meters != null) console.log(`  ${d.from}→${d.to}: ${d.meters} m`);
    }
  }
}

const { posts, warnings = [] } = calculateCoordinates(
  parserPosts,
  distances,
  start.lat,
  start.lon,
  parsed.cableSegments ?? [],
  {
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
    viewportBoxes: parsed.viewportBoxes,
    pageDimensions: parsed.pageDimensions,
    // Uncomment the line below to enable 2nd-anchor similarity refinement (D-ACC-07).
    // Uses post 11 ground-truth GPS to pin both ends and refine middle posts.
    // lastPostGps: { lat: REFERENCE[10].lat, lon: REFERENCE[10].lon },
  }
);

console.log('\nComparison vs reference:');
let maxErr = 0;
let nulls = 0;
for (const ref of REFERENCE) {
  const p = posts.find(x => x.number === ref.num);
  if (!p || p.lat == null) {
    console.log(`  Post ${String(ref.num).padStart(2)}: NO GPS`);
    nulls++;
    continue;
  }
  const err = haversineMeters(ref.lat, ref.lon, p.lat, p.lon);
  maxErr = Math.max(maxErr, err);
  const mark = err < 5 ? '✓' : err < 50 ? '~' : '✗';
  console.log(`  ${mark} Post ${String(ref.num).padStart(2)}: err=${err.toFixed(2)}m  page=${p.pageNum}`);
}
console.log(`\nMax error: ${maxErr.toFixed(2)}m  null GPS: ${nulls}/11`);
const allWarnings = [...(parsed.warnings ?? []), ...warnings];
if (allWarnings.length) {
  console.log('\nWarnings (first 8):');
  for (const w of allWarnings.slice(0, 8)) console.log(' ', w);
}
