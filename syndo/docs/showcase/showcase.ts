// SEND showcase: a narrated walkthrough. window.frame(t) draws exactly the moment t (seconds); scene times follow the voiceover.
import { Sim, getRenderer } from "/home/user/makz.space/syndo/web/src/appearance/motion/engine.ts";
import { sceneFor } from "/home/user/makz.space/syndo/web/src/appearance/motion/recipes.ts";
import { TL } from "./tl.ts";

const FPS = 30;
const $ = <T extends HTMLElement = HTMLElement>(html: string): T => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild as T; };
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const easeIO = (x: number) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const spring = (x: number) => { x = clamp(x); return 1 - Math.exp(-6 * x) * Math.cos(9 * x); };
const stage = document.getElementById("stage")!;
const set = (el: Element | null, o: number, tf = "") => { if (!el) return; const e = el as HTMLElement; e.style.opacity = String(o); e.style.transform = tf; e.style.visibility = o <= .001 ? "hidden" : "visible"; };
const rise = (el: Element | null, lt: number, at: number, d = .55, px = 26) => { const k = ease((lt - at) / d); set(el, k, `translateY(${px * (1 - k)}px)`); };
const pop = (el: Element | null, lt: number, at: number, d = .9) => { const k = spring((lt - at) / d); set(el, clamp((lt - at) / .2), `scale(${.6 + .4 * k})`); };

// ---------------------------------------------------------------- live profile cards & decorations (the real SEND Motion engine)
const r = getRenderer()!;
class Card {
  el: HTMLElement; back: HTMLCanvasElement; front: HTMLCanvasElement; sim: Sim; started = false;
  constructor(id: string, name: string, w: number, h: number, public t0: number, color = "#fff") {
    this.el = $(`<div class="card" style="width:${w}px;height:${h}px"><canvas class="cb"></canvas><div class="banner"></div><div class="av" style="width:${w * .25}px;height:${w * .25}px;left:${w * .045}px;top:${h * .227 - w * .125}px"></div>
      <div class="cbody" style="top:${h * .227 + w * .14}px;left:${w * .05}px;font-size:${w * .062}px"><b style="color:${color}">${name}</b><span>@${name.toLowerCase()}</span><i style="width:${w * .55}px"></i><i style="width:${w * .4}px"></i></div><canvas class="cf"></canvas></div>`);
    this.back = this.el.querySelector(".cb")!; this.front = this.el.querySelector(".cf")!;
    for (const c of [this.back, this.front]) { c.width = w * 1.5; c.height = h * 1.5; }
    this.sim = new Sim(sceneFor(id)!.scene, "card", .41); this.sim.resize(w, h, { x: w * .045 + w * .125, y: h * .227 });
  }
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
const shot = (src: string, cls = "") => `<div class="win ${cls}"><div class="bar"><i></i><i></i><i></i></div><img src="img/${src}"></div>`;

// ---------------------------------------------------------------- scenes
const bg = $(`<div class="bg"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="grain"></div></div>`); stage.append(bg);
const flash = $(`<div class="flash"></div>`);
type Scene = { key: keyof typeof TL; el: HTMLElement; update: (lt: number, t: number, dt: number) => void };
const scenes: Scene[] = [];
const add = (key: keyof typeof TL, html: string, update: Scene["update"]) => { const el = $(html); stage.append(el); const s = { key, el, update }; scenes.push(s); return el; };

// 1 intro
add("intro", `<div class="scene c"><img class="logo" src="assets/send-wordmark-white.svg"><div class="tag">Talk. Play. Share. <em>Together.</em></div></div>`, (lt) => {
  const el = scenes[0]!.el, k = spring((lt - .3) / 1.4);
  const logo = el.querySelector(".logo") as HTMLElement; logo.style.transform = `scale(${.6 + .4 * k})`; logo.style.filter = `drop-shadow(0 0 ${40 * (1 - ease((lt - .3) / 2))}px #7aa2ff)`;
  rise(el.querySelector(".tag"), lt, 1.5, .8, 20);
});

// 2 profiles
const profCards = [new Card("fx-crimson-static", "Makz", 228, 314, 0, "#ff6b6b"), new Card("fx-liquid-platinum", "Ava", 228, 314, 0, "#e8ecf4"), new Card("fx-eternal-eclipse", "Kai", 228, 314, 0, "#ffd9a0")];
{ const el = add("profiles", `<div class="scene"><div class="head l"><div class="kicker">PROFILE EFFECTS</div><h1><span>Profiles</span><span>that come</span><span class="grad">alive.</span></h1><p>Open a profile and the effect plays its entrance, then loops.</p></div><div class="cards"></div></div>`, (lt, t, dt) => {
    el.querySelectorAll("h1 span").forEach((sp, i) => rise(sp, lt, .2 + i * .25, .5, 40)); rise(el.querySelector(".kicker"), lt, .1); rise(el.querySelector("p"), lt, 1.3);
    profCards.forEach((c, i) => { const at = .4 + i * .45, k = spring((lt - at) / 1.1); set(c.el, clamp((lt - at) / .3), `translateY(${(1 - k) * 160}px) rotate(${(i - 1) * 4 * k}deg)`); c.t0 = TL.profiles[0] + at; c.draw(t, dt); });
  });
  profCards.forEach((c) => el.querySelector(".cards")!.append(c.el)); }

// 3 catalogue wall
const wallIds = ["fx-bloodstorm", "fx-holo-glass", "fx-red-hot-rotors", "fx-tourbillon", "fx-drop-day", "fx-attract-mode", "fx-ringed-world", "fx-cursed-blade", "fx-wildfire", "fx-foxfire", "fx-laser-tunnel", "fx-glowing-bay",
  "fx-sleepy-cloud", "fx-dead-channel", "fx-iridescent-oil", "fx-lantern-night", "fx-reactor-core", "fx-golden-singularity"];
const wallCards = wallIds.map((id, i) => new Card(id, ["Ava", "Kai", "Mo", "Zee", "Rin", "Sol"][i % 6]!, 150, 206, 0));
const names = ["Red storms", "Fairy lights", "Liquid platinum", "Clockwork", "Eclipses"];
{ const el = add("catalogue", `<div class="scene"><div class="wall"></div><div class="veil"></div><div class="count"><b>0</b><span>bundles in 18 collections.</span><div class="names">${names.map((n) => `<em>${n}</em>`).join("")}</div></div></div>`, (lt, t, dt) => {
    (el.querySelector(".wall") as HTMLElement).style.transform = `rotate(-8deg) translate(${-60 - lt * 22}px, ${-120 + lt * 5}px) scale(${1.05 + lt * .015})`;
    wallCards.forEach((c, i) => { c.t0 = TL.catalogue[0] + (i % 6) * .08; c.draw(t, dt); });
    (el.querySelector(".count b") as HTMLElement).textContent = String(Math.round(432 * easeIO((lt - .4) / 2.4)));
    set(el.querySelector(".count"), ease((lt - .2) / .5), `scale(${.9 + .1 * spring((lt - .2) / 1)})`);
    el.querySelectorAll(".names em").forEach((e, i) => rise(e, lt, 3.4 + i * .95, .45, 14));
  });
  wallCards.forEach((c) => el.querySelector(".wall")!.append(c.el)); }

// 4 store walkthrough
{ const el = add("store", `<div class="scene"><div class="head l narrow"><div class="kicker">HOW IT WORKS</div><h2>Try it on.<br><span class="grad">Then make it yours.</span></h2>
    <ol class="steps"><li><b>1</b>Open <em>Profile effects</em></li><li><b>2</b>Tap any bundle to preview it on your card</li><li><b>3</b>Save when you love it</li><li><b>+</b>Mix one bundle's effect with another's decoration</li></ol></div>
    <div class="shots r">${shot("store.png", "s1")}${shot("store-grid.png", "s2")}</div></div>`, (lt) => {
    rise(el.querySelector(".kicker"), lt, .1); rise(el.querySelector("h2"), lt, .25, .6, 30);
    el.querySelectorAll(".steps li").forEach((li, i) => { const at = [1.3, 3.2, 5.6, 7.4][i]!; rise(li, lt, at, .5, 18); (li as HTMLElement).classList.toggle("on", lt > at && lt < ([3.2, 5.6, 7.4, 99][i]!)); });
    const s1 = el.querySelector(".s1"), s2 = el.querySelector(".s2"), k1 = ease((lt - .4) / .8), k2 = ease((lt - 3.4) / .8);
    set(s1, k1, `translateX(${(1 - k1) * 120 - k2 * 40}px) scale(${1 - k2 * .06}) rotate(${-k2 * 2}deg)`); (s1 as HTMLElement).style.filter = `brightness(${1 - k2 * .4})`;
    set(s2, k2, `translateX(${(1 - k2) * 160}px) translateY(${30 - lt * 2}px)`);
  }); }

// 5 decorations
const decoIds: [string, string, string][] = [["fx-clockwork-royalty", "#9b6b2e", "MA"], ["fx-liquid-platinum", "#5a6170", "AV"], ["fx-crimson-static", "#7a0b14", "KI"], ["fx-celestial-crown", "#3b4aa0", "RI"], ["fx-neon-circuit", "#1a6b8f", "MO"], ["fx-pixel-pet", "#b0508a", "ZE"]];
const decos = decoIds.map(([id, c, l]) => new Deco(id, 112, c, l));
{ const el = add("decos", `<div class="scene c"><div class="kicker">AVATAR DECORATIONS</div><h2>Your avatar, <span class="grad">everywhere.</span></h2><div class="decos"></div><div class="where"><span>Chat</span><span>Calls</span><span>Member lists</span></div></div>`, (lt, _t, dt) => {
    rise(el.querySelector(".kicker"), lt, .1); rise(el.querySelector("h2"), lt, .2, .6, 30);
    decos.forEach((d, i) => { const k = spring((lt - .5 - i * .15) / 1); set(d.el, clamp((lt - .5 - i * .15) / .25), `scale(${.4 + .6 * k}) translateY(${Math.sin(lt * 2 + i) * 6}px)`); d.draw(dt); });
    el.querySelectorAll(".where span").forEach((s, i) => rise(s, lt, 2.2 + i * .9, .45, 14));
  });
  decos.forEach((d) => el.querySelector(".decos")!.append(d.el)); }

// 6 studio
const studioShots = ["studio-gallery", "theme-send-neon", "theme-send-paper", "theme-send-terminal", "theme-send-aurora", "theme-send-glass"];
{ const el = add("studio", `<div class="scene"><div class="head l narrow"><div class="kicker">SEND STUDIO</div><h2>Restyle the<br><span class="grad">whole app.</span></h2><p>Themes, glass, wallpapers and layouts. A look for every server and every conversation.</p></div>
    <div class="shots r">${studioShots.map((s) => shot(s + ".png", "st")).join("")}</div></div>`, (lt) => {
    rise(el.querySelector(".kicker"), lt, .1); rise(el.querySelector("h2"), lt, .25, .6, 30); rise(el.querySelector("p"), lt, 1);
    const per = 1.45, idx = (lt - .5) / per;
    el.querySelectorAll<HTMLElement>(".st").forEach((im, i) => { const d = idx - i, k = ease(d * 2.2), leave = clamp(d - 1);
      set(im, d < 0 ? 0 : 1, `translate(${(1 - k) * 380 + leave * 30}px, ${-leave * 40}px) rotate(${(1 - k) * 8 - leave * 4}deg) scale(${.92 + .08 * k - leave * .06})`); im.style.zIndex = String(10 + i); im.style.filter = `brightness(${1 - leave * .45})`; });
  }); }

// 7 screen share
{ const el = add("share", `<div class="scene"><div class="shots full">${shot("share-dialog.png", "big")}</div>
    <div class="callouts"><div class="co c1"><b>HD</b><span>Up to 1080p at 60 fps</span></div><div class="co c2"><b>♪</b><span>With sound</span></div><div class="co c3"><b>✓</b><span>SEND's own audio left out, so nobody hears an echo</span></div></div>
    <div class="head tl"><div class="kicker">SCREEN SHARE</div><h2>Go live <span class="grad">in HD.</span></h2></div></div>`, (lt) => {
    rise(el.querySelector(".head"), lt, .1, .6, 20);
    const k = ease((lt - .2) / 1); set(el.querySelector(".big"), k, `scale(${.94 + .06 * k + lt * .004}) translateY(${(1 - k) * 40}px)`);
    el.querySelectorAll(".co").forEach((c, i) => pop(c, lt, [1.6, 4.6, 6.6][i]!));
  }); }

// 8 calls
{ const el = add("calls", `<div class="scene"><div class="shots full">${shot("call.png", "big")}</div>
    <div class="callouts"><div class="co c1"><b>⧉</b><span>Pop any call out into its own window</span></div><div class="co c2"><b>✥</b><span>Drag the tiles wherever you like</span></div>
      <div class="co c3 nz"><b>AI</b><span>Noise suppression</span><div class="wave"><div class="noisy">${Array.from({ length: 26 }, () => "<i></i>").join("")}</div><div class="clean">${Array.from({ length: 26 }, () => "<i></i>").join("")}</div></div></div></div>
    <div class="head tl"><div class="kicker">CALLS</div><h2>Calls that <span class="grad">just work.</span></h2></div></div>`, (lt) => {
    rise(el.querySelector(".head"), lt, .1, .6, 20);
    const k = ease((lt - .2) / 1); set(el.querySelector(".big"), k, `scale(${.94 + .06 * k + lt * .004}) translateY(${(1 - k) * 40}px)`);
    el.querySelectorAll(".co").forEach((c, i) => pop(c, lt, [1.2, 3.2, 5.4][i]!));
    const clean = clamp((lt - 7.4) / 1.2);
    el.querySelectorAll<HTMLElement>(".noisy i").forEach((b, i) => { const v = .25 + .75 * Math.abs(Math.sin(lt * 9 + i * 1.7) * Math.cos(lt * 5.3 + i)); b.style.height = `${(1 - clean) * v * 34 + 2}px`; });
    el.querySelectorAll<HTMLElement>(".clean i").forEach((b, i) => { const env = Math.max(0, Math.sin(lt * 3.1 + i * .35)); b.style.height = `${clean * (6 + env * 22 * (.6 + .4 * Math.sin(i * 2.3 + lt * 7))) + 2}px`; });
  }); }

// 9 world
const nodes = [[.18, .32], [.27, .38], [.47, .27], [.5, .33], [.56, .3], [.72, .42], [.82, .36], [.86, .66], [.33, .64], [.6, .55]];
{ const el = add("world", `<div class="scene"><div class="globe">${Array.from({ length: 900 }, (_, i) => { const x = (i % 45) / 45, y = Math.floor(i / 45) / 20; const land = Math.sin(x * 9.3 + y * 2) + Math.cos(y * 7.1 - x * 3) + Math.sin(x * 23 + y * 13) * .4 > .55; return land ? `<i style="left:${x * 100}%;top:${y * 100}%"></i>` : ""; }).join("")}
      ${nodes.map(([x, y]) => `<b style="left:${x! * 100}%;top:${y! * 100}%"></b>`).join("")}</div>
    <div class="head tl"><div class="kicker">EVERYWHERE</div><h2>Voice, <span class="grad">worldwide.</span></h2></div>
    <div class="feats"><div class="feat"><span>🎮</span><b>Game audio only</b><small>in the Windows app</small></div><div class="feat"><span>😄</span><b>7TV & BTTV emotes</b><small>everywhere you type</small></div></div></div>`, (lt) => {
    rise(el.querySelector(".head"), lt, .1, .6, 20); set(el.querySelector(".globe"), ease((lt - .1) / .8));
    el.querySelectorAll<HTMLElement>(".globe b").forEach((b, i) => { const k = spring((lt - .4 - i * .18) / .8); b.style.transform = `translate(-50%,-50%) scale(${k})`; b.style.boxShadow = `0 0 0 ${8 + 14 * ((lt * .8 + i * .13) % 1)}px rgba(122,162,255,${.35 * (1 - (lt * .8 + i * .13) % 1)})`; });
    el.querySelectorAll(".feat").forEach((f, i) => pop(f, lt, [3.6, 6.4][i]!));
  }); }

// 10 sparks
{ const el = add("sparks", `<div class="scene"><div class="head l narrow"><div class="kicker">SPARKS</div><h2>Play. Earn.<br><span class="grad">Boost.</span></h2>
    <div class="chal"><div><span>Invite 3 friends to SEND</span><em>+100</em></div><div><span>Join a call with 5 or more people</span><em>+100</em></div><div><span>Go live for 15 minutes</span><em>+100</em></div></div>
    <div class="bal"><span class="spark">✦</span><b>0</b> Sparks</div></div><div class="shots r">${shot("sparks.png", "s1")}${shot("sparks-after.png", "s2")}</div><div class="fly"></div></div>`, (lt) => {
    rise(el.querySelector(".kicker"), lt, .1); rise(el.querySelector("h2"), lt, .25, .6, 30);
    el.querySelectorAll(".chal div").forEach((d, i) => rise(d, lt, [3.1, 4.6, 6.2][i]!, .45, 16));
    rise(el.querySelector(".bal"), lt, 7.2, .45, 16);
    const n = Math.round(100 * easeIO((lt - 7.8) / 1.2)); (el.querySelector(".bal b") as HTMLElement).textContent = String(n);
    (el.querySelector(".bal") as HTMLElement).style.boxShadow = n > 0 && n < 100 ? "0 0 40px #ffb84d88" : "";
    const k1 = ease((lt - .4) / .8), k2 = ease((lt - 7.6) / .6);
    set(el.querySelector(".s1"), k1 * (1 - k2), `translateX(${(1 - k1) * 120}px)`); set(el.querySelector(".s2"), k2, "");
  }); }

// 11 boosts
{ const el = add("boosts", `<div class="scene c"><div class="kicker">SERVER BOOSTS</div><h2><span class="grad">100 Sparks</span> = 1 Boost</h2>
    <div class="track"><div class="fill"></div>${[[0, "Start"], [2, "Level 1"], [7, "Level 2"], [14, "Level 3"]].map(([n, l]) => `<div class="lv" style="left:${(n as number) / 14 * 100}%"><i></i><b>${l}</b><small>${n} boosts</small></div>`).join("")}</div>
    <div class="bnum"><b>0</b> boosts</div><div class="facts"><span>Each boost lasts a year</span><span>Enough challenges for Level 3</span><span>A new season every year</span></div></div>`, (lt) => {
    rise(el.querySelector(".kicker"), lt, .1); rise(el.querySelector("h2"), lt, .2, .6, 30);
    const p = easeIO((lt - 3.2) / 4.2), n = Math.round(14 * p);
    (el.querySelector(".fill") as HTMLElement).style.width = `${p * 100}%`; (el.querySelector(".bnum b") as HTMLElement).textContent = String(n);
    rise(el.querySelector(".track"), lt, 1.2, .6, 20); rise(el.querySelector(".bnum"), lt, 1.4, .6, 20);
    el.querySelectorAll<HTMLElement>(".lv").forEach((l, i) => l.classList.toggle("hit", n >= [0, 2, 7, 14][i]!));
    el.querySelectorAll(".facts span").forEach((s, i) => rise(s, lt, [2.2, 4.8, 8][i]!, .45, 14));
  }); }

// 12 free
{ const el = add("free", `<div class="scene c"><div class="big"><span>No paywalls.</span><span>No upgrades.</span><span class="grad">Every feature, for everyone.</span><span class="fr">SEND is completely free.</span></div></div>`, (lt) => {
    el.querySelectorAll(".big span").forEach((sp, i) => { const k = ease((lt - .3 - i * [0, .9, 1.8, 3.6][i]! / Math.max(i, 1)) / .5); set(sp, k, `translateY(${(1 - k) * 50}px) scale(${1 + (1 - k) * .2})`); });
  }); }

// 13 sponsor
{ const el = add("sponsor", `<div class="scene"><div class="head l narrow"><div class="kicker">SUPPORT SEND</div><h2>Help keep it<br><span class="grad">free for everyone.</span></h2>
    <div class="amts"><span>£1</span><span class="on">£5</span><span>£10</span><span>Custom</span></div><p class="small">A month, entirely optional. It keeps the servers running for everyone.</p></div>
    <div class="shots r">${shot("sponsor.png", "s1")}</div><div class="hearts">${Array.from({ length: 14 }, () => "<i>♥</i>").join("")}</div></div>`, (lt) => {
    rise(el.querySelector(".kicker"), lt, .1); rise(el.querySelector("h2"), lt, .25, .6, 30);
    el.querySelectorAll(".amts span").forEach((s, i) => pop(s, lt, 4.4 + i * .22, .8)); rise(el.querySelector("p"), lt, 6.4);
    const k = ease((lt - .4) / .9); set(el.querySelector(".s1"), k, `translateX(${(1 - k) * 120}px) scale(${.98 + lt * .003})`);
    el.querySelectorAll<HTMLElement>(".hearts i").forEach((h, i) => { const ph = ((lt * .18 + i * .071) % 1); h.style.transform = `translate(${Math.sin(i * 3.1 + lt) * 40}px, ${-ph * 720}px) scale(${.6 + (i % 3) * .3})`; h.style.left = `${55 + (i * 37) % 45}%`; h.style.opacity = String(clamp((lt - 1) / 1) * Math.sin(ph * Math.PI) * .5); });
  }); }

// 14 end card
{ const el = add("end", `<div class="scene c"><img class="logo" src="assets/send-wordmark-white.svg"><div class="url">send.makz.space</div><div class="ctas"><span class="cta light">Download for Windows</span><span class="cta dark">Open in your browser</span></div><div class="by">Made by MAKZ Labs</div></div>`, (lt) => {
    (el.querySelector(".logo") as HTMLElement).style.transform = `scale(${.8 + .2 * spring((lt - .1) / 1.2)})`;
    rise(el.querySelector(".url"), lt, .9, .5, 14); rise(el.querySelector(".ctas"), lt, 1.4, .5, 16); rise(el.querySelector(".by"), lt, 2.2, .5, 10);
  }); }
stage.append(flash);

const cuts = Object.values(TL).map((x) => x[0]).slice(1);
const total = TL.end[1];
let lastT = -1;
(window as any).DURATION = total;
(window as any).frame = (t: number) => {
  const dt = lastT < 0 ? 1 / FPS : Math.max(0, t - lastT); lastT = t;
  bg.querySelectorAll<HTMLElement>(".blob").forEach((b, i) => { b.style.transform = `translate(${Math.sin(t * .23 + i * 2) * 120}px, ${Math.cos(t * .19 + i) * 80}px) scale(${1 + .15 * Math.sin(t * .3 + i)})`; });
  (bg.querySelector(".grain") as HTMLElement).style.backgroundPosition = `${(t * 997) % 200}px ${(t * 613) % 200}px`;
  let fl = 0; for (const c of cuts) fl = Math.max(fl, clamp(1 - Math.abs(t - c) / .16) * .32); flash.style.opacity = String(fl);
  for (const s of scenes) {
    const [a, b] = TL[s.key], fade = .4;
    const o = s.key === "end" ? clamp((t - a) / .5) * clamp((b - t) / .8 + .0001) : clamp((t - a) / fade) * clamp((b - t) / fade);
    set(s.el, o, "");
    if (o > 0) s.update(t - a, t, dt);
  }
};
