#!/usr/bin/env node
/**
 * João Born per-post POSITION gate (Phase 7 — solver prerequisites, D-05).
 *
 * The JB companion to run-lc-post-position-gate.mjs and
 * run-siriu-post-position-gate.mjs. Measures the Poste-symbol→route-number
 * placement layer (B) in ISOLATION from the multi-sheet label-LSQ calibration
 * (C). The standard PDF accuracy gate only sees the cumulative lat/lon error,
 * which C *compensates* — so a placement bug is masked there. This gate compares
 * each parsed JB post's PDF pole position (x,y) against the hand-known-correct
 * anchor in joaoborn-post-positions-truth.json and fails when any post is
 * farther than the tolerance. One of the four SOLVE-05 position gates feeding
 * the Phase 8 solver.
 *
 * The truth is a CANDIDATE seeded from a pristine parse (anchorX/anchorY printed
 * alongside x,y) and then HAND-VERIFIED by the user against the JB PDF sheet
 * before being locked — see .planning/phases/07-solver-prerequisites/07-02-PLAN.md.
 *
 * Run:    node tools/run-joaoborn-post-position-gate.mjs
 * Seed:   JOAOBORN_POST_POS_UPDATE_BASELINE=1 node tools/run-joaoborn-post-position-gate.mjs
 *         (re-captures the candidate fixture from a pristine parse and prints the
 *          anchor dump to stderr for hand verification — exits 0)
 * Env:    JOAOBORN_POST_POS_TOL_PT=<pt>   override tolerance (default from fixture _meta)
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
  "INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf",
);
const TRUTH_PATH = path.join(FIXTURES, "joaoborn-post-positions-truth.json");
const DEFAULT_TOL_PT = 50;

const round = (v) => (Number.isFinite(v) ? Math.round(v) : v);

async function parseJoaoBorn() {
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
    console.error(`Parse failed: ${parsed.error}`);
    process.exit(1);
  }
  return parsed.posts ?? [];
}

function seedTruth(posts) {
  const usable = posts
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.number - b.number);

  // Print the anchor dump to stderr so the captured positions can be
  // hand-verified against the JB PDF sheet (D-05). anchorX/anchorY is the
  // Numero_Poste label centroid, computed independently of pole assignment.
  console.error("\nJB anchor dump (hand-verify each against the PDF sheet):");
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
        "Per-post expected PDF pole-symbol position (x,y in flipped page pt) for ALL João Born posts. Enables a position gate that measures Poste-symbol placement (layer B) in isolation from the label-LSQ calibration (which can compensate for placement errors). One of the four SOLVE-05 position gates feeding the Phase 8 solver. See .planning/phases/07-solver-prerequisites/07-02-PLAN.md (D-05).",
      source: "hand-known anchors, JB v04",
      scope: "all posts",
      tolerancePt: DEFAULT_TOL_PT,
      postCount: usable.length,
      generatedFrom: "tools/run-joaoborn-post-position-gate.mjs (pristine parse, candidate)",
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
      "Hand-verify the anchor dump above against the JB PDF sheet, then lock.",
  );
}

function compare(posts, truthDoc) {
  const truthPosts = truthDoc.posts ?? [];
  const _jbRaw = Number(process.env.JOAOBORN_POST_POS_TOL_PT);
  const tolPt =
    process.env.JOAOBORN_POST_POS_TOL_PT != null
      ? (Number.isFinite(_jbRaw) && _jbRaw > 0
          ? _jbRaw
          : (truthDoc._meta?.tolerancePt ?? DEFAULT_TOL_PT))
      : (truthDoc._meta?.tolerancePt ?? DEFAULT_TOL_PT);
  if (process.env.JOAOBORN_POST_POS_TOL_PT !== undefined && !(Number.isFinite(_jbRaw) && _jbRaw > 0)) {
    console.warn(`[warn] JOAOBORN_POST_POS_TOL_PT="${process.env.JOAOBORN_POST_POS_TOL_PT}" is not a valid positive number; using default ${tolPt}`);
  }
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
    console.error(`\nJB POST-POSITION GATE FAILED (${failures.length} post(s) off):`);
    for (const f of failures) console.error(`  x ${f}`);
    console.error(
      "\nThis gate measures JB placement (layer B) in isolation from calibration. " +
        "If the move is an intended improvement, re-capture the candidate with " +
        "JOAOBORN_POST_POS_UPDATE_BASELINE=1 and re-verify the anchors.",
    );
    process.exit(1);
  }

  console.log(`\nPASS — all ${n} posts within ${tolPt} pt of expected position.`);
}

async function main() {
  console.log("João Born per-post POSITION gate…");
  const posts = await parseJoaoBorn();

  if (
    process.env.JOAOBORN_POST_POS_UPDATE_BASELINE === "1" ||
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
