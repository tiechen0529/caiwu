# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app ./app
COPY lib ./lib
COPY deploy ./deploy
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data WEB_DIR=/app/web
WORKDIR /app
LABEL org.opencontainers.image.title="清账 · 凭证与财务三表" \
      org.opencontainers.image.source="https://github.com/tiechen0529/caiwu"
COPY --from=build /app/web ./web
COPY lib/ledger.ts ./lib/ledger.ts
COPY deploy/server.mjs deploy/backup.mjs deploy/read-password.mjs ./deploy/
COPY package.json ./package.json
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deploy/server.mjs"]
