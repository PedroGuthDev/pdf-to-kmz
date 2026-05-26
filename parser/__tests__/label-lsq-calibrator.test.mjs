/**
 * Global label least-squares page-origin refinement (approach 3).
 * Run: node parser/__tests__/label-lsq-calibrator.test.mjs
 */
import assert from 'node:assert/strict';
import {
  refinePageOriginsByLabelLsq,
  inferMissingSegmentMeters,
} from '../geo/label-lsq-calibrator.js';
import { projectPost, haversineMeters } from '../geo/utm-calibrator.js';

const zone = 22;
const scale = 0.35;
const transforms = new Map([
  [3, { origin_e: 730000, origin_n: 6940000, x_scale_sf: scale, y_scale_sf: scale, theta: 0, zone }],
  [4, { origin_e: 730100, origin_n: 6940000, x_scale_sf: scale, y_scale_sf: scale, theta: 0, zone }],
]);

const sorted = [
  { number: 1, x: 100, y: 200, pageNum: 3 },
  { number: 2, x: 200, y: 180, pageNum: 3 },
  { number: 3, x: 120, y: 160, pageNum: 4 },
  { number: 4, x: 220, y: 140, pageNum: 4 },
];

const distMap = new Map([
  ['1->2', 40],
  ['2->3', 35],
  ['3->4', 40],
]);

const warnings = [];
const post1Gps = { lat: -27.65, lon: -48.66 };

const before = transforms.get(4).origin_e;
const result = refinePageOriginsByLabelLsq(
  transforms,
  sorted,
  distMap,
  post1Gps,
  warnings
);

assert.equal(result.adjusted, 1, 'one free page');
assert.ok(result.improved, 'RMSE should improve');
assert.ok(Math.abs(transforms.get(4).origin_e - before) > 0.1, 'page 4 origin moved');

assert.ok(result.rmseAfter < result.rmseBefore, 'label RMSE decreased');

// Compressed PDF chord between neighbors: prefer blend over outbound-only scale.
const route = [
  { number: 3, x: 0, y: 0, pageNum: 3 },
  { number: 4, x: 10, y: 0, pageNum: 3 },
  { number: 5, x: 12, y: 0, pageNum: 3 },
  { number: 6, x: 100, y: 0, pageNum: 3 },
];
const gapMap = new Map([
  ['3->4', 40],
  ['4->3', 40],
  ['5->6', 40],
  ['6->5', 40],
]);
const inferred = inferMissingSegmentMeters(route, gapMap, 4, 5, null);
assert.ok(inferred > 20, `expected blended inference, got ${inferred}`);
assert.ok(inferred < 45, `expected blended inference, got ${inferred}`);
console.log('label-lsq-calibrator.test.mjs: all assertions passed');
