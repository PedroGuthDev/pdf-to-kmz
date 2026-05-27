/**
 * Browser bundle entry — npm deps (idb, dxf-parser, rbush) are inlined by esbuild.
 * Run: npm run build:browser
 */
export { createRegionLibrary } from "./region-library.js";
export { calculateCoordinatesWithDwg } from "./coordinate-calculator-dwg.js";
