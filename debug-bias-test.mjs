// What's the actual projected GPS for post 1 and post 3 in the final harness output?
import { spawnSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";

// Patch debug-run-calc.mjs to print all lat/lon
const orig = readFileSync("./debug-run-calc.mjs", "utf8");
const patched = orig.replace(
  "for (const ref of REFERENCE) {",
  `for (const p of posts) {
    if (p.number <= 5 || p.number === 14) console.log(\`PROJECTED post \${p.number}: lat=\${p.lat?.toFixed?.(8) ?? "?"} lon=\${p.lon?.toFixed?.(8) ?? "?"}\`);
  }
  for (const ref of REFERENCE) {`
);
writeFileSync("./debug-run-calc-tmp2.mjs", patched);
const r = spawnSync("node", ["debug-run-calc-tmp2.mjs", "joao-born"], { encoding: "utf8" });
console.log(r.stdout.split("Comparison vs reference:")[0].split("PROJECTED")[1] || "");
const projLines = r.stdout.split("\n").filter(l => l.includes("PROJECTED"));
for (const l of projLines) console.log(l);
