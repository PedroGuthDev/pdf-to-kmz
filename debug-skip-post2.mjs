import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const path = "./parser/geo/label-lsq-calibrator.js";
const orig = readFileSync(path, "utf8");

// Find the function declaration. Insert an early return.
const target = `function tryLabelBracketPdfSnap(\r\n  prev,\r\n  post,\r\n  next,\r\n  distMap,\r\n  warnings,\r\n  opts = {},\r\n) {\r\n  const mBefore =`;

const replacement = `function tryLabelBracketPdfSnap(\r\n  prev,\r\n  post,\r\n  next,\r\n  distMap,\r\n  warnings,\r\n  opts = {},\r\n) {\r\n  if (post && post.number === 2) return false; // DEBUG: skip post 2\r\n  const mBefore =`;

const patched = orig.replace(target, replacement);
if (patched === orig) {
  console.error("PATCH FAILED");
  process.exit(1);
}
writeFileSync(path, patched);
// Refresh harness too
const r1 = spawnSync("node", ["debug-refresh-results.mjs"], { encoding: "utf8" });
const r2 = spawnSync("node", ["debug-run-calc.mjs", "joao-born"], { encoding: "utf8" });
console.log(r2.stdout.split("Comparison vs reference:")[1] || "no result");
writeFileSync(path, orig);
console.log("(restored)");
