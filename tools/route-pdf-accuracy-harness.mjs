/**
 * Route-agnostic PDF-pipeline accuracy harness.
 *
 * Exercises the PDF path: parsePdf -> calculateCoordinates -> per-post error vs ground truth.
 * Used by stages 2 (distance-associator) and 4 (coordinate-calculator seam-lock).
 *
 * @module route-pdf-accuracy-harness
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { parsePdf } from "../parser/pdf-parser.js";
import { calculateCoordinates } from "../parser/coordinate-calculator.js";
import { haversineMeters } from "../parser/geo/utm-calibrator.js";
import { refinePdfDistancesWithDwgTopology } from "./lc-pdf-dwg-topology-refine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "parser", "__tests__", "fixtures");

function objectToMap(o) {
  if (o == null) return null;
  if (o instanceof Map) return o;
  const m = new Map();
  for (const [k, v] of Object.entries(o)) m.set(Number.isFinite(+k) ? +k : k, v);
  return m;
}

/**
 * Run the PDF-pipeline accuracy harness for a single route.
 *
 * @param {{ pdfPath: string, groundTruthPath: string }} opts
 * @returns {Promise<{
 *   errorsByPost: Map<number, number>,
 *   matched: number,
 *   maxErr: number,
 *   meanErr: number,
 *   posts: Array<{ number: number, lat: number|null, lon: number|null }>,
 * }>}
 */
export async function runRoutePdfAccuracyHarness({
  pdfPath,
  groundTruthPath,
  dwgRegionPath = null,
}) {
  const groundTruth = JSON.parse(readFileSync(groundTruthPath, "utf8"));
  const refByNum = new Map(groundTruth.map((g) => [g.number, g]));
  const start = groundTruth[0];

  const pdfBuf = readFileSync(pdfPath);
  const parsed = await parsePdf(
    pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
  );
  if (parsed.error) throw new Error(`parsePdf: ${parsed.error}`);

  if (dwgRegionPath && existsSync(dwgRegionPath)) {
    const dwgRegion = JSON.parse(readFileSync(dwgRegionPath, "utf8"));
    refinePdfDistancesWithDwgTopology(parsed, start, dwgRegion);
  }

  const result = calculateCoordinates(
    parsed.posts ?? [],
    parsed.distances ?? [],
    start.lat,
    start.lon,
    parsed.cableSegments ?? [],
    {
      pageDimensions: objectToMap(parsed.pageDimensions),
      viewportBoxes: parsed.viewportBoxes ?? [],
      utmGridPathsPerPage: objectToMap(parsed.utmGridPathsPerPage),
      distanceLabelItems: parsed.distanceLabelItems ?? [],
    },
  );

  const errorsByPost = new Map();
  for (const p of result.posts ?? []) {
    const ref = refByNum.get(p.number);
    if (!ref || p.lat == null || p.lon == null) continue;
    errorsByPost.set(p.number, haversineMeters(p.lat, p.lon, ref.lat, ref.lon));
  }

  const matched = errorsByPost.size;
  const errs = [...errorsByPost.values()];
  const maxErr = errs.length ? Math.max(...errs) : 0;
  const meanErr = errs.length ? errs.reduce((s, e) => s + e, 0) / errs.length : 0;

  return {
    errorsByPost,
    matched,
    maxErr,
    meanErr,
    posts: result.posts ?? [],
  };
}
