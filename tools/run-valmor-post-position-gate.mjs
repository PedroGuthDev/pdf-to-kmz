#!/usr/bin/env node
/**
 * Valmor per-post POSITION gate (Phase 7 — solver prerequisites, D-06).
 *
 * The Valmor companion to run-lc-post-position-gate.mjs,
 * run-siriu-post-position-gate.mjs and run-joaoborn-post-position-gate.mjs.
 * Measures the Poste-symbol→route-number placement layer (B) in ISOLATION from
 * the multi-sheet label-LSQ calibration (C). The standard PDF accuracy gate only
 * sees the cumulative lat/lon error, which C *compensates* — so a placement bug
 * is masked there. This gate compares each parsed Valmor post's PDF pole position
 * (x,y) against the hand-known-correct anchor in valmor-post-positions-truth.json
 * and fails when any post is farther than the tolerance. One of the four SOLVE-05
 * position gates feeding the Phase 8 solver.
 *
 * Valmor was previously treated as DWG-only. D-06 forbids exempting it: this gate
 * FIRST verifies the Valmor PDF parses with usable per-post pole symbols. If the
 * PDF does NOT yield usable positions, that is a real blocker to escalate (per
 * D-06), NOT a reason to silently skip Valmor.
 *
 * The truth is a CANDIDATE seeded from a pristine parse (anchorX/anchorY printed
 * alongside x,y) and then HAND-VERIFIED by the user against the Valmor PDF sheet
 * before being locked — see .planning/phases/07-solver-prerequisites/07-03-PLAN.md.
 *
 * Run:    node tools/run-valmor-post-position-gate.mjs
 * Seed:   VALMOR_POST_POS_UPDATE_BASELINE=1 node tools/run-valmor-post-position-gate.mjs
 *         (re-captures the candidate fixture from a pristine parse and prints the
 *          anchor dump to stderr for hand verification — exits 0 if viable)
 * Env:    VALMOR_POST_POS_TOL_PT=<pt>   override tolerance (default from fixture _meta)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "fake-indexeddb/auto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");
const PDF_PATH = path.join(
  ROOT,
  "INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf",
);
const TRUTH_PATH = path.join(FIXTURES, "valmor-post-positions-truth.json");
const DEFAULT_TOL_PT = 50;
const MIN_USABLE_POSTS = 11;

const round = (v) => (Number.isFinite(v) ? Math.round(v) : v);

async function parseValmor() {
  if (!existsSync(PDF_PATH)) {
    console.error(`Missing PDF: ${PDF_PATH}`);
    process.exit(1);
  }
  const { parsePdf } = await import("../parser/pdf-parser.js");
  const buf = readFileSync(PDF_PATH);
  const parsed = await parsePdf(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  if (parsed.error) {
    console.error(
      `Valmor PDF did not parse usable per-post positions (parse error: ${parsed.error}) — ` +
        "escalate per D-06; do NOT exempt Valmor.",
    );
    process.exit(1);
  }
  return parsed.posts ?? [];
}

function assertViable(posts) {
  const usable = posts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (usable.length < MIN_USABLE_POSTS) {
    console.error(
      `Valmor PDF did not parse usable per-post positions ` +
        `(${usable.length} posts with finite x,y, need >= ${MIN_USABLE_POSTS}) — ` +
        "escalate per D-06; do NOT exempt Valmor.",
    );
    process.exit(1);
  }
  return usable;
}

function seedTruth(posts) {
  const usable = assertViable(posts).sort((a, b) => a.number - b.number);

  // Print the anchor dump to stderr so the captured positions can be
  // hand-verified against the Valmor PDF sheet (D-06). anchorX/anchorY is the
  // Numero_Poste label centroid, computed independently of pole assignment.
  console.error("\nValmor anchor dump (hand-verify each against the PDF sheet):");
  console.error("  post  pageNum    parsed x,y      anchor x,y       |xy-anchor|");
  for (const p of usable) {
    const dAnchor =
      Number.isFinite(p.anchorX) && Number.isFinite(p.anchorY)
        ? Math.hypot(p.x - p.anchorX, p.y - p.anchorY)
        : NaN;
    console.error(
      `   ${String(p.number).padStart(2)}     ${String(p.pageNum).padStart(2)}     ` +
        `${String(round(p.x)).padStart(5)},${String(round(p.y)).padStart(5)}   ` +
        `${String(round(p.anchorX)).padStart(5)},${String(round(p.anchorY)).padStart(5)}   ` +
        `${(Number.isFinite(dAnchor) ? dAnchor.toFixed(1) : "n/a").padStart(8)}`,
    );
  }

  const doc = {
    _meta: {
      purpose:
        "Per-post expected PDF pole-symbol position (x,y in flipped page pt) for ALL Valmor posts. Enables a position gate that measures Poste-symbol placement (layer B) in isolation from the label-LSQ calibration (which can compensate for placement errors). One of the four SOLVE-05 position gates feeding the Phase 8 solver. D-06 forbids exempting Valmor: this is captured from a real PDF parse, not a DWG-only stand-in. See .planning/phases/07-solver-prerequisites/07-03-PLAN.md (D-06).",
      source: "hand-known anchors, Valmor v1",
      scope: "all posts",
      tolerancePt: DEFAULT_TOL_PT,
      postCount: usable.length,
      generatedFrom: "tools/run-valmor-post-position-gate.mjs (pristine parse, candidate)",
      generatedAt: new Date().toISOString().slice(0, 10),
    },
    posts: usable.map((p) => ({
      number: p.number,
      pageNum: p.pageNum,
      x: round(p.x),
      y: round(p.y),
    })),
  };
  writeFileSync(TRUTH_PATH, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(
    `\nSeeded candidate truth: ${TRUTH_PATH}\n  ${doc.posts.length} posts captured. ` +
      "Hand-verify the anchor dump above against the Valmor PDF sheet, then lock.",
  );
}

function compare(posts, truthDoc) {
  const truthPosts = truthDoc.posts ?? [];
  const tolPt =
    process.env.VALMOR_POST_POS_TOL_PT != null
      ? Number(process.env.VALMOR_POST_POS_TOL_PT)
      : (truthDoc._meta?.tolerancePt ?? DEFAULT_TOL_PT);
  const byNum = new Map(posts.map((p) => [p.number, p]));

  const failures = [];
  let worst = 0;
  let sum = 0;
  let n = 0;
  console.log("  post   parsed x,y      truth x,y      err(pt)");
  for (const t of truthPosts) {
    const p = byNum.get(t.number);
    if (!p) {
      failures.push(`post ${t.number}: not parsed (missing)`);
      continue;
    }
    const err = Math.hypot((p.x ?? NaN) - t.x, (p.y ?? NaN) - t.y);
    sum += err;
    n++;
    worst = Math.max(worst, err);
    const flag = err > tolPt ? "  <== FAIL" : "";
    console.log(
      `   ${String(t.number).padStart(2)}    ${String(round(p.x)).padStart(5)},${String(round(p.y)).padStart(5)}   ` +
        `${String(t.x).padStart(5)},${String(t.y).padStart(5)}   ${err.toFixed(1).padStart(6)}${flag}`,
    );
    if (err > tolPt) {
      failures.push(`post ${t.number}: ${err.toFixed(1)} pt > tol ${tolPt} pt`);
    }
  }

  const mean = n > 0 ? sum / n : 0;
  console.log(
    `\n  posts=${n}/${truthPosts.length}, mean err=${mean.toFixed(1)} pt, max=${worst.toFixed(1)} pt, tol=${tolPt} pt`,
  );

  if (failures.length) {
    console.error(`\nVALMOR POST-POSITION GATE FAILED (${failures.length} post(s) off):`);
    for (const f of failures) console.error(`  x ${f}`);
    console.error(
      "\nThis gate measures Valmor placement (layer B) in isolation from calibration. " +
        "If the move is an intended improvement, re-capture the candidate with " +
        "VALMOR_POST_POS_UPDATE_BASELINE=1 and re-verify the anchors.",
    );
    process.exit(1);
  }

  console.log(`\nPASS — all ${n} posts within ${tolPt} pt of expected position.`);
}

async function main() {
  console.log("Valmor per-post POSITION gate…");
  const posts = await parseValmor();

  if (
    process.env.VALMOR_POST_POS_UPDATE_BASELINE === "1" ||
    !existsSync(TRUTH_PATH)
  ) {
    if (!existsSync(TRUTH_PATH)) {
      console.log("  (no truth fixture yet — seeding candidate from this pristine parse)");
    }
    seedTruth(posts);
    return;
  }

  const truthDoc = JSON.parse(readFileSync(TRUTH_PATH, "utf8"));
  compare(posts, truthDoc);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
