/**
 * End-to-end coordinate check vs reference coordinate files.
 * Run:
 *   node debug-run-calc.mjs              # Valmor (default)
 *   node debug-run-calc.mjs joao-born    # João Born multi-sheet
 *   node debug-run-calc.mjs joao-born --two-anchor
 *   node debug-run-calc.mjs joao-born --parser-posts   # use parsePdf Poste positions (N3)
 *   node debug-run-calc.mjs joao-born --overview-composite  # remap detail sheets → page 2 space
 *   node debug-run-calc.mjs joao-born --browser-posts      # true Poste snaps (fixtures/)
 *
 * João Born UAT positions: PARSE DEBUG block in debug_results.txt (parser export order).
 * fixtures/joao-born-browser-posts.json is route-numbered Poste snaps — different numbering.
 */
import { readFileSync, existsSync } from 'fs';
import { parsePdf } from './parser/pdf-parser.js';
import { calculateCoordinates } from './parser/coordinate-calculator.js';
import { associateDistances } from './parser/distance-associator.js';
import { assignPolesGloballyByLabels } from './parser/post-positioning.js';
import { applyOverviewComposite } from './parser/geo/overview-composite.js';
import { computeScaleFactor, haversineMeters } from './parser/geo/utm-calibrator.js';

const SAMPLES = {
  valmor: {
    pdf: './INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf',
    minPosts: 11,
    refFile: null,
  },
  'joao-born': {
    pdf: './INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf',
    minPosts: 30,
    refFile: './coordenadas postes rua joao born.txt',
  },
};

const sampleKey = process.argv[2] === 'joao-born' ? 'joao-born' : 'valmor';
const twoAnchor = process.argv.includes('--two-anchor');
const forceParserPosts = process.argv.includes('--parser-posts');
const useBrowserFixture = process.argv.includes('--browser-posts');
const overviewComposite = process.argv.includes('--overview-composite');
const JOAO_BORN_FIXTURE = './fixtures/joao-born-browser-posts.json';
const sample = SAMPLES[sampleKey];

/** @returns {Array<{ num: number, lat: number, lon: number }>} */
function loadReferenceFromTxt(path) {
  const text = readFileSync(path, 'utf8');
  const refs = [];
  for (const line of text.split('\n')) {
    const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
    if (!m) continue;
    refs.push({ num: parseInt(m[1], 10), lat: parseFloat(m[2]), lon: parseFloat(m[3]) });
  }
  refs.sort((a, b) => a.num - b.num);
  return refs;
}

const REFERENCE = sample.refFile
  ? loadReferenceFromTxt(sample.refFile)
  : [
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

/** @returns {{ posts: Array, distances?: Array } | null} */
function loadJoaoBornFixture() {
  if (!existsSync(JOAO_BORN_FIXTURE)) return null;
  const data = JSON.parse(readFileSync(JOAO_BORN_FIXTURE, 'utf8'));
  const posts = Array.isArray(data) ? data : data.posts;
  const distances = Array.isArray(data) ? null : data.distances;
  if (!posts?.length || posts.length < 30) return null;
  return { posts, distances };
}

/** @returns {Array<{ number: number, pageNum: number, x: number, y: number }> | null} */
function loadPostsFromDebugResults(path = './debug_results.txt') {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const dumpIdx = text.indexOf('PARSE DEBUG DUMP');
  const block =
    dumpIdx >= 0
      ? text.slice(dumpIdx, text.indexOf('\nPage dimensions', dumpIdx))
      : text;
  /** @type {Map<number, { number: number, pageNum: number, x: number, y: number }>} */
  const byNum = new Map();
  for (const line of block.split('\n')) {
    if (line.includes('lat=') || line.includes('lon=')) continue;
    const m = line.match(/Post\s+(\d+):\s+page=(\d+)\s+x=([\d.]+)\s+y=([\d.]+)/);
    if (!m) continue;
    const number = parseInt(m[1], 10);
    if (byNum.has(number)) continue;
    byNum.set(number, {
      number,
      pageNum: parseInt(m[2], 10),
      x: parseFloat(m[3]),
      y: parseFloat(m[4]),
    });
  }
  const posts = [...byNum.values()].sort((a, b) => a.number - b.number);
  return posts.length >= sample.minPosts ? posts : null;
}

console.log(`\n══ Sample: ${sampleKey} ══\nPDF: ${sample.pdf}\n`);

const buf = readFileSync(sample.pdf);
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

const joaoFixture = sampleKey === 'joao-born' ? loadJoaoBornFixture() : null;
const debugDumpPosts = loadPostsFromDebugResults();
const browserPosts = useBrowserFixture ? joaoFixture?.posts ?? null : debugDumpPosts;
const fixtureDistances = useBrowserFixture ? joaoFixture?.distances ?? null : null;
let parserPosts = parsed.posts;

const useBrowserPositions =
  !forceParserPosts &&
  browserPosts &&
  (parserPosts.length < sample.minPosts ||
    (sampleKey === 'joao-born' && browserPosts.length >= sample.minPosts));

if (useBrowserPositions) {
  const source = useBrowserFixture
    ? 'fixtures/joao-born-browser-posts.json (route Poste snaps)'
    : 'debug_results.txt PARSE DEBUG (parser export order)';
  console.warn(`\nUsing ${source} (${browserPosts.length} posts).\n`);
  parserPosts = browserPosts.map(p => ({ ...p }));
} else if (parserPosts.length < sample.minPosts) {
  console.error('No posts from parser and no debug_results.txt parse dump.');
  process.exit(1);
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
if (fixtureDistances?.length) {
  distances = fixtureDistances;
  console.log(`\nDistância_Poste labels (${distances.length} segments from fixture).`);
} else if (browserPosts && parsed.distanceLabelItems?.length) {
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

if (overviewComposite && !useBrowserPositions && parsed.viewportBoxes?.length >= 2) {
  let overviewScale = null;
  for (const pn of [2, 3, 4, 5]) {
    const paths = parsed.utmGridPathsPerPage?.get(pn);
    if (paths?.length) {
      overviewScale = computeScaleFactor(paths, []);
      if (overviewScale != null) break;
    }
  }
  const perPageScale = pageNum => {
    const paths = parsed.utmGridPathsPerPage?.get(pageNum);
    if (paths?.length) {
      const sf = computeScaleFactor(paths, []);
      if (sf != null) return sf;
    }
    return overviewScale;
  };
  applyOverviewComposite({
    posts: parserPosts,
    posteRawCentroids: parsed.posteRawCentroids ?? [],
    cablePaths: parsed.cablePaths ?? [],
    distanceLabelItems: parsed.distanceLabelItems ?? [],
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
    viewportBoxes: parsed.viewportBoxes,
    pageDimensions: parsed.pageDimensions,
    warnings: parsed.warnings ?? [],
    perPageScale,
  });
  console.log('\nOverview composite: detail geometry remapped to page 2 (before N3).\n');
}

const multiSheetRoute =
  overviewComposite || (parsed.viewportBoxes?.length ?? 0) >= 3;
// N3 pole assignment only when using parser positions (browser debug_results already has Poste snaps).
if (
  !useBrowserPositions &&
  multiSheetRoute &&
  parsed.posteRawCentroids?.length &&
  parsed.cablePaths?.length &&
  distances.some(d => d.meters != null && d.meters > 0)
) {
  let overviewScale = computeScaleFactor(parsed.utmGridPathsPerPage?.get(2) ?? [], []);
  if (overviewScale == null) {
    for (const [pn, paths] of parsed.utmGridPathsPerPage ?? []) {
      if (pn === 2) continue;
      overviewScale = computeScaleFactor(paths, []);
      if (overviewScale != null) break;
    }
  }
  const perPageScale = pageNum => {
    const paths = parsed.utmGridPathsPerPage?.get(pageNum);
    if (paths?.length) {
      const sf = computeScaleFactor(paths, []);
      if (sf != null) return sf;
    }
    return overviewScale ?? null;
  };
  const n3Warnings = [];
  assignPolesGloballyByLabels(
    parserPosts,
    parsed.posteRawCentroids,
    parsed.cablePaths,
    distances,
    n3Warnings,
    {
      postByNum: new Map(parserPosts.map(p => [p.number, p])),
      perPageScale,
    }
  );
  const n3Line = n3Warnings.find(w => /\[post-positioning\] N3 page/.test(w));
  if (n3Line) console.log(`\n${n3Line}`);
}

const lastRef = REFERENCE[REFERENCE.length - 1];
const calcOpts = {
  utmGridPathsPerPage: parsed.utmGridPathsPerPage,
  viewportBoxes: parsed.viewportBoxes,
  pageDimensions: parsed.pageDimensions,
  overviewComposite,
};
if (twoAnchor && lastRef) {
  calcOpts.lastPostGps = { lat: lastRef.lat, lon: lastRef.lon };
  console.log(`Two-anchor mode: post 1 + post ${lastRef.num} GPS from reference.\n`);
}

const { posts, warnings = [] } = calculateCoordinates(
  parserPosts,
  distances,
  start.lat,
  start.lon,
  parsed.cableSegments ?? [],
  calcOpts
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
const under5 = REFERENCE.filter(ref => {
  const p = posts.find(x => x.number === ref.num);
  return p?.lat != null && haversineMeters(ref.lat, ref.lon, p.lat, p.lon) < 5;
}).length;
console.log(
  `\nMax error: ${maxErr.toFixed(2)}m  null GPS: ${nulls}/${REFERENCE.length}  <5m: ${under5}/${REFERENCE.length}`
);
const allWarnings = [...(parsed.warnings ?? []), ...warnings];
if (allWarnings.length) {
  console.log('\nWarnings (first 8):');
  for (const w of allWarnings.slice(0, 8)) console.log(' ', w);
}
