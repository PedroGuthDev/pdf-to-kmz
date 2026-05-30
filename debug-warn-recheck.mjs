import { spawnSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
const orig = readFileSync("./debug-run-calc.mjs", "utf8");
const patched = orig.replace(
  "for (const w of allWarnings.slice(0, 8)) console.log(\" \", w);",
  "for (const w of allWarnings) console.log(\" \", w);"
);
writeFileSync("./debug-run-calc-tmp.mjs", patched);
const r = spawnSync("node", ["debug-run-calc-tmp.mjs", "joao-born"], { encoding: "utf8" });
const all = r.stdout.split("Warnings (first 8):")[1] || "";
const lines = all.split("\n").filter(l => l.includes("post 2") || l.includes("post  2") || l.includes("Post 2") || l.includes("Post  2") || l.includes("auxiliary-post"));
for (const l of lines) console.log(l);
