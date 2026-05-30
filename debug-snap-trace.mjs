import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const path = "./parser/geo/label-lsq-calibrator.js";
const orig = readFileSync(path, "utf8");

// Insert trace before the warning push
const target = `  post.x = snapX;\r\n  post.y = snapY;\r\n  warnings.push(\r\n    \`[auxiliary-post-pdf] post \${post.number}: label bracket along \${prev.number}–\${next.number} \` +`;
const replacement = `  if (post.number === 2 || post.number === 12) console.error('[TRACE] snap firing for post ' + post.number + ' chordBefore=' + chordBefore.toFixed(2) + ' chordAfter=' + chordAfter.toFixed(2) + ' mBefore=' + mBefore + ' mAfter=' + mAfter + ' ratioBefore=' + ratioBefore.toFixed(3) + ' ratioAfter=' + ratioAfter.toFixed(3) + ' needsBefore=' + needsBefore + ' needsAfter=' + needsAfter + ' relax=' + (opts.relaxForAuxiliary || false));\r\n  post.x = snapX;\r\n  post.y = snapY;\r\n  warnings.push(\r\n    \`[auxiliary-post-pdf] post \${post.number}: label bracket along \${prev.number}–\${next.number} \` +`;
const patched = orig.replace(target, replacement);
if (patched === orig) { console.error("PATCH FAILED"); process.exit(1); }
writeFileSync(path, patched);
const r = spawnSync("node", ["debug-run-calc.mjs", "joao-born"], { encoding: "utf8" });
console.log("Stderr TRACE lines:");
for (const l of r.stderr.split("\n")) if (l.includes("TRACE")) console.log("  ", l);
writeFileSync(path, orig);
