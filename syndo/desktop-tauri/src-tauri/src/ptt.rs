//! Global push-to-talk on Windows: low-level keyboard/mouse hooks on their own thread.
//! The hook procedures only compare one number and post a message to the page, so they
//! never slow down the rest of the system's input.

/// What the web app's key names (KeyboardEvent.code, plus "Mouse4"/"Mouse5") map to.
/// Returns a virtual-key code, or 0x1_0000 | xbutton for mouse side buttons.
pub fn dom_code_to_key(code: &str) -> Option<u32> {
  if code == "Mouse4" { return Some(0x1_0001); }
  if code == "Mouse5" { return Some(0x1_0002); }
  if let Some(c) = code.strip_prefix("Key") {
    let b = c.as_bytes();
    if b.len() == 1 && b[0].is_ascii_uppercase() { return Some(b[0] as u32); }
    return None;
  }
  if let Some(d) = code.strip_prefix("Digit") {
    let b = d.as_bytes();
    if b.len() == 1 && b[0].is_ascii_digit() { return Some(b[0] as u32); }
    return None;
  }
  if let Some(n) = code.strip_prefix('F').and_then(|n| n.parse::<u32>().ok()) {
    if (1..=24).contains(&n) { return Some(0x70 + n - 1); }
    return None;
  }
  Some(match code {
    "Space" => 0x20, "Backquote" => 0xC0, "CapsLock" => 0x14, "Tab" => 0x09,
    "ControlLeft" => 0xA2, "ControlRight" => 0xA3, "ShiftLeft" => 0xA0, "ShiftRight" => 0xA1,
    "AltLeft" => 0xA4, "AltRight" => 0xA5, "Insert" => 0x2D, "Home" => 0x24, "End" => 0x23,
    "PageUp" => 0x21, "PageDown" => 0x22, "Pause" => 0x13, "ScrollLock" => 0x91, "NumpadEnter" => 0x0D,
    _ => return None,
  })
}

#[cfg(windows)]
mod imp {
  use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
  use std::sync::OnceLock;
  use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
  use windows::Win32::System::LibraryLoader::GetModuleHandleW;
  use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT,
    WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
  };

  static KEY: AtomicU32 = AtomicU32::new(0);
  static DOWN: AtomicBool = AtomicBool::new(false);
  static STARTED: AtomicBool = AtomicBool::new(false);
  static SINK: OnceLock<Box<dyn Fn(bool) + Send + Sync>> = OnceLock::new();

  fn set(down: bool) {
    if DOWN.swap(down, Ordering::Relaxed) != down {
      if let Some(s) = SINK.get() { s(down); }
    }
  }

  unsafe extern "system" fn keyboard(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
    if code >= 0 {
      let k = KEY.load(Ordering::Relaxed);
      if k != 0 && k < 0x1_0000 {
        let info = &*(l.0 as *const KBDLLHOOKSTRUCT);
        if info.vkCode == k {
          match w.0 as u32 {
            WM_KEYDOWN | WM_SYSKEYDOWN => set(true),
            WM_KEYUP | WM_SYSKEYUP => set(false),
            _ => {}
          }
        }
      }
    }
    CallNextHookEx(None, code, w, l)
  }

  unsafe extern "system" fn mouse(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
    if code >= 0 {
      let k = KEY.load(Ordering::Relaxed);
      let msg = w.0 as u32;
      if k & 0x1_0000 != 0 && (msg == WM_XBUTTONDOWN || msg == WM_XBUTTONUP) {
        let info = &*(l.0 as *const MSLLHOOKSTRUCT);
        if (info.mouseData >> 16) & 0xFFFF == k & 0xFFFF { set(msg == WM_XBUTTONDOWN); }
      }
    }
    CallNextHookEx(None, code, w, l)
  }

  pub fn available() -> bool { true }

  pub fn set_key(key: Option<u32>, sink: impl Fn(bool) + Send + Sync + 'static) {
    KEY.store(key.unwrap_or(0), Ordering::Relaxed);
    if key.is_none() { set(false); return; }
    let _ = SINK.set(Box::new(sink));
    if STARTED.swap(true, Ordering::SeqCst) { return; }
    std::thread::Builder::new().name("send-ptt".into()).spawn(|| unsafe {
      let module = GetModuleHandleW(None).ok().map(|m| HINSTANCE(m.0));
      let _k = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), module, 0);
      let _m = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), module, 0);
      let mut msg = MSG::default();
      while GetMessageW(&mut msg, None, 0, 0).as_bool() {
        let _ = TranslateMessage(&msg);
        DispatchMessageW(&msg);
      }
    }).ok();
  }
}

#[cfg(not(windows))]
mod imp {
  pub fn available() -> bool { false }
  pub fn set_key(_key: Option<u32>, _sink: impl Fn(bool) + Send + Sync + 'static) {}
}

pub use imp::{available, set_key};

#[cfg(test)]
mod tests {
  use super::dom_code_to_key;
  #[test]
  fn maps_keys() {
    assert_eq!(dom_code_to_key("KeyV"), Some(0x56));
    assert_eq!(dom_code_to_key("Digit3"), Some(0x33));
    assert_eq!(dom_code_to_key("F13"), Some(0x7C));
    assert_eq!(dom_code_to_key("Mouse5"), Some(0x1_0002));
    assert_eq!(dom_code_to_key("ShiftLeft"), Some(0xA0));
    assert_eq!(dom_code_to_key("Keyv"), None);
    assert_eq!(dom_code_to_key("F0"), None);
    assert_eq!(dom_code_to_key("Escape"), None);
  }
}
