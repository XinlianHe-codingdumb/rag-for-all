# RAG FOR ALL

See what your RAG is thinking.

RAG FOR ALL is a visual laboratory for understanding and comparing every step from an uploaded document to a grounded answer. It is designed for people who have heard of RAG but have not yet built the whole thing.

## Current build

The current runnable milestone includes:

- A complete step-by-step workspace in English.
- Basic and Advanced interface modes.
- A built-in employee-handbook example.
- Real PDF, DOCX, TXT, and Markdown extraction (20 MB limit).
- Exact token-based chunking with live chunk size, overlap, and strategy controls.
- Local TF-IDF embeddings plus Keyword, Vector, and Hybrid retrieval.
- Top K results that change with the selected value.
- Exact final prompt inspection and chunk/page citations.
- OpenAI embeddings and Responses API when a server-side key is configured.
- Honest local fallbacks when OpenAI is not configured or unavailable.
- D1 metadata/run history and R2 originals when storage bindings are available.
- No-login public use with a seven-day first-party anonymous session.
- Per-session document/run isolation plus session and daily-hashed-IP API rate limits.
- Privacy-safe section, funnel, and feature analytics with a private owner dashboard at `/admin`.
- Live owner controls for per-session/site token budgets and an emergency model-call switch.
- Metadata-only request logs with request IDs and baseline browser security headers.
- One-click deletion of the original, parsed copy, and related run history.
- Real Experiment A/B comparison using two pipeline configurations.
- Responsive white interface.

Scanned-PDF OCR, table reconstruction, accounts, billing, and production-scale vector storage remain outside this milestone.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). The Cloudflare development runtime provides local D1 and R2 storage automatically.

Create a production build with:

```bash
npm run build
```

## Credentials

Do not commit API keys. Copy `.env.example` to `.env.local`, add your key there, and restart the development server:

```dotenv
OPENAI_API_KEY=your-key-here
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_RESPONSE_MODEL=gpt-5.6-luna
MODEL_DAILY_USER_TOKEN_BUDGET=250000
MODEL_DAILY_SITE_TOKEN_BUDGET=1000000
ADMIN_OWNER_ID=your-sites-owner-id
ADMIN_OWNER_EMAIL=your-owner-account@example.com
ANALYTICS_HASH_SALT=a-long-random-secret
```

The browser never receives the key. If no key is present, the app still runs end-to-end with local TF-IDF retrieval and an extractive answer fallback.

## Verify the pipeline

```bash
npm test
```

The test suite builds the app, checks its server-rendered shell, parses real PDF and DOCX fixtures, verifies token limits, confirms Top K behavior, and proves that different chunk sizes produce different experiments.

## Product and architecture

- [Product specification](docs/PRODUCT.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [Chinese project management guide](PROJECT_MANAGER_GUIDE.zh-CN.md)
- [Public-beta launch checklist](docs/LAUNCH_READINESS.md)
- [Public-beta operations runbook](docs/BETA_OPERATIONS.md)

## Git learning path

This repository is intentionally developed in visible milestones. Each commit should answer one plain question, such as “what user-visible capability became real?” Suggested flow:

```bash
git status
git diff
git add .
git commit -m "Build the interactive RAG workspace"
git push
```

The default branch is `main`; feature work uses `codex/*` branches and draft pull requests.
