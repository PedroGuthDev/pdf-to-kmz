/**
 * calc-user-warnings.test.mjs
 * Run: node parser/__tests__/calc-user-warnings.test.mjs
 */
import { buildCalcUserWarnings } from "../dwg/coordinate-calculator-dwg.js";

let pass = 0;
let fail = 0;
function assert(cond, name) {
  if (cond) {
    console.log(`  PASS: ${name}`);
    pass++;
  } else {
    console.error(`  FAIL: ${name}`);
    fail++;
  }
}

const posts85 = Array.from({ length: 85 }, (_, i) => ({
  number: i + 1,
  source: "dwg",
}));

assert(
  buildCalcUserWarnings({
    dwgStatus: "dwg-graph-walk",
    posts: posts85,
  }).length === 0,
  "graph-walk full DXF — no user notice",
);

const pdfOnly = buildCalcUserWarnings({
  dwgStatus: "pdf-fallback",
  dwgRegionId: "Siriu",
  posts: posts85.map((p) => ({ ...p, source: undefined })),
});
assert(
  pdfOnly.some((w) => /só pelo PDF/i.test(w)),
  "pdf-fallback warns PDF-only",
);

const partial = buildCalcUserWarnings({
  dwgStatus: "dwg-pdf-walk",
  dwgRegionId: "Siriu",
  posts: [
    { number: 1, source: "dwg" },
    { number: 2, source: "dwg" },
    { number: 3 },
  ],
});
assert(
  partial.some((w) => /guiado pelo PDF/i.test(w)),
  "dwg-pdf-walk warns degraded mode",
);
assert(
  partial.some((w) => /2 de 3/i.test(w)),
  "partial DXF count",
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
