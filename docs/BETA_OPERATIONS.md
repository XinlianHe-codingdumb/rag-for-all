# Private-beta operations runbook

Use this checklist while RAG FOR ALL is limited to invited testers.

## Before adding a tester

- Confirm the person understands this is an experimental learning product.
- Add only the email they use to sign in to ChatGPT/OpenAI.
- Send the private site URL plus a request to use a non-sensitive test document.
- Ask them to read `/privacy` and `/terms` before uploading.

## Daily checks during an active test

- Review Worker logs for `api.failed`, `retention.delete_failed`, `usage.record_failed`, and repeated `api.rate_limited` events.
- Review `model_usage_daily` for the current UTC day. Investigate a user above 80% of the per-user budget or a site total above 80% of the shared budget.
- Check for spikes in 5xx responses, OpenAI provider failures, D1/R2 errors, or unusually slow requests.
- Do not copy document text or full questions into bug reports.

Default limits:

- Document retention: 7 days.
- Per-user model budget: 1,000,000 tokens per UTC day.
- Shared site model budget: 5,000,000 tokens per UTC day.

The values can be changed through `DATA_RETENTION_DAYS`, `MODEL_DAILY_USER_TOKEN_BUDGET`, and `MODEL_DAILY_SITE_TOKEN_BUDGET` without changing source code.

## Incident thresholds

- Pause new invitations if 5xx responses exceed 5% for 15 minutes.
- Pause model-backed steps if daily usage crosses 90% unexpectedly.
- Remove a tester’s access if there is evidence of limit bypassing, prohibited uploads, or interference with other accounts.
- If deletion repeatedly fails, keep the database record so the cleanup remains retryable and investigate R2 before claiming the data is gone.

## End of a test

- Ask the tester to delete their document from the Document step.
- Remove their email from the Site allowlist if their access should end.
- Record feedback without copying document contents.
- Check logs by request ID if they report a failure.

## Still manual

The application emits structured logs and has hard usage limits, but automatic paging is not yet connected. Until Cloudflare notifications or Sentry is configured, the owner must review logs during active test periods. Before a public beta, add a dedicated privacy contact, automated alerts, audited deletion retries, and a legal review appropriate to the intended users and jurisdictions.
