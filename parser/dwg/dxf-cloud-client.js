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

  async function registerRegion({ name, manifest, dxfText, dxfPathname }) {
    const res = await fetch(apiUrl("/api/dxf/regions", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, manifest, dxfText, dxfPathname }),
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

    async fetchDxfBlob(id) {
      const res = await fetch(
        apiUrl(
          `/api/dxf/regions?id=${encodeURIComponent(id)}&asset=dxf`,
          baseUrl
        )
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`DXF download failed (${res.status})`);
      return res.blob();
    },

    async uploadRegion({ name, dxfFile, dxfText, manifest }) {
      const pathname = regionDxfBlobPath(name);
      const size =
        dxfFile?.size ??
        (typeof dxfText === "string" ? new TextEncoder().encode(dxfText).length : 0);

      if (dxfFile && size > INLINE_DXF_MAX_BYTES) {
        const blob = await upload(pathname, dxfFile, {
          access: "private",
          handleUploadUrl: apiUrl("/api/dxf/upload", baseUrl),
          multipart: size > 5 * 1024 * 1024,
          contentType: "application/dxf",
        });
        return registerRegion({
          name,
          manifest,
          dxfPathname: blob.pathname,
        });
      }

      const text =
        dxfText ??
        (dxfFile && typeof dxfFile.text === "function"
          ? await dxfFile.text()
          : "");
      if (!text) throw new Error("DXF content is required for cloud upload.");

      return registerRegion({ name, manifest, dxfText: text });
    },

    async deleteRegion(id) {
      const res = await fetch(
        apiUrl(`/api/dxf/regions?id=${encodeURIComponent(id)}`, baseUrl),
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`Cloud delete failed (${res.status})`);
      return res.json();
    },
  };
}
