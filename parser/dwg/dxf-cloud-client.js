import { upload } from "@vercel/blob/client";

import {
  INLINE_DXF_MAX_BYTES,
  regionDxfBlobPath,
} from "../../lib/dxf-cloud-paths.js";

const DEFAULT_BASE = "";

function apiUrl(path, base = DEFAULT_BASE) {
  const root = (base || "").replace(/\/$/, "");
  return `${root}${path}`;
}

export function createDxfCloudClient(options = {}) {
  const baseUrl = options.baseUrl ?? "";
  const getSecret = options.getApiSecret ?? (() => null);

  function authHeaders() {
    const secret = getSecret();
    if (!secret) return {};
    return { Authorization: `Bearer ${secret}` };
  }

  async function registerRegion({ name, manifest, dxfText, dxfUrl }) {
    const res = await fetch(apiUrl("/api/dxf/regions", baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({ name, manifest, dxfText, dxfUrl }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? err.message ?? `Register failed (${res.status})`);
    }
    return res.json();
  }

  return {
    async probe() {
      try {
        const res = await fetch(apiUrl("/api/dxf/regions", baseUrl));
        if (res.status === 503) return { ok: false, reason: "blob_not_configured" };
        return { ok: res.ok, status: res.status };
      } catch (err) {
        return { ok: false, reason: String(err?.message ?? err) };
      }
    },

    async listRegions() {
      const res = await fetch(apiUrl("/api/dxf/regions", baseUrl));
      if (!res.ok) throw new Error(`Cloud list failed (${res.status})`);
      const data = await res.json();
      return data.regions ?? [];
    },

    async getRegion(id) {
      const res = await fetch(
        apiUrl(`/api/dxf/regions?id=${encodeURIComponent(id)}`, baseUrl)
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Cloud get failed (${res.status})`);
      const data = await res.json();
      return data.region ?? null;
    },

    /**
     * Upload DXF + manifest. Large files go browser → Blob; small files inline in POST.
     */
    async uploadRegion({ name, dxfFile, dxfText, manifest }) {
      const regionId = name;
      const pathname = regionDxfBlobPath(regionId);
      const size =
        dxfFile?.size ??
        (typeof dxfText === "string" ? new TextEncoder().encode(dxfText).length : 0);

      if (dxfFile && size > INLINE_DXF_MAX_BYTES) {
        const blob = await upload(pathname, dxfFile, {
          access: "public",
          handleUploadUrl: apiUrl("/api/dxf/upload", baseUrl),
          multipart: size > 5 * 1024 * 1024,
          contentType: "application/dxf",
          headers: authHeaders(),
        });
        return registerRegion({ name, manifest, dxfUrl: blob.url });
      }

      const text =
        dxfText ?? (dxfFile && typeof dxfFile.text === "function"
          ? await dxfFile.text()
          : "");
      if (!text) throw new Error("DXF content is required for cloud upload.");

      return registerRegion({ name, manifest, dxfText: text });
    },

    async deleteRegion(id) {
      const res = await fetch(
        apiUrl(`/api/dxf/regions?id=${encodeURIComponent(id)}`, baseUrl),
        { method: "DELETE", headers: authHeaders() }
      );
      if (!res.ok) throw new Error(`Cloud delete failed (${res.status})`);
      return res.json();
    },
  };
}
