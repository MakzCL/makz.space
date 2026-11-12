/**
 * Every collection's motion: hand-tuned archetypes (a moonlit storm with circling crows, an inferno, a frozen night…)
 * chosen per collection from its name, brief and category, coloured from its own artwork, and given extra details
 * its brief asks for (paw prints, coins, music notes, lightning…). Same collection, same scene, every time.
 */
import { PROFILE_CATALOG } from "@send/shared";
import { HERO, RING, SKY, type Col, type Emitter, type Scene } from "./engine.ts";
import palettes from "./palettes.json";

type Pal = [string, string, string];
type Arch = (p: Pal, v: number) => Omit<Scene, "palette">;
const DARK: Col = "#0a0a10";

const dust = (n = 16, colors: Col[] = ["c1", "w"], layer: "back" | "front" = "back"): Emitter => ({ sprite: "dust", behavior: "drift", count: n, size: [1.2, 2.6], blend: "add", colors, layer, glow: .5 });
const twinkles = (n = 14, colors: Col[] = ["w", "c1"], region: Emitter["region"] = "all"): Emitter => ({ sprite: "twinkle", behavior: "twinkle", count: n, size: [3, 7], blend: "add", colors, region, spin: .4, layer: "front" });
const orbit = (sprite: Emitter["sprite"], n: number, size: [number, number], colors: Col[], blend: "add" | "alpha" = "alpha", glow?: number): Emitter => ({ sprite, behavior: "orbit", count: n, size, colors, blend, glow });
const sparkle = (n = 4): Emitter => ({ sprite: "spark", behavior: "twinkle", count: n, size: [5, 9], blend: "add", colors: ["w", "c1"], region: "anchor", spin: .6 });

export const ARCHETYPES: Record<string, Arch> = {
  moonstorm: (_p, v) => ({
    sky: { mode: SKY.vortex, intensity: .95 }, hero: { kind: HERO.moon, x: .66, y: .14, r: .15 + v * .03, spin: .015 },
    emitters: [
      { sprite: "crow", behavior: "flock", count: 5, size: [6, 9], colors: ["#1b1d27"], layer: "back", fps: 8, alpha: .85 },
      { sprite: "crow", behavior: "flock", count: 7, size: [11, 17], colors: [DARK], layer: "front", fps: 9 },
      { sprite: "feather", behavior: "fall", count: 4, size: [6, 9], colors: ["#14151d"], tumble: true, spin: 1.2, speed: .7 },
      dust(14),
    ],
    intro: { burst: "feather", colors: ["#14151d", "c1"], count: 18 },
    deco: { ring: RING.shadow, emitters: [{ sprite: "crow", behavior: "flock", count: 3, size: [10, 13], colors: [DARK], fps: 9 }, dust(6, ["c1", "w"], "front")] },
  }),
  inferno: (_p, v) => ({
    sky: { mode: SKY.fire, intensity: .92 },
    emitters: [
      { sprite: "smoke", behavior: "rise", count: 5, size: [30, 48], colors: ["c3"], alpha: .5, layer: "back", speed: .5, spin: .3 },
      { sprite: "flame", behavior: "rise", count: 8 + v * 4, size: [9, 16], colors: ["c1"], toColor: "c2", blend: "add", region: "bottom", alpha: .55, life: [.8, 1.4], speed: 1.3 },
      { sprite: "ember", behavior: "rise", count: 38, size: [2, 4.5], colors: ["w", "c1"], toColor: "c2", blend: "add", glow: .6, speed: 1.5, spin: .2 },
    ],
    intro: { burst: "ember", colors: ["w", "c1"], count: 34, flash: true },
    deco: { ring: RING.flame, emitters: [{ sprite: "ember", behavior: "rise", count: 10, size: [1.5, 3], colors: ["w", "c1"], toColor: "c2", blend: "add", region: "anchor", glow: .6 }] },
  }),
  frost: () => ({
    sky: { mode: SKY.aurora, intensity: .82 },
    emitters: [
      { sprite: "snow", behavior: "fall", count: 26, size: [2, 3.5], colors: ["w"], alpha: .7, layer: "back", speed: .6, spin: .4 },
      { sprite: "snow", behavior: "fall", count: 14, size: [5, 9], colors: ["w"], spin: .5, tumble: true, glow: .25, blend: "add" },
      { sprite: "shard", behavior: "twinkle", count: 5, size: [6, 10], colors: ["c1", "w"], blend: "add", region: "edges", spin: .2 },
      twinkles(10, ["w", "c1"], "banner"),
    ],
    intro: { burst: "snow", colors: ["w", "c1"], count: 26 },
    deco: { ring: RING.ice, emitters: [{ sprite: "snow", behavior: "fall", count: 8, size: [2, 4], colors: ["w"], blend: "add", spin: .5 }, sparkle(3)] },
  }),
  blossom: () => ({
    sky: { mode: SKY.dreamy, intensity: .78 },
    emitters: [
      { sprite: "petal", behavior: "fall", count: 14, size: [3, 4.5], colors: ["c1", "w"], tumble: true, spin: 1.3, layer: "back", alpha: .8, speed: .7 },
      { sprite: "petal", behavior: "fall", count: 22, size: [5.5, 9], colors: ["c1", "w", "c2"], tumble: true, spin: 1.5 },
      dust(12, ["w", "c1"], "front"),
    ],
    intro: { burst: "petal", colors: ["c1", "w"], count: 30 },
    deco: { ring: RING.floral, emitters: [orbit("petal", 5, [6, 9], ["c1", "w"]), sparkle(2)] },
  }),
  enchanted: () => ({
    sky: { mode: SKY.nebula, intensity: .78 },
    emitters: [
      { sprite: "butterfly", behavior: "flutter", count: 3, size: [8, 11], colors: ["c2"], layer: "back", fps: 12, alpha: .8 },
      { sprite: "butterfly", behavior: "flutter", count: 5, size: [15, 21], colors: ["c1", "w"], fps: 14, glow: .3 },
      dust(18, ["c1", "w"], "front"), twinkles(8),
    ],
    intro: { burst: "spark", colors: ["c1", "w"], count: 28 },
    deco: { ring: RING.nebula, emitters: [orbit("butterfly", 2, [9, 12], ["c1", "w"], "alpha", .3), dust(5, ["c1", "w"], "front")] },
  }),
  abyss: () => ({
    sky: { mode: SKY.caustics, intensity: .9 },
    emitters: [
      { sprite: "bubble", behavior: "rise", count: 12, size: [2, 4], colors: ["w"], alpha: .6, layer: "back", speed: .7 },
      { sprite: "bubble", behavior: "rise", count: 16, size: [4, 8], colors: ["w", "c1"], alpha: .85, speed: 1 },
      dust(14, ["c1", "w"], "front"),
    ],
    intro: { burst: "bubble", colors: ["w", "c1"], count: 26 },
    deco: { ring: RING.water, emitters: [{ sprite: "bubble", behavior: "rise", count: 7, size: [2.5, 5], colors: ["w"], region: "anchor", alpha: .9 }] },
  }),
  cosmos: (_p, v) => ({
    sky: { mode: SKY.space, intensity: .95 }, hero: { kind: HERO.planet, x: .72, y: .13, r: .095 + v * .03 },
    emitters: [twinkles(18), { sprite: "dust", behavior: "comet", count: 1, size: [3, 4], colors: ["w", "c1"], blend: "add", trail: 16, angle: 155, layer: "back" }, dust(10)],
    intro: { burst: "star", colors: ["w", "c1"], count: 24 },
    deco: { ring: RING.nebula, emitters: [orbit("star", 4, [5, 7], ["w", "c1"], "add", .4), twinkles(4, ["w"], "anchor")] },
  }),
  eventhorizon: () => ({
    sky: { mode: SKY.nebula, intensity: .85 }, hero: { kind: HERO.blackhole, x: .62, y: .15, r: .15 },
    emitters: [{ sprite: "dust", behavior: "swirl", count: 70, size: [1.2, 2.8], colors: ["c1", "w", "c2"], blend: "add", layer: "back", glow: .4 }, twinkles(10)],
    intro: { burst: "spark", colors: ["w", "c1"], count: 26, flash: true },
    deco: { ring: RING.nebula, emitters: [orbit("dust", 12, [1.5, 3], ["c1", "w"], "add", .5)] },
  }),
  aurora: () => ({
    sky: { mode: SKY.aurora, intensity: .95 },
    emitters: [{ sprite: "snow", behavior: "fall", count: 18, size: [2, 4], colors: ["w"], alpha: .7, spin: .3, speed: .5 }, twinkles(12, ["w", "c1"], "banner")],
    intro: { burst: "spark", colors: ["c1", "c2"], count: 24 },
    deco: { ring: RING.nebula, emitters: [twinkles(5, ["w", "c1"], "anchor")] },
  }),
  neonrain: () => ({
    sky: { mode: SKY.neonrain, intensity: .95 },
    emitters: [
      { sprite: "streak", behavior: "streak", count: 40, size: [.8, 1.2], stretch: 12, colors: ["c1", "w"], blend: "add", alpha: .45, angle: 102, speed: 1 },
      { sprite: "glow", behavior: "drift", count: 6, size: [8, 16], colors: ["c1", "c2"], blend: "add", alpha: .25, layer: "back" },
    ],
    intro: { burst: "spark", colors: ["c1", "c2"], count: 26, flash: true },
    deco: { ring: RING.neon, emitters: [{ sprite: "streak", behavior: "streak", count: 8, size: [.6, .9], stretch: 8, colors: ["c1"], blend: "add", alpha: .5, angle: 100 }] },
  }),
  synthwave: () => ({
    sky: { mode: SKY.synth, intensity: .95 }, hero: { kind: HERO.sun, x: .5, y: .2, r: .12 },
    emitters: [twinkles(10, ["w", "c1"], "top"), { sprite: "streak", behavior: "streak", count: 4, size: [.8, 1.2], stretch: 30, colors: ["c1"], blend: "add", angle: 180, speed: 1.4, alpha: .6 }],
    intro: { burst: "spark", colors: ["c1", "c2"], count: 24 },
    deco: { ring: RING.neon, emitters: [sparkle(2)] },
  }),
  storm: () => ({
    sky: { mode: SKY.storm, intensity: .95 },
    emitters: [
      { sprite: "streak", behavior: "streak", count: 38, size: [.7, 1.1], stretch: 14, colors: ["w"], blend: "add", alpha: .3, angle: 104 },
      { sprite: "bolt", behavior: "lightning", count: 2, size: [1, 1], colors: ["c1"] },
    ],
    intro: { burst: "spark", colors: ["w", "c1"], count: 22, flash: true },
    deco: { ring: RING.electric, emitters: [sparkle(3)] },
  }),
  desert: () => ({
    sky: { mode: SKY.sand, intensity: .9 }, hero: { kind: HERO.sun, x: .76, y: .1, r: .085 },
    emitters: [
      { sprite: "streak", behavior: "streak", count: 22, size: [.8, 1.6], stretch: 14, colors: ["c1", "w"], blend: "add", alpha: .3, angle: 178, speed: .7 },
      { sprite: "dust", behavior: "drift", count: 26, size: [1.4, 3], colors: ["c1", "c2"], blend: "add", glow: .3, speed: 2.4 },
    ],
    intro: { burst: "dust", colors: ["c1", "w"], count: 34 },
    deco: { ring: RING.metal, emitters: [orbit("dust", 10, [1.4, 2.6], ["c1", "w"], "add", .4)] },
  }),
  speed: () => ({
    sky: { mode: SKY.neonrain, intensity: .9 },
    emitters: [
      { sprite: "streak", behavior: "streak", count: 34, size: [1, 2], stretch: 28, colors: ["c1", "w"], blend: "add", angle: 182, speed: 1.7, alpha: .95, glow: .25 },
      { sprite: "glow", behavior: "drift", count: 7, size: [10, 20], colors: ["c1", "c2"], blend: "add", alpha: .35, layer: "back" },
      { sprite: "ember", behavior: "streak", count: 10, size: [1.2, 2], stretch: 5, colors: ["w", "c1"], blend: "add", angle: 186, speed: 1.2, glow: .5 },
    ],
    intro: { burst: "spark", colors: ["w", "c1"], count: 28, flash: true },
    deco: { ring: RING.metal, emitters: [orbit("spark", 2, [5, 7], ["w", "c1"], "add")] },
  }),
  fireworks: () => ({
    sky: { mode: SKY.space, intensity: .8 },
    emitters: [{ sprite: "dust", behavior: "fireworks", count: 3, size: [3, 5], colors: ["c1", "c2", "w"], layer: "back" }, { sprite: "confetti", behavior: "fall", count: 10, size: [2.5, 4], colors: ["c1", "c2", "w"], tumble: true, spin: 3 }],
    intro: { burst: "confetti", colors: ["c1", "c2", "w"], count: 34, flash: true },
    deco: { ring: RING.neon, emitters: [twinkles(5, ["w", "c1", "c2"], "anchor")] },
  }),
  stadium: () => ({
    sky: { mode: SKY.rays, intensity: .9 },
    emitters: [{ sprite: "confetti", behavior: "fall", count: 30, size: [2.5, 4.5], colors: ["c1", "c2", "w"], tumble: true, spin: 3.2 }, twinkles(8, ["w"], "banner")],
    intro: { burst: "confetti", colors: ["c1", "c2", "w"], count: 40, flash: true },
    deco: { ring: RING.metal, emitters: [orbit("confetti", 6, [3, 4.5], ["c1", "c2", "w"]), sparkle(2)] },
  }),
  music: () => ({
    sky: { mode: SKY.holo, intensity: .75 },
    emitters: [{ sprite: "note", behavior: "rise", count: 10, size: [6, 10], colors: ["c1", "c2", "w"], glow: .4, spin: .5, speed: .8 }, { sprite: "glow", behavior: "drift", count: 8, size: [6, 14], colors: ["c1", "c2"], blend: "add", alpha: .3, layer: "back" }, twinkles(6)],
    intro: { burst: "note", colors: ["c1", "c2", "w"], count: 20 },
    deco: { ring: RING.neon, emitters: [orbit("note", 4, [6, 8], ["c1", "w"], "alpha", .3)] },
  }),
  haunted: () => ({
    sky: { mode: SKY.fog, intensity: .92 }, hero: { kind: HERO.moon, x: .72, y: .12, r: .1, spin: .01 },
    emitters: [
      { sprite: "bat", behavior: "flock", count: 9, size: [8, 13], colors: ["#07060a"], fps: 14 },
      { sprite: "wisp", behavior: "rise", count: 5, size: [14, 22], colors: ["c1"], blend: "add", alpha: .45, speed: .5 },
      dust(10, ["c1"], "front"),
    ],
    intro: { burst: "wisp", colors: ["c1", "w"], count: 14, flash: true },
    deco: { ring: RING.shadow, emitters: [{ sprite: "bat", behavior: "flock", count: 3, size: [8, 11], colors: ["#07060a"], fps: 14 }] },
  }),
  lovestruck: () => ({
    sky: { mode: SKY.dreamy, intensity: .75 },
    emitters: [{ sprite: "heart", behavior: "rise", count: 16, size: [7, 13], colors: ["c1", "c2", "w"], glow: .35, spin: .4, tumble: true, speed: .7 }, { sprite: "rose", behavior: "fall", count: 10, size: [5, 8], colors: ["c1", "c2"], tumble: true, spin: 1.3, speed: .7 }, twinkles(12, ["w", "c1"])],
    intro: { burst: "heart", colors: ["c1", "c2", "w"], count: 28 },
    deco: { ring: RING.none, emitters: [orbit("heart", 6, [8, 12], ["c1", "c2"], "alpha", .35), twinkles(4, ["w"], "anchor")] },
  }),
  gilded: () => ({
    sky: { mode: SKY.rays, intensity: .8 },
    emitters: [{ sprite: "glow", behavior: "drift", count: 8, size: [6, 14], colors: ["c1"], blend: "add", alpha: .3, layer: "back" }, { sprite: "coin", behavior: "fall", count: 10, size: [7, 11], colors: ["c1", "#f5d27a"], tumble: true, spin: 1.5, speed: .8 }, { sprite: "diamond", behavior: "twinkle", count: 6, size: [5, 8], colors: ["w", "c1"], blend: "add" }, twinkles(12, ["w", "#f7dc8f"])],
    intro: { burst: "spark", colors: ["w", "#f7dc8f"], count: 30, flash: true },
    deco: { ring: RING.metal, emitters: [sparkle(4)] },
  }),
  lanterns: () => ({
    sky: { mode: SKY.dreamy, intensity: .8 },
    emitters: [
      { sprite: "lantern", behavior: "rise", count: 7, size: [10, 17], colors: ["c1", "#ffb35c"], glow: .5, speed: .35, life: [8, 12] },
      { sprite: "firefly", behavior: "drift", count: 16, size: [3, 5], colors: ["c1", "#fff2a8"], blend: "add" },
      { sprite: "petal", behavior: "fall", count: 10, size: [4, 7], colors: ["c2", "w"], tumble: true, spin: 1.4 },
    ],
    intro: { burst: "firefly", colors: ["c1", "w"], count: 26 },
    deco: { ring: RING.floral, emitters: [{ sprite: "firefly", behavior: "drift", count: 6, size: [3, 4], colors: ["c1", "#fff2a8"], blend: "add", region: "anchor" }] },
  }),
  forest: () => ({
    sky: { mode: SKY.fog, intensity: .85 },
    emitters: [{ sprite: "leaf", behavior: "fall", count: 14, size: [5, 8], colors: ["c1", "c2"], tumble: true, spin: 1.6, speed: .7 }, { sprite: "firefly", behavior: "drift", count: 18, size: [3, 5], colors: ["c1", "#f4ffb0"], blend: "add" }],
    intro: { burst: "leaf", colors: ["c1", "c2"], count: 24 },
    deco: { ring: RING.floral, emitters: [orbit("leaf", 4, [6, 8], ["c1", "c2"]), { sprite: "firefly", behavior: "drift", count: 4, size: [3, 4], colors: ["c1"], blend: "add", region: "anchor" }] },
  }),
  autumn: () => ({
    sky: { mode: SKY.rays, intensity: .82 },
    emitters: [{ sprite: "maple", behavior: "fall", count: 18, size: [5, 9], colors: ["c1", "c2", "#e8752e", "#c9412b"], tumble: true, spin: 1.5, speed: .8 }, dust(10, ["#ffd38a"], "front")],
    intro: { burst: "maple", colors: ["c1", "#e8752e"], count: 24 },
    deco: { ring: RING.floral, emitters: [orbit("maple", 4, [6, 8], ["c1", "#e8752e"])] },
  }),
  pixie: () => ({
    sky: { mode: SKY.nebula, intensity: .75 },
    emitters: [
      { sprite: "star", behavior: "comet", count: 2, size: [3, 4.5], colors: ["w", "c1"], blend: "add", trail: 20, angle: 160, glow: .5 },
      twinkles(22, ["w", "c1", "c2"]), dust(12, ["w", "c1"], "front"),
    ],
    intro: { burst: "star", colors: ["w", "c1", "c2"], count: 30 },
    deco: { ring: RING.nebula, emitters: [orbit("star", 4, [5, 7], ["w", "c1"], "add", .4), twinkles(4, ["w"], "anchor")] },
  }),
  inkblade: () => ({
    sky: { mode: SKY.fog, intensity: .9 }, hero: { kind: HERO.sun, x: .72, y: .13, r: .1 },
    emitters: [
      { sprite: "petal", behavior: "fall", count: 16, size: [4, 7], colors: ["c1", "w"], tumble: true, spin: 1.6, speed: 1.1 },
      { sprite: "streak", behavior: "streak", count: 3, size: [1, 1.8], stretch: 40, colors: ["w", "c1"], blend: "add", angle: 200, speed: 1.6, alpha: .6 },
    ],
    intro: { burst: "petal", colors: ["c1", "w"], count: 26, flash: true },
    deco: { ring: RING.shadow, emitters: [orbit("petal", 4, [5, 8], ["c1", "w"])] },
  }),
  battlefield: () => ({
    sky: { mode: SKY.fog, intensity: .9 },
    emitters: [
      { sprite: "smoke", behavior: "rise", count: 6, size: [28, 44], colors: ["c3", "#4a4a4a"], alpha: .45, layer: "back", speed: .4, spin: .3 },
      { sprite: "ember", behavior: "rise", count: 24, size: [1.6, 3.4], colors: ["w", "c1"], toColor: "c2", blend: "add", glow: .5, speed: 1.2 },
      { sprite: "streak", behavior: "streak", count: 3, size: [.7, 1.1], stretch: 34, colors: ["c1", "#ffe08a"], blend: "add", angle: 186, speed: 2.2 },
    ],
    intro: { burst: "ember", colors: ["w", "c1"], count: 30, flash: true },
    deco: { ring: RING.shadow, emitters: [{ sprite: "ember", behavior: "rise", count: 8, size: [1.4, 2.6], colors: ["w", "c1"], toColor: "c2", blend: "add", region: "anchor", glow: .5 }] },
  }),
  aura: () => ({
    sky: { mode: SKY.fire, intensity: .62 },
    emitters: [
      { sprite: "flame", behavior: "rise", count: 10, size: [8, 14], colors: ["c1"], toColor: "c2", blend: "add", region: "anchor", alpha: .55, life: [.6, 1.1], speed: 1.6 },
      { sprite: "spark", behavior: "twinkle", count: 8, size: [5, 9], colors: ["w", "c1"], blend: "add", region: "anchor", spin: 1 },
      { sprite: "bolt", behavior: "lightning", count: 1, size: [1, 1], colors: ["c1"] },
    ],
    intro: { burst: "spark", colors: ["w", "c1"], count: 36, flash: true },
    deco: { ring: RING.electric, emitters: [{ sprite: "ember", behavior: "rise", count: 8, size: [1.6, 3], colors: ["w", "c1"], toColor: "c2", blend: "add", region: "anchor", glow: .6 }] },
  }),
  crystal: () => ({
    sky: { mode: SKY.holo, intensity: .7 },
    emitters: [{ sprite: "shard", behavior: "drift", count: 9, size: [6, 11], colors: ["c1", "w"], spin: .5, glow: .3, alpha: .9 }, { sprite: "diamond", behavior: "twinkle", count: 7, size: [5, 8], colors: ["w", "c1"], blend: "add" }, twinkles(10)],
    intro: { burst: "shard", colors: ["c1", "w"], count: 24, flash: true },
    deco: { ring: RING.ice, emitters: [orbit("diamond", 3, [5, 7], ["w", "c1"], "add")] },
  }),
  steam: () => ({
    sky: { mode: SKY.dreamy, intensity: .72 },
    emitters: [{ sprite: "smoke", behavior: "rise", count: 6, size: [18, 30], colors: ["w"], alpha: .35, speed: .45, spin: .3 }, { sprite: "bubble", behavior: "rise", count: 14, size: [2, 5], colors: ["w", "c1"], alpha: .8 }, twinkles(6)],
    intro: { burst: "bubble", colors: ["w", "c1"], count: 22 },
    deco: { ring: RING.water, emitters: [{ sprite: "bubble", behavior: "rise", count: 5, size: [2, 4], colors: ["w"], region: "anchor" }] },
  }),
  sandbox: () => ({
    sky: { mode: SKY.rays, intensity: .78 },
    emitters: [{ sprite: "cube", behavior: "fall", count: 10, size: [5, 9], colors: ["c1", "c2", "w"], spin: .8, speed: .6 }, dust(12, ["w", "c1"], "front")],
    intro: { burst: "cube", colors: ["c1", "c2"], count: 22 },
    deco: { ring: RING.metal, emitters: [orbit("cube", 4, [5, 7], ["c1", "c2", "w"])] },
  }),
  phantom: () => ({
    sky: { mode: SKY.fog, intensity: .9 }, hero: { kind: HERO.eclipse, x: .7, y: .13, r: .085 },
    emitters: [{ sprite: "wisp", behavior: "rise", count: 8, size: [20, 32], colors: ["c1", "w"], blend: "add", alpha: .6, speed: .45 }, { sprite: "moth", behavior: "flutter", count: 4, size: [11, 15], colors: ["c1"], fps: 16, glow: .35 }, dust(10, ["c1"], "front")],
    intro: { burst: "wisp", colors: ["c1", "w"], count: 16, flash: true },
    deco: { ring: RING.shadow, emitters: [{ sprite: "wisp", behavior: "rise", count: 4, size: [10, 14], colors: ["c1"], blend: "add", region: "anchor", alpha: .5 }] },
  }),
  serpent: () => ({
    sky: { mode: SKY.fog, intensity: .9 },
    emitters: [{ sprite: "leaf", behavior: "fall", count: 9, size: [5, 8], colors: ["c1", "c2"], tumble: true, spin: 1.4, speed: .6 }, { sprite: "firefly", behavior: "drift", count: 16, size: [3, 5], colors: ["c1"], blend: "add" }, twinkles(6, ["c1"])],
    intro: { burst: "leaf", colors: ["c1", "c2"], count: 22, flash: true },
    deco: { ring: RING.shadow, emitters: [{ sprite: "firefly", behavior: "drift", count: 5, size: [3, 4], colors: ["c1"], blend: "add", region: "anchor" }] },
  }),
  arcana: (_p, v) => ({
    sky: { mode: SKY.nebula, intensity: .82 }, hero: { kind: v > .5 ? HERO.portal : HERO.orb, x: .68, y: .14, r: .1 },
    emitters: [{ sprite: "dust", behavior: "swirl", count: 40, size: [1.2, 2.6], colors: ["c1", "w", "c2"], blend: "add", layer: "back", glow: .4 }, twinkles(12, ["w", "c1"]), { sprite: "glow", behavior: "rise", count: 8, size: [3, 6], colors: ["c1", "c2"], blend: "add", alpha: .7 }],
    intro: { burst: "spark", colors: ["c1", "w", "c2"], count: 32, flash: true },
    deco: { ring: RING.nebula, emitters: [orbit("glow", 5, [3, 5], ["c1", "w"], "add")] },
  }),
  sunrise: () => ({
    sky: { mode: SKY.rays, intensity: .92 }, hero: { kind: HERO.sun, x: .72, y: .2, r: .11 },
    emitters: [{ sprite: "crow", behavior: "flock", count: 5, size: [6, 9], colors: ["#1a1210"], fps: 8, layer: "back" }, { sprite: "dust", behavior: "drift", count: 22, size: [1, 2.4], colors: ["w", "c1"], blend: "add", glow: .3 }],
    intro: { burst: "spark", colors: ["w", "c1"], count: 26, flash: true },
    deco: { ring: RING.metal, emitters: [orbit("dust", 8, [1.4, 2.4], ["c1", "w"], "add", .4)] },
  }),
  cinema: () => ({
    sky: { mode: SKY.rays, intensity: .85 },
    emitters: [{ sprite: "dust", behavior: "drift", count: 30, size: [1, 2.4], colors: ["w", "c1"], blend: "add", glow: .3 }, twinkles(6, ["w"], "banner")],
    intro: { burst: "spark", colors: ["w", "c1"], count: 26, flash: true },
    deco: { ring: RING.metal, emitters: [sparkle(3)] },
  }),
  fashion: () => ({
    sky: { mode: SKY.holo, intensity: .8 },
    emitters: [{ sprite: "diamond", behavior: "twinkle", count: 8, size: [5, 9], colors: ["w", "c1"], blend: "add" }, twinkles(16, ["w", "c1", "c2"]), { sprite: "confetti", behavior: "fall", count: 6, size: [2, 3], colors: ["c1", "w"], tumble: true, spin: 2.5 }],
    intro: { burst: "diamond", colors: ["w", "c1"], count: 26, flash: true },
    deco: { ring: RING.metal, emitters: [sparkle(4)] },
  }),
  cyber: () => ({
    sky: { mode: SKY.digital, intensity: .9 },
    emitters: [{ sprite: "bit1", behavior: "fall", count: 10, size: [3.5, 6], colors: ["c1"], blend: "add", speed: 1.2 }, { sprite: "bit0", behavior: "fall", count: 10, size: [3.5, 6], colors: ["c1", "c2"], blend: "add", speed: 1.2 }, { sprite: "hex", behavior: "twinkle", count: 6, size: [5, 9], colors: ["c1"], blend: "add", region: "edges" }],
    intro: { burst: "bit1", colors: ["c1", "w"], count: 28, flash: true },
    deco: { ring: RING.electric, emitters: [orbit("hex", 3, [4, 6], ["c1"], "add")] },
  }),
};

// ---------------------------------------------------------------- matching --
const ORIGINAL: Record<string, string> = { eclipse: "moonstorm", rosecourt: "lovestruck", lepidoptera: "enchanted", emberwake: "inferno", glacial: "frost", sakura: "blossom", abyssal: "abyss", ophidian: "serpent", starlit: "cosmos", gilded: "gilded", wisteria: "lanterns", phantom: "phantom" };

const RULES: [RegExp, string][] = [
  [/sunrise|sunset|lion king|pride rock|\bsun\b|solar|daybreak/, "sunrise"],
  [/black.?hole|gargantua|interstellar|event horizon/, "eventhorizon"],
  [/kung fu|panda|mulan|tangled|lantern|lunar new year|chinese/, "lanterns"],
  [/batman|gotham|vampire|dracula|bat\b|bats\b/, "haunted"],
  [/\bmoon|lunar|crow|raven|night terror|werewolf|wolf/, "moonstorm"],
  [/ghost|horror|scream|phasmo|emf|haunt|hallowe|spook|balloon|stranger things|upside down|\balien|facehugger|resident evil|zombie|last of us|cordyceps|five nights|fnaf|silent hill|conjuring|nun\b|saw\b|exorcist/, "haunted"],
  [/arcane|portal|rift|dimension|multiverse|doctor strange|spider-?verse|rick and morty|avatar|nations|element|hextech/, "arcana"],
  [/firework|celebrat|confetti|new year|birthday|wrapped|fiesta|party/, "fireworks"],
  [/black hole|space|star wars|galaxy|planet|cosmic|astro|nebula|orbit|rocket|nasa|guardians|halo\b|mass effect|starfield|no man|destiny|outer wilds|saber|jedi|sith/, "cosmos"],
  [/aurora|northern light/, "aurora"],
  [/tron|light-?cycle|synth|outrun|\b80s|retro|vaporwave|miami|kavinsky|drive\b/, "synthwave"],
  [/neon|cyber|night city|blade runner|tokyo|\brain|hologram|edgerunner/, "neonrain"],
  [/storm|thunder|lightning|thor\b|zeus|electric|pikachu|pok[eé]mon|volt/, "storm"],
  [/hack|glitch|matrix|code|data|digital|severance|terminal|computer|\bai\b|robot|android|watch dogs|mr\.? robot|lumon/, "cyber"],
  [/\bfire\b|fires\b|flame|ember|dragon|inferno|lava|volcano|hell|doom|demon|ignit|burn|phoenix|atomic|trinity|oppenheimer|explos|mordor|sauron|balrog/, "inferno"],
  [/\bice\b|\bicy\b|frozen|snow|frost|winter|elsa|glacier|\bcold\b|arctic|penguin|christmas/, "frost"],
  [/desert|sand|dune|spice|egypt|pharaoh|mummy|western|red dead|cowboy|mad max|tatooine/, "desert"],
  [/ocean|sea\b|water|tide|wave|bubble|aqua|mermaid|moana|nemo|surf|pirate|shark|kraken|subnautica|sponge/, "abyss"],
  [/blossom|sakura|petal|cherry|flower|rose|garden|bloom|spring/, "blossom"],
  [/butterfl|fairy|pixie|tinker|magic|disney|wish|enchant|spell|wizard|potter|hogwarts|frozen|princess|castle|stitch|mickey/, "pixie"],
  [/love|heart|valentine|romance|cupid|deadpool|barbie/, "lovestruck"],
  [/gold|coin|money|rich|royal|crown|king|luxury|rolex|watch|treasure|hoard|jewel|bling|casino|gta|grand theft|bentley|rolls|lamborghini/, "gilded"],
  [/crystal|gem|geode|amethyst|diamond|quartz/, "crystal"],
  [/music|song|concert|festival|\bdj\b|beat|rap|rock|album|spotify|tomorrowland|guitar|k-?pop|swift|eras|vinyl|soundcloud/, "music"],
  [/football|soccer|basketball|nba|nfl|fifa|stadium|\bcup\b|tennis|golf|ufc|boxing|cricket|rugby|olymp|goal|hockey|baseball|premier|champions/, "stadium"],
  [/minecraft|roblox|lego|block|pixel|sandbox|terraria|arcade|8-?bit|tetris|pac-?man|mario|sonic|retro arcade/, "sandbox"],
  [/forest|leaf|jungle|nature|zelda|hobbit|shire|elves|druid|stardew|animal crossing|ghibli|totoro|spirit|firefl|hollow knight|ori\b|botw|tears of the kingdom/, "forest"],
  [/autumn|harvest|pumpkin|maple|thanksgiving/, "autumn"],
  [/anime|manga|samurai|ninja|katana|demon slayer|sword|ronin|tsushima|shogun|naruto|jujutsu|bleach|one piece|chainsaw|attack on titan|death note|sakamoto/, "inkblade"],
  [/fight|kombat|street fighter|tekken|smash|punch|karate|dragon ball|saiyan|\bki\b|power|hero|superman|invincible|marvel|avengers|x-men|wonder woman/, "aura"],
  [/shoot|\bwar\b|warfare|battle|soldier|tactical|sniper|\bgun|call of duty|counter-strike|\bcs2?\b|valorant|apex|battlefield|rainbow six|pubg|fortnite|warzone|tank|military|john wick|bond|007|helldiver|tarkov|delta force|black ops|modern warfare/, "battlefield"],
  [/car\b|cars\b|race|racing|motor|bike|\bf1\b|formula|nascar|drift|speed|nitro|nos\b|turbo|engine|rally|bmw|porsche|ferrari|lambo|mercedes|audi|jeep|ducati|yamaha|honda|kawasaki|harley|suzuki|ktm|furious|need for speed|forza|gran turismo|rocket league|mustang|tesla|nissan|toyota|mclaren|aston|red bull/, "speed"],
  [/food|drink|coffee|tea\b|pizza|burger|cola|pepsi|ramen|sushi|beer|wine|cocktail|starbucks|mcdonald|kfc|chocolate|candy|sweets|boba|monster energy|donut|ice cream/, "steam"],
  [/rpg|mmo|moba|quest|dungeon|fantasy|elden|souls|witcher|skyrim|warcraft|diablo|final fantasy|league of legends|dota|genshin|baldur|kingdom hearts|runescape|lord of the rings|game of thrones|dune/, "arcana"],
  [/fashion|streetwear|sneaker|jordan|nike|adidas|supreme|gucci|vogue|style|off-white|balenciaga|prada|louis/, "fashion"],
];
const CATEGORY: Record<string, string> = {
  "Disney, Pixar, Marvel & Star Wars": "pixie", Shooters: "battlefield", "Fighting & Platform Fighters": "aura", "RPG, MMO, MOBA & Adventure": "arcana", "Sandbox, Survival & Casual": "sandbox",
  "Indie Games": "forest", Movies: "cinema", "TV Shows & Streaming": "cinema", "Anime & Manga": "inkblade", Cars: "speed", Motorbikes: "speed", Motorsport: "speed", Sports: "stadium", Music: "music",
  "Fashion, Streetwear & Lifestyle": "fashion", "Food & Drink": "steam", "Tech & Platforms": "cyber", "Original Themes (No Brand)": "cosmos",
};

/** Details a brief asks for, added on top of the archetype. */
const EXTRAS: [RegExp, Emitter][] = [
  [/paw/, { sprite: "paw", behavior: "fall", count: 6, size: [5, 8], colors: ["c1", "w"], spin: .4, speed: .6, alpha: .85 }],
  [/heart/, { sprite: "heart", behavior: "rise", count: 6, size: [5, 8], colors: ["c1", "w"], glow: .3, speed: .6 }],
  [/note|music|song|beat/, { sprite: "note", behavior: "rise", count: 6, size: [5, 8], colors: ["c1", "w"], spin: .4, speed: .6 }],
  [/coin|gold|money|treasure|hoard/, { sprite: "coin", behavior: "fall", count: 6, size: [4, 7], colors: ["#f5d27a"], tumble: true, spin: 1.5 }],
  [/bat\b|bats/, { sprite: "bat", behavior: "flock", count: 5, size: [7, 11], colors: ["#07060a"], fps: 14 }],
  [/butterfl/, { sprite: "butterfly", behavior: "flutter", count: 4, size: [8, 11], colors: ["c1", "w"], fps: 14, glow: .3 }],
  [/petal|blossom|flower|rose/, { sprite: "petal", behavior: "fall", count: 10, size: [4, 7], colors: ["c1", "w"], tumble: true, spin: 1.4 }],
  [/leaf|leaves|forest/, { sprite: "leaf", behavior: "fall", count: 8, size: [5, 8], colors: ["c1", "c2"], tumble: true, spin: 1.5 }],
  [/snow|\bice\b|frozen|frost/, { sprite: "snow", behavior: "fall", count: 14, size: [2, 5], colors: ["w"], spin: .4, blend: "add", alpha: .8 }],
  [/bubble|water|ocean/, { sprite: "bubble", behavior: "rise", count: 8, size: [2.5, 6], colors: ["w"], alpha: .8 }],
  [/feather|wing|angel|eagle/, { sprite: "feather", behavior: "fall", count: 5, size: [6, 9], colors: ["w", "c1"], tumble: true, spin: 1.1, speed: .6 }],
  [/crow|raven|bird|eagle|hawk/, { sprite: "crow", behavior: "flock", count: 5, size: [9, 14], colors: ["#0b0b12"], fps: 9 }],
  [/lantern/, { sprite: "lantern", behavior: "rise", count: 5, size: [6, 10], colors: ["c1", "#ffb35c"], glow: .5, speed: .35, life: [8, 12] }],
  [/confetti|party|celebrat/, { sprite: "confetti", behavior: "fall", count: 14, size: [2.5, 4], colors: ["c1", "c2", "w"], tumble: true, spin: 3 }],
  [/lightning|thunder|bolt|electric|volt/, { sprite: "bolt", behavior: "lightning", count: 1.5, size: [1, 1], colors: ["c1"] }],
  [/firework/, { sprite: "dust", behavior: "fireworks", count: 2, size: [3, 5], colors: ["c1", "c2", "w"], layer: "back" }],
  [/rain\b|rainy/, { sprite: "streak", behavior: "streak", count: 26, size: [.7, 1.1], stretch: 12, colors: ["w", "c1"], blend: "add", alpha: .35, angle: 102 }],
  [/ember|spark|\bfire\b|flame|forge/, { sprite: "ember", behavior: "rise", count: 16, size: [1.6, 3.4], colors: ["w", "c1"], toColor: "c2", blend: "add", glow: .5, speed: 1.2 }],
  [/smoke|steam|fog|mist/, { sprite: "smoke", behavior: "rise", count: 4, size: [22, 36], colors: ["w"], alpha: .3, speed: .4, layer: "back", spin: .3 }],
  [/cube|block|pixel|voxel/, { sprite: "cube", behavior: "fall", count: 7, size: [5, 8], colors: ["c1", "c2"], spin: .7, speed: .6 }],
  [/ghost|spirit|soul/, { sprite: "wisp", behavior: "rise", count: 4, size: [12, 18], colors: ["c1", "w"], blend: "add", alpha: .45, speed: .45 }],
  [/glitch|data|code|binary/, { sprite: "bit1", behavior: "fall", count: 8, size: [3.5, 6], colors: ["c1"], blend: "add" }],
  [/diamond|gem|crystal|jewel/, { sprite: "diamond", behavior: "twinkle", count: 5, size: [5, 8], colors: ["w", "c1"], blend: "add" }],
  [/star\b|stars|starlight|shooting/, { sprite: "star", behavior: "comet", count: 1, size: [3, 4], colors: ["w", "c1"], blend: "add", trail: 16, angle: 155, glow: .4 }],
  [/speed|blur|boost|nitro|dash/, { sprite: "streak", behavior: "streak", count: 12, size: [.8, 1.3], stretch: 26, colors: ["w", "c1"], blend: "add", angle: 182, speed: 1.6, alpha: .55 }],
];

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 1000) / 1000; };
const darken = (h: string, k = .22) => { const n = parseInt(h.slice(1, 7), 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(x * k)); return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`; };

const ORIGINAL_PALETTE: Record<string, Pal> = {
  eclipse: ["#c9dcf0", "#5d7393", "#0b1220"], rosecourt: ["#f3afc7", "#b2446f", "#21101a"], lepidoptera: ["#d5c3ff", "#8575db", "#130f2a"], emberwake: ["#ffd27a", "#e4542a", "#1c0805"],
  glacial: ["#bff5ff", "#4084cf", "#081428"], sakura: ["#ffc7e0", "#bc6f97", "#2a1626"], abyssal: ["#86f3df", "#246c91", "#04141f"], ophidian: ["#b7d998", "#435f57", "#0b1410"],
  starlit: ["#f5deae", "#7b8fd3", "#0b0e22"], gilded: ["#f7d896", "#9a7649", "#1a130a"], wisteria: ["#d2b4ff", "#625582", "#120e1e"], phantom: ["#d4d9e8", "#655c89", "#0e0d16"],
};

export interface SceneInfo { scene: Scene; archetype: string }
const cache = new Map<string, SceneInfo>();
export function sceneFor(id: string | null | undefined): SceneInfo | null {
  if (!id) return null;
  const hit = cache.get(id); if (hit) return hit;
  let arch: string | undefined = ORIGINAL[id], pal: Pal | undefined = ORIGINAL_PALETTE[id], text = "";
  if (!arch) {
    const c = PROFILE_CATALOG.find((x) => x.id === id); if (!c) return null;
    text = `${c.name} ${c.brief}`.toLowerCase();
    arch = RULES.find(([re]) => re.test(text))?.[1] ?? CATEGORY[c.category] ?? "cosmos";
    pal = ((palettes as unknown as Record<string, Pal>)[id]) ?? [c.primary, c.secondary, darken(c.secondary, .45)];
  }
  const v = hash(id);
  const base = ARCHETYPES[arch]!(pal!, v);
  const have = new Set(base.emitters.map((e) => e.sprite + e.behavior));
  const extra = EXTRAS.filter(([re, e]) => re.test(text) && !have.has(e.sprite + e.behavior)).slice(0, 2).map(([, e]) => e);
  const scene: Scene = { ...base, palette: pal!, emitters: [...base.emitters, ...extra], sky: { ...base.sky, intensity: (base.sky.intensity ?? .9) * (.92 + v * .1) } };
  const info = { scene, archetype: arch };
  cache.set(id, info);
  return info;
}
