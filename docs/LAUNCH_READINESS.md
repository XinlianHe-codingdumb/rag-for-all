# Launch readiness

This repository is being hardened for a public, no-login educational beta.

## Implemented in the public-beta foundation

- Visitors receive a random seven-day first-party anonymous session; no end-user account is required.
- Documents and pipeline runs are isolated by that server-controlled session identity.
- Hourly D1-backed session and daily-hashed-IP limits protect uploads, run-history writes, embeddings, reranking, and answer generation.
- API responses include request IDs and no-store caching.
- Structured logs contain request metadata, timings, model/token usage, and opaque actor hashes—not document bodies, prompts, email addresses, or API keys.
- File uploads have server-side byte, MIME, parsed-character, and page-count limits.
- Baseline browser security headers are applied by the Worker.
- Plain-English Privacy and Terms pages explain anonymous analytics, storage, model processing, deletion, and beta limitations.
- Saved documents are eligible for automatic deletion after seven days; failed object deletions remain eligible for retry on later maintenance runs.
- Per-session and site-wide daily token budgets are enforced before paid model calls and reconciled with returned provider usage.
- Privacy-safe events measure journey choices, section interest, and product funnel completion without storing document or question content.
- `/admin` is restricted to the configured owner and exposes usage, funnel, section interest, dynamic token limits, and an emergency model switch.

## Before opening public access

- Configure `ADMIN_OWNER_ID` and `ANALYTICS_HASH_SALT` in the hosted environment.
- Verify `/admin` opens only for the owner and rejects an ordinary anonymous request.
- Configure the production OpenAI secret and verify `/api/status` reports persistence, anonymous sessions, and usage protection.
- Set conservative daily budgets, test the model emergency switch, then turn it back on.
- Enable and review Cloudflare Worker logs; add alerting for 5xx rate, latency, and model cost.
- Add a dedicated public privacy/support contact.
- Run upload, answer, analytics, budget, and delete smoke tests on the private deployment.

## After launch

- Add automated retention cleanup and deletion retry/audit records.
- Obtain a jurisdiction-appropriate legal review; the current pages are transparent beta notices, not a claim of full regulatory compliance.
- Add end-to-end upload-to-delete tests, load tests, and provider-failure tests.
- Add a durable vector index when multi-document or repeated-query usage justifies it.
- Add staging, backups, recovery drills, a custom domain, and a rollback runbook.
