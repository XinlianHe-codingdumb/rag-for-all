# RAG FOR ALL

See what your RAG is thinking.

RAG FOR ALL is a visual laboratory for understanding and comparing every step from an uploaded document to a grounded answer. It is designed for people who have heard of RAG but have not yet built the whole thing.

## Current build

The first runnable milestone includes:

- A complete step-by-step workspace in English.
- Basic and Advanced interface modes.
- A built-in employee-handbook example.
- Local TXT and Markdown loading.
- Live chunk-size and overlap controls.
- Deterministic retrieval preview with Top K and Vector/Hybrid settings.
- Final prompt inspection.
- Clearly labelled answer preview with source citation.
- Experiment A/B comparison.
- Responsive white interface.

PDF/DOCX extraction, persistent project storage, real embeddings, and live OpenAI answers are intentionally marked as upcoming milestones rather than simulated as finished features.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Then open the local URL printed by the development server.

Create a production build with:

```bash
npm run build
```

## Credentials

Do not commit API keys. A later milestone will introduce an `.env.example` and a server-side `OPENAI_API_KEY`. The real `.env` file is already ignored by Git.

## Product and architecture

- [Product specification](docs/PRODUCT.md)
- [Technical architecture](docs/ARCHITECTURE.md)

## Git learning path

This repository is intentionally developed in visible milestones. Each commit should answer one plain question, such as “what user-visible capability became real?” Suggested flow:

```bash
git status
git diff
git add .
git commit -m "Build the interactive RAG workspace"
git push
```

The project will use `main` as its default branch once the first verified commit is ready.
