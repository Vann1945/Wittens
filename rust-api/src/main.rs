use axum::{
    body::Body,
    extract::{ConnectInfo, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::TryStreamExt;
use rand::{distributions::Alphanumeric, Rng};
use regex::Regex;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    env,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use tower_http::services::ServeDir;
use tracing::{error, info};

const VERSION: &str = "1.0.0-rust";
const INVALID_LINK: &str =
    "Enter a valid TikTok link (tiktok.com, vm.tiktok.com, or vt.tiktok.com).";

#[derive(Clone)]
struct Config {
    port: u16,
    host: String,
    web_dist_path: Option<String>,
    cors_origin: Option<String>,
    rate_limit_max: usize,
    tunnel_rate_limit_max: usize,
    rate_limit_window: Duration,
    tunnel_ttl: Duration,
    tunnel_max_entries: usize,
    upstream_timeout: Duration,
    provider_api_url: String,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let int = |key: &str, default: u64, min: u64, max: u64| -> Result<u64, String> {
            match env::var(key) {
                Ok(v) if !v.trim().is_empty() => v
                    .parse::<u64>()
                    .ok()
                    .filter(|n| *n >= min && *n <= max)
                    .ok_or_else(|| format!("{key} must be an integer between {min} and {max}")),
                _ => Ok(default),
            }
        };
        let provider =
            env::var("PROVIDER_API_URL").unwrap_or_else(|_| "https://www.tikwm.com/api/".into());
        Url::parse(&provider).map_err(|_| "PROVIDER_API_URL must be a valid URL".to_string())?;
        Ok(Self {
            port: int("API_PORT", 3000, 1, 65535)? as u16,
            host: env::var("API_LISTEN_ADDRESS").unwrap_or_else(|_| "0.0.0.0".into()),
            web_dist_path: env::var("WEB_DIST_PATH")
                .ok()
                .filter(|v| !v.trim().is_empty()),
            cors_origin: env::var("CORS_ORIGIN")
                .ok()
                .filter(|v| !v.trim().is_empty()),
            rate_limit_max: int("RATELIMIT_MAX", 20, 1, 10000)? as usize,
            tunnel_rate_limit_max: int("TUNNEL_RATELIMIT_MAX", 120, 1, 100000)? as usize,
            rate_limit_window: Duration::from_secs(int("RATELIMIT_WINDOW", 60, 1, 86400)?),
            tunnel_ttl: Duration::from_secs(int("TUNNEL_LIFESPAN", 900, 10, 86400)?),
            tunnel_max_entries: int("TUNNEL_MAX_ENTRIES", 500, 1, 100000)? as usize,
            upstream_timeout: Duration::from_secs(int("UPSTREAM_TIMEOUT", 14, 1, 120)?),
            provider_api_url: provider,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
struct ApiErrorBody {
    status: &'static str,
    error: ErrorInfo,
}
#[derive(Debug, Clone, Serialize)]
struct ErrorInfo {
    code: &'static str,
    message: String,
}

fn api_error(status: StatusCode, code: &'static str, message: impl Into<String>) -> Response {
    (
        status,
        Json(ApiErrorBody {
            status: "error",
            error: ErrorInfo {
                code,
                message: message.into(),
            },
        }),
    )
        .into_response()
}

#[derive(Clone, Debug)]
struct Asset {
    url: String,
    size_bytes: Option<u64>,
}
#[derive(Clone, Debug)]
struct ProviderResult {
    id: String,
    title: String,
    author_name: String,
    author_handle: String,
    duration: f64,
    like_count: Option<f64>,
    view_count: Option<f64>,
    cover: Option<Asset>,
    hd: Option<Asset>,
    sd: Option<Asset>,
    audio: Option<Asset>,
}
#[derive(Serialize)]
struct ResolvedVideo {
    id: String,
    #[serde(rename = "sourceUrl")]
    source_url: String,
    title: String,
    #[serde(rename = "authorName")]
    author_name: String,
    #[serde(rename = "authorHandle")]
    author_handle: String,
    duration: f64,
    #[serde(rename = "likeCount")]
    like_count: Option<f64>,
    #[serde(rename = "viewCount")]
    view_count: Option<f64>,
    #[serde(rename = "coverUrl")]
    cover_url: Option<String>,
    #[serde(rename = "previewUrl")]
    preview_url: Option<String>,
    downloads: Downloads,
}
#[derive(Serialize)]
struct Downloads {
    hd: Option<Download>,
    sd: Option<Download>,
    audio: Option<AudioDownload>,
}
#[derive(Serialize)]
struct Download {
    url: String,
    #[serde(rename = "sizeBytes")]
    size_bytes: Option<u64>,
}
#[derive(Serialize)]
struct AudioDownload {
    url: String,
}

#[derive(Clone, Debug)]
struct TunnelEntry {
    url: String,
    filename: String,
    content_type: &'static str,
    expires_at: Instant,
}
struct TunnelStore {
    entries: HashMap<String, TunnelEntry>,
    order: VecDeque<String>,
    ttl: Duration,
    max: usize,
}
impl TunnelStore {
    fn new(ttl: Duration, max: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            ttl,
            max,
        }
    }
    fn sweep(&mut self) {
        let now = Instant::now();
        self.entries.retain(|_, v| v.expires_at > now);
        self.order.retain(|k| self.entries.contains_key(k));
    }
    fn create(&mut self, url: String, filename: String, content_type: &'static str) -> String {
        self.sweep();
        while self.entries.len() >= self.max {
            if let Some(old) = self.order.pop_front() {
                self.entries.remove(&old);
            } else {
                break;
            }
        }
        let token: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(24)
            .map(char::from)
            .collect();
        self.entries.insert(
            token.clone(),
            TunnelEntry {
                url,
                filename,
                content_type,
                expires_at: Instant::now() + self.ttl,
            },
        );
        self.order.push_back(token.clone());
        token
    }
    fn get(&mut self, token: &str) -> Option<TunnelEntry> {
        if token.len() != 24
            || !token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return None;
        }
        self.sweep();
        self.entries.get(token).cloned()
    }
}

struct RateLimiter {
    hits: Mutex<HashMap<String, (Instant, usize)>>,
    limit: usize,
    window: Duration,
}
impl RateLimiter {
    fn new(limit: usize, window: Duration) -> Self {
        Self {
            hits: Mutex::new(HashMap::new()),
            limit,
            window,
        }
    }
    async fn allow(&self, key: &str) -> bool {
        let mut hits = self.hits.lock().await;
        let now = Instant::now();
        let entry = hits.entry(key.to_string()).or_insert((now, 0));
        if now.duration_since(entry.0) >= self.window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= self.limit
    }
}

struct AppState {
    config: Config,
    client: Client,
    tunnels: Mutex<TunnelStore>,
    resolve_limiter: RateLimiter,
    tunnel_limiter: RateLimiter,
}

#[derive(Deserialize)]
struct ResolveRequest {
    url: Option<String>,
}
#[derive(Serialize)]
struct ResolveResponse {
    status: &'static str,
    video: ResolvedVideo,
}

fn extract_url(raw: &str) -> Option<String> {
    let re = Regex::new(r#"https?://(?:[a-zA-Z0-9-]+\.)*tiktok\.com/[^\s<>"')]+"#).unwrap();
    re.find(raw).map(|m| {
        m.as_str()
            .trim_end_matches(&[',', '.', '!', '?', ';', ':'][..])
            .to_string()
    })
}
fn parse_link(raw: &str) -> Option<Url> {
    let candidate = raw.trim();
    if candidate.is_empty() || candidate.len() > 2048 {
        return None;
    }
    let url = Url::parse(extract_url(candidate).as_deref().unwrap_or(candidate)).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    if !matches!(url.scheme(), "http" | "https")
        || url.username() != ""
        || url.password().is_some()
        || !url.port().map(|p| p == 80 || p == 443).unwrap_or(true)
        || !(host == "tiktok.com" || host.ends_with(".tiktok.com"))
    {
        return None;
    }
    let mut normalized = url;
    normalized.set_scheme("https").ok()?;
    normalized.set_port(None).ok()?;
    normalized.set_fragment(None);
    Some(normalized)
}
fn safe_filename(name: &str, ext: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!(
        "{}.{}",
        clean.trim_matches('_').chars().take(96).collect::<String>(),
        ext
    )
}
fn public_address(ip: &str) -> bool {
    let Ok(addr) = ip.parse::<IpAddr>() else {
        return false;
    };
    match addr {
        IpAddr::V4(v) => {
            !(v.is_private()
                || v.is_loopback()
                || v.is_link_local()
                || v.is_multicast()
                || v.is_broadcast()
                || v.octets()[0] == 0
                || v.octets()[0] == 100 && (64..=127).contains(&v.octets()[1]))
        }
        IpAddr::V6(v) => {
            !(v.is_loopback()
                || v.is_unspecified()
                || v.is_multicast()
                || v.segments()[0] & 0xfe00 == 0xfc00
                || v.segments()[0] & 0xffc0 == 0xfe80)
        }
    }
}
fn assert_safe_media_url(url: &Url) -> Result<(), ()> {
    if !matches!(url.scheme(), "http" | "https")
        || url.username() != ""
        || url.password().is_some()
        || !url.port().map(|p| p == 80 || p == 443).unwrap_or(true)
    {
        return Err(());
    }
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_matches(&['[', ']'][..])
        .to_ascii_lowercase();
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".internal")
        || host
            .parse::<IpAddr>()
            .map(|ip| !public_address(&ip.to_string()))
            .unwrap_or(false)
    {
        return Err(());
    }
    Ok(())
}

#[derive(Deserialize)]
struct TikWmPayload {
    code: Option<i32>,
    msg: Option<String>,
    data: Option<TikWmData>,
}
#[derive(Deserialize)]
struct TikWmData {
    id: Option<String>,
    title: Option<String>,
    cover: Option<String>,
    duration: Option<f64>,
    play: Option<String>,
    hdplay: Option<String>,
    music: Option<String>,
    size: Option<u64>,
    hd_size: Option<u64>,
    digg_count: Option<f64>,
    play_count: Option<f64>,
    author: Option<TikWmAuthor>,
}
#[derive(Deserialize)]
struct TikWmAuthor {
    unique_id: Option<String>,
    nickname: Option<String>,
}
fn asset(value: Option<String>, origin: &str, size: Option<u64>) -> Option<Asset> {
    let value = value?.trim().to_string();
    if value.is_empty() {
        return None;
    }
    let url = if value.starts_with("http://") || value.starts_with("https://") {
        value
    } else if value.starts_with('/') {
        format!("{origin}{value}")
    } else {
        return None;
    };
    Some(Asset {
        url,
        size_bytes: size,
    })
}
async fn resolve_provider(state: &AppState, url: &Url) -> Result<ProviderResult, Response> {
    let endpoint = Url::parse(&state.config.provider_api_url).map_err(|_| {
        api_error(
            StatusCode::BAD_GATEWAY,
            "error.provider.unreachable",
            "Unable to fetch that video right now.",
        )
    })?;
    let origin = endpoint.origin().ascii_serialization();
    let response = state.client.post(endpoint).form(&[("url", url.as_str()), ("hd", "1")]).header("Accept", "application/json").send().await.map_err(|e| if e.is_timeout() { api_error(StatusCode::GATEWAY_TIMEOUT, "error.provider.timeout", "The request timed out. Check the link and try again.") } else { api_error(StatusCode::BAD_GATEWAY, "error.provider.unreachable", "Unable to fetch that video right now. Verify the link is public and try again.") })?;
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        return Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "error.provider.rate_limited",
            "The video resolver is busy. Try again in a few seconds.",
        ));
    }
    if !response.status().is_success() {
        return Err(api_error(
            StatusCode::BAD_GATEWAY,
            "error.provider.unreachable",
            "Unable to fetch that video right now. Verify the link is public and try again.",
        ));
    }
    let payload: TikWmPayload = response.json().await.map_err(|_| {
        api_error(
            StatusCode::BAD_GATEWAY,
            "error.provider.unreachable",
            "The resolver returned an invalid response.",
        )
    })?;
    if payload.code != Some(0) || payload.data.is_none() {
        if payload
            .msg
            .as_deref()
            .unwrap_or("")
            .to_ascii_lowercase()
            .contains("limit")
        {
            return Err(api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "error.provider.rate_limited",
                "The video resolver is busy. Try again in a few seconds.",
            ));
        }
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "error.video.not_found",
            payload.msg.unwrap_or_else(|| {
                "Video not found. Make sure the TikTok video is public.".to_string()
            }),
        ));
    }
    let d = payload.data.unwrap();
    let handle = d
        .author
        .as_ref()
        .and_then(|a| a.unique_id.clone())
        .unwrap_or_else(|| "tiktok".into());
    let hd = asset(d.hdplay, &origin, d.hd_size);
    let sd = asset(d.play, &origin, d.size);
    if hd.is_none() && sd.is_none() {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "error.video.no_stream",
            "No downloadable video stream was found for this link.",
        ));
    }
    Ok(ProviderResult {
        id: d.id.unwrap_or_else(|| format!("{}", chrono_like_now())),
        title: d
            .title
            .unwrap_or_default()
            .trim()
            .to_string()
            .chars()
            .collect::<String>()
            .into(),
        author_name: d
            .author
            .as_ref()
            .and_then(|a| a.nickname.clone())
            .unwrap_or_else(|| handle.clone()),
        author_handle: if handle.starts_with('@') {
            handle
        } else {
            format!("@{handle}")
        },
        duration: d.duration.unwrap_or(0.0),
        like_count: d.digg_count,
        view_count: d.play_count,
        cover: asset(d.cover, &origin, None),
        hd,
        sd,
        audio: asset(d.music, &origin, None),
    })
}
fn chrono_like_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

async fn resolve(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<ResolveRequest>,
) -> Response {
    let key = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .unwrap_or_else(|| addr.ip().to_string());
    if !state.resolve_limiter.allow(&key).await {
        return api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "error.rate_exceeded",
            "Too many requests. Wait a moment and try again.",
        );
    }
    let Some(raw) = body.url else {
        return api_error(
            StatusCode::BAD_REQUEST,
            "error.request.invalid",
            "The request body is not valid.",
        );
    };
    let Some(link) = parse_link(&raw) else {
        return api_error(StatusCode::BAD_REQUEST, "error.link.invalid", INVALID_LINK);
    };
    let result = match resolve_provider(&state, &link).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let base = format!(
        "{}_{}",
        result.author_handle.trim_start_matches('@'),
        result.id
    );
    let mut tunnels = state.tunnels.lock().await;
    let register =
        |t: &mut TunnelStore, a: &Option<Asset>, name: String, ext: &str, ct: &'static str| {
            a.as_ref()
                .map(|x| t.create(x.url.clone(), safe_filename(&name, ext), ct))
        };
    let hd = register(
        &mut tunnels,
        &result.hd,
        format!("{base}_hd"),
        "mp4",
        "video/mp4",
    );
    let sd = register(&mut tunnels, &result.sd, base.clone(), "mp4", "video/mp4");
    let audio = register(
        &mut tunnels,
        &result.audio,
        base.clone(),
        "mp3",
        "audio/mpeg",
    );
    let cover = register(
        &mut tunnels,
        &result.cover,
        format!("{base}_cover"),
        "jpg",
        "image/jpeg",
    );
    let stream_url = |token: &Option<String>| token.as_ref().map(|t| format!("/api/stream/{t}"));
    let tunnel_url = |token: &Option<String>| token.as_ref().map(|t| format!("/api/tunnel/{t}"));
    let video = ResolvedVideo {
        id: result.id,
        source_url: link.to_string(),
        title: if result.title.is_empty() {
            "TikTok Video".into()
        } else {
            result.title
        },
        author_name: result.author_name,
        author_handle: result.author_handle,
        duration: result.duration,
        like_count: result.like_count,
        view_count: result.view_count,
        cover_url: stream_url(&cover),
        preview_url: stream_url(&hd).or_else(|| stream_url(&sd)),
        downloads: Downloads {
            hd: tunnel_url(&hd).map(|url| Download {
                url,
                size_bytes: result.hd.as_ref().and_then(|a| a.size_bytes),
            }),
            sd: tunnel_url(&sd).map(|url| Download {
                url,
                size_bytes: result.sd.as_ref().and_then(|a| a.size_bytes),
            }),
            audio: tunnel_url(&audio).map(|url| AudioDownload { url }),
        },
    };
    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, "no-store")],
        Json(ResolveResponse {
            status: "ok",
            video,
        }),
    )
        .into_response()
}

async fn instance(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(
        serde_json::json!({ "wittens": { "version": VERSION, "provider": "tikwm", "tunnelLifespan": state.config.tunnel_ttl.as_secs(), "services": ["tiktok"] } }),
    )
}
async fn tunnel(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
    headers: HeaderMap,
    attachment: bool,
) -> Response {
    let key = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");
    if !state.tunnel_limiter.allow(key).await {
        return api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "error.rate_exceeded",
            "Too many requests. Wait a moment and try again.",
        );
    }
    let entry = state.tunnels.lock().await.get(&token);
    let Some(entry) = entry else {
        return if attachment {
            api_error(
                StatusCode::NOT_FOUND,
                "error.tunnel.expired",
                "Download link expired. Paste the TikTok link again.",
            )
        } else {
            StatusCode::NOT_FOUND.into_response()
        };
    };
    let Ok(media_url) = Url::parse(&entry.url) else {
        return if attachment {
            api_error(
                StatusCode::BAD_GATEWAY,
                "error.tunnel.failed",
                "Download stream interrupted. Please try again.",
            )
        } else {
            StatusCode::BAD_GATEWAY.into_response()
        };
    };
    if assert_safe_media_url(&media_url).is_err() {
        return if attachment {
            api_error(
                StatusCode::BAD_GATEWAY,
                "error.tunnel.failed",
                "Download stream interrupted. Please try again.",
            )
        } else {
            StatusCode::BAD_GATEWAY.into_response()
        };
    }
    let mut request = state.client.get(&entry.url);
    if !attachment {
        if let Some(range) = headers.get(header::RANGE) {
            request = request.header(header::RANGE, range);
        }
    }
    let upstream = match request.timeout(state.config.upstream_timeout).send().await {
        Ok(r) => r,
        Err(_) => {
            return if attachment {
                api_error(
                    StatusCode::BAD_GATEWAY,
                    "error.tunnel.failed",
                    "Download stream interrupted. Please try again.",
                )
            } else {
                StatusCode::BAD_GATEWAY.into_response()
            }
        }
    };
    let status = upstream.status();
    let acceptable = status == StatusCode::OK
        || (!attachment
            && (status == StatusCode::PARTIAL_CONTENT
                || status == StatusCode::RANGE_NOT_SATISFIABLE));
    if !acceptable {
        return if attachment {
            api_error(
                StatusCode::BAD_GATEWAY,
                "error.tunnel.failed",
                "Download stream interrupted. Please try again.",
            )
        } else {
            StatusCode::BAD_GATEWAY.into_response()
        };
    }
    let content_length = upstream.headers().get(header::CONTENT_LENGTH).cloned();
    let content_range = upstream.headers().get(header::CONTENT_RANGE).cloned();
    let mut response = Response::new(Body::from_stream(
        upstream
            .bytes_stream()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)),
    ));
    *response.status_mut() = status;
    let h = response.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(entry.content_type),
    );
    h.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    if let Some(v) = content_length {
        h.insert(header::CONTENT_LENGTH, v);
    }
    if attachment {
        h.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, no-store"),
        );
        let value = format!("attachment; filename=\"{}\"", entry.filename);
        if let Ok(v) = HeaderValue::from_str(&value) {
            h.insert(header::CONTENT_DISPOSITION, v);
        }
    } else {
        h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        if let Some(v) = content_range {
            h.insert(header::CONTENT_RANGE, v);
        }
        h.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, max-age=300"),
        );
    }
    response
}

async fn stream(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> Response {
    tunnel(State(state), Path(token), headers, false).await
}
async fn download(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> Response {
    tunnel(State(state), Path(token), headers, true).await
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt().with_env_filter("info").init();
    let config = Config::from_env().unwrap_or_else(|e| {
        eprintln!("invalid configuration: {e}");
        std::process::exit(1);
    });
    let client = Client::builder()
        .user_agent(format!("Mozilla/5.0 (compatible; Wittens/{VERSION})"))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("http client");
    let state = Arc::new(AppState {
        resolve_limiter: RateLimiter::new(config.rate_limit_max, config.rate_limit_window),
        tunnel_limiter: RateLimiter::new(config.tunnel_rate_limit_max, config.rate_limit_window),
        tunnels: Mutex::new(TunnelStore::new(
            config.tunnel_ttl,
            config.tunnel_max_entries,
        )),
        client,
        config: config.clone(),
    });
    let mut app = Router::new()
        .route("/api", get(instance))
        .route("/api/resolve", post(resolve))
        .route("/api/stream/:token", get(stream))
        .route("/api/tunnel/:token", get(download))
        .with_state(state);
    if let Some(path) = config.web_dist_path {
        app = app.fallback_service(ServeDir::new(PathBuf::from(path)));
    }
    let listener = tokio::net::TcpListener::bind(format!("{}:{}", config.host, config.port))
        .await
        .expect("bind listener");
    info!(
        "wittens Rust API {VERSION} listening on http://{}:{}",
        config.host, config.port
    );
    if let Err(e) = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    {
        error!("server error: {e}");
    }
}
