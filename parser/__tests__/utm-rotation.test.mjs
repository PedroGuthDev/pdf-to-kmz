/**
 * N4: per-page rotation in UTM projection.
 * Run: node parser/__tests__/utm-rotation.test.mjs
 */
import assert from 'node:assert/strict';
import {
  rotatePdfPoint,
  utmFromPdfPoint,
  projectPost,
  dominantLineOrientation,
} from '../geo/utm-calibrator.js';

const theta = (5 * Math.PI) / 180;
const t = {
  origin_e: 1000,
  origin_n: 2000,
  x_scale_sf: 0.35,
  y_scale_sf: 0.35,
  theta,
  zone: 22,
};

const { rx, ry } = rotatePdfPoint(100, 50, theta);
const u0 = utmFromPdfPoint(100, 50, { ...t, theta: 0 });
const u1 = utmFromPdfPoint(100, 50, t);
assert.ok(Math.abs(u1.easting - (u0.easting + (rx - 100) * 0.35)) < 1e-6, 'rotated easting');
assert.ok(Math.abs(u1.northing - (u0.northing - (ry - 50) * 0.35)) < 1e-6, 'rotated northing');

const gps = projectPost(100, 50, t);
assert.ok(Number.isFinite(gps.lat) && Number.isFinite(gps.lon), 'projectPost with theta');

const gridOps = [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 200, y: 0 },
  { type: 'M', x: 0, y: 50 },
  { type: 'L', x: 0, y: 250 },
];
const thGrid = dominantLineOrientation(gridOps, 2);
assert.ok(Math.abs(thGrid) < 0.02, 'axis-aligned grid → ~0°');

const skewOps = [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 200, y: 20 },
  { type: 'M', x: -10, y: 0 },
  { type: 'L', x: -10, y: 200 },
];
const thSkew = dominantLineOrientation(
  [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 200, y: 35 },
    { type: 'M', x: 0, y: 50 },
    { type: 'L', x: 180, y: 85 },
    { type: 'M', x: 0, y: 100 },
    { type: 'L', x: 160, y: 130 },
  ],
  2
);
assert.ok(Math.abs(thSkew) > 0.08, 'skewed near-horizontal lines → non-zero θ');

console.log('utm-rotation.test.mjs: all assertions passed');
