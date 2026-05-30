/** @param {(res: import('http').ServerResponse, status: number, body: object) => void} json */

export function isWriteAuthConfigured() {
  return Boolean(process.env.DXF_API_SECRET?.trim());
}

/** Optional: only enforced when DXF_API_SECRET is set (protects uploads/deletes). */
export function requireWriteAuth(req, res, json) {
  const secret = process.env.DXF_API_SECRET?.trim();
  if (!secret) return true;

  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const apiKey = req.headers["x-api-key"] ?? "";
  if (bearer === secret || apiKey === secret) return true;

  json(res, 401, { error: "Unauthorized" });
  return false;
}
