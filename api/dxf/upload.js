import { handleUpload } from "@vercel/blob/client";

import { requireAuth } from "../../lib/dxf-cloud-auth.js";
import {
  CLIENT_DXF_MAX_BYTES,
  DXF_REGION_PREFIX,
  isBlobConfigured,
} from "../../lib/dxf-cloud-store.js";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
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

function isAllowedDxfPath(pathname) {
  if (!pathname.startsWith(`${DXF_REGION_PREFIX}/`)) return false;
  return /\/source\.dxf$/.test(pathname);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  if (!isBlobConfigured()) {
    return json(res, 503, {
      error: "Blob storage not configured",
      hint: "Set BLOB_READ_WRITE_TOKEN on Vercel.",
    });
  }

  if (!requireAuth(req, res, json)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON body" });
  }

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!isAllowedDxfPath(pathname)) {
          throw new Error(
            `Invalid pathname. Must be ${DXF_REGION_PREFIX}/{id}/source.dxf`
          );
        }
        return {
          allowedContentTypes: [
            "application/dxf",
            "text/plain",
            "application/octet-stream",
          ],
          maximumSizeInBytes: CLIENT_DXF_MAX_BYTES,
          allowOverwrite: true,
          addRandomSuffix: false,
        };
      },
    });

    return json(res, 200, result);
  } catch (err) {
    return json(res, 400, {
      error: "Upload handler failed",
      message: String(err?.message ?? err),
    });
  }
}
