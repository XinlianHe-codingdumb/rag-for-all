import { getRuntimeBindings } from "../../db/runtime";

export function requireAdmin(request: Request): { ownerId: string } | Response {
  const bindings = getRuntimeBindings();
  const processEnvironment = typeof process !== "undefined" ? process.env : {};
  const configuredOwnerId = bindings.ADMIN_OWNER_ID || processEnvironment.ADMIN_OWNER_ID || "";
  const authenticatedUserId = request.headers.get("oai-authenticated-user-id") || "";

  const hostname = new URL(request.url).hostname;
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (isLoopback) {
    return { ownerId: configuredOwnerId || "local-development-owner" };
  }

  if (configuredOwnerId && authenticatedUserId === configuredOwnerId) {
    return { ownerId: configuredOwnerId };
  }

  return Response.json(
    { error: "Owner access is required.", code: "ADMIN_REQUIRED" },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
