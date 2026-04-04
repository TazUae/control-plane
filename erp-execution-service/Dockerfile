# syntax=docker/dockerfile:1
#
# Build from repository root so `packages/erp-utils` resolves for `file:../packages/erp-utils`:
#   docker build -f erp-execution-service/Dockerfile .
#
# Runtime aligns with ERPNext/Frappe: same image family as backend, user `frappe`,
# cwd `/home/frappe/frappe-bench`, `bench` on PATH. Mount your real bench/sites volume
# at `/home/frappe/frappe-bench` (same as your ERPNext backend/worker).
#
# Build-time override: docker build --build-arg ERP_RUNTIME_IMAGE=frappe/erpnext:v15.63.0 .

ARG ERP_RUNTIME_IMAGE=frappe/erpnext:v15

FROM node:20-bookworm AS builder
WORKDIR /build

COPY packages/erp-utils/package.json packages/erp-utils/tsconfig.json ./packages/erp-utils/
COPY packages/erp-utils/site-config.ts ./packages/erp-utils/
WORKDIR /build/packages/erp-utils
RUN npm install && npm run build

WORKDIR /build/erp-execution-service
COPY erp-execution-service/package.json erp-execution-service/package-lock.json ./
RUN npm ci
COPY erp-execution-service/tsconfig.json ./
COPY erp-execution-service/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm AS nodebinary

FROM ${ERP_RUNTIME_IMAGE}

USER root

RUN install -d -o frappe -g frappe /opt/erp-execution-service

COPY --from=nodebinary /usr/local/bin/node /usr/local/bin/node

COPY --from=builder --chown=frappe:frappe /build/erp-execution-service/package.json /build/erp-execution-service/package-lock.json /opt/erp-execution-service/
COPY --from=builder --chown=frappe:frappe /build/erp-execution-service/node_modules /opt/erp-execution-service/node_modules
COPY --from=builder --chown=frappe:frappe /build/erp-execution-service/dist /opt/erp-execution-service/dist

USER frappe
WORKDIR /home/frappe/frappe-bench

ENV NODE_ENV=production
ENV PORT=8790

EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8790)+'/internal/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "/opt/erp-execution-service/dist/server.js"]
