// debug-compare.mjs
// Compare coordinate output vs coordenadas postes.txt (run: node debug-compare.mjs)

import { latLonToUtm, utmToLatLon, haversineMeters } from './parser/geo/utm-calibrator.js';
import { calculateCoordinates } from './parser/coordinate-calculator.js';

const REFERENCE = new Map([
  [1,  { lat: -27.6594603999238,   lon: -48.699240275151034 }],
  [2,  { lat: -27.65942120761788,  lon: -48.699602010469185 }],
  [3,  { lat: -27.659382015296377, lon: -48.700021269466035 }],
  [4,  { lat: -27.659346742194973, lon: -48.700345393166934 }],
  [5,  { lat: -27.65930559022924,  lon: -48.700762439716044 }],
  [6,  { lat: -27.659270317104404, lon: -48.70108213852094  }],
  [7,  { lat: -27.659231796350753, lon: -48.70147947750159  }],
  [8,  { lat: -27.65918966453256,  lon: -48.70188546179813  }],
  [9,  { lat: -27.65914949231848,  lon: -48.70230140211723  }],
  [10, { lat: -27.6591063806582,   lon: -48.702660924999286 }],
  [11, { lat: -27.659066208413993, lon: -48.702999429619396 }],
]);

const POSTS = [
  { num: 1,  page: 3, x: 689.75,  y: 600.49 },
  { num: 2,  page: 3, x: 566.36,  y: 510.42 },
  { num: 3,  page: 3, x: 455.90,  y: 496.20 },
  { num: 4,  page: 3, x: 376.34,  y: 459.66 },
  { num: 5,  page: 3, x: 311.68,  y: 408.27 },
  { num: 6,  page: 3, x: 169.58,  y: 429.30 },
  { num: 7,  page: 4, x: 1138.18, y: 440.88 },
  { num: 8,  page: 8, x: 554.30,  y: 223.14 },
  { num: 9,  page: 4, x: 914.62,  y: 409.92 },
  { num: 10, page: 4, x: 765.50,  y: 383.87 },
  { num: 11, page: 4, x: 596.66,  y: 367.06 },
];

const PAGE_DIM = new Map([
  [3, { w: 1191, h: 842 }],
  [4, { w: 1191, h: 842 }],
]);
const VIEWPORT = [
  { pageNum: 3, rect: { x: 616.2, y: 395.6, w: 470.2, h: 281.3 } },
  { pageNum: 4, rect: { x: 146.0, y: 395.6, w: 470.2, h: 281.3 } },
];
const PAGE2_SCALE = 0.818599;
const UTM_GRID_SCALE = 0.354610;

function projectAndReport(label, transforms) {
  console.log(`\n══ ${label} ══`);
  const errs = [];
  for (const p of POSTS) {
    const ref = REFERENCE.get(p.num);
    const t = transforms.get(p.page);
    if (!t) {
      console.log(`  Post ${String(p.num).padStart(2)} (page ${p.page}): NO TRANSFORM`);
      errs.push(999);
      continue;
    }
    const e = t.origin_e + p.x * t.x_scale_sf;
    const n = t.origin_n - p.y * t.y_scale_sf;
    const { lat, lon } = utmToLatLon(e, n, t.zone);
    const err = haversineMeters(ref.lat, ref.lon, lat, lon);
    errs.push(err);
    console.log(`  Post ${String(p.num).padStart(2)} (page ${p.page}): err=${err.toFixed(2)}m`);
  }
  const valid = errs.filter(e => e < 900);
  console.log(`  avg=${(valid.reduce((s, e) => s + e, 0) / valid.length).toFixed(2)}m  max=${Math.max(...valid).toFixed(2)}m`);
}

const ref1 = REFERENCE.get(1);
const post1 = { x: POSTS[0].x, y: POSTS[0].y, pageNum: 3, lat: ref1.lat, lon: ref1.lon };
const { zone } = latLonToUtm(ref1.lat, ref1.lon);

// Post 8 interpolated onto page 4 between 7 and 9
const p7 = POSTS.find(p => p.num === 7);
const p9 = POSTS.find(p => p.num === 9);
const p8 = POSTS.find(p => p.num === 8);
p8.page = 4;
p8.x = p7.x + (p9.x - p7.x) * 0.5;
p8.y = p7.y + (p9.y - p7.y) * 0.5;

const utmGridPathsPerPage = new Map([
  [3, [[]]],
  [4, [[]]],
]);
// Empty paths → fallback to viewport x-scale; use explicit scales via mock paths skip
// buildPageTransforms will use viewport fallback when computeScaleFactor returns null

const warnings = [];
const transforms = buildPageTransforms(
  post1,
  PAGE_DIM,
  VIEWPORT,
  PAGE2_SCALE,
  zone,
  warnings,
  utmGridPathsPerPage
);

// Force UTM-grid X scale (Palhoça measured values) when grid paths are not loaded in this script
for (const pn of [3, 4]) {
  const t = transforms.get(pn);
  if (t) {
    t.x_scale_sf = UTM_GRID_SCALE;
    const { easting: e1, northing: n1 } = latLonToUtm(ref1.lat, ref1.lon);
    const scale_y_pk = (281.3 / 842) * PAGE2_SCALE;
    t.origin_e = e1 - post1.x * UTM_GRID_SCALE;
    t.origin_n = n1 + post1.y * scale_y_pk;
    const box_pk = VIEWPORT[0].rect;
    const x1_p2 = box_pk.x + (post1.x / 1191) * box_pk.w;
    const y1_p2 = box_pk.y + (post1.y / 842) * box_pk.h;
    const box_K = VIEWPORT.find(v => v.pageNum === pn).rect;
    t.origin_e = t.origin_e + (box_K.x - x1_p2) * PAGE2_SCALE;
    t.origin_n = t.origin_n - (box_K.y - y1_p2) * PAGE2_SCALE;
    t.y_scale_sf = (box_K.h / 842) * PAGE2_SCALE;
  }
}

projectAndReport('Hybrid (UTM X + viewport Y) + post 8 interpolated', transforms);
