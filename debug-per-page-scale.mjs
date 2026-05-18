// debug-per-page-scale.mjs
// Standalone: extracts UTM grid paths from each page using local pdfjs and runs
// computeScaleFactor to see what isotropic scale each page would give.

import { readFileSync } from 'fs';
import { computeScaleFactor, buildPageTransforms, projectPost, latLonToUtm, utmToLatLon, haversineMeters } from './parser/geo/utm-calibrator.js';
import { extractLayerGraphics } from './parser/graphics-extractor.js';
import { isUtmGridLayerName, isViewportRectLayerName } from './parser/layer-sources.js';

function flipYInOp(op, pageHeight) {
  const f = { ...op };
  if (f.y  !== undefined) f.y  = pageHeight - f.y;
  if (f.y1 !== undefined) f.y1 = pageHeight - f.y1;
  if (f.y2 !== undefined) f.y2 = pageHeight - f.y2;
  if (f.y3 !== undefined) f.y3 = pageHeight - f.y3;
  return f;
}

const pdfjsLib = await import('./node_modules/pdfjs-dist/legacy/build/pdf.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;

const REFERENCE = [
  { num: 1,  lat: -27.6594603999238,   lon: -48.699240275151034 },
  { num: 2,  lat: -27.65942120761788,  lon: -48.699602010469185 },
  { num: 3,  lat: -27.659382015296377, lon: -48.700021269466035 },
  { num: 4,  lat: -27.659346742194973, lon: -48.700345393166934 },
  { num: 5,  lat: -27.65930559022924,  lon: -48.700762439716044 },
  { num: 6,  lat: -27.659270317104404, lon: -48.70108213852094  },
  { num: 7,  lat: -27.659231796350753, lon: -48.70147947750159  },
  { num: 9,  lat: -27.65914949231848,  lon: -48.70230140211723  },
  { num: 10, lat: -27.6591063806582,   lon: -48.702660924999286 },
  { num: 11, lat: -27.659066208413993, lon: -48.702999429619396 },
];

const POSTS_FROM_PARSER = [
  { num: 1,  page: 3, x: 689.75,  y: 600.49 },
  { num: 2,  page: 3, x: 566.36,  y: 510.42 },
  { num: 3,  page: 3, x: 455.90,  y: 496.20 },
  { num: 4,  page: 3, x: 376.34,  y: 459.66 },
  { num: 5,  page: 3, x: 311.68,  y: 408.27 },
  { num: 6,  page: 3, x: 169.58,  y: 429.30 },
  { num: 7,  page: 4, x: 1138.18, y: 440.88 },
  { num: 9,  page: 4, x: 914.62,  y: 409.92 },
  { num: 10, page: 4, x: 765.50,  y: 383.87 },
  { num: 11, page: 4, x: 596.66,  y: 367.06 },
];

const data = new Uint8Array(readFileSync('./INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf'));
const pdfDoc = await pdfjsLib.getDocument({ data }).promise;

const config = await pdfDoc.getOptionalContentConfig();
const idToName = {};
for (const [id, group] of config) {
  idToName[id] = group.name;
  idToName[String(id)] = group.name;
}

// Extract UTM grid paths and viewport boxes per page (flipY applied)
const utmGridPathsPerPage = new Map();
const viewportBoxes = [];
const pageDimensions = new Map();

for (let pn = 1; pn <= pdfDoc.numPages; pn++) {
  const page = await pdfDoc.getPage(pn);
  const pageHeight = page.view[3];
  const pageWidth = page.view[2];
  pageDimensions.set(pn, { w: pageWidth, h: pageHeight });

  const gfx = await extractLayerGraphics(page, idToName);

  // UTM grid paths
  const utmPaths = [];
  for (const [ln, pathArrays] of Object.entries(gfx.byLayer)) {
    if (isUtmGridLayerName(ln)) {
      for (const ops of pathArrays) {
        utmPaths.push(ops.map(op => flipYInOp(op, pageHeight)));
      }
    }
  }
  utmGridPathsPerPage.set(pn, utmPaths);

  // Viewport boxes from page 2
  if (pn === 2) {
    const maxVpW = pageWidth * 0.60;
    const maxVpH = pageHeight * 0.60;
    for (const [ln, pathArrays] of Object.entries(gfx.byLayer)) {
      if (!isViewportRectLayerName(ln)) continue;
      for (const ops of pathArrays) {
        // simple bbox from path ops
        let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
        let valid = false;
        for (const op of ops) {
          if (op.x !== undefined) {
            minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x);
            minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y);
            valid = true;
          }
        }
        if (!valid) continue;
        const w = maxX - minX;
        const h = maxY - minY;
        if (w < 10 || h < 10) continue;
        if (w >= maxVpW || h >= maxVpH) continue;
        // Apply flipY: y becomes pageHeight - maxY  (top-left in flipY space)
        viewportBoxes.push({ rect: { x: minX, y: pageHeight - maxY, w, h } });
      }
    }
  }
}

console.log('═══ Per-page UTM scale ═════════════════════════════════════════════');
const warnings = [];
for (const [pn, paths] of [...utmGridPathsPerPage.entries()].sort((a,b)=>a[0]-b[0])) {
  if (!paths || paths.length === 0) continue;
  const totalOps = paths.reduce((s,p)=>s + p.length, 0);
  const scale = computeScaleFactor(paths, warnings);
  console.log(`  Page ${pn}: ${paths.length} paths, ${totalOps} ops → scale = ${scale === null ? 'null' : scale.toFixed(6) + ' m/pt'}` +
              (scale !== null ? ` (50m grid = ${(50/scale).toFixed(1)}pt)` : ''));
}

// Now look closer at the H/V split per detail page
console.log('\n═══ H/V grid spacing analysis per page ════════════════════════════');
for (const [pn, paths] of [...utmGridPathsPerPage.entries()].sort((a,b)=>a[0]-b[0])) {
  if (!paths || paths.length === 0) continue;
  if (pn !== 2 && pn !== 3 && pn !== 4) continue;
  const allOps = paths.flat();
  const TOLERANCE = 2;
  const MIN_LENGTH = 2;
  const hLines = []; // {y, length}
  const vLines = []; // {x, length}
  let cur = null;
  for (const op of allOps) {
    if (op.type === 'M') { cur = { x: op.x, y: op.y }; }
    else if (op.type === 'L' && cur) {
      const dx = Math.abs(op.x - cur.x), dy = Math.abs(op.y - cur.y);
      const len = Math.hypot(dx, dy);
      if (len >= MIN_LENGTH) {
        if (dy <= TOLERANCE && dx > dy) hLines.push({ y: (cur.y+op.y)/2, length: dx });
        else if (dx <= TOLERANCE && dy > dx) vLines.push({ x: (cur.x+op.x)/2, length: dy });
      }
      cur = { x: op.x, y: op.y };
    }
  }
  const hSorted = [...hLines].sort((a,b)=>a.y-b.y);
  const vSorted = [...vLines].sort((a,b)=>a.x-b.x);
  console.log(`\n  Page ${pn}: ${hLines.length} horizontal lines, ${vLines.length} vertical lines`);
  if (hSorted.length > 0) {
    console.log(`    H-line positions (y): ${hSorted.map(l => l.y.toFixed(1)).join(', ')}`);
    if (hSorted.length > 1) {
      const sp = [];
      for (let i=1;i<hSorted.length;i++) sp.push(hSorted[i].y - hSorted[i-1].y);
      console.log(`    H-line spacings: ${sp.map(s => s.toFixed(1)).join(', ')}`);
    }
  }
  if (vSorted.length > 0) {
    console.log(`    V-line positions (x): ${vSorted.map(l => l.x.toFixed(1)).join(', ')}`);
    if (vSorted.length > 1) {
      const sp = [];
      for (let i=1;i<vSorted.length;i++) sp.push(vSorted[i].x - vSorted[i-1].x);
      console.log(`    V-line spacings: ${sp.map(s => s.toFixed(1)).join(', ')}`);
    }
  }
}

console.log('\n═══ Viewport boxes (page-2 thumbnails, flipY) ═════════════════════');
for (const v of viewportBoxes) {
  console.log(`  rect=(${v.rect.x.toFixed(1)}, ${v.rect.y.toFixed(1)}, ${v.rect.w.toFixed(1)}×${v.rect.h.toFixed(1)})`);
}
