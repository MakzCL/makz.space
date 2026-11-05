import { create } from "zustand";
import { EXPRESSION_LIMITS, type Channel, type Emoji, type SoundboardSound } from "@syndo/shared";
import { api, errMsg } from "./api.ts";
import { onEvent, toast, useStore } from "./store.ts";
import { useVoice } from "./voice/session.ts";

/* Custom emoji, soundboard and category banners — shared helpers for the interface. */

/** Every custom emoji I can see (all my servers), current server first. */
export function myEmojis(currentGuildId?: string | null): { guildId: string; guildName: string; emojis: Emoji[] }[] {
  const s = useStore.getState();
  const groups = Object.values(s.guilds).filter((g) => g.emojis?.length).map((g) => ({ guildId: g.id, guildName: g.name, emojis: g.emojis! }));
  return groups.sort((a, b) => (a.guildId === currentGuildId ? -1 : b.guildId === currentGuildId ? 1 : a.guildName.localeCompare(b.guildName)));
}
export const emojiText = (e: Emoji) => `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`;
/** "<:name:id>" (message text) → "name:id" (reaction key). Unicode emoji pass through. */
export const reactionKey = (picked: string) => picked.match(/^<a?:([A-Za-z0-9_]{2,32}):(\d{1,20})>$/)?.slice(1).join(":") ?? picked;
/** A reaction key that refers to a custom emoji. */
export const customReaction = (key: string) => { const m = key.match(/^([A-Za-z0-9_]{2,32}):(\d{1,20})$/); return m ? { name: m[1]!, id: m[2]! } : null; };

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
const form = (f: File) => { const fd = new FormData(); fd.append("file", f, f.name); return fd; };

export async function uploadEmoji(guildId: string, file: File, name: string) {
  if (file.size > EXPRESSION_LIMITS.emojiBytes) throw new Error(`Emoji can be up to ${EXPRESSION_LIMITS.emojiBytes / 1024} KB.`);
  return api.post<Emoji>(`/api/guilds/${guildId}/emojis?name=${encodeURIComponent(name)}`, form(file));
}
/** A name suggestion from a file name: "Party Parrot (1).gif" → "party_parrot_1". */
export const emojiNameFrom = (file: string) => file.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32).padEnd(2, "_");

/** Length of an audio file, measured by decoding it. */
export async function audioDuration(file: File): Promise<number> {
  const ctx = new AudioContext();
  try { const buf = await ctx.decodeAudioData(await file.arrayBuffer()); return Math.round(buf.duration * 1000); }
  finally { ctx.close().catch(() => {}); }
}
export async function uploadSound(guildId: string, file: File, meta: { name: string; emoji?: string | null; volume?: number }) {
  if (file.size > EXPRESSION_LIMITS.soundBytes) throw new Error(`Sounds can be up to ${EXPRESSION_LIMITS.soundBytes / 1024} KB.`);
  let ms: number;
  try { ms = await audioDuration(file); } catch { throw new Error("That file couldn't be played as audio."); }
  if (ms > EXPRESSION_LIMITS.soundMs) throw new Error(`Sounds can be up to ${EXPRESSION_LIMITS.soundMs / 1000} seconds (this one is ${(ms / 1000).toFixed(1)} s).`);
  const qs = new URLSearchParams({ name: meta.name, duration_ms: String(Math.max(1, ms)), volume: String(meta.volume ?? 1), ...(meta.emoji ? { emoji: meta.emoji } : {}) });
  return api.post<SoundboardSound>(`/api/guilds/${guildId}/soundboard?${qs}`, form(file));
}

export async function setChannelBanner(c: Channel) {
  const f = await pickFile("image/png,image/jpeg,image/gif,image/webp,image/avif");
  if (!f) return;
  if (f.size > 4 * 1024 * 1024) { toast("Banners can be up to 4 MB.", "error"); return; }
  try { await api.post(`/api/channels/${c.id}/banner`, form(f)); toast("Banner updated", "success"); }
  catch (e) { toast(errMsg(e), "error"); }
}
export const removeChannelBanner = (c: Channel) => api.del(`/api/channels/${c.id}/banner`).catch((e) => toast(errMsg(e), "error"));

/* ------------------------------------------------------------ soundboard -- */
/** Who just played what (shown next to their name for a moment). */
export const useSoundboardActivity = create<Record<string, { emoji: string | null; name: string; until: number }>>(() => ({}));

export function soundsFor(guildId: string | null | undefined) {
  const s = useStore.getState();
  const here = guildId ? s.guilds[guildId]?.sounds ?? [] : [];
  const others = Object.values(s.guilds).filter((g) => g.id !== guildId && g.sounds?.length).map((g) => ({ guildId: g.id, guildName: g.name, sounds: g.sounds! }));
  return { here, others };
}
export async function playSoundboard(channelId: string, sound: SoundboardSound) {
  try { await api.post(`/api/channels/${channelId}/soundboard`, { sound_id: sound.id }); }
  catch (e) { toast(errMsg(e), "error"); }
}

/** Play a sound locally (preview in settings, or when someone plays it in my channel). */
export function playClip(url: string, volume: number) {
  const v = useVoice.getState();
  const el = new Audio(url);
  el.volume = Math.max(0, Math.min(1, volume * (v.settings.soundboardVolume ?? 1)));
  const sink = v.settings.outputDeviceId;
  if (sink && sink !== "default" && typeof (el as any).setSinkId === "function") (el as any).setSinkId(sink).catch(() => {});
  el.play().catch(() => {});
  return el;
}

let installed = false;
export function initSoundboard() {
  if (installed) return; installed = true;
  onEvent("SOUNDBOARD_PLAY", (d: { channel_id: string; user_id: string; sound: SoundboardSound }) => {
    const v = useVoice.getState();
    if (v.channelId !== d.channel_id) return;
    const until = Date.now() + Math.max(1500, d.sound.duration_ms + 400);
    useSoundboardActivity.setState({ [d.user_id]: { emoji: d.sound.emoji, name: d.sound.name, until } });
    setTimeout(() => { const cur = useSoundboardActivity.getState()[d.user_id]; if (cur && cur.until <= Date.now()) { const n = { ...useSoundboardActivity.getState() }; delete n[d.user_id]; useSoundboardActivity.setState(n, true); } }, until - Date.now() + 50);
    if (v.deafened || v.settings.soundboardMuted) return;
    playClip(d.sound.url, d.sound.volume);
  });
}
