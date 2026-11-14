/**
 * SEND Motion: a small motion-graphics engine for profile effects and avatar decorations.
 *
 * One hidden WebGL2 canvas renders every effect on screen (browsers cap live WebGL contexts, and a gallery shows
 * dozens), and each effect's own canvas receives a copy of its frame. Per effect there's a shader "sky" (the
 * atmosphere, a hero object like a moon or a black hole, or an avatar ring) and up to a few hundred sprites driven
 * by a CPU simulation: falling petals that tumble in 3D, crows circling with real wing beats, embers on turbulent
 * updrafts, fireworks, lightning, comets with trails. Everything pauses off-screen and in hidden tabs.
 */
import { QUAD_VS, SKY_FS, SPRITE_FS, SPRITE_VS } from "./shaders.ts";
import { GRID, SPRITES, spriteAtlas, type SpriteName } from "./sprites.ts";

// ---------------------------------------------------------------- scene description --
export type Behavior = "fall" | "rise" | "drift" | "flock" | "flutter" | "orbit" | "streak" | "twinkle" | "swirl" | "comet" | "fireworks" | "lightning" | "flyby" | "beam" | "pulse" | "lights" | "blink" | "garland";
export type Col = "c1" | "c2" | "c3" | "w" | `#${string}`;
export interface Emitter {
  sprite: SpriteName; behavior: Behavior;
  /** Steady number on a 320×440 card (scaled with area), or around an avatar. */
  count: number;
  size: [number, number]; speed?: number; colors?: Col[]; toColor?: Col;
  blend?: "add" | "alpha"; layer?: "back" | "front";
  /** Where new particles appear. */
  region?: "all" | "top" | "bottom" | "anchor" | "hero" | "banner" | "edges";
  spin?: number; tumble?: boolean; glow?: number; trail?: number; stretch?: number;
  alpha?: number; life?: [number, number]; fps?: number; angle?: number;
  /** Seconds after the card opens before this layer starts (staged entrances). */
  delay?: number;
}
export interface Scene {
  palette: [string, string, string];
  sky: { mode: number; intensity?: number; speed?: number };
  hero?: { kind: number; x: number; y: number; r: number; spin?: number };
  emitters: Emitter[];
  intro?: { burst?: SpriteName; colors?: Col[]; count?: number; shock?: boolean; flash?: boolean };
  deco: { ring: number; intensity?: number; emitters: Emitter[] };
  /** Recurring moments at irregular intervals (lightning crawling along the card edge, a red flash, signal tearing). */
  events?: SceneEvent[];
  /** One-off cues on the opening timeline, in seconds. */
  script?: { at: number; do: EventKind }[];
}
export type EventKind = "bolt" | "edge" | "flash" | "glitch" | "pulse";
export interface SceneEvent { do: EventKind; every: [number, number]; after?: number }
export const SKY = { none: 0, vortex: 1, nebula: 2, aurora: 3, fire: 4, fog: 5, neonrain: 6, rays: 7, caustics: 8, synth: 9, digital: 10, storm: 11, sand: 12, holo: 13, ink: 14, dreamy: 15, space: 16, film: 17, comic: 18, crt: 19, stage: 20, police: 21, tunnel: 22, clouds: 23, lava: 24, hexgrid: 25, split: 26, glass: 27,
  chrome: 28, cathedral: 29, circuit: 30, track: 31, crimson: 32, lasers: 33, clockwork: 34, rainglass: 35, grove: 36 } as const;
export const HERO = { none: 0, moon: 1, sun: 2, blackhole: 3, planet: 4, portal: 5, orb: 6, eclipse: 7, ring: 8, eye: 9, rosewindow: 10, clock: 11 } as const;
export const RING = { none: 0, flame: 1, electric: 2, ice: 3, nebula: 4, metal: 5, shadow: 6, water: 7, neon: 8, floral: 9, gears: 10, platinum: 11, circuit: 12, crimson: 13, crown: 14, pixel: 15 } as const;

// ---------------------------------------------------------------- simulation --
const hex = (h: string): [number, number, number] => { const n = parseInt(h.slice(1, 7), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[(Math.random() * xs.length) | 0]!;

interface P {
  e: Emitter; s: number; frames: number; x: number; y: number; vx: number; vy: number; rot: number; vr: number;
  size: number; age: number; life: number; ph: number; c: [number, number, number]; c2?: [number, number, number];
  a: number; flip: number; ang: number; rad: number; av: number; cx: number; cy: number; gen: number;
  hist?: number[]; kind?: number;
}

export type ViewKind = "back" | "front" | "deco";

export class Sim {
  t = 0; parts: P[] = []; W = 320; H = 440; anchor = { x: 56, y: 104 }; flash = 0; flashP = { x: .5, y: .2 }; glitch = 0;
  bolts: { pts: number[]; age: number; life: number; w?: number }[] = [];
  private lastFlash = -9; private evT: number[] = []; private cued = 0;
  /** Bulb states for garland lights: each bulb flickers on its own random schedule. */
  private bulbs: { on: number; next: number; warm: number }[] = [];
  private cols: Record<string, [number, number, number]>; private boltT = rand(1.5, 4); private fwT = .6;
  constructor(public scene: Scene, public kind: "card" | "deco", public seed = Math.random()) {
    const [c1, c2, c3] = scene.palette;
    this.cols = { c1: hex(c1), c2: hex(c2), c3: hex(c3), w: [1, 1, 1] };
  }
  get emitters() { return this.kind === "deco" ? this.scene.deco.emitters : this.scene.emitters; }
  col(c: Col) { return this.cols[c] ?? (this.cols[c] = hex(c)); }
  get scale() { return this.kind === "deco" ? this.W / 140 : this.W / 320; }
  heroPx() { const h = this.scene.hero; return h ? { x: h.x * this.W, y: h.y * this.H, r: h.r * this.W } : { x: this.W * .62, y: this.H * .12, r: 40 * this.scale }; }

  resize(W: number, H: number, anchor?: { x: number; y: number }) {
    const sx = W / this.W, sy = H / this.H;
    if (this.parts.length && (Math.abs(sx - 1) > .01 || Math.abs(sy - 1) > .01)) for (const p of this.parts) { p.x *= sx; p.y *= sy; p.cx *= sx; p.cy *= sy; p.rad *= sx; }
    this.W = W; this.H = H; this.anchor = anchor ?? (this.kind === "deco" ? { x: W / 2, y: H / 2 } : this.anchor);
  }

  private spawnPoint(e: Emitter) {
    const W = this.W, H = this.H, r = e.region ?? "all";
    if (r === "anchor") { const a = Math.random() * 6.283, d = (this.kind === "deco" ? W * .36 : 44 * this.scale) * rand(.6, 1); return { x: this.anchor.x + Math.cos(a) * d, y: this.anchor.y + Math.sin(a) * d }; }
    if (r === "hero") { const h = this.heroPx(), a = Math.random() * 6.283, d = h.r * rand(1, 2.4); return { x: h.x + Math.cos(a) * d, y: h.y + Math.sin(a) * d * .6 }; }
    if (r === "top") return { x: rand(0, W), y: rand(0, H * .3) };
    if (r === "banner") return { x: rand(0, W), y: rand(0, H * .28) };
    if (r === "bottom") return { x: rand(0, W), y: rand(H * .75, H) };
    if (r === "edges") { const side = Math.random() < .5; return { x: side ? rand(0, W * .14) : rand(W * .86, W), y: rand(0, H) }; }
    return { x: rand(0, W), y: rand(0, H) };
  }

  spawn(e: Emitter, warm = false): P {
    const sc = this.scale, spd = (e.speed ?? 1) * sc, info = SPRITES[e.sprite];
    const size = rand(e.size[0], e.size[1]) * sc;
    const p: P = { e, s: info.index, frames: info.frames, x: 0, y: 0, vx: 0, vy: 0, rot: rand(0, 6.283) * (e.spin !== undefined ? 1 : 0), vr: (e.spin ?? 0) * rand(-1, 1),
      size, age: 0, life: e.life ? rand(e.life[0], e.life[1]) : 1e9, ph: rand(0, 100), c: this.col(pick(e.colors ?? ["c1"])), c2: e.toColor ? this.col(e.toColor) : undefined,
      a: e.alpha ?? 1, flip: 1, ang: rand(0, 6.283), rad: 0, av: 0, cx: 0, cy: 0, gen: 0 };
    const W = this.W, H = this.H;
    const pt = this.spawnPoint(e);
    switch (e.behavior) {
      case "fall": p.x = rand(-20, W + 20); p.y = warm ? rand(-20, H) : rand(-60, -10); p.vy = rand(18, 34) * spd; p.vx = rand(-6, 6) * spd; break;
      case "rise": p.x = pt.x; p.y = e.region ? pt.y : (warm ? rand(0, H) : rand(H * .6, H + 10)); p.vy = -rand(16, 40) * spd; p.vx = rand(-8, 8) * spd; break;
      case "drift": case "twinkle": p.x = pt.x; p.y = pt.y; p.vx = rand(-6, 6) * spd; p.vy = rand(-6, 6) * spd; break;
      case "streak": { const a = (e.angle ?? 100) * Math.PI / 180, v = rand(260, 420) * spd; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v;
        p.x = rand(-W * .3, W * 1.1); p.y = warm ? rand(-20, H) : rand(-80, -10); if (Math.abs(p.vx) > Math.abs(p.vy)) { p.x = p.vx > 0 ? rand(-W * .6, -10) : rand(W + 10, W * 1.6); p.y = rand(0, H); } p.rot = a; break; }
      case "comet": { const a = (e.angle ?? 160) * Math.PI / 180 + rand(-.15, .15), v = rand(150, 240) * spd; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v;
        p.x = p.vx < 0 ? rand(W * .5, W * 1.2) : rand(-W * .2, W * .5); p.y = rand(-30, H * .25); p.life = rand(1.2, 2.2); p.hist = []; break; }
      case "flock": { const h = this.heroPx(); p.cx = this.kind === "deco" ? W / 2 : h.x + rand(-20, 20) * sc; p.cy = this.kind === "deco" ? H / 2 : h.y + rand(-10, 30) * sc;
        p.rad = (this.kind === "deco" ? W * rand(.36, .46) : rand(70, 165) * sc); p.av = rand(.35, .7) * (Math.random() < .25 ? -1 : 1) * (e.speed ?? 1); break; }
      case "orbit": { p.cx = this.anchor.x; p.cy = this.anchor.y; p.rad = (this.kind === "deco" ? W * rand(.36, .44) : rand(52, 62) * sc); p.av = rand(.4, .7) * (e.speed ?? 1); break; }
      case "swirl": { const h = this.heroPx(); p.cx = h.x; p.cy = h.y; p.rad = rand(h.r * 1.4, W * .7); p.av = rand(.8, 1.4) * (e.speed ?? 1); break; }
      case "flutter": p.x = pt.x; p.y = pt.y; p.ang = rand(0, 6.283); break;
      case "flyby": { const dir = Math.random() < .5 ? 1 : -1, v = rand(90, 150) * spd; p.vx = v * dir; p.vy = rand(-8, 8) * sc;
        p.x = dir > 0 ? -size * 2 - rand(0, W * (warm ? 2 : 1.2)) : W + size * 2 + rand(0, W * (warm ? 2 : 1.2)); p.y = e.region === "all" ? rand(H * .1, H * .9) : rand(H * .04, H * .26); p.flip = dir; if (e.trail) p.hist = []; break; }
      case "beam": { const src = e.region === "hero" ? this.heroPx() : e.region === "anchor" ? this.anchor : { x: rand(0, W), y: e.region === "bottom" ? H + 10 : -10 };
        p.cx = src.x; p.cy = src.y; p.ang = (e.angle ?? 90) * Math.PI / 180 + rand(-.4, .4); p.av = rand(.25, .6) * (Math.random() < .5 ? -1 : 1); p.rad = rand(W * .6, W * 1.2); p.life = rand(2.5, 5); break; }
      case "pulse": { const src = e.region === "hero" ? this.heroPx() : this.anchor; p.x = src.x; p.y = src.y; p.life = rand(1.4, 2); if (warm) p.age = rand(0, p.life); break; }
      case "lights": case "blink": p.x = 0; p.y = 0; break;
      default: p.x = pt.x; p.y = pt.y;
    }
    if (e.trail) p.hist = [];
    if (e.behavior === "twinkle" || e.behavior === "drift" || e.behavior === "rise") { if (!e.life) p.life = e.behavior === "twinkle" ? rand(1.6, 4) : rand(3, 7); if (warm) p.age = rand(0, p.life); }
    return p;
  }

  /** Fill the scene straight to its steady state (for still frames and an un-awkward first frame). */
  warm(seconds: number) { for (let i = 0; i < seconds * 30; i++) this.step(1 / 30, true); }

  intro() {
    const it = this.scene.intro, sc = this.scale;
    if (!it || this.kind === "deco") return;
    const n = it.count ?? 26;
    for (let i = 0; i < n; i++) {
      const sprite = it.burst ?? "spark", info = SPRITES[sprite];
      const a = rand(0, 6.283), v = rand(80, 260) * sc;
      this.parts.push({ e: { sprite, behavior: "drift", count: 0, size: [4, 9], blend: "add", layer: "front", glow: .5 }, s: info.index, frames: info.frames, x: this.anchor.x, y: this.anchor.y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: rand(0, 6), vr: rand(-4, 4), size: rand(5, 11) * sc, age: 0, life: rand(.8, 1.6), ph: rand(0, 9),
        c: this.col(pick(it.colors ?? ["w", "c1"])), a: 1, flip: 1, ang: 0, rad: 0, av: 0, cx: 0, cy: 0, gen: -1 });
    }
    if (it.shock !== false) this.parts.push({ e: { sprite: "ring", behavior: "drift", count: 0, size: [1, 1], blend: "add", layer: "front" }, s: SPRITES.ring.index, frames: 1, x: this.anchor.x, y: this.anchor.y,
      vx: 0, vy: 0, rot: 0, vr: 0, size: 30 * sc, age: 0, life: .9, ph: 0, c: this.col("c1"), a: 1, flip: 1, ang: 0, rad: 0, av: 0, cx: 0, cy: 0, gen: -2 });
    if (it.flash) this.lightUp(.85, this.anchor.x, this.anchor.y);
  }

  step(dt: number, warming = false) {
    this.t += dt;
    const t = this.t, W = this.W, H = this.H, sc = this.scale, area = this.kind === "deco" ? 1 : (W * H) / (320 * 440);
    const introBoost = !warming && t < 2.5 ? 1 + (1 - t / 2.5) * .8 : 1;
    // populations
    const counts = new Map<Emitter, number>();
    for (const p of this.parts) if (p.gen >= 0) counts.set(p.e, (counts.get(p.e) ?? 0) + 1);
    for (const e of this.emitters) {
      if (e.behavior === "fireworks" || e.behavior === "lightning") continue;
      if (e.delay && !warming && t < e.delay) continue;
      const fixed = e.behavior === "lights" || e.behavior === "blink" || e.behavior === "garland", want = fixed ? e.count : Math.round(e.count * area * introBoost), have = counts.get(e) ?? 0;
      const perStep = warming || fixed ? want : Math.max(1, Math.ceil(want * dt * 1.5));
      for (let i = 0; i < Math.min(want - have, perStep); i++) this.parts.push(this.spawn(e, warming || t < .05));
    }
    // fireworks & lightning are timed events
    for (const e of this.emitters) {
      if (e.behavior === "fireworks") { this.fwT -= dt; if (this.fwT <= 0) { this.fwT = rand(.5, 1.2) / Math.max(.3, e.count / 3); this.rocket(e); } }
      if (e.behavior === "lightning" && !(e.delay && !warming && t < e.delay)) { this.boltT -= dt; if (this.boltT <= 0) { this.boltT = rand(2.5, 6) / Math.max(.3, e.count / 2); this.bolt(); } }
    }
    this.events(dt, warming);
    this.flash = Math.max(0, this.flash - dt * 2.8);
    this.glitch = Math.max(0, this.glitch - dt * 3.5);
    for (const b of this.bolts) b.age += dt;
    this.bolts = this.bolts.filter((b) => b.age < b.life);

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]!, e = p.e;
      p.age += dt;
      if (p.hist) { p.hist.unshift(p.x, p.y); if (p.hist.length > (e.trail ?? 10) * 2) p.hist.length = (e.trail ?? 10) * 2; }
      let dead = p.age > p.life;
      switch (p.gen === -1 ? "burst" : p.gen === -2 ? "shock" : p.gen === -3 ? "rocket" : p.gen === -4 ? "spark" : e.behavior) {
        case "burst": { const k = Math.exp(-dt * 3.2); p.vx *= k; p.vy *= k; p.vy += 30 * sc * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.a = 1 - p.age / p.life; break; }
        case "shock": { const k = p.age / p.life; p.size = (30 + 150 * (1 - Math.pow(1 - k, 3))) * sc; p.a = (1 - k) * .9; break; }
        case "rocket": { p.vy += 150 * sc * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.vy > -25 * sc || p.age > p.life) { this.explode(p); dead = true; } break; }
        case "spark": { const k = Math.exp(-dt * 1.6); p.vx *= k; p.vy *= k; p.vy += 38 * sc * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.a = Math.pow(1 - p.age / p.life, 1.4) * (.75 + .25 * Math.sin(p.age * 40 + p.ph)); break; }
        case "fall": {
          p.vx += (Math.sin(t * .9 + p.ph) * 16 * sc * (e.speed ?? 1) - p.vx) * dt * 1.2;
          p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
          if (e.tumble) p.flip = Math.cos(t * 2.1 + p.ph);
          if (p.y > H + p.size * 2 || p.x < -60 || p.x > W + 60) { Object.assign(p, this.spawn(e)); }
          break;
        }
        case "rise": {
          p.vx += (Math.sin(t * 1.7 + p.ph) * 14 * sc - p.vx) * dt * 1.6 + Math.sin(t * 5.3 + p.ph * 3) * 6 * sc * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
          const k = p.age / p.life; p.a = (e.alpha ?? 1) * Math.min(1, k * 6) * Math.min(1, (1 - k) * 2.5) * (e.sprite === "ember" || e.sprite === "flame" ? .7 + .3 * Math.sin(t * 9 + p.ph) : 1);
          if (e.tumble) p.flip = Math.cos(t * 2.5 + p.ph);
          if (p.y < -30) dead = true;
          break;
        }
        case "drift": {
          p.vx += (Math.sin(t * .6 + p.ph) * 10 * sc * (e.speed ?? 1) - p.vx) * dt * .8; p.vy += (Math.cos(t * .47 + p.ph * 1.7) * 8 * sc * (e.speed ?? 1) - p.vy) * dt * .8;
          p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
          const k = p.age / p.life; p.a = (e.alpha ?? 1) * Math.sin(Math.PI * Math.min(1, k)) * (e.sprite === "firefly" ? .45 + .55 * Math.pow(.5 + .5 * Math.sin(t * 2.6 + p.ph), 2) : 1);
          break;
        }
        case "twinkle": { const k = p.age / p.life; p.a = (e.alpha ?? 1) * Math.pow(Math.sin(Math.PI * Math.min(1, k)), 2); p.rot += p.vr * dt; p.flip = .75 + .25 * Math.sin(t * 6 + p.ph); break; }
        case "flock": {
          const glide = Math.sin(t * .5 + p.ph) > .55;
          p.ang += p.av * dt * (glide ? .8 : 1);
          const px = p.x;
          p.x = p.cx + Math.cos(p.ang) * p.rad + Math.sin(t * .7 + p.ph) * 10 * sc;
          p.y = p.cy + Math.sin(p.ang) * p.rad * (this.kind === "deco" ? .9 : .42) + Math.cos(t * 1.3 + p.ph) * 7 * sc;
          const depth = (Math.sin(p.ang) + 1) / 2;
          p.flip = (p.x >= px ? 1 : -1) * (.62 + .45 * depth);
          p.rot = Math.atan2(Math.cos(p.ang) * p.av, 1) * .25 + (p.x >= px ? .15 : -.15);
          p.a = (e.alpha ?? 1) * (.55 + .45 * depth) * Math.min(1, p.age * 1.5);
          p.vr = glide ? 0 : 1; // stash glide state for frame selection
          break;
        }
        case "orbit": {
          p.ang += p.av * dt;
          p.x = p.cx + Math.cos(p.ang) * p.rad; p.y = p.cy + Math.sin(p.ang) * p.rad * (this.kind === "deco" ? 1 : .55) + Math.sin(t * 2 + p.ph) * 2 * sc;
          const depth = (Math.sin(p.ang) + 1) / 2; p.flip = .7 + .35 * depth; p.rot = Math.sin(t * 1.5 + p.ph) * .3;
          p.a = (e.alpha ?? 1) * (.65 + .35 * depth) * Math.min(1, p.age * 2);
          break;
        }
        case "flutter": {
          const turn = (Math.sin(t * .8 + p.ph) + Math.sin(t * 1.9 + p.ph * 2) * .5) * 1.4; p.ang += turn * dt;
          const v = 34 * sc * (e.speed ?? 1); p.vx = Math.cos(p.ang) * v; p.vy = Math.sin(p.ang) * v * .7 + Math.sin(t * 7 + p.ph) * 12 * sc;
          p.x += p.vx * dt; p.y += p.vy * dt; p.rot = Math.atan2(p.vy, p.vx) * .25 + (p.vx > 0 ? .35 : -.35);
          const m = 30; if (p.x < -m) p.x = W + m; if (p.x > W + m) p.x = -m; if (p.y < -m) p.y = H + m; if (p.y > H + m) p.y = -m;
          p.a = (e.alpha ?? 1) * Math.min(1, p.age * 1.5);
          break;
        }
        case "flyby": { p.x += p.vx * dt; p.y += p.vy * dt + Math.sin(t * 1.3 + p.ph) * 4 * sc * dt; p.rot = Math.atan2(p.vy, Math.abs(p.vx)) * Math.sign(p.vx) * .5;
          if ((p.vx > 0 && p.x > W + p.size * 3) || (p.vx < 0 && p.x < -p.size * 3)) Object.assign(p, this.spawn(e)); break; }
        case "beam": { p.ang += p.av * dt * Math.sin(t * .7 + p.ph); const k = p.age / p.life; p.a = (e.alpha ?? 1) * Math.min(1, k * 5) * Math.min(1, (1 - k) * 4); break; }
        case "pulse": { const k = p.age / p.life; p.size = (e.size[0] + (e.size[1] - e.size[0]) * (1 - Math.pow(1 - k, 2))) * sc; p.a = (e.alpha ?? 1) * (1 - k); break; }
        case "lights": case "blink": case "garland": break;
        case "streak": { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > H + 80 || p.x < -W * .7 || p.x > W * 1.7 || p.y < -100) Object.assign(p, this.spawn(e)); break; }
        case "comet": { p.x += p.vx * dt; p.y += p.vy * dt; const k = p.age / p.life; p.a = Math.sin(Math.PI * Math.min(1, k)); break; }
        case "swirl": {
          p.ang += p.av * dt * (80 * sc / Math.max(p.rad, 20 * sc)); p.rad -= 10 * sc * dt * (e.speed ?? 1);
          p.x = p.cx + Math.cos(p.ang) * p.rad; p.y = p.cy + Math.sin(p.ang) * p.rad * .42; p.rot += p.vr * dt;
          p.a = (e.alpha ?? 1) * Math.min(1, p.age) * Math.min(1, (p.rad - this.heroPx().r * .6) / (20 * sc));
          if (p.rad < this.heroPx().r * .65) Object.assign(p, this.spawn(e));
          break;
        }
      }
      if (dead) this.parts.splice(i, 1);
    }
    this.layoutFixed();
  }

  /** Start lights and string lights sit at fixed spots; their timing comes from the clock. */
  layoutFixed() {
    const sc = this.scale, W = this.W, t = this.t;
    for (const e of this.emitters) {
      if (e.behavior === "garland") { this.layoutGarland(e); continue; }
      if (e.behavior !== "lights" && e.behavior !== "blink") continue;
      const ps = this.parts.filter((p) => p.e === e), n = ps.length;
      ps.forEach((p, i) => {
        if (e.behavior === "lights") {
          p.x = W * (.5 + (i - (n - 1) / 2) * .13); p.y = this.H * .09;
          const cyc = t % 7, on = cyc < n * .7 ? (cyc > i * .7 ? 1 : 0) : cyc < n * .7 + 1.2 ? 1 : 0;
          p.a = on ? 1 : .12; p.size = (e.size[0]) * sc;
        } else {
          const u = (i + .5) / n; p.x = W * u; p.y = this.H * .035 + Math.sin(u * Math.PI * 3) * 6 * sc + 10 * sc * Math.sin(u * Math.PI);
          const h = Math.sin(i * 12.9898 + Math.floor(t * 2.2 + i * .37) * 78.233) * 43758.5453; p.a = (h - Math.floor(h)) > .35 ? 1 : .15;
        }
      });
    }
  }

  /**
   * Light up the scene. Photosensitivity: strong flashes are spaced at least 1.2 s apart (well under 3 a second) and capped,
   * so no effect can strobe; a flash asked for too soon is softened to a glow.
   */
  lightUp(k: number, x: number, y: number) {
    const strong = k > .45, soon = this.t - this.lastFlash < 1.2;
    const v = strong && soon ? Math.min(k, .3) : Math.min(k, .85);
    if (v >= this.flash) { this.flash = v; this.flashP = { x: x / this.W, y: y / this.H }; }
    if (strong && !soon) this.lastFlash = this.t;
  }
  fire(kind: EventKind) {
    if (kind === "bolt") this.bolt();
    else if (kind === "edge") this.edgeBolt();
    else if (kind === "flash") this.lightUp(.85, this.W * .5, this.H * .12);
    else if (kind === "glitch") this.glitch = 1;
    else if (kind === "pulse") this.lightUp(.4, this.W * (.2 + Math.random() * .6), this.H * .05);
  }
  private events(dt: number, warming: boolean) {
    const sc = this.scene;
    if (sc.script && !warming) while (this.cued < sc.script.length && sc.script[this.cued]!.at <= this.t) this.fire(sc.script[this.cued++]!.do);
    if (!sc.events) return;
    sc.events.forEach((ev, i) => {
      if (this.evT[i] === undefined) this.evT[i] = (ev.after ?? 0) + rand(ev.every[0], ev.every[1]) * .5;
      this.evT[i]! -= dt;
      if (this.evT[i]! <= 0) { this.evT[i] = rand(ev.every[0], ev.every[1]); if (!warming || ev.do === "bolt" || ev.do === "edge") this.fire(ev.do); }
    });
  }
  /** Lightning that crawls along the card's border, forking inwards, briefly lighting the surface near it. */
  private edgeBolt() {
    const W = this.W, H = this.H, sc = this.scale;
    const per = 2 * (W + H), start = rand(0, per), len = rand(.18, .32) * per, dir = Math.random() < .5 ? 1 : -1;
    const at = (u: number) => { u = ((u % per) + per) % per;
      if (u < W) return [u, 0, 0, 1]; u -= W; if (u < H) return [W, u, -1, 0]; u -= H; if (u < W) return [W - u, H, 0, -1]; u -= W; return [0, H - u, 1, 0]; };
    const pts: number[] = []; const steps = Math.round(len / (9 * sc));
    let jit = 0;
    for (let i = 0; i <= steps; i++) {
      const [x, y, nx, ny] = at(start + dir * i * len / steps); jit = Math.max(0, Math.min(16 * sc, jit + rand(-5, 5) * sc));
      pts.push(x! + nx! * (jit + 2 * sc), y! + ny! * (jit + 2 * sc));
      if (i > 2 && i < steps - 2 && Math.random() < .09) { // a fork reaching into the card
        const b: number[] = [pts[pts.length - 2]!, pts[pts.length - 1]!]; let bx = b[0]!, by = b[1]!; const reach = rand(3, 7) | 0;
        for (let k = 0; k < reach; k++) { bx += nx! * rand(5, 12) * sc + rand(-7, 7) * sc; by += ny! * rand(5, 12) * sc + rand(-7, 7) * sc; b.push(bx, by); }
        this.bolts.push({ pts: b, age: -i * .006, life: .35, w: .6 });
      }
    }
    this.bolts.push({ pts, age: 0, life: .5 });
    const [mx, my] = at(start + dir * len / 2); this.lightUp(.55, mx!, my!);
  }
  /**
   * Fairy lights strung on a sagging wire across the banner and down the left edge. Every bulb runs its own little state
   * machine: steady, a quick stutter, a dip, or out for a moment. They never blink together.
   */
  private layoutGarland(e: Emitter) {
    const ps = this.parts.filter((p) => p.e === e), n = ps.length, W = this.W, H = this.H, sc = this.scale, t = this.t;
    while (this.bulbs.length < n) this.bulbs.push({ on: 1, next: t + rand(.2, 3), warm: Math.random() });
    ps.forEach((p, i) => {
      const u = (i + .5) / n, across = u < .7, v = across ? u / .7 : (u - .7) / .3;
      if (across) { const span = W * 1.04; p.x = -W * .02 + span * v; p.y = H * .045 + Math.sin(v * Math.PI * 3) * 3 * sc + Math.sin(v * Math.PI) * 16 * sc + Math.sin(v * Math.PI * 6) * 5 * sc; }
      else { p.x = W * .025 + Math.sin(v * Math.PI * 4) * 4 * sc; p.y = H * (.08 + v * .5); }
      const b = this.bulbs[i]!;
      if (t >= b.next) { const r = Math.random();
        if (r < .55) { b.on = 1; b.next = t + rand(.8, 4); } else if (r < .8) { b.on = .25; b.next = t + rand(.04, .12); }
        else if (r < .93) { b.on = .55; b.next = t + rand(.15, .5); } else { b.on = .05; b.next = t + rand(.3, 1.4); } }
      const target = b.on * (.85 + .15 * Math.sin(t * 9 + i)); p.a += (target - p.a) * .5;
      p.size = e.size[0] * sc; p.rot = 0; p.flip = 1;
      p.c = this.col(i % 4 === 0 ? "c1" : i % 4 === 1 ? "#ffcf7a" : i % 4 === 2 ? "c2" : "#9fd3ff");
    });
  }
  private rocket(e: Emitter) {
    const sc = this.scale, x = rand(this.W * .15, this.W * .85);
    this.parts.push({ e: { ...e, sprite: "spark", blend: "add", trail: 8, layer: e.layer ?? "back" }, s: SPRITES.spark.index, frames: 1, x, y: this.H * rand(.45, .7), vx: rand(-15, 15) * sc, vy: -rand(150, 210) * sc,
      rot: 0, vr: 0, size: 5 * sc, age: 0, life: 2, ph: 0, c: this.col(pick(e.colors ?? ["c1"])), a: 1, flip: 1, ang: 0, rad: 0, av: 0, cx: 0, cy: 0, gen: -3, hist: [] });
  }
  private explode(r: P) {
    const sc = this.scale, n = 40, base = this.col(pick(r.e.colors ?? ["c1", "c2"])), alt = this.col(pick(r.e.colors ?? ["c2", "w"]));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rand(-.05, .05), v = rand(85, 130) * sc;
      this.parts.push({ e: { ...r.e, sprite: r.e.sprite, blend: "add", trail: 6 }, s: SPRITES[r.e.sprite].index, frames: 1, x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: 0, vr: 0,
        size: rand(4.5, 7) * sc, age: 0, life: rand(1.4, 2.2), ph: rand(0, 9), c: i % 3 ? base : alt, a: 1, flip: 1, ang: 0, rad: 0, av: 0, cx: 0, cy: 0, gen: -4, hist: [] });
    }
    this.flash = Math.max(this.flash, .35); this.flashP = { x: r.x / this.W, y: r.y / this.H };
  }
  private bolt() {
    const W = this.W, H = this.H; let x = rand(W * .1, W * .9), y = 0; const pts = [x, y]; const end = rand(H * .25, H * .55);
    while (y < end) { y += rand(10, 22) * this.scale; x += rand(-14, 14) * this.scale; pts.push(x, y); }
    this.bolts.push({ pts, age: 0, life: .45 }); this.lightUp(.85, pts[0]!, H * .1);
  }
}

// ---------------------------------------------------------------- renderer --
const MAX = 3000, FLOATS = 11;
class Renderer {
  canvas = document.createElement("canvas");
  gl: WebGL2RenderingContext; sky: WebGLProgram; spr: WebGLProgram; buf: Float32Array = new Float32Array(MAX * FLOATS);
  private inst: WebGLBuffer; private vaoSky: WebGLVertexArrayObject; private vaoSpr: WebGLVertexArrayObject; private u: Record<string, WebGLUniformLocation | null> = {}; private su: Record<string, WebGLUniformLocation | null> = {};
  lost = false;
  constructor() {
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
    if (!gl) throw new Error("webgl2");
    this.gl = gl;
    this.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; renderer = null; });
    const prog = (vs: string, fs: string) => {
      const p = gl.createProgram()!;
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
        const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
        gl.attachShader(p, s);
      }
      gl.bindAttribLocation(p, 0, "aP"); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
      return p;
    };
    this.sky = prog(QUAD_VS, SKY_FS); this.spr = prog(SPRITE_VS, SPRITE_FS);
    for (const n of ["uTime", "uIntensity", "uIntro", "uFlash", "uSeed", "uHW", "uSpeed", "uMode", "uHero", "uRing", "uDeco", "uC1", "uC2", "uC3", "uHeroP", "uAnchor", "uFlashP", "uGlitch"]) this.u[n] = gl.getUniformLocation(this.sky, n);
    for (const n of ["uRes", "uGrid", "uTex"]) this.su[n] = gl.getUniformLocation(this.spr, n);
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vaoSky = gl.createVertexArray()!; gl.bindVertexArray(this.vaoSky); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vaoSpr = gl.createVertexArray()!; gl.bindVertexArray(this.vaoSpr); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.inst); gl.bufferData(gl.ARRAY_BUFFER, this.buf.byteLength, gl.DYNAMIC_DRAW);
    const attr = (name: string, size: number, off: number) => { const l = gl.getAttribLocation(this.spr, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, FLOATS * 4, off * 4); gl.vertexAttribDivisor(l, 1); };
    attr("aXYS", 4, 0); attr("aRAF", 4, 4); attr("aC", 3, 8);
    gl.bindVertexArray(null);
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, spriteAtlas());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.enable(gl.BLEND);
  }

  /** Render one view of a simulation into the shared canvas, then copy it to the view's own canvas. */
  draw(sim: Sim, kind: ViewKind, out: CanvasRenderingContext2D, pw: number, ph: number, introK: number) {
    const gl = this.gl;
    if (this.canvas.width < pw || this.canvas.height < ph) { this.canvas.width = Math.max(this.canvas.width, pw, 256); this.canvas.height = Math.max(this.canvas.height, ph, 256); }
    gl.viewport(0, 0, pw, ph);
    gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const sc = sim.scene, px = pw / sim.W;
    if (kind === "back" ? sc.sky.mode || sc.hero : kind === "deco" ? sc.deco.ring : 0) {
      gl.useProgram(this.sky); gl.bindVertexArray(this.vaoSky); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const u = this.u, [c1, c2, c3] = sc.palette.map(hex);
      gl.uniform1f(u.uTime!, sim.t); gl.uniform1f(u.uIntensity!, kind === "deco" ? sc.deco.intensity ?? 1 : sc.sky.intensity ?? .9); gl.uniform1f(u.uIntro!, introK);
      gl.uniform1f(u.uFlash!, sim.flash); gl.uniform1f(u.uGlitch!, kind === "deco" ? 0 : sim.glitch); gl.uniform1f(u.uSeed!, (sim.seed * 7.3) % 1); gl.uniform1f(u.uHW!, sim.H / sim.W); gl.uniform1f(u.uSpeed!, sc.sky.speed ?? 1);
      gl.uniform1i(u.uMode!, sc.sky.mode); gl.uniform1i(u.uHero!, sc.hero?.kind ?? 0); gl.uniform1i(u.uRing!, sc.deco.ring); gl.uniform1i(u.uDeco!, kind === "deco" ? 1 : 0);
      gl.uniform3fv(u.uC1!, c1!); gl.uniform3fv(u.uC2!, c2!); gl.uniform3fv(u.uC3!, c3!);
      const h = sc.hero; gl.uniform4f(u.uHeroP!, h?.x ?? 0, h?.y ?? 0, h?.r ?? 0, h?.spin ?? .02);
      gl.uniform2f(u.uAnchor!, sim.anchor.x / sim.W, sim.anchor.y / sim.H); gl.uniform2f(u.uFlashP!, sim.flashP.x, sim.flashP.y * sim.H / sim.W);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    // sprites: alpha-blended first, then additive light on top
    const want = kind === "back" ? "back" : "front";
    let nA = 0;
    const B = this.buf;
    const put = (i: number, x: number, y: number, hw: number, hh: number, r: number, a: number, cell: number, c: [number, number, number]) => {
      const o = i * FLOATS; B[o] = x * px; B[o + 1] = y * px; B[o + 2] = hw * px; B[o + 3] = hh * px; B[o + 4] = r; B[o + 5] = a; B[o + 6] = cell; B[o + 7] = 0; B[o + 8] = c[0]; B[o + 9] = c[1]; B[o + 10] = c[2];
    };
    const queue: [boolean, number, number, number, number, number, number, number, [number, number, number]][] = [];
    if (kind === "front") { // the wire the fairy lights hang from
      let prev: P | null = null;
      for (const p of sim.parts) { if (p.e.behavior !== "garland") continue;
        if (prev && prev.e === p.e && Math.hypot(p.x - prev.x, p.y - prev.y) < sim.W * .2) {
          const len = Math.hypot(p.x - prev.x, p.y - prev.y), a = Math.atan2(p.y - prev.y, p.x - prev.x);
          queue.push([false, (p.x + prev.x) / 2, (p.y + prev.y) / 2, len / 2 + .5, 1.1 * sim.scale, a, .75, SPRITES.streak.index, [.06, .05, .05]]); }
        prev = p; }
    }
    for (const p of sim.parts) {
      const layer = kind === "deco" ? "front" : p.e.layer ?? "front";
      if (layer !== want || p.a <= .005) continue;
      let fade = 1;
      if (kind === "deco") { const d = Math.hypot(p.x - sim.W / 2, p.y - sim.H / 2) / (sim.W / 2); fade = Math.min(1, Math.max(0, (d - .5) / .2)); if (fade <= 0) continue; }
      const isAdd = (p.e.blend ?? "alpha") === "add";
      let col = p.c; if (p.c2) { const k = Math.min(1, p.age / p.life); col = [p.c[0] + (p.c2[0] - p.c[0]) * k, p.c[1] + (p.c2[1] - p.c[1]) * k, p.c[2] + (p.c2[2] - p.c[2]) * k]; }
      let cell = p.s;
      if (p.frames > 1) { const fps = p.e.fps ?? 10; cell += p.e.behavior === "flock" && p.vr === 0 ? 1 : Math.floor(sim.t * fps + p.ph) % p.frames; }
      const st = p.e.stretch ?? 1;
      const pa = p.a * fade;
      if (p.e.glow) queue.push([true, p.x, p.y, p.size * 2.6, p.size * 2.6, 0, pa * p.e.glow, SPRITES.glow.index, col]);
      if (p.hist && p.hist.length > 2) {
        const n = p.hist.length / 2;
        for (let k = 1; k < n; k++) { const f = 1 - k / n; queue.push([true, p.hist[k * 2]!, p.hist[k * 2 + 1]!, p.size * (.35 + .65 * f), p.size * (.35 + .65 * f), 0, p.a * f * .7, SPRITES.dust.index, col]); }
      }
      if (p.e.behavior === "beam") { const L = p.rad, mx = p.cx + Math.cos(p.ang) * L / 2, my = p.cy + Math.sin(p.ang) * L / 2;
        queue.push([true, mx, my, L / 2, p.size * 4, p.ang, pa * .35, SPRITES.glow.index, col]); queue.push([true, mx, my, L / 2, p.size * 1.5, p.ang, pa * .9, SPRITES.glow.index, col]); queue.push([true, mx, my, L / 2, p.size * 9, p.ang, pa, SPRITES.streak.index, [1, 1, 1]]); continue; }
      if (p.e.behavior === "streak") queue.push([isAdd, p.x, p.y, p.size * st, p.size, Math.atan2(p.vy, p.vx), pa, cell, col]);
      else queue.push([isAdd, p.x, p.y, p.size * p.flip, p.size, p.rot, pa, cell, col]);
    }
    if (kind !== "back") for (const b of sim.bolts) {
      if (b.age < 0) continue;
      const bw = b.w ?? 1;
      const k = 1 - b.age / b.life, flick = (Math.sin(b.age * 70) > -.3 ? 1 : .35) * k, c = sim.col("c1"), w: [number, number, number] = [1, 1, 1];
      for (let i = 0; i + 3 < b.pts.length; i += 2) {
        const x0 = b.pts[i]!, y0 = b.pts[i + 1]!, x1 = b.pts[i + 2]!, y1 = b.pts[i + 3]!, len = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
        queue.push([true, (x0 + x1) / 2, (y0 + y1) / 2, len / 2 + 3, 30 * sim.scale * bw, a, .22 * flick, SPRITES.glow.index, c]);
        queue.push([true, (x0 + x1) / 2, (y0 + y1) / 2, len / 2 + 1, 13 * sim.scale * bw, a, .8 * flick, SPRITES.streak.index, c]);
        queue.push([true, (x0 + x1) / 2, (y0 + y1) / 2, len / 2 + .5, 2.8 * sim.scale * bw, a, flick, SPRITES.streak.index, w]);
      }
    }
    for (const q of queue) if (!q[0] && nA < MAX) put(nA++, q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8]);
    let n = nA;
    for (const q of queue) if (q[0] && n < MAX) put(n++, q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8]);
    if (n) {
      gl.useProgram(this.spr); gl.bindVertexArray(this.vaoSpr);
      gl.uniform2f(this.su.uRes!, pw, ph); gl.uniform1f(this.su.uGrid!, GRID); gl.uniform1i(this.su.uTex!, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.inst); gl.bufferSubData(gl.ARRAY_BUFFER, 0, B, 0, n * FLOATS);
      if (nA) { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nA); }
      if (n > nA) { gl.blendFunc(gl.ONE, gl.ONE); this.drawFrom(nA, n - nA); }
    }
    gl.bindVertexArray(null);
    out.clearRect(0, 0, pw, ph);
    out.drawImage(this.canvas, 0, this.canvas.height - ph, pw, ph, 0, 0, pw, ph);
  }
  private drawFrom(first: number, count: number) {
    // Instanced attributes can't start mid-buffer with drawArraysInstanced, so rebind them at an offset.
    const gl = this.gl, l = (n: string) => gl.getAttribLocation(this.spr, n), off = first * FLOATS * 4;
    gl.vertexAttribPointer(l("aXYS"), 4, gl.FLOAT, false, FLOATS * 4, off); gl.vertexAttribPointer(l("aRAF"), 4, gl.FLOAT, false, FLOATS * 4, off + 16); gl.vertexAttribPointer(l("aC"), 3, gl.FLOAT, false, FLOATS * 4, off + 32);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.vertexAttribPointer(l("aXYS"), 4, gl.FLOAT, false, FLOATS * 4, 0); gl.vertexAttribPointer(l("aRAF"), 4, gl.FLOAT, false, FLOATS * 4, 16); gl.vertexAttribPointer(l("aC"), 3, gl.FLOAT, false, FLOATS * 4, 32);
  }
}

let renderer: Renderer | null = null, failed = false;
export function getRenderer(): Renderer | null {
  if (renderer || failed) return renderer;
  try { renderer = new Renderer(); } catch (e) { failed = true; console.warn("SEND Motion unavailable:", e); }
  return renderer;
}
export const motionSupported = () => !!getRenderer();

// ---------------------------------------------------------------- live views & the frame loop --
export interface View { sim: Sim; kind: ViewKind; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; visible: boolean; dpr: number; born: number }
const views = new Set<View>();
let raf = 0, last = 0;

function loop(now: number) {
  raf = 0;
  const r = getRenderer(); if (!r) return;
  const dt = Math.min(.05, (now - (last || now - 16)) / 1000); last = now;
  const sims = new Set<Sim>();
  for (const v of views) if (v.visible) sims.add(v.sim);
  for (const s of sims) s.step(dt);
  for (const v of views) if (v.visible) {
    const w = Math.round(v.canvas.clientWidth * v.dpr), h = Math.round(v.canvas.clientHeight * v.dpr);
    if (!w || !h) continue;
    if (v.canvas.width !== w || v.canvas.height !== h) { v.canvas.width = w; v.canvas.height = h; }
    try { r.draw(v.sim, v.kind, v.ctx, w, h, Math.min(1, (now - v.born) / 1600)); } catch (e) { console.warn(e); }
  }
  if ([...views].some((v) => v.visible) && document.visibilityState === "visible") raf = requestAnimationFrame(loop);
}
export function kick() { if (!raf && document.visibilityState === "visible") { last = 0; raf = requestAnimationFrame(loop); } }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") kick(); });

export function addView(v: View) { views.add(v); kick(); return () => { views.delete(v); }; }

/** A still frame of a scene (reduced motion, and the avatar decorations in long lists). Cached per scene and size. */
const stills = new Map<string, Promise<string | null>>();
export function stillFrame(key: string, scene: Scene, kind: "card" | "deco", w: number, h: number): Promise<string | null> {
  const k = `${key}|${kind}|${w}x${h}`;
  let pr = stills.get(k);
  if (!pr) {
    pr = new Promise((resolve) => {
      const r = getRenderer(); if (!r) return resolve(null);
      const sim = new Sim(scene, kind, .37); sim.resize(w / Math.min(2, devicePixelRatio || 1), h / Math.min(2, devicePixelRatio || 1)); sim.warm(5);
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const ctx = cv.getContext("2d")!;
      try {
        if (kind === "card") { r.draw(sim, "back", ctx, w, h, 1); const tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h; r.draw(sim, "front", tmp.getContext("2d")!, w, h, 1); ctx.drawImage(tmp, 0, 0); }
        else r.draw(sim, "deco", ctx, w, h, 1);
      } catch { return resolve(null); }
      cv.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), "image/webp", .9);
    });
    stills.set(k, pr);
  }
  return pr;
}
