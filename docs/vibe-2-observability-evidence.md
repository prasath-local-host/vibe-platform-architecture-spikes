# VIBE-2 Structured Logging and Correlation Evidence

> **Result:** PASS
>
> **Scope:** Control-plane HTTP, PostgreSQL, asynchronous assessment worker and audit lifecycle.

## Implemented contract

Every operational record is newline-delimited JSON with `timestamp`, `level`, `event` and `service`. A valid caller-supplied `x-correlation-id` is retained; otherwise the HTTP boundary creates one and returns it in the response header.

Correlation uses Node.js asynchronous context and is restored from the persisted assessment when a worker claims work later. Consequently, the assessment completion transaction and audit insert carry the original submission correlation even though they run outside the originating HTTP request.

| Boundary | Evidence events and fields |
| --- | --- |
| HTTP | `http.request.started`, `http.request.completed`; correlation ID, request ID, method, path, status and duration |
| PostgreSQL | `database.query.completed`, `database.query.failed`; inherited correlation ID, statement shape and duration; parameter values are excluded |
| Worker | `assessment.worker.started`, `.completed`, `.failed`; persisted correlation ID, worker, company and assessment |
| Audit | `audit.event.persisted`; correlation ID, action, company, entity type and entity ID |

## Automated verification

`test/observability.test.ts` proves JSON serialization, asynchronous context propagation, and one correlation ID across assessment submission, worker execution and both audit lifecycle events.

The PostgreSQL suite demonstrates that the same stored correlation is present on the worker completion transaction and its `audit_events` insert.

```powershell
$env:TEST_DATABASE_URL='postgres://vibe:vibe-development-only@localhost:5432/vibe_control'
pnpm test
```

Result on 2026-08-25: **9 test files passed; 41 tests passed**, including all 6 PostgreSQL integration tests.

Additional checks:

```powershell
pnpm typecheck
pnpm build
pnpm architecture:check
```

All passed. The architecture analyzer reports 20 classified production modules, 53 local dependency edges, zero outward dependency violations and zero cycles.

## Security and operational limits

SQL parameter values, bearer tokens and request bodies are not logged. The spike writes JSON to standard output so the deployment platform can route it to the selected log backend. Retention, access control, redaction policy, dashboards and alert rules remain deployment decisions and require operational review.
