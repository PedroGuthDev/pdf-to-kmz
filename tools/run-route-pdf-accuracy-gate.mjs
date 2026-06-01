#!/usr/bin/env node
/**
 * Luiz Carolino PDF-pipeline accuracy gate — exit 1 on any backward regression.
 *
 * Run:  node tools/run-route-pdf-accuracy-gate.mjs
 * Refresh baseline after intentional improvement:
 *   LUIZCAROLINO_UPDATE_BASELINE=1 node tools/run-route-pdf-accuracy-gate.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runRoutePdfAccuracyHarness } from "./route-pdf-accuracy-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

const PDF_PATH = path.join(
  ROOT,
  "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf",
);
const GT_PATH = path.join(FIXTURES, "luizcarolino-ground-truth.json");
const BASELINE_PATH = path.join(FIXTURES, "luizcarolino-pdf-baseline.json");

function slackM(observed) {
  return Math.ceil((observed + 0.5) * 10) / 10;
}

async function main() {
  console.log("Luiz Carolino PDF accuracy gate…");

  if (!existsSync(PDF_PATH)) {
    console.error(`Missing PDF: ${PDF_PATH}`);
    process.exit(1);
  }
  if (!existsSync(GT_PATH)) {
    console.error(`Missing ground truth: ${GT_PATH}`);
    process.exit(1);
  }

  const result = await runRoutePdfAccuracyHarness({
    pdfPath: PDF_PATH,
    groundTruthPath: GT_PATH,
  });

  const { matched, maxErr, meanErr, errorsByPost } = result;
  console.log(
    `  matched=${matched}, mean=${meanErr.toFixed(2)} m, max=${maxErr.toFixed(2)} m`,
  );

  const updateBaseline =
    process.env.LUIZCAROLINO_UPDATE_BASELINE === "1" || !existsSync(BASELINE_PATH);

  if (updateBaseline) {
    /** @type {Record<string, number>} */
    const maxErrM = {};
    for (const [n, err] of errorsByPost) {
      maxErrM[String(n)] = slackM(err);
    }
    const baseline = {
      updated: new Date().toISOString().slice(0, 10),
      matched,
      meanErrM: Math.round(meanErr * 100) / 100,
      maxErrM,
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n", "utf8");
    console.log(`Baseline written to ${BASELINE_PATH}`);
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const failures = [];

  if (matched < (baseline.matched ?? 0)) {
    failures.push(`matched posts regressed: got ${matched}, baseline ${baseline.matched}`);
  }

  for (const [post, ceiling] of Object.entries(baseline.maxErrM ?? {})) {
    const n = Number(post);
    const err = errorsByPost.get(n);
    if (err == null) {
      failures.push(`post ${n}: no PDF coordinate (missing?)`);
      continue;
    }
    if (err > ceiling) {
      failures.push(
        `post ${n}: err ${err.toFixed(2)} m > ceiling ${ceiling} m`,
      );
    }
  }

  if (failures.length) {
    console.error("\nLUIZ CAROLINO PDF GATE FAILED:\n");
    for (const f of failures) console.error(`  x ${f}`);
    console.error(`\n${failures.length} failure(s).`);
    console.error(
      "If this is an intentional improvement, refresh with:\n  LUIZCAROLINO_UPDATE_BASELINE=1 node tools/run-route-pdf-accuracy-gate.mjs",
    );
    process.exit(1);
  }

  console.log(
    `PASS — matched=${matched}, mean=${meanErr.toFixed(2)} m, max=${maxErr.toFixed(2)} m, ${Object.keys(baseline.maxErrM ?? {}).length} err ceilings`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
