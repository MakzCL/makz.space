import { DEFAULT_PROFILE_THEME, PROFILE_CATALOG, type ProfileTheme } from "@send/shared";
const ORIGINAL_COLLECTIONS = [
  { id: "eclipse", name: "Lunar Eclipse", family: "Celestial", primary: "#B8DDF0", secondary: "#344F73", motif: "moon", description: "An eclipsed moon, silver craters and drifting celestial dust." },
  { id: "rosecourt", name: "Rose Court", family: "Botanical", primary: "#F3AFC7", secondary: "#965474", motif: "rose", description: "Pearlescent roses woven through an ornamental silver frame." },
  { id: "lepidoptera", name: "Afterglow", family: "Ethereal", primary: "#D5C3FF", secondary: "#8575DB", motif: "butterfly", description: "Iridescent butterflies suspended in a trail of violet light." },
  { id: "emberwake", name: "Emberwake", family: "Elemental", primary: "#FFCA80", secondary: "#E45428", motif: "flame", description: "Molten edges, dancing embers and a slow-burning crown." },
  { id: "glacial", name: "Glacial Crown", family: "Elemental", primary: "#BFF5FF", secondary: "#4084CF", motif: "crystal", description: "Hand-cut ice facets with a luminous frozen crest." },
  { id: "sakura", name: "Sakura Reverie", family: "Botanical", primary: "#FFD0E6", secondary: "#BC6F97", motif: "blossom", description: "Blossom branches, silk-like petals and soft spring light." },
  { id: "abyssal", name: "Abyssal Tide", family: "Elemental", primary: "#86F3DF", secondary: "#246C91", motif: "wave", description: "Sculpted sea-glass curls and bioluminescent currents." },
  { id: "ophidian", name: "Ophidian", family: "Dark", primary: "#B7D998", secondary: "#435F57", motif: "thorn", description: "An ancient thorned coil, dark metal and emerald eyes." },
  { id: "starlit", name: "Astral Atlas", family: "Celestial", primary: "#F5DEAE", secondary: "#7B8FD3", motif: "star", description: "Fine constellation lines, orbiting stars and antique gold." },
  { id: "gilded", name: "Gilded Atelier", family: "Ornamental", primary: "#F7D896", secondary: "#9A7649", motif: "filigree", description: "Engraved gold filigree with an understated satin finish." },
  { id: "wisteria", name: "Wisteria Night", family: "Botanical", primary: "#D2B4FF", secondary: "#625582", motif: "vine", description: "Trailing wisteria, delicate leaves and nocturnal fireflies." },
  { id: "phantom", name: "Phantom Veil", family: "Dark", primary: "#D4D9E8", secondary: "#655C89", motif: "ghost", description: "A spectral ribbon winding through moonlit fragments." },
] as const;
export type Collection = { id:NonNullable<ProfileTheme["collection"]>; name:string; family:string; primary:string; secondary:string; motif:typeof ORIGINAL_COLLECTIONS[number]["motif"]; description:string; art?:string; artKind?:"cover"|"logo"|"badge"; source?:string; artRatio?:number; focusY?:number; artTitle?:string; motion?:string };
export const COLLECTIONS:Collection[] = [...ORIGINAL_COLLECTIONS, ...PROFILE_CATALOG.filter(c=>c.ready).map(c=>({id:c.id,name:c.name,family:c.category,primary:c.primary,secondary:c.secondary,motif:c.motif,description:("art"in c?`${c.name} artwork with a SEND ${c.motif} frame and layered motion.`:`A ${c.name.toLowerCase()} palette with a ${c.motif} frame and layered motion.`),art:"art"in c?c.art:undefined,artKind:"kind"in c?c.kind:undefined,source:"source"in c?c.source:undefined,artRatio:"ratio"in c?(c as any).ratio:undefined,focusY:"focusY"in c?(c as any).focusY:undefined,artTitle:"artTitle"in c?c.artTitle:undefined,motion:c.motion}))];
export function collectionById(id: string | null | undefined) { return COLLECTIONS.find(c => c.id === id); }
export function collectionTheme(c: Collection): ProfileTheme {
  return { ...DEFAULT_PROFILE_THEME, collection: c.id, primary: c.primary, secondary: c.secondary,
    ring: { style: "none", color: c.primary, speed: .5 }, nameStyle: "gradient", nameColor2: c.primary, nameGlow: 20,
    frame: "glass", entrance: "fade", bannerAnimation: "pan",
    effects: [{ kind: ["sakura", "wisteria"].includes(c.id) || ["snow", "petals", "rain"].includes(c.motion??"") ? "snow" : c.motion === "tide" ? "aurora" : c.motion === "ember" ? "particles" : "sparkle", enabled: true, color: c.primary, intensity: 38, speed: .5, density: 15, loop: true, trigger: "always", duration: 8 }] };
}
