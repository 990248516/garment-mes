# syntax=docker/dockerfile:1.7
FROM node:22.18.0-alpine3.22 AS build
WORKDIR /app
ENV CI=true
ARG VITE_BASE_PATH=/worker/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/worker-pwa/package.json apps/worker-pwa/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN npm ci --workspace @garment-mes/worker-pwa --workspace @garment-mes/api-client --include-workspace-root=false --ignore-scripts

COPY packages/api-client packages/api-client
COPY apps/worker-pwa apps/worker-pwa
RUN npm run build --workspace @garment-mes/worker-pwa

FROM nginx:1.29.1-alpine3.22 AS runtime
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/worker-pwa/dist /usr/share/nginx/html
EXPOSE 80
