// A TypeScript port of the effect library in crates/quasar-core/src/effects.
// The desktop app renders with Rust; this port draws the library's live
// thumbnails and powers the browser demo. Same maths, same parameters.

import type { ParamValue } from "./types";

export type RGB = [number, number, number];
export type Params = Record<string, ParamValue>;

export class Canvas {
  px: Float32Array;
  constructor(public w: number, public h: number) {
    this.px = new Float32Array(w * h * 3);
  }
  get aspect() {
    return this.w / this.h;
  }
  fill(c: RGB) {
    for (let i = 0; i < this.px.length; i += 3) {
      this.px[i] = c[0];
      this.px[i + 1] = c[1];
      this.px[i + 2] = c[2];
    }
  }
  shade(f: (u: number, v: number) => RGB) {
    const { w, h, px } = this;
    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / h;
      for (let x = 0; x < w; x++) {
        const c = f((x + 0.5) / w, v);
        const i = (y * w + x) * 3;
        px[i] = c[0];
        px[i + 1] = c[1];
        px[i + 2] = c[2];
      }
    }
  }
  sample(u: number, v: number): RGB {
    const { w, h, px } = this;
    const x = Math.min(Math.max(u * w - 0.5, 0), w - 1);
    const y = Math.min(Math.max(v * h - 0.5, 0), h - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    const fx = x - x0, fy = y - y0;
    const o: RGB = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const a = px[(y0 * w + x0) * 3 + c], b = px[(y0 * w + x1) * 3 + c];
      const d = px[(y1 * w + x0) * 3 + c], e = px[(y1 * w + x1) * 3 + c];
      const top = a + (b - a) * fx, bot = d + (e - d) * fx;
      o[c] = top + (bot - top) * fy;
    }
    return o;
  }
  composite(top: Canvas, blend: string, opacity: number) {
    const k = Math.min(Math.max(opacity, 0), 1);
    const d = this.px, s = top.px;
    for (let i = 0; i < d.length; i++) {
      const a = d[i], b = s[i];
      let m: number;
      switch (blend) {
        case "add": m = a + b; break;
        case "screen": m = 1 - (1 - a) * (1 - b); break;
        case "multiply": m = a * b; break;
        case "lighten": m = Math.max(a, b); break;
        case "mask": {
          const j = i - (i % 3);
          m = a * (0.2126 * s[j] + 0.7152 * s[j + 1] + 0.0722 * s[j + 2]);
          break;
        }
        default: m = b;
      }
      d[i] = a + (m - a) * k;
    }
  }
}

export interface Ctx {
  t: number;
  dt: number;
  aspect: number;
  bands: number[];
  level: number;
  beat: boolean;
  presses: { u: number; v: number }[];
  game: { active: boolean; health: number; team: string; sinceHit: number; sinceKill: number; flashed: number; burning: boolean; bomb: string };
}

export type Effect = (ctx: Ctx, p: Params, out: Canvas) => void;

// ---------- helpers ----------

export function hex(s: string | undefined, d = "#000000"): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec((s ?? d).trim()) ?? /^#?([0-9a-f]{6})$/i.exec(d)!;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function hsv(h: number, s: number, v: number): RGB {
  h = (((h % 1) + 1) % 1) * 6;
  const i = Math.floor(h), f = h - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  return ([[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]] as RGB[])[i % 6];
}
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const clamp = (x: number, a = 0, b = 1) => Math.min(Math.max(x, a), b);
function palette(stops: RGB[], t: number, wrap: boolean): RGB {
  const n = stops.length;
  if (n === 1) return stops[0];
  const segs = wrap ? n : n - 1;
  t = wrap ? ((t % 1) + 1) % 1 : clamp(t);
  const x = t * segs;
  const i = Math.min(Math.floor(x), segs - 1);
  return lerp(stops[i], stops[(i + 1) % n], x - i);
}
function hash(x: number, y: number, seed: number) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h & 0xffffff) / 0xffffff;
}
const sm = (t: number) => t * t * (3 - 2 * t);
function value2(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = sm(x - xi), yf = sm(y - yi);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  const top = a + (b - a) * xf, bot = c + (d - c) * xf;
  return top + (bot - top) * yf;
}
function fbm(x: number, y: number, oct: number, seed: number) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * value2(x * freq, y * freq, seed + o * 131);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}
const num = (p: Params, k: string, d: number) => (typeof p[k] === "number" ? (p[k] as number) : d);
const col = (p: Params, k: string, d: string) => hex(typeof p[k] === "string" ? (p[k] as string) : d, d);
const pick = (p: Params, k: string, d: string) => (typeof p[k] === "string" ? (p[k] as string) : d);
const flag = (p: Params, k: string, d: boolean) => (typeof p[k] === "boolean" ? (p[k] as boolean) : d);

const PALETTES: Record<string, string[]> = {
  quasar: ["#2ee6ff", "#7c5cff", "#ff3db8", "#ffb547"],
  ocean: ["#001a33", "#0066cc", "#2ee6ff", "#b3fff9"],
  lava: ["#1a0000", "#b30000", "#ff5a00", "#ffd000"],
  synth: ["#12002e", "#7c5cff", "#ff3db8", "#2ee6ff"],
  forest: ["#001a0d", "#00733a", "#7bd389", "#e6ff99"],
  mono: ["#000000", "#ffffff"],
};
const pal = (name: string) => (PALETTES[name] ?? PALETTES.quasar).map((h) => hex(h));

let seed = 0x9e3779b9;
const rnd = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return ((seed >>> 0) & 0xffffff) / 0x1000000;
};

function stamp(out: Canvas, aspect: number, r: number, pts: [number, number, RGB][]) {
  const { w, h, px } = out;
  const rx = Math.max((r / aspect) * w, 1), ry = Math.max(r * h, 1);
  for (const [u, v, c] of pts) {
    const cx = u * w, cy = v * h;
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(h, Math.ceil(cy + ry)); y++)
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(w, Math.ceil(cx + rx)); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          const k = (1 - d2) ** 2, i = (y * w + x) * 3;
          for (let ch = 0; ch < 3; ch++) px[i + ch] = Math.min(px[i + ch] + c[ch] * k, 1.5);
        }
      }
  }
}

// ---------- effects ----------

const makers: Record<string, () => Effect> = {
  solid: () => (_c, p, o) => o.fill(col(p, "color", "#7c5cff")),
  breathing: () => (c, p, o) => {
    const s = 0.5 - 0.5 * Math.cos(c.t * num(p, "speed", 0.6) * Math.PI * 2);
    o.fill(lerp(col(p, "b", "#000000"), col(p, "a", "#2ee6ff"), sm(s)));
  },
  spectrum: () => (c, p, o) => o.fill(hsv(c.t * num(p, "speed", 0.08), num(p, "saturation", 1), 1)),
  "rainbow-wave": () => (c, p, o) => {
    const speed = num(p, "speed", 0.35), sc = num(p, "scale", 1), sat = num(p, "saturation", 1);
    const a = (num(p, "angle", 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const shape = pick(p, "shape", "linear");
    o.shade((u, v) => {
      const x = (u - 0.5) * c.aspect, y = v - 0.5;
      const d = shape === "radial" ? Math.hypot(x, y) : shape === "spiral" ? Math.hypot(x, y) + Math.atan2(y, x) / (Math.PI * 2) : (x * ca + y * sa) / c.aspect;
      return hsv(d * sc - c.t * speed, sat, 1);
    });
  },
  gradient: () => (c, p, o) => {
    const stops = [col(p, "a", "#2ee6ff"), col(p, "b", "#7c5cff"), col(p, "c", "#ff3db8")];
    const a = (num(p, "angle", 20) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), drift = num(p, "drift", 0.1);
    o.shade((u, v) => {
      const d = (u - 0.5) * ca + (v - 0.5) * sa + 0.5;
      if (drift <= 0) return palette(stops, d, false);
      const x = (((d + c.t * drift) % 2) + 2) % 2;
      return palette(stops, x > 1 ? 2 - x : x, false);
    });
  },
  comet: () => (c, p, o) => {
    const speed = num(p, "speed", 0.6), tail = Math.max(num(p, "tail", 0.35), 0.01), n = Math.max(num(p, "count", 1), 1);
    const rainbow = pick(p, "mode", "rainbow") === "rainbow", base = col(p, "color", "#2ee6ff");
    const head = (((c.t * speed) % 1) + 1) % 1;
    o.shade((u, v) => {
      const d = ((((head - u) * n) % 1) + 1) % 1 / n;
      const k = d < tail ? (1 - d / tail) ** 2.2 : 0;
      return scale(rainbow ? hsv(u * 0.6 + c.t * 0.05, 0.9, 1) : base, k * (1 - Math.abs(v - 0.5) * 0.4));
    });
  },
  plasma: () => (c, p, o) => {
    const pl = pal(pick(p, "palette", "quasar")), t = c.t * num(p, "speed", 0.4), s = num(p, "scale", 2.2);
    o.shade((u, v) => {
      const x = u * c.aspect * s, y = v * s;
      const a = Math.sin(x + t) + Math.sin(y * 1.3 - t * 0.7) + Math.sin((x + y + t) * 0.7);
      const r = Math.hypot(x - c.aspect * s * 0.5, y - s * 0.5);
      return palette(pl, (a + Math.sin(r * 1.6 - t * 1.3)) * 0.125 + 0.5, true);
    });
  },
  aurora: () => (c, p, o) => {
    const a = col(p, "a", "#00ffa3"), b = col(p, "b", "#7c5cff"), sky = col(p, "sky", "#020214"), t = c.t * num(p, "speed", 0.3);
    o.shade((u, v) => {
      const x = u * c.aspect;
      const center = 0.35 + (fbm(x * 1.4 + t * 0.6, t * 0.25, 4, 7) - 0.5) * 0.9;
      const band = Math.exp(-((v - center) ** 2) * 18);
      const shimmer = 0.6 + 0.4 * fbm(x * 9, v * 3 - t * 2, 2, 3);
      return lerp(sky, lerp(a, b, clamp(center - v + 0.5)), clamp(band * shimmer));
    });
  },
  fire: () => {
    let heat = new Float32Array(0), w = 0, h = 0;
    return (c, p, o) => {
      const W = Math.max(o.w >> 2, 4), H = Math.max(o.h >> 2, 4);
      if (W !== w || H !== h) { w = W; h = H; heat = new Float32Array(w * h); }
      const intensity = num(p, "intensity", 0.75), cooling = 0.02 + (1 - num(p, "cooling", 0.5)) * 0.12;
      const steps = clamp(Math.round(c.dt * 40), 1, 4);
      for (let s = 0; s < steps; s++) {
        for (let x = 0; x < w; x++) { const r = rnd(); heat[(h - 1) * w + x] = r < intensity ? 0.75 + r * 0.25 : r * 0.3; }
        for (let y = 0; y < h - 1; y++)
          for (let x = 0; x < w; x++) {
            const b = (y + 1) * w;
            const v = (heat[b + Math.max(x - 1, 0)] + heat[b + x] + heat[b + Math.min(x + 1, w - 1)] + heat[Math.min(y + 2, h - 1) * w + x]) * 0.25 - cooling * rnd();
            heat[y * w + x] = Math.max(v, 0);
          }
      }
      const pl = [[0, 0, 0] as RGB, ...pal(pick(p, "palette", "lava")).slice(1)];
      o.shade((u, v) => {
        const x = clamp(u * w - 0.5, 0, w - 1), y = clamp(v * h - 0.5, 0, h - 1);
        const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
        const fx = x - x0, fy = y - y0;
        const top = heat[y0 * w + x0] * (1 - fx) + heat[y0 * w + x1] * fx, bot = heat[y1 * w + x0] * (1 - fx) + heat[y1 * w + x1] * fx;
        return palette(pl, clamp(top * (1 - fy) + bot * fy), false);
      });
    };
  },
  starfield: () => {
    const stars: { u: number; v: number; age: number; life: number; hue: number }[] = [];
    const mk = (age: number) => ({ u: rnd(), v: rnd(), age, life: 0.8 + rnd() * 2.2, hue: rnd() });
    return (c, p, o) => {
      const target = Math.floor(num(p, "density", 0.35) * 120);
      while (stars.length < target) stars.push(mk(-rnd() * 2));
      stars.length = Math.min(stars.length, target);
      for (let i = 0; i < stars.length; i++) { stars[i].age += c.dt; if (stars[i].age > stars[i].life) stars[i] = mk(0); }
      const rainbow = pick(p, "mode", "solid") === "rainbow", cc = col(p, "color", "#ffffff");
      o.fill(col(p, "bg", "#05030f"));
      stamp(o, c.aspect, num(p, "size", 0.04), stars.filter((s) => s.age > 0).map((s) => [s.u, s.v, scale(rainbow ? hsv(s.hue, 0.8, 1) : cc, Math.sin((s.age / s.life) * Math.PI))]));
    };
  },
  "digital-rain": () => {
    let t = 0;
    return (c, p, o) => {
      t += c.dt * num(p, "speed", 1);
      const cols = Math.max(num(p, "columns", 28), 1), cc = col(p, "color", "#2eff8c");
      o.shade((u, v) => {
        const ci = Math.floor(u * cols);
        const head = ((t * (0.25 + hash(ci, 0, 11) * 0.6) + hash(ci, 1, 11) * 10) % 1.6) - 0.3;
        const d = head - v;
        if (d < 0 || d > 0.55) return [0, 0, 0];
        if (d < 0.025) return lerp(cc, [1, 1, 1], 0.7);
        return scale(cc, (1 - d / 0.55) ** 1.8 * (0.6 + 0.4 * hash(ci, Math.floor(v * 40), Math.floor(t * 8))));
      });
    };
  },
  nebula: () => (c, p, o) => {
    const pl = pal(pick(p, "palette", "synth")), t = c.t * num(p, "speed", 0.12), oct = num(p, "detail", 4), glow = num(p, "brightness", 1);
    o.shade((u, v) => {
      const x = u * c.aspect * 1.6, y = v * 1.6;
      const q = fbm(x + t, y - t * 0.5, oct, 1);
      const r = fbm(x + q * 1.8 - t * 0.3, y + q * 1.2, oct, 2);
      return scale(palette(pl, r * 1.4 + t * 0.2, true), (0.25 + r * r * 1.4) * glow);
    });
  },
  ripple: () => {
    let waves: { u: number; v: number; age: number; hue: number }[] = [];
    let idle = 0, n = 0;
    return (c, p, o) => {
      for (const pr of c.presses) { n++; waves.push({ u: pr.u, v: pr.v, age: 0, hue: (n * 0.137) % 1 }); idle = 0; }
      idle += c.dt;
      if (flag(p, "idle", true) && idle > 1.6) { idle = 0; n++; waves.push({ u: (n * 0.618) % 1, v: (n * 0.382 + 0.2) % 1, age: 0, hue: (n * 0.137) % 1 }); }
      const speed = num(p, "speed", 0.7);
      waves.forEach((w) => (w.age += c.dt));
      waves = waves.filter((w) => w.age * speed < 1.6).slice(-48);
      const bg = col(p, "bg", "#06040f"), cc = col(p, "color", "#2ee6ff"), width = Math.max(num(p, "width", 0.09), 0.005);
      const rainbow = pick(p, "mode", "rainbow") === "rainbow";
      o.shade((u, v) => {
        const out: RGB = [bg[0], bg[1], bg[2]];
        for (const w of waves) {
          const r = w.age * speed, d = Math.hypot((u - w.u) * c.aspect, v - w.v), x = Math.abs(d - r) / width;
          if (x < 1) {
            const k = (1 - x * x) * Math.max(1 - r / 1.6, 0);
            const wc = rainbow ? hsv(w.hue + d * 0.4, 0.85, 1) : cc;
            out[0] += wc[0] * k; out[1] += wc[1] * k; out[2] += wc[2] * k;
          }
        }
        return out;
      });
    };
  },
  visualizer: () => {
    const smooth = new Array(16).fill(0);
    let pulse = 0;
    return (c, p, o) => {
      const gain = num(p, "gain", 1.4), s = num(p, "smoothing", 0.55);
      c.bands.forEach((b, i) => { const t = Math.min(b * gain, 1); smooth[i] = t > smooth[i] ? t : smooth[i] * s + t * (1 - s); });
      if (c.beat) pulse = 1;
      pulse = Math.max(pulse - c.dt * 2.5, 0);
      const pl = [col(p, "low", "#7c5cff"), col(p, "high", "#2ee6ff"), col(p, "peak", "#ff3db8")];
      const style = pick(p, "style", "bars");
      if (style === "pulse") {
        const bass = (smooth[0] + smooth[1] + smooth[2]) / 3;
        o.shade((u, v) => {
          const d = Math.hypot((u - 0.5) * c.aspect, v - 0.5), r = 0.15 + bass * 0.9 + pulse * 0.25, k = clamp(1 - d / Math.max(r, 0.01));
          return scale(palette(pl, 1 - k + c.level * 0.3, false), k ** 0.6 * (0.25 + 0.75 * Math.max(bass, pulse)));
        });
      } else if (style === "field") {
        o.shade((u, v) => scale(palette(pl, u, false), clamp(smooth[Math.min(Math.floor(u * 16), 15)] * (1.2 - Math.abs(v - 0.5) * 1.4))));
      } else {
        o.shade((u, v) => {
          const x = u * 16, i = Math.min(Math.floor(x), 15), hgt = smooth[i], y = 1 - v;
          if (Math.abs((x % 1) - 0.5) > 0.42 || y > hgt) return [0, 0, 0];
          return palette(pl, y, false);
        });
      }
    };
  },
  ambience: () => (c, p, o) => {
    // the browser cannot see your screen; show a slow sweep of a "film"
    const t = c.t * 0.15, gain = num(p, "brightness", 1);
    o.shade((u, v) => scale(lerp(hsv(0.58 + Math.sin(t) * 0.1, 0.7, 0.9), hsv(0.08 + Math.cos(t * 0.7) * 0.05, 0.8, 1), clamp(u + Math.sin(t + v * 2) * 0.3)), gain * (0.6 + 0.4 * fbm(u * 3 + t, v * 2, 2, 4))));
  },
  "game-pulse": () => (c, p, o) => {
    const g = c.game;
    if (!g.active) { o.fill(scale(col(p, "idle", "#7c5cff"), 0.3 + 0.4 * (0.55 + 0.45 * Math.sin(c.t * 1.2)))); return; }
    const team = g.team === "T" ? col(p, "t", "#ffb547") : col(p, "ct", "#2e8bff");
    const hit = clamp(1 - g.sinceHit / 0.5), kill = clamp(1 - g.sinceKill / 0.6);
    const bomb = g.bomb === "planted" ? 0.5 + 0.5 * Math.sin(c.t * 9) : g.bomb === "exploded" ? 1 : 0;
    const beat = g.health < 0.25 && g.health > 0 ? 0.5 + 0.5 * Math.sin(c.t * 7) : 0;
    const bar = flag(p, "health_bar", true);
    o.shade((u, v) => {
      let cc = scale(team, 0.35);
      if (bar && v > 0.82) cc = u <= g.health ? lerp([1, 0.1, 0.1], [0.2, 1, 0.4], g.health) : [0.05, 0, 0];
      if (g.burning) cc = lerp(cc, [1, 0.35, 0], fbm(u * 6, v * 3 + c.t * 3, 3, 9) * (1 - v * 0.5));
      cc = lerp(cc, [1, 0, 0], beat * 0.6);
      cc = lerp(cc, [1, 0, 0.05], hit);
      cc = lerp(cc, [1, 0.85, 0.2], bomb * 0.8);
      cc = lerp(cc, [1, 1, 1], kill * 0.5 * (1 - v));
      return lerp(cc, [1, 1, 1], g.flashed);
    });
  },
};

export function createEffect(id: string): Effect | null {
  return makers[id]?.() ?? null;
}

export function idleCtx(t: number, dt: number, aspect: number): Ctx {
  // synthetic music so audio effects look alive without a microphone
  const beat = Math.sin(t * Math.PI * 4) > 0.97;
  const bands = Array.from({ length: 16 }, (_, i) => clamp(0.35 + 0.35 * Math.sin(t * (2 + i * 0.37) + i) * (1 - i / 24) + (i < 3 ? 0.3 * Math.max(Math.sin(t * Math.PI * 4), 0) : 0)));
  return {
    t, dt, aspect, bands, level: bands.reduce((a, b) => a + b, 0) / 16, beat, presses: [],
    game: { active: false, health: 1, team: "CT", sinceHit: 9, sinceKill: 9, flashed: 0, burning: false, bomb: "none" },
  };
}
