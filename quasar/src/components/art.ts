// Detailed device renderings, drawn procedurally in millimetres.
//
// Every device is painted from its real layout (the same LED coordinates the
// engine samples), so the light lands exactly where the hardware has it.
// Hand-drawn rather than photos: LEDs must line up with the artwork, the
// art has to scale from a 60 px card to a full-width hero, and product
// photos would bring other companies' trademarks and licences with them.

import type { DeviceInfo, Led } from "../lib/types";

type Ctx = CanvasRenderingContext2D;
type RGB = [number, number, number];

export interface PaintOpts {
  /** px per mm */
  s: number;
  colors?: Uint8Array;
  /** draw key legends (only when large enough) */
  legends: boolean;
  t: number;
  highlight?: string | null;
}

const rgb = (c: RGB, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const ledColor = (colors: Uint8Array | undefined, i: number): RGB => (colors && i >= 0 && i * 3 + 2 < colors.length ? [colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]] : [24, 30, 40]);
const lum = (c: RGB) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
/** Lift dim colours a little so an unlit LED still reads as a diffuser. */
const lit = (c: RGB): RGB => [Math.max(c[0], 18), Math.max(c[1], 22), Math.max(c[2], 30)];

function lin(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  // roundRect throws on negative radii; real devices can be tiny
  w = Math.max(w, 0.01);
  h = Math.max(h, 0.01);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

function glow(ctx: Ctx, x: number, y: number, r: number, c: RGB, a = 0.55) {
  if (!(r > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgb(c, a));
  g.addColorStop(1, rgb(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A light pipe whose colour follows the LEDs along it. */
function diffuser(ctx: Ctx, pts: { p: number; c: RGB }[], x0: number, y0: number, x1: number, y1: number) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const { p, c } of pts) g.addColorStop(Math.min(Math.max(p, 0), 1), rgb(lit(c)));
  return g;
}

// ---------------------------------------------------------------- keyboard

function keyboard(ctx: Ctx, d: DeviceInfo, o: PaintOpts) {
  const L = d.layout;
  const pad = 9;
  // case: brushed aluminium top plate with a bevel
  rr(ctx, -pad, -pad, L.width + pad * 2, L.height + pad * 2, 7);
  ctx.fillStyle = lin(ctx, 0, -pad, 0, L.height + pad, [[0, "#2b3038"], [0.06, "#1b1f26"], [1, "#0e1116"]]);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 0.6;
  ctx.stroke();
  // recessed plate
  rr(ctx, -2.5, -2.5, L.width + 5, L.height + 5, 3);
  ctx.fillStyle = "#07090c";
  ctx.fill();

  // underglow: per key, light spilling around the cap onto the plate
  ctx.globalCompositeOperation = "lighter";
  L.leds.forEach((l, i) => {
    const c = ledColor(o.colors, i);
    if (lum(c) < 0.02) return;
    const w = l.w ?? 17, h = l.h ?? 17;
    rr(ctx, l.x - w / 2 - 1.4, l.y - h / 2 - 1.4, w + 2.8, h + 2.8, 3);
    ctx.fillStyle = rgb(c, 0.6);
    ctx.fill();
  });
  ctx.globalCompositeOperation = "source-over";

  // keycaps: skirt + dished top face + shine-through legend
  const fontPx = 3.4;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${fontPx}px Inter Variable, Inter, system-ui, sans-serif`;
  L.leds.forEach((l, i) => {
    const c = ledColor(o.colors, i);
    const w = l.w ?? 17, h = l.h ?? 17;
    const x = l.x - w / 2, y = l.y - h / 2;
    rr(ctx, x + 0.3, y + 0.3, w - 0.6, h - 0.6, 2.2);
    ctx.fillStyle = "#0c0e12";
    ctx.fill();
    const inset = 1.9;
    rr(ctx, x + inset, y + inset - 0.7, w - inset * 2, h - inset * 2, 1.8);
    ctx.fillStyle = lin(ctx, 0, y, 0, y + h, [[0, "#2c313a"], [1, "#1a1d23"]]);
    ctx.fill();
    // light bleeding through the translucent cap
    ctx.fillStyle = rgb(c, 0.13);
    ctx.fill();
    // a thin rim of light on the cap's front edge
    ctx.fillStyle = rgb(c, 0.85);
    ctx.fillRect(x + inset + 0.6, y + h - inset - 0.4, w - inset * 2 - 1.2, 0.5);
    if (o.legends && l.label) {
      const label = l.label.replace(/^Num(?=.)/, "");
      ctx.fillStyle = rgb(lit(c).map((v) => Math.min(255, v + 40)) as RGB, 0.95);
      const small = label.length > 3;
      if (small) ctx.font = `600 ${fontPx * 0.8}px Inter Variable, Inter, system-ui, sans-serif`;
      ctx.fillText(label, l.x, l.y - 0.8, w - 4);
      if (small) ctx.font = `600 ${fontPx}px Inter Variable, Inter, system-ui, sans-serif`;
    }
    if (o.highlight && o.highlight === l.label) {
      rr(ctx, x - 0.4, y - 0.4, w + 0.8, h + 0.8, 2.6);
      ctx.strokeStyle = "#ffb547";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  });
}

// ---------------------------------------------------------------- mouse

function mouse(ctx: Ctx, d: DeviceInfo, o: PaintOpts) {
  const { width: W, height: H } = d.layout;
  const shell = new Path2D();
  // top-down ergonomic shell: narrower nose, wider palm, slight thumb flare
  shell.moveTo(W * 0.5, 0);
  shell.bezierCurveTo(W * 0.86, 0, W * 0.98, H * 0.16, W * 0.97, H * 0.42);
  shell.bezierCurveTo(W * 0.96, H * 0.62, W * 1.0, H * 0.8, W * 0.88, H * 0.93);
  shell.bezierCurveTo(W * 0.76, H * 1.02, W * 0.24, H * 1.02, W * 0.12, H * 0.93);
  shell.bezierCurveTo(W * -0.02, H * 0.8, W * 0.04, H * 0.62, W * 0.03, H * 0.42);
  shell.bezierCurveTo(W * 0.02, H * 0.16, W * 0.14, 0, W * 0.5, 0);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 8 * o.s;
  ctx.fillStyle = lin(ctx, 0, 0, W, H, [[0, "#2a2f37"], [0.5, "#161a20"], [1, "#0c0e12"]]);
  ctx.fill(shell);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 0.6;
  ctx.stroke(shell);

  // side light pipes, coloured by the side LEDs
  const sides = d.layout.leds.map((l, i) => ({ l, c: ledColor(o.colors, i) })).filter(({ l }) => /^(Left|Right) \d/.test(l.label ?? ""));
  for (const side of ["Left", "Right"]) {
    const s = sides.filter(({ l }) => l.label!.startsWith(side));
    if (!s.length) continue;
    const ys = s.map(({ l }) => l.y);
    const y0 = Math.min(...ys) - 9, y1 = Math.max(...ys) + 9;
    const x = side === "Left" ? W * 0.055 : W * 0.945;
    ctx.lineCap = "round";
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = diffuser(ctx, s.map(({ l, c }) => ({ p: (l.y - y0) / (y1 - y0), c })), 0, y0, 0, y1);
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.quadraticCurveTo(side === "Left" ? x - 2 : x + 2, (y0 + y1) / 2, x, y1);
    ctx.stroke();
    ctx.globalCompositeOperation = "lighter";
    s.forEach(({ l, c }) => glow(ctx, x, l.y, 9, c, 0.35));
    ctx.globalCompositeOperation = "source-over";
  }

  // primary buttons split, with a groove for the wheel
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(W * 0.5, 2);
  ctx.lineTo(W * 0.5, H * 0.1);
  ctx.moveTo(W * 0.5, H * 0.33);
  ctx.lineTo(W * 0.5, H * 0.44);
  ctx.moveTo(W * 0.06, H * 0.44);
  ctx.quadraticCurveTo(W * 0.5, H * 0.5, W * 0.94, H * 0.44);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.moveTo(W * 0.5 + 0.8, 2);
  ctx.lineTo(W * 0.5 + 0.8, H * 0.1);
  ctx.stroke();

  // scroll wheel with lit rubber ridges
  const wi = d.layout.leds.findIndex((l) => l.label === "Scroll");
  const wl = d.layout.leds[wi] ?? { x: W / 2, y: H * 0.2 };
  const wc = ledColor(o.colors, Math.max(wi, 0));
  rr(ctx, wl.x - 5.5, wl.y - 11, 11, 22, 4);
  ctx.fillStyle = "#050608";
  ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, wl.x, wl.y, 12, wc, 0.5);
  ctx.globalCompositeOperation = "source-over";
  rr(ctx, wl.x - 3.2, wl.y - 9, 6.4, 18, 3);
  ctx.fillStyle = lin(ctx, wl.x - 3, 0, wl.x + 3, 0, [[0, "#15181d"], [0.5, "#3a404a"], [1, "#15181d"]]);
  ctx.fill();
  ctx.strokeStyle = rgb(lit(wc), 0.9);
  ctx.lineWidth = 0.45;
  for (let k = -7; k <= 7; k += 1.75) {
    ctx.beginPath();
    ctx.moveTo(wl.x - 2.6, wl.y + k);
    ctx.lineTo(wl.x + 2.6, wl.y + k);
    ctx.stroke();
  }
  // DPI button
  rr(ctx, W / 2 - 2.5, H * 0.37, 5, 4, 1.2);
  ctx.fillStyle = "#0a0c0f";
  ctx.fill();

  // palm logo: a lit emblem
  const li = d.layout.leds.findIndex((l) => l.label === "Logo");
  if (li >= 0) {
    const l = d.layout.leds[li], c = lit(ledColor(o.colors, li));
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, l.x, l.y, 16, c, 0.45);
    ctx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(-0.42);
    ctx.strokeStyle = rgb(c);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = rgb(c);
    ctx.beginPath();
    ctx.arc(l.x, l.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // soft top highlight
  ctx.save();
  ctx.clip(shell);
  ctx.fillStyle = lin(ctx, 0, 0, W * 0.6, H * 0.5, [[0, "rgba(255,255,255,0.10)"], [1, "rgba(255,255,255,0)"]]);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---------------------------------------------------------------- mouse mat

let cloth: CanvasPattern | null = null;
function clothPattern(ctx: Ctx) {
  if (cloth) return cloth;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const x = c.getContext("2d")!;
  x.fillStyle = "#0b0d11";
  x.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 260; i++) {
    x.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
    x.fillRect(Math.random() * 32, Math.random() * 32, 1, 1);
  }
  x.strokeStyle = "rgba(255,255,255,0.018)";
  for (let i = 0; i < 32; i += 2) {
    x.beginPath();
    x.moveTo(i, 0);
    x.lineTo(i, 32);
    x.stroke();
  }
  cloth = ctx.createPattern(c, "repeat");
  return cloth;
}

function mousepad(ctx: Ctx, d: DeviceInfo, o: PaintOpts) {
  const { width: W, height: H, leds } = d.layout;
  rr(ctx, 0, 0, W, H, 10);
  ctx.fillStyle = clothPattern(ctx) ?? "#0b0d11";
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fill();
  // RGB border: a lit rim following every LED, plus the stitching
  ctx.save();
  rr(ctx, 0, 0, W, H, 10);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  leds.forEach((l, i) => glow(ctx, l.x, l.y, 26, lit(ledColor(o.colors, i)), 0.5));
  ctx.restore();
  rr(ctx, 1.2, 1.2, W - 2.4, H - 2.4, 9);
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  rr(ctx, 5, 5, W - 10, H - 10, 7);
  ctx.setLineDash([2.4, 2.2]);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---------------------------------------------------------------- headset

function headset(ctx: Ctx, d: DeviceInfo, o: PaintOpts) {
  const { width: W, height: H, leds } = d.layout;
  // headband: outer steel band and inner padded strap
  ctx.lineCap = "round";
  const band = (w: number, style: string | CanvasGradient, inset: number) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(W * 0.12 + inset, H * 0.62);
    ctx.bezierCurveTo(W * 0.08 + inset, H * -0.06 + inset, W * 0.92 - inset, H * -0.06 + inset, W * 0.88 - inset, H * 0.62);
    ctx.stroke();
  };
  band(9, lin(ctx, 0, 0, 0, H * 0.6, [[0, "#3a404a"], [1, "#1a1e25"]]), 0);
  band(5, "#0d0f13", 7);
  ctx.setLineDash([1.6, 2]);
  band(0.5, "rgba(255,255,255,0.18)", 7);
  ctx.setLineDash([]);
  // sliders
  for (const x of [W * 0.115, W * 0.885]) {
    rr(ctx, x - 2.2, H * 0.5, 4.4, H * 0.2, 2);
    ctx.fillStyle = lin(ctx, x - 2, 0, x + 2, 0, [[0, "#4a515c"], [0.5, "#8a93a0"], [1, "#4a515c"]]);
    ctx.fill();
  }
  // two ear cups, each lit by the average of the LEDs on its side
  const avg = (sel: (x: number) => boolean): RGB => {
    const idx = leds.map((l, i) => (sel(l.x) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return idx.length === 0 && leds.length ? ledColor(o.colors, 0) : [24, 30, 40];
    const sum = idx.reduce((acc, i) => { const c = ledColor(o.colors, i); return [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]]; }, [0, 0, 0] as number[]);
    return sum.map((v) => Math.round(v / idx.length)) as RGB;
  };
  const cups = [
    { x: W * 0.1, c: lit(avg((x) => x < W / 2)) },
    { x: W * 0.9, c: lit(avg((x) => x >= W / 2)) },
  ];
  const cw = W * 0.17, ch = H * 0.27, cy = H * 0.79;
  for (const cup of cups) {
    const l = { x: cup.x, y: cy };
    const c = cup.c;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6 * o.s;
    rr(ctx, l.x - cw / 2 - 3, l.y - ch / 2 - 3, cw + 6, ch + 6, (cw + 6) / 2);
    ctx.fillStyle = "#0a0c10";
    ctx.fill();
    ctx.restore();
    rr(ctx, l.x - cw / 2, l.y - ch / 2, cw, ch, cw / 2);
    ctx.fillStyle = lin(ctx, l.x - cw / 2, 0, l.x + cw / 2, 0, [[0, "#1b1f26"], [0.5, "#2c323b"], [1, "#14171c"]]);
    ctx.fill();
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, l.x, l.y, cw, c, 0.4);
    ctx.globalCompositeOperation = "source-over";
    rr(ctx, l.x - cw / 2 + 2.5, l.y - ch / 2 + 2.5, cw - 5, ch - 5, (cw - 5) / 2);
    ctx.strokeStyle = rgb(c, 0.95);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    for (let gy = -ch / 2 + 9; gy < ch / 2 - 8; gy += 3.2)
      for (let gx = -cw / 2 + 8; gx < cw / 2 - 7; gx += 3.2) {
        if ((gx / (cw / 2 - 6)) ** 2 + (gy / (ch / 2 - 6)) ** 2 > 0.7) continue;
        ctx.beginPath();
        ctx.arc(l.x + gx, l.y + gy, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  // mic boom on the left cup
  {
    const left = { x: cups[0].x, y: cy };
    ctx.strokeStyle = "#20242b";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y + ch / 2 - 4);
    ctx.quadraticCurveTo(left.x + 8, H + 6, left.x + 34, H - 2);
    ctx.stroke();
    rr(ctx, left.x + 31, H - 5.5, 9, 7, 3);
    ctx.fillStyle = "#15181d";
    ctx.fill();
  }
}

// ---------------------------------------------------------------- fan

function fan(ctx: Ctx, d: DeviceInfo, o: PaintOpts) {
  const { width: W, leds } = d.layout;
  const c = W / 2;
  // frame with corner screw pads
  rr(ctx, 0, 0, W, W, 9);
  ctx.fillStyle = lin(ctx, 0, 0, W, W, [[0, "#20252d"], [1, "#0d1014"]]);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 0.6;
  ctx.stroke();
  for (const [x, y] of [[7.5, 7.5], [W - 7.5, 7.5], [7.5, W - 7.5], [W - 7.5, W - 7.5]]) {
    ctx.fillStyle = "#050608";
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(x, y, 3.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  const R = c - 4;
  // throat
  ctx.fillStyle = "#040507";
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.fill();
  // the LED ring, a continuous diffuser coloured by each LED
  const n = leds.length;
  ctx.lineWidth = 5;
  leds.forEach((l, i) => {
    const a0 = Math.atan2(l.y - c, l.x - c);
    const col = lit(ledColor(o.colors, i));
    ctx.strokeStyle = rgb(col);
    ctx.beginPath();
    ctx.arc(c, c, R - 3, a0 - Math.PI / n - 0.02, a0 + Math.PI / n + 0.02);
    ctx.stroke();
  });
  ctx.globalCompositeOperation = "lighter";
  leds.forEach((l, i) => glow(ctx, l.x, l.y, 16, lit(ledColor(o.colors, i)), 0.28));
  ctx.globalCompositeOperation = "source-over";
  // translucent blades, spinning
  const spin = o.t * 9;
  for (let b = 0; b < 9; b++) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(spin + (b * Math.PI * 2) / 9);
    ctx.beginPath();
    ctx.moveTo(14, -3);
    ctx.bezierCurveTo(28, -14, 44, -10, R - 8, 4);
    ctx.bezierCurveTo(44, 8, 28, 6, 14, 5);
    ctx.closePath();
    ctx.fillStyle = "rgba(200,210,225,0.10)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.restore();
  }
  // hub with a cap
  ctx.fillStyle = lin(ctx, c - 15, c - 15, c + 15, c + 15, [[0, "#2c323b"], [1, "#0f1216"]]);
  ctx.beginPath();
  ctx.arc(c, c, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.stroke();
  ctx.fillStyle = "#0a0c10";
  ctx.beginPath();
  ctx.arc(c, c, 9, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------- memory

function ram(ctx: Ctx, d: DeviceInfo, o: PaintOpts) {
  const { width: W, height: H, leds } = d.layout;
  // heatspreader seen from above: a slim fin with a light bar along its spine
  rr(ctx, -1.2, -2.5, W + 2.4, H + 5, 1.5);
  ctx.fillStyle = lin(ctx, -1, 0, W + 1, 0, [[0, "#14171c"], [0.5, "#2c323b"], [1, "#14171c"]]);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 0.3;
  ctx.stroke();
  const pts = leds.map((l, i) => ({ p: (l.y + 2) / (H + 4), c: ledColor(o.colors, i) }));
  rr(ctx, W / 2 - 2, -1, 4, H + 2, 2);
  ctx.fillStyle = diffuser(ctx, pts, 0, -2, 0, H + 2);
  ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  leds.forEach((l, i) => glow(ctx, l.x, l.y, 7, lit(ledColor(o.colors, i)), 0.35));
  ctx.globalCompositeOperation = "source-over";
}

// ---------------------------------------------------------------- GPU

function gpu(ctx: Ctx, d: DeviceInfo, o: PaintOpts) {
  const { width: W, height: H, leds } = d.layout;
  // shroud seen from the side, with the light bar along the top edge
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 6 * o.s;
  ctx.beginPath();
  ctx.moveTo(6, 2);
  ctx.lineTo(W - 4, 2);
  ctx.lineTo(W, 8);
  ctx.lineTo(W, H - 4);
  ctx.lineTo(W - 6, H);
  ctx.lineTo(10, H);
  ctx.lineTo(4, H - 6);
  ctx.closePath();
  ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, "#2a2f37"], [0.5, "#181b21"], [1, "#0d0f13"]]);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 0.6;
  ctx.stroke();
  // heatsink fins through the side vents
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 0.8;
  for (let x = 24; x < W - 16; x += 3.2) {
    ctx.beginPath();
    ctx.moveTo(x, 15);
    ctx.lineTo(x, H - 8);
    ctx.stroke();
  }
  // bracket and power connector
  rr(ctx, -7, -6, 6, H + 14, 1);
  ctx.fillStyle = lin(ctx, -7, 0, -1, 0, [[0, "#4a515c"], [1, "#7b8390"]]);
  ctx.fill();
  rr(ctx, W - 40, -4, 18, 6, 1);
  ctx.fillStyle = "#08090b";
  ctx.fill();
  // light bar
  const pts = leds.map((l, i) => ({ p: l.x / W, c: ledColor(o.colors, i) }));
  rr(ctx, 12, 4, W - 24, 4.5, 2);
  ctx.fillStyle = diffuser(ctx, pts, 0, 0, W, 0);
  ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  leds.forEach((l, i) => glow(ctx, l.x, 6, 14, lit(ledColor(o.colors, i)), 0.25));
  ctx.globalCompositeOperation = "source-over";
}

// ---------------------------------------------------------------- strips, generic

function strip(ctx: Ctx, d: DeviceInfo, o: PaintOpts) {
  const { width: W, height: H, leds } = d.layout;
  rr(ctx, -4, -2, W + 8, H + 4, (H + 4) / 2);
  ctx.fillStyle = lin(ctx, 0, -2, 0, H + 2, [[0, "#3a404a"], [0.5, "#1b1f26"], [1, "#2a2f37"]]);
  ctx.fill();
  const pts = leds.map((l, i) => ({ p: l.x / W, c: ledColor(o.colors, i) }));
  rr(ctx, 0, H / 2 - 2.2, W, 4.4, 2.2);
  ctx.fillStyle = diffuser(ctx, pts, 0, 0, W, 0);
  ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  leds.forEach((l, i) => glow(ctx, l.x, l.y, 22, lit(ledColor(o.colors, i)), 0.22));
  ctx.globalCompositeOperation = "source-over";
}

function generic(ctx: Ctx, d: DeviceInfo, o: PaintOpts) {
  const { width: W, height: H, leds } = d.layout;
  rr(ctx, -4, -4, W + 8, H + 8, 5);
  ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, "#20252d"], [1, "#0d1014"]]);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 0.6;
  ctx.stroke();
  leds.forEach((l: Led, i) => {
    const c = lit(ledColor(o.colors, i));
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, l.x, l.y, 9, c, 0.4);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = rgb(c);
    ctx.beginPath();
    ctx.arc(l.x, l.y, 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

const PAINTERS: Partial<Record<DeviceInfo["kind"], (ctx: Ctx, d: DeviceInfo, o: PaintOpts) => void>> = {
  keyboard,
  keypad: keyboard,
  mouse,
  mousepad,
  headset,
  fan,
  cooler: fan,
  ram,
  gpu,
  "led-strip": strip,
  light: strip,
};

/** Extra margin (mm) the art draws outside the LED layout box. */
export function overhang(kind: DeviceInfo["kind"]): number {
  return kind === "keyboard" || kind === "keypad" ? 9 : kind === "gpu" ? 7 : kind === "headset" ? 6 : 4;
}

export function paintDevice(ctx: Ctx, d: DeviceInfo, o: PaintOpts) {
  const painter = PAINTERS[d.kind] ?? generic;
  ctx.save();
  try {
    painter(ctx, d, o);
  } catch (e) {
    // an unexpected layout must never take the UI down: fall back to dots
    ctx.restore();
    ctx.save();
    if (!warned.has(d.id)) {
      warned.add(d.id);
      console.warn(`QUASAR: detailed art failed for ${d.name}`, e);
    }
    generic(ctx, d, o);
  } finally {
    ctx.restore();
  }
}
const warned = new Set<string>();

/** Draw order on the desk: mats under everything, then peripherals. */
export const zOrder = (k: DeviceInfo["kind"]) => (k === "mousepad" ? 0 : k === "led-strip" ? 1 : 2);
