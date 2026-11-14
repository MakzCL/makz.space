/**
 * SEND premium profile cosmetics: 18 collections of 24 bundles (432 in all), every one original to SEND.
 *
 * A bundle is one visual identity: an animated profile effect (the full scene on the profile card), a matching avatar
 * decoration (the ring and its small particles), a banner treatment and theme accents (colours used for the name,
 * card frame and accents). The scene language is in web/src/appearance/motion/recipes.ts (applySpec); every bundle
 * has its own line. Existing bundles keep their IDs, so saved selections carry over.
 *
 * Line format inside each collection block (one bundle per line):
 *   id | Display name | One-line description | #c1,#c2,#c3 | scene spec        (c3 is the dark base colour)
 * A spec of "=" keeps an existing bundle's original scene. "*" after the id marks a flagship.
 */

export interface CosmeticCollection { id: string; number: number; name: string; blurb: string }
export interface CosmeticBundle {
  id: string; name: string; collection: string; description: string;
  palette: [string, string, string];
  /** Scene spec; null keeps an existing bundle's original hand-written scene. */
  spec: string | null;
  flagship: boolean;
  /** Bundles that existed before the 2026 catalogue (IDs preserved). */
  legacy: boolean;
  /** Free for everyone today; kept per bundle so paid or earned bundles can be added server-side later. */
  availability: "free";
  version: number;
}

export const COSMETIC_COLLECTIONS: CosmeticCollection[] = [
  { id: "supernatural", number: 1, name: "Supernatural Cinema", blurb: "Analog-era suspense: red storms, flickering lights and signals from somewhere else." },
  { id: "cyber", number: 2, name: "Cyberpunk & Futurism", blurb: "Holographic glass, scanning lasers, tactical displays and synthetic energy." },
  { id: "motorsport", number: 3, name: "Motorsport & Performance", blurb: "Carbon fibre, glowing brake discs, track lights and pure speed." },
  { id: "luxury", number: 4, name: "Luxury & High Fashion", blurb: "Precision movements, polished platinum, silk and diamonds. Restrained and expensive." },
  { id: "streetwear", number: 5, name: "Streetwear & Sneaker Culture", blurb: "Drop-day energy: stitched patches, spray paint, reflective tape and court lights." },
  { id: "retro", number: 6, name: "Retro Tech & Arcade", blurb: "CRT phosphor, pixel sprites, cassette reels and late-90s desktops." },
  { id: "cosmic", number: 7, name: "Cosmic & Astronomical", blurb: "Eclipses, ringed worlds, gravitational lensing and quiet starfields." },
  { id: "darkfantasy", number: 8, name: "Dark Fantasy & Gothic", blurb: "Cursed steel, cathedral glass, runes and candlelit relics." },
  { id: "elemental", number: 9, name: "Elemental Forces", blurb: "Wildfire, frost, molten metal, storms and crystal growth." },
  { id: "anime", number: 10, name: "Anime-Inspired Motion", blurb: "Original characters of light: impact frames, ink, speed lines and spirit fire." },
  { id: "music", number: 11, name: "Music & Nightlife", blurb: "Stage rigs, lasers through haze, vinyl and the room shaking." },
  { id: "nature", number: 12, name: "Nature & Botanical", blurb: "Blooms, glowing fungi, butterflies, coral and rain on glass." },
  { id: "cute", number: 13, name: "Cute, Playful & Collectible", blurb: "Original tiny friends, soft toys, sweets and miniature worlds." },
  { id: "horror", number: 14, name: "Horror & Paranormal", blurb: "Tension over jump scares: dead channels, cold mist and candles that won't stay lit." },
  { id: "art", number: 15, name: "Art, Design & Abstract", blurb: "Motion-studio experiments: chrome, paper, geometry and collage." },
  { id: "seasons", number: 16, name: "Seasons & Celebrations", blurb: "Snowy windows, spring blossom, lanterns and fireworks, wearable all year." },
  { id: "industrial", number: 17, name: "Science, Mechanical & Industrial", blurb: "Exposed gears, magnetic fields, reactors and machines that really mesh." },
  { id: "signature", number: 18, name: "Ultra-Premium Signature", blurb: "The showcase: SEND's most ambitious effects." },
];

// ------------------------------------------------------------------------------------------- the catalogue --
const CATALOGUE: Record<string, string> = {
supernatural: `
fx-crimson-static* | Crimson Static | Fairy lights stutter, a red storm pulses in the distance and lightning crawls the frame. | #ff2b2b,#7a0b14,#0a0204 | crimson
fx-midnight-transmission | Midnight Transmission | A dead channel finds a voice: scan lines roll and a lone signal pulses. | #9ad7ff,#2b4a7a,#05070c | cinema sky=crt hero=ring@.72,.13,.07 +dust.drift*16~w,c1 +circle.pulse*2%h~c1 ev=glitch:5-11:2 ring=neon
fx-the-other-side | The Other Side | Ash drifts upward through a cold, inverted night. | #c7d3e8,#3b4a63,#04050a | haunted sky=fog hero=none +ember.rise*14^.35~#cfd6e6,#8fa0bf +smoke.drift*3%b~c2 +wisp.rise*2^.25~c1 ring=shadow ev=pulse:6-12
fx-haunted-frequency | Haunted Frequency | A thin band of light warps whenever something passes. | #7dffcf,#1f6b5a,#020807 | cyber sky=crt -bit0 -bit1 -hex +wisp.drift*3~c1 +circle.pulse*2%a~c1 ev=glitch:4-9 ring=electric
fx-bloodstorm | Bloodstorm | A crimson supercell rolls overhead, forks of red lightning splitting the sky. | #ff4d4d,#6b0f1a,#080204 | storm sky=storm +bolt.lightning*2.5 ev=edge:5-10:3 ring=crimson
fx-flickering-memories | Flickering Memories | Home-movie light: warm grain, a projector flicker and dust in the beam. | #ffd9a0,#8a5a2b,#0b0805 | cinema sky=film +dust.drift*26~w,c1 +glow.beam*1@300%t~#ffe6bf ring=metal
fx-red-dimension | Red Dimension | A rift opens above you and spores drift out of the other world. | #ff5a3c,#5c0a14,#050103 | arcana sky=crimson hero=portal@.68,.13,.1 +dust.drift*24~#ffb3a0,c1 +wisp.rise*3^.3~c1 ring=crimson ev=pulse:5-10
fx-phantom-signal | Phantom Signal | Radio static made visible: interference bands chasing a faint voice. | #b7c4ff,#3a3f8f,#04040c | cyber sky=digital -hex +square.twinkle*8~c1 +streak.streak*6@180^.6~c1 ev=glitch:5-10 ring=circuit
fx-bulb-code | Bulb Code | A string of lights across the dark blinks out a message nobody sent. | #ffcf7a,#d13a3a,#070406 | bare sky=fog:.7 +orb.garland*28~c1,c2 +dust.drift*10~c1 ev=pulse:6-12 ring=shadow
fx-late-night-broadcast | Late Night Broadcast | A station's last test card fades to snow at 3am. | #e9e3ff,#5a4f9a,#06050c | cinema sky=crt +snow.drift*30~w ev=glitch:6-12:2 ring=metal
fx-hollow-woods | Hollow Woods | Torchlight through a foggy forest where only the mist moves. | #ffb469,#3d4a3a,#050705 | grove sky=fog +firefly.drift*8~c1 +smoke.drift*3%b~#8c968c ring=shadow ev=pulse:7-13
fx-facility-seventeen | Facility Seventeen | Fluorescent tubes buzz in a sealed lab; something hums behind the glass. | #9dfff0,#2a6f69,#030a09 | cyber sky=hexgrid -bit0 -bit1 +orb.lights*5~c1 +dust.drift*12~c1 ev=glitch:7-14 ring=circuit
fx-night-shift | Night Shift | Amber street lamps, a patrol light turning slowly far away. | #ffb347,#2f4bff,#05060c | cinema sky=police:.55 +dust.drift*18~c1 ring=metal
fx-static-hour | Static Hour | Three on the clock and every light in the house stutters. | #ff6b6b,#4a2a6b,#060409 | haunted sky=crimson:.7 hero=clock@.72,.14,.09 +orb.garland*18~#ffcf7a,c1 ev=glitch:6-12 ring=crimson
fx-carrier-wave | Carrier Wave | Concentric rings ripple out from a hidden transmitter. | #8dffb0,#1d5c3a,#030805 | bare sky=crt:.6 hero=orb@.74,.12,.03 +ring.pulse*3%h~c1 +circle.pulse*2%a~c1 ring=neon ev=glitch:8-15
fx-ember-season | Ember Season | A town at the end of summer: smoke, sparks and an orange sky. | #ffa64d,#8a2f12,#0a0503 | inferno sky=fog:.8 +smoke.rise*4^.3~#b07a5a ring=flame
fx-house-on-the-hill | House on the Hill | A lone window glows on a hill under a racing storm. | #ffd27a,#3c3a6b,#05050b | moonstorm sky=storm hero=moon@.72,.12,.1 +bolt.lightning*1 ring=shadow
fx-vhs-ghost | VHS Ghost | Tracking errors smear a figure that shouldn't be there. | #cfe1ff,#6a5acd,#05040b | phantom sky=crt hero=none +wisp.drift*3~c1,w ev=glitch:4-8 ring=shadow
fx-shortwave | Shortwave | A dial sweeps through stations and the needle stops on a voice. | #ffd479,#8b5a2b,#080604 | bare sky=film:.7 hero=ring@.72,.14,.08 +note.rise*4^.4~c1 +dust.drift*14~c1 ring=metal ev=pulse:6-12
fx-blackout | Blackout | The power fails; only a torch beam sweeps the room. | #fff1c9,#3a3a44,#020203 | bare sky=fog:.5 +glow.beam*1@330%t~#fff6d8 +dust.drift*20~w ring=shadow ev=pulse:8-14
fx-siren-song | Siren Song | A red warning light turns through thick fog. | #ff3b3b,#5a0a0a,#060202 | bare sky=fog:.85 hero=orb@.8,.08,.03 +glow.beam*2@270%h~c1 +dust.drift*16~c1 ring=crimson
fx-the-gate | The Gate | A wound in the ground glows; its tendrils pulse like a heartbeat. | #ff7043,#6b1414,#060203 | arcana sky=crimson hero=portal@.5,.06,.12 +ember.rise*16~c1 +wisp.rise*3~c1 ring=crimson ev=pulse:3-6
fx-cold-open | Cold Open | Snowfall in a sodium-lit car park as headlights sweep by. | #ffcc80,#4a5578,#05060a | frost sky=fog:.7 +glow.beam*1@200%e~#fff2cc ring=ice
fx-signal-lost | Signal Lost | The picture rolls, splits and reassembles itself, over and over. | #ff3d7f,#3df2ff,#05040a | cyber sky=split:.55 -bit0 -bit1 -hex +square.twinkle*10~c1,c2 ev=glitch:3-7 ring=pixel
`,
cyber: `
bundle-401 | Cyberpunk Neon City | Rain-slick neon towers and holographic signage. | = | =
bundle-421 | Glitchcore | A signal that breaks beautifully: datamosh blocks and tearing scanlines. | = | =
bundle-430 | Rainy Tokyo Night | Umbrella-lit streets reflected in a wet window. | = | =
fx-neon-circuit* | Neon Circuit | Light runs the traces of a living circuit board and loops round your avatar. | #39f3ff,#1a6b8f,#03090d | circuit +hex.pulse*2%a~c1 +dust.drift*12~c1 ev=glitch:9-16:5
fx-holo-glass | Holo Glass | Panes of holographic glass slide past, catching prismatic light. | #a8f0ff,#c79bff,#060814 | bare sky=holo +shard.drift*6~c1,c2,w +twinkle.twinkle*8~w ring=neon
fx-scan-protocol | Scan Protocol | A tactical display sweeps your profile with a laser scan. | #3dff9e,#0f5c3a,#020805 | cyber sky=hexgrid -bit0 -bit1 +chevron.pulse*2%a~c1 +glow.beam*1@0%a~c1 ring=circuit ev=glitch:9-15
fx-code-rainfall | Code Rainfall | Columns of glyph light fall past a dark glass tower. | #7dff7a,#1c5c1a,#020602 | cyber +bit1.fall*10~c1 ring=electric
fx-synthetic-wings | Synthetic Wings | Light-wire feathers drift from wings unfolding behind you. | #9ff3ff,#5a7bff,#04060f | bare sky=nebula:.6 +feather.fall*6^.5~c1,w +streak.streak*4@250^.4~c1 ring=crown
fx-chrome-district | Chrome District | Neon reflections pour down liquid-chrome towers. | #ff4fd8,#38e8ff,#07040d | platinum sky=chrome:.75 +streak.streak*10@100~c1,c2 ring=neon
fx-quantum-core | Quantum Core | A suspended energy core spins inside its containment field. | #6effff,#7a3cff,#03030c | aura sky=hexgrid hero=orb@.7,.13,.07 +orb.swirl*20~c1 ring=electric
fx-overclock | Overclock | The board heats from blue to white as the fans spin up. | #8ac7ff,#ff8a3d,#04060a | circuit +ember.rise*10~c2 ring=gears
fx-netrunner | Netrunner | Data packets stream into your avatar from every direction. | #ffe14d,#ff3d8a,#08040a | cyber -bit0 -bit1 hero=orb@.18,.24,.02 +square.swirl*24~c1,c2 ring=circuit
fx-ghost-protocol | Ghost Protocol | You fade in and out of the camera feed like optical camouflage. | #dbe7ff,#5b7cff,#04050a | bare sky=glass:.6 +hex.twinkle*10~c1 ev=glitch:3-7 ring=shadow
fx-plasma-edge | Plasma Edge | A blade of contained plasma hums along the frame. | #ff5cf1,#5c1aff,#07030c | bare sky=nebula:.5 +sword.drift*1~c1 ev=edge:4-8:1 ring=electric
fx-orbital-hud | Orbital HUD | Target rings lock on and rotate around you. | #ff9d3d,#3dd6ff,#05060b | cyber -bit0 -bit1 -hex +circle.orbit*3~c1 +triangle.orbit*3~c2 +ring.pulse*2%a~c1 ring=circuit
fx-mag-rail | Mag Rail | Light trains race along magnetic rails in the dark. | #4dd2ff,#ff4d6d,#03050b | track sky=synth +streak.streak*10@180^2~c1,c2 ring=neon
fx-data-koi | Data Koi | Wireframe koi swim through a pool of code. | #59ffd2,#ff5ca8,#030a0a | abyss sky=digital +fish.flutter*3~c1,c2 ring=water
fx-neon-monsoon | Neon Monsoon | A downpour over a market of glowing signs. | #ff5ec4,#40c8ff,#06040c | neonrain sky=rainglass:.85 ring=neon
fx-synth-heart | Synth Heart | A mechanical heart pulses light through glass tubing. | #ff3d6e,#6effff,#08030a | bare sky=hexgrid:.6 +heart.pulse*2%a~c1 +circle.pulse*2%a~c2 +dust.drift*10~c1 ring=platinum ev=pulse:2-3
fx-zero-day | Zero Day | Red warnings cascade as the firewall fails. | #ff2e4d,#ffb02e,#080203 | cyber sky=circuit -hex +cross.twinkle*6~c1 ev=glitch:4-9 ring=crimson
fx-aurora-interface | Aurora Interface | Translucent panels breathe with soft gradient light. | #8bffd6,#b28bff,#050814 | aurora sky=holo:.7 +square.drift*5~c1,c2,w ring=platinum
fx-mech-pilot | Mech Pilot | A cockpit visor flickers to life: crosshair, vectors and heat. | #ffcf3d,#3dff8a,#050603 | cyber sky=tunnel -bit0 -bit1 +chevron.streak*6@0^.8~c1 +circle.pulse*1%a~c2 ring=gears
fx-ion-trail | Ion Trail | Ionised exhaust curls behind passing drones. | #8a9bff,#3dffe0,#03040c | cosmos sky=synth hero=none +jet.flyby*2~c1 +dust.drift*16~c2 ring=electric
fx-prism-firewall | Prism Firewall | A lattice of light refracts every colour of the spectrum. | #ffffff,#7d8cff,#05060e | crystal sky=glass +diamond.twinkle*8~w,c2 ring=ice
`,
motorsport: `
fx-apex-velocity* | Apex Velocity | Track lights smear past at three depths as brake sparks fly. | #ff3b1f,#ffc04d,#06070b | track +ember.streak*7@181^1.6~#ffb347,#ffe08a +smoke.drift*2%b~#9aa0aa ring=metal ev=pulse:5-9
fx-carbon-weave | Carbon Weave | Satin carbon with a clear-coat highlight sliding across. | #d7dce5,#4a4f5c,#050506 | bare sky=chrome:.45 +twinkle.twinkle*4~w ring=metal
fx-red-hot-rotors | Red-Hot Rotors | Brake discs glow cherry-red as sparks shower from the caliper. | #ff5a1f,#ffcc4d,#080303 | bare sky=lava:.55 +ember.streak*10@185^1.8~#ffcc66,c1 +spark.twinkle*4%a~c2 ring=flame
fx-pole-position | Pole Position | Five red lights, then lights out and away. | #ff2b2b,#ffd24d,#050506 | track +orb.lights*5~c1 ring=metal cue=flash@4
fx-night-race | Night Race | Floodlit circuit, city towers and spray off the tyres. | #ffffff,#3d8bff,#03050a | track sky=rainglass:.6 +streak.streak*16@182^2~w,c2 ring=metal
fx-twenty-four-hours | Twenty-Four Hours | Dawn breaks over an endurance race as headlights fade into sunrise. | #ffb15c,#4d6bff,#06050a | sunrise sky=track hero=sun@.8,.18,.08 +streak.streak*10@181^1.4~w,c1 ring=metal
fx-turbo-spool | Turbo Spool | A turbine glows as boost builds and flames pop from the exhaust. | #ff8a2b,#5ac8ff,#050506 | speed sky=tunnel +flame.streak*4@185^1.2~c1 ring=gears
fx-drift-smoke | Drift Smoke | Tyre smoke billows as a car slides sideways through the bend. | #e8e8f0,#ff3d6a,#060608 | bare sky=track:.6 +smoke.drift*6~w,#c9ccd6 +tire.drift*1~#2a2a30 ring=shadow
fx-aero-flow | Aero Flow | Smoke-tunnel streamlines curl over a wing profile. | #9ce5ff,#3a6bff,#03060c | bare sky=track:.45 +streak.streak*18@180^1.2~c1,w +dust.drift*10~c1 ring=platinum
fx-chequered-finish | Chequered Finish | A waving chequer flag and ticker tape for the win. | #ffffff,#ffcf3d,#050505 | stadium sky=track +flag.drift*2~w +confetti.fall*14~w,c2 ring=metal
fx-pit-lane | Pit Lane | Wheel guns, sparks and a blur of crew lights. | #ffd23d,#ff4d4d,#060606 | track +spark.twinkle*10%a~c1 +orb.blink*14~c1,c2 ring=gears
fx-rally-stage | Rally Stage | Gravel spray and dust over a forest stage at dusk. | #ffb26b,#6b4a2b,#080604 | desert sky=track +dust.streak*12@185^1.6~#c9a27a ring=metal
fx-knee-down | Knee Down | Sparks fly from a slider as a superbike leans into the apex. | #ff6a2b,#e8e8ee,#050506 | track +spark.streak*8@175^1.8~#ffc46b,c1 ring=flame
fx-hypercar | Hypercar | A low silhouette of light streaks past at full speed. | #ffffff,#ff3b30,#030304 | speed sky=track +jet.flyby*1~w ring=platinum
fx-heat-haze | Heat Haze | The air over the tarmac shimmers in the midday heat. | #ffc76b,#ff6a3d,#0a0603 | desert sky=track:.7 hero=sun@.82,.08,.06 +dust.drift*10~c1 ring=metal
fx-redline | Redline | A tachometer needle sweeps toward the red. | #ff3b3b,#e8ecf2,#050506 | bare sky=track:.5 hero=clock@.72,.13,.1 +ember.rise*6%h~c1 ring=metal
fx-wet-tyres | Wet Tyres | Rain spray hangs in the air behind a car on wet tyres. | #bfe4ff,#3d7bff,#04060a | rainglass sky=track:.6 +streak.streak*20@178^2~w ring=water
fx-track-day | Track Day | Sunlit kerbs, a clean racing line and the cars in a blur. | #ff3d3d,#ffffff,#06070a | track sky=split:.5 ring=metal
fx-afterburn | Afterburn | A blue flame cone roars out of a straight pipe. | #4dc9ff,#ffffff,#02040a | inferno sky=fire:.6 +flame.streak*5@185^1.5~c1,w ring=flame
fx-holeshot | Holeshot | Mud flies and the gate drops as the pack charges the first turn. | #ff8a00,#5c3a1a,#070503 | desert sky=sand +dust.streak*14@190^1.5~#8a6a4a +drip.fall*6~#5c3a1a ring=metal
fx-garage-neon | Garage Neon | A car under a dust sheet in a neon-lit garage, waiting. | #ff2e88,#2ef0ff,#050409 | bare sky=hexgrid:.45 +dust.drift*20~c1,c2 +glow.beam*1@270%t~c2 ring=neon
fx-sequential | Sequential | A dog-box shifts and the gears engage with a mechanical snap. | #c8ccd6,#ff6a00,#050506 | clockwork sky=clockwork:.6 +spark.twinkle*4%a~c2 ring=gears
fx-podium | Podium | Champagne spray and golden ticker tape under the anthem. | #ffd76b,#ffffff,#070604 | fireworks +confetti.fall*16~c1,w +bubble.rise*10~w ring=crown
fx-ghost-lap | Ghost Lap | Your best lap replays as a translucent car of light. | #7affe1,#3d6bff,#030608 | track sky=tunnel +jet.flyby*1~c1 +dust.drift*8~c1 ring=neon
`,
luxury: `
gilded | Gilded Atelier | Engraved gold filigree with an understated satin finish. | = | =
fx-liquid-platinum* | Liquid Platinum | A slow river of polished metal, studio light sliding across its surface. | #f2f4f8,#9aa3b0,#121419 | platinum
fx-clockwork-royalty* | Clockwork Royalty | An open-heart watch movement: meshed gears, a ticking dial and a spinning cage. | #f3d28c,#9b6b2e,#120c06 | clockwork hero=clock@.72,.15,.115 +twinkle.twinkle*5%h~w ring=gears
fx-tourbillon | Tourbillon | A rotating cage of steel parts keeps time behind sapphire. | #e6e9f0,#7a8496,#08090c | bare sky=chrome:.35 hero=clock@.72,.14,.12 +twinkle.twinkle*4%h~w ring=gears
fx-diamond-rain | Diamond Rain | Cut stones fall in slow motion, flashing as they turn. | #ffffff,#a8c6ff,#06070c | bare sky=space:.4 +diamond.fall*10^.4~w,c2 +twinkle.twinkle*10~w ring=platinum
fx-silk-ribbon | Silk Ribbon | Champagne silk ripples through warm, soft light. | #f3d7b5,#b68a6e,#0c0806 | bare sky=dreamy:.55 +wisp.drift*5^.4~c1,w ring=platinum
fx-black-pearl | Black Pearl | A lustrous dark pearl turns slowly, its orient catching colour. | #e9d8ff,#4a3d6b,#050409 | bare sky=nebula:.4 hero=orb@.72,.14,.08 +twinkle.twinkle*6%h~w ring=platinum
fx-atelier-noir | Atelier Noir | Black lacquer and a single gold line drawn with a steady hand. | #e8c27a,#2a2420,#050404 | gilded sky=ink:.5 ring=metal
fx-champagne-hour | Champagne Hour | Fine bubbles rise through gold in a crystal flute. | #f7e2a8,#c9a14a,#0b0904 | bare sky=dreamy:.5 +bubble.rise*24^.6~w,c1 +twinkle.twinkle*6~w ring=metal
fx-platinum-crest | Platinum Crest | Brushed platinum and a single blue sapphire. | #e7ecf3,#3d6bd1,#06070b | platinum sky=chrome:.55 +diamond.twinkle*3%a~c2 ring=crown
fx-velvet-room | Velvet Room | Deep velvet, brass posts and a soft spotlight. | #c8344f,#e8c07a,#0b0306 | bare sky=stage:.6 +dust.drift*14~c2 ring=metal
fx-sapphire-dial | Sapphire Dial | A sunburst dial in deep blue, its second hand ticking. | #9bc1ff,#1f3f8f,#03050c | bare sky=rays:.5 hero=clock@.72,.14,.11 ring=platinum
fx-emerald-cut | Emerald Cut | Step-cut facets throw green light across the card. | #7dffb8,#0f6b45,#020805 | crystal sky=glass:.7 ring=ice
fx-gold-leaf | Gold Leaf | Flakes of gold leaf drift down like late-autumn light. | #ffd97a,#b8862e,#0b0804 | bare sky=dreamy:.4 +leaf.fall*12^.5~c1,#fff0c2 +dust.drift*10~c1 ring=metal
fx-maison-marble | Maison Marble | Veined marble with a polished gold inlay. | #f4f1ea,#c8a96a,#191714 | bare sky=ink:.55 +twinkle.twinkle*3~w ring=metal
fx-rose-gold-mesh | Rose Gold Mesh | A fine rose-gold mesh shimmering like chainmail. | #f4b7a2,#b46b5a,#0b0605 | bare sky=hexgrid:.45 +twinkle.twinkle*6~w ring=platinum
fx-eau-de-nuit | Eau de Nuit | A crystal bottle exhales a slow violet mist. | #d8b8ff,#7a4fd1,#07050c | bare sky=fog:.6 +smoke.rise*4^.3~c1 +twinkle.twinkle*5~w ring=ice
fx-runway | Runway | Camera flashes pop down a long catwalk. | #ffffff,#d9b38c,#050505 | bare sky=stage:.6 +twinkle.twinkle*8%e~w ev=pulse:2-4 ring=metal
fx-haute-plume | Haute Plume | Ostrich plumes sway in a slow, deliberate breeze. | #f5e9ff,#b49cff,#08060c | bare sky=dreamy:.45 +feather.fall*8^.35~c1,w ring=platinum
fx-onyx-and-gold | Onyx & Gold | Black onyx split by a vein of molten gold. | #ffcf5c,#1a1410,#030202 | bare sky=lava:.5 +dust.drift*8~c1 ring=metal
fx-pearl-strand | Pearl Strand | A strand of pearls circles you like a necklace. | #f4efe6,#c9bfae,#0a0908 | bare sky=dreamy:.35 deco+bubble.orbit*10~w +bubble.orbit*12~w,c1 ring=platinum
fx-gilt-frame | Gilt Frame | An ornate gallery frame under a museum spotlight. | #f2cf7e,#8a6526,#090704 | gilded sky=rays:.5 hero=none ring=metal
fx-cashmere | Cashmere | Soft, brushed texture in warm oatmeal and grey. | #e8dccb,#8f8478,#12100e | bare sky=fog:.45 +dust.drift*12~c1 ring=platinum
fx-chandelier | Chandelier | Crystal drops tremble under a slow, warm light. | #fff1d0,#d1a85c,#0a0805 | bare sky=rays:.55 +diamond.twinkle*12%t~w,c1 +shard.fall*3^.3~w ring=ice
`,
streetwear: `
fx-drop-day | Drop Day | The countdown hits zero and the page explodes with colour. | #ff3b30,#ffffff,#080808 | stadium sky=comic +confetti.fall*16~c1,w cue=flash@2.5 ring=neon
fx-spray-tag | Spray Tag | Paint mist drifts from a fresh piece on a concrete wall. | #ff4fd8,#4dffdc,#0b0b0e | bare sky=ink:.55 +smoke.drift*4~c1,c2 +dust.drift*18~c1,c2 ring=neon
fx-court-lights | Court Lights | An outdoor court under sodium lights, a ball's arc in motion. | #ff8c2b,#ffd9a0,#07060a | stadium sky=stage:.6 +circle.flyby*1~c1 ring=metal
fx-patchwork | Patchwork | Embroidered patches stitched on one by one. | #ffcf3d,#ff4d6d,#0d0a0e | bare sky=hexgrid:.35 +star.twinkle*5~c1 +heart.twinkle*3~c2 +triangle.twinkle*3~w ring=floral
fx-reflective | Reflective | Reflective tape blazes silver under a camera flash. | #e6eaf0,#ff6a00,#060606 | bare sky=chrome:.4 +streak.streak*6@160^.5~w ev=pulse:3-6 ring=platinum
fx-airbrush-dream | Airbrush Dream | Soft airbrushed gradients, like a custom tee from the boardwalk. | #ff7ac8,#7ad1ff,#0a0710 | bare sky=dreamy:.85 +star.twinkle*6~w +heart.drift*3~c1 ring=floral
fx-laced-up | Laced Up | Laces whip through the frame as a sneaker turns on its plinth. | #ffffff,#ff3d3d,#070707 | bare sky=stage:.5 +streak.streak*4@120^.4~w,c2 +twinkle.twinkle*4~w ring=metal
fx-halftone-hype | Halftone Hype | Comic halftone bursts and a big pop of colour. | #ffe14d,#ff3d6a,#0a0806 | aura sky=comic +star.pulse*2%a~c1 ring=neon
fx-skate-park | Skate Park | A concrete bowl at golden hour, dust kicked up by wheels. | #ffb36b,#7a8aa0,#09080a | desert sky=rays:.6 hero=sun@.85,.06,.07 +dust.drift*16~c1 ring=metal
fx-puffer-season | Puffer Season | Glossy quilted nylon catching cold neon. | #6bdcff,#ff8ad1,#05070c | bare sky=chrome:.55 +snow.fall*10^.4~w ring=platinum
fx-cover-art | Cover Art | A photocopied flyer look: grain, ink and torn edges. | #f2f2f2,#ff2e2e,#0b0b0b | cinema sky=film:.75 +square.twinkle*4~c2 ring=metal
fx-midnight-kicks | Midnight Kicks | Glow-in-the-dark soles pacing across a black floor. | #b6ff3d,#3dffb6,#030503 | bare sky=hexgrid:.5 +circle.pulse*2%b~c1 +dust.drift*10~c1 ring=neon
fx-platform-tiles | Platform Tiles | White subway tile and a train's headlight in the tunnel. | #f6f6f6,#ffcc33,#0a0a0b | bare sky=tunnel:.55 +streak.streak*6@180^1.5~c2 ring=metal
fx-rooftop | Rooftop | Water towers silhouetted against a pink skyline. | #ff8fb3,#ffc46b,#0b0710 | sunrise sky=rays:.7 hero=sun@.8,.12,.07 +crow.flock*3~#120c16 ring=metal
fx-chain-link | Chain Link | A chain-link fence throws moving shadows under a flickering lamp. | #c8d0dc,#ff9a3d,#060708 | bare sky=hexgrid:.6 ev=pulse:2-5 ring=shadow
fx-gum-sole | Gum Sole | Translucent caramel rubber with light glowing through it. | #ffb84d,#a6612a,#0b0704 | bare sky=caustics:.5 +bubble.rise*6^.4~c1 ring=water
fx-rookie-card | Rookie Card | A holographic foil card catches the light as it tilts. | #b8f3ff,#ffb8f3,#0a0a12 | bare sky=holo:.85 +card.drift*2~w +twinkle.twinkle*6~w ring=neon
fx-block-party | Block Party | Speakers thump and the pavement vibrates under the beat. | #ffd23d,#ff4fa0,#0a0709 | music sky=lasers:.6 ring=neon
fx-tie-dye | Tie-Dye | Slow-blooming dye bleeds through cotton. | #ff6ad5,#6affc8,#0b0710 | bare sky=ink:.85 +dust.drift*10~c1,c2 ring=floral
fx-chrome-letters | Chrome Letters | Bubble shapes in chrome with a hard white outline. | #e8eef5,#ff3dc8,#060609 | bare sky=chrome:.6 +star.twinkle*6~w ring=neon
fx-plaza | Plaza | Pigeons take off across a sunlit square. | #ffd7a0,#8d9bb0,#0a0a0c | bare sky=clouds:.6 +crow.flock*6~#6b7280 ring=metal
fx-buzzer-beater | Buzzer Beater | A ball arcs from half court, the net snaps and the crowd explodes. | #ff7a1a,#ffffff,#06060a | stadium +circle.flyby*1~c1 +confetti.fall*10~c1,w cue=flash@3 ring=metal
fx-limited-run | Limited Run | Numbered tags and a velvet rope; only a few were ever made. | #f2e6c9,#c03030,#0a0708 | bare sky=stage:.55 +card.twinkle*4~w +twinkle.twinkle*4~c1 ring=metal
fx-street-heat | Street Heat | Steam rises from a manhole under red neon. | #ff3d3d,#ffb3b3,#080406 | bare sky=neonrain:.6 +smoke.rise*4^.3~#c9b0b0 ring=neon
`,
retro: `
bundle-402 | Vaporwave Sunset | A gridded horizon under a striped setting sun. | = | =
bundle-403 | Y2K Chrome Bubble | Liquid chrome bubbles and millennium sparkle. | = | =
bundle-420 | Pixel Retro Arcade | Attract-mode pixels and coin-op glow. | = | =
fx-phosphor-green | Phosphor Green | Green phosphor text with a slow, ghostly afterglow. | #66ff7a,#1a5c25,#020602 | cyber sky=crt -hex +bit1.fall*6~c1 ring=pixel
fx-attract-mode | Attract Mode | An arcade cabinet's demo loop, lights chasing round the marquee. | #ffd23d,#ff3d8a,#08040a | sandbox sky=synth +orb.blink*18~c1,c2 ring=pixel
fx-save-icon | Save Icon | A 3.5-inch disk spins up with a mechanical whirr. | #6bb6ff,#c0c6cf,#05070b | bare sky=digital:.5 hero=ring@.72,.14,.07 +square.twinkle*6~c1 ring=gears
fx-side-b | Side B | Cassette reels turn as the tape hiss fades in. | #ff9f6b,#ffd3a8,#0b0706 | bare sky=film:.6 hero=ring@.6,.12,.05 +note.rise*6^.5~c1 ring=gears
fx-dial-up | Dial-Up | A modem handshake drawn as squiggles of light. | #8dffef,#ff8de4,#06060b | cyber sky=crt -bit0 -hex ev=glitch:5-10 ring=electric
fx-desktop-98 | Desktop '98 | A teal desktop, pixel clouds and a busy hourglass. | #3dc9c9,#c0c0c0,#063838 | sandbox sky=clouds:.6 +cloud.drift*3~w +square.twinkle*4~w ring=pixel
fx-8-bit-fireworks | 8-Bit Fireworks | Chunky pixel bursts over a starry night. | #ff3d6a,#3dfff0,#05040b | fireworks sky=space +square.fireworks*2~c1,c2 ring=pixel
fx-scanline-sunset | Scanline Sunset | A sunset seen through a curved glass tube. | #ff8a3d,#ff3dc8,#0b040b | synthwave sky=crt ring=pixel
fx-pocket-handheld | Pocket Handheld | Four shades of green and a blinking cursor. | #9bbc0f,#306230,#0f380f | sandbox sky=crt +square.fall*6~c1,c2 ring=pixel
fx-vector-arcade | Vector Arcade | Glowing vector lines of an asteroid field, drawn in white light. | #ffffff,#7ad7ff,#020206 | cosmos sky=space hero=none +triangle.drift*5~w +streak.streak*4@200~w ring=neon
fx-lan-party | LAN Party | Beige towers, a tangle of cables and a room lit by monitors. | #7aff9a,#ffb36b,#060806 | bare sky=crt:.6 +square.twinkle*10~c1,c2 ring=circuit
fx-high-score | High Score | Your initials enter the table as the cabinet flashes. | #fff23d,#ff3d3d,#060404 | sandbox sky=synth +star.twinkle*10~c1 cue=flash@2 ring=pixel
fx-boot-sequence | Boot Sequence | A memory count ticks up and the machine chimes awake. | #d8d8d8,#3d7bff,#030308 | cyber sky=crt -hex +bit0.fall*6~c1 +bit1.fall*6~c1 ring=circuit
fx-screen-saver | Screen Saver | Shapes tumble endlessly across a black screen. | #3dff6a,#ff3dd1,#030303 | bare sky=space:.4 +cube.drift*6~c1,c2 +square.drift*4~#3d7bff ring=pixel
fx-disc-changer | Disc Changer | A disc spins in a translucent shell, track numbers flicking. | #ff6ad5,#7ad7ff,#09060d | bare sky=holo:.5 hero=ring@.72,.14,.08 +note.drift*4~c1 ring=neon
fx-vapor-mall | Vapor Mall | An empty food court, pastel tiles and a fountain humming. | #ff9ad5,#7ae0ff,#120a1a | synthwave sky=caustics:.6 +bubble.rise*8~w ring=floral
fx-pager | Pager | A tiny backlit screen flashes a number in amber. | #ffb000,#5a3a00,#080500 | bare sky=crt:.55 +square.twinkle*5~c1 ev=pulse:4-8 ring=pixel
fx-pixel-pet | Pixel Pet | A pixel pet bounces happily in its little home. | #ffd1e8,#6bc4ff,#0c0812 | sandbox sky=dreamy:.6 +heart.rise*5~c1 +square.twinkle*4~c2 ring=pixel
fx-chiptune | Chiptune | Square-wave melodies bouncing as notes of light. | #3dffd0,#ff3d9e,#05060a | music sky=synth +note.rise*10~c1,c2 ring=pixel
fx-instant-film | Instant Film | A photo develops from milky grey to full colour. | #f6e7c9,#7aa6c9,#0d0b09 | cinema sky=film:.65 +dust.drift*18~w ring=metal
fx-multimedia-cd | Multimedia CD | A rainbow-sheened disc spins under a click-to-start menu. | #c9f0ff,#ffc9f0,#0a0a12 | bare sky=holo:.7 hero=ring@.7,.14,.09 +twinkle.twinkle*6~w ring=platinum
`,
cosmic: `
eclipse | Lunar Eclipse | An eclipsed moon, silver craters and drifting celestial dust. | = | =
starlit | Astral Atlas | Fine constellation lines, orbiting stars and antique gold. | = | =
bundle-408 | Celestial Zodiac | A turning wheel of constellations. | = | =
bundle-419 | Arctic Aurora | Curtains of aurora over a frozen horizon. | = | =
bundle-427 | Space Station Orbit | Station lights wheeling over a blue planet. | = | =
fx-eternal-eclipse* | Eternal Eclipse | Totality: the corona breathes, a diamond ring flares and meteors cross the dark. | #fff1d6,#ff9a3c,#020208 | cosmos sky=space hero=eclipse@.66,.15,.12 +star.comet*1.2@150 +dust.drift*14~#ffe7c2 ring=nebula cue=flash@1.6 intro=twinkle*18
fx-ringed-world | Ringed World | A banded giant hangs in the dark, its rings tilted toward you. | #ffd9a0,#c27a3d,#030308 | cosmos sky=space hero=planet@.7,.14,.09 +dust.drift*10~c1 ring=nebula
fx-gravity-well | Gravity Well | Light bends around a black hole as the accretion disc spins. | #ffb36b,#ff5a1f,#020103 | eventhorizon ring=nebula
fx-supernova | Supernova | A star collapses and blooms outward in a shockwave of colour. | #ffffff,#ff7ad1,#05030a | cosmos sky=nebula hero=orb@.7,.14,.05 +ring.pulse*2%h~c1,c2 cue=flash@2 ring=nebula
fx-meteor-shower | Meteor Shower | Dozens of meteors streak through a crisp mountain sky. | #ffffff,#8ab4ff,#02030a | cosmos sky=space hero=none +star.comet*3@150~w,c2 ring=nebula
fx-star-nursery | Star Nursery | Gas pillars glow where new stars are born. | #ff9ad5,#5a7bff,#05040e | cosmos sky=nebula hero=none +twinkle.twinkle*14~w,c1 ring=nebula
fx-solar-flare | Solar Flare | A coronal loop arcs from the limb of the sun. | #ffb13d,#ff4d1a,#080302 | sunrise sky=fire:.6 hero=sun@.75,.14,.12 +ember.rise*8%h~c1 ring=flame
fx-sea-of-tranquillity | Sea of Tranquillity | Grey regolith under a black sky, dust settling slowly. | #e8ecf2,#4d7bc9,#030406 | cosmos sky=space hero=moon@.72,.14,.12 +dust.drift*8~w ring=metal
fx-pulsar | Pulsar | A neutron star's beams sweep round like a lighthouse. | #9ae1ff,#ffffff,#020309 | cosmos sky=space hero=orb@.7,.14,.03 +glow.beam*2@0%h~c1 ring=electric
fx-comet | Comet | A long ion tail stretches across the sky. | #a8f0ff,#ffffff,#020309 | cosmos sky=space hero=none +star.comet*1.5@160~w,c1 +dust.drift*12~c1 ring=ice
fx-galactic-core | Galactic Core | A spiral galaxy turns slowly, its core blazing. | #ffe7b8,#7a5aff,#030209 | cosmos sky=vortex hero=orb@.7,.14,.04 +dust.swirl*30~c1,w ring=nebula
fx-binary-stars | Binary Stars | Two stars orbit each other, trading streams of light. | #ffb36b,#6bc4ff,#030309 | cosmos sky=space hero=orb@.7,.14,.04 +orb.swirl*12~c1,c2 ring=nebula
fx-aurora-from-orbit | Aurora from Orbit | Green curtains wrap the planet's night side. | #6bffb0,#3d8bff,#020509 | aurora sky=space hero=planet@.78,.24,.2 ring=nebula
fx-cosmic-dust | Cosmic Dust | Lit dust drifts in the faint glow of distant stars. | #ffd7b0,#8a6bd1,#040309 | cosmos sky=nebula:.6 hero=none +dust.drift*40~c1,c2 ring=nebula
fx-red-giant | Red Giant | A swollen star fills the sky, its surface boiling. | #ff6b3d,#b3200f,#080202 | sunrise sky=fire:.5 hero=sun@.72,.16,.18 ring=flame
fx-moth-moon | Moth Moon | A silver moon and pale moths drifting through its light. | #f2f4ff,#7a86b8,#04050c | cosmos sky=space hero=moon@.7,.14,.08 +moth.flutter*2~c1 ring=metal
fx-wormhole | Wormhole | A tunnel through spacetime pulls the starfield inward. | #9a7aff,#3dffe0,#020209 | cosmos sky=tunnel hero=portal@.68,.14,.07 ring=nebula
fx-star-chart | Star Chart | An antique star chart in gold leaf, slowly turning. | #f2d28c,#5a6bb8,#06070e | cosmos sky=space hero=ring@.7,.14,.12 +star.twinkle*10~c1 ring=metal
fx-dark-matter | Dark Matter | Invisible mass bends the background stars around nothing at all. | #b3c6ff,#3d4a8a,#010106 | eventhorizon sky=space hero=blackhole@.7,.14,.1 ring=shadow
`,
darkfantasy: `
ophidian | Ophidian | An ancient thorned coil, dark metal and emerald eyes. | = | =
bundle-404 | Dark Academia | Candlelit libraries and drifting pages. | = | =
bundle-406* | Phantom Cathedral | Stained glass breathes with light, dust hangs in the shafts and black feathers fall. | #ffcf6b,#7b3fd1,#07050c | cathedral +crow.flock*4~#0d0b12 +wisp.rise*3^.3~c2 ring=shadow ev=pulse:7-12
bundle-414 | Viking Runes | Carved runes glowing in northern stone. | = | =
bundle-415 | Egyptian Pharaoh | Gold, lapis and desert light. | = | =
bundle-422 | Witch's Grimoire | A spellbook's runes and potion smoke. | = | =
bundle-423 | Angel vs Demon | Light and shadow split the card. | = | =
fx-cursed-blade | Cursed Blade | A runed sword hangs in the dark, smoke bleeding from the steel. | #9dff6b,#2a4d1a,#030602 | inkblade sky=fog:.7 +sword.drift*1~c1 +smoke.rise*4^.3~c1 ring=shadow
fx-raven-court | Raven Court | Black wings circle a crumbling tower under a pale moon. | #d7dbe8,#3a3d4a,#040407 | moonstorm +feather.fall*5~#0b0b10 ring=shadow
fx-rune-circle | Rune Circle | Glowing runes turn in a summoning ring around you. | #7ac8ff,#2a3d8a,#03040a | arcana sky=fog:.6 deco+rune.orbit*6~c1 +rune.orbit*8~c1 ring=electric
fx-crypt-candles | Crypt Candles | Dozens of candles gutter in a stone crypt. | #ffb35c,#6b4a2b,#060403 | bare sky=fog:.55 +flame.twinkle*12%b~c1,#ffd9a0 +dust.drift*12~c1 ring=flame
fx-spectral-armour | Spectral Armour | Ghostly plate armour shimmers into being around you. | #b8e7ff,#4a6b8a,#03050a | phantom sky=glass:.6 +shard.drift*6~c1,w ring=platinum
fx-blood-moon-keep | Blood Moon Keep | A red moon behind black battlements. | #ff4d4d,#5c0f0f,#050102 | moonstorm hero=moon@.7,.13,.12 ring=crimson
fx-grave-light | Grave Light | Green soul-fire flickers over an open grave. | #6bff9a,#1a5c33,#020503 | haunted sky=fog +wisp.rise*5~c1 +flame.twinkle*5%b~c1 ring=shadow
fx-obsidian-throne | Obsidian Throne | Volcanic glass and molten cracks in an ancient hall. | #ff7a2b,#2a1410,#030101 | inferno sky=lava ring=metal
fx-dragons-hoard | Dragon's Hoard | Gold coins slide as something vast breathes beneath them. | #ffd23d,#a85a12,#080502 | gilded sky=fire:.5 +coin.fall*10~c1 +ember.rise*8~c1 ring=flame
fx-elder-portal | Elder Portal | A stone archway opens onto a violet void. | #c38aff,#3d1a6b,#040209 | arcana hero=portal@.7,.14,.11 ring=nebula
fx-crown-of-thorns | Crown of Thorns | Black thorns coil into a crown that drips with dew. | #b8ffd9,#2a3d33,#030504 | serpent +drip.fall*4~c1 ring=crown
fx-will-o-wisp | Will-o'-Wisp | Lights lure travellers deeper into the marsh. | #9affea,#2a6b5c,#020605 | grove sky=fog:.7 +wisp.drift*6~c1 ring=shadow
fx-hellforge | Hellforge | An anvil glows white as sparks fountain upward. | #ffcf6b,#ff3d1a,#080201 | inferno sky=fire +spark.rise*14~c1,w ring=flame
fx-silver-wolf | Silver Wolf | Moonlit mist where a pale shape watches from the trees. | #e8f0ff,#5c6b8a,#03040a | grove sky=fog:.8 hero=moon@.75,.12,.07 ring=ice
fx-gargoyle-watch | Gargoyle Watch | Stone wings twitch atop a rain-soaked spire. | #c9ced8,#4a4f5c,#040506 | storm sky=rainglass:.7 +bat.flock*4~#0d0d12 ring=shadow
fx-lich-crown | Lich Crown | A crown of frozen bone radiating cold blue fire. | #8ae1ff,#2a4d8a,#02040a | frost hero=eye@.7,.14,.08 ring=crown
fx-relic-shard | Relic Shard | A fragment of an ancient artefact pulses with trapped power. | #ffd77a,#7a3dff,#050309 | crystal sky=cathedral:.6 hero=orb@.72,.14,.05 +shard.drift*5~c1,c2 ring=crown
`,
elemental: `
emberwake | Emberwake | Molten edges, dancing embers and a slow-burning crown. | = | =
glacial | Glacial Crown | Hand-cut ice facets with a luminous frozen crest. | = | =
bundle-416 | Greek Gods Olympus | Marble, laurel and lightning from the summit. | = | =
bundle-418 | Volcanic Lava | Cracked crust over a glowing flow. | = | =
bundle-425 | Desert Mirage | Heat shimmer over endless dunes. | = | =
bundle-429 | Crystal Geode | Amethyst caverns catching the light. | = | =
fx-wildfire | Wildfire | A wall of flame crests the ridge, ash lifting on the heat. | #ffb13d,#ff3d1a,#0a0302 | inferno +smoke.rise*4^.3~#6b4a3a ring=flame
fx-frost-bloom | Frost Bloom | Ice crystals branch across the glass like ferns. | #d8f6ff,#5ab8ff,#030812 | frost sky=glass:.6 +snow.drift*12~w ring=ice
fx-thunderhead | Thunderhead | A storm cell builds as lightning walks across the base of the cloud. | #c8dcff,#5a6bd1,#03040b | storm +bolt.lightning*2.5 ev=edge:6-12:3 ring=electric
fx-molten-steel | Molten Steel | Liquid metal pours and cools from white to cherry red. | #ffe1a0,#ff4d1a,#060201 | bare sky=lava:.8 +ember.fall*10^.6~w,c1 ring=platinum
fx-maelstrom | Maelstrom | A water vortex spirals down into the deep. | #6bffe8,#1a5c8a,#020609 | abyss sky=vortex hero=orb@.7,.14,.03 +bubble.swirl*20~w ring=water
fx-sandstorm | Sandstorm | A wall of sand sweeps across the dunes. | #ffcf8a,#a8692a,#0b0703 | desert sky=sand +dust.streak*20@185^1.4~c1 ring=metal
fx-ashfall | Ashfall | Grey ash snows from a dark volcanic sky. | #c9c3bd,#ff5a2b,#070505 | bare sky=lava:.5 +snow.fall*16^.5~#bdb6ae +ember.rise*6~c2 ring=shadow
fx-crystal-growth | Crystal Growth | Quartz spires grow and catch the light. | #e8d1ff,#8a5aff,#05030b | crystal +shard.rise*6^.3~c1,w ring=ice
fx-gale-force | Gale Force | Leaves and spray race sideways through a howling wind. | #c8f0d8,#4a8a6b,#030605 | bare sky=clouds:.6 +leaf.streak*10@185^1.5~c1,c2 +streak.streak*10@182^1.8~w ring=water
fx-magma-heart | Magma Heart | A cracked stone heart beats with molten light. | #ff7a2b,#4d1a0a,#060201 | bare sky=lava hero=orb@.72,.14,.07 ev=pulse:1.5-2.5 ring=flame
fx-tidal-surge | Tidal Surge | A wave curls overhead, lit from within. | #7affff,#1a6b9a,#020609 | abyss sky=caustics ring=water
fx-ball-lightning | Ball Lightning | A sphere of plasma drifts and crackles silently. | #d6c8ff,#7a5aff,#03020a | bare sky=storm:.6 hero=orb@.72,.14,.05 +spark.twinkle*8%h~c1,w ring=electric
fx-calving-glacier | Calving Glacier | A blue ice wall cracks and spills into the sea. | #b8f0ff,#2a7ad1,#020610 | frost sky=aurora:.6 +shard.fall*5~c1,w ring=ice
fx-geyser | Geyser | Steam and spray burst from the ground at intervals. | #e8f8ff,#7ab8c9,#050809 | bare sky=fog:.6 +smoke.rise*6^.6~w +drop.rise*12^1.2%b~c1 ring=water ev=pulse:5-9
fx-obsidian-flow | Obsidian Flow | Black glass forms where lava meets the sea. | #ff9a3d,#1a1a22,#030305 | bare sky=lava:.6 +smoke.rise*5~#4a4a55 ring=shadow
fx-st-elmos-fire | St Elmo's Fire | Blue static fire dances on the tips of masts. | #7ad7ff,#d1e8ff,#02050a | storm sky=storm:.6 +flame.twinkle*6%t~c1 ring=electric
fx-petrichor | Petrichor | Rain on dry earth, the first drops darkening the dust. | #b8a07a,#5a6b4a,#080806 | rainglass sky=sand:.5 +drop.fall*16~#a8c8d8 ring=water
fx-solar-wind | Solar Wind | Charged particles stream past in luminous sheets. | #ffe66b,#ff8a3d,#060402 | aurora +dust.streak*16@180^1.4~c1 ring=nebula
`,
anime: `
sakura* | Sakura Drift | Petals ride a soft spring wind, turning in the light as they fall. | #ffd0e4,#d3709f,#20101a | blossom sky=dreamy:.85 +petal.fall*20^.7~#ffd6e8,#ffffff,#f4a6c8 +petal.drift*6~#ffe3ef +twinkle.twinkle*6~w ring=floral
bundle-413 | Samurai Cherry Blossom | A blade's edge through falling blossom. | = | =
fx-impact-frame | Impact Frame | One frame of pure white impact, then speed lines. | #ffffff,#ff3d3d,#050505 | aura sky=comic +streak.streak*14@180^2~w cue=flash@1.5 ring=electric
fx-ink-brush | Ink Brush | Sumi ink blooms and dries across rice paper. | #1a1a1a,#c83232,#efe9dc | bare sky=ink:.85 +petal.fall*4~c2 ring=shadow
fx-foxfire | Foxfire | Blue spirit flames float in a slow ring. | #6bd7ff,#d16bff,#030309 | bare sky=fog:.6 deco+flame.orbit*6~c1 +flame.orbit*7~c1,c2 ring=flame
fx-power-surge | Power Surge | Energy gathers, the ground cracks and your aura erupts. | #ffe14d,#ff8a00,#080502 | aura +spark.rise*12~c1,w cue=flash@2 ring=electric
fx-speed-lines | Speed Lines | Radial speed lines rush toward you. | #ffffff,#3d8aff,#05060a | speed sky=tunnel ring=neon
fx-transformation | Transformation | Ribbons of light spiral up and a new form steps out. | #ffd1f2,#7ad7ff,#08060c | pixie sky=dreamy +star.swirl*20~c1,c2 cue=flash@3 ring=crown
fx-sky-temple | Sky Temple | Floating islands and clouds at sunset. | #ffb88a,#8ac8ff,#0a0912 | sunrise sky=clouds hero=sun@.82,.16,.07 +cloud.drift*3~w ring=floral
fx-spirit-lanterns | Spirit Lanterns | Paper lanterns rise over a quiet shrine. | #ffcf7a,#ff6b3d,#0b0610 | lanterns ring=flame
fx-iaido | Iaido | A blade is drawn in one stroke under a full moon. | #e8f0ff,#c83a4a,#04040a | inkblade hero=moon@.72,.12,.1 +streak.streak*2@150^3~w ring=metal
fx-thruster-ignition | Thruster Ignition | Twin thrusters flare as a giant robot launches. | #6bd7ff,#ff8a3d,#03050a | speed sky=tunnel +flame.rise*8%b~c1,c2 ring=gears
fx-hand-drawn-fire | Hand-Drawn Fire | Flames on twos, with crisp shapes and hard shadows. | #ffcf3d,#ff3d1a,#080303 | inferno sky=comic ring=flame
fx-sparkle-bubble | Sparkle Bubble | Soft-focus bubbles and sparkles bloom behind you. | #ffd1e8,#c8b3ff,#0e0912 | bare sky=dreamy +bubble.drift*10~w,c1 +twinkle.twinkle*10~w ring=floral
fx-chi-burst | Chi Burst | Rings of energy pulse outward from your core. | #8affb3,#3dd1ff,#020806 | aura +ring.pulse*3%a~c1 ring=electric
fx-after-school-rain | After School Rain | Rain on a classroom window, cherry trees beyond. | #ffc8dc,#7aa8d1,#080a10 | rainglass +petal.fall*6~c1 ring=water
fx-summoning | Summoning | A magic circle draws itself line by line. | #ffd23d,#ff3d8a,#06030a | arcana sky=fog:.6 +rune.orbit*10~c1 +circle.pulse*2%a~c1 ring=crown
fx-cel-sky | Cel Sky | Flat-shaded summer clouds drift over a deep blue sky. | #8ad7ff,#ffffff,#0a1830 | bare sky=clouds +cloud.drift*4~w +crow.flock*2~#28324a ring=floral
fx-afterimage | Afterimage | Afterimages trail your every move. | #c8b3ff,#5a3dd1,#05030b | phantom sky=split:.5 +wisp.flyby*2~c1 ring=shadow
fx-dragon-spirit | Dragon Spirit | A serpentine spirit of light coils around you. | #7affd1,#3d8aff,#020608 | serpent sky=aurora ring=electric
fx-night-festival | Night Festival | Stalls glow, goldfish swim and fireworks pop overhead. | #ff7a3d,#ffd23d,#080510 | fireworks +fish.flutter*2~c1 ring=flame
fx-yurei | Yurei | A pale figure flickers at the end of a corridor. | #e8f0ff,#7a8aa8,#030306 | phantom sky=fog:.8 ev=glitch:7-14 ring=shadow
fx-neon-ronin | Neon Ronin | A rain-soaked swordsman in a neon alley. | #ff3d6a,#3dd7ff,#05040a | neonrain +sword.drift*1~c1 ring=neon
fx-dream-sequence | Dream Sequence | Everything goes soft and pastel as feathers drift upward. | #ffe1f0,#b8d8ff,#0c0a12 | pixie sky=dreamy +feather.rise*6^.4~w,c1 ring=platinum
`,
music: `
fx-laser-tunnel | Laser Tunnel | A fan of green lasers sweeps through the haze. | #3dff6a,#3dd7ff,#020602 | club ring=neon
fx-vinyl | Vinyl | A record spins under the needle, its grooves catching light. | #e8e8f0,#ff3d6a,#050505 | bare sky=stage:.5 hero=ring@.72,.14,.11 +note.rise*6~c1 ring=gears
fx-bass-drop | Bass Drop | Everything holds still, then the room shakes. | #ff3dc8,#3d8aff,#06040a | club sky=lasers +ring.pulse*3%a~c1 cue=flash@3 ring=electric
fx-led-wall | LED Wall | A wall of LEDs ripples with visuals behind you. | #ff8a3d,#3dc8ff,#050507 | bare sky=hexgrid +square.twinkle*10~c1,c2 ring=pixel
fx-headliner | Headliner | A single spotlight finds you on a dark stage. | #fff6d8,#ffb36b,#030303 | bare sky=stage:.7 +dust.drift*20~w ring=metal
fx-mirror-ball | Mirror Ball | Light shards from a spinning mirror ball sweep the room. | #ffffff,#ff7ad1,#060509 | bare sky=stage:.5 hero=orb@.72,.1,.05 +twinkle.twinkle*20~w,c1 ring=platinum
fx-synth-pads | Synth Pads | Warm analog pads glow under your fingers. | #ff8ad1,#8a7aff,#07050c | synthwave sky=synth ring=neon
fx-smoky-room | Smoky Room | A brass horn glints through smoke and blue light. | #ffcf7a,#3d5aff,#050409 | bare sky=fog:.7 +smoke.rise*5^.3~#8a8fb0 +note.rise*4^.4~c1 ring=metal
fx-main-stage | Main Stage | Confetti cannons fire over a sea of raised hands. | #ffd23d,#ff3d8a,#060408 | fireworks sky=stage +confetti.fall*20~c1,c2,w ring=crown
fx-waveform | Waveform | Your voice drawn as a waveform of light. | #3dffe0,#ff3dc8,#030509 | bare sky=synth:.5 +square.pulse*2%a~c1 +streak.streak*8@180^.8~c1 ring=neon
fx-subwoofer | Subwoofer | The cone pumps and dust jumps off the speaker grille. | #ff6b3d,#c8c8d0,#060505 | bare sky=hexgrid:.45 +circle.pulse*3%a~c1 +dust.rise*16^1.2%a~w ring=gears
fx-afterparty | Afterparty | Dawn light through the blinds and glitter on the floor. | #ffb8d8,#ffd9a0,#0b080c | bare sky=rays:.6 +twinkle.twinkle*14~w,c1 ring=floral
fx-concert-hall | Concert Hall | Gold balconies and a crescendo of light. | #ffd98a,#8a3d2a,#090503 | gilded sky=stage +note.rise*8~c1 ring=crown
fx-lo-fi-room | Lo-Fi Room | A rainy window, a desk lamp and a slow beat. | #ffc88a,#7a8ab8,#08080c | rainglass +note.rise*4^.3~c1 ring=water
fx-warehouse | Warehouse | Concrete and moving beams: no strobe, just pressure. | #b8ff3d,#3dffd7,#030403 | club sky=stage ring=electric
fx-solo | Solo | Sparks fly from the fretboard as the solo peaks. | #ff8a3d,#ffe14d,#070403 | bare sky=stage:.6 +spark.rise*12~c1,c2 +ember.rise*8~c1 ring=flame
fx-idol-stage | Idol Stage | Pastel lightsticks wave in perfect unison. | #ff9ad5,#9ad5ff,#0b0812 | bare sky=stage:.6 +orb.blink*20~c1,c2 +star.twinkle*8~w ring=crown
fx-dub-echo | Dub Echo | Delays repeat into the distance, each echo fainter. | #6bff9a,#ffd23d,#030503 | bare sky=tunnel:.6 +ring.pulse*3%a~c1 ring=neon
fx-crate-digger | Crate Digger | Record sleeves flick past in a dusty shop. | #ffb36b,#8a6b4a,#0b0806 | bare sky=film:.6 +card.drift*4~c1,c2 ring=metal
fx-silent-disco | Silent Disco | Headphones glow in three colours across a dark park. | #3dff9e,#3d9eff,#05050a | bare sky=fog:.5 +orb.blink*24~c1,c2,#ff3d6a ring=neon
fx-sunset-set | Sunset Set | A DJ silhouetted against a burning horizon. | #ff8a3d,#ff3d8a,#0b0410 | sunrise sky=lasers hero=sun@.6,.18,.12 ring=flame
fx-choir | Choir | Candlelit voices rising in a stone nave. | #ffe1a8,#8a6bd1,#060409 | cathedral +note.rise*6~c1 ring=crown
fx-equaliser | Equaliser | Bars of light bounce to a beat you can almost hear. | #3dffd0,#ffd03d,#030508 | bare sky=hexgrid:.6 +square.rise*16^.8%b~c1,c2 ring=pixel
fx-encore | Encore | Phone lights fill a dark arena, swaying slowly. | #fff2c9,#7aa6ff,#030306 | bare sky=stage:.45 +twinkle.twinkle*30%b~w,c1 ring=metal
`,
nature: `
rosecourt | Rose Court | Pearlescent roses woven through an ornamental silver frame. | = | =
lepidoptera | Afterglow | Iridescent butterflies suspended in a trail of violet light. | = | =
abyssal | Abyssal Tide | Sculpted sea-glass curls and bioluminescent currents. | = | =
wisteria | Wisteria Night | Trailing wisteria, delicate leaves and nocturnal fireflies. | = | =
bundle-405 | Cottagecore Mushrooms | Mossy fungi and soft woodland light. | = | =
bundle-417 | Deep Sea Abyss | Lanterns of the deep in the dark water. | = | =
bundle-424 | Ocean Koi Pond | Koi turning slow circles under the ripples. | = | =
fx-glowing-bay | Glowing Bay | Every wave lights up blue in the dark. | #3dffea,#1a6b9a,#020509 | abyss sky=caustics +firefly.drift*12~c1 ring=water
fx-monarch-migration | Monarch Migration | Orange wings drift over a summer meadow. | #ff9a2b,#3d2a1a,#0a0705 | bare sky=clouds:.6 +butterfly.flutter*6~c1 ring=floral
fx-glowcap-grove | Glowcap Grove | Mushrooms pulse with soft light on the forest floor. | #7aff9a,#3da8ff,#020604 | grove +mushroom.twinkle*6%b~c1 ring=floral
fx-autumn-canopy | Autumn Canopy | Maple leaves spiral down through low gold light. | #ffb13d,#c83a1a,#0a0503 | autumn ring=floral
fx-coral-garden | Coral Garden | Fish dart between coral fans in sunlit water. | #ff8ab8,#3dd1ff,#02060a | abyss sky=caustics +fish.flutter*4~c1,#ffd23d ring=water
fx-dandelion-wish | Dandelion Wish | Seeds lift away on a summer breeze. | #fffbe8,#d1e88a,#0b0c07 | bare sky=clouds:.55 +dust.rise*16^.4~w +feather.rise*4^.3~w ring=floral
fx-firefly-field | Firefly Field | Fireflies blink through a long June dusk. | #e8ff7a,#3d5a2a,#040603 | forest +firefly.drift*24~c1 ring=floral
fx-lotus | Lotus | A lotus opens on still water at dawn. | #ffc8e1,#7ad1b8,#050a0a | bare sky=caustics:.5 hero=orb@.72,.16,.03 +petal.drift*5~c1 ring=floral
fx-canopy-rain | Canopy Rain | Rain drums on broad leaves high in the canopy. | #8affb3,#2a6b4a,#020604 | rainglass sky=grove +leaf.fall*6~c1 ring=water
fx-snowy-owl | Snowy Owl | Soft feathers fall through a silent winter wood. | #f2f6ff,#a8b8d1,#05060a | frost +feather.fall*6~w ring=ice
fx-sunflower-field | Sunflower Field | Golden heads turn toward a slow sun. | #ffd23d,#7a5a1a,#0a0803 | sunrise hero=sun@.8,.12,.08 +petal.fall*8~c1 ring=floral
fx-kelp-forest | Kelp Forest | Light shafts fall through swaying kelp. | #9affb8,#1a5c6b,#020507 | abyss sky=rays +bubble.rise*10~w ring=water
fx-moss-and-stone | Moss & Stone | Damp moss, dew and a single drop falling. | #b8e88a,#4a5c3a,#050604 | grove sky=fog:.6 +drop.fall*4^.4~w ring=floral
fx-hummingbird | Hummingbird | Tiny wings blur beside a red trumpet flower. | #3dffb8,#ff3d6a,#030806 | bare sky=dreamy:.5 +moth.flutter*3~c1 +petal.drift*4~c2 ring=floral
fx-orchard-breeze | Orchard Breeze | Apple blossom drifts across a spring orchard. | #ffe8f0,#d18ab8,#0c080a | blossom sky=clouds:.6 ring=floral
fx-desert-bloom | Desert Bloom | Cacti flower overnight after rare rain. | #ff8ad1,#ffcf8a,#0c0806 | desert +petal.rise*6^.4~c1 ring=floral
fx-tide-pools | Tide Pools | Shells and anemones in a sunlit rock pool. | #ffb8a8,#3dd1d1,#030708 | abyss sky=caustics +shell.drift*4~c1,w ring=water
`,
cute: `
bundle-407 | Kawaii Pastel Clouds | Candy clouds and sleepy stars. | = | =
fx-sleepy-cloud | Sleepy Cloud | A little cloud dozes, raining tiny stars. | #ffd1f2,#b8d8ff,#0e0c16 | bare sky=dreamy +cloud.drift*2~w +star.fall*8^.4~#fff2a8 ring=floral
fx-boba-break | Boba Break | Tapioca pearls bob in a sweet milky swirl. | #f2d1b0,#6b4a3a,#0e0a08 | bare sky=dreamy:.55 +circle.rise*10^.4~#3a2a20 +bubble.rise*6~w ring=floral
fx-paw-parade | Paw Parade | Little paw prints trot across the card. | #ffb8d1,#ffd9b8,#0e0a0c | bare sky=dreamy:.5 +paw.fall*8^.4~c1,c2 ring=floral
fx-sprinkles | Sprinkles | Rainbow sprinkles tumble onto pink frosting. | #ff9ad5,#ffe14d,#110a10 | bare sky=dreamy +confetti.fall*20^.6~c1,c2,#7ad7ff,w ring=floral
fx-pocket-planet | Pocket Planet | A tiny world spins under its own little moon. | #8affb3,#7ab8ff,#05060c | cosmos sky=space hero=planet@.72,.15,.07 +star.twinkle*8~w ring=nebula
fx-plushie | Plushie | Soft felt hearts float up from a stitched seam. | #ffb3a8,#c8846b,#0e0a08 | lovestruck sky=dreamy ring=floral
fx-gumball-machine | Gumball Machine | Gumballs drop and bounce in every colour. | #ff3d6a,#3dd7ff,#0b0a10 | bare sky=dreamy:.5 +circle.fall*12^.6~c1,c2,#ffd23d,#7aff8a ring=pixel
fx-star-friend | Star Friend | A small star keeps you company, orbiting all day. | #fff2a8,#ffb3d1,#0c0b14 | bare sky=space:.5 deco+star.orbit*2~c1 +star.orbit*2~c1 +twinkle.twinkle*10~w ring=crown
fx-macaron-tower | Macaron Tower | Pastel macarons tumble gently through the air. | #ffc8e1,#c8ffe1,#100c10 | bare sky=dreamy:.5 +donut.fall*8^.4~c1,c2,#e1c8ff ring=floral
fx-pond-ripples | Pond Ripples | Ripples spread where small things paddle by. | #ffe14d,#7ad1ff,#060a0c | abyss sky=caustics +bubble.rise*6~w +circle.pulse*2%b~w ring=water
fx-snow-bunny | Snow Bunny | Bunny tracks in fresh snow and flakes as big as cotton. | #ffffff,#ffc8dc,#080a12 | frost sky=dreamy +paw.fall*4~w ring=ice
fx-wind-up-robot | Wind-Up Robot | Tiny gears tumble from a tin toy as its key turns. | #c8d8e8,#ff6b3d,#060709 | clockwork sky=dreamy:.5 +gear.fall*6^.5~c1,c2 ring=gears
fx-conveyor-treats | Conveyor Treats | Tiny dishes glide past on a slow loop. | #ff8a6b,#fff2e1,#0e0a09 | bare sky=hexgrid:.35 +circle.streak*5@180^.5~c1,c2 ring=pixel
fx-toadstool-home | Toadstool Home | A red toadstool house with a glowing round door. | #ff4d4d,#ffe1a8,#0a0806 | forest +mushroom.twinkle*4%b~c1 ring=floral
fx-rainbow-slide | Rainbow Slide | Comets of colour slide past, sparkles trailing. | #ff6b9a,#6bd7ff,#0d0b14 | pixie sky=dreamy +star.comet*2@160~c1,c2 ring=floral
fx-pixel-kitty | Pixel Kitty | A pixel cat leaves paw prints and little hearts. | #ffcf8a,#ff8ab8,#0c0a0c | sandbox sky=dreamy:.6 +paw.fall*4~c1 +heart.rise*4~c2 ring=pixel
fx-soft-serve | Soft Serve | A cone swirl melting in the summer sun. | #ffe8c8,#ff9ab8,#0e0a0a | bare sky=dreamy:.6 +drip.fall*6^.4~c1,c2 +star.twinkle*4~w ring=floral
fx-terrarium | Terrarium | A tiny garden under glass with its own weather. | #b8ffb8,#7ad7ff,#050a08 | bare sky=glass:.5 +sprout.twinkle*5~c1 +drop.fall*6^.3~c2 ring=water
fx-balloon-bunch | Balloon Bunch | Helium balloons bob and drift upward. | #ff6b8a,#6bd7ff,#0c0a10 | bare sky=clouds:.55 +balloon.rise*12^.4~c1,c2,#ffd23d ring=floral
fx-bedtime-moon | Bedtime Moon | A crescent moon in a sleepy sky, stars hung on strings. | #fff2a8,#8a9aff,#080a18 | bare sky=space:.6 hero=moon@.75,.12,.07 +star.twinkle*12~c1 ring=floral
fx-hatchling | Hatchling | An egg wobbles, cracks and something tiny peeks out. | #b8ff8a,#ffe1a8,#090c06 | bare sky=dreamy:.5 hero=orb@.72,.15,.05 +shard.rise*4^.3~c2 ev=pulse:3-6 ring=floral
fx-sticker-bomb | Sticker Bomb | Glossy stickers slap onto the card one after another. | #ff3d8a,#3dffd0,#0c0a0e | bare sky=dreamy:.5 +heart.twinkle*4~c1 +star.twinkle*4~c2 +triangle.twinkle*3~#ffd23d +circle.twinkle*3~#7a8aff ring=neon
fx-jelly-wobble | Jelly Wobble | Translucent jelly wobbles, catching fruity light. | #ff6b9a,#ffb36b,#0e0809 | bare sky=caustics:.55 +bubble.drift*8~c1,c2 ring=water
`,
horror: `
phantom | Phantom Veil | A spectral ribbon winding through moonlit fragments. | = | =
bundle-428 | Zombie Apocalypse | Green haze over a city that went quiet. | = | =
fx-dead-channel | Dead Channel | Snow on a television left on in an empty house. | #e8e8f0,#5a5a6b,#030304 | cinema sky=crt +snow.drift*24~w ev=glitch:5-10 ring=shadow
fx-hands-on-glass | Hands on Glass | Pale prints bloom on fogged glass. | #e1ecff,#8a9ab8,#04050a | rainglass sky=fog:.8 +wisp.twinkle*4~w ring=ice
fx-cold-spot | Cold Spot | Breath fogs and frost creeps in from the corners. | #cde8ff,#4a6b8a,#020409 | frost sky=fog +smoke.drift*3~w ring=ice
fx-mirror | Mirror | Your reflection lags a second behind. | #d8e1f0,#5a4a6b,#030306 | phantom sky=glass:.7 ev=glitch:6-12 ring=platinum
fx-last-candle | Last Candle | One candle stays lit while the rest keep going out. | #ffb35c,#3a2a1a,#020101 | bare sky=fog:.5 +flame.twinkle*6%b~c1 ev=pulse:5-10 ring=shadow
fx-the-attic | The Attic | Dust in a single beam and a rocking chair's shadow. | #ffe1b0,#5a4a3a,#030202 | bare sky=film:.55 +glow.beam*1@300%t~#ffe8c8 +dust.drift*20~w ring=shadow
fx-fog-horn | Fog Horn | A lighthouse beam passes through fog over black water. | #fff6d8,#4a5a6b,#020304 | bare sky=fog:.8 hero=orb@.8,.1,.02 +glow.beam*1@180%h~w ring=shadow
fx-something-below | Something Below | Scratching under the floor, and the dust jumps. | #b8a88a,#3a3028,#030202 | bare sky=fog:.5 +dust.rise*14^.4%b~c1 ev=glitch:8-16 ring=shadow
fx-moth-lamp | Moth Lamp | Moths circle a buzzing porch light. | #ffe8a8,#8a7a5a,#040302 | bare sky=fog:.6 hero=orb@.72,.1,.03 +moth.flutter*5~c1 ring=shadow
fx-red-rain | Red Rain | The rain comes down red and nobody says anything. | #ff3d3d,#6b0f0f,#050102 | rainglass sky=crimson:.6 +streak.streak*20@98~c1 ring=crimson
fx-watching | Watching | An eye opens in the dark and follows. | #ffcf3d,#6b3d0f,#030201 | haunted hero=eye@.72,.14,.07 ring=shadow
fx-cellar-door | Cellar Door | A line of light under a door, then a shadow crosses it. | #ffd98a,#3a2a1a,#020101 | bare sky=fog:.45 +glow.beam*1@270%b~c1 ev=pulse:6-12 ring=shadow
fx-bone-orchard | Bone Orchard | Bare trees and crows in a grey dawn. | #c8c8c0,#4a4a44,#050505 | grove sky=fog +crow.flock*5~#0b0b0e ring=shadow
fx-poltergeist | Poltergeist | Objects drift off the shelves and hang in the air. | #d8c8ff,#5a3d8a,#040309 | phantom +card.drift*3~w +die.drift*2~w ev=glitch:7-13 ring=shadow
fx-swamp-light | Swamp Light | Green gas rises and ignites over a dark bog. | #b8ff6b,#3d5a1a,#030502 | grove sky=fog:.8 +wisp.rise*4~c1 +firefly.drift*6~c1 ring=shadow
fx-funhouse | Funhouse | Warped mirrors and a carousel organ, slightly off key. | #ff3d6a,#3dd7ff,#060408 | bare sky=split:.6 +orb.blink*16~c1,c2 ev=glitch:8-14 ring=neon
fx-black-water | Black Water | Something rises from a still, black lake. | #8aa8b8,#1a2a33,#010203 | abyss sky=fog:.6 +bubble.rise*6^.3~c1 ring=water
fx-seance | Séance | Candles flicker in a circle as the table trembles. | #ffb35c,#5a2a6b,#040209 | arcana sky=fog:.6 deco+flame.orbit*6~c1 +flame.orbit*6~c1 ev=glitch:7-12 ring=shadow
fx-west-wing | West Wing | A corridor of flickering tubes and a door left ajar. | #d8f0e1,#4a6b5a,#020403 | bare sky=tunnel:.5 +orb.lights*5~c1 ev=glitch:6-12 ring=shadow
fx-wraith | Wraith | A shape of smoke rushes past the camera. | #c8d0e1,#3a3f4a,#020203 | phantom sky=fog +smoke.flyby*2~w ring=shadow
fx-cursed-tape | Cursed Tape | A tape nobody remembers recording, rolling on its own. | #d8e1e8,#6b7a8a,#020303 | cinema sky=crt +wisp.drift*2~w ev=glitch:3-6 ring=shadow
fx-graveyard-shift | Graveyard Shift | Lantern light weaves between headstones in the mist. | #ffcf7a,#4a5a6b,#030406 | haunted sky=fog +lantern.drift*2~c1 ring=shadow
`,
art: `
fx-swiss-grid | Swiss Grid | Bold geometric shapes snap to a modular grid. | #ff3d1a,#f2f2ea,#0b0b0b | bare sky=hexgrid:.4 +square.twinkle*6~c1,c2 +circle.twinkle*4~c1 ring=pixel
fx-paper-cut | Paper Cut | Layered paper landscapes with soft shadows. | #f2c8a8,#7aa6c9,#0e0c0b | bare sky=split:.6 +leaf.drift*4~c1 ring=floral
fx-iridescent-oil | Iridescent Oil | Oil-slick colours flow across a dark mirror. | #ff6bd1,#6bffe1,#05050a | platinum sky=chrome:.8 ring=platinum
fx-flow-field | Flow Field | Thousands of lines follow an invisible current. | #ffd23d,#3d6bff,#04050a | bare sky=ink:.6 +dust.streak*30@190^.4~c1,c2 ring=neon
fx-brutalist | Brutalist | Raw concrete blocks and hard shadows that move with the sun. | #d1d1cc,#6b6b66,#0b0b0a | bare sky=split:.5 +square.drift*3~c1 ring=metal
fx-torn-poster | Torn Poster | Layers of posters peel back to reveal older colours. | #ff3d3d,#3d8aff,#0e0d0b | cinema sky=film:.6 +card.fall*4^.3~c1,c2 ring=metal
fx-primary-shapes | Primary Shapes | Red circle, yellow triangle, blue square, in balance. | #ff3d3d,#ffd23d,#0a0a0d | bare +circle.drift*1~c1 +triangle.drift*1~c2 +square.drift*1~#3d6bff ring=pixel
fx-marbling | Marbling | Paint floats on water and is combed into feathered patterns. | #ffb8d1,#3dd1c8,#0c0a0e | bare sky=ink:.85 ring=water
fx-neon-script | Neon Script | A hand-bent neon tube buzzes into life. | #ff3dc8,#3dffe8,#05040a | bare sky=fog:.45 +streak.drift*3~c1 cue=flash@1 ev=pulse:6-12 ring=neon
fx-op-art | Op Art | Black and white bands that seem to move when you don't. | #ffffff,#000000,#0a0a0a | bare sky=tunnel:.6 ring=pixel
fx-watercolour | Watercolour | Pigment blooms across wet paper. | #7ab8ff,#ff9a8a,#0d0c0e | bare sky=ink:.75 +drop.fall*4^.3~c1 ring=floral
fx-gallery-light | Gallery Light | A white cube, a single work, one perfect spotlight. | #ffffff,#d8d1c8,#151515 | bare sky=rays:.45 ring=platinum
fx-collage | Collage | Cut-out stars, stamps and photos layered with tape. | #ffcf8a,#ff6b6b,#0d0b09 | bare sky=film:.55 +card.drift*3~w +star.drift*3~c1 ring=floral
fx-blown-glass | Blown Glass | Molten glass turns on the pipe, bubbles caught inside. | #ff9a3d,#3dc8ff,#05060a | bare sky=glass:.7 +bubble.drift*8~w ring=ice
fx-wireframe | Wireframe | A wireframe mesh turns, its vertices glowing. | #7affd1,#3d8aff,#030508 | bare sky=hexgrid:.5 +triangle.drift*6~c1 +dust.twinkle*10~c1 ring=circuit
fx-riso-print | Riso Print | Grainy two-colour print, slightly misregistered. | #ff4f8b,#3d6bff,#f2ede4 | bare sky=comic:.7 ring=pixel
fx-ink-splash | Ink Splash | A single drop hits and splashes in slow motion. | #1a1a1a,#3d6bff,#f0ece4 | bare sky=ink:.8 +drip.fall*3^.4~c1 ring=shadow
fx-prism | Prism | White light splits into a spectrum across the card. | #ffffff,#ff6bd1,#05050a | bare sky=rays:.6 +diamond.twinkle*6~w ring=ice
fx-terrazzo | Terrazzo | Chips of colour set in a polished floor, slowly turning. | #ffb8a8,#7ad7c8,#eae6df | bare sky=hexgrid:.3 +shard.drift*10~c1,c2,#ffd23d ring=platinum
fx-light-painting | Light Painting | A long exposure draws ribbons of light. | #ffd23d,#ff3dc8,#030305 | bare sky=space:.3 hero=orb@.6,.3,.01 +star.comet*2@200~c1,c2 +orb.swirl*14~c1 ring=neon
fx-origami | Origami | Paper shapes fold themselves and take flight. | #f2f2ea,#ff6b6b,#0d0c0b | bare sky=dreamy:.4 +triangle.flutter*4~w ring=floral
fx-mosaic | Mosaic | Glass tiles catch the light in a slow wave. | #3dc8ff,#ffd23d,#05070a | bare sky=glass:.8 ring=pixel
fx-concrete-and-moss | Concrete & Moss | Grey forms softened by a single green growth. | #9ad18a,#8a8a85,#0c0c0b | bare sky=split:.45 +sprout.twinkle*3~c1 ring=floral
fx-chromatic | Chromatic | Red, green and blue separate and realign. | #ff3d3d,#3dff6a,#05050a | bare sky=split:.6 +circle.drift*2~#3d6bff ev=glitch:4-8 ring=neon
`,
seasons: `
bundle-409 | Lunar New Year | Red lanterns, gold and the first night of the year. | = | =
bundle-410 | Halloween Pumpkin Patch | Jack-o'-lanterns flickering in the field. | = | =
bundle-411 | Christmas Snow Globe | A shaken globe of snow and warm lights. | = | =
bundle-412 | Valentine's Heartbreak | Hearts adrift on a rose-red evening. | = | =
fx-snowy-window | Snowy Window | Frost on the pane and snow falling outside a warm room. | #ffe1b0,#7ab8ff,#05080e | frost sky=rainglass:.6 ring=ice
fx-harvest-lanterns | Harvest Lanterns | Paper lanterns sway over a harvest market. | #ffb35c,#c8442a,#0b0503 | lanterns sky=fog:.5 +maple.fall*6~c1,c2 ring=flame
fx-spring-rain | Spring Rain | A warm shower over new leaves. | #b8ff8a,#7ad7ff,#050a08 | rainglass +sprout.twinkle*3~c1 ring=water
fx-midnight-gold | Midnight Gold | Gold confetti and fireworks at the stroke of twelve. | #ffd76b,#ffffff,#06050a | fireworks sky=space +confetti.fall*16~c1,w cue=flash@2.5 ring=crown
fx-winter-starlight | Winter Starlight | A clear, freezing night and a sky full of stars. | #e1f0ff,#7a8ab8,#02030a | frost sky=space +twinkle.twinkle*16~w ring=ice
fx-midsummer | Midsummer | The longest day, with a sun that never quite sets. | #ffd23d,#ff8a3d,#0b0705 | sunrise hero=sun@.8,.2,.1 +firefly.drift*8~c1 ring=floral
fx-hallows-eve | Hallows' Eve | Bats cross an orange moon as leaves skitter down the path. | #ff8a2b,#5a2a6b,#050309 | haunted hero=moon@.72,.12,.11 +maple.fall*6~c1 ring=flame
fx-gingerbread-lane | Gingerbread Lane | Iced cookie houses glowing under falling snow. | #ffcf8a,#c86b3a,#0b0705 | frost sky=dreamy:.55 +star.twinkle*6~c1 ring=floral
fx-lantern-night | Lantern Night | Hundreds of sky lanterns rise into the dark. | #ffb35c,#ff6b3d,#0a0510 | lanterns +lantern.rise*10^.35~c1 ring=flame
fx-hanami | Hanami | Blossom over a picnic blanket in April sun. | #ffd1e1,#ff8ab8,#0c080a | blossom sky=clouds:.55 +heart.drift*2~c1 ring=floral
fx-festival-of-lights | Festival of Lights | Oil lamps and sparklers fill the night with gold. | #ffcf3d,#ff6b9a,#0a0508 | fireworks sky=fog:.4 +flame.twinkle*10%b~c1 +spark.twinkle*10~c1,w ring=crown
fx-first-snow | First Snow | The first flakes of the year, slow and huge. | #ffffff,#a8c8e8,#05070c | frost +snow.fall*10^.3~w ring=ice
fx-beach-day | Beach Day | Sun glitter on the waves and a parasol's shade. | #ffe14d,#3dd7ff,#05080b | bare sky=caustics:.7 hero=sun@.82,.08,.06 +twinkle.twinkle*12%b~w ring=water
fx-spring-meadow | Spring Meadow | Painted eggs hidden among spring flowers. | #ffd1e8,#b8ff8a,#0a0c08 | bare sky=clouds:.55 +petal.fall*8~c1,#ffe14d +butterfly.flutter*2~c2 ring=floral
fx-hearth | Hearth | A crackling log fire, sparks drifting up the chimney. | #ffb13d,#a8321a,#080302 | inferno sky=fire:.6 ring=flame
fx-carnival | Carnival | Feathers, sequins and a parade of colour. | #ff3d8a,#ffd23d,#0a0508 | fireworks +feather.fall*8~c1,c2 +twinkle.twinkle*8~w ring=crown
fx-snow-day | Snow Day | Snowballs arc across a white park. | #ffffff,#7ab8ff,#060a10 | frost sky=clouds:.6 +circle.flyby*1~w ring=ice
fx-october-rain | October Rain | Wet leaves stuck to the window in gold and red. | #ffb13d,#c8442a,#06060a | rainglass +maple.fall*8~c1,c2 ring=water
fx-golden-hour | Golden Hour | A slow, warm glow, like the best evening of the year. | #ffcf8a,#ff8ab8,#0c0808 | sunrise sky=rays hero=sun@.8,.16,.09 +dust.drift*14~c1 ring=metal
fx-countdown | Countdown | Clock hands meet at midnight as the crowd roars. | #ffffff,#ffd23d,#05050a | fireworks hero=clock@.72,.14,.1 cue=flash@3 ring=crown
`,
industrial: `
bundle-426 | Steampunk Gears | Brass gears and venting steam. | = | =
fx-reactor-core | Reactor Core | A blue core glows behind thick shielding as coolant swirls. | #3dd7ff,#3d6bff,#020509 | bare sky=hexgrid:.6 hero=orb@.72,.14,.07 +bubble.swirl*16~c1 ring=electric
fx-assembly-line | Assembly Line | Robotic arms weld in a shower of sparks. | #ffb33d,#5a6b7a,#040506 | bare sky=hexgrid:.45 +spark.streak*8@200^1.2~c1,w +spark.twinkle*6%a~c1 ring=gears
fx-magnetic-field | Magnetic Field | Iron filings align along invisible field lines. | #c8d1e1,#ff3d3d,#040506 | bare sky=vortex:.5 hero=orb@.72,.14,.03 +dust.swirl*40~c1 ring=metal
fx-spark-gap | Spark Gap | Arcs leap between two copper spheres. | #b8c8ff,#ff8a3d,#03030a | storm sky=hexgrid:.4 +bolt.lightning*3 ring=electric
fx-hydraulics | Hydraulics | Polished steel moving with hydraulic calm. | #c8ccd6,#3d8aff,#050607 | clockwork sky=chrome:.4 ring=gears
fx-collider | Collider | Particle tracks spiral out from a collision point. | #ffd23d,#3dc8ff,#020306 | bare sky=space:.4 hero=orb@.72,.14,.02 +dust.swirl*30~c1,c2 cue=flash@2 ring=circuit
fx-clean-room | Clean Room | Yellow light, white suits and a silicon wafer gleaming. | #ffe14d,#e8e8f0,#0a0904 | bare sky=chrome:.45 +dust.drift*6~c1 ring=platinum
fx-boiler-room | Boiler Room | Steam vents from riveted pipes under a red glow. | #ff8a3d,#c8b8a8,#080503 | steam sky=lava:.4 ring=gears
fx-blueprint | Blueprint | White lines draw a machine on blue paper. | #e8f4ff,#3d7bd1,#06142e | bare sky=hexgrid:.5 +triangle.twinkle*6~w +circle.twinkle*4~w ring=circuit
fx-laboratory | Laboratory | A flask bubbles and changes colour. | #7aff6b,#d16bff,#030603 | bare sky=glass:.5 +bubble.rise*14^.6~c1,c2 ring=water
fx-oscilloscope | Oscilloscope | A green trace sweeps across the graticule. | #6bff8a,#1a5c2a,#020502 | cyber sky=crt -bit0 -bit1 -hex +streak.streak*4@180^.6~c1 ring=circuit
fx-forge-press | Forge Press | Glowing billets squeezed under a hydraulic press. | #ffcf6b,#ff4d1a,#060201 | bare sky=lava:.6 +spark.rise*10~c1 ev=pulse:3-5 ring=gears
fx-turbine-hall | Turbine Hall | Giant blades spin in a cathedral of steel. | #c8d8e8,#5a7a9a,#030407 | bare sky=tunnel:.55 hero=ring@.72,.14,.1 ring=gears
fx-isotope | Isotope | A counter ticks faster as a green glow intensifies. | #9aff3d,#3a5c1a,#030502 | bare sky=fog:.5 hero=orb@.72,.14,.04 +dust.drift*24~c1 ev=pulse:2-5 ring=electric
fx-gold-contacts | Gold Contacts | Gold edge connectors and fine copper traces. | #ffd76b,#c87a3a,#050403 | circuit ring=circuit
fx-deep-space-array | Deep Space Array | A dish turns to listen as signals pulse in. | #e8f0ff,#ff8a3d,#02030a | cosmos sky=space hero=ring@.72,.14,.06 +circle.pulse*2%h~c1 ring=metal
fx-kinetic-sculpture | Kinetic Sculpture | Balanced arms turn in slow, perfect circles. | #e8e8f0,#c83a3a,#060607 | bare sky=chrome:.35 deco+circle.orbit*3~c1 +triangle.orbit*3~c2 ring=platinum
fx-under-the-lens | Under the Lens | Cells drift and divide in a pool of light. | #8affd1,#ff8ad1,#030607 | bare sky=caustics:.6 +bubble.drift*12~c1,c2 ring=water
fx-welders-mask | Welder's Mask | A blue-white arc and molten beads in the dark. | #b8e8ff,#ffb33d,#020304 | bare sky=fog:.4 hero=orb@.72,.16,.02 +spark.rise*16~c1,c2 ev=pulse:1-3 ring=electric
fx-gyroscope | Gyroscope | Nested rings spin on every axis around a still centre. | #ffd76b,#7ab8ff,#050507 | bare sky=space:.3 hero=ring@.72,.14,.09 +ring.pulse*1%h~c1 ring=platinum
fx-foundry | Foundry | A ladle pours molten iron into a mould. | #ffb13d,#a8321a,#080201 | bare sky=lava:.7 +ember.rise*12~c1 +smoke.rise*3~#5a4a44 ring=flame
fx-superconductor | Superconductor | A magnet floats above a cold disc as mist rolls off. | #9ad7ff,#e8f0ff,#020409 | frost sky=fog:.6 hero=orb@.72,.14,.04 ring=ice
fx-server-hall | Server Hall | Rows of blinking status lights hum in cold air. | #3dff7a,#3d9eff,#020403 | bare sky=hexgrid:.45 +orb.blink*30~c1,c2 ring=circuit
`,
signature: `
fx-celestial-crown* | Celestial Crown | A crown of starlight assembles above you as constellations wheel. | #fff1c9,#8aa6ff,#03030c | cosmos sky=space hero=none +star.twinkle*20~w,c1 +star.comet*1@160~w deco+star.orbit*6~c1 ring=crown intro=star*24
fx-obsidian-monarch* | Obsidian Monarch | A black glass throne room: molten gold veins and slow-falling ash. | #ffcf5c,#2a1a10,#020101 | inferno sky=lava +snow.fall*10^.4~#6b5a50 +coin.twinkle*4~c1 ring=crown
fx-golden-singularity* | Golden Singularity | A black hole wrapped in a disc of molten gold. | #ffd76b,#ff8a1a,#020102 | eventhorizon +dust.swirl*30~c1 ring=crown
fx-royal-apparition* | Royal Apparition | A spectral monarch in silver mist, candles bowing as it passes. | #e1e8ff,#7a6bd1,#030309 | phantom sky=cathedral:.7 +flame.twinkle*8%b~#ffcf8a ev=glitch:9-16 ring=crown
fx-infinite-bloom* | Infinite Bloom | Petals unfold endlessly from a light at the heart of the card. | #ffd1e8,#ffb36b,#0c0609 | blossom sky=vortex hero=orb@.72,.14,.04 +petal.swirl*30~c1,c2,w ring=floral
fx-the-architect* | The Architect | A city of light constructs itself from blueprint lines. | #e8f4ff,#3dd7ff,#020610 | circuit sky=hexgrid +square.rise*10^.4~c1 +triangle.twinkle*6~w cue=flash@2.5 ring=circuit
fx-aurora-sovereign | Aurora Sovereign | Twin curtains of aurora crown a frozen night. | #6bffcf,#b36bff,#020509 | aurora +twinkle.twinkle*14~w ring=crown
fx-phoenix-rising | Phoenix Rising | Wings of fire unfurl as ash turns back into flame. | #ffcf3d,#ff3d1a,#080201 | inferno sky=fire +feather.rise*8^.5~c1,c2 cue=flash@2.5 ring=flame
fx-tide-empress | Tide Empress | A crown of sea-glass and a slow whirlpool of light. | #7affea,#3d6bff,#020509 | abyss sky=vortex hero=orb@.72,.14,.04 +bubble.swirl*24~w ring=crown
fx-storm-sovereign | Storm Sovereign | Lightning answers you, and the frame crackles with it. | #c8d8ff,#7a5aff,#020209 | storm +bolt.lightning*3 ev=edge:3-6:2 ring=electric
fx-diamond-dynasty | Diamond Dynasty | Facets of light cascade through a crystalline vault. | #ffffff,#b8d8ff,#04050b | crystal sky=glass +diamond.fall*10^.4~w ring=crown
fx-velvet-eclipse | Velvet Eclipse | A rose-gold eclipse over a sea of velvet cloud. | #ffcfb8,#d1607a,#050207 | cosmos sky=dreamy:.7 hero=eclipse@.7,.15,.1 ring=platinum
fx-eternal-garden | Eternal Garden | A walled garden of glass flowers that never fade. | #c8ffe1,#ffb8e1,#050a08 | grove sky=glass:.6 +petal.fall*10~c1,c2 +butterfly.flutter*3~w ring=floral
fx-midnight-regalia | Midnight Regalia | Sapphire and silver: a royal night in motion. | #c8d8ff,#2a3d8a,#020309 | gilded sky=space +diamond.twinkle*8~w,c1 ring=crown
fx-solar-throne | Solar Throne | A sun rises behind you and its corona becomes your crown. | #ffe14d,#ff8a1a,#080402 | sunrise sky=rays hero=sun@.18,.24,.14 +ember.rise*8~c1 ring=crown
fx-gilded-labyrinth | Gilded Labyrinth | A golden maze glows, its paths lighting toward you. | #ffd76b,#7a4a1a,#060402 | bare sky=circuit:.7 +dust.drift*12~c1 ring=gears
fx-ivory-cathedral | Ivory Cathedral | White stone, a turning rose window and choir light. | #fff6e1,#d1b88a,#0b0a08 | cathedral hero=rosewindow@.72,.14,.11 ring=crown
fx-nebula-queen | Nebula Queen | A crown of nebula cloud with stars being born in it. | #ff8ad1,#7a8aff,#04030b | cosmos sky=nebula hero=none +twinkle.twinkle*18~w deco+star.orbit*5~c1 ring=nebula
fx-chrome-seraph | Chrome Seraph | Wings of liquid metal open behind you, shedding light. | #f2f4f8,#8aa6c8,#05060a | platinum +feather.fall*6^.4~w ring=crown
fx-emerald-sovereign | Emerald Sovereign | An emerald throne room lit by green fire. | #6bffb3,#1a6b45,#020604 | inferno sky=fire:.5 +shard.drift*4~c1 ring=crown
fx-the-timekeeper | The Timekeeper | Stars and gears turn the hours of the universe. | #ffd98a,#8aa6ff,#04040b | bare sky=space hero=clock@.72,.15,.12 +star.twinkle*16~w,c2 +dust.swirl*20~c1 ring=gears
fx-imperial-blossom | Imperial Blossom | Gold-leaf blossom falls through a lacquered night. | #ffd76b,#ff6b9a,#0a0306 | blossom sky=ink:.5 +petal.fall*16~c1,c2 ring=crown
fx-leviathan | Leviathan | Something enormous circles in the deep; its lights pass beneath you. | #3dffd7,#1a3d6b,#010305 | abyss sky=vortex hero=eye@.72,.14,.06 +fish.flutter*3~c1 ring=water
fx-void-monarch | Void Monarch | Reality frays at the edges while a black crown hovers. | #c38aff,#ff3d8a,#020103 | arcana sky=crimson:.7 hero=blackhole@.72,.14,.08 ev=glitch:6-11 ev=edge:5-9:3 ring=crown
`,
};

const HEX = /^#[0-9a-f]{6}$/i;
function parse(): CosmeticBundle[] {
  const out: CosmeticBundle[] = [];
  for (const col of COSMETIC_COLLECTIONS) {
    for (const raw of (CATALOGUE[col.id] ?? "").split("\n")) {
      const line = raw.trim(); if (!line) continue;
      const [idf, name, description, pal, spec] = line.split("|").map((x) => x.trim());
      const flagship = idf!.endsWith("*"), id = idf!.replace(/\*$/, "");
      const legacy = !id.startsWith("fx-");
      const palette = (pal && pal !== "=" ? pal.split(",") : ["", "", ""]) as [string, string, string];
      if (pal !== "=" && !palette.every((c) => HEX.test(c))) throw new Error(`cosmetics: bad palette for ${id}`);
      out.push({ id, name: name!, collection: col.id, description: description!, palette, spec: spec && spec !== "=" ? spec : null, flagship, legacy, availability: "free", version: 1 });
    }
  }
  return out;
}
export const COSMETIC_BUNDLES: CosmeticBundle[] = parse();
export const COSMETIC_IDS: string[] = COSMETIC_BUNDLES.map((b) => b.id);
const byId = new Map(COSMETIC_BUNDLES.map((b) => [b.id, b]));
export const cosmeticById = (id: string | null | undefined) => (id ? byId.get(id) : undefined);
export const COSMETIC_TARGET = { collections: 18, perCollection: 24, total: 432 } as const;
