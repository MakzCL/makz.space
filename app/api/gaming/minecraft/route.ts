import { NextResponse } from "next/server";

import { readMinecraftStatus } from "@/lib/status";
import { GAMES } from "@/lib/data/gaming";

/**
 * Only hosts declared in the gaming index can be probed, so this cannot be
 * used as an open proxy.
 */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("host");
  const allowed = GAMES.map((game) => game.probe?.host).filter(Boolean) as string[];
  const host = requested && allowed.includes(requested) ? requested : allowed[0];

  if (!host) {
    return NextResponse.json({ error: "No probe configured" }, { status: 404 });
  }

  const status = await readMinecraftStatus(host);
  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
    },
  });
}
