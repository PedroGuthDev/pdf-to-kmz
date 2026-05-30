// Patch label-lsq-calibrator to skip auxiliary-pdf snap for post 2
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const path = "./parser/geo/label-lsq-calibrator.js";
const orig = readFileSync(path, "utf8");
// Just before `tryLabelBracketPdfSnap` body, add an early-exit for post number 2
const patched = orig.replace(
  "const mBefore =\n    distMap.get(`${prev.number}->${post.number}`) ??\n    distMap.get(`${post.number}->${prev.number}`);",
  "if (post.number === 2) return false; // DEBUG: skip snap for post 2\n  const mBefore =\n    distMap.get(`${prev.number}->${post.number}`) ??\n    distMap.get(`${post.number}->${prev.number}`);"
);
writeFileSync(path, patched);

const r = spawnSync("node", ["debug-run-calc.mjs", "joao-born"], { encoding: "utf8" });
console.log(r.stdout.split("Comparison vs reference:")[1] || "no comparison");

writeFileSync(path, orig); // restore
console.log("\n(restored)");
