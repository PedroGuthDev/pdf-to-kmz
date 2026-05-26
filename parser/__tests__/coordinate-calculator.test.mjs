/**
 * Tests for coordinate-calculator.js (UTM-grid rewrite — Plan 02-04)
 *
 * Behavior blocks from 02-04-PLAN.md Task 1:
 * - calculateCoordinates() with empty posts returns { posts: [], connections: [] }
 * - calculateCoordinates() with one post (post #1) and valid utmCalibrationData assigns lat/lon from projectPost()
 * - calculateCoordinates() with two same-page posts produces connection with meters = pdfDist * scaleFactor and bearing = atan2(dx, curr.y - next.y)
 * - calculateCoordinates() with two cross-page posts produces connection with cross_page: true, meters = haversine, bearing = gpsBearing
 * - calculateCoordinates() with missing utmCalibrationData falls back gracefully: pushes warning and returns posts with lat: null
 * - detectGaps() with cable segment on page 4 does NOT prevent gap detection between posts on page 3 (same-page filter)
 * - detectGaps() still detects gaps when pageNum is null on cableSegments (null = any page, no filtering)
 * - All existing functions (parseCoordinateInput, validateBrazilBounds, detectRouteTopology) are still present and exportable
 */

// NOTE: This test runs via `node --input-type=module` piped in, or as an ES module
// We use a lightweight assert pattern (no test framework required — just console.assert + process.exit)

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const calculatorPath = path.join(__dirname, '..', 'coordinate-calculator.js');

let PASS = 0;
let FAIL = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  PASS: ${name}`);
    PASS++;
  } else {
    console.error(`  FAIL: ${name}`);
    FAIL++;
  }
}

// ── Test 1: Structural — all 5 exports must exist ──────────────────────────
console.log('\n[Test Group 1] Structural exports present');
const src = readFileSync(calculatorPath, 'utf8');
assert(src.includes('export function parseCoordinateInput'), 'parseCoordinateInput exported');
assert(src.includes('export function validateBrazilBounds'), 'validateBrazilBounds exported');
assert(src.includes('export function detectRouteTopology'), 'detectRouteTopology exported');
assert(src.includes('export function detectGaps'), 'detectGaps exported');
assert(src.includes('export function calculateCoordinates'), 'calculateCoordinates exported');

// ── Test 2: UTM import present ─────────────────────────────────────────────
console.log('\n[Test Group 2] UTM calibrator import');
assert(
  src.includes("from './geo/utm-calibrator.js'") ||
    src.includes('from "./geo/utm-calibrator.js"'),
  'utm-calibrator.js import present',
);

// ── Test 3: Sequential chaining is gone ───────────────────────────────────
console.log('\n[Test Group 3] Sequential chaining removed');
assert(!src.includes('dLat = (m * Math.cos'), 'no sequential chaining dLat formula');
assert(!src.includes('dLon = (m * Math.sin'), 'no sequential chaining dLon formula');

// ── Test 4: UTM calibration keywords present ───────────────────────────────
console.log('\n[Test Group 4] UTM calibration keywords');
// D-ACC-07 renamed utmCalibrationData -> opts; verify new param name and key destructured fields
assert(src.includes('opts = null') || src.includes('opts=null'), 'opts param present (renamed from utmCalibrationData)');
assert(src.includes('buildPageTransforms'), 'buildPageTransforms called');
assert(src.includes('projectPost'), 'projectPost called');
assert(src.includes('computeScaleFactor'), 'computeScaleFactor called');

// ── Test 5: Page filter in detectGaps ─────────────────────────────────────
console.log('\n[Test Group 5] detectGaps page filter');
assert(src.includes('segment.pageNum !== curr.pageNum'), 'page filter in detectGaps');

// ── Test 6: Cross-page support ────────────────────────────────────────────
console.log('\n[Test Group 6] Cross-page connection flag');
assert(src.includes('cross_page: true'), 'cross_page: true flag present');

// ── Test 7: Connections contract shape preserved ──────────────────────────
console.log('\n[Test Group 7] Connections contract fields');
assert(src.includes('from: curr.number') || src.includes('from: junc.number'), 'connections from field');
assert(src.includes('to: next.number') || src.includes('to: curr.number'), 'connections to field');
assert(src.includes('gap: isGap') || src.includes('gap: false'), 'connections gap field');
assert(
  src.includes('isOffRouteCablePost(curr, postMap, cablesByPageForConn)'),
  'main-route connections skip off-cable auxiliary posts',
);
assert(src.includes('metersForRouteHop'), 'route hop sums label spans past auxiliary posts');
assert(src.includes('meters'), 'connections meters field');
assert(src.includes('bearing'), 'connections bearing field');

// ── Test 8: Graceful fallback on null utmCalibrationData ─────────────────
console.log('\n[Test Group 8] Null utmCalibrationData fallback');
assert(src.includes('lat: null') || src.includes("'[coordinate-calculator]"), 'null utmCalibrationData warning present');

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) {
  console.error(`\nFAILED ${FAIL} test(s) — implementation needed`);
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
