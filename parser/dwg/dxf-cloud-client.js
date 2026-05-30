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

    async uploadRegion({ name, dxfText, manifest }) {
      const res = await fetch(apiUrl("/api/dxf/regions", baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ name, dxfText, manifest }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? err.message ?? `Upload failed (${res.status})`);
      }
      return res.json();
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
