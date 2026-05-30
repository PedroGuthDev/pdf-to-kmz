import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const path = "./parser/geo/label-lsq-calibrator.js";
const orig = readFileSync(path, "utf8");
// Find function header
console.error("Searching for function header...");
const fnIdx = orig.indexOf("function tryLabelBracketPdfSnap");
console.error("found at:", fnIdx);
console.error("snippet:", orig.substring(fnIdx, fnIdx + 200));
