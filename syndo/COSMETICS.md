# SEND premium cosmetics (432 bundles)

Persistent checklist for the profile-cosmetics overhaul. Update it as work lands.

## Count
- Before: 444 entries existed, but only **42 were public** (12 original collections + 30 "Original Themes", `bundle-401` to `bundle-430`).
  The other 402 were franchise/brand themed and stay switched off (`LICENSED_COLLECTIONS_ENABLED = false`); they use other companies' names and artwork, so they are not part of the catalogue.
- New bundles required: 432 - 42 = **390**. Now: **432 total** = 42 existing (IDs preserved) + 390 new `fx-*` bundles, 18 collections x 24.
- Manifest: `shared/src/cosmetics.ts` (one line per bundle: id, name, description, palette, scene spec).
- Saved selections: 6 users had an effect equipped (`bundle-297`, `bundle-71`, `bundle-413`, `bundle-424`, `emberwake`, `ophidian`). All still render; the two branded ones are kept valid but are not in the store.

## Architecture
- Renderer: `web/src/appearance/motion/` (one shared WebGL2 context, per-card simulation, pauses off-screen and in hidden tabs; still frames for reduced motion and lists).
- Scene language: `recipes.ts` `applySpec` (archetype + sky/hero/ring/emitters + `ev=` irregular events + `cue=` timeline + `&delay` staged layers + `intro=`).
- New in 2026: skies chrome, cathedral, circuit, track, crimson, lasers, clockwork, rainglass, grove; heroes rosewindow, clock; rings gears, platinum, circuit, crimson, crown, pixel;
  branching edge lightning, per-bulb fairy lights (`garland`), analog glitch tearing, flash limiter (strong flashes at least 1.2 s apart), police sky de-strobed.
- Mix and match: `ProfileTheme.avatarDeco` takes the avatar decoration from another bundle.
- Preview/QA page: `/fx?c=<collection>` or `/fx?ids=a,b` (add `&t=6` to fast-forward to steady state for screenshots).

## Status
- [x] Audit and count
- [x] Engine upgrades and 8 flagships (Crimson Static, Liquid Platinum, Apex Velocity, Eternal Eclipse, Phantom Cathedral (bundle-406), Neon Circuit, Sakura Drift (sakura), Clockwork Royalty)
- [x] 432 bundles written; spec validator: 0 unknown tokens, 432 unique IDs and names, 24 per collection
- [x] Contact sheets reviewed: supernatural, cyber, motorsport, luxury, streetwear, retro, cosmic, darkfantasy, elemental
- [x] Contact sheets: anime, music, nature, cute, horror, art, seasons, industrial, signature (all 18 reviewed)
- [x] Store UI: 18 collection chips + Flagships, search, bundle details and contents, live preview on your own card (production renderer), "use only its avatar decoration", revert, remove, share preview link
- [x] Tests: web/test/cosmetics.test.tsx (432 / 24 per collection / unique ids, names, scenes / valid tokens / saved selections / brand-name check); all web unit and e2e suites pass
- [x] Performance (headless, all 432 measured): simulation 0.005 ms/frame median, 0.04 ms p95, 0.24 ms max; particles median 22, max 153 (renderer cap 3000)
- [ ] Measure GPU frame time on real hardware (headless uses a software renderer, so GPU cost is not representative)
- [ ] Ideas for later: bespoke hand-animated layers (Lottie/sprite sheets) for the signature collection; paid/earned availability (server-side)

## Honest quality note
All 432 are real, renderable, distinct scenes. They are composed from a shared engine (atmosphere shader + hero + ring + particles + choreography),
not individually hand-animated art like a motion studio would produce. The flagships have bespoke choreography; most bundles are engine compositions.
