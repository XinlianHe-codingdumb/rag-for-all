import { ensureStorageSchema, getEffectiveLaunchPolicy, getRuntimeBindings } from "../../db/runtime";

const SESSION_COOKIE = "rfa_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i;
const MULTIPART_CONTENT_TYPE = /^multipart\/form-data\s*;.*\bboundary=/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  ipHash: string;
  identityKind: "anonymous" | "development";
  setCookie?: string;
  rateLimit?: {
    limit: number;
    remaining: number;
    resetAt: number;
  };
};

export type ModelUsageReservation = {
  day: string;
  estimatedTokens: number;
  userRecordId: string;
  siteRecordId: string;
  feature: string;
};

export async function beginApiRequest(
  request: Request,
  route: string,
  rateLimit?: RateLimitOptions,
): Promise<ApiContext | Response> {
  const requestId = safeRequestId(request.headers.get("cf-ray")) || safeRequestId(request.headers.get("x-request-id")) || crypto.randomUUID();
  const startedAt = Date.now();
  const crossSiteResponse = rejectCrossSiteMutation(request, requestId);
  if (crossSiteResponse) return crossSiteResponse;
  const identity = requestIdentity(request);
  const actorHash = await shortHash(identity.userId);
  const ipHash = await requestIpHash(request);
  const context: ApiContext = {
    requestId,
    route,
    method: request.method,
    startedAt,
    userId: identity.userId,
    actorHash,
    ipHash,
    identityKind: identity.kind,
    setCookie: identity.setCookie,
  };
  if (!rateLimit) return context;

  try {
    const { DB } = getRuntimeBindings();
    if (!DB) throw new Error("D1 is unavailable for rate-limit enforcement.");
    await ensureStorageSchema(DB);
    const windowMs = rateLimit.windowMs ?? 60 * 60 * 1_000;
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const sessionCount = await consumeRateLimit(DB, `session:${actorHash}:${rateLimit.bucket}:${windowStart}`, `session:${actorHash}`, rateLimit.bucket, windowStart);
    const ipLimit = Math.max(rateLimit.limit * 4, rateLimit.limit + 20);
    const ipCount = await consumeRateLimit(DB, `ip:${ipHash}:${rateLimit.bucket}:${windowStart}`, `ip:${ipHash}`, rateLimit.bucket, windowStart);
    const resetAt = windowStart + windowMs;
    context.rateLimit = {
      limit: rateLimit.limit,
      remaining: Math.min(Math.max(0, rateLimit.limit - sessionCount), Math.max(0, ipLimit - ipCount)),
      resetAt,
    };

    if (sessionCount === 1) {
      await DB.prepare("DELETE FROM api_rate_limits WHERE window_start < ?")
        .bind(now - 48 * 60 * 60 * 1_000)
        .run();
    }

    if (sessionCount > rateLimit.limit || ipCount > ipLimit) {
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
      { status: 503, headers: responseHeaders(requestId, undefined, context.setCookie) },
    );
  }
}

export async function readJsonBody<T>(request: Request, context: ApiContext, maxBytes = 256_000): Promise<T | Response> {
  if (!JSON_CONTENT_TYPE.test(request.headers.get("content-type") || "")) {
    return apiJson(context, { error: "Content-Type must be application/json.", code: "INVALID_CONTENT_TYPE", requestId: context.requestId }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return apiJson(context, { error: "The request body is too large.", code: "REQUEST_TOO_LARGE", requestId: context.requestId }, { status: 413 });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    return apiJson(context, { error: "The request body is too large.", code: "REQUEST_TOO_LARGE", requestId: context.requestId }, { status: 413 });
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return apiJson(context, { error: "The request body is not valid JSON.", code: "INVALID_JSON", requestId: context.requestId }, { status: 400 });
  }
}

export function rejectDeclaredBodySize(request: Request, context: ApiContext, maxBytes: number) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return apiJson(context, { error: "The request body is too large.", code: "REQUEST_TOO_LARGE", requestId: context.requestId }, { status: 413 });
  }
  return null;
}

export async function readMultipartBody(request: Request, context: ApiContext, maxBytes: number): Promise<FormData | Response> {
  const contentType = request.headers.get("content-type") || "";
  if (!MULTIPART_CONTENT_TYPE.test(contentType)) {
    return apiJson(context, { error: "Content-Type must be multipart/form-data.", code: "INVALID_CONTENT_TYPE", requestId: context.requestId }, { status: 415 });
  }
  const declaredRejection = rejectDeclaredBodySize(request, context, maxBytes);
  if (declaredRejection) return declaredRejection;
  if (!request.body) {
    return apiJson(context, { error: "The request body is empty.", code: "EMPTY_BODY", requestId: context.requestId }, { status: 400 });
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return apiJson(context, { error: "The request body is too large.", code: "REQUEST_TOO_LARGE", requestId: context.requestId }, { status: 413 });
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return await new Response(bytes.buffer, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    return apiJson(context, { error: "The multipart request is invalid.", code: "INVALID_MULTIPART", requestId: context.requestId }, { status: 400 });
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
  const headers = responseHeaders(context.requestId, init.headers, context.setCookie);
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

export async function reserveModelUsage(
  context: ApiContext,
  estimatedTokens: number,
  feature: string,
): Promise<ModelUsageReservation | Response> {
  const safeEstimate = Math.max(1, Math.ceil(estimatedTokens));
  const day = new Date().toISOString().slice(0, 10);
  const userRecordId = `user:${context.userId}:${day}`;
  const siteRecordId = `site:${day}`;
  try {
    const { DB } = getRuntimeBindings();
    if (!DB) throw new Error("D1 is unavailable for model budget enforcement.");
    await ensureStorageSchema(DB);
    const policy = await getEffectiveLaunchPolicy(DB);
    if (!policy.modelCallsEnabled) {
      return apiJson(
        context,
        { error: "AI model calls are paused by the site owner. The local visual pipeline is still available.", code: "MODEL_CALLS_DISABLED", requestId: context.requestId },
        { status: 503 },
        { event: "usage.model_calls_disabled", feature },
      );
    }
    const userReserved = await reserveUsageScope(DB, userRecordId, "user", context.userId, day, safeEstimate, policy.userDailyTokenBudget);
    if (!userReserved) {
      return apiJson(context, { error: "Your daily AI usage limit has been reached. Try again tomorrow.", code: "DAILY_USER_BUDGET_REACHED", requestId: context.requestId }, { status: 429 }, { event: "usage.user_budget_reached", feature });
    }
    const siteReserved = await reserveUsageScope(DB, siteRecordId, "site", null, day, safeEstimate, policy.siteDailyTokenBudget);
    if (!siteReserved) {
      await releaseUsageReservation(DB, userRecordId, safeEstimate);
      return apiJson(context, { error: "The site has reached today’s shared AI budget. Try again tomorrow.", code: "DAILY_SITE_BUDGET_REACHED", requestId: context.requestId }, { status: 429 }, { event: "usage.site_budget_reached", feature });
    }
    if (userReserved === safeEstimate) {
      const expiry = new Date(Date.now() - 14 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
      await DB.prepare("DELETE FROM model_usage_daily WHERE day < ?").bind(expiry).run();
    }
    return { day, estimatedTokens: safeEstimate, userRecordId, siteRecordId, feature };
  } catch (error) {
    return apiError(context, error, "AI usage protection is temporarily unavailable.", "MODEL_BUDGET_UNAVAILABLE");
  }
}

export async function recordModelUsage(context: ApiContext, reservation: ModelUsageReservation, actualTokens: number) {
  const safeActual = Math.max(0, Math.ceil(actualTokens));
  try {
    const { DB } = getRuntimeBindings();
    if (!DB) throw new Error("D1 is unavailable for model usage recording.");
    await DB.batch([
      finalizeUsageReservation(DB, reservation.userRecordId, reservation.estimatedTokens, safeActual),
      finalizeUsageReservation(DB, reservation.siteRecordId, reservation.estimatedTokens, safeActual),
    ]);
  } catch (error) {
    logEvent({ requestId: context.requestId, route: context.route, method: context.method, actor: context.actorHash, event: "usage.record_failed", feature: reservation.feature, errorType: error instanceof Error ? error.name : "UnknownError" });
  }
}

async function reserveUsageScope(database: D1Database, id: string, scope: string, ownerId: string | null, day: string, tokens: number, limit: number) {
  if (tokens > limit) return 0;
  const row = await database.prepare(`INSERT INTO model_usage_daily
    (id, scope, owner_id, day, reserved_tokens, actual_tokens, request_count, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      reserved_tokens = reserved_tokens + excluded.reserved_tokens,
      request_count = request_count + 1,
      updated_at = excluded.updated_at
    WHERE model_usage_daily.reserved_tokens + excluded.reserved_tokens <= ?
    RETURNING reserved_tokens`)
    .bind(id, scope, ownerId, day, tokens, Date.now(), limit)
    .first<{ reserved_tokens: number }>();
  return Number(row?.reserved_tokens ?? 0);
}

function finalizeUsageReservation(database: D1Database, id: string, estimatedTokens: number, actualTokens: number) {
  return database.prepare(`UPDATE model_usage_daily SET
    reserved_tokens = MAX(0, reserved_tokens - ? + ?),
    actual_tokens = actual_tokens + ?,
    updated_at = ?
    WHERE id = ?`)
    .bind(estimatedTokens, actualTokens, actualTokens, Date.now(), id);
}

async function releaseUsageReservation(database: D1Database, id: string, estimatedTokens: number) {
  await database.prepare("UPDATE model_usage_daily SET reserved_tokens = MAX(0, reserved_tokens - ?), updated_at = ? WHERE id = ?")
    .bind(estimatedTokens, Date.now(), id)
    .run();
}

function requestIdentity(request: Request): { userId: string; kind: ApiContext["identityKind"]; setCookie?: string } {
  const hostname = new URL(request.url).hostname;
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const environment = typeof process !== "undefined" ? process.env.NODE_ENV : undefined;
  if (isLoopback && environment === "development") {
    return { userId: "local-development-user", kind: "development" };
  }

  const existingSession = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (existingSession && UUID_V4.test(existingSession)) {
    return { userId: `anon:${existingSession}`, kind: "anonymous" };
  }
  const sessionId = crypto.randomUUID();
  const isSecure = new URL(request.url).protocol === "https:";
  const setCookie = `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${isSecure ? "; Secure" : ""}`;
  return { userId: `anon:${sessionId}`, kind: "anonymous", setCookie };
}

function rejectCrossSiteMutation(request: Request, requestId: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return null;
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  if (fetchSite === "cross-site" || (origin && origin !== requestOrigin)) {
    return Response.json(
      { error: "Cross-site requests are not allowed.", code: "CROSS_SITE_REQUEST", requestId },
      { status: 403, headers: responseHeaders(requestId) },
    );
  }
  return null;
}

function safeRequestId(value: string | null) {
  return value && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : "";
}

async function requestIpHash(request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const bindings = getRuntimeBindings();
  const processEnvironment = typeof process !== "undefined" ? process.env : {};
  const salt = bindings.ANALYTICS_HASH_SALT || processEnvironment.ANALYTICS_HASH_SALT || "rag-for-all-local-salt";
  const day = new Date().toISOString().slice(0, 10);
  return shortHash(`${salt}:${day}:${forwarded}`);
}

function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(";")) {
    const [key, ...valueParts] = item.trim().split("=");
    if (key === name) return valueParts.join("=");
  }
  return null;
}

async function consumeRateLimit(database: D1Database, id: string, ownerId: string, bucket: string, windowStart: number) {
  const row = await database.prepare(`INSERT INTO api_rate_limits
    (id, owner_id, bucket, window_start, count)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET count = count + 1
    RETURNING count`)
    .bind(id, ownerId, bucket, windowStart)
    .first<{ count: number }>();
  return Number(row?.count ?? Number.MAX_SAFE_INTEGER);
}

async function shortHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function responseHeaders(requestId: string, input?: HeadersInit, setCookie?: string) {
  const headers = new Headers(input);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Request-Id", requestId);
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return headers;
}

function logEvent(entry: Record<string, unknown>) {
  console.info(JSON.stringify({ service: "rag-for-all", timestamp: new Date().toISOString(), ...entry }));
}
