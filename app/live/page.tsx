import type { Metadata } from "next";

import { Broadcast } from "@/features/live/broadcast";
import { SectionHead } from "@/components/ui/section-head";
import { readStreamStatus } from "@/lib/status";

export const metadata: Metadata = {
  title: "Live",
  description:
    "The MAKZ broadcast — self-hosted, no ads, no platform. Design, gaming, IRL and build sessions.",
  alternates: { canonical: "/live" },
};

export default async function LivePage() {
  const status = await readStreamStatus();

  return (
    <>
      <SectionHead
        index="02"
        name="Live"
        lede="An independent broadcast on owned infrastructure. Ingest, delivery, chat and status all run on stream.makz.space — there is no platform in between."
        readouts={[
          { label: "State", value: status.online ? "ON AIR" : "OFF AIR" },
          { label: "Delivery", value: "HLS" },
          { label: "Ads", value: "NONE" },
        ]}
      />
      <div className="mt-8 md:mt-12">
        <Broadcast />
      </div>
    </>
  );
}
