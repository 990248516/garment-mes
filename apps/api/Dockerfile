# syntax=docker/dockerfile:1.7
FROM node:22.18.0-alpine3.22 AS build
WORKDIR /app
ENV CI=true

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/worker-pwa/package.json apps/worker-pwa/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN npm ci --workspace @garment-mes/api --include-workspace-root=false --ignore-scripts

COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN npm run prisma:generate --workspace @garment-mes/api \
 && npm run build --workspace @garment-mes/api

FROM node:22.18.0-alpine3.22 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
