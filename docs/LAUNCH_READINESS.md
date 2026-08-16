# Launch readiness

This repository is being hardened for a private beta before any public launch.

## Implemented in the private-beta foundation

- Sites authenticated-user headers protect document, run-history, embedding, rerank, and answer APIs.
- Local development receives a development-only identity on loopback hosts.
- Documents and pipeline runs carry a server-controlled owner ID and are filtered by owner.
- Existing ownerless records are claimed by the first authenticated private-site owner before external access is enabled.
- Hourly D1-backed limits protect uploads, run-history writes, embeddings, reranking, and answer generation.
- API responses include request IDs and no-store caching.
- Structured logs contain request metadata, timings, model/token usage, and opaque actor hashes—not document bodies, prompts, email addresses, or API keys.
- File uploads have server-side byte, MIME, parsed-character, and page-count limits.
- Baseline browser security headers are applied by the Worker.
- Plain-English Privacy and Terms pages explain storage, model processing, deletion, and beta limitations.
- Saved documents are eligible for automatic deletion after seven days; failed object deletions remain eligible for retry on later maintenance runs.
- Per-user and site-wide daily token budgets are enforced before paid model calls and reconciled with returned provider usage.

## Before inviting beta users

- Confirm the existing owner has opened the private deployment once so legacy ownerless records are claimed.
- Confirm the Sites access policy includes only intended testers.
- Configure the production OpenAI secret and verify `/api/status` reports persistence and usage protection.
- Enable and review Cloudflare Worker logs; add alerting for 5xx rate, latency, and model cost.
- Replace the private-beta invitation contact with a dedicated public privacy contact before public access.
- Run the storage smoke test against staging with authenticated-user headers.

## Before a public beta

- Confirm the current platform path for public sign-in; do not expose the current APIs anonymously.
- Add explicit projects and membership tables before team sharing.
- Replace first-owner legacy claiming with a completed, audited backfill migration.
- Add automated retention cleanup and deletion retry/audit records.
- Obtain a jurisdiction-appropriate legal review; the current pages are transparent beta notices, not a claim of full regulatory compliance.
- Add end-to-end upload-to-delete tests, load tests, and provider-failure tests.
- Add a durable vector index when multi-document or repeated-query usage justifies it.
- Add staging, backups, recovery drills, a custom domain, and a rollback runbook.
