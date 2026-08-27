# Security audit — 2026-08-27

This document records the launch security review for RAG FOR ALL. It is an engineering audit, not a guarantee that the application is invulnerable or a substitute for independent penetration testing.

## Scope

- Public browser application and Worker security headers
- Anonymous session, document, experiment, analytics, and owner-admin APIs
- File upload and parsed-document persistence
- Calls to embedding, reranking, and answer models
- D1 and R2 access boundaries
- Repository history, environment handling, dependencies, tests, and release controls

The product's teaching copy and visual content were not changed as part of this audit.

## Controls verified or added

- OpenAI and owner credentials remain server-side hosted secrets; `.env` files are ignored by Git.
- Current files and Git history were scanned for common API-key and private-key patterns. No live secret was identified.
- Anonymous IDs are server-issued UUIDs in HttpOnly, Secure-in-production, SameSite cookies.
- Documents, experiment runs, and deletion operations are scoped to the server-derived anonymous owner.
- Owner access requires the configured identity claims; the localhost bypass is development-only.
- Mutating APIs reject cross-site browser requests and JSON APIs require the expected media type.
- Request bodies, stored metadata, parsed characters, page counts, filenames, and JSON fields have explicit limits.
- Uploads use a server-issued ID and validate extension, declared type, file signature, and parsed structure before persistence.
- Failed database writes clean up newly uploaded objects to avoid orphaned storage.
- Model routes have session and hashed-IP limits, per-user and site-wide daily budgets, and an emergency off switch.
- Retrieved documents and candidates are marked as untrusted data in model instructions to reduce indirect prompt-injection risk.
- Provider failures are converted to generic public errors; document text, prompts, secrets, and owner identity are excluded from structured logs.
- Retention cleanup is triggered deterministically by ordinary status and analytics traffic rather than relying only on random requests.
- HTTPS redirection, HSTS, CSP, clickjacking, MIME-sniffing, referrer, browser-feature, opener, and cross-origin resource policies are applied at the Worker.
- Production responses are no-store where appropriate and carry request IDs for incident tracing.
- GitHub CI now builds, lints, tests, and audits production dependencies. Dependabot checks npm and workflow dependencies.

## Verification results

- Production dependency audit: **0 known vulnerabilities**.
- Full dependency audit: **4 moderate development-only findings**, inherited through `drizzle-kit`'s development-time esbuild toolchain.
- Application build and automated tests: **passed**.
- Security smoke tests: cross-site mutation, malformed/oversized JSON, disguised executable upload, public status minimization, document create/list/delete isolation: **passed**.
- Lint: **passed with existing image-performance warnings and no errors**.

The remaining development-only advisory is not present in the production dependency set or public Worker runtime. Do not expose the local Drizzle development server to untrusted networks; upgrade the toolchain when an upstream non-breaking fix is available.

## Residual risks and operational requirements

- Application-level limits reduce abuse but do not replace Cloudflare WAF/bot rules, infrastructure rate limiting, spend alerts, and an incident kill switch.
- Uploaded knowledge is sent to the configured model provider when a visitor runs the relevant pipeline stages. Privacy and Terms must stay aligned with actual provider and retention behavior.
- Prompt-injection defenses lower risk but cannot guarantee that every adversarial document is harmless. Retrieved evidence should never be allowed to grant tools or authorization by itself.
- Retention is traffic-triggered. A scheduled maintenance job with deletion audit records is recommended for predictable cleanup during low-traffic periods.
- Backups, restoration tests, alert thresholds, and rollback rehearsals remain operational responsibilities.
- Independent dynamic scanning and penetration testing are recommended before handling sensitive or regulated data.

## Owner launch checklist

1. Keep the model daily budget conservative and verify the emergency model switch from `/admin`.
2. Enable Cloudflare bot protection and rate limiting for `/api/embeddings`, `/api/rerank`, `/api/answer`, `/api/documents`, and `/api/events`.
3. Alert on unusual request volume, 429/5xx growth, D1/R2 errors, model-token spikes, and repeated upload rejection.
4. Rotate any credential immediately if it is ever printed, pasted into an issue, or committed, then purge it from Git history.
5. Review Dependabot alerts and Security CI failures before deploying dependency changes.
6. Test upload, run, analytics, owner access, emergency-off, and deletion after each production release.
