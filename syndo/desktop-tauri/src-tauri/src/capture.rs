//! SEND's own screen sharing for the desktop app (Windows).
//!
//! The browser's `getDisplayMedia` always shows WebView2's picker. Instead, the app lists your screens and
//! windows itself (with live thumbnails, shown in SEND's Go Live dialog) and streams the one you pick:
//! - video: each frame is captured with GDI (`BitBlt` for screens, `PrintWindow` for windows, cursor drawn in),
//!   scaled, JPEG-encoded and sent to the page over a Tauri channel; the page turns it into a video track.
//! - sound: Windows' per-process loopback capture (Windows 10 2004+). Sharing a screen takes every app's sound
//!   *except SEND's own* (so nobody hears the call echo); sharing a window takes only that app's sound.
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
pub fn start(source: String, opts: StartOptions, video: Channel<InvokeResponseBody>, audio: Option<Channel<InvokeResponseBody>>) -> Result<u64, String> {
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
        let pid = target.audio_pid();
        let s = sess.clone();
        std::thread::Builder::new().name("send-capture-audio".into()).spawn(move || {
          if let Err(e) = win::audio::run(pid, &s.stop, &ch) { eprintln!("[capture audio] {e}"); }
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
  { let _ = (source, opts, video, audio); Err("Native capture is only available on Windows.".into()) }
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
    /// Whose sound to capture: a window → that program (include); a screen → everything except SEND (exclude).
    pub fn audio_pid(&self) -> (u32, bool) {
      match self {
        Target::Window(h) => { let mut pid = 0u32; unsafe { GetWindowThreadProcessId(HWND(*h as _), Some(&mut pid)) }; (pid, true) }
        Target::Screen(..) => (unsafe { GetCurrentProcessId() }, false),
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

  pub mod audio {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};
    use tauri::ipc::{Channel, InvokeResponseBody};
    use windows::core::{implement, Interface, Ref, Result as WinResult, HRESULT};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, BLOB, COINIT_MULTITHREADED};
    use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};
    use windows::Win32::System::Variant::VT_BLOB;

    const RATE: u32 = 48_000;
    const CHUNK: usize = 960; // 20 ms of stereo frames per message

    #[implement(IActivateAudioInterfaceCompletionHandler)]
    struct Done(HANDLE);
    impl IActivateAudioInterfaceCompletionHandler_Impl for Done_Impl {
      fn ActivateCompleted(&self, _op: Ref<IActivateAudioInterfaceAsyncOperation>) -> WinResult<()> {
        unsafe { SetEvent(self.0) }
      }
    }

    /// Capture loopback sound for `pid` (`include` = only that program's tree, else everything but it) as
    /// 48 kHz stereo f32, sent in 20 ms chunks. Silence is sent too, so the track keeps its timing.
    pub fn run((pid, include): (u32, bool), stop: &AtomicBool, ch: &Channel<InvokeResponseBody>) -> Result<(), String> {
      unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(|e| e.to_string())?; }
      let r = capture(pid, include, stop, ch);
      unsafe { CoUninitialize(); }
      r.map_err(|e| e.to_string())
    }

    fn capture(pid: u32, include: bool, stop: &AtomicBool, ch: &Channel<InvokeResponseBody>) -> WinResult<()> {
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

        let mut buf: Vec<f32> = Vec::with_capacity(CHUNK * 4);
        let mut last_data = Instant::now();
        while !stop.load(Ordering::SeqCst) {
          let _ = WaitForSingleObject(ready, 20);
          loop {
            let n = cap.GetNextPacketSize()?;
            if n == 0 { break; }
            let mut data: *mut u8 = std::ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;
            cap.GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
            let count = frames as usize * 2;
            if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() { buf.extend(std::iter::repeat(0.0f32).take(count)); }
            else { buf.extend_from_slice(std::slice::from_raw_parts(data as *const f32, count)); }
            cap.ReleaseBuffer(frames)?;
            last_data = Instant::now();
          }
          // Nothing playing: Windows sends no packets, so keep the stream going with silence.
          if buf.is_empty() && last_data.elapsed() >= Duration::from_millis(20) {
            buf.extend(std::iter::repeat(0.0f32).take(CHUNK * 2));
            last_data = Instant::now();
          }
          while buf.len() >= CHUNK * 2 {
            let chunk: Vec<u8> = buf.drain(..CHUNK * 2).flat_map(|s| s.to_le_bytes()).collect();
            if ch.send(InvokeResponseBody::Raw(chunk)).is_err() { stop.store(true, Ordering::SeqCst); break; }
          }
        }
        let _ = client.Stop();
        let _ = CloseHandle(ready);
      }
      Ok(())
    }
  }
}
