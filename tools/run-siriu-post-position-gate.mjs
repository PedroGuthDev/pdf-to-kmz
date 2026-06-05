#!/usr/bin/env node
/**
 * Siriu per-post POSITION gate (milestone Phase 1.5).
 *
 * The companion lock to run-lc-post-position-gate.mjs. Both measure the
 * Poste-symbol→route-number placement layer (B) — `assignPolesGloballyByLabels`
 * (parser/post-positioning.js) — in ISOLATION from the multi-sheet label-LSQ
 * calibration (C). That function is the Siriu N3 calibrator: the four reverted
 * LC layer-B fixes (260603-n4k Phase 2) each regressed Siriu, but the standard
 * Siriu regression gate only sees the cumulative DWG-walk lat/lon error, so it
 * could not say WHICH posts moved or by how much. This gate does, per post.
 *
 * KEY DIFFERENCE FROM THE LC GATE — the truth is a SNAPSHOT, not hand-known
 * anchors. Siriu *legitimately* places posts far from their number-label anchor
 * (junctions: post 50 is ~501 pt off-anchor, 42 ~227 pt, 7 ~184 pt). So the
 * accepted/correct position IS the current parsed x,y. This fixture is therefore
 * a CHARACTERIZATION LOCK seeded from a pristine parse: it starts GREEN (zero
 * error) and goes RED the instant a layer-B change perturbs any Siriu post —
 * turning the previously-invisible blind trade into a per-post signal. Without
 * it, every placement change made to help LC is a blind trade against Siriu.
 *
 * Run:    node tools/run-siriu-post-position-gate.mjs
 * Seed:   SIRIU_POST_POS_UPDATE_BASELINE=1 node tools/run-siriu-post-position-gate.mjs
 *         (re-snapshots the truth — ONLY after an intended, gate-green change)
 * Env:    SIRIU_POST_POS_TOL_PT=<pt>   override tolerance (default from fixture _meta)
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
  "INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf",
);
const TRUTH_PATH = path.join(FIXTURES, "siriu-post-positions-truth.json");
const DEFAULT_TOL_PT = 1.0;

const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);

async function parseSiriu() {
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
  const offAnchor = usable
    .filter(
      (p) =>
        Number.isFinite(p.anchorX) &&
        Number.isFinite(p.anchorY) &&
        Math.hypot(p.x - p.anchorX, p.y - p.anchorY) > 30,
    )
    .map((p) => p.number);
  const doc = {
    _meta: {
      purpose:
        "Per-post expected PDF pole-symbol position (x,y in flipped page pt) for ALL Siriu posts. A CHARACTERIZATION/REGRESSION LOCK: a snapshot of the current correct parsed placement, used to detect when a layer-B (assignPolesGloballyByLabels) change made to help Luiz Carolino silently perturbs Siriu's positions. See .planning/quick/260603-n4k-debug-lc-post-symbol-assignment-collapse/260603-n4k-MILESTONE-SCOPE.md (Phase 1.5).",
      source:
        "Snapshot of the parser's accepted post.x/post.y from a pristine parse — NOT the number-label anchor. Unlike the LC truth (hand-known-correct anchors that the parser currently DIVERGES from), Siriu legitimately places posts off their anchors at junctions, so the accepted x,y IS the truth. Re-seed ONLY after an intended, gate-green placement change via SIRIU_POST_POS_UPDATE_BASELINE=1.",
      offAnchorPosts: offAnchor,
      offAnchorNote:
        "These posts sit >30 pt from their number anchor by design (junctions) — proof that an anchor-based 'correction' would regress Siriu. The lock protects them.",
      tolerancePt: DEFAULT_TOL_PT,
      postCount: usable.length,
      generatedFrom: "tools/run-siriu-post-position-gate.mjs (pristine parse)",
      generatedAt: new Date().toISOString().slice(0, 10),
    },
    posts: usable.map((p) => ({
      number: p.number,
      pageNum: p.pageNum,
      x: round2(p.x),
      y: round2(p.y),
      anchorX: round2(p.anchorX),
      anchorY: round2(p.anchorY),
    })),
  };
  writeFileSync(TRUTH_PATH, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(
    `Seeded truth: ${TRUTH_PATH}\n  ${doc.posts.length} posts, ` +
      `${offAnchor.length} legitimately off-anchor (${offAnchor.join(", ")})`,
  );
}

function compare(posts, truthDoc) {
  const truthPosts = truthDoc.posts ?? [];
  const tolPt =
    process.env.SIRIU_POST_POS_TOL_PT != null
      ? Number(process.env.SIRIU_POST_POS_TOL_PT)
      : (truthDoc._meta?.tolerancePt ?? DEFAULT_TOL_PT);
  const byNum = new Map(posts.map((p) => [p.number, p]));

  const failures = [];
  let worst = 0;
  let sum = 0;
  let n = 0;
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
    if (err > tolPt) {
      failures.push(
        `post ${t.number}: ${err.toFixed(1)} pt > tol ${tolPt} pt ` +
          `(parsed ${Math.round(p.x)},${Math.round(p.y)} vs truth ${Math.round(t.x)},${Math.round(t.y)})`,
      );
    }
  }

  const mean = n > 0 ? sum / n : 0;
  console.log(
    `  posts=${n}/${truthPosts.length}, mean err=${mean.toFixed(2)} pt, ` +
      `max=${worst.toFixed(2)} pt, tol=${tolPt} pt`,
  );

  if (failures.length) {
    console.error(
      `\nSIRIU POST-POSITION GATE FAILED (${failures.length} post(s) moved):`,
    );
    for (const f of failures) console.error(`  x ${f}`);
    console.error(
      "\nThis lock is GREEN at baseline. A failure means a placement change " +
        "perturbed Siriu's accepted positions — the blind trade the LC layer-B " +
        "fixes used to make invisibly. If the move is an intended improvement, " +
        "re-seed with SIRIU_POST_POS_UPDATE_BASELINE=1.",
    );
    process.exit(1);
  }

  console.log(
    `\nPASS — all ${n} Siriu posts within ${tolPt} pt of the locked position.`,
  );
}

async function main() {
  console.log("Siriu per-post POSITION gate…");
  const posts = await parseSiriu();

  if (process.env.SIRIU_POST_POS_UPDATE_BASELINE === "1" || !existsSync(TRUTH_PATH)) {
    if (!existsSync(TRUTH_PATH)) {
      console.log("  (no truth fixture yet — seeding from this pristine parse)");
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
