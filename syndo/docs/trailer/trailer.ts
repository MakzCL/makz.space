// SEND trailer: a deterministic timeline. window.frame(t) draws exactly the moment t (seconds).
import { Sim, getRenderer } from "/home/user/makz.space/syndo/web/src/appearance/motion/engine.ts";
import { sceneFor } from "/home/user/makz.space/syndo/web/src/appearance/motion/recipes.ts";

const W = 1280, H = 720, FPS = 30;
const $ = <T extends HTMLElement = HTMLElement>(html: string): T => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild as T; };
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const easeIO = (x: number) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const spring = (x: number) => { x = clamp(x); return 1 - Math.exp(-6 * x) * Math.cos(9 * x); };
const win = (t: number, a: number, b: number, fade = .4) => clamp((t - a) / fade) * clamp((b - t) / fade);
const stage = document.getElementById("stage")!;

// ---------------------------------------------------------------- live profile cards & decorations
const r = getRenderer()!;
class Card {
  el: HTMLElement; back: HTMLCanvasElement; front: HTMLCanvasElement; sim: Sim; t0: number;
  constructor(id: string, name: string, w: number, h: number, t0: number, color = "#fff") {
    this.t0 = t0;
    this.el = $(`<div class="card" style="width:${w}px;height:${h}px"><canvas class="cb"></canvas><div class="banner"></div><div class="av" style="width:${w * .25}px;height:${w * .25}px;left:${w * .045}px;top:${h * .227 - w * .125}px"></div>
      <div class="cbody" style="top:${h * .227 + w * .14}px;left:${w * .05}px;font-size:${w * .062}px"><b style="color:${color}">${name}</b><span>@${name.toLowerCase()}</span><i style="width:${w * .55}px"></i><i style="width:${w * .4}px"></i></div><canvas class="cf"></canvas></div>`);
    this.back = this.el.querySelector(".cb")!; this.front = this.el.querySelector(".cf")!;
    for (const c of [this.back, this.front]) { c.width = w * 1.5; c.height = h * 1.5; }
    this.sim = new Sim(sceneFor(id)!.scene, "card", .41); this.sim.resize(w, h, { x: w * .045 + w * .125, y: h * .227 });
  }
  started = false;
  draw(t: number, dt: number) {
    const lt = t - this.t0; if (lt < 0) return;
    if (!this.started) { this.started = true; this.sim.intro(); }
    this.sim.step(dt);
    const k = Math.min(1, lt / 1.6);
    r.draw(this.sim, "back", this.back.getContext("2d")!, this.back.width, this.back.height, k);
    r.draw(this.sim, "front", this.front.getContext("2d")!, this.front.width, this.front.height, k);
  }
}
class Deco {
  el: HTMLElement; c: HTMLCanvasElement; sim: Sim;
  constructor(id: string, size: number, hue: string, label: string) {
    this.el = $(`<div class="deco" style="width:${size}px;height:${size}px"><div class="dav" style="background:${hue}">${label}</div><canvas></canvas></div>`);
    this.c = this.el.querySelector("canvas")!; this.c.width = this.c.height = size * 1.4 * 1.5;
    this.sim = new Sim(sceneFor(id)!.scene, "deco", .2); this.sim.resize(size * 1.4, size * 1.4); this.sim.warm(1);
  }
  draw(dt: number) { this.sim.step(dt); r.draw(this.sim, "deco", this.c.getContext("2d")!, this.c.width, this.c.height, 1); }
}

// ---------------------------------------------------------------- scenes
const bg = $(`<div class="bg"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="grain"></div></div>`); stage.append(bg);
const flash = $(`<div class="flash"></div>`);

// S1: logo
const s1 = $(`<div class="scene s1"><img class="logo" src="assets/send-wordmark-white.svg"><div class="tag">Talk. Play. Share. <em>Together.</em></div></div>`); stage.append(s1);

// S2: profiles come alive
const s2 = $(`<div class="scene s2"><div class="head"><div class="kicker">PROFILE EFFECTS</div><h1><span>Profiles</span><span>that come</span><span class="grad">alive.</span></h1></div><div class="cards"></div></div>`); stage.append(s2);
const s2cards = [new Card("eclipse", "Makz", 250, 344, 4.3, "#c9dcf0"), new Card("bundle-28", "Holo", 250, 344, 4.7, "#7fc4ff"), new Card("bundle-431", "Pepee", 250, 344, 5.1, "#ff4fa3")];
for (const c of s2cards) s2.querySelector(".cards")!.append(c.el);

// S3: 432 collections wall
const wallIds = ["bundle-297", "bundle-151", "bundle-6", "bundle-204", "bundle-193", "bundle-145", "bundle-418", "bundle-187", "bundle-406", "bundle-424", "bundle-4", "emberwake", "glacial", "sakura", "bundle-72", "bundle-432", "bundle-3", "bundle-86"];
const s3 = $(`<div class="scene s3"><div class="wall"></div><div class="veil"></div><div class="count"><b>0</b><span>collections.</span><em>Every one of them free.</em></div></div>`); stage.append(s3);
const wallCards = wallIds.map((id, i) => new Card(id, ["Ava", "Kai", "Mo", "Zee", "Rin", "Sol"][i % 6]!, 150, 206, 11 + (i % 6) * .08));
for (const c of wallCards) s3.querySelector(".wall")!.append(c.el);

// S4: decorations
const s4 = $(`<div class="scene s4"><div class="kicker">AVATAR DECORATIONS</div><h2>Your avatar, <span class="grad">in motion.</span></h2><div class="decos"></div></div>`); stage.append(s4);
const decoIds: [string, string, string][] = [["emberwake", "#e4542a", "PE"], ["glacial", "#4084cf", "KI"], ["rosecourt", "#b2446f", "AV"], ["gilded", "#9a7649", "MO"], ["bundle-431", "#c2185b", "HO"], ["lepidoptera", "#8575db", "ZE"]];
const decos = decoIds.map(([id, c, l]) => new Deco(id, 118, c, l));
for (const d of decos) s4.querySelector(".decos")!.append(d.el);

// S5: SEND Studio
const s5 = $(`<div class="scene s5"><div class="head"><div class="kicker">SEND STUDIO</div><h2>Make the <span class="grad">whole app</span> yours.</h2><p>Themes, glass, wallpapers, layouts. Per server. Per chat.</p></div><div class="shots"></div></div>`); stage.append(s5);
const shots = ["studio", "theme-neon", "theme-paper", "theme-terminal", "theme-aurora"].map((n) => { const im = $(`<img class="shot" src="shots/${n}.png">`); s5.querySelector(".shots")!.append(im); return im; });

// S6: in the app
const s6 = $(`<div class="scene s6"><img class="app a1" src="shots/chat.png"><img class="app a2" src="shots/profile.png"><div class="cap">Everyone sees it. <span class="grad">Everywhere.</span></div></div>`); stage.append(s6);

// S7: feature reel
const feats = [["🖥️", "HD screen share", "1080p60 with sound, free"], ["🪟", "Pop out any call", "DMs and groups too"], ["🎙️", "AI noise suppression", "built right in"], ["🌍", "Worldwide voice", "servers across the globe"], ["🎮", "Game audio only", "in the Windows app"], ["🎨", "A theme per server", "and per conversation"], ["😄", "7TV & BTTV emotes", "everywhere you type"], ["🧩", "Movable call tiles", "drag them where you like"]];
const s7 = $(`<div class="scene s7"><h2>And it doesn't stop there.</h2><div class="grid">${feats.map(([i, a, b]) => `<div class="feat"><span>${i}</span><b>${a}</b><small>${b}</small></div>`).join("")}</div></div>`); stage.append(s7);

// S8: no paywalls
const s8 = $(`<div class="scene s8"><div class="big"><span>No paywalls.</span><span>No upgrades.</span><span class="grad">Every feature, for everyone.</span></div></div>`); stage.append(s8);

// S9: end card
const s9 = $(`<div class="scene s9"><img class="logo" src="assets/send-wordmark-white.svg"><div class="url">send.makz.space</div><div class="ctas"><span class="cta light">Download for Windows</span><span class="cta dark">Open in your browser</span></div></div>`); stage.append(s9);
stage.append(flash);

const set = (el: HTMLElement, o: number, tf = "") => { el.style.opacity = String(o); el.style.transform = tf; el.style.visibility = o <= .001 ? "hidden" : "visible"; };
const cuts = [4, 11, 17, 22, 30, 35, 41, 45.5];
let lastT = -1;

(window as any).DURATION = 50;
(window as any).frame = (t: number) => {
  const dt = lastT < 0 ? 1 / FPS : Math.max(0, t - lastT); lastT = t;
  // background drift
  bg.querySelectorAll<HTMLElement>(".blob").forEach((b, i) => { b.style.transform = `translate(${Math.sin(t * .23 + i * 2) * 120}px, ${Math.cos(t * .19 + i) * 80}px) scale(${1 + .15 * Math.sin(t * .3 + i)})`; });
  (bg.querySelector(".grain") as HTMLElement).style.backgroundPosition = `${(t * 997) % 200}px ${(t * 613) % 200}px`;
  // cut flashes
  let fl = 0; for (const c of cuts) fl = Math.max(fl, clamp(1 - Math.abs(t - c) / .18) * .55);
  flash.style.opacity = String(fl);

  // S1
  { const o = win(t, 0, 4, .5), k = spring((t - .3) / 1.4);
    set(s1, o); (s1.querySelector(".logo") as HTMLElement).style.transform = `scale(${.6 + .4 * k})`; (s1.querySelector(".logo") as HTMLElement).style.filter = `drop-shadow(0 0 ${40 * (1 - ease((t - .3) / 2))}px #7aa2ff)`;
    set(s1.querySelector(".tag")!, ease((t - 1.4) / .8), `translateY(${20 * (1 - ease((t - 1.4) / .8))}px)`); }
  // S2
  { const o = win(t, 4, 11); set(s2, o);
    s2.querySelectorAll<HTMLElement>("h1 span").forEach((sp, i) => set(sp, ease((t - 4.2 - i * .25) / .5), `translateY(${40 * (1 - ease((t - 4.2 - i * .25) / .5))}px)`));
    set(s2.querySelector(".kicker")!, ease((t - 4.1) / .4));
    s2cards.forEach((c, i) => { const k = spring((t - 4.3 - i * .4) / 1.1); set(c.el, clamp((t - 4.3 - i * .4) / .3), `translateY(${(1 - k) * 160}px) rotate(${(i - 1) * 4 * k}deg)`); if (o > 0) c.draw(t, dt); }); }
  // S3
  { const o = win(t, 11, 17); set(s3, o);
    (s3.querySelector(".wall") as HTMLElement).style.transform = `rotate(-8deg) translate(${-60 - (t - 11) * 28}px, ${-120 + (t - 11) * 6}px) scale(${1.05 + (t - 11) * .02})`;
    if (o > 0) wallCards.forEach((c) => c.draw(t, dt));
    const n = Math.round(432 * easeIO((t - 11.4) / 2.2)); (s3.querySelector(".count b") as HTMLElement).textContent = String(n);
    set(s3.querySelector(".count")!, ease((t - 11.2) / .5), `scale(${.9 + .1 * spring((t - 11.2) / 1)})`);
    set(s3.querySelector(".count em")!, ease((t - 13.8) / .6)); }
  // S4
  { const o = win(t, 17, 22); set(s4, o);
    set(s4.querySelector("h2")!, ease((t - 17.2) / .6), `translateY(${30 * (1 - ease((t - 17.2) / .6))}px)`); set(s4.querySelector(".kicker")!, ease((t - 17.1) / .4));
    decos.forEach((d, i) => { const k = spring((t - 17.5 - i * .15) / 1); set(d.el, clamp((t - 17.5 - i * .15) / .25), `scale(${.4 + .6 * k}) translateY(${Math.sin(t * 2 + i) * 6}px)`); if (o > 0) d.draw(dt); }); }
  // S5
  { const o = win(t, 22, 30); set(s5, o);
    set(s5.querySelector(".head")!, ease((t - 22.2) / .6), `translateX(${-40 * (1 - ease((t - 22.2) / .6))}px)`);
    const per = 1.5, idx = (t - 22.6) / per;
    shots.forEach((im, i) => { const d = idx - i; const k = ease(d * 2.2); const leave = clamp(d - 1);
      set(im, d < 0 ? 0 : 1, `translate(${(1 - k) * 380 - leave * 60}px, ${-leave * 40}px) rotate(${(1 - k) * 8 - leave * 4}deg) scale(${.92 + .08 * k - leave * .06})`); im.style.zIndex = String(10 + i); im.style.filter = `brightness(${1 - leave * .45})`; }); }
  // S6
  { const o = win(t, 30, 35); set(s6, o);
    const lt = t - 30; set(s6.querySelector(".a1")!, 1, `scale(${1.05 + lt * .03}) translate(${-lt * 6}px, 0)`);
    set(s6.querySelector(".a2")!, ease((lt - 1.6) / .6), `scale(${1.05 + lt * .03}) translate(${-lt * 6}px, 0)`);
    set(s6.querySelector(".cap")!, ease((lt - 2.2) / .6), `translateY(${20 * (1 - ease((lt - 2.2) / .6))}px)`); }
  // S7
  { const o = win(t, 35, 41); set(s7, o);
    set(s7.querySelector("h2")!, ease((t - 35.1) / .5));
    s7.querySelectorAll<HTMLElement>(".feat").forEach((f, i) => { const k = spring((t - 35.5 - i * .3) / .9); set(f, clamp((t - 35.5 - i * .3) / .2), `translateY(${(1 - k) * 50}px) scale(${.85 + .15 * k})`); }); }
  // S8
  { const o = win(t, 41, 45.5); set(s8, o);
    s8.querySelectorAll<HTMLElement>(".big span").forEach((sp, i) => { const k = ease((t - 41.2 - i * .7) / .5); set(sp, k, `translateY(${(1 - k) * 50}px) scale(${1 + (1 - k) * .2})`); }); }
  // S9
  { const o = clamp((t - 45.5) / .5); set(s9, o * clamp((50 - t) / .6 + .0001));
    (s9.querySelector(".logo") as HTMLElement).style.transform = `scale(${.8 + .2 * spring((t - 45.6) / 1.2)})`;
    set(s9.querySelector(".url")!, ease((t - 46.4) / .5)); set(s9.querySelector(".ctas")!, ease((t - 46.9) / .5), `translateY(${16 * (1 - ease((t - 46.9) / .5))}px)`); }
};
