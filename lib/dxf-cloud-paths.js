/** Shared blob path helpers (safe for browser + server). */

export const DXF_REGION_PREFIX = "pdf-to-kmz/dxf-regions";

/** Below this size, DXF may be inlined in POST /api/dxf/regions. Above → client upload. */
export const INLINE_DXF_MAX_BYTES = 3.5 * 1024 * 1024;

/** Hard cap for client direct uploads (Vercel Blob). */
export const CLIENT_DXF_MAX_BYTES = 100 * 1024 * 1024;

export function sanitizeRegionId(id) {
  const s = String(id ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
  return s || "region";
}

export function regionDxfBlobPath(id) {
  return `${DXF_REGION_PREFIX}/${sanitizeRegionId(id)}/source.dxf`;
}

export function regionManifestBlobPath(id) {
  return `${DXF_REGION_PREFIX}/${sanitizeRegionId(id)}/manifest.json`;
}

export const INDEX_BLOB_PATH = `${DXF_REGION_PREFIX}/_index.json`;
