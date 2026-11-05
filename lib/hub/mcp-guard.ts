export const MAX_MCP_BODY_BYTES = 1024 * 1024;

/** Refuses browser-origin requests (agents are not browsers; this blocks DNS rebinding) and bodies over 1 MB, before anything is parsed. */
export function mcpRequestGuard(request: Request): Response | null {
  if (request.headers.has("origin")) return Response.json({ error: "browser requests are not accepted" }, { status: 403 });
  const length = request.headers.get("content-length");
  if (length !== null && !(Number(length) <= MAX_MCP_BODY_BYTES)) {
    return Response.json({ error: "body too large" }, { status: 413 });
  }
  return null;
}
