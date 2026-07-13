# Digital Morse RAG MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable Digital Morse text-chat loop with expiring invite access, pgvector retrieval, OpenAI streaming, citations, short-term conversation memory, and budget gates.

**Architecture:** Next.js Route Handlers own access and chat HTTP contracts. PostgreSQL + pgvector is the single durable store for approved knowledge, embeddings, invite sessions, short-lived messages, and usage. An OpenAI adapter hides provider details behind configuration; tests inject deterministic fakes and real-provider evidence is labeled separately.

**Tech Stack:** Next.js 16, TypeScript, Node 24 test runner, OpenAI Node SDK, `pg`, PostgreSQL 16 + pgvector, CSS Modules.

---

### Task 1: RED for deterministic core behavior

**Files:**
- Create: `tests/access.test.ts`
- Create: `tests/knowledge.test.ts`
- Create: `tests/budget.test.ts`
- Create: `tests/sse.test.ts`
- Modify: `package.json`

- [x] Write failing tests for SHA-256 invite matching, expiry, safe chunking, stable chunk IDs, 50/75/90/100 budget levels, and SSE event encoding.
- [x] Run `npm test`; expected FAIL because `lib/server/*` modules do not exist.
- [x] Add only the minimal pure functions under `lib/server/` and rerun until these tests pass.

### Task 2: RED/GREEN for pgvector schema and ingestion

**Files:**
- Create: `compose.yaml`
- Create: `db/migrations/001_morse_rag.sql`
- Create: `scripts/migrate-db.mjs`
- Create: `scripts/ingest-knowledge.mjs`
- Create: `tests/schema.test.ts`
- Create: `tests/knowledge-source.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] Assert schema contains `vector(1536)`, HNSW cosine index, cascade deletion, expiry indexes, and no public draft source.
- [x] Assert the source extractor reads only `content/s3-content.json` and produces stable public source labels.
- [x] Install only `openai`, `pg`, and `@types/pg`; start the project-local pgvector service and apply the migration.
- [x] Ingest approved content twice and prove the second run is idempotent.

### Task 3: RED/GREEN for access and conversation APIs

**Files:**
- Create: `lib/server/config.ts`
- Create: `lib/server/db.ts`
- Create: `lib/server/access.ts`
- Create: `lib/server/conversation.ts`
- Create: `app/api/access/route.ts`
- Create: `app/api/chat/route.ts`
- Create: `app/api/health/route.ts`
- Create: `tests/access-service.test.ts`
- Create: `tests/chat-service.test.ts`

- [x] Test invalid, expired, revoked and overused invites before implementing routes.
- [x] Test that chat rejects missing sessions, stores only bounded history, and never accepts client-supplied assistant history.
- [x] Implement hashed bearer-session cookies and database ownership checks.
- [x] Verify focused tests and loopback route responses.

### Task 4: RED/GREEN for RAG and OpenAI streaming

**Files:**
- Create: `lib/server/ai-provider.ts`
- Create: `lib/server/openai-provider.ts`
- Create: `lib/server/rag.ts`
- Create: `lib/server/chat-service.ts`
- Create: `tests/rag.test.ts`
- Create: `tests/openai-stream.test.ts`

- [x] Test embedding-to-cosine-query parameter flow, top-k evidence ordering, prompt injection boundaries, source metadata, delta streaming and usage capture.
- [x] Implement provider injection, Responses API streaming and embedding calls using configurable model IDs and base URL.
- [x] Record usage after stream completion; fail closed when the monthly budget is exhausted.

### Task 5: RED/GREEN for the public chat UI

**Files:**
- Create: `components/MorseChat.tsx`
- Create: `components/MorseChat.module.css`
- Modify: `app/page.tsx`
- Create: `tests/chat-ui-contract.test.ts`

- [x] Assert the page mounts one chat surface with invite unlock, normal/interviewer mode, sources, loading, empty, error and budget-warning states.
- [x] Use `morse-design` before visual implementation and consume only existing tokens.
- [x] Implement accessible controls, stable dimensions, mobile full-height layout and reduced-motion behavior.

### Task 6: Local and real smoke verification

**Files:**
- Create: `.env.example`
- Create: `scripts/create-invite.mjs`
- Create: `scripts/cleanup-expired.mjs`
- Create: `scripts/rag-smoke.mjs`
- Modify: `README.md`
- Modify: `docs/task-center/run-state.md`

- [x] Run `npm test`, `npm run build`, migration, double ingestion and local retrieval smoke.
- [x] Use a disposable local invite for 1440/390 loopback browser verification; confirm console errors are zero.
- [x] If OpenAI network is reachable, perform at most three real calls and label them `real Provider`; otherwise record the exact connectivity blocker.
- [x] Run `git diff --check`, review the scoped diff, update Task Center, and stage/commit only after all required local gates pass.

### Task 7: Real local semantic embeddings

**Files:**
- Create: `scripts/local-embedding-server.py`
- Create: `content/rag-eval.json`
- Create: `scripts/rag-eval.mjs`
- Modify: `lib/server/config.ts`
- Modify: `lib/server/provider.ts`
- Modify: `lib/server/openai-provider.ts`
- Modify: `scripts/ingest-knowledge.mjs`
- Modify: `.env.example`
- Modify: `docs/portfolio-blueprint.md`
- Test: `tests/openai-provider.test.ts`
- Test: `tests/config.test.ts`
- Test: `tests/local-embedding-contract.test.ts`

- [x] Keep chat Responses and Embeddings on separately configurable base URLs/credentials.
- [x] Serve normalized `BAAI/bge-small-zh-v1.5` vectors from `127.0.0.1:18091`, padded from 512 to the existing 1536 dimensions. Current installed PyTorch is CPU-only, so GPU acceleration remains explicitly unproven.
- [x] Re-index all approved public knowledge with the real local model and prove second ingestion is idempotent.
- [x] Run the gold retrieval set and record top-1/top-3 evidence without treating test embeddings as semantic proof.
- [x] Record why pgvector stays in-process for the controlled MVP and the benchmark/capability triggers for considering Milvus/Qdrant later.
