// Test moving post 2 from PDF (342.38, 428.82) to (359.04, 419.29)
// The latter is where 31.89m walking from post 1 toward post 3 lands.
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, copyFileSync } from "fs";

// Read original debug_results.txt
const orig = readFileSync("./debug_results.txt", "utf8");
// Replace the Post 2 line
const modified = orig.replace(
  /Post 2:\s+page=3\s+x=342\.38\s+y=428\.82/,
  "Post 2:  page=3  x=359.04  y=419.29"
);
// Save backup
copyFileSync("./debug_results.txt", "./debug_results.txt.bak");
writeFileSync("./debug_results.txt", modified);
console.log("Modified post 2 in debug_results.txt");

// Run harness
const r = spawnSync("node", ["debug-run-calc.mjs", "joao-born"], { encoding: "utf8" });
console.log(r.stdout.split("Comparison vs reference:")[1] || r.stdout.tail);

// Restore
writeFileSync("./debug_results.txt", orig);
console.log("\n(restored)");
