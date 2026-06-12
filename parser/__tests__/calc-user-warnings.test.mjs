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

// MED/LOW confidence posts are listed as user notices (tiers no longer recolor
// the KMZ icons — user decision 2026-06-12).
const tiered = buildCalcUserWarnings({
  dwgStatus: "global-solve",
  dwgRegionId: "Palhoca",
  posts: posts85,
  dwgConfidence: {
    postTiers: [
      { postNumber: 1, tier: "HIGH" },
      { postNumber: 4, tier: "MED" },
      { postNumber: 10, tier: "LOW" },
      { postNumber: 11, tier: "LOW" },
    ],
  },
});
assert(
  tiered.some((w) => /confiança BAIXA: 10, 11/.test(w)),
  "LOW posts listed",
);
assert(
  tiered.some((w) => /confiança MÉDIA: 4/.test(w)),
  "MED posts listed",
);
assert(
  !tiered.some((w) => /%/.test(w)),
  "no percent sign in tier notices",
);

assert(
  buildCalcUserWarnings({
    dwgStatus: "global-solve",
    posts: posts85,
    dwgConfidence: {
      postTiers: [
        { postNumber: 1, tier: "HIGH" },
        { postNumber: 2, tier: "HIGH" },
      ],
    },
  }).length === 0,
  "all-HIGH tiers — no tier notice",
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
