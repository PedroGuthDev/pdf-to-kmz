#!/usr/bin/env node
/**
 * Valmor DWG accuracy gate — exit 1 on any backward regression.
 *
 * Valmor is a clean 11-post DWG route extracted from Palhoca.dxf (no PDF sheet).
 * Because there is no PDF, the numbered PDF distance-label walk cannot drive it;
 * instead this gate validates that the committed DWG region fixture covers every
 * route post within the documented ~2.2 m tolerance, by mapping each ground-truth
 * post to its nearest region INSERT (UTM) and converting back to lat/lon.
 *
 * This is an extra tight regression guard for quick task 260602-lbl: it locks the
 * Valmor region fixture + the UTM<->lat/lon conversion used by the DWG path. (It
 * does not exercise parser/distance-associator.js, which requires PDF distances;
 * the Siriu and Luiz Carolino gates cover the associator changes.)
 *
 * Run:  node tools/run-valmor-accuracy-gate.mjs
 * Refresh baseline after intentional improvement:
 *   VALMOR_UPDATE_BASELINE=1 node tools/run-valmor-accuracy-gate.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  latLonToUtm,
  utmToLatLon,
  haversineMeters,
} from "../parser/geo/utm-calibrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

const GT_PATH = path.join(FIXTURES, "valmor-ground-truth.json");
const REGION_PATH = path.join(FIXTURES, "valmor-dwg-region.json");
const BASELINE_PATH = path.join(FIXTURES, "valmor-accuracy-baseline.json");

const ZONE = 22;
const MEAN_CEILING_M = 2.4; // documented baseline ~2.2 m + slack
const MAX_CEILING_M = 5.0;

function slackM(observed) {
  return Math.ceil((observed + 0.5) * 10) / 10;
}

function computeErrors() {
  const gt = JSON.parse(readFileSync(GT_PATH, "utf8"));
  const region = JSON.parse(readFileSync(REGION_PATH, "utf8"));
  const posts = region.posts ?? [];
  const errorsByPost = new Map();
  for (const g of gt) {
    const u = latLonToUtm(g.lat, g.lon);
    let best = Infinity;
    let bp = null;
    for (const p of posts) {
      const d = Math.hypot(p.x - u.easting, p.y - u.northing);
      if (d < best) {
        best = d;
        bp = p;
      }
    }
    if (!bp) continue;
    const ll = utmToLatLon(bp.x, bp.y, ZONE);
    errorsByPost.set(g.number, haversineMeters(ll.lat, ll.lon, g.lat, g.lon));
  }
  return { gtCount: gt.length, errorsByPost };
}

async function main() {
  console.log("Valmor DWG accuracy gate…");

  if (!existsSync(GT_PATH)) {
    console.error(`Missing ground truth: ${GT_PATH}`);
    process.exit(1);
  }
  if (!existsSync(REGION_PATH)) {
    console.error(`Missing DWG region: ${REGION_PATH}`);
    process.exit(1);
  }

  const { gtCount, errorsByPost } = computeErrors();
  const errs = [...errorsByPost.values()];
  const matched = errs.length;
  const meanErr = matched ? errs.reduce((s, e) => s + e, 0) / matched : 0;
  const maxErr = matched ? Math.max(...errs) : 0;

  console.log(
    `  posts: matched=${matched}/${gtCount}, mean=${meanErr.toFixed(2)} m, max=${maxErr.toFixed(2)} m`,
  );

  const updateBaseline =
    process.env.VALMOR_UPDATE_BASELINE === "1" || !existsSync(BASELINE_PATH);

  if (updateBaseline) {
    const maxErrM = {};
    for (const [n, err] of errorsByPost) maxErrM[String(n)] = slackM(err);
    const baseline = {
      updated: new Date().toISOString().slice(0, 10),
      gtCount,
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
  if (matched < gtCount) {
    failures.push(`only ${matched}/${gtCount} ground-truth posts placed`);
  }
  if (meanErr > MEAN_CEILING_M) {
    failures.push(`mean error ${meanErr.toFixed(2)} m > ceiling ${MEAN_CEILING_M} m`);
  }
  if (maxErr > MAX_CEILING_M) {
    failures.push(`max error ${maxErr.toFixed(2)} m > ceiling ${MAX_CEILING_M} m`);
  }
  for (const [post, ceiling] of Object.entries(baseline.maxErrM ?? {})) {
    const n = Number(post);
    const err = errorsByPost.get(n);
    if (err == null) {
      failures.push(`post ${n}: no DWG coordinate (missing?)`);
      continue;
    }
    if (err > ceiling) {
      failures.push(`post ${n}: err ${err.toFixed(2)} m > ceiling ${ceiling} m`);
    }
  }

  if (failures.length) {
    console.error("\nVALMOR GATE FAILED:\n");
    for (const f of failures) console.error(`  x ${f}`);
    console.error(`\n${failures.length} failure(s).`);
    console.error(
      "If this is an intentional improvement, refresh with:\n  VALMOR_UPDATE_BASELINE=1 node tools/run-valmor-accuracy-gate.mjs",
    );
    process.exit(1);
  }

  console.log(
    `PASS — matched=${matched}/${gtCount}, mean=${meanErr.toFixed(2)} m, max=${maxErr.toFixed(2)} m, ${Object.keys(baseline.maxErrM ?? {}).length} err ceilings`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
