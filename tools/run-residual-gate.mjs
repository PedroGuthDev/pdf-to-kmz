#!/usr/bin/env node
/**
 * Truth-free residual gate — CI assertions for the per-route confidence verdict.
 *
 * Asserts (D-05, ACC-03/ACC-04), with ANCHOR_* LOCKED at TRUST<10m / FAIL>20m
 * (user-specified strict accuracy threshold, residual-gate.js):
 *   1. Luiz Carolino must-fail fixture (posts 21-31) → gateDecision "fail" caused
 *      by the ANCHOR sub-score (shape median ~12.8% alone would NOT fail;
 *      anchor p95 ~301 m >> 20 m fails it). This is the ACC-03 success criterion.
 *   2. Valmor (cleanest known route, anchor p95 ~16.6 m in the 10-20 m band) →
 *      gateDecision "fallback".
 *   3. No route crashes the gate — every route returns a defined gateDecision
 *      (Siriu/João Born legitimately "fail" by anchor; that is not a false-fail
 *      because their real DWG anchor gaps are 100s of metres).
 *   4. Cascade-path lock (solverPaths in the baseline): which level produced
 *      each route's coords (global-solve / dwg-graph-walk / ...). Locks the
 *      Phase-8 solver's first acceptance (Valmor → global-solve) and makes any
 *      silent demotion-or-promotion drift fail loud.
 *
 * Run:  node tools/run-residual-gate.mjs
 * Refresh decision baseline after an intentional change:
 *   RESIDUAL_UPDATE_BASELINE=1 node tools/run-residual-gate.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeResiduals,
  computeAnchorGap,
  applyResidualGate,
} from "../parser/dwg/residual-gate.js";
import { runRouteDwgAccuracyHarness } from "./route-dwg-accuracy-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");
const BASELINE_PATH = path.join(FIXTURES, "residual-gate-baseline.json");

const LC_MUSTFAIL_PATH = path.join(FIXTURES, "luizcarolino-residual-mustfail.json");

// Routes exercised end-to-end through the live pipeline (dwgConfidence verdict).
const ROUTES = [
  { id: "siriu",        pdf: "INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf" },
  { id: "valmor",       pdf: "INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf" },
  { id: "joaoborn",     pdf: "INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf" },
  { id: "luizcarolino", pdf: "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf" },
];

function slackM(observed) {
  return Math.ceil((observed + 0.5) * 10) / 10;
}

async function runRoute(r) {
  const pdfPath = path.join(ROOT, r.pdf);
  const dwgRegionPath = path.join(FIXTURES, `${r.id}-dwg-region.json`);
  const groundTruthPath = path.join(FIXTURES, `${r.id}-ground-truth.json`);
  for (const [label, p] of [["PDF", pdfPath], ["DWG region", dwgRegionPath], ["ground truth", groundTruthPath]]) {
    if (!existsSync(p)) throw new Error(`${r.id}: missing ${label}: ${p}`);
  }
  const res = await runRouteDwgAccuracyHarness({ pdfPath, dwgRegionPath, groundTruthPath, regionId: r.id });
  return res;
}

async function main() {
  console.log("Truth-free residual gate (ANCHOR LOCKED: TRUST<10m / FAIL>20m)…");

  const failures = [];
  const observed = {};

  // ── Live per-route gate decisions ──────────────────────────────────────────
  const observedSolver = {};
  for (const r of ROUTES) {
    let dc;
    let solverPath = null;
    try {
      const res = await runRoute(r);
      dc = res.dwgConfidence ?? null;
      solverPath = res.solverPath ?? "none";
    } catch (e) {
      failures.push(`${r.id}: gate threw (${e.message ?? e})`);
      continue;
    }
    if (!dc || dc.gateDecision == null) {
      failures.push(`${r.id}: gate returned no decision (crash/undefined)`);
      continue;
    }
    observed[r.id] = {
      gateDecision: dc.gateDecision,
      shapeMedian: dc.shapeFidelity?.medianRelError ?? null,
      anchorP95: dc.anchorGap?.p95GapM ?? null,
    };
    observedSolver[r.id] = solverPath;
    console.log(
      `  ${r.id}: decision=${dc.gateDecision}` +
        ` shapeMedian=${(dc.shapeFidelity?.medianRelError ?? NaN).toFixed?.(4)}` +
        ` anchorP95=${(dc.anchorGap?.p95GapM ?? NaN).toFixed?.(1)} m` +
        ` path=${solverPath}`,
    );
  }

  // Assertion 2: Valmor (cleanest known route) → "fallback" (anchor in 10-20 m band).
  if (observed.valmor && observed.valmor.gateDecision !== "fallback") {
    failures.push(
      `valmor: expected gateDecision "fallback" (anchor ~16.6 m in 10-20 m band), got "${observed.valmor.gateDecision}"`,
    );
  }

  // ── LC must-fail fixture (ACC-03) — assertion 1 ─────────────────────────────
  if (!existsSync(LC_MUSTFAIL_PATH)) {
    failures.push(`LC must-fail fixture missing: ${LC_MUSTFAIL_PATH}`);
  } else {
    const fx = JSON.parse(readFileSync(LC_MUSTFAIL_PATH, "utf8"));
    const coords = fx["lc-21-31-pdfpath"] ?? [];
    const gps = new Map(Object.entries(fx.gpsByPostNumber ?? {}).map(([k, v]) => [Number(k), v]));
    const shape = computeResiduals(coords, fx.distances ?? []);
    const anchor = computeAnchorGap(coords, gps);
    const dc = applyResidualGate(shape, anchor);

    const shapeMedian = shape.medianRelError;
    const anchorP95 = anchor.p95GapM;
    // The fail must be caused by the anchor sub-score: anchor hard-fails (>= 20 m)
    // while shape alone would NOT hard-fail (median < SHAPE_FALLBACK=0.15).
    const anchorCausesFail = anchorP95 != null && anchorP95 >= 20;
    const shapeAloneFails = shapeMedian != null && shapeMedian >= 0.15;

    console.log(
      `  lc-mustfail(21-31): decision=${dc.gateDecision}` +
        ` shapeMedian=${shapeMedian?.toFixed(4)} anchorP95=${anchorP95?.toFixed(1)} m` +
        ` (anchorCausesFail=${anchorCausesFail}, shapeAloneFails=${shapeAloneFails})`,
    );

    if (dc.gateDecision !== "fail") {
      failures.push(`LC must-fail fixture: expected gateDecision "fail", got "${dc.gateDecision}"`);
    }
    if (!anchorCausesFail) {
      failures.push(
        `LC must-fail fixture: anchor sub-score did not cause the fail (anchorP95=${anchorP95} m, need >= 20 m). slack=${slackM(anchorP95 ?? 0)} m`,
      );
    }
    if (shapeAloneFails) {
      failures.push(
        `LC must-fail fixture: shape sub-score alone hard-fails (median=${shapeMedian}); the fixture must prove the ANCHOR sub-score is the cause (shape median must stay < 0.15)`,
      );
    }
    if (fx.expectedFailSubScore !== "anchor") {
      failures.push(`LC must-fail fixture: expectedFailSubScore must be "anchor", got "${fx.expectedFailSubScore}"`);
    }
    observed["lc-mustfail"] = { gateDecision: dc.gateDecision, shapeMedian, anchorP95 };
  }

  // ── Baseline write/compare (regression lock on the decision set) ────────────
  const updateBaseline =
    process.env.RESIDUAL_UPDATE_BASELINE === "1" || !existsSync(BASELINE_PATH);
  if (updateBaseline) {
    const baseline = {
      updated: new Date().toISOString().slice(0, 10),
      decisions: {},
      solverPaths: {},
    };
    for (const [k, v] of Object.entries(observed)) baseline.decisions[k] = v.gateDecision;
    for (const [k, v] of Object.entries(observedSolver)) baseline.solverPaths[k] = v;
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n", "utf8");
    console.log(`Baseline written to ${BASELINE_PATH}`);
  } else {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    for (const [k, decision] of Object.entries(baseline.decisions ?? {})) {
      const got = observed[k]?.gateDecision;
      if (got == null) {
        failures.push(`${k}: present in baseline but not produced this run`);
      } else if (got !== decision) {
        failures.push(`${k}: gateDecision regressed: got "${got}", baseline "${decision}"`);
      }
    }
    // Solver-path lock: level-0 acceptance must never silently regress. The
    // solver demoted on 100% of real routes for all of Phase 8 and nothing in
    // CI noticed — this lock makes cascade-path drift loud in both directions.
    if (!baseline.solverPaths) {
      failures.push(
        `baseline missing "solverPaths" section — refresh with RESIDUAL_UPDATE_BASELINE=1`,
      );
    } else {
      for (const [k, path] of Object.entries(baseline.solverPaths)) {
        const got = observedSolver[k];
        if (got == null) {
          failures.push(`${k}: solverPath in baseline but not produced this run`);
        } else if (got !== path) {
          failures.push(`${k}: cascade path changed: got "${got}", baseline "${path}"`);
        }
      }
    }
  }

  if (failures.length) {
    console.error("\nRESIDUAL GATE FAILED:\n");
    for (const f of failures) console.error(`  x ${f}`);
    console.error(`\n${failures.length} failure(s).`);
    console.error(
      "If this is an intentional change, refresh with:\n  RESIDUAL_UPDATE_BASELINE=1 node tools/run-residual-gate.mjs",
    );
    process.exit(1);
  }

  console.log(
    `PASS — LC must-fail → fail (anchor sub-score); valmor → fallback; ` +
      `${Object.keys(observed).length} decision(s) locked. No route crashed the gate.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
