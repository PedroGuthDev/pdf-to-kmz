import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { IDBFactory } from "fake-indexeddb";

import {
  cloudManifestFromRecord,
  createRegionLibrary,
  manifestHasPostData,
} from "../dwg/region-library.js";
import { createHybridRegionLibrary } from "../dwg/region-library-hybrid.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const SIRIU_DXF = readFileSync(path.join(ROOT, "siriu.dxf"), "utf8");

test("cloudManifestFromRecord omits heavy post arrays", async () => {
  const local = createRegionLibrary(new IDBFactory());
  const blob = new Blob([SIRIU_DXF], { type: "application/dxf" });
  const record = await local.addRegion("siriu-cloud", blob);
  const manifest = cloudManifestFromRecord(record);

  assert.equal(manifest.manifestKind, "cloud-metadata-v1");
  assert.ok(record.posts.length > 0);
  assert.equal(manifest.posts, undefined);
  assert.equal(manifest.cableEdges, undefined);
  assert.equal(manifest.rbushDump, undefined);
  assert.ok(manifest.bboxLatLon);
});

test("hybrid hydrates cloud region by re-parsing DXF blob", async () => {
  const local = createRegionLibrary(new IDBFactory());
  const blob = new Blob([SIRIU_DXF], { type: "application/dxf" });
  const record = await local.addRegion("siriu-local", blob);
  await local.deleteRegion("siriu-local");

  const manifest = cloudManifestFromRecord(record);
  assert.equal(manifestHasPostData(manifest), false);

  const cloudClient = {
    async probe() {
      return { ok: true };
    },
    async listRegions() {
      return [
        {
          id: record.id,
          name: record.name,
          uploadedAt: record.uploadedAt,
          bboxLatLon: record.bboxLatLon,
          crs: record.crs,
        },
      ];
    },
    async getRegion(id) {
      return id === record.id ? manifest : null;
    },
    async fetchDxfBlob(id) {
      return id === record.id ? blob : null;
    },
  };

  const hybrid = createHybridRegionLibrary(local, cloudClient);
  await hybrid.refreshCloudStatus();

  const region = await hybrid.getRegionWithIndex(record.id);
  assert.ok(region);
  assert.ok(region.posts.length > 0);
  assert.ok(region.postIndex);
  assert.ok((await hybrid.getRegionWithIndex(record.id))?.posts.length > 0);
});
