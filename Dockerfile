FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY index.html tsconfig.json vite.config.ts server.ts ./
COPY public ./public
COPY src ./src
COPY server ./server
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=3000
ENV API_LISTEN_ADDRESS=0.0.0.0

RUN groupadd --system --gid 1001 wittens && useradd --system --uid 1001 --gid 1001 wittens
COPY --from=build --chown=wittens:wittens /app/node_modules ./node_modules
COPY --from=build --chown=wittens:wittens /app/package.json ./package.json
COPY --from=build --chown=wittens:wittens /app/server.ts ./server.ts
COPY --from=build --chown=wittens:wittens /app/server ./server
COPY --from=build --chown=wittens:wittens /app/dist ./dist

USER wittens
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.ts"]
