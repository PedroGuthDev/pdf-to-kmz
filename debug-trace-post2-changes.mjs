// Patch tryLabelBracketPdfSnap to log when called for post 2
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const path = "./parser/geo/label-lsq-calibrator.js";
const orig = readFileSync(path, "utf8");
const patched = orig.replace(
  "post.x = snapX;\n  post.y = snapY;\n  warnings.push(\n    `[auxiliary-post-pdf] post ${post.number}: label bracket along ${prev.number}–${next.number} ` +",
  "if (post.number === 2) {\n    console.log('[TRACE] tryLabelBracketPdfSnap for post 2: from (' + post.x.toFixed(2) + ',' + post.y.toFixed(2) + ') to (' + snapX.toFixed(2) + ',' + snapY.toFixed(2) + ')');\n    return false; // skip\n  }\n  post.x = snapX;\n  post.y = snapY;\n  warnings.push(\n    `[auxiliary-post-pdf] post ${post.number}: label bracket along ${prev.number}–${next.number} ` +"
);
writeFileSync(path, patched);

const r = spawnSync("node", ["debug-run-calc.mjs", "joao-born"], { encoding: "utf8" });
const lines = r.stdout.split("\n");
for (const l of lines) {
  if (l.includes("TRACE") || l.includes("Post  2:") || l.includes("post 2:")) console.log(l);
}

writeFileSync(path, orig);
console.log("\n(restored)");
