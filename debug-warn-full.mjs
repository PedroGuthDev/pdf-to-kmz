import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { associateDistances } from "./parser/distance-associator.js";
import { assignPolesGloballyByLabels } from "./parser/post-positioning.js";
import { buildCablesByPage } from "./parser/cable-builder.js";
import { prefillGapDistancesForPolePlacement } from "./parser/geo/label-lsq-calibrator.js";
import { readFileSync } from "fs";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// Replicate harness flow:
const result = calculateCoordinates({
  posts: parsed.posts,
  distances: parsed.distances,
  cablePaths: parsed.cablePaths || [],
  viewportBoxes: parsed.viewportBoxes,
  pageDimensions: parsed.pageDimensions,
  utmGridPathsPerPage: parsed.utmGridPathsPerPage,
  cableSegments: parsed.cableSegments,
  posteRawCentroids: parsed.posteRawCentroids,
  distanceLabelItems: parsed.distanceLabelItems,
});
console.log("All warnings:");
for (const w of (result.warnings || [])) console.log("  ", w);
