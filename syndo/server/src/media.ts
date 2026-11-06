import { closeSfuUser, restrictSfu, sfuConfigured } from "./sfu.ts";
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { config } from "./config.ts";

/**
 * Media plane: LiveKit (self-hosted SFU, Apache-2.0). This module only mints
 * short-lived join tokens and performs server-side enforcement (removing a
 * participant or revoking their publish rights). Audio/video never touches
 * the API server.
 */
const lk = config.livekit;
const rooms = lk.url && lk.apiKey && lk.apiSecret ? new RoomServiceClient(lk.url.replace(/^ws/, "http"), lk.apiKey, lk.apiSecret) : null;

export const roomName = (channelId: string) => `c${channelId}`;

export async function mintToken(opts: {
  userId: string; name: string; channelId: string; speak: boolean; video: boolean; metadata?: Record<string, unknown>;
}): Promise<string> {
  if (!lk.apiKey || !lk.apiSecret) throw new Error("media not configured");
  const at = new AccessToken(lk.apiKey, lk.apiSecret, { identity: opts.userId, name: opts.name, ttl: 600, metadata: JSON.stringify(opts.metadata ?? {}) });
  const sources: TrackSource[] = [];
  if (opts.speak) sources.push(TrackSource.MICROPHONE);
  if (opts.video) sources.push(TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  at.addGrant({
    room: roomName(opts.channelId), roomJoin: true, canSubscribe: true,
    canPublish: sources.length > 0, canPublishSources: sources, canPublishData: true, canUpdateOwnMetadata: true,
  });
  return at.toJwt();
}

/** Cut someone's media immediately (ban, kick, lost CONNECT, timeout, session revoked). */
export async function removeFromRoom(channelId: string, userId: string) {
  await closeSfuUser(channelId, userId);
  if (!rooms) return;
  try { await rooms.removeParticipant(roomName(channelId), userId); } catch { /* not in room */ }
}

/** Server mute / lost SPEAK or VIDEO: drop the right to publish those sources. */
export async function restrictPublishing(channelId: string, userId: string, speak: boolean, video: boolean) {
  await restrictSfu(channelId,userId,speak,video);
  if (!rooms) return;
  const sources: TrackSource[] = [];
  if (speak) sources.push(TrackSource.MICROPHONE);
  if (video) sources.push(TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  try {
    await rooms.updateParticipant(roomName(channelId), userId, { permission: { canSubscribe: true, canPublish: sources.length > 0, canPublishSources: sources, canPublishData: true } });
  } catch { /* not in room */ }
}

export const mediaConfigured = () => !!rooms || sfuConfigured();
