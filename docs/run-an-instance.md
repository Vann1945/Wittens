# how to run a wittens instance

## with docker compose (recommended)

1. get the source and go into the folder.
2. copy the example compose file to the project root:
   ```sh
   cp docs/examples/docker-compose.example.yml docker-compose.yml
   ```
3. start it:
   ```sh
   docker compose up -d --build
   ```
4. open `http://localhost:3000`.

The image contains the api and the built web app in one container, runs as a non-root user and has a health check on `GET /api`.

### behind a reverse proxy
Put nginx, caddy or traefik in front for TLS, and **set `TRUST_PROXY=1`** so rate limits are applied per visitor instead of per proxy. Example for caddy:

```
wittens.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Downloads are streamed, so disable response buffering for `/api/` if your proxy buffers by default (`proxy_buffering off;` in nginx).

## without docker

Requirements: node.js 20.11 or newer, [pnpm](https://pnpm.io) 10.

```sh
pnpm install
pnpm build
WEB_DIST_PATH=web/dist pnpm start
```

## before you make it public

- Read the terms of the upstream provider (TikWM by default) and decide whether a public instance is OK for you.
- Keep the rate limits. Raising them mostly raises the chance that the provider throttles you.
- wittens keeps state in memory, so run **one** instance. Restarting it invalidates links that are open in browsers.
- You are responsible for how your instance is used. See the ethics section of the [README](../README.md#ethics).

See [env-variables.md](env-variables.md) for every setting.
