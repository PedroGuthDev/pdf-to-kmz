/** @param {(res: import('http').ServerResponse, status: number, body: object) => void} json */

export function isPrivateAuthConfigured() {
  return Boolean(process.env.DXF_API_SECRET?.trim());
}

export function requireAuth(req, res, json) {
  const secret = process.env.DXF_API_SECRET?.trim();
  if (!secret) {
    json(res, 503, {
      error: "DXF_API_SECRET is required",
      hint: "Set a strong secret in Vercel env vars. The browser sends it as Bearer token.",
    });
    return false;
  }

  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const apiKey = req.headers["x-api-key"] ?? "";
  if (bearer === secret || apiKey === secret) return true;

  json(res, 401, { error: "Unauthorized" });
  return false;
}
