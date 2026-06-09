import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerSrcPath = path.join(__dirname, "..", "dwg", "dxf-parse.worker.js");
const distWorkerPath = path.join(__dirname, "..", "..", "dist", "dxf-parse.worker.js");

test("WR-04: dxf-parse.worker.js handles PARSE_DXF and unknown message types", () => {
  const src = readFileSync(workerSrcPath, "utf8");
  assert.match(src, /PARSE_DXF/);
  assert.match(src, /unknown message type/);
  assert.match(src, /ok:\s*false/);
});

test("WR-04: build emits dist/dxf-parse.worker.js with PARSE_DXF handler", () => {
  execSync("node scripts/build.mjs", { cwd: path.join(__dirname, "..", ".."), stdio: "pipe" });
  assert.ok(existsSync(distWorkerPath), "dist/dxf-parse.worker.js must exist after build");
  const built = readFileSync(distWorkerPath, "utf8");
  assert.match(built, /PARSE_DXF/);
});
