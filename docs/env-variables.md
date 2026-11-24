# environment variables

All variables are optional. The api reads them from the process environment, and from an `.env` file if one exists (`api/.env`, or the path in `API_ENV_FILE`). Real environment variables always win over the file. Invalid values stop the api at startup with a clear message.

### general
| name | default | description |
| :-- | :-- | :-- |
| `API_PORT` | `3000` | port to listen on |
| `API_LISTEN_ADDRESS` | `0.0.0.0` | interface to bind to. use `127.0.0.1` behind a local reverse proxy |
| `API_ENV_FILE` | | path of the `.env` file to load |
| `WEB_DIST_PATH` | | path of a built web app (`web/dist`). when set, the api also serves it. the Docker image sets this for you |
| `PROVIDER_API_URL` | `https://www.tikwm.com/api/` | endpoint of the upstream resolver |

### networking and security
| name | default | description |
| :-- | :-- | :-- |
| `CORS_ORIGIN` | | `*` or one origin that may call the api from a browser. unset means same-origin only |
| `TRUST_PROXY` | `0` | number of reverse proxies in front of wittens. **set this to `1` behind nginx/caddy/traefik**, otherwise every visitor shares one rate-limit bucket |

### limits
| name | default | description |
| :-- | :-- | :-- |
| `RATELIMIT_WINDOW` | `60` | rate-limit window in seconds |
| `RATELIMIT_MAX` | `20` | `POST /api/resolve` requests per client per window |
| `TUNNEL_RATELIMIT_MAX` | `120` | stream and download requests per client per window |
| `TUNNEL_LIFESPAN` | `900` | seconds a resolved link stays valid |
| `TUNNEL_MAX_ENTRIES` | `500` | max live links kept in memory (oldest are dropped first) |
| `UPSTREAM_TIMEOUT` | `14` | seconds to wait for the provider and for upstream media headers |

### web (build / dev time)
| name | default | description |
| :-- | :-- | :-- |
| `WEB_DEV_API_TARGET` | `http://127.0.0.1:3000` | where `pnpm dev:web` proxies `/api` to |
