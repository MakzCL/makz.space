// Mirrors of the Rust types in crates/quasar-core. Keep in sync.

export type Hex = string;

export type DeviceKind =
  | "keyboard" | "mouse" | "mousepad" | "headset" | "headset-stand" | "keypad" | "controller"
  | "speaker" | "microphone" | "fan" | "led-strip" | "motherboard" | "gpu" | "ram" | "cooler"
  | "case" | "light" | "other";

export interface Led { x: number; y: number; label?: string; w?: number; h?: number }
export interface Layout { width: number; height: number; leds: Led[] }
export interface Placement { x: number; y: number; scale: number; rotation: number; visible: boolean }

export interface Capabilities {
  per_led: boolean;
  dpi: { min: number; max: number; step: number; max_stages: number } | null;
  polling_rates: number[];
  battery: boolean;
  remappable: string[];
  lift_off: boolean;
  brightness: boolean;
  hardware_modes: string[];
  onboard_profiles: number;
  fan_control: boolean;
}

export interface DeviceInfo {
  id: string;
  name: string;
  vendor: string;
  kind: DeviceKind;
  backend: string;
  firmware: string | null;
  serial: string | null;
  layout: Layout;
  caps: Capabilities;
  virtual_device: boolean;
}

export interface DpiStage { dpi: number; dpi_y: number | null; color: Hex }

export type Binding =
  | { type: "default" }
  | { type: "disabled" }
  | { type: "key"; key: string; modifiers: string[] }
  | { type: "mouse"; button: string }
  | { type: "macro"; id: string }
  | { type: "dpi-up" }
  | { type: "dpi-down" }
  | { type: "dpi-cycle" }
  | { type: "dpi-clutch"; dpi: number }
  | { type: "profile-next" }
  | { type: "media"; action: string }
  | { type: "launch"; path: string }
  | { type: "text"; text: string }
  | { type: "overdrive" };

export type LightingMode =
  | { mode: "engine" }
  | { mode: "static"; color: Hex }
  | { mode: "hardware"; effect: string }
  | { mode: "off" };

export interface DeviceSettings {
  dpi_stages: DpiStage[];
  active_stage: number;
  polling_rate: number | null;
  lift_off_mm: number | null;
  brightness: number;
  lighting: LightingMode;
  bindings: Record<string, Binding>;
  overdrive: Record<string, Binding>;
  fan_duty: number | null;
}

export interface DeviceStatus { connected: boolean; battery: number | null; charging: boolean }

export interface DeviceView {
  info: DeviceInfo;
  placement: Placement;
  settings: DeviceSettings;
  status: DeviceStatus;
  error: string | null;
}

export interface BackendView { id: string; name: string; devices: number; error: string | null }

export type ParamValue = number | boolean | string;
export type ParamSpec = { key: string; label: string; default: ParamValue } & (
  | { kind: "number"; min: number; max: number; step: number; unit?: string | null }
  | { kind: "color" }
  | { kind: "bool" }
  | { kind: "choice"; options: [string, string][] }
);

export type Category = "essentials" | "ambient" | "reactive" | "audio" | "screen" | "game";
export interface EffectInfo { id: string; name: string; category: Category; description: string; params: ParamSpec[] }

export type Blend = "normal" | "add" | "screen" | "multiply" | "lighten" | "mask";
export interface LayerSpec { id: string; effect: string; params: Record<string, ParamValue>; blend: Blend; opacity: number; enabled: boolean }
export interface Scene { layers: LayerSpec[] }

export interface Profile {
  id: string;
  name: string;
  apps: string[];
  scene: Scene;
  devices: Record<string, DeviceSettings>;
  brightness: number;
  accent: Hex;
}

export type Step =
  | { type: "key-down"; key: string }
  | { type: "key-up"; key: string }
  | { type: "mouse-down"; button: string }
  | { type: "mouse-up"; button: string }
  | { type: "delay"; ms: number }
  | { type: "text"; text: string };

export type Repeat = { mode: "once" } | { mode: "times"; n: number } | { mode: "while-held" } | { mode: "toggle" };
export interface Macro { id: string; name: string; steps: Step[]; repeat: Repeat }

export interface Settings {
  fps: number;
  openrgb_enabled: boolean;
  openrgb_managed: boolean;
  auto_update_check: boolean;
  openrgb_host: string;
  openrgb_port: number;
  hid_enabled: boolean;
  demo_rig: boolean;
  auto_switch: boolean;
  gsi_enabled: boolean;
  gsi_port: number;
  audio_enabled: boolean;
  screen_enabled: boolean;
  keys_enabled: boolean;
  start_minimized: boolean;
  launch_at_login: boolean;
  idle_dim_minutes: number;
  reduce_motion: boolean;
}

export interface Snapshot {
  devices: DeviceView[];
  backends: BackendView[];
  profiles: Profile[];
  active_profile: string;
  macros: Macro[];
  settings: Settings;
  platform: string;
  version: string;
}

export interface Stats { fps: number; frame_ms: number; leds: number; devices: number; writes_per_sec: number }

/** A decoded preview frame. */
export interface Frame {
  w: number;
  h: number;
  canvas: Uint8Array;
  devices: Map<string, Uint8Array>;
  stats: Stats;
}

export type OpenRgbPhase = "unknown" | "not-installed" | "downloading" | "installing" | "starting" | "running" | "external" | "stopped" | "error" | "unsupported";
export interface OpenRgbStatus { phase: OpenRgbPhase; progress: number; message: string | null; path: string | null; version: string; size_mb: number }
export interface UpdateInfo { current: string; latest: string; date: string; notes: string[]; installable: boolean }
