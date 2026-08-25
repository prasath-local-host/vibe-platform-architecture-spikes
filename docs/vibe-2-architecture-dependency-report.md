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
| Classified production modules | 20 |
| Local dependency edges | 53 |
| Outward dependency violations | 0 |
| Local import cycles | 0 |
| Overall | PASS |

## Modules by layer

| Layer | Count | Modules |
| --- | ---: | --- |
| domain | 1 | `domain.ts` |
| application | 4 | `application-service.ts`, `assessment-service.ts`, `identity.ts`, `observability.ts` |
| adapter | 11 | `assessment-controller.ts`, `assessment-worker-host.ts`, `controller.ts`, `database.ts`, `in-memory-assessment-repository.ts`, `in-memory-repositories.ts`, `migrations.ts`, `openapi.ts`, `postgres-assessment-repository.ts`, `postgres-authorization-repository.ts`, `postgres-repositories.ts` |
| composition | 4 | `app.module.ts`, `main.ts`, `migrate.ts`, `persistence.ts` |

## Local dependency evidence

| Source | Source layer | Dependency | Dependency layer |
| --- | --- | --- | --- |
| `app.module.ts` | composition | `application-service.ts` | application |
| `app.module.ts` | composition | `assessment-controller.ts` | adapter |
| `app.module.ts` | composition | `assessment-service.ts` | application |
| `app.module.ts` | composition | `assessment-worker-host.ts` | adapter |
| `app.module.ts` | composition | `controller.ts` | adapter |
| `app.module.ts` | composition | `identity.ts` | application |
| `app.module.ts` | composition | `persistence.ts` | composition |
| `application-service.ts` | application | `domain.ts` | domain |
| `application-service.ts` | application | `observability.ts` | application |
| `assessment-controller.ts` | adapter | `assessment-service.ts` | application |
| `assessment-controller.ts` | adapter | `domain.ts` | domain |
| `assessment-controller.ts` | adapter | `identity.ts` | application |
| `assessment-controller.ts` | adapter | `openapi.ts` | adapter |
| `assessment-service.ts` | application | `domain.ts` | domain |
| `assessment-service.ts` | application | `observability.ts` | application |
| `assessment-worker-host.ts` | adapter | `assessment-service.ts` | application |
| `assessment-worker-host.ts` | adapter | `observability.ts` | application |
| `controller.ts` | adapter | `application-service.ts` | application |
| `controller.ts` | adapter | `domain.ts` | domain |
| `controller.ts` | adapter | `identity.ts` | application |
| `controller.ts` | adapter | `openapi.ts` | adapter |
| `database.ts` | adapter | `observability.ts` | application |
| `identity.ts` | application | `domain.ts` | domain |
| `in-memory-assessment-repository.ts` | adapter | `assessment-service.ts` | application |
| `in-memory-assessment-repository.ts` | adapter | `domain.ts` | domain |
| `in-memory-assessment-repository.ts` | adapter | `in-memory-repositories.ts` | adapter |
| `in-memory-repositories.ts` | adapter | `application-service.ts` | application |
| `in-memory-repositories.ts` | adapter | `domain.ts` | domain |
| `main.ts` | composition | `app.module.ts` | composition |
| `main.ts` | composition | `observability.ts` | application |
| `main.ts` | composition | `openapi.ts` | adapter |
| `migrate.ts` | composition | `database.ts` | adapter |
| `migrate.ts` | composition | `migrations.ts` | adapter |
| `migrations.ts` | adapter | `database.ts` | adapter |
| `persistence.ts` | composition | `application-service.ts` | application |
| `persistence.ts` | composition | `assessment-service.ts` | application |
| `persistence.ts` | composition | `database.ts` | adapter |
| `persistence.ts` | composition | `identity.ts` | application |
| `persistence.ts` | composition | `in-memory-assessment-repository.ts` | adapter |
| `persistence.ts` | composition | `in-memory-repositories.ts` | adapter |
| `persistence.ts` | composition | `migrations.ts` | adapter |
| `persistence.ts` | composition | `observability.ts` | application |
| `persistence.ts` | composition | `postgres-assessment-repository.ts` | adapter |
| `persistence.ts` | composition | `postgres-authorization-repository.ts` | adapter |
| `persistence.ts` | composition | `postgres-repositories.ts` | adapter |
| `postgres-assessment-repository.ts` | adapter | `assessment-service.ts` | application |
| `postgres-assessment-repository.ts` | adapter | `database.ts` | adapter |
| `postgres-assessment-repository.ts` | adapter | `domain.ts` | domain |
| `postgres-authorization-repository.ts` | adapter | `database.ts` | adapter |
| `postgres-authorization-repository.ts` | adapter | `identity.ts` | application |
| `postgres-repositories.ts` | adapter | `application-service.ts` | application |
| `postgres-repositories.ts` | adapter | `database.ts` | adapter |
| `postgres-repositories.ts` | adapter | `domain.ts` | domain |

## External dependency evidence

| Layer | Direct external imports |
| --- | --- |
| domain | None |
| application | `node:async_hooks`, `node:crypto` |
| adapter | `@nestjs/common`, `@nestjs/swagger`, `kysely`, `node:crypto`, `pg`, `zod` |
| composition | `@fastify/helmet`, `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-fastify`, `node:crypto`, `reflect-metadata` |

## Violations and cycles

No outward dependency violations were detected.

No local import cycles were detected.

## Architectural conclusion

The tested backend supports the proposed modular control-plane direction. Domain and application logic remain independent of NestJS, Fastify, Kysely and PostgreSQL. Framework, HTTP and persistence concerns remain replaceable adapters, while runtime wiring is isolated in the composition layer.

This evidence covers static TypeScript imports only. It does not prove runtime tenant isolation, infrastructure isolation, identity-provider behavior or operational recovery; those require their dedicated spike evidence.
