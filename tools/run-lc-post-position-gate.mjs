#!/usr/bin/env node
/**
 * Luiz Carolino per-post POSITION gate (milestone Phase 1).
 *
 * Measures the Poste-symbol→route-number placement layer (B) in ISOLATION from
 * the multi-sheet label-LSQ calibration (C). The standard PDF accuracy gate only
 * sees the cumulative lat/lon error, which C *compensates* — so a placement bug
 * (posts 9/10/11 collapsing onto wrong/shared pole symbols) is masked there. This
 * gate compares each parsed post's PDF pole position (x,y) against the expected
 * position in luizcarolino-post-positions-truth.json and fails when any post is
 * farther than the tolerance.
 *
 * EXPECTED INITIAL STATE: RED for posts 9, 10, 11 (the documented collapse). It
 * turns GREEN when Phase 2 fixes the placement. Additive — does not touch the
 * parser or the other gates.
 *
 * Run:  node tools/run-lc-post-position-gate.mjs
 * Env:  LC_POST_POS_TOL_PT=<pt>   override tolerance (default from fixture _meta)
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "fake-indexeddb/auto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");
const PDF_PATH = path.join(
  ROOT,
  "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf",
);
const TRUTH_PATH = path.join(FIXTURES, "luizcarolino-post-positions-truth.json");

async function main() {
  console.log("Luiz Carolino per-post POSITION gate…");

  if (!existsSync(PDF_PATH)) {
    console.error(`Missing PDF: ${PDF_PATH}`);
    process.exit(1);
  }
  if (!existsSync(TRUTH_PATH)) {
    console.error(`Missing position truth: ${TRUTH_PATH}`);
    process.exit(1);
  }

  const truthDoc = JSON.parse(readFileSync(TRUTH_PATH, "utf8"));
  const truthPosts = truthDoc.posts ?? [];
  const tolPt =
    process.env.LC_POST_POS_TOL_PT != null
      ? Number(process.env.LC_POST_POS_TOL_PT)
      : (truthDoc._meta?.tolerancePt ?? 50);

  const { parsePdf } = await import("../parser/pdf-parser.js");
  const buf = readFileSync(PDF_PATH);
  const parsed = await parsePdf(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  if (parsed.error) {
    console.error(`Parse failed: ${parsed.error}`);
    process.exit(1);
  }
  const byNum = new Map((parsed.posts ?? []).map((p) => [p.number, p]));

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
      `   ${String(t.number).padStart(2)}    ${String(Math.round(p.x ?? NaN)).padStart(5)},${String(Math.round(p.y ?? NaN)).padStart(5)}   ` +
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
    console.error(`\nLC POST-POSITION GATE FAILED (${failures.length} post(s) off):`);
    for (const f of failures) console.error(`  x ${f}`);
    console.error(
      "\nThis gate is EXPECTED red until the Phase-2 post-positioning rework " +
        "(posts 9/10/11 collapse). It measures placement in isolation from calibration.",
    );
    process.exit(1);
  }

  console.log(`\nPASS — all ${n} posts within ${tolPt} pt of expected position.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
