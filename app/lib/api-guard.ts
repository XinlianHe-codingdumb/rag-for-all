import { ensureStorageSchema, getRuntimeBindings } from "../../db/runtime";

type RateLimitOptions = {
  bucket: string;
  limit: number;
  windowMs?: number;
};

export type ApiContext = {
  requestId: string;
  route: string;
  method: string;
  startedAt: number;
  userId: string;
  actorHash: string;
  rateLimit?: {
    limit: number;
    remaining: number;
    resetAt: number;
  };
};

export async function beginApiRequest(
  request: Request,
  route: string,
  rateLimit?: RateLimitOptions,
): Promise<ApiContext | Response> {
  const requestId = request.headers.get("cf-ray") || request.headers.get("x-request-id") || crypto.randomUUID();
  const startedAt = Date.now();
  const identity = requestIdentity(request);

  if (!identity) {
    logEvent({ requestId, route, method: request.method, status: 401, durationMs: Date.now() - startedAt, event: "api.unauthorized" });
    return Response.json(
      { error: "Sign in is required.", code: "AUTH_REQUIRED", requestId },
      { status: 401, headers: responseHeaders(requestId) },
    );
  }

  const actorHash = await shortHash(identity.userId);
  const context: ApiContext = { requestId, route, method: request.method, startedAt, userId: identity.userId, actorHash };
  if (!rateLimit) return context;

  try {
    const { DB } = getRuntimeBindings();
    if (!DB) throw new Error("D1 is unavailable for rate-limit enforcement.");
    await ensureStorageSchema(DB);
    const windowMs = rateLimit.windowMs ?? 60 * 60 * 1_000;
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const id = `${identity.userId}:${rateLimit.bucket}:${windowStart}`;
    const row = await DB.prepare(`INSERT INTO api_rate_limits
      (id, owner_id, bucket, window_start, count)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET count = count + 1
      RETURNING count`)
      .bind(id, identity.userId, rateLimit.bucket, windowStart)
      .first<{ count: number }>();
    const count = Number(row?.count ?? rateLimit.limit + 1);
    const resetAt = windowStart + windowMs;
    context.rateLimit = { limit: rateLimit.limit, remaining: Math.max(0, rateLimit.limit - count), resetAt };

    if (count === 1) {
      await DB.prepare("DELETE FROM api_rate_limits WHERE window_start < ?")
        .bind(now - 48 * 60 * 60 * 1_000)
        .run();
    }

    if (count > rateLimit.limit) {
      return apiJson(
        context,
        { error: "This hourly limit has been reached. Please try again later.", code: "RATE_LIMITED", requestId },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((resetAt - now) / 1_000))) } },
        { event: "api.rate_limited", bucket: rateLimit.bucket },
      );
    }
    return context;
  } catch (error) {
    logEvent({
      requestId,
      route,
      method: request.method,
      actor: actorHash,
      status: 503,
      durationMs: Date.now() - startedAt,
      event: "api.rate_limit_unavailable",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json(
      { error: "Usage protection is temporarily unavailable.", code: "RATE_LIMIT_UNAVAILABLE", requestId },
      { status: 503, headers: responseHeaders(requestId) },
    );
  }
}

export function apiJson(
  context: ApiContext,
  payload: unknown,
  init: ResponseInit = {},
  metrics: Record<string, string | number | boolean | undefined> = {},
) {
  const status = init.status ?? 200;
  logEvent({
    requestId: context.requestId,
    route: context.route,
    method: context.method,
    actor: context.actorHash,
    status,
    durationMs: Date.now() - context.startedAt,
    event: status >= 400 ? "api.failed" : "api.completed",
    ...metrics,
  });
  const headers = responseHeaders(context.requestId, init.headers);
  if (context.rateLimit) {
    headers.set("X-RateLimit-Limit", String(context.rateLimit.limit));
    headers.set("X-RateLimit-Remaining", String(context.rateLimit.remaining));
    headers.set("X-RateLimit-Reset", String(Math.ceil(context.rateLimit.resetAt / 1_000)));
  }
  return Response.json(payload, { ...init, status, headers });
}

export function apiError(context: ApiContext, error: unknown, message: string, code: string, status = 503) {
  return apiJson(
    context,
    { error: message, code, requestId: context.requestId },
    { status },
    { errorType: error instanceof Error ? error.name : "UnknownError" },
  );
}

function requestIdentity(request: Request) {
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (userId && email) return { userId, email };

  const hostname = new URL(request.url).hostname;
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const environment = typeof process !== "undefined" ? process.env.NODE_ENV : undefined;
  if (isLoopback && environment === "development") {
    return { userId: "local-development-user", email: "local@rag-for-all.invalid" };
  }
  return null;
}

async function shortHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function responseHeaders(requestId: string, input?: HeadersInit) {
  const headers = new Headers(input);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Request-Id", requestId);
  return headers;
}

function logEvent(entry: Record<string, unknown>) {
  console.info(JSON.stringify({ service: "rag-for-all", timestamp: new Date().toISOString(), ...entry }));
}
