// Use harness export
import { spawnSync } from "child_process";
import { writeFileSync } from "fs";
// Patch harness temporarily to dump full warnings
import { readFileSync } from "fs";
const harness = readFileSync("./debug-run-calc.mjs", "utf8");
const patched = harness.replace(
  "for (const w of allWarnings.slice(0, 8)) console.log(\" \", w);",
  "for (const w of allWarnings) console.log(\" \", w);"
);
writeFileSync("./debug-run-calc-tmp.mjs", patched);
const r = spawnSync("node", ["debug-run-calc-tmp.mjs", "joao-born"], { encoding: "utf8" });
console.log(r.stdout.split("Warnings (first 8):")[1] || "no warnings section");
