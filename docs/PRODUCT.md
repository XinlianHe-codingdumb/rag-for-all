# RAG FOR ALL — MVP product specification

## Product promise

RAG FOR ALL lets a curious beginner see, change, and compare every meaningful step between a source document and a grounded answer. Explanations stay short, concrete, and occasionally funny.

## Audience

The primary user has heard of RAG and roughly knows the flow, but has never built a complete system. The interface must still be understandable without prior machine-learning experience.

## Core loop

1. Upload or open an example document.
2. Inspect the extracted text.
3. Adjust chunking and see boundaries immediately.
4. Create embeddings and inspect their projected relationships.
5. Ask a question and inspect retrieved chunks.
6. Optionally rerank the shortlist.
7. Inspect the exact prompt sent to the language model.
8. Read an answer with traceable citations.
9. Compare experiments A and B.
10. Save, export, rerun, or delete the project.

## MVP scope

- English-only interface.
- Text PDF, DOCX, TXT, and Markdown ingestion.
- Basic and advanced controls.
- Chunk size, overlap, strategy, Top K, retrieval method, and prompt controls.
- Vector and hybrid retrieval.
- Answer citations linked to source chunks.
- Token, latency, estimated cost, and manual-rating metrics.
- Two-configuration A/B comparison.
- Local development first; private hosted deployment later.
- Server-side API keys and actively deletable documents.

## Non-goals for the first release

- OCR for scanned documents.
- Complex table reconstruction.
- Multi-user accounts and billing.
- Enterprise permissions.
- Automated LLM-as-a-judge evaluation.
- Production-scale vector infrastructure.

## UX principles

- White, calm, high-contrast interface with generous spacing.
- Left-side pipeline navigation and a focused step workspace.
- Never hide the final prompt or evidence chain.
- Label simulations and previews honestly.
- Explain unfamiliar terms in one or two sentences, not a lecture.
- Reveal deeper controls only in Advanced mode.

## Definition of done for the runnable MVP

A new user can upload a supported document, run the complete pipeline, ask a question, trace the answer to source chunks, alter at least two important settings, compare two runs, and delete the document without reading external instructions.
