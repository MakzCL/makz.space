//! Manual updates from the same feed the Electron build used (`latest.yml` on the public R2 bucket).
//! Nothing downloads on its own: the green button asks for it. The installer is checked against the
//! feed's sha512 before it runs, then runs silently (`/S /R /UPDATE`) and starts SEND again.

use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha512};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant};

pub const FEED: &str = match option_env!("SEND_UPDATE_URL") {
  Some(u) => u,
  None => "https://pub-77db39df34ad414fb86b513f573fd57e.r2.dev",
};

#[derive(Clone, Serialize, Default, Debug)]
pub struct Status {
  pub state: &'static str,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub version: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub percent: Option<u32>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub message: Option<String>,
}
impl Status {
  pub fn new(state: &'static str) -> Self { Status { state, ..Default::default() } }
  pub fn v(state: &'static str, version: Option<String>) -> Self { Status { state, version, ..Default::default() } }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Feed { pub version: String, pub path: String, pub sha512: String, pub size: Option<u64> }

/// The few fields of electron-builder's latest.yml we need (top-level keys only).
pub fn parse_feed(text: &str) -> Option<Feed> {
  let mut version = None; let mut path = None; let mut sha = None; let mut size = None;
  for line in text.lines() {
    if line.starts_with(' ') || line.starts_with('-') { continue; }
    let Some((k, v)) = line.split_once(':') else { continue };
    let v = v.trim().trim_matches('\'').trim_matches('"').to_string();
    match k.trim() { "version" => version = Some(v), "path" => path = Some(v), "sha512" => sha = Some(v), "size" => size = v.parse().ok(), _ => {} }
  }
  if size.is_none() {
    // electron-builder puts size under files[0]
    size = text.lines().find_map(|l| l.trim().strip_prefix("size:").and_then(|s| s.trim().parse().ok()));
  }
  let path = path?;
  if path.contains('/') || path.contains('\\') || path.contains("..") || !path.to_ascii_lowercase().ends_with(".exe") { return None; }
  Some(Feed { version: version?, path, sha512: sha?, size })
}

fn parts(v: &str) -> (u64, u64, u64) {
  let core = v.trim_start_matches('v').split(['-', '+']).next().unwrap_or("");
  let mut it = core.split('.').map(|x| x.parse::<u64>().unwrap_or(0));
  (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}
pub fn newer(remote: &str, local: &str) -> bool { parts(remote) > parts(local) }

/// HTTPS through the system TLS stack (SChannel on Windows): no bundled crypto library.
pub fn agent() -> ureq::Agent {
  let mut b = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(10)).timeout_read(Duration::from_secs(60)).user_agent("SEND-desktop");
  if let Ok(tls) = native_tls::TlsConnector::new() { b = b.tls_connector(std::sync::Arc::new(tls)); }
  b.build()
}

pub fn fetch_feed() -> Result<Feed, String> {
  let url = format!("{FEED}/latest.yml?t={}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0));
  let body = agent().get(&url).call().map_err(|e| format!("Couldn't check for updates ({e})."))?
    .into_string().map_err(|e| e.to_string())?;
  parse_feed(&body).ok_or_else(|| "The update feed couldn't be read.".to_string())
}

/// Download the installer to %TEMP%\SEND-update, verifying its sha512. `progress` gets 0..=100.
pub fn download(feed: &Feed, mut progress: impl FnMut(u32)) -> Result<PathBuf, String> {
  let dir = std::env::temp_dir().join("SEND-update");
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let dest = dir.join(&feed.path);
  let resp = agent().get(&format!("{FEED}/{}", feed.path)).call().map_err(|e| format!("Download failed ({e})."))?;
  let total = resp.header("content-length").and_then(|v| v.parse::<u64>().ok()).or(feed.size).unwrap_or(0);
  let mut reader = resp.into_reader();
  let tmp = dest.with_extension("part");
  let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
  let mut hasher = Sha512::new();
  let mut buf = vec![0u8; 256 * 1024];
  let (mut got, mut last) = (0u64, Instant::now());
  loop {
    let n = reader.read(&mut buf).map_err(|e| format!("Download interrupted ({e})."))?;
    if n == 0 { break; }
    hasher.update(&buf[..n]);
    file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
    got += n as u64;
    if total > 0 && last.elapsed() > Duration::from_millis(250) { last = Instant::now(); progress(((got * 100) / total).min(99) as u32); }
  }
  file.flush().map_err(|e| e.to_string())?;
  drop(file);
  let sum = base64::engine::general_purpose::STANDARD.encode(hasher.finalize());
  if sum != feed.sha512 {
    let _ = std::fs::remove_file(&tmp);
    return Err("The download didn't match the published update, so it wasn't installed.".into());
  }
  let _ = std::fs::remove_file(&dest);
  std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
  progress(100);
  Ok(dest)
}

/// Start the silent installer; it closes SEND, updates it and opens it again.
pub fn run_installer(path: &PathBuf) -> Result<(), String> {
  std::process::Command::new(path).args(["/S", "/R", "/UPDATE"]).spawn().map(|_| ()).map_err(|e| format!("Couldn't start the installer ({e})."))
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn reads_electron_builder_feed() {
    let y = "version: 0.4.4\nfiles:\n  - url: SEND-Setup-0.4.4.exe\n    sha512: abc==\n    size: 122115541\npath: SEND-Setup-0.4.4.exe\nsha512: abc==\nreleaseDate: '2026-11-06T06:49:17.905Z'\n";
    let f = parse_feed(y).unwrap();
    assert_eq!(f, Feed { version: "0.4.4".into(), path: "SEND-Setup-0.4.4.exe".into(), sha512: "abc==".into(), size: Some(122115541) });
    assert!(parse_feed("version: 1.0.0\npath: ../evil.exe\nsha512: x\n").is_none());
    assert!(parse_feed("version: 1.0.0\npath: thing.zip\nsha512: x\n").is_none());
  }
  #[test]
  fn compares_versions() {
    assert!(newer("0.5.0", "0.4.4"));
    assert!(newer("0.10.0", "0.9.9"));
    assert!(!newer("0.5.0", "0.5.0"));
    assert!(!newer("0.4.9", "0.5.0"));
  }
}
