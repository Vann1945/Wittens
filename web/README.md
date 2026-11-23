# wittens web

The single-page app: React 19, Vite, Tailwind CSS v4.

```sh
pnpm dev      # vite on :5173, proxies /api to http://127.0.0.1:3000
pnpm build    # type-check + production build into dist/
```

Start the api too (`pnpm dev` at the repository root runs both). Set `WEB_DEV_API_TARGET` if your api runs elsewhere.

The api client lives in `src/lib/api.ts`. The response types in `src/types.ts` must match [docs/api.md](../docs/api.md).
