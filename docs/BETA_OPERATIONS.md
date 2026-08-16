# Public-beta operations runbook

Use this checklist while RAG FOR ALL is publicly available without end-user accounts.

## Before turning public access on

- Open `/admin` with the owner account and confirm model access is in the intended state.
- Set per-session and whole-site daily token budgets.
- Verify the public site requires no login and the owner dashboard remains forbidden to anonymous visitors.
- Use a non-sensitive document to test upload, pipeline, answer, analytics, and deletion.

## Daily checks during an active test

- Review Worker logs for `api.failed`, `retention.delete_failed`, `usage.record_failed`, and repeated `api.rate_limited` events.
- Review `/admin` for section interest, funnel completion, and the current UTC-day token total.
- Investigate unexpected funnel or request spikes; pause model calls immediately if spend behavior is suspicious.
- Check for spikes in 5xx responses, OpenAI provider failures, D1/R2 errors, or unusually slow requests.
- Do not copy document text or full questions into bug reports.

Default limits:

- Document retention: 7 days.
- Per-session model budget: 1,000,000 tokens per UTC day.
- Shared site model budget: 5,000,000 tokens per UTC day.

Token budgets and model availability can be changed live in `/admin`. Environment values remain the fallback defaults.

## Incident thresholds

- Pause model-backed steps if daily usage crosses 90% unexpectedly or request volume looks automated.
- Temporarily make the Site private if abuse continues after model calls are paused.
- If deletion repeatedly fails, keep the database record so the cleanup remains retryable and investigate R2 before claiming the data is gone.

## Taking the public beta offline

- Pause model calls in `/admin` first.
- Change Sites access from public to private if the whole product should be unavailable.
- Keep analytics and operational logs free of document contents.
- Check logs by request ID when investigating a failure.

## Still manual

The application emits structured logs, stores privacy-safe product events, and has hard usage limits, but automatic paging is not yet connected. Until Cloudflare notifications or Sentry is configured, the owner must review `/admin` and logs during active periods. Add a dedicated privacy contact, automated alerts, audited deletion retries, and legal review appropriate to the intended users and jurisdictions.
