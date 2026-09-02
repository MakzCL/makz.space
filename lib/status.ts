import "server-only";

import { STREAM } from "@/lib/site";
import type { MinecraftStatus, StreamStatus } from "@/types";

/**
 * Server-side probes for the broadcast and the game server.
 *
 * Both origins are queried from the server rather than the browser: it keeps
 * the client free of CORS failures, lets Next cache the response for a few
 * seconds so a hundred viewers cost one request, and means the markup ships
 * with real state already in it.
 */

const OFFLINE: Omit<StreamStatus, "checkedAt"> = {
  online: false,
  viewers: 0,
  title: null,
  startedAt: null,
  streamUrl: STREAM.hls,
  chatUrl: STREAM.chatEmbed,
};

export async function readStreamStatus(): Promise<StreamStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(`${STREAM.origin}/api/status`, {
      next: { revalidate: 15 },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return { ...OFFLINE, checkedAt };

    const data = (await response.json()) as Record<string, unknown>;
    const viewers = Number(
      data.viewerCount ?? data.viewers ?? data.viewer_count ?? 0,
    );

    return {
      online: Boolean(data.online),
      viewers: Number.isFinite(viewers) ? viewers : 0,
      title:
        (typeof data.streamTitle === "string" && data.streamTitle) ||
        (typeof data.title === "string" && data.title) ||
        null,
      startedAt:
        typeof data.lastConnectTime === "string" ? data.lastConnectTime : null,
      streamUrl: STREAM.hls,
      chatUrl: STREAM.chatEmbed,
      checkedAt,
    };
  } catch {
    // The origin is unreachable. That is an offline broadcast, not an error
    // the visitor should have to read a stack trace about.
    return { ...OFFLINE, checkedAt };
  }
}

export async function readMinecraftStatus(host: string): Promise<MinecraftStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(
      `https://api.mcsrvstat.us/3/${encodeURIComponent(host)}`,
      { next: { revalidate: 60 }, signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) {
      return { online: false, players: null, version: null, motd: null, checkedAt };
    }

    const data = (await response.json()) as {
      online?: boolean;
      players?: { online?: number; max?: number };
      version?: string;
      motd?: { clean?: string[] };
    };

    return {
      online: Boolean(data.online),
      players: data.players
        ? { online: data.players.online ?? 0, max: data.players.max ?? 0 }
        : null,
      version: data.version ?? null,
      motd: data.motd?.clean?.join(" ").trim() || null,
      checkedAt,
    };
  } catch {
    return { online: false, players: null, version: null, motd: null, checkedAt };
  }
}
