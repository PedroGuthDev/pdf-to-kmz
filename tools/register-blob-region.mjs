#!/usr/bin/env node
/**
 * Register an existing Vercel Blob DXF into the app's region index.
 *
 * Uploading a file in the Vercel Blob dashboard does NOT register it — the app
 * only lists regions from pdf-to-kmz/dxf-regions/_index.json (created via this
 * tool or via the web UI upload flow).
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=... node tools/register-blob-region.mjs <regionId> <blobPathname> [localDxfForMetadata]
 *
 * Example (DXF uploaded manually as "Palhoca.dxf" at store root):
 *   BLOB_READ_WRITE_TOKEN=... node tools/register-blob-region.mjs Palhoca Palhoca.dxf Palhoca.dxf
 *
 * Canonical path (preferred for new uploads via the web app):
 *   pdf-to-kmz/dxf-regions/Palhoca/source.dxf
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import {
  cloudManifestFromRecord,
  createRegionLibrary,
} from "../parser/dwg/region-library.js";
import { upsertRegion, isBlobConfigured } from "../lib/dxf-cloud-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const [regionId, blobPathname, localDxfArg] = process.argv.slice(2);

if (!regionId || !blobPathname) {
  console.error(
    "Usage: BLOB_READ_WRITE_TOKEN=... node tools/register-blob-region.mjs <regionId> <blobPathname> [localDxfForMetadata]",
  );
  process.exit(2);
}

if (!isBlobConfigured()) {
  console.error("BLOB_READ_WRITE_TOKEN is not set.");
  process.exit(1);
}

const localDxf = localDxfArg
  ? path.resolve(ROOT, localDxfArg)
  : path.resolve(ROOT, "Palhoca.dxf");

if (!existsSync(localDxf)) {
  console.error(
    `Local DXF for metadata not found: ${localDxf}\n` +
      "Pass the third argument pointing at a copy of the DXF to compute bbox/crs.",
  );
  process.exit(1);
}

console.log(`Parsing metadata from ${localDxf}…`);
const lib = createRegionLibrary(new IDBFactory());
const blob = new Blob([readFileSync(localDxf)], { type: "application/dxf" });
const record = await lib.addRegion(regionId, blob);
const manifest = cloudManifestFromRecord(record);

console.log(`Registering region "${regionId}" → blob pathname "${blobPathname}"…`);
const result = await upsertRegion({
  id: regionId,
  name: record.name,
  dxfPathname: blobPathname,
  manifest,
});

console.log("OK — region registered.");
console.log("  id:", result.summary.id);
console.log("  posts (local parse):", record.posts.length);
console.log("  bboxLatLon:", result.summary.bboxLatLon);
console.log(
  "\nReload the web app — the region should appear under Região ativa.",
);
