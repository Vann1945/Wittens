# wittens api

Express + TypeScript service that validates TikTok links, resolves them through a provider and streams the files.

```sh
pnpm dev      # tsx watch on :3000
pnpm test     # node:test suite against fakes, no network
pnpm build    # tsc -> dist/
pnpm start    # node dist/wittens.js
```

- endpoints and error codes: [docs/api.md](../docs/api.md)
- architecture and security model: [docs/architecture.md](../docs/architecture.md)
- environment variables: [docs/env-variables.md](../docs/env-variables.md)

Copy `.env.example` to `.env` for local settings.
