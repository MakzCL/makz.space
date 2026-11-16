//! SEND's own screen sharing for the desktop app (Windows).
//!
//! The browser's `getDisplayMedia` always shows WebView2's picker. Instead, the app lists your screens and
//! windows itself (with live thumbnails, shown in SEND's Go Live dialog) and streams the one you pick:
//! - video: each frame is captured with GDI (`BitBlt` for screens, `PrintWindow` for windows, cursor drawn in),
//!   scaled, JPEG-encoded and sent to the page over a Tauri channel; the page turns it into a video track.
//! - sound: Windows' per-process loopback capture (Windows 10 2004+). Sharing a window takes only that app's sound.
//!   Sharing a screen finds every program that plays sound, leaves out SEND's own (the call, music, sounds) and
//!   audio mixers that play everything again (Sonar, Voicemeeter, Wave Link), and mixes the rest, so nobody hears
//!   the call back. See `audio` for why this doesn't simply ask Windows for "everything except SEND".
//! Nothing leaves the computer except through the call itself.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

#[derive(Serialize, Clone, Debug)]
pub struct Source {
  pub id: String,
  pub kind: &'static str,
  pub name: String,
  pub app: String,
  pub thumb: Option<String>,
  pub width: u32,
  pub height: u32,
  pub primary: bool,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
  pub fps: Option<u32>,
  pub max_height: Option<u32>,
  pub quality: Option<u8>,
  pub audio: Option<bool>,
}

struct Session {
  stop: AtomicBool,
  inflight: AtomicU32,
}

/// A program whose sound a shared screen would carry (or leaves out), for the Go Live dialog.
#[derive(Serialize, Clone, Debug)]
pub struct SoundSource { pub pid: u32, pub name: String, /** "shared", "send" or "mixer" */ pub role: &'static str }

/// Which programs' sound sharing a whole screen would carry right now.
pub fn sound_sources(own_sound: Option<u32>) -> Vec<SoundSource> {
  #[cfg(windows)]
  { win::audio::sound_sources(&win::audio::own_roots(own_sound)) }
  #[cfg(not(windows))]
  { let _ = own_sound; Vec::new() }
}

static SESSIONS: LazyLock<Mutex<HashMap<u64, Arc<Session>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT: AtomicU64 = AtomicU64::new(1);

/// Frames the page hasn't drawn yet; more than this and new frames are skipped (no growing backlog).
const MAX_INFLIGHT: u32 = 2;

pub fn ack(id: u64) {
  if let Some(s) = SESSIONS.lock().unwrap().get(&id) {
    let _ = s.inflight.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| Some(v.saturating_sub(1)));
  }
}

pub fn stop(id: u64) {
  if let Some(s) = SESSIONS.lock().unwrap().remove(&id) { s.stop.store(true, Ordering::SeqCst); }
}


/// Scale BGRA pixels so they fit in `max_w` × `max_h` (never upscales), keeping even dimensions for video.
fn scale(bgra: &[u8], w: u32, h: u32, max_w: u32, max_h: u32) -> (Vec<u8>, u32, u32) {
  let r = (max_w as f64 / w as f64).min(max_h as f64 / h as f64).min(1.0);
  let (dw, dh) = (((w as f64 * r) as u32 & !1).max(2), ((h as f64 * r) as u32 & !1).max(2));
  if dw == w && dh == h { return (bgra.to_vec(), w, h); }
  use fast_image_resize as fir;
  let Ok(src) = fir::images::ImageRef::new(w, h, bgra, fir::PixelType::U8x4) else { return (bgra.to_vec(), w, h) };
  let mut dst = fir::images::Image::new(dw, dh, fir::PixelType::U8x4);
  let opts = fir::ResizeOptions::new().resize_alg(fir::ResizeAlg::Convolution(fir::FilterType::Bilinear));
  if fir::Resizer::new().resize(&src, &mut dst, &opts).is_err() { return (bgra.to_vec(), w, h); }
  (dst.into_vec(), dw, dh)
}

fn jpeg(bgra: &[u8], w: u32, h: u32, quality: u8) -> Option<Vec<u8>> {
  let mut out = Vec::with_capacity((w * h / 4) as usize);
  jpeg_encoder::Encoder::new(&mut out, quality).encode(bgra, w as u16, h as u16, jpeg_encoder::ColorType::Bgra).ok()?;
  Some(out)
}

fn data_url(jpg: &[u8]) -> String {
  use base64::Engine;
  format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpg))
}

/// Every screen and shareable window, each with a small thumbnail.
pub fn sources(thumb_width: u32) -> Vec<Source> {
  #[cfg(windows)]
  { win::sources(thumb_width.clamp(80, 640)) }
  #[cfg(not(windows))]
  { let _ = thumb_width; Vec::new() }
}

/// Start streaming `source` ("screen:N" or "window:HWND"). Frames go to `video`, sound (if asked) to `audio`.
/// `own_sound` is the process whose tree plays SEND's own sound (the WebView2 browser process); a shared screen
/// leaves that tree out, so the call is never sent back to the people in it.
pub fn start(source: String, opts: StartOptions, video: Channel<InvokeResponseBody>, audio: Option<Channel<InvokeResponseBody>>, own_sound: Option<u32>) -> Result<u64, String> {
  #[cfg(windows)]
  {
    let target = win::Target::parse(&source).ok_or("That screen or window isn't available any more.")?;
    let id = NEXT.fetch_add(1, Ordering::SeqCst);
    let sess = Arc::new(Session { stop: AtomicBool::new(false), inflight: AtomicU32::new(0) });
    SESSIONS.lock().unwrap().insert(id, sess.clone());
    let fps = opts.fps.unwrap_or(30).clamp(1, 60);
    let max_h = opts.max_height.unwrap_or(1080).clamp(240, 2160);
    let quality = opts.quality.unwrap_or(88).clamp(40, 95);
    if opts.audio.unwrap_or(true) {
      if let Some(ch) = audio {
        let mode = target.audio_mode(own_sound);
        let s = sess.clone();
        std::thread::Builder::new().name("send-capture-audio".into()).spawn(move || {
          if let Err(e) = win::audio::run(mode, &s.stop, &ch) { eprintln!("[capture audio] {e}"); }
        }).map_err(|e| e.to_string())?;
      }
    }
    std::thread::Builder::new().name("send-capture-video".into()).spawn(move || {
      // Windows Graphics Capture first (games, GPU apps, efficient); the GDI loop if it isn't available.
      if !win::wgc::run(target, fps, max_h, quality, sess.clone(), video.clone()) { win::video_loop(target, fps, max_h, quality, &sess, &video); }
      SESSIONS.lock().unwrap().remove(&id);
    }).map_err(|e| e.to_string())?;
    Ok(id)
  }
  #[cfg(not(windows))]
  { let _ = (source, opts, video, audio, own_sound); Err("Native capture is only available on Windows.".into()) }
}

#[cfg(windows)]
mod win {
  use super::*;
  use std::time::{Duration, Instant};
  use windows::core::BOOL;
  use windows::Win32::Foundation::{HWND, LPARAM, RECT};
  use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
  use windows::Win32::Graphics::Gdi::*;
  use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
  use windows::Win32::System::Threading::{GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
  use windows::Win32::UI::WindowsAndMessaging::*;

  #[derive(Clone, Copy, Debug)]
  #[allow(dead_code)] // the primary flag is informational
  pub enum Target { Screen(RECT, bool), Window(isize) }

  impl Target {
    pub fn parse(id: &str) -> Option<Target> {
      let (kind, rest) = id.split_once(':')?;
      match kind {
        "screen" => { let n: usize = rest.parse().ok()?; monitors().get(n).map(|(r, p, _)| Target::Screen(*r, *p)) }
        "window" => { let h: isize = rest.parse().ok()?; if unsafe { IsWindow(Some(HWND(h as _))) }.as_bool() { Some(Target::Window(h)) } else { None } }
        _ => None,
      }
    }
    /// Whose sound to capture: a window → that program; a screen → every program playing sound except SEND.
    pub fn audio_mode(&self, own_sound: Option<u32>) -> audio::Mode {
      match self {
        Target::Window(h) => { let mut pid = 0u32; unsafe { GetWindowThreadProcessId(HWND(*h as _), Some(&mut pid)) }; audio::Mode::App(pid) }
        Target::Screen(..) => audio::Mode::AllBut(audio::own_roots(own_sound)),
      }
    }
  }

  /// (bounds, primary, device name) for each monitor, in Windows' order.
  pub fn monitors() -> Vec<(RECT, bool, String)> {
    unsafe extern "system" fn each(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
      let out = unsafe { &mut *(data.0 as *mut Vec<(RECT, bool, String)>) };
      let mut info = MONITORINFOEXW::default();
      info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
      if unsafe { GetMonitorInfoW(m, &mut info.monitorInfo as *mut MONITORINFO) }.as_bool() {
        let name = String::from_utf16_lossy(&info.szDevice).trim_end_matches('\0').to_string();
        out.push((info.monitorInfo.rcMonitor, info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0, name));
      }
      BOOL(1)
    }
    let mut out: Vec<(RECT, bool, String)> = Vec::new();
    unsafe { let _ = EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut out as *mut _ as isize)); }
    out
  }

  fn cloaked(h: HWND) -> bool {
    let mut v = 0u32;
    unsafe { DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut v as *mut _ as *mut _, 4) }.is_ok() && v != 0
  }

  fn frame_bounds(h: HWND) -> Option<RECT> {
    let mut r = RECT::default();
    if unsafe { DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut _ as *mut _, std::mem::size_of::<RECT>() as u32) }.is_ok() { return Some(r); }
    let mut r = RECT::default();
    unsafe { GetWindowRect(h, &mut r) }.ok().map(|_| r)
  }

  fn process_name(pid: u32) -> String {
    unsafe {
      let Ok(p) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
      let mut buf = [0u16; 520];
      let mut len = buf.len() as u32;
      let ok = QueryFullProcessImageNameW(p, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
      let _ = windows::Win32::Foundation::CloseHandle(p);
      if !ok { return String::new(); }
      let path = String::from_utf16_lossy(&buf[..len as usize]);
      std::path::Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
    }
  }

  /// Top-level windows a person would want to share: visible, titled, not tool windows, not SEND itself.
  fn windows_list() -> Vec<(HWND, String, String, RECT)> {
    unsafe extern "system" fn each(h: HWND, data: LPARAM) -> BOOL {
      let out = unsafe { &mut *(data.0 as *mut Vec<HWND>) };
      out.push(h);
      BOOL(1)
    }
    let mut all: Vec<HWND> = Vec::new();
    unsafe { let _ = EnumWindows(Some(each), LPARAM(&mut all as *mut _ as isize)); }
    let me = unsafe { GetCurrentProcessId() };
    let mut out = Vec::new();
    for h in all {
      unsafe {
        if !IsWindowVisible(h).as_bool() || IsIconic(h).as_bool() || cloaked(h) { continue; }
        if GetWindow(h, GW_OWNER).map(|o| !o.is_invalid()).unwrap_or(false) { continue; }
        let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
        if ex & WS_EX_TOOLWINDOW.0 != 0 || ex & WS_EX_NOACTIVATE.0 != 0 { continue; }
        let len = GetWindowTextLengthW(h);
        if len <= 0 { continue; }
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(h, &mut buf);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        let mut pid = 0u32;
        GetWindowThreadProcessId(h, Some(&mut pid));
        if pid == me { continue; }
        let Some(r) = frame_bounds(h) else { continue };
        if r.right - r.left < 64 || r.bottom - r.top < 48 { continue; }
        let app = process_name(pid);
        if matches!(app.to_ascii_lowercase().as_str(), "textinputhost" | "applicationframehost" | "shellexperiencehost" | "searchhost" | "startmenuexperiencehost") { continue; }
        out.push((h, title, app, r));
      }
    }
    out
  }

  pub fn sources(thumb_w: u32) -> Vec<Source> {
    let mut g = Grabber::new();
    let mut out = Vec::new();
    for (i, (r, primary, _)) in monitors().iter().enumerate() {
      let (w, h) = ((r.right - r.left) as u32, (r.bottom - r.top) as u32);
      let thumb = g.grab(Target::Screen(*r, *primary), false).and_then(|f| {
        let (px, tw, th) = scale(&f.bgra, f.w, f.h, thumb_w, thumb_w);
        jpeg(&px, tw, th, 70).map(|j| data_url(&j))
      });
      out.push(Source { id: format!("screen:{i}"), kind: "screen", name: format!("Screen {}", i + 1), app: String::new(), thumb, width: w, height: h, primary: *primary });
    }
    for (hwnd, title, app, r) in windows_list() {
      let (w, h) = ((r.right - r.left) as u32, (r.bottom - r.top) as u32);
      let thumb = g.grab(Target::Window(hwnd.0 as isize), false).and_then(|f| {
        let (px, tw, th) = scale(&f.bgra, f.w, f.h, thumb_w, thumb_w);
        jpeg(&px, tw, th, 70).map(|j| data_url(&j))
      });
      out.push(Source { id: format!("window:{}", hwnd.0 as isize), kind: "window", name: title, app, thumb, width: w, height: h, primary: false });
    }
    out
  }

  pub struct Frame { pub w: u32, pub h: u32, pub bgra: Vec<u8> }

  /// A reusable off-screen bitmap that screens/windows are copied into.
  pub struct Grabber { dc: HDC, bmp: HBITMAP, old: HGDIOBJ, bits: *mut u8, w: i32, h: i32 }

  impl Grabber {
    pub fn new() -> Grabber {
      let dc = unsafe { CreateCompatibleDC(None) };
      Grabber { dc, bmp: HBITMAP::default(), old: HGDIOBJ::default(), bits: std::ptr::null_mut(), w: 0, h: 0 }
    }

    fn ensure(&mut self, w: i32, h: i32) -> bool {
      if w == self.w && h == self.h && !self.bits.is_null() { return true; }
      unsafe {
        if !self.bmp.is_invalid() { SelectObject(self.dc, self.old); let _ = DeleteObject(self.bmp.into()); self.bits = std::ptr::null_mut(); }
        let mut bi = BITMAPINFO::default();
        bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bi.bmiHeader.biWidth = w;
        bi.bmiHeader.biHeight = -h; // top-down rows
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        bi.bmiHeader.biCompression = BI_RGB.0;
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let Ok(bmp) = CreateDIBSection(Some(self.dc), &bi, DIB_RGB_COLORS, &mut bits, None, 0) else { return false };
        if bits.is_null() { let _ = DeleteObject(bmp.into()); return false; }
        self.old = SelectObject(self.dc, bmp.into());
        self.bmp = bmp; self.bits = bits as *mut u8; self.w = w; self.h = h;
      }
      true
    }

    /// Draw the mouse pointer into the bitmap when it's over the captured area (`ox`,`oy` = area's screen origin).
    fn cursor(&self, ox: i32, oy: i32) {
      unsafe {
        let mut ci = CURSORINFO { cbSize: std::mem::size_of::<CURSORINFO>() as u32, ..Default::default() };
        if GetCursorInfo(&mut ci).is_err() || ci.flags.0 & CURSOR_SHOWING.0 == 0 || ci.hCursor.is_invalid() { return; }
        let icon = HICON(ci.hCursor.0);
        let mut ii = ICONINFO::default();
        let (hx, hy) = if GetIconInfo(icon, &mut ii).is_ok() {
          if !ii.hbmMask.is_invalid() { let _ = DeleteObject(ii.hbmMask.into()); }
          if !ii.hbmColor.is_invalid() { let _ = DeleteObject(ii.hbmColor.into()); }
          (ii.xHotspot as i32, ii.yHotspot as i32)
        } else { (0, 0) };
        let _ = DrawIconEx(self.dc, ci.ptScreenPos.x - ox - hx, ci.ptScreenPos.y - oy - hy, icon, 0, 0, 0, None, DI_NORMAL);
      }
    }

    pub fn grab(&mut self, t: Target, with_cursor: bool) -> Option<Frame> {
      match t {
        Target::Screen(r, _) => {
          let (w, h) = (r.right - r.left, r.bottom - r.top);
          if w <= 0 || h <= 0 || !self.ensure(w, h) { return None; }
          unsafe {
            let screen = GetDC(None);
            let ok = BitBlt(self.dc, 0, 0, w, h, Some(screen), r.left, r.top, SRCCOPY).is_ok();
            ReleaseDC(None, screen);
            if !ok { return None; }
          }
          if with_cursor { self.cursor(r.left, r.top); }
          Some(self.read(0, 0, w, h))
        }
        Target::Window(hv) => {
          let hwnd = HWND(hv as _);
          unsafe { if !IsWindow(Some(hwnd)).as_bool() { return None; } }
          if unsafe { IsIconic(hwnd) }.as_bool() { return Some(Frame { w: 2, h: 2, bgra: vec![0; 16] }); }
          let mut wr = RECT::default();
          unsafe { GetWindowRect(hwnd, &mut wr) }.ok()?;
          let fr = frame_bounds(hwnd).unwrap_or(wr);
          let (w, h) = (wr.right - wr.left, wr.bottom - wr.top);
          if w <= 0 || h <= 0 || !self.ensure(w, h) { return None; }
          // PW_RENDERFULLCONTENT (2): also works for GPU-drawn windows (browsers, most apps).
          if !unsafe { PrintWindow(hwnd, self.dc, PRINT_WINDOW_FLAGS(2)) }.as_bool() { return None; }
          if with_cursor { self.cursor(wr.left, wr.top); }
          // Crop the invisible resize borders Windows adds around the window.
          let (cx, cy) = ((fr.left - wr.left).clamp(0, w), (fr.top - wr.top).clamp(0, h));
          let (cw, ch) = ((fr.right - fr.left).clamp(1, w - cx), (fr.bottom - fr.top).clamp(1, h - cy));
          Some(self.read(cx, cy, cw, ch))
        }
      }
    }

    fn read(&self, x: i32, y: i32, w: i32, h: i32) -> Frame {
      let stride = self.w as usize * 4;
      let mut out = Vec::with_capacity(w as usize * h as usize * 4);
      let all = unsafe { std::slice::from_raw_parts(self.bits, stride * self.h as usize) };
      for row in y as usize..(y + h) as usize {
        let s = row * stride + x as usize * 4;
        out.extend_from_slice(&all[s..s + w as usize * 4]);
      }
      // GDI leaves alpha undefined; make every pixel opaque.
      for px in out.chunks_exact_mut(4) { px[3] = 255; }
      Frame { w: w as u32, h: h as u32, bgra: out }
    }
  }

  impl Drop for Grabber {
    fn drop(&mut self) {
      unsafe {
        if !self.bmp.is_invalid() { SelectObject(self.dc, self.old); let _ = DeleteObject(self.bmp.into()); }
        let _ = DeleteDC(self.dc);
      }
    }
  }

  pub fn video_loop(t: Target, fps: u32, max_h: u32, quality: u8, sess: &Session, ch: &Channel<InvokeResponseBody>) {
    let mut g = Grabber::new();
    let period = Duration::from_micros(1_000_000 / fps as u64);
    let mut next = Instant::now();
    while !sess.stop.load(Ordering::SeqCst) {
      next += period;
      if sess.inflight.load(Ordering::SeqCst) < MAX_INFLIGHT {
        match g.grab(t, true) {
          Some(f) => {
            let max_w = (max_h as u64 * 32 / 9) as u32; // allow ultrawide
            let (px, w, h) = scale(&f.bgra, f.w, f.h, max_w, max_h);
            if let Some(j) = jpeg(&px, w, h, quality) {
              sess.inflight.fetch_add(1, Ordering::SeqCst);
              if ch.send(InvokeResponseBody::Raw(j)).is_err() { break; }
            }
          }
          None => { let _ = ch.send(InvokeResponseBody::Raw(Vec::new())); break; } // the window closed
        }
      }
      let now = Instant::now();
      if next > now { std::thread::sleep(next - now); } else { next = now; }
    }
    sess.stop.store(true, Ordering::SeqCst);
  }

  /// Windows Graphics Capture (Windows 10 1903+), via the `windows-capture` crate: the same API Discord's and
  /// OBS's window capture use. It captures games and GPU-drawn windows that GDI shows black, includes the
  /// pointer, and only hands over frames when something changed (the last frame is resent once a second so
  /// people joining mid-stream still get a picture).
  pub mod wgc {
    use super::*;
    use std::sync::Mutex as StdMutex;
    use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
    use windows_capture::frame::Frame;
    use windows_capture::graphics_capture_api::InternalCaptureControl;
    use windows_capture::monitor::Monitor as WcMonitor;
    use windows_capture::settings::{ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings, MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings};
    use windows_capture::window::Window as WcWindow;

    pub struct Shared { sess: Arc<Session>, ch: Channel<InvokeResponseBody>, period: Duration, max_h: u32, quality: u8, last: StdMutex<(Option<Vec<u8>>, Instant)>, closed: AtomicBool }

    struct Handler { s: Arc<Shared>, next: Instant, scratch: Vec<u8> }

    impl GraphicsCaptureApiHandler for Handler {
      type Flags = Arc<Shared>;
      type Error = Box<dyn std::error::Error + Send + Sync>;
      fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> { Ok(Handler { s: ctx.flags, next: Instant::now(), scratch: Vec::new() }) }
      fn on_frame_arrived(&mut self, frame: &mut Frame, control: InternalCaptureControl) -> Result<(), Self::Error> {
        let s = &self.s;
        if s.sess.stop.load(Ordering::SeqCst) { control.stop(); return Ok(()); }
        let now = Instant::now();
        if now < self.next || s.sess.inflight.load(Ordering::SeqCst) >= MAX_INFLIGHT { return Ok(()); }
        self.next = now + s.period;
        let (w, h) = (frame.width(), frame.height());
        let buf = frame.buffer()?;
        let px = buf.as_nopadding_buffer(&mut self.scratch);
        let max_w = (s.max_h as u64 * 32 / 9) as u32;
        let (scaled, sw, sh) = scale(px, w, h, max_w, s.max_h);
        if let Some(j) = jpeg(&scaled, sw, sh, s.quality) {
          s.sess.inflight.fetch_add(1, Ordering::SeqCst);
          if s.ch.send(InvokeResponseBody::Raw(j.clone())).is_err() { s.sess.stop.store(true, Ordering::SeqCst); control.stop(); }
          *s.last.lock().unwrap() = (Some(j), Instant::now());
        }
        Ok(())
      }
      fn on_closed(&mut self) -> Result<(), Self::Error> { self.s.closed.store(true, Ordering::SeqCst); Ok(()) }
    }

    /// Returns false when WGC couldn't start (then the caller uses GDI). Blocks until the share ends.
    pub fn run(t: Target, fps: u32, max_h: u32, quality: u8, sess: Arc<Session>, ch: Channel<InvokeResponseBody>) -> bool {
      let shared = Arc::new(Shared { sess: sess.clone(), ch: ch.clone(), period: Duration::from_micros(1_000_000 / fps as u64), max_h, quality, last: StdMutex::new((None, Instant::now())), closed: AtomicBool::new(false) });
      let start = |border: DrawBorderSettings| -> Option<_> {
        let interval = MinimumUpdateIntervalSettings::Custom(Duration::from_micros(1_000_000 / fps.max(1) as u64));
        match t {
          Target::Window(h) => Handler::start_free_threaded(Settings::new(WcWindow::from_raw_hwnd(h as *mut core::ffi::c_void), CursorCaptureSettings::WithCursor, border,
            SecondaryWindowSettings::Include, interval, DirtyRegionSettings::Default, ColorFormat::Bgra8, shared.clone())).ok(),
          Target::Screen(r, _) => {
            let hmon = unsafe { MonitorFromPoint(windows::Win32::Foundation::POINT { x: r.left + 1, y: r.top + 1 }, MONITOR_DEFAULTTONEAREST) };
            Handler::start_free_threaded(Settings::new(WcMonitor::from_raw_hmonitor(hmon.0), CursorCaptureSettings::WithCursor, border,
              SecondaryWindowSettings::Default, interval, DirtyRegionSettings::Default, ColorFormat::Bgra8, shared.clone())).ok()
          }
        }
      };
      // No yellow border where Windows allows it (11); Windows 10 insists on one.
      let Some(control) = start(DrawBorderSettings::WithoutBorder).or_else(|| start(DrawBorderSettings::Default)) else { return false };
      while !sess.stop.load(Ordering::SeqCst) && !shared.closed.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(100));
        if let Target::Window(h) = t { if !unsafe { IsWindow(Some(HWND(h as _))) }.as_bool() { break; } }
        // Nothing changed for a second: send the last picture again.
        let mut last = shared.last.lock().unwrap();
        if last.1.elapsed() >= Duration::from_secs(1) && sess.inflight.load(Ordering::SeqCst) < MAX_INFLIGHT {
          if let Some(j) = last.0.clone() { sess.inflight.fetch_add(1, Ordering::SeqCst); if ch.send(InvokeResponseBody::Raw(j)).is_err() { break; } }
          last.1 = Instant::now();
        }
      }
      let _ = control.stop();
      if !sess.stop.load(Ordering::SeqCst) { let _ = ch.send(InvokeResponseBody::Raw(Vec::new())); } // the window closed
      sess.stop.store(true, Ordering::SeqCst);
      true
    }
  }

  /// Sound capture.
  ///
  /// The obvious way to share a screen's sound, "everything except SEND's process tree" (Windows' exclude mode),
  /// let people hear themselves: SEND's sound comes out of WebView2's processes, which Windows doesn't reliably
  /// count as SEND's, and audio tools such as SteelSeries Sonar, Voicemeeter or Wave Link play every program's
  /// sound again from their own process. So a shared screen instead asks Windows which programs have sound,
  /// captures each one that isn't SEND (or a mixer) on its own (include mode, which is exact) and mixes them.
  /// A program that starts playing during the share is picked up within a second and a half.
  pub mod audio {
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};
    use tauri::ipc::{Channel, InvokeResponseBody};
    use windows::core::{implement, Interface, Ref, Result as WinResult, HRESULT};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, S_OK, WAIT_OBJECT_0};
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, BLOB, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows::Win32::System::Threading::{CreateEventW, GetCurrentProcessId, OpenProcess, SetEvent, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Wdk::System::Threading::{NtQueryInformationProcess, PROCESSINFOCLASS};
    use windows::Win32::System::Variant::VT_BLOB;

    const RATE: u32 = 48_000;
    const CHUNK: usize = 960; // 20 ms of stereo frames per message
    const SAMPLES: usize = CHUNK * 2;
    /// Each program's sound waits at most this long to be mixed (keeps the delay down if clocks drift).
    const MAX_BUFFERED: usize = SAMPLES * 10;
    const RESCAN: Duration = Duration::from_millis(1500);
    /// Programs that play other programs' sound again (so they'd carry SEND's too).
    const MIXERS: [&str; 7] = ["voicemeeter", "sonar", "wavelink", "wave link", "vb-audio", "audiorelay", "vban"];

    pub enum Mode {
      /// One program and the programs it started (a shared window).
      App(u32),
      /// Every program with sound except these processes, everything they started, and WebView2 for SEND.
      AllBut(Vec<u32>),
    }

    /// SEND.exe and the WebView2 browser process for its window.
    pub fn own_roots(own_sound: Option<u32>) -> Vec<u32> {
      let mut v = vec![unsafe { GetCurrentProcessId() }];
      if let Some(p) = own_sound.filter(|p| *p != 0) { v.push(p); }
      v
    }

    /* ------------------------------------------------------------------------------- processes -- */
    struct Proc { parent: u32, exe: String }
    fn processes() -> HashMap<u32, Proc> {
      let mut out = HashMap::new();
      unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
          let n = e.szExeFile.iter().position(|c| *c == 0).unwrap_or(e.szExeFile.len());
          out.insert(e.th32ProcessID, Proc { parent: e.th32ParentProcessID, exe: String::from_utf16_lossy(&e.szExeFile[..n]).to_lowercase() });
          ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
      }
      out
    }
    /// The process's command line, if Windows lets us read it.
    fn command_line(pid: u32) -> Option<String> {
      unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u8; 8192];
        let mut len = 0u32;
        // ProcessCommandLineInformation: a UNICODE_STRING followed by its text.
        let st = NtQueryInformationProcess(h, PROCESSINFOCLASS(60), buf.as_mut_ptr() as _, buf.len() as u32, &mut len);
        let _ = CloseHandle(h);
        if st.is_err() { return None; }
        let bytes = u16::from_le_bytes([buf[0], buf[1]]) as usize;
        let ptr = *(buf.as_ptr().add(8) as *const *const u16);
        if ptr.is_null() || bytes == 0 { return None; }
        Some(String::from_utf16_lossy(std::slice::from_raw_parts(ptr, bytes / 2)))
      }
    }
    /// Is `pid` (or one of its ancestors) in `set`?
    fn under(pid: u32, set: &HashSet<u32>, procs: &HashMap<u32, Proc>) -> bool {
      let mut p = pid;
      for _ in 0..64 {
        if set.contains(&p) { return true; }
        match procs.get(&p) { Some(x) if x.parent != 0 && x.parent != p => p = x.parent, _ => return false }
      }
      false
    }
    /// Every process that plays SEND's sound: SEND.exe, WebView2 for SEND, everything under them, and any WebView2
    /// process that says it belongs to SEND (or whose owner can't be read, to be safe).
    fn send_processes(roots: &[u32], procs: &HashMap<u32, Proc>) -> HashSet<u32> {
      let roots: HashSet<u32> = roots.iter().copied().collect();
      let me = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase())).unwrap_or_default();
      let mut out: HashSet<u32> = procs.keys().copied().filter(|p| under(*p, &roots, procs)).collect();
      out.extend(roots.iter().copied());
      for (pid, p) in procs {
        if out.contains(pid) || p.exe != "msedgewebview2.exe" { continue; }
        let mine = match command_line(*pid) {
          Some(c) => { let c = c.to_lowercase(); !c.contains("--webview-exe-name=") || (!me.is_empty() && c.contains(&format!("--webview-exe-name={me}"))) }
          None => true,
        };
        if mine { out.insert(*pid); }
      }
      // Children of those (a WebView2 audio service under a SEND WebView2 browser process).
      let seeds = out.clone();
      out.extend(procs.keys().copied().filter(|p| under(*p, &seeds, procs)));
      out
    }
    fn is_mixer(exe: &str) -> bool { MIXERS.iter().any(|m| exe.contains(m)) }

    /// Programs that have sound sessions on any output right now (playing, or paused but still open).
    fn sounding() -> WinResult<Vec<u32>> {
      unsafe {
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let devs = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
        let mut out = Vec::new();
        for i in 0..devs.GetCount()? {
          let Ok(d) = devs.Item(i) else { continue };
          let Ok(m) = d.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
          let Ok(list) = m.GetSessionEnumerator() else { continue };
          for j in 0..list.GetCount().unwrap_or(0) {
            let Ok(c) = list.GetSession(j) else { continue };
            if c.GetState().map(|s| s == AudioSessionStateExpired).unwrap_or(true) { continue; }
            let Ok(c2) = c.cast::<IAudioSessionControl2>() else { continue };
            if c2.IsSystemSoundsSession() == S_OK { continue; }
            if let Ok(pid) = c2.GetProcessId() { if pid != 0 && !out.contains(&pid) { out.push(pid); } }
          }
        }
        Ok(out)
      }
    }

    /// Sort the programs with sound into shared / SEND / mixer, sharing each program tree once.
    fn classify(roots: &[u32]) -> WinResult<Vec<(u32, String, &'static str)>> {
      let procs = processes();
      let send = send_processes(roots, &procs);
      let mut shared: HashSet<u32> = HashSet::new();
      let mut out = Vec::new();
      let sounding = sounding()?;
      let exe = |p: u32| procs.get(&p).map(|x| x.exe.clone()).unwrap_or_else(|| format!("process {p}"));
      for &pid in &sounding {
        let name = exe(pid);
        let role = if send.contains(&pid) { "send" } else if is_mixer(&name) { "mixer" } else { "shared" };
        if role == "shared" { shared.insert(pid); }
        out.push((pid, name, role));
      }
      // A program and one it started both with sound: capturing the parent's tree already covers the child.
      let all = shared.clone();
      out.retain(|(pid, _, role)| *role != "shared" || !procs.get(pid).is_some_and(|p| p.parent != *pid && under(p.parent, &all, &procs)));
      Ok(out)
    }

    pub fn sound_sources(roots: &[u32]) -> Vec<super::super::SoundSource> {
      unsafe { let _ = CoInitializeEx(None, COINIT_MULTITHREADED); }
      let r = classify(roots).unwrap_or_default();
      unsafe { CoUninitialize(); }
      let mut out: Vec<super::super::SoundSource> = r.into_iter().map(|(pid, name, role)| super::super::SoundSource { pid, name, role }).collect();
      out.sort_by(|a, b| a.role.cmp(b.role).then(a.name.cmp(&b.name)));
      out.dedup_by(|a, b| a.name == b.name && a.role == b.role);
      out
    }

    /* --------------------------------------------------------------------------------- capture -- */
    #[implement(IActivateAudioInterfaceCompletionHandler)]
    struct Done(HANDLE);
    impl IActivateAudioInterfaceCompletionHandler_Impl for Done_Impl {
      fn ActivateCompleted(&self, _op: Ref<IActivateAudioInterfaceAsyncOperation>) -> WinResult<()> {
        unsafe { SetEvent(self.0) }
      }
    }

    /// One program's sound (and the programs it started), 48 kHz stereo f32.
    struct Tap { client: IAudioClient, cap: IAudioCaptureClient, ready: HANDLE, buf: Vec<f32> }
    impl Drop for Tap { fn drop(&mut self) { unsafe { let _ = self.client.Stop(); let _ = CloseHandle(self.ready); } } }
    impl Tap {
      fn open(pid: u32, include: bool) -> WinResult<Tap> {
        unsafe {
          let params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
              ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: if include { PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE } else { PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE },
              },
            },
          };
          // A PROPVARIANT holding the params as a blob; it borrows `params`, so it must never be cleared/dropped.
          let mut pv = std::mem::ManuallyDrop::new(PROPVARIANT::default());
          {
            let inner = &mut *pv.Anonymous.Anonymous;
            inner.vt = VT_BLOB;
            inner.Anonymous.blob = BLOB { cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32, pBlobData: &params as *const _ as *mut u8 };
          }
          let done_ev = CreateEventW(None, false, false, None)?;
          let handler: IActivateAudioInterfaceCompletionHandler = Done(done_ev).into();
          let op = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, &IAudioClient::IID, Some(&*pv as *const PROPVARIANT), &handler)?;
          let waited = WaitForSingleObject(done_ev, 5000);
          let _ = CloseHandle(done_ev);
          if waited != WAIT_OBJECT_0 { return Err(HRESULT(0x8000_000Au32 as i32).into()); }
          let mut hr = HRESULT(0);
          let mut unk = None;
          op.GetActivateResult(&mut hr, &mut unk)?;
          hr.ok()?;
          let client: IAudioClient = unk.ok_or_else(|| windows::core::Error::from(HRESULT(0x8000_4005u32 as i32)))?.cast()?;
          let fmt = WAVEFORMATEX {
            wFormatTag: 3, // WAVE_FORMAT_IEEE_FLOAT
            nChannels: 2, nSamplesPerSec: RATE, nAvgBytesPerSec: RATE * 8, nBlockAlign: 8, wBitsPerSample: 32, cbSize: 0,
          };
          client.Initialize(AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
            200_000, 0, &fmt, None)?;
          let ready = CreateEventW(None, false, false, None)?;
          client.SetEventHandle(ready)?;
          let cap: IAudioCaptureClient = client.GetService()?;
          client.Start()?;
          Ok(Tap { client, cap, ready, buf: Vec::with_capacity(SAMPLES * 4) })
        }
      }
      /// Move whatever Windows has captured into the buffer (silence stays silence).
      fn drain(&mut self) -> WinResult<()> {
        unsafe {
          loop {
            let n = self.cap.GetNextPacketSize()?;
            if n == 0 { break; }
            let mut data: *mut u8 = std::ptr::null_mut();
            let (mut frames, mut flags) = (0u32, 0u32);
            self.cap.GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
            let count = frames as usize * 2;
            if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() { self.buf.extend(std::iter::repeat(0.0f32).take(count)); }
            else { self.buf.extend_from_slice(std::slice::from_raw_parts(data as *const f32, count)); }
            self.cap.ReleaseBuffer(frames)?;
          }
        }
        if self.buf.len() > MAX_BUFFERED { let extra = self.buf.len() - MAX_BUFFERED; self.buf.drain(..extra); }
        Ok(())
      }
    }

    /// Capture the sound for `mode` and send it in 20 ms chunks of 48 kHz stereo f32 until `stop`.
    /// Silence is sent too, so the track keeps its timing.
    pub fn run(mode: Mode, stop: &AtomicBool, ch: &Channel<InvokeResponseBody>) -> Result<(), String> {
      unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(|e| e.to_string())?; }
      let r = mix(mode, stop, ch);
      unsafe { CoUninitialize(); }
      r.map_err(|e| e.to_string())
    }

    fn mix(mode: Mode, stop: &AtomicBool, ch: &Channel<InvokeResponseBody>) -> WinResult<()> {
      let mut taps: HashMap<u32, Tap> = HashMap::new();
      let roots = match &mode { Mode::App(pid) => { taps.insert(*pid, Tap::open(*pid, true)?); None } Mode::AllBut(r) => Some(r.clone()) };
      let mut failed: HashSet<u32> = HashSet::new();
      let mut last_scan = Instant::now() - RESCAN;
      let mut next = Instant::now();
      while !stop.load(Ordering::SeqCst) {
        if let Some(roots) = &roots {
          if last_scan.elapsed() >= RESCAN {
            last_scan = Instant::now();
            match classify(roots) {
              Ok(list) => {
                let want: HashSet<u32> = list.iter().filter(|(_, _, r)| *r == "shared").map(|(p, _, _)| *p).collect();
                taps.retain(|pid, _| want.contains(pid));
                for pid in want { if !taps.contains_key(&pid) && !failed.contains(&pid) { match Tap::open(pid, true) { Ok(t) => { taps.insert(pid, t); } Err(_) => { failed.insert(pid); } } } }
              }
              // Can't list programs: fall back to everything except SEND's own processes.
              Err(_) if taps.is_empty() => { if let Some(&root) = roots.last() { if let Ok(t) = Tap::open(root, false) { taps.insert(0, t); } } }
              Err(_) => {}
            }
          }
        }
        std::thread::sleep(Duration::from_millis(5));
        taps.retain(|_, t| t.drain().is_ok());
        // Mix 20 ms at a time on the wall clock; a program with nothing ready adds silence.
        let now = Instant::now();
        if now.duration_since(next) > Duration::from_millis(200) { next = now; }
        while now >= next {
          let mut out = vec![0.0f32; SAMPLES];
          for t in taps.values_mut() {
            let n = t.buf.len().min(SAMPLES);
            for (o, s) in out.iter_mut().zip(t.buf.drain(..n)) { *o += s; }
          }
          for o in out.iter_mut() { *o = o.clamp(-1.0, 1.0); }
          let bytes: Vec<u8> = out.iter().flat_map(|s| s.to_le_bytes()).collect();
          if ch.send(InvokeResponseBody::Raw(bytes)).is_err() { stop.store(true, Ordering::SeqCst); break; }
          next += Duration::from_millis(20);
        }
      }
      Ok(())
    }
  }
}
