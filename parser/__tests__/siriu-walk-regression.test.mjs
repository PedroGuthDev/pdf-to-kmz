// parser/__tests__/siriu-walk-regression.test.mjs
// Siriu E2E regression gate — fails if DWG walk quality regresses vs baseline.
//
// Run:  npm run test:gate
//       node --test parser/__tests__/siriu-walk-regression.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSiriuRegressionHarness } from "../../tools/siriu-regression-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = JSON.parse(
  readFileSync(
    path.join(__dirname, "fixtures", "siriu-walk-regression-baseline.json"),
    "utf8",
  ),
);

function compare(baseline, result) {
  const failures = [];
  const req = baseline.require ?? {};

  if (result.dwgStatus !== req.dwgStatus) {
    failures.push(
      `dwgStatus: got "${result.dwgStatus}", require "${req.dwgStatus}"`,
    );
  }
  if (req.walkOk === true && !result.walkOk) {
    failures.push("graph walk failed");
  }
  if (
    typeof req.walkCoordsMin === "number" &&
    result.walkCoords < req.walkCoordsMin
  ) {
    failures.push(
      `walk coords ${result.walkCoords} < ${req.walkCoordsMin}`,
    );
  }
  if (
    req.gpsFirstDivergentPost === null &&
    result.gpsFirstDivergentPost != null
  ) {
    failures.push(`GPS divergent at post ${result.gpsFirstDivergentPost}`);
  }

  for (const [post, expectedIdx] of Object.entries(
    baseline.criticalIdx ?? {},
  )) {
    const n = Number(post);
    if (result.idxByPost[n] !== expectedIdx) {
      failures.push(
        `post ${n} idx ${result.idxByPost[n] ?? "null"} != ${expectedIdx}`,
      );
    }
  }

  for (const [post, ceiling] of Object.entries(baseline.maxErrM ?? {})) {
    const n = Number(post);
    const err = result.errorsByPost.get(n);
    assert.ok(err != null, `post ${n} should have DWG coords`);
    if (err > ceiling) {
      failures.push(`post ${n} err ${err.toFixed(2)}m > ${ceiling}m`);
    }
  }

  return failures;
}

test("siriu-walk-regression: E2E gate vs baseline", async () => {
  const result = await runSiriuRegressionHarness();
  const failures = compare(BASELINE, result);
  assert.equal(
    failures.length,
    0,
    `Regression gate failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`,
  );
});
