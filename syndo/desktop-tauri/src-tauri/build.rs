// Declares the shell's own commands so they get permissions. Tauri refuses commands from a page loaded over the
// network (the hosted SEND web app) unless a capability grants them, so every command is listed here and granted
// in capabilities/ (and for a server chosen at runtime, in lib.rs `allow_origin`).
const COMMANDS: &[&str] = &[
  "window_control", "set_ptt", "set_material", "get_settings", "set_performance", "set_startup", "restart_app", "refresh",
  "set_close_to_tray", "change_server", "update_status", "check_updates", "download_update", "restart_to_update",
  "flash", "notify", "connect_set_server", "connect_info",
];

fn main() {
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
    .expect("failed to run tauri-build");
}
