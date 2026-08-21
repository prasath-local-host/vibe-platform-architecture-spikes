# Vibe Platform Architecture Spikes

Evidence-producing experiments for the Vibe Coding Platform architecture. This repository contains no customer application code, data or credentials.

## Current work

`VIBE-2` validates the smallest control-plane vertical slice. The first checkpoint proves company-scoped authorization, idempotent application registration and attributable audit evidence. Synthetic request headers are deliberately temporary; federated identity and PostgreSQL persistence remain required before the spike can reach a decision.

## Run

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
docker compose up -d postgres
pnpm dev
```

The API binds to `127.0.0.1:3000`. Never expose the synthetic-header authentication mechanism beyond the local spike environment.

## Source documents

- [Architecture Validation Spike Plan](https://local-host.atlassian.net/wiki/spaces/VCP/pages/224296961/Vibe+Coding+Platform+Architecture+Validation+Spike+Plan)
- [VIBE-2](https://local-host.atlassian.net/browse/VIBE-2)
