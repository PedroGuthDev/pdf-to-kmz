// Experiment: if a static post's symbol is far from its label anchor AND far
// from the cable, replace the symbol position with the label anchor. The
// theory: labels are accurate (OCR identified them), so the anchor coordinate
// is more reliable than a Viterbi-picked wrong symbol.

import { readFileSync, existsSync } from 'fs';
import { parsePdf } from './parser/pdf-parser.js';
import { calculateCoordinates } from './parser/coordinate-calculator.js';
import { associateDistances } from './parser/distance-associator.js';
import { haversineMeters } from './parser/geo/utm-calibrator.js';

const sample = {
  pdf: './INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf',
  refFile: './coordenadas postes rua joao born.txt',
  minPosts: 30,
};

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
const buf = readFileSync(sample.pdf);
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const posts = loadPostsFromDebugResults().map(p => ({ ...p }));

const overrideMode = process.argv[2] || 'symbol-far';  // 'symbol-far' | 'always' | 'none'
const threshold = Number(process.argv[3] ?? 60);  // pt

const overridden = [];
for (const p of posts) {
  if (overrideMode === 'none') break;
  if (p.anchorX == null || p.anchorY == null) continue;
  const d = Math.hypot(p.x - p.anchorX, p.y - p.anchorY);
  if (overrideMode === 'always' || d > threshold) {
    overridden.push({ num: p.number, page: p.pageNum, d, from: { x: p.x, y: p.y }, to: { x: p.anchorX, y: p.anchorY } });
    p.x = p.anchorX;
    p.y = p.anchorY;
  }
}
console.log(`Override mode: ${overrideMode}  threshold: ${threshold}pt`);
console.log(`Overrode ${overridden.length} post position(s) with label anchor.`);
for (const o of overridden) {
  console.log(`  Post ${o.num} (p${o.page}): symbol→anchor d=${o.d.toFixed(1)}pt`);
}

let distances = parsed.distances ?? [];
if (parsed.distanceLabelItems?.length) {
  const { distances: assoc } = associateDistances(posts, parsed.distanceLabelItems, []);
  if (assoc.filter(d => d.meters != null && d.meters > 0).length >= 3) distances = assoc;
}

const start = REFERENCE[0];
const { posts: outPosts } = calculateCoordinates(
  posts,
  distances,
  start.lat,
  start.lon,
  parsed.cableSegments ?? [],
  {
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
    viewportBoxes: parsed.viewportBoxes,
    pageDimensions: parsed.pageDimensions,
  }
);

let maxErr = 0;
const errs = [];
let under5 = 0;
for (const ref of REFERENCE) {
  const p = outPosts.find(x => x.number === ref.num);
  if (!p || p.lat == null) {
    errs.push({ num: ref.num, err: Infinity });
    continue;
  }
  const err = haversineMeters(ref.lat, ref.lon, p.lat, p.lon);
  errs.push({ num: ref.num, err });
  if (err < 5) under5++;
  maxErr = Math.max(maxErr, err);
}
errs.sort((a, b) => b.err - a.err);
console.log(`\nMax: ${maxErr.toFixed(2)}m  <5m: ${under5}/${REFERENCE.length}`);
console.log(`Top 5 offenders: ${errs.slice(0, 5).map(e => `Post ${e.num} (${e.err.toFixed(1)}m)`).join(', ')}`);
