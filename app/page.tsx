import type { Metadata } from "next";

import { WORK } from "@/lib/data/work";
import { FRAMES } from "@/lib/data/frames";
import { SITE } from "@/lib/site";
import { Standby } from "@/features/home/standby";
import { EntryIndex } from "@/features/home/entry-index";
import { Channels } from "@/features/home/channels";

export const metadata: Metadata = {
  title: `${SITE.name} — ${SITE.operator}`,
  description: SITE.description,
  alternates: { canonical: "/" },
};

/** The current record is whichever is flagged active and sits first. */
const CURRENT = WORK.find((record) => record.status === "active") ?? WORK[0]!;

export default function StandbyPage() {
  return (
    <>
      <Standby
        current={CURRENT}
        recordCount={WORK.length}
        frameCount={FRAMES.length}
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
