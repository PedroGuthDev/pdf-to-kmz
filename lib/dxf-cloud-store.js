import { del, get, put } from "@vercel/blob";

import {
  INDEX_BLOB_PATH,
  regionDxfBlobPath,
  regionManifestBlobPath,
  sanitizeRegionId,
} from "./dxf-cloud-paths.js";

export {
  INDEX_BLOB_PATH,
  INLINE_DXF_MAX_BYTES,
  CLIENT_DXF_MAX_BYTES,
  sanitizeRegionId,
  regionDxfBlobPath,
  regionManifestBlobPath,
} from "./dxf-cloud-paths.js";

export function isBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readJsonBlob(path) {
  const result = await get(path, { access: "public" });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

async function writeJsonBlob(path, data) {
  await put(path, JSON.stringify(data), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function readRegionIndex() {
  try {
    const index = await readJsonBlob(INDEX_BLOB_PATH);
    if (index?.regions && Array.isArray(index.regions)) return index;
  } catch {
    // missing or corrupt index
  }
  return { version: 1, regions: [] };
}

async function writeRegionIndex(index) {
  await writeJsonBlob(INDEX_BLOB_PATH, index);
}

export async function listRegionSummaries() {
  const index = await readRegionIndex();
  return index.regions.map((r) => ({
    id: r.id,
    name: r.name,
    uploadedAt: r.uploadedAt,
    bboxLatLon: r.bboxLatLon,
    crs: r.crs,
  }));
}

export async function getRegionManifest(id) {
  return readJsonBlob(regionManifestBlobPath(id));
}

/**
 * Persist manifest + index. DXF may already be in Blob (dxfUrl) or uploaded here (dxfText).
 */
export async function upsertRegion({ id, name, dxfText, dxfUrl, manifest }) {
  const regionId = sanitizeRegionId(id);
  const uploadedAt = Date.now();

  let finalDxfUrl = typeof dxfUrl === "string" && dxfUrl ? dxfUrl : null;
  if (!finalDxfUrl) {
    if (!dxfText) throw new Error("dxfText or dxfUrl is required.");
    const dxfBlob = await put(regionDxfBlobPath(regionId), dxfText, {
      access: "public",
      contentType: "application/dxf",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    finalDxfUrl = dxfBlob.url;
  }

  const fullManifest = {
    ...manifest,
    id: regionId,
    name: name ?? regionId,
    uploadedAt,
    dxfUrl: finalDxfUrl,
  };

  await writeJsonBlob(regionManifestBlobPath(regionId), fullManifest);

  const index = await readRegionIndex();
  const summary = {
    id: regionId,
    name: fullManifest.name,
    uploadedAt,
    bboxLatLon: fullManifest.bboxLatLon ?? null,
    crs: fullManifest.crs ?? null,
  };
  const existing = index.regions.findIndex((r) => r.id === regionId);
  if (existing >= 0) index.regions[existing] = summary;
  else index.regions.push(summary);
  await writeRegionIndex(index);

  return { summary, manifest: fullManifest };
}

export async function deleteRegion(id) {
  const regionId = sanitizeRegionId(id);
  await del(regionDxfBlobPath(regionId)).catch(() => {});
  await del(regionManifestBlobPath(regionId)).catch(() => {});

  const index = await readRegionIndex();
  index.regions = index.regions.filter((r) => r.id !== regionId);
  await writeRegionIndex(index);
}
