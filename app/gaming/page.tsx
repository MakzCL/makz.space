import type { Metadata } from "next";

import { GAMES } from "@/lib/data/gaming";
import { listSaved } from "@/lib/data/saved";
import { readMinecraftStatus } from "@/lib/status";
import { ServerConsole } from "@/features/gaming/server-console";
import { SectionHead } from "@/components/ui/section-head";

export const metadata: Metadata = {
  title: "Gaming",
  description:
    "MakzMC [Unbound] modded survival and the makz. ETS2 convoy programme — live server state, connection details and modpacks.",
  alternates: { canonical: "/gaming" },
};

export default async function GamingPage() {
  const probeHost = GAMES.find((game) => game.probe)?.probe?.host;

  const [minecraft, saved] = await Promise.all([
    probeHost
      ? readMinecraftStatus(probeHost)
      : Promise.resolve({
          online: false,
          players: null,
          version: null,
          motd: null,
          checkedAt: new Date().toISOString(),
        }),
    listSaved(),
  ]);

  const savedSlugs = saved
    .filter((item) => item.item_type === "game")
    .map((item) => item.item_slug);

  return (
    <>
      <SectionHead
        index="03"
        name="Gaming"
        lede="Two machines that are actually running. A modded Minecraft network with a live map, and a bilingual ETS2 convoy programme with a fixed session flow."
        readouts={[
          { label: "Servers", value: "02" },
          {
            label: "Minecraft",
            value: minecraft.online ? "REACHABLE" : "UNREACHABLE",
          },
          { label: "Convoy", value: "1.58" },
        ]}
      />
      <div className="mt-8 md:mt-12">
        <ServerConsole
          games={GAMES}
          initialMinecraft={minecraft}
          savedSlugs={savedSlugs}
        />
      </div>
    </>
  );
}
