// Like debug-run-calc.mjs but FORCES `assignPolesGloballyByLabels` to re-run
// over the raw Poste centroids using the correctly-numbered post sequence
// loaded from debug_results.txt. This is the only path where Node-side
// VITERBI_SIGMA_PT / VITERBI_BETA_M tuning actually has effect on the João Born
// harness output — the regular harness uses already-assigned static positions.
//
// Usage:
//   VITERBI_SIGMA_PT=15 VITERBI_BETA_M=3 node debug-run-calc-revit.mjs joao-born

import { readFileSync, existsSync } from 'fs';
import { parsePdf } from './parser/pdf-parser.js';
import { calculateCoordinates } from './parser/coordinate-calculator.js';
import { associateDistances } from './parser/distance-associator.js';
import { assignPolesGloballyByLabels } from './parser/post-positioning.js';
import { computeScaleFactor, haversineMeters } from './parser/geo/utm-calibrator.js';

const SAMPLES = {
  'joao-born': {
    pdf: './INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf',
    minPosts: 30,
    refFile: './coordenadas postes rua joao born.txt',
  },
};

const sampleKey = 'joao-born';
const sample = SAMPLES[sampleKey];

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

function loadPostsFromDebugResults(path = './debug_results.txt') {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const dumpIdx = text.indexOf('PARSE DEBUG DUMP');
  const block =
    dumpIdx >= 0
      ? text.slice(dumpIdx, text.indexOf('\nPage dimensions', dumpIdx))
      : text;
  const byNum = new Map();
  for (const line of block.split('\n')) {
    if (line.includes('lat=') || line.includes('lon=')) continue;
    const m = line.match(/Post\s+(\d+):\s+page=(\d+)\s+x=([\d.]+)\s+y=([\d.]+)(?:.*?anchor=\(([\d.]+),([\d.]+)\))?/);
    if (!m) continue;
    const number = parseInt(m[1], 10);
    if (byNum.has(number)) continue;
    byNum.set(number, {
      number,
      pageNum: parseInt(m[2], 10),
      x: parseFloat(m[3]),
      y: parseFloat(m[4]),
      anchorX: m[5] ? parseFloat(m[5]) : undefined,
      anchorY: m[6] ? parseFloat(m[6]) : undefined,
    });
  }
  return [...byNum.values()].sort((a, b) => a.number - b.number);
}

const REFERENCE = loadReferenceFromTxt(sample.refFile);
const debugPosts = loadPostsFromDebugResults();
if (!debugPosts || debugPosts.length < sample.minPosts) {
  console.error('debug_results.txt PARSE DEBUG block missing or incomplete.');
  process.exit(1);
}

const buf = readFileSync(sample.pdf);
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
if (parsed.error) {
  console.error('parsePdf failed:', parsed);
  process.exit(1);
}

// Use the route-numbered posts but RE-RUN Viterbi over the raw centroids.
// This is the path where σ/β actually have effect.
const posts = debugPosts.map(p => ({ ...p }));

let distances = parsed.distances ?? [];
if (parsed.distanceLabelItems?.length) {
  const { distances: assoc } = associateDistances(posts, parsed.distanceLabelItems, []);
  if (assoc.filter(d => d.meters != null && d.meters > 0).length >= 3) {
    distances = assoc;
  }
}

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
const sigma = process.env.VITERBI_SIGMA_PT ?? '(default 20)';
const beta = process.env.VITERBI_BETA_M ?? '(default 5)';
console.log(`Viterbi: sigma=${sigma}  beta=${beta}`);
console.log(`Raw Poste centroids: ${parsed.posteRawCentroids?.length ?? 0}`);
console.log(`Cable paths: ${parsed.cablePaths?.length ?? 0}`);

// Snapshot original positions for change detection
const before = new Map(posts.map(p => [p.number, { x: p.x, y: p.y }]));

assignPolesGloballyByLabels(
  posts,
  parsed.posteRawCentroids,
  parsed.cablePaths,
  distances,
  n3Warnings,
  {
    postByNum: new Map(posts.map(p => [p.number, p])),
    perPageScale,
  }
);

let moved = 0;
const movements = [];
for (const p of posts) {
  const b = before.get(p.number);
  if (!b) continue;
  const dx = (p.x - b.x);
  const dy = (p.y - b.y);
  const d = Math.hypot(dx, dy);
  if (d > 1) {
    moved++;
    movements.push({ num: p.number, page: p.pageNum, d, from: b, to: { x: p.x, y: p.y } });
  }
}
console.log(`Posts moved by Viterbi re-assignment: ${moved}/${posts.length}`);

const start = REFERENCE[0];
const calcOpts = {
  utmGridPathsPerPage: parsed.utmGridPathsPerPage,
  viewportBoxes: parsed.viewportBoxes,
  pageDimensions: parsed.pageDimensions,
};
const { posts: outPosts, warnings = [] } = calculateCoordinates(
  posts,
  distances,
  start.lat,
  start.lon,
  parsed.cableSegments ?? [],
  calcOpts
);

let maxErr = 0;
let nulls = 0;
const errs = [];
let under5 = 0;
for (const ref of REFERENCE) {
  const p = outPosts.find(x => x.number === ref.num);
  if (!p || p.lat == null) {
    nulls++;
    errs.push({ num: ref.num, err: Infinity });
    continue;
  }
  const err = haversineMeters(ref.lat, ref.lon, p.lat, p.lon);
  errs.push({ num: ref.num, err });
  if (err < 5) under5++;
  maxErr = Math.max(maxErr, err);
}
errs.sort((a, b) => b.err - a.err);
console.log(
  `\nMax: ${maxErr.toFixed(2)}m  <5m: ${under5}/${REFERENCE.length}  null: ${nulls}/${REFERENCE.length}`
);
console.log(
  `Top 5 offenders: ${errs.slice(0, 5).map(e => `Post ${e.num} (${e.err.toFixed(1)}m)`).join(', ')}`
);
if (process.argv.includes('--verbose')) {
  console.log('\nMovements (>1pt):');
  for (const m of movements.slice(0, 15)) {
    console.log(`  Post ${m.num} (p${m.page}): (${m.from.x.toFixed(1)},${m.from.y.toFixed(1)}) → (${m.to.x.toFixed(1)},${m.to.y.toFixed(1)})  d=${m.d.toFixed(1)}pt`);
  }
  const n3Line = n3Warnings.filter(w => /\[post-positioning\]/.test(w));
  if (n3Line.length) {
    console.log('\nN3 warnings:');
    for (const w of n3Line.slice(0, 10)) console.log('  ' + w);
  }
}
