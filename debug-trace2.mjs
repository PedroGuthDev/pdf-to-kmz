import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const path = "./parser/geo/label-lsq-calibrator.js";
const orig = readFileSync(path, "utf8");
// Add a console.log just inside tryLabelBracketPdfSnap, before the early-return checks
const patched = orig.replace(
  "function tryLabelBracketPdfSnap(\n  prev,\n  post,\n  next,\n  distMap,\n  warnings,\n  opts = {},\n) {",
  "function tryLabelBracketPdfSnap(\n  prev,\n  post,\n  next,\n  distMap,\n  warnings,\n  opts = {},\n) {\n  if (post.number === 2) console.log('[TRACE] tryLabelBracketPdfSnap CALLED for post 2: prev=' + prev?.number + ' next=' + next?.number + ' at (' + post.x.toFixed(2) + ',' + post.y.toFixed(2) + ')');"
);
writeFileSync(path, patched);

const r = spawnSync("node", ["debug-run-calc.mjs", "joao-born"], { encoding: "utf8" });
const lines = r.stdout.split("\n").filter(l => l.includes("TRACE") || l.includes("post 2"));
for (const l of lines) console.log(l);

writeFileSync(path, orig);
