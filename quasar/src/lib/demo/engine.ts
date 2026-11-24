// In-browser stand-in for the Rust engine, used by the web demo. It runs the
// simulated rig exported from Rust (seed.json) through the TS effect port.

import seed from "./seed.json";
import { Canvas, createEffect, idleCtx, type Effect } from "../fx";
import type {
  BackendView, DeviceSettings, DeviceView, EffectInfo, Frame, Macro, Placement, Profile, Scene, Settings, Snapshot, Step,
} from "../types";

const CANVAS_MM = 1000;
const clone = <T,>(x: T): T => structuredClone(x);

interface Live { id: string; effect: string; fx: Effect; scratch: Canvas }

export class DemoEngine {
  devices: DeviceView[] = clone(seed.devices as unknown as DeviceView[]);
  backends: BackendView[] = clone(seed.backends as unknown as BackendView[]);
  library: EffectInfo[] = seed.library as unknown as EffectInfo[];
  profiles: Profile[] = clone(seed.state.profiles as unknown as Profile[]);
  active = seed.state.active_profile;
  macros: Macro[] = clone(seed.state.macros as unknown as Macro[]);
  settings: Settings = clone(seed.state.settings as unknown as Settings);
  canvas = new Canvas(96, 60);
  layers: Live[] = [];
  uv = new Map<string, [number, number][]>();
  colors = new Map<string, Uint8Array>();
  presses: { u: number; v: number }[] = [];
  t = 0;
  stats = { fps: 60, frame_ms: 0, leds: 0, devices: 0, writes_per_sec: 0 };
  game = { active: false, health: 1, team: "CT", sinceHit: 9, sinceKill: 9, flashed: 0, burning: false, bomb: "none" };

  constructor() {
    this.loadScene();
    this.relayout();
  }

  profile() {
    return this.profiles.find((p) => p.id === this.active) ?? this.profiles[0];
  }

  loadScene() {
    const old = this.layers;
    this.layers = [];
    for (const spec of this.profile().scene.layers) {
      const kept = old.find((l) => l.id === spec.id && l.effect === spec.effect);
      const fx = kept?.fx ?? createEffect(spec.effect);
      if (fx) this.layers.push({ id: spec.id, effect: spec.effect, fx, scratch: kept?.scratch ?? new Canvas(96, 60) });
    }
  }

  relayout() {
    const aspect = this.canvas.aspect;
    for (const d of this.devices) {
      const p = d.placement, L = d.info.layout;
      const s = Math.sin((p.rotation * Math.PI) / 180), c = Math.cos((p.rotation * Math.PI) / 180);
      this.uv.set(d.info.id, L.leds.map((l) => {
        const lx = (l.x - L.width / 2) * p.scale, ly = (l.y - L.height / 2) * p.scale;
        return [p.x + (lx * c - ly * s) / CANVAS_MM, p.y + (lx * s + ly * c) / (CANVAS_MM / aspect)];
      }));
    }
    this.stats.leds = this.devices.reduce((a, d) => a + d.info.layout.leds.length, 0);
    this.stats.devices = this.devices.length;
  }

  tick(dt: number) {
    const t0 = performance.now();
    this.t += dt;
    this.game.sinceHit += dt;
    this.game.sinceKill += dt;
    const ctx = idleCtx(this.t, dt, this.canvas.aspect);
    ctx.presses = this.presses.splice(0);
    ctx.game = this.game;
    this.canvas.fill([0, 0, 0]);
    const specs = this.profile().scene.layers;
    for (const l of this.layers) {
      const spec = specs.find((s) => s.id === l.id);
      if (!spec?.enabled) continue;
      l.fx(ctx, spec.params, l.scratch);
      this.canvas.composite(l.scratch, spec.blend, spec.opacity);
    }
    const prof = this.profile();
    for (const d of this.devices) {
      const s = prof.devices[d.info.id] ?? d.settings;
      const k = prof.brightness * s.brightness;
      const uv = this.uv.get(d.info.id)!;
      const out = this.colors.get(d.info.id) ?? new Uint8Array(uv.length * 3);
      const L = s.lighting;
      const st = L.mode === "static" ? [parseInt(L.color.slice(1, 3), 16), parseInt(L.color.slice(3, 5), 16), parseInt(L.color.slice(5, 7), 16)] : null;
      uv.forEach(([u, v], i) => {
        if (L.mode === "off") { out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = 0; return; }
        if (st) { out[i * 3] = st[0] * k; out[i * 3 + 1] = st[1] * k; out[i * 3 + 2] = st[2] * k; return; }
        const c = this.canvas.sample(u, v);
        out[i * 3] = Math.min(255, c[0] * k * 255);
        out[i * 3 + 1] = Math.min(255, c[1] * k * 255);
        out[i * 3 + 2] = Math.min(255, c[2] * k * 255);
      });
      this.colors.set(d.info.id, out);
    }
    this.stats.frame_ms = this.stats.frame_ms * 0.9 + (performance.now() - t0) * 0.1;
  }

  frame(): Frame {
    const { w, h, px } = this.canvas;
    const canvas = new Uint8Array(w * h * 3);
    for (let i = 0; i < px.length; i++) canvas[i] = Math.min(255, px[i] * 255);
    return { w, h, canvas, devices: this.colors, stats: { ...this.stats } };
  }

  snapshot(): Snapshot {
    const prof = this.profile();
    return clone({
      devices: this.devices.map((d) => ({ ...d, settings: prof.devices[d.info.id] ?? d.settings })),
      backends: this.backends,
      profiles: this.profiles,
      active_profile: this.active,
      macros: this.macros,
      settings: this.settings,
      platform: "web",
      version: "0.1.8",
    });
  }

  setScene(scene: Scene) {
    this.profile().scene = clone(scene);
    this.loadScene();
  }
  activate(id: string) {
    if (this.profiles.some((p) => p.id === id)) {
      this.active = id;
      this.loadScene();
    }
  }
  saveProfile(p: Profile) {
    const i = this.profiles.findIndex((x) => x.id === p.id);
    if (i >= 0) this.profiles[i] = clone(p);
    else this.profiles.push({ ...clone(p), devices: Object.keys(p.devices).length ? clone(p.devices) : clone(this.profile().devices) });
    if (p.id === this.active) this.loadScene();
  }
  deleteProfile(id: string) {
    if (this.profiles.length <= 1) throw new Error("Keep at least one profile.");
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.active === id) this.activate(this.profiles[0].id);
  }
  /** The seed placements come from the Rust arranger; restore them. */
  arrange() {
    const seedDevs = seed.devices as unknown as DeviceView[];
    for (const d of this.devices) {
      const s = seedDevs.find((x) => x.info.id === d.info.id);
      if (s) d.placement = { ...s.placement };
    }
    this.relayout();
  }
  setPlacement(id: string, p: Placement) {
    const d = this.devices.find((d) => d.info.id === id);
    if (d) { d.placement = { ...p }; this.relayout(); }
  }
  setDeviceSettings(id: string, s: DeviceSettings) {
    this.profile().devices[id] = clone(s);
  }
  pressAt(u: number, v: number) {
    this.presses.push({ u, v });
  }
  pressKey(label: string) {
    const kb = this.devices.find((d) => d.info.kind === "keyboard");
    if (!kb) return;
    const i = kb.info.layout.leds.findIndex((l) => l.label?.toLowerCase() === label.toLowerCase());
    const uv = this.uv.get(kb.info.id)!;
    const p = i >= 0 ? uv[i] : [kb.placement.x, kb.placement.y];
    this.pressAt(p[0], p[1]);
  }
  saveMacro(m: Macro) {
    const i = this.macros.findIndex((x) => x.id === m.id);
    if (i >= 0) this.macros[i] = clone(m); else this.macros.push(clone(m));
  }
  deleteMacro(id: string) {
    this.macros = this.macros.filter((m) => m.id !== id);
  }

  // recording in the demo listens to the page only
  private rec: { steps: Step[]; last: number } | null = null;
  startRecording() {
    this.rec = { steps: [], last: performance.now() };
  }
  recordKey(key: string, down: boolean) {
    if (!this.rec) return;
    const now = performance.now();
    if (this.rec.steps.length) this.rec.steps.push({ type: "delay", ms: Math.round(now - this.rec.last) });
    this.rec.last = now;
    this.rec.steps.push(down ? { type: "key-down", key } : { type: "key-up", key });
  }
  stopRecording(): Step[] {
    const s = this.rec?.steps ?? [];
    this.rec = null;
    return s;
  }
  hit() {
    this.game.active = true;
    this.game.health = Math.max(0, this.game.health - 0.27);
    this.game.sinceHit = 0;
    if (this.game.health <= 0) setTimeout(() => (this.game.health = 1), 1200);
  }
}
