/**
 * Shared runner for per-route txt GPS accuracy gates (D-01/D-03).
 *
 * @module txt-accuracy-gate-runner
 */
import { existsSync } from "node:fs";

import { runRouteDwgAccuracyHarness } from "../route-dwg-accuracy-harness.mjs";
import { histogram, badPosts, formatHistogramLine } from "./accuracy-tiers.mjs";

/**
 * @param {{
 *   routeLabel: string,
 *   pdfPath: string,
 *   dwgRegionPath: string,
 *   groundTruthPath: string,
 *   regionId: string,
 *   excludedPosts?: Set<number>,
 *   excludedNote?: string,
 *   softFence?: boolean,
 * }} opts
 */
export async function runTxtAccuracyGate({
  routeLabel,
  pdfPath,
  dwgRegionPath,
  groundTruthPath,
  regionId,
  excludedPosts = null,
  excludedNote = "deferred to Phase 8 — soft fence",
  softFence = false,
}) {
  console.log(`${routeLabel} txt GPS accuracy gate…`);

  for (const [label, p] of [
    ["PDF", pdfPath],
    ["DWG region", dwgRegionPath],
    ["ground truth", groundTruthPath],
  ]) {
    if (!existsSync(p)) {
      console.error(`Missing ${label}: ${p}`);
      process.exit(1);
    }
  }

  const { errorsByPost, dwgStatus, walkOk, walkCoords } =
    await runRouteDwgAccuracyHarness({
      pdfPath,
      dwgRegionPath,
      groundTruthPath,
      regionId,
    });

  console.log(
    `  dwgStatus=${dwgStatus}, walkOk=${walkOk}, walkCoords=${walkCoords}, measured=${errorsByPost.size}`,
  );

  const counts = histogram(errorsByPost);
  console.log(`  Tier histogram: ${formatHistogramLine(counts)}`);

  const bad = badPosts(errorsByPost);
  const deferredBad = excludedPosts
    ? bad.filter(([n]) => excludedPosts.has(n))
    : [];
  const badInScope = excludedPosts
    ? bad.filter(([n]) => !excludedPosts.has(n))
    : bad;

  if (deferredBad.length) {
    console.log(
      `  ${excludedNote}: ${deferredBad.length} bad-tier post(s) excluded from exit rule — ` +
        deferredBad.map(([n, m]) => `${n} (${m.toFixed(1)} m)`).join(", "),
    );
  }

  if (badInScope.length) {
    if (softFence) {
      console.error(
        `\n[SOFT FENCE — deferred to Phase 8] ${routeLabel.toUpperCase()} TXT-ACCURACY: ` +
          `${badInScope.length} bad-tier post(s) reported but NOT blocking (exit 0):\n`,
      );
      for (const [n, m] of badInScope) {
        console.error(`  x post ${n}: ${m.toFixed(1)} m (BAD >15 m)`);
      }
      console.error(
        `\n${badInScope.length} bad-tier post(s) above — soft fence, exit 0 (Phase 8 will fix).`,
      );
    } else {
      console.error(`\n${routeLabel.toUpperCase()} TXT-ACCURACY GATE FAILED:\n`);
      for (const [n, m] of badInScope) {
        console.error(`  x post ${n}: ${m.toFixed(1)} m (BAD >15 m)`);
      }
      console.error(`\n${badInScope.length} failure(s) — zero bad-tier floor (D-03).`);
      process.exit(1);
    }
  }

  const scopeNote = excludedPosts
    ? ` (${errorsByPost.size} measured; ${excludedPosts.size} posts scoped out of exit rule)`
    : ` (${errorsByPost.size} measured)`;
  if (softFence && badInScope.length) {
    console.log(
      `\nSOFT-FENCE PASS — ${badInScope.length} bad-tier post(s) deferred to Phase 8${scopeNote}.`,
    );
  } else {
    console.log(`\nPASS — zero bad-tier posts within gate scope${scopeNote}.`);
  }
}
