FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN pnpm install --frozen-lockfile

COPY api api
COPY web web
COPY assets assets
COPY public public
COPY README.md LICENSE metadata.json ./
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=3000
ENV API_LISTEN_ADDRESS=0.0.0.0

RUN groupadd --system --gid 1001 wittens && useradd --system --uid 1001 --gid 1001 wittens
COPY --from=build --chown=wittens:wittens /app/node_modules ./node_modules
COPY --from=build --chown=wittens:wittens /app/api/package.json ./api/package.json
COPY --from=build --chown=wittens:wittens /app/api/dist ./api/dist
COPY --from=build --chown=wittens:wittens /app/web/dist ./web/dist
COPY --from=build --chown=wittens:wittens /app/package.json ./package.json

USER wittens
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "api/dist/wittens.js"]
