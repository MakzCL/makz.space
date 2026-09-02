import type { Metadata } from "next";

import { WORK } from "@/lib/data/work";
import { FRAMES } from "@/lib/data/frames";
import { GAMES } from "@/lib/data/gaming";
import { readMinecraftStatus } from "@/lib/status";
import { SITE } from "@/lib/site";
import { Standby } from "@/features/home/standby";
import { EntryIndex } from "@/features/home/entry-index";
import { Channels } from "@/features/home/channels";

export const metadata: Metadata = {
  title: `${SITE.name} — ${SITE.operator}`,
  description: SITE.description,
  alternates: { canonical: "/" },
};

/** Exactly one record carries `focus` — the thing actually on the bench. */
const CURRENT =
  WORK.find((record) => record.focus) ??
  WORK.find((record) => record.status === "active") ??
  WORK[0]!;
const LATEST = FRAMES[0]!;
const SERVER = GAMES.find((game) => game.probe) ?? GAMES[0]!;

export default async function StandbyPage() {
  // Cached for a minute upstream, so a hundred visitors cost one probe.
  const serverStatus = await readMinecraftStatus(
    SERVER.probe?.host ?? "play.makz.space",
  );

  return (
    <>
      <Standby
        current={CURRENT}
        latest={LATEST}
        server={SERVER}
        serverStatus={serverStatus}
        counts={{
          records: WORK.length,
          frames: FRAMES.length,
          servers: GAMES.length,
        }}
      />
      <EntryIndex />
      <Channels />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Person",
            name: SITE.operator,
            alternateName: SITE.name,
            url: SITE.url,
            jobTitle: SITE.role,
            address: {
              "@type": "PostalAddress",
              addressLocality: SITE.locality,
              addressCountry: SITE.region,
            },
            sameAs: [
              "https://www.twitch.tv/motomakz",
              "https://www.tiktok.com/@moto.makz",
              "https://www.instagram.com/moto.makz/",
            ],
          }),
        }}
      />
    </>
  );
}
