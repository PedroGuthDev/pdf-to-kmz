import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const path = "./parser/geo/label-lsq-calibrator.js";
const orig = readFileSync(path, "utf8");
const target = `function tryLabelBracketPdfSnap(\r\n  prev,\r\n  post,\r\n  next,\r\n  distMap,\r\n  warnings,\r\n  opts = {},\r\n) {\r\n  const mBefore =`;
const replacement = `function tryLabelBracketPdfSnap(\r\n  prev,\r\n  post,\r\n  next,\r\n  distMap,\r\n  warnings,\r\n  opts = {},\r\n) {\r\n  if (post && post.number === 2) return false;\r\n  const mBefore =`;
const patched = orig.replace(target, replacement);
writeFileSync(path, patched);
spawnSync("node", ["debug-refresh-results.mjs"], { encoding: "utf8" });

// Run with full warnings dump
const harness = readFileSync("./debug-run-calc.mjs", "utf8");
const harnessPatch = harness.replace(
  "for (const w of allWarnings.slice(0, 8)) console.log(\" \", w);",
  "for (const w of allWarnings) console.log(\" \", w);"
);
writeFileSync("./debug-run-calc-tmp.mjs", harnessPatch);
const r = spawnSync("node", ["debug-run-calc-tmp.mjs", "joao-born"], { encoding: "utf8" });
const sections = r.stdout.split("Warnings (first 8):");
const warnLines = (sections[1] || "").split("\n");
console.log("Warnings related to post 2:");
for (const l of warnLines) if (l.includes("post 2") || l.includes("post  2") || l.includes("Post 2") || l.includes("Post  2")) console.log("  ", l);

writeFileSync(path, orig);
console.log("(restored)");
