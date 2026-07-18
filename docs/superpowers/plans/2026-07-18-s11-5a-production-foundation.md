# S11-5A Production Foundation Implementation Plan

> Execution contract: Morse `STAGED / CRITICAL / LOCAL`. This stage produces a local release candidate, not an online-ready or deployed system.

## Goal

Create a platform-neutral application production foundation that fails closed on unsafe configuration, packages the Node application without local secrets, runs Web/Worker/Migration/Ingest as explicit roles, and provides repeatable local release and recovery evidence.

## Frozen Boundaries

### In scope

- `.dockerignore` and a non-root Node 24 application `Dockerfile`.
- Explicit production roles for Web, Worker, Migration and knowledge ingestion.
- Role-specific production preflight that reports stable codes without environment values.
- Central PostgreSQL TLS, pool, timeout and `application_name` configuration.
- Generic liveness/readiness routes that expose no model, cost, schema or chunk details.
- Baseline security response headers except CSP, which requires a separate rendered staging gate.
- A long-running Worker for at-least-once Feishu Outbox dispatch and retention cleanup, including bounded backoff, cleanup locking and graceful shutdown.
- Rebuild-only disaster recovery, release, rollback and staging-blocker documentation.
- Failure-first tests, full suite, build, local production smoke and application-image inspection.

### Out of scope

- Railway, cloud-vendor or VPS-specific configuration.
- Actual deployment, domain, TLS certificate, ICP, push or PR.
- Production BGE/Embedding image or service and real Embedding smoke.
- Production database users, grants, managed TLS certificate installation or backup service.
- Reverse-proxy body limits, IP rate limits, connection limits and SSE timeout configuration.
- CSP, monitoring platform integration and external log shipping.
- Real GPT, Bocha or Feishu calls; Feishu delivery remains at-least-once and can duplicate after an acknowledgement-loss crash window.
- Database schema changes, down migrations or generic database rollback.

## Definition Of Done

1. Docker context excludes all `.env*`, Git metadata, dependencies, builds, worktrees, logs and local evidence.
2. The app image is pinned to Node 24, runs as non-root, contains the runtime scripts/contracts/content/migrations, and defaults to the production Web role.
3. Production preflight rejects unsafe role configuration without printing values; Web requires HTTPS origin, secure Admin/invite configuration and real Provider/Embedding configuration.
4. Database pools use explicit TLS mode, maximum connections, connect/statement/idle timeouts and application name.
5. `/api/health/live` has no dependencies; `/api/health/ready` requires valid runtime configuration, current migrations, a reachable database and non-empty knowledge, while returning only `{ ok }`.
6. Worker supports explicit alerts enabled/disabled state, 5-second polling by default, bounded infrastructure backoff, startup/hourly cleanup, a PostgreSQL cleanup lock and SIGINT/SIGTERM shutdown.
7. Runbook freezes rebuild-only recovery and immutable-image rollback. It does not promise long-term backup of 10-day interaction data or exactly-once Feishu delivery.
8. Focused tests, full suite, production build, header/health smoke and application-image inspection pass. Any image build that installs locked dependencies remains an explicit approval gate.

## Tasks

### Task 1: Production contracts in RED

- Add production-config, deployment-asset, health, database-pool and worker contract tests.
- Prove the tests fail against the current empty Next config, fixed pool and one-shot scripts.

### Task 2: Fail-closed runtime and database configuration

- Add pure role validation and stable preflight errors.
- Add shared database pool options and reuse them in Web and Worker processes.
- Extend `.env.example` with production-only variables and safe comments.

### Task 3: Health and HTTP security foundation

- Add generic live/ready endpoints and keep `/api/health` as a generic readiness alias.
- Add `poweredByHeader: false` and baseline security headers without CSP.
- Verify production responses contain the headers and do not expose configuration details.

### Task 4: Production roles and app image

- Refactor cleanup into an import-safe transaction with an advisory lock.
- Add the long-running Worker and production role launcher.
- Add `.dockerignore` and the Node 24 non-root application Dockerfile.

### Task 5: Recovery, release and runbook

- Add local release smoke for live/ready and headers.
- Document Web/Worker/Migration/Ingest commands, rebuild-only recovery, rollback conditions, staging blockers and platform mapping.
- Update the blueprint and Task Center with exact local/online boundaries.

### Task 6: CRITICAL verification and closeout

- Focused tests, full PostgreSQL suite, build and local production smoke.
- Inspect image user, files and environment history without printing secrets if image build is approved.
- Separate compliance and quality/safety reviews; correct admitted blockers within three cycles.
- Run scoped closeout and knowledge reconciliation; commit locally only, no push or deploy.
