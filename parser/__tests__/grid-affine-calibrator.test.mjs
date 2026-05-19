/**
 * N5: grid intersection affine calibration.
 * Run: node parser/__tests__/grid-affine-calibrator.test.mjs
 */
import assert from 'node:assert/strict';
import {
  buildGridControlPoints,
  solveAffinePdfToUtm,
  calibratePageFromGridAffine,
} from '../geo/grid-affine-calibrator.js';
import { utmFromPdfPoint } from '../geo/utm-calibrator.js';

const gridOps = [];
for (let i = 0; i < 5; i++) {
  const y = i * 40;
  gridOps.push({ type: 'M', x: 0, y });
  gridOps.push({ type: 'L', x: 200, y });
}
for (let j = 0; j < 5; j++) {
  const x = j * 40;
  gridOps.push({ type: 'M', x, y: 0 });
  gridOps.push({ type: 'L', x, y: 200 });
}

const controls = buildGridControlPoints([gridOps], 0);
assert.ok(controls.length >= 16, 'grid intersections');

const M = solveAffinePdfToUtm(controls);
assert.ok(M, 'affine solution');
assert.ok(Math.abs(M.m00 - 1.25) < 0.15, `m00 ~ 50/40, got ${M.m00}`);

const thumb = {
  origin_e: 1000,
  origin_n: 2000,
  x_scale_sf: 1.25,
  y_scale_sf: 1.25,
  theta: 0,
  zone: 22,
};

const n5 = calibratePageFromGridAffine(
  [gridOps],
  0,
  { x: 80, y: 80 },
  { easting: 1100, northing: 2100 },
  thumb,
  []
);
assert.ok(n5, 'N5 accepted over thumbnail');
const u = utmFromPdfPoint(80, 80, n5.transform);
assert.ok(Math.abs(u.easting - 1100) < 0.5 && Math.abs(u.northing - 2100) < 0.5, 'anchor binds');

console.log('grid-affine-calibrator.test.mjs: all assertions passed');
