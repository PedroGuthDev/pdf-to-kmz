import { Readable } from "node:stream";

import { requireWriteAuth } from "../../lib/dxf-cloud-auth.js";
import {
  deleteRegion,
  getRegionManifest,
  isBlobConfigured,
  listRegionSummaries,
  readRegionDxfStream,
  sanitizeManifestForClient,
  upsertRegion,
} from "../../lib/dxf-cloud-store.js";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (!isBlobConfigured()) {
    return json(res, 503, {
      error: "Blob storage not configured",
      hint: "Set BLOB_READ_WRITE_TOKEN on Vercel (Storage → Blob).",
    });
  }

  const id = typeof req.query?.id === "string" ? req.query.id : null;
  const asset = typeof req.query?.asset === "string" ? req.query.asset : null;

  if (req.method === "GET") {
    if (id && asset === "dxf") {
      const blob = await readRegionDxfStream(id);
      if (!blob) return json(res, 404, { error: "Region or DXF not found" });

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/dxf");
      res.setHeader("Cache-Control", "private, no-store");
      const nodeStream = Readable.fromWeb(blob.stream);
      nodeStream.on("error", () => {
        if (!res.headersSent) json(res, 500, { error: "Stream failed" });
        else res.end();
      });
      return nodeStream.pipe(res);
    }

    if (id) {
      const manifest = await getRegionManifest(id);
      if (!manifest) return json(res, 404, { error: "Region not found" });
      return json(res, 200, { region: sanitizeManifestForClient(manifest) });
    }

    const regions = await listRegionSummaries();
    return json(res, 200, { regions });
  }

  if (req.method === "POST") {
    if (!requireWriteAuth(req, res, json)) return;
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { error: "Invalid JSON body" });
    }

    const name = String(body.name ?? "").trim();
    const dxfText = typeof body.dxfText === "string" ? body.dxfText : "";
    const dxfPathname =
      typeof body.dxfPathname === "string" ? body.dxfPathname : "";
    const manifest = body.manifest && typeof body.manifest === "object" ? body.manifest : null;

    if (!name) return json(res, 400, { error: "name is required" });
    if (!dxfText && !dxfPathname) {
      return json(res, 400, { error: "dxfText or dxfPathname is required" });
    }
    if (!manifest) return json(res, 400, { error: "manifest is required" });

    try {
      const result = await upsertRegion({
        id: name,
        name,
        dxfText: dxfText || undefined,
        dxfPathname: dxfPathname || undefined,
        manifest,
      });
      return json(res, 201, result);
    } catch (err) {
      return json(res, 500, {
        error: "Failed to store region",
        message: String(err?.message ?? err),
      });
    }
  }

  if (req.method === "DELETE") {
    if (!requireWriteAuth(req, res, json)) return;
    if (!id) return json(res, 400, { error: "Query id is required" });
    try {
      await deleteRegion(id);
      return json(res, 200, { ok: true, id });
    } catch (err) {
      return json(res, 500, {
        error: "Failed to delete region",
        message: String(err?.message ?? err),
      });
    }
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return json(res, 405, { error: "Method not allowed" });
}
