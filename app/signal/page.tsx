import type { Metadata } from "next";

import { CHANNELS, SITE } from "@/lib/site";
import { SectionHead } from "@/components/ui/section-head";
import { SignalBoard } from "@/features/signal/signal-board";

export const metadata: Metadata = {
  title: "Signal",
  description:
    "Where to find MAKZ — Twitch, TikTok, Instagram and the Discord community, plus how to get in touch.",
  alternates: { canonical: "/signal" },
};

export default function SignalPage() {
  return (
    <>
      <SectionHead
        index="05"
        name="Signal"
        lede={`Streams, clips, bike bits, updates, and whatever else makes it out of the workshop. Based in ${SITE.locality}, ${SITE.region}.`}
        readouts={[
          { label: "Channels", value: String(CHANNELS.length).padStart(2, "0") },
          { label: "Community", value: "DISCORD" },
          { label: "Base", value: SITE.locality.toUpperCase() },
        ]}
      />
      <div className="mt-8 md:mt-12">
        <SignalBoard />
      </div>
    </>
  );
}
