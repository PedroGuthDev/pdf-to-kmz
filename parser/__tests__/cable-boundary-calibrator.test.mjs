/**
 * Approach 6: cable continuity at sheet boundaries.
 * Run: node parser/__tests__/cable-boundary-calibrator.test.mjs
 */
import assert from 'node:assert/strict';
import {
  buildPageTransforms,
  projectPost,
  latLonToUtm,
} from '../geo/utm-calibrator.js';
import {
  adjustPageOriginsByCableContinuity,
  fitSimilarity2d,
} from '../geo/cable-boundary-calibrator.js';
import { pathTotalArcLength } from '../cable-builder.js';

const post1 = { number: 1, x: 100, y: 200, pageNum: 3, lat: -27.65, lon: -48.66 };
const pageDimensions = new Map([
  [3, { w: 1000, h: 800 }],
  [4, { w: 1000, h: 800 }],
]);
const viewportBoxes = [
  { pageNum: 3, rect: { x: 100, y: 100, w: 200, h: 150 } },
  { pageNum: 4, rect: { x: 400, y: 100, w: 200, h: 150 } },
];
const { zone } = latLonToUtm(post1.lat, post1.lon);
const transforms = buildPageTransforms(
  post1,
  pageDimensions,
  viewportBoxes,
  1.0,
  zone,
  [],
  new Map()
);

const sorted = [
  { number: 1, x: 100, y: 200, pageNum: 3 },
  { number: 2, x: 150, y: 180, pageNum: 3 },
  { number: 3, x: 50, y: 120, pageNum: 4 },
];
const distMap = new Map([
  ['1->2', 40],
  ['2->3', 35],
]);

const cablesByPage = new Map([
  [
    3,
    [
      [
        { type: 'M', x: 100, y: 200 },
        { type: 'L', x: 150, y: 180 },
      ],
    ],
  ],
  [
    4,
    [
      [
        { type: 'M', x: 50, y: 120 },
        { type: 'L', x: 120, y: 100 },
        { type: 'L', x: 180, y: 90 },
      ],
    ],
  ],
]);

assert.ok(pathTotalArcLength(cablesByPage.get(4)[0]) > 100, 'path length');

const sim = fitSimilarity2d(
  [
    [0, 0],
    [10, 0],
  ],
  [
    [0, 0],
    [0, 10],
  ]
);
assert.ok(sim && Math.abs(sim.scale - 1) < 0.01, 'unit-scale similarity');
assert.ok(Math.abs(Math.abs(sim.theta) - Math.PI / 2) < 0.05, '90° rotation');

const warnings = [];
const n = adjustPageOriginsByCableContinuity(
  transforms,
  sorted,
  distMap,
  { lat: post1.lat, lon: post1.lon },
  cablesByPage,
  warnings
);
assert.equal(n, 1, 'one page cable-aligned');
assert.ok(warnings.some(w => /cable-boundary/i.test(w)), 'cable warning');

const t4 = transforms.get(4);
const entry = { x: 50, y: 120 };
const proj = projectPost(entry.x, entry.y, t4);
assert.ok(Number.isFinite(proj.lat) && Number.isFinite(proj.lon), 'projects to GPS');

console.log('cable-boundary-calibrator.test.mjs: all assertions passed');
