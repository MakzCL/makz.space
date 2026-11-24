import "@fontsource-variable/inter";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/jetbrains-mono";
import "./style.css";
import { Canvas, createEffect, idleCtx, type Params } from "../src/lib/fx";

declare const __VERSION__: string;
const VERSION = __VERSION__;
const REPO = "https://github.com/MakzCL/makz.space";
const TAG = `quasar-v${VERSION}`;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- downloads -------------------------------------------------------------
const files: Record<string, string> = {
  windows: `QUASAR_${VERSION}_x64-setup.exe`,
  msi: `QUASAR_${VERSION}_x64_en-US.msi`,
  mac: `QUASAR_${VERSION}_aarch64.dmg`,
  appimage: `QUASAR_${VERSION}_amd64.AppImage`,
  deb: `QUASAR_${VERSION}_amd64.deb`,
};
// The Windows beta is served from this site; the other platforms come from
// the GitHub release built by .github/workflows/quasar-release.yml.
const local: Record<string, string> = { windows: `/download/${files.windows}` };
document.querySelectorAll<HTMLAnchorElement>(".dl a").forEach((a) => (a.href = local[a.dataset.os!] ?? `${REPO}/releases/download/${TAG}/${files[a.dataset.os!]}`));
document.querySelectorAll<HTMLAnchorElement>("a.rel").forEach((a) => (a.href = `${REPO}/releases/tag/${TAG}`));
document.querySelectorAll(".ver").forEach((e) => (e.textContent = VERSION));
const ua = navigator.userAgent;
const cta = document.getElementById("cta-download") as HTMLAnchorElement;
if (/Mac/.test(ua)) cta.textContent = "Download for macOS";
else if (/Linux/.test(ua) && !/Android/.test(ua)) cta.textContent = "Download for Linux";
cta.addEventListener("click", (e) => {
  if (!/Mac|Linux/.test(ua) || /Android/.test(ua)) {
    e.preventDefault();
    location.href = local.windows;
  }
});

// ---- sky: the Nebula effect itself, low-res and blurred by CSS --------------
function runEffect(el: HTMLCanvasElement, id: string, params: Params, w: number, h: number, fps = 30) {
  const fx = createEffect(id);
  if (!fx) return;
  el.width = w;
  el.height = h;
  const cv = new Canvas(w, h);
  const ctx = el.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(el);
  let last = performance.now();
  let acc = 0;
  let pt = 0;
  const step = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    acc += dt;
    if (visible && acc >= 1 / fps) {
      const c = idleCtx(now / 1000, acc, w / h);
      pt += acc;
      if (id === "game-pulse") {
        c.game = { active: true, health: 0.35 + 0.3 * Math.sin(now / 2400), team: "CT", sinceHit: (now / 1000) % 2.2, sinceKill: 9, flashed: 0, burning: false, bomb: (now / 1000) % 8 > 5 ? "planted" : "none" };
      }
      if (id === "ripple" && pt > 0.8) {
        pt = 0;
        c.presses = [{ u: Math.random(), v: Math.random() }];
      }
      fx(c, params, cv);
      acc = 0;
      const d = img.data;
      for (let i = 0, j = 0; i < cv.px.length; i += 3, j += 4) {
        d[j] = Math.min(255, cv.px[i] * 255);
        d[j + 1] = Math.min(255, cv.px[i + 1] * 255);
        d[j + 2] = Math.min(255, cv.px[i + 2] * 255);
        d[j + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
    if (!reduce) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

runEffect(document.getElementById("sky") as HTMLCanvasElement, "nebula", { palette: "synth", speed: 0.08, brightness: 0.9 }, 64, 40, 24);
document.querySelectorAll<HTMLCanvasElement>("canvas.fx").forEach((c) => runEffect(c, c.dataset.effect!, JSON.parse(c.dataset.params ?? "{}"), 96, 54));

// ---- effect strip ----------------------------------------------------------
const lib: [string, string, Params][] = [
  ["nebula", "Nebula", { palette: "synth" }],
  ["rainbow-wave", "Rainbow Wave", {}],
  ["ripple", "Keystroke Ripple", {}],
  ["aurora", "Aurora", {}],
  ["plasma", "Plasma", {}],
  ["fire", "Fire", {}],
  ["visualizer", "Audio Visualizer", { style: "field" }],
  ["digital-rain", "Digital Rain", {}],
  ["starfield", "Starfield", { mode: "rainbow" }],
  ["comet", "Comet", {}],
  ["gradient", "Gradient", {}],
  ["spectrum", "Spectrum Cycle", {}],
  ["breathing", "Breathing", {}],
  ["ambience", "Screen Ambience", {}],
  ["game-pulse", "Game Pulse", {}],
  ["solid", "Solid", {}],
];
const strip = document.getElementById("strip")!;
for (const [id, name, params] of lib) {
  const fig = document.createElement("figure");
  const c = document.createElement("canvas");
  const cap = document.createElement("figcaption");
  cap.textContent = name;
  fig.append(c, cap);
  strip.append(fig);
  runEffect(c, id, params, 64, 40, 24);
}

// ---- brands marquee ----------------------------------------------------------
const brands = ["Razer", "Logitech", "Corsair", "SteelSeries", "ASUS Aura", "MSI", "Gigabyte", "HyperX", "Lian Li", "G.Skill", "NZXT", "Cooler Master", "Thermaltake", "Roccat", "Wooting", "Kingston", "EVGA", "Glorious", "Philips Hue", "Nanoleaf"];
const marquee = document.getElementById("brands")!;
marquee.innerHTML = [...brands, ...brands].map((b) => `<span>${b}</span>`).join("");

// ---- demo iframe: load on demand --------------------------------------------
const frame = document.getElementById("demo-frame") as HTMLIFrameElement;
const play = document.getElementById("demo-play")!;
const launch = () => {
  frame.src = frame.dataset.src!;
  play.remove();
};
play.addEventListener("click", launch);

// ---- reveal on scroll --------------------------------------------------------
const io = new IntersectionObserver(
  (es) =>
    es.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    }),
  { rootMargin: "0px 0px -10% 0px" },
);
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

// nav shadow once scrolled
const nav = document.querySelector(".nav")!;
addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 10), { passive: true });
