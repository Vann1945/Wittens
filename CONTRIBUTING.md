# contributing to wittens

Thanks for helping. This guide keeps changes easy to review and the project easy to trust.

## what is in scope

wittens only helps people save **freely accessible, public** content. These will not be reviewed or merged:

- downloading private, paid or login-protected content
- bypassing DRM or access controls
- scraping unrelated data and exposing it outside of file metadata
- analytics, trackers, ads or anything that logs links or media urls

If you are unsure, open an issue and ask before writing code.

## getting set up

You need node.js 20.11+ and pnpm 10.

```sh
pnpm install
pnpm dev          # api :3000 + web :5173
pnpm check        # lint + test + build, run this before you push
```

Where things live:

| you want to change | look in |
| :-- | :-- |
| link validation | `api/src/processing/url.ts` |
| how a post is resolved | `api/src/processing/providers/` |
| the public response | `api/src/processing/match.ts`, `types.ts` and `web/src/types.ts` |
| streaming and downloads | `api/src/stream/` |
| rate limits, headers, routes | `api/src/core/api.ts` |
| the ui | `web/src/` |

Read [docs/architecture.md](docs/architecture.md) once, it takes five minutes.

## code guidelines

- TypeScript is `strict`. No `any` in `src/`.
- `processing/` must stay free of HTTP concepts. `core/` must stay free of provider details.
- Expected failures throw `ApiError` with a stable `error.*` code and a message a human can act on. Never leak internals in a response.
- **Never log links, media urls or request bodies.**
- Anything that fetches a url from outside goes through the guarded fetcher.
- UI changes keep keyboard access, visible focus, `prefers-reduced-motion` and dark-only styling intact.

## tests

Behavior changes come with tests. The api suite runs the real Express app against fakes, with no network:

```sh
pnpm --filter @wittens/api test
```

A bug fix should include a test that fails without the fix.

## documentation

If you change the api, an environment variable or the flow, update `docs/` in the same pull request. The response type lives in two places (`api/src/processing/types.ts` and `web/src/types.ts`), change both.

## commits and pull requests

Commit titles follow `<scope>: <what changed>`, for example `api/stream: abort upstream when the client disconnects` or `web: keep focus on the input after an error`. Explain the *why* in the body when it isn't obvious.

Keep pull requests small and focused, rebase instead of merging `main` into your branch, and fill in the pull request template.

## adding a provider

Follow the steps in [docs/architecture.md](docs/architecture.md#adding-or-replacing-a-provider). Providers must only use publicly available endpoints and must not require credentials.

## license

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
