import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const path = "./parser/geo/label-lsq-calibrator.js";
const orig = readFileSync(path, "utf8");
// Use a more targeted patch - insert AFTER the function signature
const target = `function tryLabelBracketPdfSnap(
  prev,
  post,
  next,
  distMap,
  warnings,
  opts = {},
) {
  const mBefore =`;
const replacement = `function tryLabelBracketPdfSnap(
  prev,
  post,
  next,
  distMap,
  warnings,
  opts = {},
) {
  if (post && post.number === 2) console.error('[TRACE] tryLabelBracketPdfSnap for post 2: prev=' + prev?.number + ' next=' + next?.number + ' at (' + post.x.toFixed(2) + ',' + post.y.toFixed(2) + ')');
  const mBefore =`;
const patched = orig.replace(target, replacement);
if (patched === orig) {
  console.error("PATCH FAILED - target not found");
  process.exit(1);
}
writeFileSync(path, patched);

const r = spawnSync("node", ["debug-run-calc.mjs", "joao-born"], { encoding: "utf8" });
console.log("STDERR lines with TRACE:");
const errLines = r.stderr.split("\n").filter(l => l.includes("TRACE"));
for (const l of errLines) console.log(l);

const stdoutLines = r.stdout.split("\n").filter(l => l.includes("post 2") || l.includes("Post  2"));
console.log("\nstdout post 2 lines:");
for (const l of stdoutLines) console.log(l);

writeFileSync(path, orig);
console.log("\n(restored)");
