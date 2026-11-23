FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---- build: install, build web + api, prune api to production deps ----
FROM base AS build
WORKDIR /app
COPY . /app

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

RUN pnpm build
RUN pnpm --filter @wittens/api deploy --legacy --prod /prod/api

# ---- runtime: one small image that serves the api and the built web app ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    API_PORT=3000 \
    API_LISTEN_ADDRESS=0.0.0.0 \
    WEB_DIST_PATH=/app/web
WORKDIR /app

COPY --from=build --chown=node:node /prod/api /app
COPY --from=build --chown=node:node /app/web/dist /app/web

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${API_PORT}/api" > /dev/null || exit 1

CMD ["node", "dist/wittens.js"]
