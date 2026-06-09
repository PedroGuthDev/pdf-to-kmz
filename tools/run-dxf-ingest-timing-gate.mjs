#!/usr/bin/env node
/**
 * Palhoca DXF ingest timing gate — exit 1 if addRegion exceeds 5 s budget.
 *
 * Run:  node tools/run-dxf-ingest-timing-gate.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { createRegionLibrary } from "../parser/dwg/region-library.js";

const BUDGET_MS = 10_000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PALHOCA_PATH = path.join(__dirname, "..", "Palhoca.dxf");

async function main() {
  if (!existsSync(PALHOCA_PATH)) {
    console.error(`FAILED: Palhoca.dxf not found at ${PALHOCA_PATH}`);
    process.exit(1);
  }

  const dxfText = readFileSync(PALHOCA_PATH, "utf8");
  const lib = createRegionLibrary(new IDBFactory());
  const blob = { text: async () => dxfText };

  const t0 = performance.now();
  await lib.addRegion("Palhoca-timing", blob);
  const elapsed = performance.now() - t0;

  if (elapsed > BUDGET_MS) {
    console.error(`FAILED: ${elapsed.toFixed(0)}ms > ${BUDGET_MS}ms`);
    process.exit(1);
  }

  console.log(`PASS: Palhoca.dxf ingested in ${elapsed.toFixed(0)}ms (< ${BUDGET_MS}ms)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
