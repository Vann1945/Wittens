# wittens Rust API

This crate is the Rust replacement for the original `api/` TypeScript service. It keeps the public HTTP contract:

- `GET /api`
- `POST /api/resolve` with `{ "url": "..." }`
- `GET /api/stream/:token` for seekable previews
- `GET /api/tunnel/:token` for downloads

The existing React/Vite frontend in `web/` can be built and served by setting `WEB_DIST_PATH=../web/dist`.

## Run locally

```sh
cp ../api/.env.example .env # optional
cargo run
```

For a production binary:

```sh
cargo build --release
WEB_DIST_PATH=../web/dist ./target/release/wittens-api
```

Configuration uses the same environment variable names as the TypeScript service, including `API_PORT`, `API_LISTEN_ADDRESS`, `RATELIMIT_MAX`, `TUNNEL_LIFESPAN`, `UPSTREAM_TIMEOUT`, and `PROVIDER_API_URL`.

The implementation uses Axum and Tokio, Reqwest with rustls, an in-memory TTL tunnel store, request rate limiting, strict TikTok URL validation, and SSRF checks for media URLs. The third-party TikWM resolver remains isolated behind the provider request in `src/main.rs`.
