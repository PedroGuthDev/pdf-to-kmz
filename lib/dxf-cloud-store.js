import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";

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

/** All DXF library blobs are private — never served without API auth. */
export const BLOB_ACCESS = "private";

export function isBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readJsonBlob(path) {
  const result = await get(path, { access: BLOB_ACCESS });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

async function writeJsonBlob(path, data) {
  await put(path, JSON.stringify(data), {
    access: BLOB_ACCESS,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export function resolveDxfPathname(regionId, manifest) {
  if (manifest?.dxfPathname) return manifest.dxfPathname;
  return regionDxfBlobPath(regionId);
}

/** Strip internal blob paths/URLs before sending manifest to the browser. */
export function sanitizeManifestForClient(manifest) {
  if (!manifest) return null;
  const { dxfUrl: _u, dxfPathname: _p, ...safe } = manifest;
  return safe;
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

export async function readPrivateBlobStream(pathname) {
  const result = await get(pathname, { access: BLOB_ACCESS, useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return result;
}

export async function readRegionDxfStream(id) {
  const regionId = sanitizeRegionId(id);
  const manifest = await getRegionManifest(regionId);
  if (!manifest) return null;
  const pathname = resolveDxfPathname(regionId, manifest);
  return readPrivateBlobStream(pathname);
}

/**
 * Persist manifest + index. DXF may already be in Blob (dxfPathname) or uploaded here (dxfText).
 */
export async function upsertRegion({ id, name, dxfText, dxfPathname, manifest }) {
  const regionId = sanitizeRegionId(id);
  const uploadedAt = Date.now();
  const pathname = dxfPathname
    ? dxfPathname
    : regionDxfBlobPath(regionId);

  if (dxfText) {
    await put(pathname, dxfText, {
      access: BLOB_ACCESS,
      contentType: "application/dxf",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } else {
    try {
      await head(pathname, { access: BLOB_ACCESS });
    } catch (err) {
      if (err instanceof BlobNotFoundError) {
        throw new Error("DXF blob not found at pathname. Upload the file first.");
      }
      throw err;
    }
  }

  const fullManifest = {
    ...manifest,
    id: regionId,
    name: name ?? regionId,
    uploadedAt,
    dxfPathname: pathname,
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

  return {
    summary,
    manifest: sanitizeManifestForClient(fullManifest),
  };
}

export async function deleteRegion(id) {
  const regionId = sanitizeRegionId(id);
  await del(regionDxfBlobPath(regionId)).catch(() => {});
  await del(regionManifestBlobPath(regionId)).catch(() => {});

  const index = await readRegionIndex();
  index.regions = index.regions.filter((r) => r.id !== regionId);
  await writeRegionIndex(index);
}
