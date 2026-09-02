import type { GameRecord } from "@/types";

const IB = "https://i.ibb.co";

export const GAMES: GameRecord[] = [
  {
    slug: "makzmc",
    index: "01",
    title: "MAKZMC [UNBOUND]",
    platform: "Minecraft — Java",
    status: "running",
    role: "Owner / operator",
    detail:
      "Modded survival on a vanilla spine. YUNG and Terralith worldgen, a live web map, and a status probe this page reads directly.",
    facts: [
      { label: "Address", value: "play.makz.space" },
      { label: "Focus", value: "Modded survival" },
      { label: "Maps", value: "YUNG / Terralith" },
    ],
    links: [
      { label: "Live map", href: "https://map.makz.space", external: true },
      { label: "Modpack", href: "https://modsfire.com/54uN4r1VHFnNBeK", external: true },
      { label: "Discord", href: "https://discord.gg/mTPNyBdPSU", external: true },
      { label: "Record", href: "/work/makzmc" },
    ],
    probe: { kind: "minecraft", host: "play.makz.space:25567" },
  },
  {
    slug: "ets2-convoy",
    index: "02",
    title: "MAKZ. SERVER 01",
    platform: "Euro Truck Simulator 2 — Convoy 1.58",
    status: "scheduled",
    role: "Host",
    detail:
      "Vanilla+ with traffic enabled, eight seats, English and Polish. Sessions run to a fixed flow: find the server, meet, drive.",
    facts: [
      { label: "Server", value: "makz. | Vanilla+ | Traffic | Server 01 | EN/PL" },
      { label: "Password", value: "makz." },
      { label: "Seats", value: "8" },
      { label: "Setup", value: "Vanilla+ / Traffic / EN + PL" },
    ],
    links: [
      { label: "Record", href: "/work/ets2-convoy" },
      { label: "Discord", href: "https://discord.gg/HWUrCtQar8", external: true },
    ],
  },
];

export const GAME_ART: Record<string, string> = {
  makzmc: `${IB}/yL111TC/makzmc-webbg.png`,
  "ets2-convoy": `${IB}/23ZB95W2/makz-scania-500-S.png`,
};

export function getGame(slug: string) {
  return GAMES.find((game) => game.slug === slug);
}

/** Copyable connection strings, surfaced as real controls rather than text. */
export const CONNECTIONS = [
  { key: "mc", label: "Minecraft", value: "play.makz.space" },
  { key: "ets2-server", label: "ETS2 server", value: "makz. | Vanilla+ | Traffic | Server 01 | EN/PL" },
  { key: "ets2-pass", label: "ETS2 password", value: "makz." },
] as const;
