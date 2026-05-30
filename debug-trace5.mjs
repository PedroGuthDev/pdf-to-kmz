import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const path = "./parser/geo/label-lsq-calibrator.js";
const orig = readFileSync(path, "utf8");
// Use simple find/replace
const idx = orig.indexOf("function tryLabelBracketPdfSnap(");
if (idx < 0) { console.error("FAIL: not found"); process.exit(1); }
// Find the opening { of the body
const braceIdx = orig.indexOf("{", idx);
const headerEnd = braceIdx + 1;
const trace = "\r\n  if (post && post.number === 2) console.error('[TRACE] tryLabelBracketPdfSnap for post 2: at (' + post.x.toFixed(2) + ',' + post.y.toFixed(2) + ')');";
const patched = orig.substring(0, headerEnd) + trace + orig.substring(headerEnd);
writeFileSync(path, patched);

const r = spawnSync("node", ["debug-run-calc.mjs", "joao-born"], { encoding: "utf8" });
const errLines = r.stderr.split("\n").filter(l => l.includes("TRACE"));
console.log("stderr TRACE lines:");
for (const l of errLines) console.log("  ", l);
const stdoutLines = r.stdout.split("\n").filter(l => l.includes("Post  2:"));
console.log("\nstdout post 2 lines:");
for (const l of stdoutLines) console.log("  ", l);

writeFileSync(path, orig);
console.log("\n(restored)");
