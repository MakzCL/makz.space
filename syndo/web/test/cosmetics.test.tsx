// The cosmetics catalogue: exactly 432 bundles, 24 per collection, every scene written in valid scene language.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COSMETIC_BUNDLES, COSMETIC_COLLECTIONS } from "../../shared/src/cosmetics.ts";
const root = new URL("../src/appearance/motion/", import.meta.url).pathname;
const eng = readFileSync(root + "engine.ts", "utf8"), rec = readFileSync(root + "recipes.ts", "utf8"), spr = readFileSync(root + "sprites.ts", "utf8");
const keys = (name: string) => new Set([...eng.match(new RegExp(`export const ${name} = \\{([^}]*)\\}`))![1]!.matchAll(/(\w+):/g)].map((m) => m[1]!));
const SKY = keys("SKY"), HERO = keys("HERO"), RING = keys("RING");
const ARCH = new Set([...rec.matchAll(/^  (\w+): (?:\(_?p?,? ?_?v?\)|\(\)|\(_p, v\)|\(_p\)) => \(/gm)].map((m) => m[1]!));
const BEH = new Set(eng.match(/export type Behavior = ([^;]*);/)![1]!.match(/"(\w+)"/g)!.map((x) => x.slice(1, -1)));
const SPR = new Set([...spr.match(/const STATIC = \[([\s\S]*?)\] as const/)![1]!.matchAll(/"(\w+)"/g)].map((m) => m[1]!).concat(["crow", "butterfly", "bat", "moth", "fish"]));
const EV = new Set(["bolt", "edge", "flash", "glitch", "pulse"]), REG = new Set("ahtbenl".split(""));
let bad = 0; const specs = new Map<string, string>();
for (const b of COSMETIC_BUNDLES) {
  if (!b.spec) continue;
  const prev = specs.get(b.spec + b.palette.join()); if (prev) { console.log("DUPLICATE scene", b.id, prev); bad++; } specs.set(b.spec + b.palette.join(), b.id);
  const [arch, ...toks] = b.spec.split(/\s+/);
  if (!ARCH.has(arch!)) { console.log(b.id, "unknown archetype", arch); bad++; }
  for (const t of toks) {
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^sky=(\w+)(?::([\d.]+))?$/))) { if (!SKY.has(m[1]!)) { console.log(b.id, "sky", t); bad++; } }
    else if (t === "hero=none" || t === "intro=none") {}
    else if ((m = t.match(/^hero=(\w+)(?:@([\d.]+),([\d.]+),([\d.]+))?$/))) { if (!HERO.has(m[1]!)) { console.log(b.id, "hero", t); bad++; } }
    else if ((m = t.match(/^ring=(\w+)$/))) { if (!RING.has(m[1]!)) { console.log(b.id, "ring", t); bad++; } }
    else if ((m = t.match(/^ev=(\w+):([\d.]+)-([\d.]+)(?::([\d.]+))?$/))) { if (!EV.has(m[1]!)) { console.log(b.id, "ev", t); bad++; } }
    else if ((m = t.match(/^cue=(\w+)@([\d.]+)$/))) { if (!EV.has(m[1]!)) { console.log(b.id, "cue", t); bad++; } }
    else if ((m = t.match(/^intro=(\w+)(?:\*(\d+))?$/))) { if (!SPR.has(m[1]!)) { console.log(b.id, "intro", t); bad++; } }
    else if (/^(speed|deco)=[\d.]+$/.test(t)) {}
    else if ((m = t.match(/^-(\w+)$/))) { if (!SPR.has(m[1]!)) { console.log(b.id, "strip", t); bad++; } }
    else if ((m = t.match(/^(deco)?\+(\w+)\.(\w+)(?:\*([\d.]+))?(?:@(\d+))?(?:\^([\d.]+))?(?:%(\w))?(?:&([\d.]+))?(?:~(.+))?$/))) {
      if (!SPR.has(m[2]!)) { console.log(b.id, "sprite", t); bad++; } if (!BEH.has(m[3]!)) { console.log(b.id, "behaviour", t); bad++; }
      if (m[7] && !REG.has(m[7])) { console.log(b.id, "region", t); bad++; }
      if (m[9]) for (const c of m[9].split(",")) if (!/^(c1|c2|c3|w|#[0-9a-f]{6})$/i.test(c)) { console.log(b.id, "colour", t); bad++; }
    } else { console.log(b.id, "UNKNOWN token", t); bad++; }
  }
}
const per = new Map<string, number>(); for (const b of COSMETIC_BUNDLES) per.set(b.collection, (per.get(b.collection) ?? 0) + 1);
const ids = new Set(COSMETIC_BUNDLES.map((b) => b.id)), names = new Set(COSMETIC_BUNDLES.map((b) => b.name.toLowerCase()));

test("every scene uses known archetypes, skies, heroes, rings, sprites and behaviours, and no two scenes are identical", () => assert.equal(bad, 0));
test("432 bundles: 18 collections of 24, unique ids and names, 42 existing kept, 390 new", () => {
  assert.equal(COSMETIC_BUNDLES.length, 432); assert.equal(COSMETIC_COLLECTIONS.length, 18);
  for (const c of COSMETIC_COLLECTIONS) assert.equal(per.get(c.id), 24, c.id);
  assert.equal(ids.size, 432); assert.equal(names.size, 432);
  assert.equal(COSMETIC_BUNDLES.filter((b) => b.legacy).length, 42); assert.equal(COSMETIC_BUNDLES.filter((b) => !b.legacy).length, 390);
});
test("saved selections from before the overhaul stay valid", async () => {
  const { validateProfileTheme } = await import("../../shared/src/theme.ts");
  for (const id of ["bundle-413", "bundle-424", "emberwake", "ophidian", "sakura", "bundle-406", "fx-crimson-static"]) assert.equal(validateProfileTheme({ collection: id }).value?.collection, id, id);
  assert.equal(validateProfileTheme({ collection: "fx-crimson-static", avatarDeco: "fx-liquid-platinum" }).value?.avatarDeco, "fx-liquid-platinum");
  assert.ok(validateProfileTheme({ collection: "made-up" }).issues.length > 0);
});
test("names and descriptions avoid brands and franchises", () => {
  const banned = /\b(nike|adidas|jordan|ferrari|porsche|lamborghini|mclaren|red bull|rolex|apple|razer|disney|marvel|pokemon|stranger things|tesla|half-life|tamagotchi|3m|discord|spotify|playstation|xbox|nintendo|formula 1|f1)\b/i;
  for (const b of COSMETIC_BUNDLES.filter((x) => !x.legacy)) assert.ok(!banned.test(`${b.name} ${b.description}`), b.id);
});
void ("total", COSMETIC_BUNDLES.length, "unique ids", ids.size, "unique names", names.size, "legacy", COSMETIC_BUNDLES.filter((b) => b.legacy).length, "new", COSMETIC_BUNDLES.filter((b) => !b.legacy).length, "flagships", COSMETIC_BUNDLES.filter((b) => b.flagship).length);
void (COSMETIC_COLLECTIONS.map((c) => `${c.id}:${per.get(c.id)}`).join(" "));
void ("archetypes known", ARCH.size, "problems", bad);
