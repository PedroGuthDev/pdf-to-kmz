#!/usr/bin/env node
/**
 * Siriu DWG graph-walk regression gate — exit 1 on any backward regression.
 *
 * Run:  npm run test:gate
 * Refresh baseline after intentional improvement:
 *   SIRIU_UPDATE_BASELINE=1 node tools/run-siriu-regression-gate.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSiriuRegressionHarness } from "./siriu-regression-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(
  __dirname,
  "..",
  "parser",
  "__tests__",
  "fixtures",
  "siriu-walk-regression-baseline.json",
);

function loadBaseline() {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

function slackM(observed) {
  return Math.ceil((observed + 0.5) * 10) / 10;
}

function buildUpdatedBaseline(baseline, result) {
  const maxErrM = { ...baseline.maxErrM };
  for (const [n, err] of result.errorsByPost) {
    if (n <= 64) maxErrM[String(n)] = slackM(err);
  }
  const knownBrokenPosts = { ...baseline.knownBrokenPosts };
  for (const [n, err] of result.errorsByPost) {
    if (n >= 65) knownBrokenPosts[String(n)] = slackM(err);
  }
  const criticalIdx = { ...baseline.criticalIdx };
  for (const [post, idx] of Object.entries(result.idxByPost)) {
    if (baseline.criticalIdx[post] != null) {
      criticalIdx[post] = idx;
    }
  }
  return {
    ...baseline,
    updated: new Date().toISOString().slice(0, 10),
    maxErrM,
    knownBrokenPosts,
    criticalIdx,
  };
}

function compare(baseline, result) {
  /** @type {string[]} */
  const failures = [];
  const req = baseline.require ?? {};

  if (result.dwgStatus !== req.dwgStatus) {
    failures.push(
      `dwgStatus: got "${result.dwgStatus}", require "${req.dwgStatus}"`,
    );
  }
  if (req.walkOk === true && !result.walkOk) {
    failures.push(`graph walk failed (walkOk=false)`);
  }
  if (
    typeof req.walkCoordsMin === "number" &&
    result.walkCoords < req.walkCoordsMin
  ) {
    failures.push(
      `walk coords ${result.walkCoords} < minimum ${req.walkCoordsMin}`,
    );
  }
  if (
    req.gpsFirstDivergentPost === null &&
    result.gpsFirstDivergentPost != null
  ) {
    failures.push(
      `GPS divergent at post ${result.gpsFirstDivergentPost} (require no divergence through post 46)`,
    );
  }

  for (const [post, expectedIdx] of Object.entries(
    baseline.criticalIdx ?? {},
  )) {
    const n = Number(post);
    const got = result.idxByPost[n];
    if (got !== expectedIdx) {
      failures.push(
        `post ${n} idx: got ${got ?? "null"}, require ${expectedIdx}`,
      );
    }
  }

  for (const [post, ceiling] of Object.entries(baseline.maxErrM ?? {})) {
    const n = Number(post);
    const err = result.errorsByPost.get(n);
    if (err == null) {
      failures.push(`post ${n}: no DWG error (missing pairing?)`);
      continue;
    }
    if (err > ceiling) {
      failures.push(
        `post ${n}: err ${err.toFixed(2)} m > ceiling ${ceiling} m`,
      );
    }
  }

  for (const [post, ceiling] of Object.entries(
    baseline.knownBrokenPosts ?? {},
  )) {
    const n = Number(post);
    const err = result.errorsByPost.get(n);
    if (err == null) continue;
    if (err > ceiling) {
      failures.push(
        `post ${n} (known-broken): err ${err.toFixed(2)} m > ceiling ${ceiling} m`,
      );
    }
  }

  return failures;
}

async function main() {
  console.log("Siriu regression gate…");
  const baseline = loadBaseline();
  const result = await runSiriuRegressionHarness();

  if (process.env.SIRIU_UPDATE_BASELINE === "1") {
    const next = buildUpdatedBaseline(baseline, result);
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
    console.log(`Updated baseline: ${BASELINE_PATH}`);
    return;
  }

  const failures = compare(baseline, result);
  if (failures.length) {
    console.error("\nREGRESSION GATE FAILED:\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(`\n${failures.length} failure(s).`);
    console.error(
      "If this is an intentional improvement, refresh with:\n  SIRIU_UPDATE_BASELINE=1 npm run test:gate",
    );
    process.exit(1);
  }

  const gated = Object.keys(baseline.maxErrM ?? {}).length;
  const idxGated = Object.keys(baseline.criticalIdx ?? {}).length;
  console.log(
    `PASS — dwgStatus=${result.dwgStatus}, walkOk=${result.walkOk}, coords=${result.walkCoords}, ${gated} err ceilings, ${idxGated} idx locks`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
