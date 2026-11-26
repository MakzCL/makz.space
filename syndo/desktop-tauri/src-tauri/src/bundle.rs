//! Standalone SEND: the interface ships inside the app.
//!
//! The SEND web interface is built into the app (`dist/app/`) and served from `sendapp://localhost`
//! (`https://sendapp.localhost` on Windows). The app never loads the website. The page keeps calling the server
//! with relative URLs (`/api/...`); this protocol handler passes those calls on to the chosen server:
//! - The session cookie lives here, in the app (saved next to config.json), never in the page. Requests carry it,
//!   responses that set or clear it update it. The page asks for the token only to sign in the live connection.
//! - Big or public downloads (pictures, files, emotes, music) are redirected to the server's own address so they
//!   stream straight from storage instead of passing through the app's memory. Those links are signed or public.
//! - Every other path serves a file from the bundled interface, falling back to `index.html` for app routes.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::http::{Request, Response};
use tauri::{AppHandle, Runtime, UriSchemeResponder};

pub const SCHEME: &str = "sendapp";
/// The bundled interface's origin as the page sees it.
pub const ORIGIN: &str = if cfg!(windows) { "https://sendapp.localhost" } else { "sendapp://localhost" };
/// Session cookie names (current and the old name), the only cookies the app keeps.
const SESSION_COOKIES: [&str; 2] = ["send_session", "syndo_session"];

/// The address a path of the bundled interface opens at in the webview.
pub fn url(path: &str) -> url::Url {
  let p = if path.starts_with('/') { path.to_string() } else { format!("/{path}") };
  url::Url::parse(&format!("{ORIGIN}{p}")).unwrap_or_else(|_| url::Url::parse(&format!("{ORIGIN}/")).unwrap())
}
/// The same, as the webview builder wants it (`sendapp://localhost/...`; Tauri maps it per platform).
pub fn protocol_url(path: &str) -> url::Url {
  let p = if path.starts_with('/') { path.to_string() } else { format!("/{path}") };
  url::Url::parse(&format!("{SCHEME}://localhost{p}")).unwrap_or_else(|_| url::Url::parse(&format!("{SCHEME}://localhost/")).unwrap())
}
pub fn is_bundle(u: &url::Url) -> bool { u.scheme() == SCHEME || u.host_str() == Some("sendapp.localhost") }

/* ---------------------------------------------------------------------------------------------- cookies -- */
struct Jar { path: Option<PathBuf>, cookies: BTreeMap<String, String> }
static JAR: LazyLock<Mutex<Jar>> = LazyLock::new(|| Mutex::new(Jar { path: None, cookies: BTreeMap::new() }));

/// Load the saved session (call once at startup with the app's config folder).
pub fn init(dir: PathBuf) {
  let path = dir.join("session.json");
  let cookies = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
  *JAR.lock().unwrap() = Jar { path: Some(path), cookies };
}
fn save(j: &Jar) {
  if let Some(p) = &j.path {
    if let Some(d) = p.parent() { let _ = std::fs::create_dir_all(d); }
    let _ = std::fs::write(p, serde_json::to_vec(&j.cookies).unwrap_or_default());
  }
}
/// Forget the session (switching servers).
pub fn clear() { let mut j = JAR.lock().unwrap(); j.cookies.clear(); save(&j); }
/// The session token, for signing in the live connection.
pub fn session_token() -> Option<String> {
  let j = JAR.lock().unwrap();
  SESSION_COOKIES.iter().find_map(|n| j.cookies.get(*n).cloned())
}
fn cookie_header() -> Option<String> {
  let j = JAR.lock().unwrap();
  let parts: Vec<String> = j.cookies.iter().map(|(k, v)| format!("{k}={v}")).collect();
  if parts.is_empty() { None } else { Some(parts.join("; ")) }
}
/// Apply one `Set-Cookie` header: keep the value, or drop it when the server clears it.
fn take_cookie(header: &str) {
  let mut segs = header.split(';');
  let Some((name, value)) = segs.next().and_then(|kv| kv.split_once('=')) else { return };
  let (name, value) = (name.trim().to_string(), value.trim().to_string());
  if !SESSION_COOKIES.contains(&name.as_str()) { return; }
  let cleared = value.is_empty() || segs.any(|s| {
    let s = s.trim().to_ascii_lowercase();
    s == "max-age=0" || s.starts_with("max-age=-") || (s.starts_with("expires=") && s.contains("1970"))
  });
  let mut j = JAR.lock().unwrap();
  if cleared { j.cookies.remove(&name); } else { j.cookies.insert(name, value); }
  save(&j);
}

/* ------------------------------------------------------------------------------------------------ proxy -- */
static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| {
  let mut b = ureq::AgentBuilder::new().redirects(0).timeout_connect(Duration::from_secs(15)).timeout_read(Duration::from_secs(300))
    .timeout_write(Duration::from_secs(300)).user_agent(&format!("SEND-desktop/{}", env!("CARGO_PKG_VERSION")));
  if let Ok(tls) = native_tls::TlsConnector::new() { b = b.tls_connector(std::sync::Arc::new(tls)); }
  b.build()
});

/// GETs that stream straight from the server: public or signed, so they need no session, and some are huge.
fn direct(path: &str) -> bool {
  ["/api/media/", "/api/files/read", "/api/emotes/img/", "/api/music/stream/", "/api/downloads/"].iter().any(|p| path.starts_with(p))
}
const PASS_REQUEST: [&str; 8] = ["content-type", "accept", "accept-language", "range", "if-none-match", "if-modified-since", "x-send-client", "x-syndo-client"];
const PASS_RESPONSE: [&str; 10] = ["content-type", "cache-control", "content-range", "accept-ranges", "etag", "last-modified", "content-disposition", "location", "retry-after", "x-content-type-options"];

fn respond_text(r: UriSchemeResponder, status: u16, msg: &str) {
  let body = serde_json::json!({ "code": "desktop", "message": msg }).to_string();
  r.respond(Response::builder().status(status).header("content-type", "application/json").body(body.into_bytes()).unwrap());
}

fn proxy(server: &str, req: Request<Vec<u8>>, r: UriSchemeResponder) {
  let method = req.method().as_str().to_string();
  let pq = req.uri().path_and_query().map(|p| p.as_str().to_string()).unwrap_or_else(|| "/".into());
  let path = req.uri().path().to_string();
  let target = format!("{server}{pq}");
  if (method == "GET" || method == "HEAD") && direct(&path) {
    r.respond(Response::builder().status(307).header("location", &target).header("cache-control", "no-store").body(Vec::new()).unwrap());
    return;
  }
  let mut out = AGENT.request(&method, &target);
  for (k, v) in req.headers() {
    let k = k.as_str().to_ascii_lowercase();
    if PASS_REQUEST.contains(&k.as_str()) { if let Ok(v) = v.to_str() { out = out.set(&k, v); } }
  }
  // The server only accepts cookie-signed writes from its own address; this request comes from the app on the user's behalf.
  out = out.set("origin", server).set("x-send-client", "1");
  if let Some(c) = cookie_header() { out = out.set("cookie", &c); }
  let body = req.body();
  let res = if body.is_empty() && matches!(method.as_str(), "GET" | "HEAD" | "DELETE" | "OPTIONS") { out.call() } else { out.send_bytes(body) };
  let res = match res {
    Ok(res) => res,
    Err(ureq::Error::Status(_, res)) => res,
    Err(e) => { respond_text(r, 502, &format!("SEND couldn't reach the server ({e}). Check your connection.")); return; }
  };
  for c in res.all("set-cookie") { take_cookie(c); }
  let mut b = Response::builder().status(res.status());
  for h in PASS_RESPONSE {
    if let Some(v) = res.header(h) {
      // A redirect to the server's own address stays inside the app.
      let v = if h == "location" && v.starts_with(server) { v[server.len()..].to_string() } else { v.to_string() };
      b = b.header(h, v);
    }
  }
  let mut bytes = Vec::new();
  use std::io::Read;
  if let Err(e) = res.into_reader().take(1 << 30).read_to_end(&mut bytes) { respond_text(r, 502, &format!("The server's answer was cut off ({e})."));  return; }
  r.respond(b.body(bytes).unwrap());
}

/* ----------------------------------------------------------------------------------------------- assets -- */
fn asset<R: Runtime>(app: &AppHandle<R>, path: &str, r: UriSchemeResponder) {
  let clean = path.trim_start_matches('/');
  let resolver = app.asset_resolver();
  let found = if clean.is_empty() { None } else { resolver.get(format!("app/{clean}")) };
  // App routes (/channels/…, /invite/…) are the single-page app.
  let found = found.or_else(|| if clean.contains('.') && !clean.starts_with("channels/") && !clean.starts_with("invite/") { None } else { resolver.get("app/index.html".into()) });
  match found {
    Some(a) => {
      let cache = if clean.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
      r.respond(Response::builder().status(200).header("content-type", a.mime_type.as_str()).header("cache-control", cache).body(a.bytes).unwrap());
    }
    None => r.respond(Response::builder().status(404).header("content-type", "text/plain").body(b"Not found".to_vec()).unwrap()),
  }
}

/// The `sendapp://` protocol: bundled interface, plus the server calls it makes.
pub fn handle<R: Runtime>(app: &AppHandle<R>, server: String, req: Request<Vec<u8>>, r: UriSchemeResponder) {
  let path = req.uri().path().to_string();
  if path.starts_with("/api/") {
    if server.is_empty() { respond_text(r, 503, "Choose a SEND server first."); return; }
    std::thread::spawn(move || proxy(server.trim_end_matches('/'), req, r));
  } else {
    let app = app.clone();
    std::thread::spawn(move || asset(&app, &path, r));
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn cookies_are_kept_and_cleared() {
    take_cookie("send_session=abc123; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000");
    assert_eq!(session_token().as_deref(), Some("abc123"));
    take_cookie("other=1; Path=/");
    assert!(cookie_header().unwrap().contains("send_session=abc123") && !cookie_header().unwrap().contains("other"));
    take_cookie("send_session=; Path=/; Max-Age=0");
    assert_eq!(session_token(), None);
  }
  #[test]
  fn direct_paths() {
    assert!(direct("/api/media/avatars/1/2.webp") && direct("/api/files/read") && !direct("/api/users/@me") && !direct("/api/attachments/1/x.png"));
  }
  #[test]
  fn urls() {
    assert!(is_bundle(&url("/channels/@me")));
    assert_eq!(protocol_url("/channels/@me").as_str(), "sendapp://localhost/channels/@me");
  }
}
