# wittens api

Base path: `/api`. All bodies are JSON. The web app is the reference client.

Every error looks the same:

```json
{ "status": "error", "error": { "code": "error.link.invalid", "message": "Enter a valid TikTok link ..." } }
```

Match on `error.code`, not on the message.

## `GET /api`

Instance info. Also used as the Docker health check.

```json
{ "wittens": { "version": "1.0.0", "provider": "tikwm", "tunnelLifespan": 900, "services": ["tiktok"] } }
```

## `POST /api/resolve`

Request (`Content-Type: application/json`):

```json
{ "url": "https://vm.tiktok.com/ZMxxxxxxx/" }
```

`url` may also be a pasted share message that contains a TikTok link.

Response `200`:

```json
{
  "status": "ok",
  "video": {
    "id": "7300000000000000001",
    "sourceUrl": "https://vm.tiktok.com/ZMxxxxxxx/",
    "title": "caption text #hashtag",
    "authorName": "Some Author",
    "authorHandle": "@someauthor",
    "duration": 12,
    "likeCount": 1200,
    "viewCount": 45000,
    "coverUrl": "/api/stream/<token>",
    "previewUrl": "/api/stream/<token>",
    "downloads": {
      "hd":    { "url": "/api/tunnel/<token>", "sizeBytes": 2048000 },
      "sd":    { "url": "/api/tunnel/<token>", "sizeBytes": 1024000 },
      "audio": { "url": "/api/tunnel/<token>" }
    }
  }
}
```

- `hd`, `sd`, `audio`, `coverUrl` and `previewUrl` can be `null` when the provider didn't return them. At least one of `hd` / `sd` is always present.
- `likeCount`, `viewCount` and `sizeBytes` are `null` when unknown.
- All urls are relative to the api and **expire** after `TUNNEL_LIFESPAN` seconds (15 minutes by default). Resolve again to get fresh ones.

## `GET /api/stream/:token`

Streams the file inline. Supports `Range`, so it can back a `<video>` element. Returns `404` with an empty body when the token is unknown or expired, and `502` when the upstream fails.

## `GET /api/tunnel/:token`

Streams the file as a download (`Content-Disposition: attachment`). Unknown or expired tokens return the JSON error `error.tunnel.expired`.

## error codes

| code | status | meaning |
| :-- | :-: | :-- |
| `error.request.invalid` | 400 | body is not valid JSON, `url` is missing or not a string |
| `error.request.content_type` | 415 | request was not `application/json` |
| `error.link.invalid` | 400 | not a TikTok link |
| `error.video.not_found` | 404 | the provider can't find the video (private, deleted, bad link) |
| `error.video.no_stream` | 404 | the provider found the post but no downloadable video |
| `error.provider.unreachable` | 502 | the provider failed or sent an unusable answer |
| `error.provider.rate_limited` | 503 | the provider is throttling us, retry in a few seconds |
| `error.provider.timeout` | 504 | the provider didn't answer in `UPSTREAM_TIMEOUT` seconds |
| `error.rate_exceeded` | 429 | too many requests from this client |
| `error.tunnel.expired` | 404 | download link unknown or expired |
| `error.tunnel.failed` | 502 | the media cdn failed while streaming |
| `error.not_found` | 404 | unknown api route |
| `error.internal` | 500 | unexpected error (details are only in the server log) |

Rate limit state is exposed in the standard `RateLimit` and `RateLimit-Policy` response headers.

## keeping the contract in sync

The response shape is defined twice, on purpose, so the two packages stay independently buildable:

- `backend/src/processing/types.ts` (`ResolvedVideo`)
- `web/src/types.ts` (`ResolvedVideo`, `ResolveResponse`)

Change both, `backend/test/api.test.ts`, and this document together.
