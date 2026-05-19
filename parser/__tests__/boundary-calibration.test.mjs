/**
 * Boundary-locked origins + detail-scale thumbnail offset (approaches 1 & 2).
 * Run: node parser/__tests__/boundary-calibration.test.mjs
 */
import assert from 'node:assert/strict';
import {
  buildPageTransforms,
  adjustPageOriginsAtBoundaries,
  projectPost,
  latLonToUtm,
} from '../geo/utm-calibrator.js';

const post1 = { number: 1, x: 100, y: 200, pageNum: 3, lat: -27.65, lon: -48.66 };
const pageDimensions = new Map([
  [3, { w: 1000, h: 800 }],
  [4, { w: 1000, h: 800 }],
]);
const viewportBoxes = [
  { pageNum: 3, rect: { x: 100, y: 100, w: 200, h: 150 } },
  { pageNum: 4, rect: { x: 400, y: 100, w: 200, h: 150 } },
];
const overviewScale = 1.0;
const detailScale = 0.35;
const utmGridPathsPerPage = new Map();

// Mock detailPageScale via UTM paths — use empty map so fallback (box.w/page.w)*overview applies
const { zone } = latLonToUtm(post1.lat, post1.lon);
const transforms = buildPageTransforms(
  post1,
  pageDimensions,
  viewportBoxes,
  overviewScale,
  zone,
  [],
  utmGridPathsPerPage
);

assert.equal(transforms.size, 2, 'two page transforms');
const t3 = transforms.get(3);
const t4before = transforms.get(4);
assert.ok(t3 && t4before, 'transforms exist');

// Thumbnail offset uses overview scaleFactor (page-2 coords)
const dxThumb = 400 - 100;
const expectedE = t3.origin_e + dxThumb * overviewScale;
assert.ok(
  Math.abs(t4before.origin_e - expectedE) < 1e-6,
  'page-4 origin uses overview scale for thumbnail offset'
);

// Approach 1: boundary lock page 4 at synthetic GPS
const sorted = [
  { number: 1, x: 100, y: 200, pageNum: 3 },
  { number: 2, x: 150, y: 180, pageNum: 3 },
  { number: 3, x: 120, y: 160, pageNum: 4 },
];
const distMap = new Map([
  ['1->2', 40],
  ['2->3', 35],
]);
const warnings = [];
const n = adjustPageOriginsAtBoundaries(
  transforms,
  sorted,
  distMap,
  { lat: post1.lat, lon: post1.lon },
  warnings
);
assert.equal(n, 1, 'one page boundary locked');
const t4 = transforms.get(4);
const pos3 = { x: 120, y: 160 };
const proj = projectPost(pos3.x, pos3.y, t4);
assert.ok(warnings.some(w => /boundary-locked/i.test(w)), 'boundary lock warning');

console.log('boundary-calibration.test.mjs: all assertions passed');
