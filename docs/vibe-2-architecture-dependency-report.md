# VIBE-2 Architecture Dependency and Module-Boundary Report

> **Result:** PASS
>
> **Scope:** Production TypeScript modules in `src/`; generators and this analyzer are excluded as build tooling.
>
> **Reproduce:** `pnpm architecture:check`

## Boundary model

Dependencies must point inward:

`composition → adapters → application → domain`

* **Domain** contains company-scoped entities and invariant enforcement and has no external dependencies.
* **Application** contains use cases and repository/identity ports. It may depend on the domain and Node.js built-ins only.
* **Adapters** contain HTTP/OpenAPI, worker hosting, persistence implementations, database schema and migrations.
* **Composition** wires adapters to ports and owns process startup and migration entry points.

## Automated result

| Check | Result |
| --- | --- |
| Classified production modules | 42 |
| Local dependency edges | 112 |
| Outward dependency violations | 0 |
| Local import cycles | 0 |
| Overall | PASS |

## Modules by layer

| Layer | Count | Modules |
| --- | ---: | --- |
| domain | 1 | `domain.ts` |
| application | 10 | `application-service.ts`, `artifact-service.ts`, `assessment-service.ts`, `build-job-service.ts`, `build-pipeline.ts`, `build-service.ts`, `dependency-restoration.ts`, `identity.ts`, `observability.ts`, `release-service.ts` |
| adapter | 27 | `assessment-controller.ts`, `assessment-worker-host.ts`, `browser-session.ts`, `build-controller.ts`, `build-job-engine.ts`, `build-worker-host.ts`, `controller.ts`, `database.ts`, `docker-build-executor.ts`, `docker-build-pipeline.ts`, `docker-dependency-restorer.ts`, `filesystem-artifact-store.ts`, `git-source-artifact-repository.ts`, `git-source-repository.ts`, `in-memory-assessment-repository.ts`, `in-memory-build-record-repository.ts`, `in-memory-release-repository.ts`, `in-memory-repositories.ts`, `manifest-assessment-engine.ts`, `migrations.ts`, `oidc-access-token-verifier.ts`, `openapi.ts`, `postgres-assessment-repository.ts`, `postgres-authorization-repository.ts`, `postgres-build-record-repository.ts`, `postgres-release-repository.ts`, `postgres-repositories.ts` |
| composition | 4 | `app.module.ts`, `main.ts`, `migrate.ts`, `persistence.ts` |

## Local dependency evidence

| Source | Source layer | Dependency | Dependency layer |
| --- | --- | --- | --- |
| `app.module.ts` | composition | `application-service.ts` | application |
| `app.module.ts` | composition | `assessment-controller.ts` | adapter |
| `app.module.ts` | composition | `assessment-service.ts` | application |
| `app.module.ts` | composition | `assessment-worker-host.ts` | adapter |
| `app.module.ts` | composition | `build-controller.ts` | adapter |
| `app.module.ts` | composition | `build-job-service.ts` | application |
| `app.module.ts` | composition | `build-worker-host.ts` | adapter |
| `app.module.ts` | composition | `controller.ts` | adapter |
| `app.module.ts` | composition | `identity.ts` | application |
| `app.module.ts` | composition | `persistence.ts` | composition |
| `application-service.ts` | application | `domain.ts` | domain |
| `application-service.ts` | application | `observability.ts` | application |
| `assessment-controller.ts` | adapter | `assessment-service.ts` | application |
| `assessment-controller.ts` | adapter | `domain.ts` | domain |
| `assessment-controller.ts` | adapter | `identity.ts` | application |
| `assessment-controller.ts` | adapter | `openapi.ts` | adapter |
| `assessment-service.ts` | application | `application-service.ts` | application |
| `assessment-service.ts` | application | `domain.ts` | domain |
| `assessment-service.ts` | application | `observability.ts` | application |
| `assessment-worker-host.ts` | adapter | `assessment-service.ts` | application |
| `assessment-worker-host.ts` | adapter | `observability.ts` | application |
| `browser-session.ts` | adapter | `oidc-access-token-verifier.ts` | adapter |
| `build-controller.ts` | adapter | `build-job-service.ts` | application |
| `build-controller.ts` | adapter | `domain.ts` | domain |
| `build-controller.ts` | adapter | `identity.ts` | application |
| `build-controller.ts` | adapter | `openapi.ts` | adapter |
| `build-job-engine.ts` | adapter | `artifact-service.ts` | application |
| `build-job-engine.ts` | adapter | `build-job-service.ts` | application |
| `build-job-engine.ts` | adapter | `build-pipeline.ts` | application |
| `build-job-engine.ts` | adapter | `build-service.ts` | application |
| `build-job-engine.ts` | adapter | `domain.ts` | domain |
| `build-job-service.ts` | application | `application-service.ts` | application |
| `build-job-service.ts` | application | `domain.ts` | domain |
| `build-job-service.ts` | application | `observability.ts` | application |
| `build-pipeline.ts` | application | `artifact-service.ts` | application |
| `build-pipeline.ts` | application | `build-service.ts` | application |
| `build-pipeline.ts` | application | `dependency-restoration.ts` | application |
| `build-worker-host.ts` | adapter | `build-job-service.ts` | application |
| `build-worker-host.ts` | adapter | `observability.ts` | application |
| `controller.ts` | adapter | `application-service.ts` | application |
| `controller.ts` | adapter | `domain.ts` | domain |
| `controller.ts` | adapter | `identity.ts` | application |
| `controller.ts` | adapter | `openapi.ts` | adapter |
| `database.ts` | adapter | `observability.ts` | application |
| `dependency-restoration.ts` | application | `build-service.ts` | application |
| `docker-build-executor.ts` | adapter | `build-service.ts` | application |
| `docker-build-pipeline.ts` | adapter | `build-pipeline.ts` | application |
| `docker-build-pipeline.ts` | adapter | `build-service.ts` | application |
| `docker-dependency-restorer.ts` | adapter | `build-service.ts` | application |
| `docker-dependency-restorer.ts` | adapter | `dependency-restoration.ts` | application |
| `filesystem-artifact-store.ts` | adapter | `artifact-service.ts` | application |
| `git-source-artifact-repository.ts` | adapter | `build-service.ts` | application |
| `git-source-artifact-repository.ts` | adapter | `git-source-repository.ts` | adapter |
| `git-source-repository.ts` | adapter | `assessment-service.ts` | application |
| `identity.ts` | application | `domain.ts` | domain |
| `in-memory-assessment-repository.ts` | adapter | `assessment-service.ts` | application |
| `in-memory-assessment-repository.ts` | adapter | `domain.ts` | domain |
| `in-memory-assessment-repository.ts` | adapter | `in-memory-repositories.ts` | adapter |
| `in-memory-build-record-repository.ts` | adapter | `build-job-service.ts` | application |
| `in-memory-build-record-repository.ts` | adapter | `domain.ts` | domain |
| `in-memory-build-record-repository.ts` | adapter | `in-memory-repositories.ts` | adapter |
| `in-memory-release-repository.ts` | adapter | `domain.ts` | domain |
| `in-memory-release-repository.ts` | adapter | `in-memory-repositories.ts` | adapter |
| `in-memory-release-repository.ts` | adapter | `release-service.ts` | application |
| `in-memory-repositories.ts` | adapter | `application-service.ts` | application |
| `in-memory-repositories.ts` | adapter | `domain.ts` | domain |
| `main.ts` | composition | `app.module.ts` | composition |
| `main.ts` | composition | `browser-session.ts` | adapter |
| `main.ts` | composition | `observability.ts` | application |
| `main.ts` | composition | `openapi.ts` | adapter |
| `manifest-assessment-engine.ts` | adapter | `assessment-service.ts` | application |
| `migrate.ts` | composition | `database.ts` | adapter |
| `migrate.ts` | composition | `migrations.ts` | adapter |
| `migrations.ts` | adapter | `database.ts` | adapter |
| `oidc-access-token-verifier.ts` | adapter | `identity.ts` | application |
| `persistence.ts` | composition | `application-service.ts` | application |
| `persistence.ts` | composition | `assessment-service.ts` | application |
| `persistence.ts` | composition | `build-job-engine.ts` | adapter |
| `persistence.ts` | composition | `build-job-service.ts` | application |
| `persistence.ts` | composition | `database.ts` | adapter |
| `persistence.ts` | composition | `docker-build-pipeline.ts` | adapter |
| `persistence.ts` | composition | `filesystem-artifact-store.ts` | adapter |
| `persistence.ts` | composition | `git-source-artifact-repository.ts` | adapter |
| `persistence.ts` | composition | `git-source-repository.ts` | adapter |
| `persistence.ts` | composition | `identity.ts` | application |
| `persistence.ts` | composition | `in-memory-assessment-repository.ts` | adapter |
| `persistence.ts` | composition | `in-memory-build-record-repository.ts` | adapter |
| `persistence.ts` | composition | `in-memory-repositories.ts` | adapter |
| `persistence.ts` | composition | `manifest-assessment-engine.ts` | adapter |
| `persistence.ts` | composition | `migrations.ts` | adapter |
| `persistence.ts` | composition | `observability.ts` | application |
| `persistence.ts` | composition | `oidc-access-token-verifier.ts` | adapter |
| `persistence.ts` | composition | `postgres-assessment-repository.ts` | adapter |
| `persistence.ts` | composition | `postgres-authorization-repository.ts` | adapter |
| `persistence.ts` | composition | `postgres-build-record-repository.ts` | adapter |
| `persistence.ts` | composition | `postgres-repositories.ts` | adapter |
| `postgres-assessment-repository.ts` | adapter | `assessment-service.ts` | application |
| `postgres-assessment-repository.ts` | adapter | `database.ts` | adapter |
| `postgres-assessment-repository.ts` | adapter | `domain.ts` | domain |
| `postgres-authorization-repository.ts` | adapter | `database.ts` | adapter |
| `postgres-authorization-repository.ts` | adapter | `identity.ts` | application |
| `postgres-build-record-repository.ts` | adapter | `build-job-service.ts` | application |
| `postgres-build-record-repository.ts` | adapter | `database.ts` | adapter |
| `postgres-build-record-repository.ts` | adapter | `domain.ts` | domain |
| `postgres-release-repository.ts` | adapter | `database.ts` | adapter |
| `postgres-release-repository.ts` | adapter | `domain.ts` | domain |
| `postgres-release-repository.ts` | adapter | `release-service.ts` | application |
| `postgres-repositories.ts` | adapter | `application-service.ts` | application |
| `postgres-repositories.ts` | adapter | `database.ts` | adapter |
| `postgres-repositories.ts` | adapter | `domain.ts` | domain |
| `release-service.ts` | application | `build-job-service.ts` | application |
| `release-service.ts` | application | `domain.ts` | domain |

## External dependency evidence

| Layer | Direct external imports |
| --- | --- |
| domain | None |
| application | `node:async_hooks`, `node:crypto` |
| adapter | `@nestjs/common`, `@nestjs/swagger`, `fastify`, `jose`, `kysely`, `node:child_process`, `node:crypto`, `node:fs/promises`, `node:os`, `node:path`, `node:util`, `pg`, `zod` |
| composition | `@fastify/helmet`, `@fastify/static`, `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-fastify`, `node:crypto`, `node:path`, `reflect-metadata` |

## Violations and cycles

No outward dependency violations were detected.

No local import cycles were detected.

## Architectural conclusion

The tested backend supports the proposed modular control-plane direction. Domain and application logic remain independent of NestJS, Fastify, Kysely and PostgreSQL. Framework, HTTP and persistence concerns remain replaceable adapters, while runtime wiring is isolated in the composition layer.

This evidence covers static TypeScript imports only. It does not prove runtime tenant isolation, infrastructure isolation, identity-provider behavior or operational recovery; those require their dedicated spike evidence.
