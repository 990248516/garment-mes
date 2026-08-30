# Garment MES

Garment one-bundle-one-code MES/WIP MVP（服装单扎单码生产执行系统）。

## Components

- `apps/api` — NestJS API and Prisma schema
- `apps/admin-web` — React/Vite management console
- `apps/worker-pwa` — Worker scanning PWA
- `packages/api-client` — Shared typed API client
- `api/openapi.yaml` — OpenAPI contract
- `database/schema.sql` — Database schema reference
- `infra/nginx` — Gateway and SPA Nginx configuration
- `docs` — Product and database design documents

## Requirements

- Node.js 22+
- npm 11+
- Docker with Compose

## Local setup

```bash
cp .env.example .env
npm ci
npm run typecheck
npm run test
npm run build
```

Start the Docker stack after filling the required values in `.env`:

```bash
docker compose up --build
```

Do not commit `.env`, credentials, production data, or database dumps.
