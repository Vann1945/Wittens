# Rust conversion

The TypeScript/Express API has been ported to `rust-api/` using Axum, Tokio, and Reqwest. The React/Vite client remains in `web/` and is served by the Rust process when `WEB_DIST_PATH` points to its build output.

## Development

```sh
cd web && pnpm install && pnpm build
cd ../rust-api
WEB_DIST_PATH=../web/dist cargo run
```

The server keeps the original API contract and environment variable names. `cargo check` and an optimized `cargo build --release` pass successfully.

## Docker

Use the existing frontend build pipeline, then build the Rust crate in a Rust builder image. The runtime image only needs the compiled binary and `web/dist`.
