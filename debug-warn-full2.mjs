// Patch the harness behaviour to show all warnings
process.argv = ["node", "debug-run-calc.mjs", "joao-born"];
const orig = console.log;
const captured = [];
// Just run the harness, capture stdout, print warnings
const r = (await import("child_process")).spawnSync("node", ["debug-run-calc.mjs", "joao-born"], { encoding: "utf8" });
// Find warnings section
const lines = r.stdout.split("\n");
let i = lines.findIndex(l => l.includes("Warnings (first 8)"));
// Hack: grab them all from somewhere... but harness truncates. Instead, run a custom call.
console.log("Let me run a custom calc to show all warnings");
