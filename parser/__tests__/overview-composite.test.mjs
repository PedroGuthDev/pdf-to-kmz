import assert from 'node:assert/strict';
import {
  detailPointToOverview,
  remapPathOpsToOverview,
  applyOverviewComposite,
} from '../geo/overview-composite.js';

console.log('\n[overview-composite] detailPointToOverview scales into viewport box');
const box = { x: 100, y: 200, w: 400, h: 300 };
const pageDim = { w: 1000, h: 800 };
const p = detailPointToOverview(500, 400, box, pageDim, 0.4, 0.5);
assert(Math.abs(p.x - 500) < 1e-6, `x expected 500 got ${p.x}`);
assert(Math.abs(p.y - 520) < 1e-6, `y expected 520 got ${p.y}`);

console.log('\n[overview-composite] remapPathOps preserves segment count');
const ops = [
  { type: 'M', x: 0, y: 0 },
  { type: 'L', x: 1000, y: 0 },
];
const remapped = remapPathOpsToOverview(ops, box, pageDim, 0.4, 0.5);
assert.equal(remapped.length, 2);
assert(Math.abs(remapped[1].x - 900) < 1e-6, 'line end x in overview space');

console.log('\n[overview-composite] applyOverviewComposite remaps posts to page 2');
const posts = [{ number: 1, x: 500, y: 400, pageNum: 3, anchorX: 500, anchorY: 400 }];
const warnings = [];
const ok = applyOverviewComposite({
  posts,
  posteRawCentroids: [],
  cablePaths: [],
  distanceLabelItems: [],
  utmGridPathsPerPage: new Map(),
  viewportBoxes: [{ pageNum: 3, rect: box }],
  pageDimensions: new Map([
    [2, pageDim],
    [3, pageDim],
  ]),
  warnings,
});
assert.equal(ok, false, 'single viewport below min threshold');

const ok3 = applyOverviewComposite({
  posts,
  posteRawCentroids: [],
  cablePaths: [],
  distanceLabelItems: [],
  utmGridPathsPerPage: new Map([
    [
      2,
      [
        [
          { type: 'M', x: 0, y: 0 },
          { type: 'L', x: 100, y: 0 },
          { type: 'L', x: 100, y: 100 },
        ],
      ],
    ],
  ]),
  viewportBoxes: [
    { pageNum: 3, rect: box },
    { pageNum: 4, rect: { x: 600, y: 200, w: 400, h: 300 } },
  ],
  pageDimensions: new Map([
    [2, pageDim],
    [3, pageDim],
    [4, pageDim],
  ]),
  warnings,
  perPageScale: pn => (pn === 3 ? 0.4 : 0.5),
});
assert.equal(ok3, true);
assert.equal(posts[0].pageNum, 2);
assert(Math.abs(posts[0].x - 500) < 1e-6);

console.log('\noverview-composite tests passed');
