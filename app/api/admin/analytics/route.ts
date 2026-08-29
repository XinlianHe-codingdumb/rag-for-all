import { requireAdmin } from "../../../lib/admin-auth";
import { apiError, apiJson, beginApiRequest, readJsonBody } from "../../../lib/api-guard";
import { ensureStorageSchema, getEffectiveLaunchPolicy, getRuntimeBindings } from "../../../../db/runtime";

type CountRow = { label: string; count: number };

export async function GET(request: Request) {
  const context = await beginApiRequest(request, "admin.analytics.read", { bucket: "admin_read", limit: 120 });
  if (context instanceof Response) return context;
  const authorization = requireAdmin(request);
  if (authorization instanceof Response) return authorization;

  try {
    const { DB } = getRuntimeBindings();
    if (!DB) throw new Error("D1 is unavailable for the admin dashboard.");
    await ensureStorageSchema(DB);
    const requestedRange = Number(new URL(request.url).searchParams.get("range") ?? 30);
    const periodDays = [1, 7, 30].includes(requestedRange) ? requestedRange : 30;
    const now = Date.now();
    const since = now - periodDays * 24 * 60 * 60 * 1_000;
    const dailySince = now - Math.min(periodDays, 14) * 24 * 60 * 60 * 1_000;
    const day = new Date(now).toISOString().slice(0, 10);

    const [summary, events, steps, pages, llmCalls, funnel, daily, usage, policy] = await Promise.all([
      DB.prepare(`SELECT COUNT(*) AS event_count, COUNT(DISTINCT session_id) AS session_count
        FROM analytics_events WHERE created_at >= ?`).bind(since).first<{ event_count: number; session_count: number }>(),
      DB.prepare(`SELECT event_name AS label, COUNT(*) AS count FROM analytics_events
        WHERE created_at >= ? GROUP BY event_name ORDER BY count DESC`).bind(since).all<CountRow>(),
      DB.prepare(`SELECT COALESCE(section, 'unknown') AS label, COUNT(*) AS count FROM analytics_events
        WHERE created_at >= ? AND event_name = 'pipeline_step_click'
        GROUP BY section ORDER BY count DESC`).bind(since).all<CountRow>(),
      DB.prepare(`SELECT path AS label, COUNT(*) AS count FROM analytics_events
        WHERE created_at >= ? AND event_name = 'page_view'
        GROUP BY path ORDER BY count DESC`).bind(since).all<CountRow>(),
      DB.prepare(`SELECT COALESCE(json_extract(properties_json, '$.source'), 'unknown') AS label,
        COALESCE(json_extract(properties_json, '$.status'), 'unknown') AS status,
        COUNT(*) AS count FROM analytics_events
        WHERE created_at >= ? AND event_name = 'llm_call'
        GROUP BY label, status ORDER BY count DESC`).bind(since).all<CountRow & { status: string }>(),
      DB.prepare(`SELECT event_name AS label, COUNT(DISTINCT session_id) AS count FROM analytics_events
        WHERE created_at >= ? AND event_name IN ('page_view', 'upload_completed', 'stage_run', 'answer_generated', 'comparison_viewed')
        GROUP BY event_name`).bind(since).all<CountRow>(),
      DB.prepare(`SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day,
        COUNT(*) AS events, COUNT(DISTINCT session_id) AS sessions,
        SUM(CASE WHEN event_name = 'pipeline_step_click' THEN 1 ELSE 0 END) AS step_opens,
        SUM(CASE WHEN event_name = 'llm_call' THEN 1 ELSE 0 END) AS llm_calls
        FROM analytics_events WHERE created_at >= ? GROUP BY day ORDER BY day`).bind(dailySince).all<{ day: string; events: number; sessions: number }>(),
      DB.prepare(`SELECT reserved_tokens, actual_tokens, request_count FROM model_usage_daily
        WHERE id = ?`).bind(`site:${day}`).first<{ reserved_tokens: number; actual_tokens: number; request_count: number }>(),
      getEffectiveLaunchPolicy(DB),
    ]);

    return apiJson(context, {
      periodDays,
      summary: {
        events: Number(summary?.event_count ?? 0),
        sessions: Number(summary?.session_count ?? 0),
      },
      events: normalizeCounts(events.results),
      steps: normalizeCounts(steps.results),
      pages: normalizeCounts(pages.results),
      llmCalls: (llmCalls.results ?? []).map((row) => ({ label: `${row.label} · ${row.status}`, count: Number(row.count) })),
      funnel: normalizeCounts(funnel.results),
      daily: (daily.results ?? []).map((row) => ({ day: row.day, events: Number(row.events), sessions: Number(row.sessions), stepOpens: Number((row as { step_opens?: number }).step_opens ?? 0), llmCalls: Number((row as { llm_calls?: number }).llm_calls ?? 0) })),
      usage: {
        day,
        reservedTokens: Number(usage?.reserved_tokens ?? 0),
        actualTokens: Number(usage?.actual_tokens ?? 0),
        requests: Number(usage?.request_count ?? 0),
      },
      settings: {
        modelCallsEnabled: policy.modelCallsEnabled,
        userDailyTokenBudget: policy.userDailyTokenBudget,
        siteDailyTokenBudget: policy.siteDailyTokenBudget,
      },
    });
  } catch (error) {
    return apiError(context, error, "Dashboard data is temporarily unavailable.", "ADMIN_ANALYTICS_UNAVAILABLE");
  }
}

export async function PATCH(request: Request) {
  const context = await beginApiRequest(request, "admin.settings.update", { bucket: "admin_update", limit: 30 });
  if (context instanceof Response) return context;
  const authorization = requireAdmin(request);
  if (authorization instanceof Response) return authorization;

  try {
    const input = await readJsonBody<Record<string, unknown>>(request, context, 4_096);
    if (input instanceof Response) return input;
    const updates: Array<[string, string]> = [];
    if (typeof input.modelCallsEnabled === "boolean") {
      updates.push(["model_calls_enabled", String(input.modelCallsEnabled)]);
    }
    if (input.userDailyTokenBudget !== undefined) {
      updates.push(["user_daily_token_budget", String(validateBudget(input.userDailyTokenBudget))]);
    }
    if (input.siteDailyTokenBudget !== undefined) {
      updates.push(["site_daily_token_budget", String(validateBudget(input.siteDailyTokenBudget))]);
    }
    if (!updates.length) {
      return apiJson(context, { error: "No valid settings were supplied.", code: "INVALID_SETTINGS" }, { status: 400 });
    }

    const { DB } = getRuntimeBindings();
    if (!DB) throw new Error("D1 is unavailable for settings.");
    await ensureStorageSchema(DB);
    const now = Date.now();
    await DB.batch(updates.map(([key, value]) => DB.prepare(`INSERT INTO site_settings (key, value, updated_at)
      VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .bind(key, value, now)));
    const policy = await getEffectiveLaunchPolicy(DB);
    return apiJson(context, {
      saved: true,
      settings: {
        modelCallsEnabled: policy.modelCallsEnabled,
        userDailyTokenBudget: policy.userDailyTokenBudget,
        siteDailyTokenBudget: policy.siteDailyTokenBudget,
      },
    });
  } catch (error) {
    const message = error instanceof RangeError ? error.message : "Settings could not be saved.";
    return apiJson(context, { error: message, code: "INVALID_SETTINGS" }, { status: error instanceof RangeError ? 400 : 503 });
  }
}

function validateBudget(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 100_000_000) {
    throw new RangeError("Token budgets must be whole numbers between 1,000 and 100,000,000.");
  }
  return parsed;
}

function normalizeCounts(rows: CountRow[] | undefined) {
  return (rows ?? []).map((row) => ({ label: row.label, count: Number(row.count) }));
}
