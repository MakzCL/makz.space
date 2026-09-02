/**
 * The index. Section order here is the section order everywhere: the rail,
 * the dock, the command palette, the sitemap and the route transitions all
 * read from this one array.
 */

export interface SectionNode {
  index: string;
  href: string;
  name: string;
  /** Shown when the rail expands and in the palette. */
  descriptor: string;
  /** Which direction the curtain travels when entering this section. */
  approach: "up" | "down";
}

export const SECTIONS = [
  {
    index: "00",
    href: "/",
    name: "STANDBY",
    descriptor: "Entry point. Identity, live state, current signal.",
    approach: "down",
  },
  {
    index: "01",
    href: "/work",
    name: "WORK",
    descriptor: "Selected records. Brand, systems, interfaces, servers.",
    approach: "up",
  },
  {
    index: "02",
    href: "/live",
    name: "LIVE",
    descriptor: "The broadcast. Player, chat, viewer state.",
    approach: "up",
  },
  {
    index: "03",
    href: "/gaming",
    name: "GAMING",
    descriptor: "Servers, convoys, sessions and the machines behind them.",
    approach: "up",
  },
  {
    index: "04",
    href: "/frames",
    name: "FRAMES",
    descriptor: "Poster work and stills. Full-bleed viewer.",
    approach: "up",
  },
  {
    index: "05",
    href: "/signal",
    name: "SIGNAL",
    descriptor: "Channels, community, contact.",
    approach: "up",
  },
] as const satisfies readonly SectionNode[];

export type SectionHref = (typeof SECTIONS)[number]["href"];

/**
 * Routes outside the numbered index: the account layer. They are not in the
 * rail — they belong to whoever is signed in, not to the site's structure —
 * but the ledger and the route curtain still have to name them correctly,
 * so they carry a marker instead of an index.
 */
export const ANNEX = [
  {
    index: "··",
    href: "/account",
    name: "ACCESS",
    descriptor: "Enter the account layer.",
    approach: "up",
  },
  {
    index: "··",
    href: "/settings",
    name: "SETTINGS",
    descriptor: "General, profile, appearance, privacy, security.",
    approach: "up",
  },
  {
    index: "··",
    href: "/saved",
    name: "SAVED",
    descriptor: "Records you kept.",
    approach: "up",
  },
  {
    index: "··",
    href: "/u",
    name: "PROFILE",
    descriptor: "An account record.",
    approach: "up",
  },
] as const satisfies readonly SectionNode[];

export const SITE = {
  name: "MAKZ",
  domain: "makz.space",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://makz.space",
  operator: "Karol Kuklinski",
  role: "Designer / Developer / Creator",
  locality: "Birmingham",
  region: "United Kingdom",
  timezone: "Europe/London",
  coordinates: { lat: 52.4862, lon: -1.8904 },
  description:
    "MAKZ is the personal digital environment of Karol Kuklinski — design records, a live broadcast, game servers and poster work, built as one interface.",
} as const;

export const CHANNELS = [
  {
    key: "twitch",
    label: "Twitch",
    handle: "motomakz",
    href: "https://www.twitch.tv/motomakz",
    note: "Streams and clips",
  },
  {
    key: "tiktok",
    label: "TikTok",
    handle: "moto.makz",
    href: "https://www.tiktok.com/@moto.makz",
    note: "Short form, bike bits",
  },
  {
    key: "instagram",
    label: "Instagram",
    handle: "moto.makz",
    href: "https://www.instagram.com/moto.makz/",
    note: "Stills and updates",
  },
  {
    key: "discord",
    label: "Discord",
    handle: "makz community",
    href: "https://discord.gg/HWUrCtQar8",
    note: "Server talk and support",
  },
] as const;

export const STREAM = {
  origin: "https://stream.makz.space",
  chatEmbed: "https://stream.makz.space/embed/chat/readwrite",
  hls: "https://stream.makz.space/hls/stream.m3u8",
} as const;

export function sectionForPath(pathname: string): SectionNode {
  if (pathname === "/") return SECTIONS[0];
  const section = SECTIONS.find(
    (node) => node.href !== "/" && pathname.startsWith(node.href),
  );
  if (section) return section;
  const annex = ANNEX.find((node) => pathname.startsWith(node.href));
  return annex ?? SECTIONS[0];
}
