# Build from repository root: docker build -f provisioning-agent/Dockerfile .

FROM node:20-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS builder

COPY packages/erp-utils/package.json packages/erp-utils/tsconfig.json ./packages/erp-utils/
COPY packages/erp-utils/site-config.ts ./packages/erp-utils/
WORKDIR /app/packages/erp-utils
RUN npm install && npm run build

WORKDIR /app/provisioning-agent
COPY provisioning-agent/package.json provisioning-agent/package-lock.json ./
RUN npm ci
COPY provisioning-agent/tsconfig.json ./
COPY provisioning-agent/src ./src
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/packages/erp-utils /app/packages/erp-utils

WORKDIR /app/provisioning-agent
COPY provisioning-agent/package.json provisioning-agent/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/provisioning-agent/dist ./dist

EXPOSE 8080
CMD ["node", "dist/server.js"]
